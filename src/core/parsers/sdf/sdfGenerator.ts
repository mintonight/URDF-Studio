import * as THREE from 'three';

import {
  getCollisionGeometryEntries,
  getVisualGeometryEntries,
  resolveVisualMaterialOverride,
} from '@/core/robot';
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
import { normalizeMeshPathForExport, normalizeTexturePathForExport } from '../meshPathUtils';

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

function resolveVisualMaterialState(
  robot: RobotState,
  link: UrdfLink,
  visual: UrdfVisual,
  isPrimaryVisual: boolean,
): { color?: string; texture?: string } {
  const resolvedMaterial = resolveVisualMaterialOverride(robot, link, visual, {
    isPrimaryVisual,
  });

  if (resolvedMaterial.source === 'authored') {
    return {
      color:
        resolvedMaterial.color ||
        (resolvedMaterial.texture ? '#ffffff' : undefined) ||
        visual.color ||
        undefined,
      texture: resolvedMaterial.texture,
    };
  }

  if (resolvedMaterial.source === 'legacy-link') {
    return {
      color:
        resolvedMaterial.color ||
        (resolvedMaterial.texture ? '#ffffff' : undefined) ||
        visual.color ||
        undefined,
      texture: resolvedMaterial.texture,
    };
  }

  const inlineAuthoredMaterial = visual.authoredMaterials?.find(
    (material) => material.color || material.texture,
  );
  return {
    color:
      visual.color ||
      inlineAuthoredMaterial?.color ||
      (inlineAuthoredMaterial?.texture ? '#ffffff' : undefined) ||
      undefined,
    texture: inlineAuthoredMaterial?.texture,
  };
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

    if (geometry.submeshName) {
      lines.push('            <submesh>');
      lines.push(`              <name>${escapeXml(geometry.submeshName)}</name>`);
      lines.push(`              <center>${geometry.submeshCenter ? 'true' : 'false'}</center>`);
      lines.push('            </submesh>');
    }

    lines.push('          </mesh>', '        </geometry>');
    return lines.join('\n');
  }

  if (
    geometry.type === GeometryType.POLYLINE &&
    geometry.polylinePoints &&
    geometry.polylinePoints.length >= 3
  ) {
    const pointLines = geometry.polylinePoints.map(
      (p) => `            <point>${formatShape(p.x)} ${formatShape(p.y)}</point>`,
    );
    const heightLine =
      geometry.polylineHeight != null
        ? `            <height>${formatShape(geometry.polylineHeight)}</height>`
        : '';
    return [
      '        <geometry>',
      '          <polyline>',
      ...pointLines,
      heightLine,
      '          </polyline>',
      '        </geometry>',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return ['        <geometry>', '          <empty/>', '        </geometry>'].join('\n');
}

function buildTextureUri(texturePath: string, packageName: string): string {
  if (isExternalAssetPath(texturePath)) {
    return texturePath;
  }

  const exportPath = normalizeTexturePathForExport(texturePath) || texturePath.replace(/\\/g, '/');
  return `model://${packageName}/textures/${exportPath}`;
}

function generateMaterialXml(
  materialState: { color?: string; texture?: string },
  packageName: string,
): string {
  const resolvedColor = materialState.color || (materialState.texture ? '#ffffff' : undefined);
  const rgba = hexToRgba(resolvedColor);
  if (!rgba && !materialState.texture) {
    return '';
  }

  const lines = ['        <material>'];
  if (rgba) {
    lines.push(`          <ambient>${rgba}</ambient>`, `          <diffuse>${rgba}</diffuse>`);
  }

  if (materialState.texture) {
    lines.push(
      '          <pbr>',
      '            <metal>',
      `              <albedo_map>${escapeXml(buildTextureUri(materialState.texture, packageName))}</albedo_map>`,
      '            </metal>',
      '          </pbr>',
    );
  }

  lines.push('        </material>');
  return lines.join('\n');
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

  const materialXml = generateMaterialXml(
    resolveVisualMaterialState(robot, link, visual, isPrimaryVisual),
    packageName,
  );
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

function linkHasSdfExportablePayload(link: UrdfLink): boolean {
  const inertial = link.inertial;
  const hasExportableInertial = Boolean(
    inertial &&
    (((Number.isFinite(inertial.mass) ? inertial.mass : 0) || 0) > 1e-9 ||
      Object.values(inertial.inertia || {}).some((value) => Math.abs(Number(value) || 0) > 1e-9)),
  );

  return (
    getVisualGeometryEntries(link).some((entry) => entry.geometry.type !== GeometryType.NONE) ||
    getCollisionGeometryEntries(link).some((entry) => entry.geometry.type !== GeometryType.NONE) ||
    hasExportableInertial
  );
}

function resolveSyntheticRootOmissions(robot: RobotState): {
  omittedJointIds: Set<string>;
  omittedLinkIds: Set<string>;
} {
  const omittedJointIds = new Set<string>();
  const omittedLinkIds = new Set<string>();
  const rootLinkId = robot.rootLinkId;
  if (!rootLinkId) {
    return { omittedJointIds, omittedLinkIds };
  }

  const rootLink = robot.links[rootLinkId];
  if (!rootLink) {
    return { omittedJointIds, omittedLinkIds };
  }

  const childJoints = Object.values(robot.joints).filter(
    (joint) => joint.parentLinkId === rootLinkId,
  );
  const canOmitRootAnchor =
    childJoints.length > 0 &&
    childJoints.every(
      (joint) => joint.type === JointType.FLOATING || joint.type === JointType.FIXED,
    ) &&
    !Object.values(robot.joints).some((joint) => joint.childLinkId === rootLinkId) &&
    !linkHasSdfExportablePayload(rootLink);

  if (!canOmitRootAnchor) {
    return { omittedJointIds, omittedLinkIds };
  }

  omittedLinkIds.add(rootLinkId);
  childJoints.forEach((joint) => {
    omittedJointIds.add(joint.id);
  });

  return { omittedJointIds, omittedLinkIds };
}

function createUniqueModelChildName(baseName: string, usedNames: Set<string>): string {
  const normalizedBase = baseName.trim() || 'joint';
  const preferredName = usedNames.has(normalizedBase) ? `${normalizedBase}_joint` : normalizedBase;
  if (!usedNames.has(preferredName)) {
    usedNames.add(preferredName);
    return preferredName;
  }

  let suffix = 1;
  while (usedNames.has(`${preferredName}_${suffix}`)) {
    suffix += 1;
  }
  const uniqueName = `${preferredName}_${suffix}`;
  usedNames.add(uniqueName);
  return uniqueName;
}

function generateJointXml(joint: UrdfJoint, jointNameOverride?: string): string {
  if (joint.type === JointType.FLOATING) {
    throw new Error(
      `[SDF export] Joint "${joint.name || joint.id}" uses unsupported floating type.`,
    );
  }

  const jointName = jointNameOverride || joint.name || joint.id;
  const lines = [`    <joint name="${escapeXml(jointName)}" type="${escapeXml(joint.type)}">`];
  if (joint.parentLinkId) {
    lines.push(`      <parent>${escapeXml(joint.parentLinkId)}</parent>`);
  }
  lines.push(`      <child>${escapeXml(joint.childLinkId)}</child>`);

  if (AXIS_EXPORT_TYPES.has(joint.type) && joint.axis) {
    lines.push('      <axis>');
    lines.push(
      `        <xyz>${formatScalar(joint.axis.x)} ${formatScalar(joint.axis.y)} ${formatScalar(joint.axis.z)}</xyz>`,
    );
    // Our internal axis is stored in the joint frame (URDF convention).
    // Explicitly mark this so SDF readers (any version) interpret it correctly.
    lines.push('        <use_parent_model_frame>false</use_parent_model_frame>');

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

function generateClosedLoopJointXmlWithName(
  constraint: RobotClosedLoopConstraint,
  jointName: string,
): string | null {
  if (constraint.type !== 'connect') {
    return null;
  }

  const childLinkId = escapeXml(constraint.linkBId);
  const anchorLocalB: Pose = {
    xyz: { ...constraint.anchorLocalB },
    rpy: { r: 0, p: 0, y: 0 },
  };

  return [
    `    <joint name="${escapeXml(jointName)}" type="ball">`,
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
  const { omittedJointIds, omittedLinkIds } = resolveSyntheticRootOmissions(robot);
  const usedModelChildNames = new Set<string>();

  const lines = [
    '<?xml version="1.0"?>',
    `<sdf version="${escapeXml(version)}">`,
    `  <model name="${escapeXml(modelName)}">`,
  ];

  Object.values(robot.links).forEach((link) => {
    if (omittedLinkIds.has(link.id)) {
      return;
    }

    usedModelChildNames.add(link.name || link.id);
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
    if (omittedJointIds.has(joint.id)) {
      return;
    }

    const jointName = createUniqueModelChildName(joint.name || joint.id, usedModelChildNames);
    lines.push(generateJointXml(joint, jointName));
  });
  (robot.closedLoopConstraints || []).forEach((constraint) => {
    const closedLoopName = createUniqueModelChildName(
      constraint.id || `${constraint.linkAId}_${constraint.linkBId}_closed_loop`,
      usedModelChildNames,
    );
    const closedLoopXml = generateClosedLoopJointXmlWithName(constraint, closedLoopName);
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
