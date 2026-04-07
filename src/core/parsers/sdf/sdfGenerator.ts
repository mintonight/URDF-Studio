import * as THREE from 'three';

import { getCollisionGeometryEntries, getVisualGeometryEntries } from '@/core/robot';
import {
  MAX_GEOMETRY_DIMENSION_DECIMALS,
  MAX_PROPERTY_DECIMALS,
  formatNumberWithMaxDecimals,
} from '@/core/utils/numberPrecision';
import {
  GeometryType,
  JointType,
  type RobotClosedLoopConstraint,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
  type UrdfVisual,
  type Vector3,
} from '@/types';
import { normalizeMeshPathForExport } from '../meshPathUtils';

export interface GenerateSDFOptions {
  packageName?: string;
  version?: string;
}

type Pose = {
  xyz: Vector3;
  rpy: { r: number; p: number; y: number };
};

const AXIS_EXPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
  JointType.PLANAR,
]);

const LIMIT_EXPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

const DYNAMICS_EXPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

const IDENTITY_SCALE = new THREE.Vector3(1, 1, 1);

const formatScalar = (value: number) => formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);
const formatShape = (value: number) =>
  formatNumberWithMaxDecimals(value, MAX_GEOMETRY_DIMENSION_DECIMALS);

function escapeXml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function isExternalAssetPath(path: string): boolean {
  return /^(?:blob:|https?:\/\/|data:)/i.test(path);
}

function poseToMatrix(pose: Pose): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(pose.xyz.x, pose.xyz.y, pose.xyz.z);
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pose.rpy.r, pose.rpy.p, pose.rpy.y, 'ZYX'),
  );
  matrix.compose(position, quaternion, IDENTITY_SCALE);
  return matrix;
}

function matrixToPose(matrix: THREE.Matrix4): Pose {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler(0, 0, 0, 'ZYX').setFromQuaternion(quaternion);

  return {
    xyz: { x: position.x, y: position.y, z: position.z },
    rpy: { r: euler.x, p: euler.y, y: euler.z },
  };
}

function isIdentityPose(pose: Pose, epsilon = 1e-9): boolean {
  return (
    Math.abs(pose.xyz.x) <= epsilon &&
    Math.abs(pose.xyz.y) <= epsilon &&
    Math.abs(pose.xyz.z) <= epsilon &&
    Math.abs(pose.rpy.r) <= epsilon &&
    Math.abs(pose.rpy.p) <= epsilon &&
    Math.abs(pose.rpy.y) <= epsilon
  );
}

function formatPose(pose: Pose): string {
  return [
    formatScalar(pose.xyz.x),
    formatScalar(pose.xyz.y),
    formatScalar(pose.xyz.z),
    formatScalar(pose.rpy.r),
    formatScalar(pose.rpy.p),
    formatScalar(pose.rpy.y),
  ].join(' ');
}

function hexToRgba(hex?: string): string | null {
  const normalized = String(hex || '').trim();
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(normalized);
  if (!result) {
    return null;
  }

  const serializeChannel = (channelHex: string) => {
    const channel = Number.parseInt(channelHex, 16);
    return Math.min(1, (channel + 1e-3) / 255).toFixed(8);
  };

  const r = serializeChannel(result[1]);
  const g = serializeChannel(result[2]);
  const b = serializeChannel(result[3]);
  const a = result[4] ? serializeChannel(result[4]) : '1.00000000';
  return `${r} ${g} ${b} ${a}`;
}

function resolveVisualColor(
  robot: RobotState,
  link: UrdfLink,
  visual: UrdfVisual,
  isPrimaryVisual: boolean,
): string | undefined {
  if (visual.color) {
    return visual.color;
  }

  if (!isPrimaryVisual) {
    return visual.authoredMaterials?.find((material) => material.color)?.color;
  }

  return (
    robot.materials?.[link.id]?.color ||
    robot.materials?.[link.name]?.color ||
    visual.authoredMaterials?.find((material) => material.color)?.color
  );
}

function buildMeshUri(meshPath: string, packageName: string): string {
  if (isExternalAssetPath(meshPath)) {
    return meshPath;
  }

  const exportPath = normalizeMeshPathForExport(meshPath) || meshPath.replace(/\\/g, '/');
  return `model://${packageName}/meshes/${exportPath}`;
}

function generateGeometryXml(geometry: UrdfVisual, packageName: string): string {
  if (geometry.type === GeometryType.BOX) {
    return [
      '        <geometry>',
      '          <box>',
      `            <size>${formatShape(geometry.dimensions.x)} ${formatShape(geometry.dimensions.y)} ${formatShape(geometry.dimensions.z)}</size>`,
      '          </box>',
      '        </geometry>',
    ].join('\n');
  }

  if (geometry.type === GeometryType.CYLINDER) {
    return [
      '        <geometry>',
      '          <cylinder>',
      `            <radius>${formatShape(geometry.dimensions.x)}</radius>`,
      `            <length>${formatShape(geometry.dimensions.y)}</length>`,
      '          </cylinder>',
      '        </geometry>',
    ].join('\n');
  }

  if (geometry.type === GeometryType.SPHERE) {
    return [
      '        <geometry>',
      '          <sphere>',
      `            <radius>${formatShape(geometry.dimensions.x)}</radius>`,
      '          </sphere>',
      '        </geometry>',
    ].join('\n');
  }

  if (geometry.type === GeometryType.CAPSULE) {
    return [
      '        <geometry>',
      '          <capsule>',
      `            <radius>${formatShape(geometry.dimensions.x)}</radius>`,
      `            <length>${formatShape(geometry.dimensions.y)}</length>`,
      '          </capsule>',
      '        </geometry>',
    ].join('\n');
  }

  if (geometry.type === GeometryType.MESH && geometry.meshPath) {
    const lines = [
      '        <geometry>',
      '          <mesh>',
      `            <uri>${escapeXml(buildMeshUri(geometry.meshPath, packageName))}</uri>`,
    ];

    const scale = geometry.dimensions;
    const hasCustomScale =
      Math.abs(scale.x - 1) > 1e-9 || Math.abs(scale.y - 1) > 1e-9 || Math.abs(scale.z - 1) > 1e-9;
    if (hasCustomScale) {
      lines.push(
        `            <scale>${formatShape(scale.x)} ${formatShape(scale.y)} ${formatShape(scale.z)}</scale>`,
      );
    }

    lines.push('          </mesh>', '        </geometry>');
    return lines.join('\n');
  }

  return ['        <geometry>', '          <empty/>', '        </geometry>'].join('\n');
}

function generateMaterialXml(color?: string): string {
  const rgba = hexToRgba(color);
  if (!rgba) {
    return '';
  }

  return [
    '        <material>',
    `          <ambient>${rgba}</ambient>`,
    `          <diffuse>${rgba}</diffuse>`,
    '        </material>',
  ].join('\n');
}

function generateVisualXml(
  robot: RobotState,
  link: UrdfLink,
  visual: UrdfVisual,
  visualIndex: number,
  packageName: string,
  isPrimaryVisual: boolean,
): string {
  const lines = [`      <visual name="${escapeXml(`${link.name}_visual_${visualIndex}`)}">`];
  if (!isIdentityPose(visual.origin)) {
    lines.push(`        <pose>${formatPose(visual.origin)}</pose>`);
  }
  lines.push(generateGeometryXml(visual, packageName));

  const materialXml = generateMaterialXml(resolveVisualColor(robot, link, visual, isPrimaryVisual));
  if (materialXml) {
    lines.push(materialXml);
  }

  lines.push('      </visual>');
  return lines.join('\n');
}

function generateCollisionXml(
  link: UrdfLink,
  collision: UrdfVisual,
  collisionIndex: number,
  packageName: string,
): string {
  const lines = [
    `      <collision name="${escapeXml(`${link.name}_collision_${collisionIndex}`)}">`,
  ];
  if (!isIdentityPose(collision.origin)) {
    lines.push(`        <pose>${formatPose(collision.origin)}</pose>`);
  }
  lines.push(generateGeometryXml(collision, packageName));
  lines.push('      </collision>');
  return lines.join('\n');
}

function generateInertialXml(link: UrdfLink): string | null {
  if (!link.inertial) {
    return null;
  }

  const inertia = link.inertial.inertia;
  const lines = ['      <inertial>'];
  if (link.inertial.origin && !isIdentityPose(link.inertial.origin)) {
    lines.push(`        <pose>${formatPose(link.inertial.origin)}</pose>`);
  }
  lines.push(
    `        <mass>${formatScalar(link.inertial.mass)}</mass>`,
    '        <inertia>',
    `          <ixx>${formatScalar(inertia.ixx)}</ixx>`,
    `          <ixy>${formatScalar(inertia.ixy)}</ixy>`,
    `          <ixz>${formatScalar(inertia.ixz)}</ixz>`,
    `          <iyy>${formatScalar(inertia.iyy)}</iyy>`,
    `          <iyz>${formatScalar(inertia.iyz)}</iyz>`,
    `          <izz>${formatScalar(inertia.izz)}</izz>`,
    '        </inertia>',
    '      </inertial>',
  );
  return lines.join('\n');
}

function buildLinkWorldMatrices(robot: RobotState): Map<string, THREE.Matrix4> {
  const identity = new THREE.Matrix4().identity();
  const matrices = new Map<string, THREE.Matrix4>();
  const jointsByParent = new Map<string, UrdfJoint[]>();

  Object.values(robot.joints).forEach((joint) => {
    const parentId = joint.parentLinkId || '__root__';
    const existing = jointsByParent.get(parentId);
    if (existing) {
      existing.push(joint);
      return;
    }
    jointsByParent.set(parentId, [joint]);
  });

  if (robot.rootLinkId && robot.links[robot.rootLinkId]) {
    matrices.set(robot.rootLinkId, identity.clone());
  }

  const queue = robot.rootLinkId && robot.links[robot.rootLinkId] ? [robot.rootLinkId] : [];

  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId) continue;

    const parentMatrix = matrices.get(parentId) ?? identity;
    (jointsByParent.get(parentId) || []).forEach((joint) => {
      if (!robot.links[joint.childLinkId] || matrices.has(joint.childLinkId)) {
        return;
      }

      matrices.set(
        joint.childLinkId,
        parentMatrix.clone().multiply(poseToMatrix(joint.origin as Pose)),
      );
      queue.push(joint.childLinkId);
    });
  }

  Object.values(robot.joints).forEach((joint) => {
    if (robot.links[joint.parentLinkId] && !matrices.has(joint.parentLinkId)) {
      matrices.set(joint.parentLinkId, identity.clone());
    }
    if (!robot.links[joint.childLinkId] || matrices.has(joint.childLinkId)) {
      return;
    }

    const parentMatrix = matrices.get(joint.parentLinkId) ?? identity;
    matrices.set(
      joint.childLinkId,
      parentMatrix.clone().multiply(poseToMatrix(joint.origin as Pose)),
    );
  });

  Object.keys(robot.links).forEach((linkId) => {
    if (!matrices.has(linkId)) {
      matrices.set(linkId, identity.clone());
    }
  });

  return matrices;
}

function generateJointXml(joint: UrdfJoint): string {
  const lines = [
    `    <joint name="${escapeXml(joint.name || joint.id)}" type="${escapeXml(joint.type)}">`,
  ];
  if (joint.parentLinkId) {
    lines.push(`      <parent>${escapeXml(joint.parentLinkId)}</parent>`);
  }
  lines.push(`      <child>${escapeXml(joint.childLinkId)}</child>`);

  if (AXIS_EXPORT_TYPES.has(joint.type) && joint.axis) {
    lines.push('      <axis>');
    lines.push(
      `        <xyz>${formatScalar(joint.axis.x)} ${formatScalar(joint.axis.y)} ${formatScalar(joint.axis.z)}</xyz>`,
    );

    if (LIMIT_EXPORT_TYPES.has(joint.type) && joint.limit) {
      const limitLines: string[] = [];
      if (Number.isFinite(joint.limit.lower)) {
        limitLines.push(`          <lower>${formatScalar(joint.limit.lower)}</lower>`);
      }
      if (Number.isFinite(joint.limit.upper)) {
        limitLines.push(`          <upper>${formatScalar(joint.limit.upper)}</upper>`);
      }
      if (Number.isFinite(joint.limit.effort)) {
        limitLines.push(`          <effort>${formatScalar(joint.limit.effort)}</effort>`);
      }
      if (Number.isFinite(joint.limit.velocity)) {
        limitLines.push(`          <velocity>${formatScalar(joint.limit.velocity)}</velocity>`);
      }
      if (limitLines.length > 0) {
        lines.push('        <limit>');
        lines.push(...limitLines);
        lines.push('        </limit>');
      }
    }

    if (
      DYNAMICS_EXPORT_TYPES.has(joint.type) &&
      joint.dynamics &&
      (Math.abs(joint.dynamics.damping) > 1e-9 || Math.abs(joint.dynamics.friction) > 1e-9)
    ) {
      lines.push('        <dynamics>');
      if (Math.abs(joint.dynamics.damping) > 1e-9) {
        lines.push(`          <damping>${formatScalar(joint.dynamics.damping)}</damping>`);
      }
      if (Math.abs(joint.dynamics.friction) > 1e-9) {
        lines.push(`          <friction>${formatScalar(joint.dynamics.friction)}</friction>`);
      }
      lines.push('        </dynamics>');
    }

    lines.push('      </axis>');
  }

  lines.push('    </joint>');
  return lines.join('\n');
}

function generateClosedLoopJointXml(constraint: RobotClosedLoopConstraint): string | null {
  if (constraint.type !== 'connect') {
    return null;
  }

  const jointName = escapeXml(
    constraint.id || `${constraint.linkAId}_${constraint.linkBId}_closed_loop`,
  );
  const childLinkId = escapeXml(constraint.linkBId);
  const anchorLocalB: Pose = {
    xyz: { ...constraint.anchorLocalB },
    rpy: { r: 0, p: 0, y: 0 },
  };

  return [
    `    <joint name="${jointName}" type="ball">`,
    `      <parent>${escapeXml(constraint.linkAId)}</parent>`,
    `      <child>${childLinkId}</child>`,
    `      <pose relative_to="${childLinkId}">${formatPose(anchorLocalB)}</pose>`,
    '    </joint>',
  ].join('\n');
}

export function generateSDF(robot: RobotState, options: GenerateSDFOptions = {}): string {
  const packageName = (options.packageName || robot.name || 'robot').trim() || 'robot';
  const modelName = (robot.name || packageName).trim() || 'robot';
  const version = options.version || '1.7';
  const linkMatrices = buildLinkWorldMatrices(robot);

  const lines = [
    '<?xml version="1.0"?>',
    `<sdf version="${escapeXml(version)}">`,
    `  <model name="${escapeXml(modelName)}">`,
  ];

  Object.values(robot.links).forEach((link) => {
    const linkPose = matrixToPose(
      linkMatrices.get(link.id || link.name) ?? new THREE.Matrix4().identity(),
    );
    lines.push(`    <link name="${escapeXml(link.name || link.id)}">`);
    if (!isIdentityPose(linkPose)) {
      lines.push(`      <pose>${formatPose(linkPose)}</pose>`);
    }

    getVisualGeometryEntries(link).forEach((entry, index) => {
      lines.push(
        generateVisualXml(robot, link, entry.geometry, index, packageName, entry.bodyIndex == null),
      );
    });

    getCollisionGeometryEntries(link).forEach((entry, index) => {
      lines.push(generateCollisionXml(link, entry.geometry, index, packageName));
    });

    const inertialXml = generateInertialXml(link);
    if (inertialXml) {
      lines.push(inertialXml);
    }

    lines.push('    </link>');
  });

  Object.values(robot.joints).forEach((joint) => {
    lines.push(generateJointXml(joint));
  });
  (robot.closedLoopConstraints || []).forEach((constraint) => {
    const closedLoopXml = generateClosedLoopJointXml(constraint);
    if (closedLoopXml) {
      lines.push(closedLoopXml);
    }
  });

  lines.push('  </model>', '</sdf>', '');

  return lines.join('\n');
}

export function generateSdfModelConfig(modelName: string, version = '1.7'): string {
  const safeName = (modelName || 'robot').trim() || 'robot';

  return [
    '<?xml version="1.0"?>',
    '<model>',
    `  <name>${escapeXml(safeName)}</name>`,
    '  <version>1.0</version>',
    `  <sdf version="${escapeXml(version)}">model.sdf</sdf>`,
    '</model>',
    '',
  ].join('\n');
}
