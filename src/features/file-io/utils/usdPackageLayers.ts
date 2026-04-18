import * as THREE from 'three';

import type {
  RobotClosedLoopConstraint,
  RobotState,
  UrdfJoint,
  UrdfLink,
} from '../../../types/index.ts';
import { computeUsdInertiaProperties } from '../../../shared/utils/inertiaUsd.ts';
import {
  USD_GEOMETRY_TYPES as GEOMETRY_TYPES,
  getUsdGeometryType as getGeometryType,
} from './usdSceneNodeFactory.ts';
import {
  escapeUsdString,
  formatUsdFloat,
  formatUsdTuple,
  makeUsdIndent,
  quaternionToUsdTuple,
  sanitizeUsdIdentifier,
  serializeUsdPrimSpecWithMetadata,
} from './usdTextFormatting.ts';

export type UsdLinkPathMaps = {
  linkPaths: Map<string, string>;
  childIdsByParent: Map<string, string[]>;
};

export type UsdPackageLayerContents = {
  rootLayerContent: string;
  baseLayerContent: string;
  physicsLayerContent: string;
  sensorLayerContent: string;
  robotLayerContent?: string;
};

export type UsdArchivePackage = {
  archiveFileName: string;
  rootLayerPath: string;
  archiveFiles: Map<string, Blob>;
};

export type UsdPackageLayoutProfile = 'legacy' | 'isaacsim' | 'genesis';
export type ResolvedUsdPackageLayoutProfile = 'legacy' | 'isaacsim';
export type UsdLayerFileFormat = 'usd' | 'usda';

export interface UsdPackageLayoutOptions {
  layoutProfile?: UsdPackageLayoutProfile;
  fileFormat?: UsdLayerFileFormat;
}

export const resolveUsdPackageLayoutProfile = (
  layoutProfile?: UsdPackageLayoutProfile,
): ResolvedUsdPackageLayoutProfile => {
  if (layoutProfile == null) {
    return 'legacy';
  }
  return layoutProfile === 'genesis' ? 'isaacsim' : layoutProfile;
};

const createIdentityBlob = (content: string): Blob => {
  return new Blob([content], { type: 'text/plain;charset=utf-8' });
};

const getUsdLayerExtension = (fileFormat: UsdLayerFileFormat = 'usd'): 'usd' | 'usda' => {
  return fileFormat === 'usda' ? 'usda' : 'usd';
};

const resolveUsdConfigStem = (
  packageRoot: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  if (layoutProfile === 'isaacsim') {
    // Isaac Sim exports keep sidecar stems aligned with the root prim name.
    return packageRoot;
  }
  return `${packageRoot}${packageRoot.includes('description') ? '' : '_description'}`;
};

const rpyToQuaternion = (r: number, p: number, y: number): THREE.Quaternion => {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, 'ZYX'));
};

const getAxisToken = (axis: THREE.Vector3 | UrdfJoint['axis'] | undefined): 'X' | 'Y' | 'Z' => {
  const vector = axis
    ? new THREE.Vector3(axis.x ?? 0, axis.y ?? 0, axis.z ?? 0)
    : new THREE.Vector3(1, 0, 0);

  if (vector.lengthSq() <= 1e-12) {
    return 'X';
  }

  const abs = {
    x: Math.abs(vector.x),
    y: Math.abs(vector.y),
    z: Math.abs(vector.z),
  };

  if (abs.y >= abs.x && abs.y >= abs.z) return 'Y';
  if (abs.z >= abs.x && abs.z >= abs.y) return 'Z';
  return 'X';
};

const jointTypeToUsdType = (
  joint: UrdfJoint,
):
  | 'PhysicsFixedJoint'
  | 'PhysicsRevoluteJoint'
  | 'PhysicsPrismaticJoint'
  | 'PhysicsSphericalJoint' => {
  const type = String(joint.type || '').toLowerCase();
  if (type === 'revolute' || type === 'continuous') {
    return 'PhysicsRevoluteJoint';
  }
  if (type === 'prismatic') {
    return 'PhysicsPrismaticJoint';
  }
  if (type === 'ball' || type === 'spherical') {
    return 'PhysicsSphericalJoint';
  }
  return 'PhysicsFixedJoint';
};

const radiansToDegrees = (value: number): number => {
  return (value * 180) / Math.PI;
};

const getUsdDriveInstanceName = (typeName: string): 'angular' | 'linear' | null => {
  if (typeName === 'PhysicsRevoluteJoint') {
    return 'angular';
  }
  if (typeName === 'PhysicsPrismaticJoint') {
    return 'linear';
  }
  return null;
};

const serializeJointDefinition = (
  joint: UrdfJoint,
  linkPaths: Map<string, string>,
  lines: string[],
  depth: number,
): void => {
  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);
  const typeName = jointTypeToUsdType(joint);
  const parentPath = linkPaths.get(joint.parentLinkId);
  const childPath = linkPaths.get(joint.childLinkId);

  if (!parentPath || !childPath) {
    return;
  }

  const supportsAxis = typeName === 'PhysicsRevoluteJoint' || typeName === 'PhysicsPrismaticJoint';
  const axisToken = getAxisToken(joint.axis);
  const driveInstanceName = getUsdDriveInstanceName(typeName);
  const driveDamping =
    Number.isFinite(joint.dynamics?.damping) && Math.abs(joint.dynamics.damping) > 1e-9
      ? joint.dynamics.damping
      : null;
  const driveMaxForce =
    Number.isFinite(joint.limit?.effort) && Math.abs(joint.limit.effort) > 1e-9
      ? joint.limit.effort
      : null;
  const shouldEmitDrive =
    driveInstanceName !== null && (driveDamping !== null || driveMaxForce !== null);

  serializeUsdPrimSpecWithMetadata(
    lines,
    depth,
    `def ${typeName} "${sanitizeUsdIdentifier(joint.id || joint.name || 'joint')}"`,
    shouldEmitDrive ? [`prepend apiSchemas = ["PhysicsDriveAPI:${driveInstanceName}"]`] : [],
  );
  lines.push(`${indent}{`);
  lines.push(`${childIndent}rel physics:body0 = <${parentPath}>`);
  lines.push(`${childIndent}rel physics:body1 = <${childPath}>`);

  if (supportsAxis) {
    lines.push(`${childIndent}uniform token physics:axis = "${axisToken}"`);
  }
  lines.push(
    `${childIndent}custom string urdf:jointType = "${escapeUsdString(String(joint.type || 'fixed').toLowerCase())}"`,
  );
  lines.push(
    `${childIndent}custom float3 urdf:axisLocal = ${formatUsdTuple([
      joint.axis?.x ?? 1,
      joint.axis?.y ?? 0,
      joint.axis?.z ?? 0,
    ])}`,
  );

  if (
    typeName === 'PhysicsRevoluteJoint' &&
    String(joint.type || '').toLowerCase() !== 'continuous' &&
    joint.limit
  ) {
    lines.push(
      `${childIndent}float physics:lowerLimit = ${formatUsdFloat(radiansToDegrees(joint.limit.lower))}`,
    );
    lines.push(
      `${childIndent}float physics:upperLimit = ${formatUsdFloat(radiansToDegrees(joint.limit.upper))}`,
    );
  } else if (typeName === 'PhysicsPrismaticJoint' && joint.limit) {
    lines.push(`${childIndent}float physics:lowerLimit = ${formatUsdFloat(joint.limit.lower)}`);
    lines.push(`${childIndent}float physics:upperLimit = ${formatUsdFloat(joint.limit.upper)}`);
  }

  if (shouldEmitDrive) {
    lines.push(`${childIndent}uniform token drive:${driveInstanceName}:physics:type = "force"`);
    if (driveDamping !== null) {
      lines.push(
        `${childIndent}float drive:${driveInstanceName}:physics:damping = ${formatUsdFloat(driveDamping)}`,
      );
    }
    if (driveMaxForce !== null) {
      lines.push(
        `${childIndent}float drive:${driveInstanceName}:physics:maxForce = ${formatUsdFloat(driveMaxForce)}`,
      );
    }
  }

  lines.push(
    `${childIndent}point3f physics:localPos0 = ${formatUsdTuple([
      joint.origin?.xyz?.x ?? 0,
      joint.origin?.xyz?.y ?? 0,
      joint.origin?.xyz?.z ?? 0,
    ])}`,
  );
  const originQuaternion = rpyToQuaternion(
    joint.origin?.rpy?.r ?? 0,
    joint.origin?.rpy?.p ?? 0,
    joint.origin?.rpy?.y ?? 0,
  );
  lines.push(
    `${childIndent}custom point3f urdf:originXyz = ${formatUsdTuple([
      joint.origin?.xyz?.x ?? 0,
      joint.origin?.xyz?.y ?? 0,
      joint.origin?.xyz?.z ?? 0,
    ])}`,
  );
  lines.push(
    `${childIndent}custom quatf urdf:originQuatWxyz = ${quaternionToUsdTuple(originQuaternion)}`,
  );
  lines.push(`${childIndent}quatf physics:localRot0 = ${quaternionToUsdTuple(originQuaternion)}`);
  lines.push(`${childIndent}point3f physics:localPos1 = (0, 0, 0)`);
  lines.push(`${childIndent}quatf physics:localRot1 = (1, 0, 0, 0)`);
  lines.push(`${indent}}`);
};

const serializeClosedLoopConstraintDefinition = (
  constraint: RobotClosedLoopConstraint,
  linkPaths: Map<string, string>,
  lines: string[],
  depth: number,
): void => {
  if (constraint.type !== 'connect') {
    return;
  }

  const linkAPath = linkPaths.get(constraint.linkAId);
  const linkBPath = linkPaths.get(constraint.linkBId);
  if (!linkAPath || !linkBPath) {
    return;
  }

  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);
  const constraintId = String(
    constraint.id || `${constraint.linkAId}_${constraint.linkBId}_closed_loop`,
  );

  serializeUsdPrimSpecWithMetadata(
    lines,
    depth,
    `def PhysicsSphericalJoint "${sanitizeUsdIdentifier(constraintId)}"`,
  );
  lines.push(`${indent}{`);
  lines.push(`${childIndent}rel physics:body0 = <${linkAPath}>`);
  lines.push(`${childIndent}rel physics:body1 = <${linkBPath}>`);
  lines.push(`${childIndent}custom string urdf:jointType = "ball"`);
  lines.push(`${childIndent}custom string urdf:closedLoopId = "${escapeUsdString(constraintId)}"`);
  lines.push(
    `${childIndent}custom string urdf:closedLoopType = "${escapeUsdString(constraint.type)}"`,
  );
  lines.push(
    `${childIndent}point3f physics:localPos0 = ${formatUsdTuple([
      constraint.anchorLocalA.x,
      constraint.anchorLocalA.y,
      constraint.anchorLocalA.z,
    ])}`,
  );
  lines.push(
    `${childIndent}point3f physics:localPos1 = ${formatUsdTuple([
      constraint.anchorLocalB.x,
      constraint.anchorLocalB.y,
      constraint.anchorLocalB.z,
    ])}`,
  );
  lines.push(`${childIndent}quatf physics:localRot0 = (1, 0, 0, 0)`);
  lines.push(`${childIndent}quatf physics:localRot1 = (1, 0, 0, 0)`);
  lines.push(`${indent}}`);
};

const serializeCollisionOverrides = (link: UrdfLink, lines: string[], depth: number): void => {
  const collisionVisuals = [
    ...(getGeometryType(link.collision?.type) !== GEOMETRY_TYPES.NONE ? [link.collision] : []),
    ...(link.collisionBodies || []).filter(
      (body) => getGeometryType(body.type) !== GEOMETRY_TYPES.NONE,
    ),
  ];

  if (collisionVisuals.length === 0) {
    return;
  }

  const indent = makeUsdIndent(depth);
  lines.push(`${indent}over "collisions"`);
  lines.push(`${indent}{`);

  collisionVisuals.forEach((visual, index) => {
    const childIndent = makeUsdIndent(depth + 1);
    const apiSchemas =
      getGeometryType(visual.type) === GEOMETRY_TYPES.MESH
        ? '"PhysicsCollisionAPI", "PhysicsMeshCollisionAPI"'
        : '"PhysicsCollisionAPI"';

    serializeUsdPrimSpecWithMetadata(lines, depth + 1, `over "collision_${index}"`, [
      `prepend apiSchemas = [${apiSchemas}]`,
    ]);
    lines.push(`${childIndent}{`);
    lines.push(`${makeUsdIndent(depth + 2)}bool physics:collisionEnabled = true`);
    if (getGeometryType(visual.type) === GEOMETRY_TYPES.MESH) {
      lines.push(`${makeUsdIndent(depth + 2)}uniform token physics:approximation = "convexHull"`);
    }
    lines.push(`${childIndent}}`);
  });

  lines.push(`${indent}}`);
};

const serializeLinkPhysicsOverride = (
  robot: RobotState,
  linkId: string,
  lines: string[],
  depth: number,
  options: {
    addArticulationRootApi?: boolean;
  } = {},
): void => {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);
  const apiSchemas = [
    '"PhysicsRigidBodyAPI"',
    ...(link.inertial ? ['"PhysicsMassAPI"'] : []),
    ...(options.addArticulationRootApi ? ['"PhysicsArticulationRootAPI"'] : []),
  ].join(', ');

  serializeUsdPrimSpecWithMetadata(lines, depth, `over "${sanitizeUsdIdentifier(linkId)}"`, [
    `prepend apiSchemas = [${apiSchemas}]`,
  ]);
  lines.push(`${indent}{`);

  if (link.inertial) {
    const usdInertia = computeUsdInertiaProperties(link.inertial);
    lines.push(`${childIndent}float physics:mass = ${formatUsdFloat(link.inertial.mass)}`);
    const inertialOrigin = link.inertial.origin?.xyz;
    if (inertialOrigin) {
      lines.push(
        `${childIndent}float3 physics:centerOfMass = ${formatUsdTuple([
          inertialOrigin.x ?? 0,
          inertialOrigin.y ?? 0,
          inertialOrigin.z ?? 0,
        ])}`,
      );
    }
    lines.push(
      `${childIndent}float3 physics:diagonalInertia = ${formatUsdTuple([
        usdInertia?.diagonalInertia[0] ?? 0,
        usdInertia?.diagonalInertia[1] ?? 0,
        usdInertia?.diagonalInertia[2] ?? 0,
      ])}`,
    );
    lines.push(
      `${childIndent}quatf physics:principalAxes = ${quaternionToUsdTuple(usdInertia?.principalAxesLocal)}`,
    );
  }

  serializeCollisionOverrides(link, lines, depth + 1);

  lines.push(`${indent}}`);
};

const serializeNestedLinkPhysicsOverrides = (
  robot: RobotState,
  linkId: string,
  childIdsByParent: Map<string, string[]>,
  lines: string[],
  depth: number,
): void => {
  serializeLinkPhysicsOverride(robot, linkId, lines, depth);

  (childIdsByParent.get(linkId) || []).forEach((childLinkId) => {
    serializeNestedLinkPhysicsOverrides(robot, childLinkId, childIdsByParent, lines, depth + 1);
  });
};

export const buildUsdLinkPathMaps = (
  robot: RobotState,
  rootPrimName: string,
  options: UsdPackageLayoutOptions = {},
): UsdLinkPathMaps => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const useFlatLinkPaths = layoutProfile === 'isaacsim';
  const childIdsByParent = new Map<string, string[]>();
  Object.values(robot.joints).forEach((joint) => {
    const children = childIdsByParent.get(joint.parentLinkId) || [];
    children.push(joint.childLinkId);
    childIdsByParent.set(joint.parentLinkId, children);
  });

  const linkPaths = new Map<string, string>();
  const visit = (linkId: string, parentPath: string) => {
    const path = useFlatLinkPaths
      ? `/${rootPrimName}/${sanitizeUsdIdentifier(linkId)}`
      : `${parentPath}/${sanitizeUsdIdentifier(linkId)}`;
    linkPaths.set(linkId, path);
    (childIdsByParent.get(linkId) || []).forEach((childLinkId) => visit(childLinkId, path));
  };

  visit(robot.rootLinkId, `/${rootPrimName}`);

  return { linkPaths, childIdsByParent };
};

export const buildUsdPhysicsLayerContent = (
  robot: RobotState,
  pathMaps: UsdLinkPathMaps,
  rootPrimName: string,
  configStem: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layerExtension = getUsdLayerExtension(options.fileFormat);
  const lines = [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    metersPerUnit = 1',
    '    subLayers = [',
    `        @${configStem}_base.${layerExtension}@`,
    '    ]',
    '    upAxis = "Z"',
    ')',
    '',
  ];

  lines.push('def PhysicsScene "physicsScene"');
  lines.push('{');
  lines.push('    vector3f physics:gravityDirection = (0, 0, -1)');
  lines.push('    float physics:gravityMagnitude = 9.81');
  lines.push('}');
  lines.push('');

  serializeUsdPrimSpecWithMetadata(lines, 0, `over "${rootPrimName}"`, [
    ...(resolveUsdPackageLayoutProfile(options.layoutProfile) === 'isaacsim'
      ? []
      : ['prepend apiSchemas = ["PhysicsArticulationRootAPI"]']),
  ]);
  lines.push('{');

  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  if (layoutProfile === 'isaacsim') {
    Array.from(pathMaps.linkPaths.keys()).forEach((linkId) => {
      serializeLinkPhysicsOverride(robot, linkId, lines, 1, {
        addArticulationRootApi: linkId === robot.rootLinkId,
      });
    });
  } else {
    serializeNestedLinkPhysicsOverrides(
      robot,
      robot.rootLinkId,
      pathMaps.childIdsByParent,
      lines,
      1,
    );
  }

  lines.push('');
  lines.push('    over "joints"');
  lines.push('    {');

  Object.values(robot.joints).forEach((joint) => {
    serializeJointDefinition(joint, pathMaps.linkPaths, lines, 2);
  });
  (robot.closedLoopConstraints || []).forEach((constraint) => {
    serializeClosedLoopConstraintDefinition(constraint, pathMaps.linkPaths, lines, 2);
  });

  lines.push('    }');
  lines.push('}');
  lines.push('');
  return `${lines.join('\n')}\n`;
};

export const buildUsdSensorLayerContent = (rootPrimName: string): string => {
  return [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    metersPerUnit = 1',
    '    upAxis = "Z"',
    ')',
    '',
    `def Xform "${rootPrimName}"`,
    '{',
    '}',
    '',
  ].join('\n');
};

export const buildUsdRootLayerContent = (
  rootPrimName: string,
  configStem: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const layerExtension = getUsdLayerExtension(options.fileFormat);

  if (layoutProfile === 'isaacsim') {
    return [
      '#usda 1.0',
      '(',
      `    defaultPrim = "${rootPrimName}"`,
      '    metersPerUnit = 1',
      '    upAxis = "Z"',
      ')',
      '',
      `def Xform "${rootPrimName}" (`,
      '    variants = {',
      '        string Physics = "PhysX"',
      '        string Robot = "Robot"',
      '        string Sensor = "Sensors"',
      '    }',
      '    prepend variantSets = ["Physics", "Sensor", "Robot"]',
      ')',
      '{',
      '    variantSet "Physics" = {',
      '        "None" (',
      `            prepend references = @configuration/${configStem}_base.${layerExtension}@`,
      '        ) {',
      '            over "joints" (',
      '                active = false',
      '            )',
      '            {',
      '            }',
      '',
      '        }',
      '        "PhysX" (',
      `            prepend payload = @configuration/${configStem}_physics.${layerExtension}@`,
      '        ) {',
      '',
      '        }',
      '    }',
      '    variantSet "Sensor" = {',
      '        "None" {',
      '',
      '        }',
      '        "Sensors" (',
      `            prepend payload = @configuration/${configStem}_sensor.${layerExtension}@`,
      '        ) {',
      '',
      '        }',
      '    }',
      '    variantSet "Robot" = {',
      '        "None" {',
      '',
      '        }',
      '        "Robot" (',
      `            prepend payload = @configuration/${configStem}_robot.${layerExtension}@`,
      '        ) {',
      '',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n');
  }

  return [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    upAxis = "Z"',
    '    metersPerUnit = 1',
    ')',
    '',
    `def Xform "${rootPrimName}" (`,
    '    variants = {',
    '        string Physics = "PhysX"',
    '        string Sensor = "Sensors"',
    '    }',
    '    prepend variantSets = ["Physics", "Sensor"]',
    ')',
    '{',
    '    quatd xformOp:orient = (1, 0, 0, 0)',
    '    double3 xformOp:scale = (1, 1, 1)',
    '    double3 xformOp:translate = (0, 0, 0)',
    '    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient", "xformOp:scale"]',
    '    variantSet "Physics" = {',
    '        "None" (',
    `            prepend references = @configuration/${configStem}_base.${layerExtension}@`,
    '        ) {',
    '            over "joints" (',
    '                active = false',
    '            )',
    '            {',
    '            }',
    '',
    '        }',
    '        "PhysX" (',
    `            prepend payload = @configuration/${configStem}_physics.${layerExtension}@`,
    '        ) {',
    '',
    '        }',
    '    }',
    '    variantSet "Sensor" = {',
    '        "None" {',
    '',
    '        }',
    '        "Sensors" (',
    `            prepend payload = @configuration/${configStem}_sensor.${layerExtension}@`,
    '        ) {',
    '',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
};

const serializeIsaacLinkOverride = (
  linkId: string,
  robot: RobotState,
  lines: string[],
  depth: number,
): void => {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);

  serializeUsdPrimSpecWithMetadata(lines, depth, `over "${sanitizeUsdIdentifier(linkId)}"`, [
    'prepend apiSchemas = ["IsaacLinkAPI"]',
  ]);
  lines.push(`${indent}{`);
  lines.push(`${childIndent}string isaac:nameOverride`);

  lines.push(`${indent}}`);
};

const serializeNestedIsaacLinkOverrides = (
  linkId: string,
  robot: RobotState,
  childIdsByParent: Map<string, string[]>,
  lines: string[],
  depth: number,
): void => {
  serializeIsaacLinkOverride(linkId, robot, lines, depth);

  (childIdsByParent.get(linkId) || []).forEach((childLinkId) => {
    serializeNestedIsaacLinkOverrides(childLinkId, robot, childIdsByParent, lines, depth + 1);
  });
};

export const buildUsdRobotLayerContent = (
  robot: RobotState,
  pathMaps: UsdLinkPathMaps,
  rootPrimName: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const lines = [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    metersPerUnit = 1',
    '    upAxis = "Z"',
    ')',
    '',
  ];

  const rootLinkPaths = Array.from(pathMaps.linkPaths.values()).map(
    (linkPath) => `        <${linkPath}>,`,
  );
  const jointPaths = Object.values(robot.joints).map(
    (joint) =>
      `        </${rootPrimName}/joints/${sanitizeUsdIdentifier(joint.id || joint.name || 'joint')}>,`,
  );

  serializeUsdPrimSpecWithMetadata(lines, 0, `def Xform "${rootPrimName}"`, [
    'prepend apiSchemas = ["IsaacRobotAPI"]',
  ]);
  lines.push('{');
  lines.push('    string isaac:description');
  lines.push('    string isaac:namespace');
  lines.push('    prepend rel isaac:physics:robotJoints = [');
  jointPaths.forEach((jointPath) => lines.push(jointPath));
  lines.push('    ]');
  lines.push('    prepend rel isaac:physics:robotLinks = [');
  rootLinkPaths.forEach((linkPath) => lines.push(linkPath));
  lines.push('    ]');
  lines.push('');

  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  if (layoutProfile !== 'isaacsim') {
    serializeNestedIsaacLinkOverrides(robot.rootLinkId, robot, pathMaps.childIdsByParent, lines, 1);
  } else {
    Array.from(pathMaps.linkPaths.keys()).forEach((linkId) => {
      serializeIsaacLinkOverride(linkId, robot, lines, 1);
    });
  }
  lines.push('');
  lines.push('    over "joints"');
  lines.push('    {');

  Object.values(robot.joints).forEach((joint, index) => {
    const jointName = sanitizeUsdIdentifier(joint.id || joint.name || 'joint');
    serializeUsdPrimSpecWithMetadata(lines, 2, `over "${jointName}"`, [
      'prepend apiSchemas = ["IsaacJointAPI"]',
    ]);
    lines.push('        {');
    lines.push('            string isaac:nameOverride');
    lines.push('            float[] isaac:physics:AccelerationLimit');
    lines.push(`            int isaac:physics:index = ${index}`);
    lines.push('            float[] isaac:physics:JerkLimit');
    lines.push('            int isaac:physics:Rot_X:DofOffset');
    lines.push('            int isaac:physics:Rot_Y:DofOffset');
    lines.push('            int isaac:physics:Rot_Z:DofOffset');
    lines.push('            int isaac:physics:Tr_X:DofOffset');
    lines.push('            int isaac:physics:Tr_Y:DofOffset');
    lines.push('            int isaac:physics:Tr_Z:DofOffset');
    lines.push('        }');
    lines.push('');
  });

  lines.push('    }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
};

export const createUsdArchivePackage = (
  exportName: string,
  layerContents: UsdPackageLayerContents,
  assetFiles: Map<string, Blob> = new Map(),
  options: UsdPackageLayoutOptions = {},
): UsdArchivePackage => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const layerExtension = getUsdLayerExtension(options.fileFormat);
  const packageRoot = sanitizeUsdIdentifier(exportName || 'robot');
  const configStemBase = resolveUsdConfigStem(packageRoot, options);
  const usdRoot = layoutProfile === 'isaacsim' ? packageRoot : `${packageRoot}/usd`;
  const configurationRoot = `${usdRoot}/configuration`;
  const rootLayerPath = `${usdRoot}/${packageRoot}.${layerExtension}`;

  const layerFiles: Array<[string, Blob]> = [
    [rootLayerPath, createIdentityBlob(layerContents.rootLayerContent)],
    [
      `${configurationRoot}/${configStemBase}_base.${layerExtension}`,
      createIdentityBlob(layerContents.baseLayerContent),
    ],
    [
      `${configurationRoot}/${configStemBase}_physics.${layerExtension}`,
      createIdentityBlob(layerContents.physicsLayerContent),
    ],
    [
      `${configurationRoot}/${configStemBase}_sensor.${layerExtension}`,
      createIdentityBlob(layerContents.sensorLayerContent),
    ],
  ];

  if (layerContents.robotLayerContent) {
    layerFiles.push([
      `${configurationRoot}/${configStemBase}_robot.${layerExtension}`,
      createIdentityBlob(layerContents.robotLayerContent),
    ]);
  }

  return {
    archiveFileName: `${packageRoot}_${layerExtension}.zip`,
    rootLayerPath,
    archiveFiles: new Map<string, Blob>([
      ...layerFiles,
      ...Array.from(assetFiles.entries()).map(
        ([relativePath, blob]) => [`${usdRoot}/${relativePath}`, blob] as const,
      ),
    ]),
  };
};
