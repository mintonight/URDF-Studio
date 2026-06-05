/**
 * MJCF (MuJoCo XML) Parser
 * Parses MuJoCo XML format and converts to RobotState
 */

import * as THREE from 'three';
import {
  RobotState,
  UrdfLink,
  UrdfJoint,
  DEFAULT_LINK,
  DEFAULT_JOINT,
  GeometryType,
  JointType,
  UrdfMjcfSite,
  UrdfVisual,
} from '@/types';
import {
  computeLinkWorldMatrices,
  createRobotClosedLoopConstraint,
  createRobotDistanceClosedLoopConstraint,
  resolveLinkKey,
  solveClosedLoopMotionCompensation,
} from '@/core/robot';
import {
  looksLikeMJCFDocument,
  type MJCFCompilerSettings,
  type MJCFHfield,
  type MJCFMaterial,
  type MJCFMesh,
  type MJCFTexture,
} from './mjcfUtils';
import { assignMJCFBodyGeomRoles, classifyMJCFGeom } from './mjcfGeomClassification';
import { buildMjcfCubeAuthoredMaterials, getMjcfCubeTextureFaceRecord } from './mjcfCubeTextures';
import {
  isNonZeroPosition,
  rotateLocalOffsetToParentFrame,
  subtractLocalOffset,
  toPositionObject,
  toQuatObject,
  toRPYObjectFromQuat,
} from './mjcfMath';
import {
  clearParsedMJCFModelCache,
  normalizeMultiJointBodies,
  parseMJCFModel,
  type MJCFModelConnectConstraint,
  type MJCFModelKeyframe,
  type MJCFModelJointEqualityConstraint,
  type MJCFModelTendonAttachment,
  type ParsedMJCFModel,
} from './mjcfModel';

interface MJCFBody {
  name: string;
  pos: { x: number; y: number; z: number };
  euler?: { r: number; p: number; y: number };
  quat?: { w: number; x: number; y: number; z: number };
  geoms: MJCFGeom[];
  sites?: MJCFSite[];
  joints: MJCFJointDef[];
  inertial?: MJCFInertial;
  children: MJCFBody[];
}

const FIXED_TENDON_RANGE_EPSILON = 1e-5;

interface MJCFSiteConstraintBinding {
  bodyName: string;
  anchorLocal: { x: number; y: number; z: number };
}

function resolveBodyLinkFrameOffsetLocal(
  body: ParsedMJCFModel['worldBody'],
): { x: number; y: number; z: number } | null {
  const jointOffset = toPositionObject(body.joints?.[0]?.pos);
  return isNonZeroPosition(jointOffset) ? jointOffset : null;
}

interface MJCFGeom {
  name?: string;
  sourceName?: string;
  className?: string;
  classQName?: string;
  type: string;
  size?: number[];
  mass?: number;
  mesh?: string;
  hfield?: string;
  material?: string;
  rgba?: number[];
  hasExplicitRgba?: boolean;
  pos?: { x: number; y: number; z: number };
  quat?: { w: number; x: number; y: number; z: number };
  fromto?: number[];
  contype?: number;
  conaffinity?: number;
  group?: number;
}

interface MJCFLinkPair {
  visual: MJCFGeom | null;
  collision: MJCFGeom | null;
}

interface MJCFJointDef {
  name: string;
  type: string;
  axis?: { x: number; y: number; z: number };
  range?: [number, number];
  ref?: number;
  pos?: { x: number; y: number; z: number };
  limited?: boolean;
  damping?: number;
  frictionloss?: number;
  armature?: number;
  stiffness?: number;
  actuatorForceRange?: [number, number];
  actuatorForceLimited?: boolean;
}

interface MJCFSite {
  name: string;
  sourceName?: string;
  type: string;
  size?: number[];
  rgba?: [number, number, number, number];
  pos?: { x: number; y: number; z: number };
  quat?: { w: number; x: number; y: number; z: number };
  group?: number;
}

interface MJCFActuator {
  name: string;
  type: string;
  joint?: string;
  ctrlrange?: [number, number];
  forcerange?: [number, number];
  gear?: number[];
}

interface MJCFInertial {
  mass: number;
  pos: { x: number; y: number; z: number };
  quat?: { w: number; x: number; y: number; z: number };
  diaginertia?: { ixx: number; iyy: number; izz: number };
  fullinertia?: number[]; // ixx iyy izz ixy ixz iyz
}

function buildHfieldDimensions(
  hfieldAsset: MJCFHfield | undefined,
  geomSize: number[] | undefined,
): { x: number; y: number; z: number } {
  const size =
    hfieldAsset?.size && hfieldAsset.size.length >= 4
      ? hfieldAsset.size
      : geomSize && geomSize.length >= 4
        ? ([geomSize[0] ?? 1, geomSize[1] ?? 1, geomSize[2] ?? 0, geomSize[3] ?? 0] as [
            number,
            number,
            number,
            number,
          ])
        : undefined;

  if (!size) {
    return { x: 1, y: 1, z: 0 };
  }

  return {
    x: (size[0] ?? 1) * 2,
    y: (size[1] ?? 1) * 2,
    z: (size[2] ?? 0) + (size[3] ?? 0),
  };
}

function cloneMjcfMeshAsset(meshAsset: MJCFMesh): NonNullable<UrdfVisual['mjcfMesh']> {
  return {
    name: meshAsset.name,
    ...(meshAsset.file ? { file: meshAsset.file } : {}),
    ...(meshAsset.vertices?.length ? { vertices: [...meshAsset.vertices] } : {}),
    ...(meshAsset.scale && meshAsset.scale.length >= 3
      ? {
          scale: [meshAsset.scale[0] ?? 1, meshAsset.scale[1] ?? 1, meshAsset.scale[2] ?? 1],
        }
      : {}),
    ...(meshAsset.refpos && meshAsset.refpos.length >= 3
      ? {
          refpos: [meshAsset.refpos[0] ?? 0, meshAsset.refpos[1] ?? 0, meshAsset.refpos[2] ?? 0],
        }
      : {}),
    ...(meshAsset.refquat && meshAsset.refquat.length >= 4
      ? {
          refquat: [
            meshAsset.refquat[0] ?? 1,
            meshAsset.refquat[1] ?? 0,
            meshAsset.refquat[2] ?? 0,
            meshAsset.refquat[3] ?? 0,
          ],
        }
      : {}),
  };
}

function convertJointType(
  mjcfType: string,
  range?: [number, number],
  limited?: boolean,
): JointType {
  switch (mjcfType.toLowerCase()) {
    case 'hinge':
      return limited === false || !range ? JointType.CONTINUOUS : JointType.REVOLUTE;
    case 'slide':
      return JointType.PRISMATIC;
    case 'ball':
      return JointType.BALL;
    case 'free':
      return JointType.FLOATING;
    default:
      return JointType.FIXED;
  }
}

function convertGeomType(mjcfType: string): GeometryType {
  switch (mjcfType.toLowerCase()) {
    case 'box':
      return GeometryType.BOX;
    case 'plane':
      return GeometryType.PLANE;
    case 'sphere':
      return GeometryType.SPHERE;
    case 'cylinder':
      return GeometryType.CYLINDER;
    case 'capsule':
      return GeometryType.CAPSULE;
    case 'ellipsoid':
      return GeometryType.ELLIPSOID;
    case 'hfield':
      return GeometryType.HFIELD;
    case 'sdf':
      return GeometryType.SDF;
    case 'mesh':
      return GeometryType.MESH;
    default:
      return GeometryType.NONE;
  }
}

function hasImportableGeometry(geom: MJCFGeom): boolean {
  if (geom.mesh) {
    return true;
  }

  return convertGeomType(geom.type) !== GeometryType.NONE;
}

function shouldPreserveSyntheticWorldRoot(worldBody: MJCFBody): boolean {
  if (worldBody.inertial && worldBody.inertial.mass > 0) {
    return true;
  }

  if (worldBody.joints.length > 0) {
    return true;
  }

  if (worldBody.geoms.some(hasImportableGeometry)) {
    return true;
  }

  if (worldBody.children.length !== 1) {
    return true;
  }

  const [onlyChild] = worldBody.children;
  if (onlyChild.joints.length > 0) {
    return true;
  }

  if (isNonZeroPosition(onlyChild.pos)) {
    return true;
  }

  const rootRotation = onlyChild.euler || toRPYObjectFromQuat(onlyChild.quat);
  return (
    !!rootRotation &&
    (Math.abs(rootRotation.r) > 1e-9 ||
      Math.abs(rootRotation.p) > 1e-9 ||
      Math.abs(rootRotation.y) > 1e-9)
  );
}

function convertAngle(value: number, settings: MJCFCompilerSettings): number {
  return settings.angleUnit === 'degree' ? value * (Math.PI / 180) : value;
}

function convertJointRange(
  range: [number, number] | undefined,
  _mjcfType: string | undefined,
  _settings: MJCFCompilerSettings,
): [number, number] | undefined {
  return range;
}

function toEffortMagnitude(range: [number, number] | undefined): number | undefined {
  if (!range) {
    return undefined;
  }

  const lower = range[0];
  const upper = range[1];
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    return undefined;
  }

  return Math.max(Math.abs(lower), Math.abs(upper));
}

function pickMaxDefined(values: Array<number | undefined>): number | undefined {
  let maxValue: number | undefined;
  values.forEach((value) => {
    if (value == null || !Number.isFinite(value)) {
      return;
    }

    maxValue = maxValue == null ? value : Math.max(maxValue, value);
  });

  return maxValue;
}

function resolveJointMechanicalRange(
  joint: MJCFJointDef | undefined,
  jointType: JointType,
): [number, number] | undefined {
  if (!joint?.range) {
    return undefined;
  }

  if (
    jointType === JointType.CONTINUOUS ||
    jointType === JointType.BALL ||
    joint.limited === false
  ) {
    return undefined;
  }

  return joint.range;
}

function resolveJointEffortLimit(
  joint: MJCFJointDef | undefined,
  actuators: MJCFActuator[] | undefined,
): number {
  if (joint?.actuatorForceLimited !== false) {
    const jointActuatorForce = toEffortMagnitude(joint?.actuatorForceRange);
    if (jointActuatorForce != null) {
      return jointActuatorForce;
    }
  }

  const actuatorForce = pickMaxDefined(
    (actuators || []).map((actuator) => toEffortMagnitude(actuator.forcerange)),
  );
  if (actuatorForce != null) {
    return actuatorForce;
  }

  const motorControlLimit = pickMaxDefined(
    (actuators || [])
      .filter((actuator) => actuator.type.toLowerCase() === 'motor')
      .map((actuator) => toEffortMagnitude(actuator.ctrlrange)),
  );
  return motorControlLimit ?? 0;
}

function buildImportedJointLimit(
  jointType: JointType,
  range: [number, number] | undefined,
  effort: number,
  velocity = 0,
): NonNullable<UrdfJoint['limit']> | undefined {
  if (
    jointType === JointType.FIXED ||
    jointType === JointType.FLOATING ||
    jointType === JointType.BALL
  ) {
    return undefined;
  }

  return {
    lower: range?.[0] ?? Number.NEGATIVE_INFINITY,
    upper: range?.[1] ?? Number.POSITIVE_INFINITY,
    effort,
    velocity,
  };
}

function resolveJointInitialAngle(
  joint: MJCFJointDef | undefined,
  jointType: JointType,
): number | undefined {
  if (!joint || !Number.isFinite(joint.ref)) {
    return undefined;
  }

  if (
    jointType === JointType.REVOLUTE ||
    jointType === JointType.CONTINUOUS ||
    jointType === JointType.PRISMATIC
  ) {
    return joint.ref;
  }

  return undefined;
}

function createEmptyLinkInertial(): NonNullable<UrdfLink['inertial']> {
  return {
    mass: 0,
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
  };
}

function getGeomMassCenter(geom: MJCFGeom): { x: number; y: number; z: number } {
  if (geom.pos) {
    return geom.pos;
  }

  if (geom.fromto && geom.fromto.length >= 6) {
    return {
      x: ((geom.fromto[0] ?? 0) + (geom.fromto[3] ?? 0)) / 2,
      y: ((geom.fromto[1] ?? 0) + (geom.fromto[4] ?? 0)) / 2,
      z: ((geom.fromto[2] ?? 0) + (geom.fromto[5] ?? 0)) / 2,
    };
  }

  return { x: 0, y: 0, z: 0 };
}

function rgbaToHexColor(rgba: number[]): string | null {
  if (rgba.length < 3) {
    return null;
  }

  const [r, g, b, a] = rgba;
  if (![r, g, b].every((value) => Number.isFinite(value))) {
    return null;
  }

  const toHexChannel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, '0');

  const rgbHex = `${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
  if (!Number.isFinite(a) || a >= 0.999) {
    return `#${rgbHex}`;
  }

  return `#${rgbHex}${toHexChannel(a)}`;
}

function rgbaToColorRgbaTuple(
  rgba: number[] | undefined,
): [number, number, number, number] | undefined {
  if (!rgba || rgba.length < 3) {
    return undefined;
  }

  const [r, g, b, a = 1] = rgba;
  if (![r, g, b, a].every((value) => Number.isFinite(value))) {
    return undefined;
  }

  const clamp = (value: number) => Math.max(0, Math.min(1, Number(value)));
  return [clamp(r), clamp(g), clamp(b), clamp(a)];
}

function deriveGeomMassInertial(geoms: MJCFGeom[]): NonNullable<UrdfLink['inertial']> | null {
  const massGeoms = geoms.filter(
    (geom) => typeof geom.mass === 'number' && Number.isFinite(geom.mass) && (geom.mass ?? 0) > 0,
  );

  if (massGeoms.length === 0) {
    return null;
  }

  const totalMass = massGeoms.reduce((sum, geom) => sum + (geom.mass ?? 0), 0);
  if (!Number.isFinite(totalMass) || totalMass <= 0) {
    return null;
  }

  const weightedCenter = massGeoms.reduce(
    (sum, geom) => {
      const mass = geom.mass ?? 0;
      const center = getGeomMassCenter(geom);
      return {
        x: sum.x + center.x * mass,
        y: sum.y + center.y * mass,
        z: sum.z + center.z * mass,
      };
    },
    { x: 0, y: 0, z: 0 },
  );

  const centerOfMass = {
    x: weightedCenter.x / totalMass,
    y: weightedCenter.y / totalMass,
    z: weightedCenter.z / totalMass,
  };

  const inertia = massGeoms.reduce(
    (sum, geom) => {
      const mass = geom.mass ?? 0;
      const center = getGeomMassCenter(geom);
      const dx = center.x - centerOfMass.x;
      const dy = center.y - centerOfMass.y;
      const dz = center.z - centerOfMass.z;

      return {
        ixx: sum.ixx + mass * (dy * dy + dz * dz),
        ixy: sum.ixy - mass * dx * dy,
        ixz: sum.ixz - mass * dx * dz,
        iyy: sum.iyy + mass * (dx * dx + dz * dz),
        iyz: sum.iyz - mass * dy * dz,
        izz: sum.izz + mass * (dx * dx + dy * dy),
      };
    },
    { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
  );

  return {
    mass: totalMass,
    origin: {
      xyz: centerOfMass,
      rpy: { r: 0, p: 0, y: 0 },
    },
    inertia,
  };
}

function toRPYObjectFromEulerTuple(
  tuple: [number, number, number] | undefined,
  settings: MJCFCompilerSettings,
): { r: number; p: number; y: number } | undefined {
  if (!tuple) {
    return undefined;
  }

  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      convertAngle(tuple[0] ?? 0, settings),
      convertAngle(tuple[1] ?? 0, settings),
      convertAngle(tuple[2] ?? 0, settings),
    ),
  );

  return toRPYObjectFromQuat({
    w: quaternion.w,
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
  });
}

function toParserBody(sharedBody: any, settings: MJCFCompilerSettings): MJCFBody {
  return {
    name: sharedBody.name,
    pos: toPositionObject(sharedBody.pos),
    euler: toRPYObjectFromEulerTuple(sharedBody.euler, settings),
    quat: toQuatObject(sharedBody.quat),
    geoms: (sharedBody.geoms || []).map((geom: any) => ({
      name: geom.sourceName || geom.name,
      sourceName: geom.sourceName,
      className: geom.className,
      classQName: geom.classQName,
      type: geom.type,
      size: geom.size,
      mass: typeof geom.mass === 'number' ? geom.mass : undefined,
      mesh: geom.mesh,
      hfield: geom.hfield,
      material: geom.material,
      rgba: geom.rgba,
      hasExplicitRgba: geom.hasExplicitRgba,
      pos: geom.pos ? toPositionObject(geom.pos) : undefined,
      quat: toQuatObject(geom.quat),
      fromto: geom.fromto,
      contype: geom.contype,
      conaffinity: geom.conaffinity,
      group: geom.group,
    })),
    sites: (sharedBody.sites || []).map((site: any) => ({
      name: site.name,
      sourceName: site.sourceName,
      type: site.type,
      size: Array.isArray(site.size) ? [...site.size] : undefined,
      rgba: Array.isArray(site.rgba)
        ? ([...site.rgba] as [number, number, number, number])
        : undefined,
      pos: site.pos ? toPositionObject(site.pos) : undefined,
      quat: toQuatObject(site.quat),
      group: typeof site.group === 'number' ? site.group : undefined,
    })),
    joints: (sharedBody.joints || []).map((joint: any) => ({
      name: joint.name,
      type: joint.type,
      axis: joint.axis ? toPositionObject(joint.axis) : undefined,
      range: convertJointRange(joint.range, joint.type, settings),
      ref: typeof joint.ref === 'number' ? joint.ref : undefined,
      pos: joint.pos ? toPositionObject(joint.pos) : undefined,
      limited: typeof joint.limited === 'boolean' ? joint.limited : undefined,
      damping: typeof joint.damping === 'number' ? joint.damping : undefined,
      frictionloss: typeof joint.frictionloss === 'number' ? joint.frictionloss : undefined,
      armature: typeof joint.armature === 'number' ? joint.armature : undefined,
      stiffness: typeof joint.stiffness === 'number' ? joint.stiffness : undefined,
      actuatorForceRange: joint.actuatorForceRange,
      actuatorForceLimited:
        typeof joint.actuatorForceLimited === 'boolean' ? joint.actuatorForceLimited : undefined,
    })),
    inertial: sharedBody.inertial
      ? {
          mass: sharedBody.inertial.mass,
          pos: toPositionObject(sharedBody.inertial.pos),
          quat: toQuatObject(sharedBody.inertial.quat),
          diaginertia: sharedBody.inertial.diaginertia
            ? {
                ixx: sharedBody.inertial.diaginertia[0],
                iyy: sharedBody.inertial.diaginertia[1],
                izz: sharedBody.inertial.diaginertia[2],
              }
            : undefined,
          fullinertia: sharedBody.inertial.fullinertia,
        }
      : undefined,
    children: (sharedBody.children || []).map((child: any) => toParserBody(child, settings)),
  };
}

function toParserActuatorMap(
  sharedActuatorMap: Map<string, any[]> | undefined,
): Map<string, MJCFActuator[]> {
  const actuatorMap = new Map<string, MJCFActuator[]>();
  if (!sharedActuatorMap) {
    return actuatorMap;
  }

  sharedActuatorMap.forEach((actuators, jointName) => {
    actuatorMap.set(
      jointName,
      (actuators || []).map((actuator) => ({
        name: actuator.name,
        type: actuator.type,
        joint: actuator.joint,
        ctrlrange: actuator.ctrlrange,
        forcerange: actuator.forcerange,
        gear: actuator.gear,
      })),
    );
  });

  return actuatorMap;
}

function collectSiteConstraintBindings(
  body: ParsedMJCFModel['worldBody'],
  bindings = new Map<string, MJCFSiteConstraintBinding>(),
): Map<string, MJCFSiteConstraintBinding> {
  const linkFrameOffsetLocal = resolveBodyLinkFrameOffsetLocal(body);

  (body.sites || []).forEach((site) => {
    const binding: MJCFSiteConstraintBinding = {
      bodyName: body.name,
      // MJCF sites live in the raw body frame; imported links are rebased to the
      // joint pivot when joint.pos is non-zero, so tendon anchors must follow that shift.
      anchorLocal: subtractLocalOffset(toPositionObject(site.pos), linkFrameOffsetLocal) ?? {
        x: 0,
        y: 0,
        z: 0,
      },
    };

    bindings.set(site.name, binding);
    if (site.sourceName) {
      bindings.set(site.sourceName, binding);
    }
  });

  (body.children || []).forEach((child) => collectSiteConstraintBindings(child, bindings));
  return bindings;
}

function collectBodyLinkFrameOffsets(
  body: ParsedMJCFModel['worldBody'],
  bindings = new Map<
    string,
    { linkFrameOffsetLocal: { x: number; y: number; z: number } | null }
  >(),
): Map<string, { linkFrameOffsetLocal: { x: number; y: number; z: number } | null }> {
  bindings.set(body.name, {
    linkFrameOffsetLocal: resolveBodyLinkFrameOffsetLocal(body),
  });

  (body.children || []).forEach((child) => collectBodyLinkFrameOffsets(child, bindings));
  return bindings;
}

function isFixedSpatialTendonRange(range: [number, number] | undefined): range is [number, number] {
  return !!range && Math.abs(range[1] - range[0]) <= FIXED_TENDON_RANGE_EPSILON;
}

function buildTendonDistanceClosedLoopConstraints(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId'>,
  tendonMap: ParsedMJCFModel['tendonMap'],
  worldBody: ParsedMJCFModel['worldBody'],
): RobotState['closedLoopConstraints'] {
  if (tendonMap.size === 0) {
    return undefined;
  }

  const siteBindings = collectSiteConstraintBindings(worldBody);
  if (siteBindings.size === 0) {
    return undefined;
  }

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const closedLoopConstraints = Array.from(tendonMap.values()).flatMap((tendon) => {
    if (
      tendon.type !== 'spatial' ||
      tendon.attachments.length !== 2 ||
      !isFixedSpatialTendonRange(tendon.range)
    ) {
      return [];
    }

    const [attachmentA, attachmentB] = tendon.attachments;
    if (
      attachmentA?.type !== 'site' ||
      attachmentB?.type !== 'site' ||
      !attachmentA.ref ||
      !attachmentB.ref
    ) {
      return [];
    }

    const bindingA = siteBindings.get(attachmentA.ref);
    const bindingB = siteBindings.get(attachmentB.ref);
    if (!bindingA || !bindingB) {
      return [];
    }

    const linkAId = resolveLinkKey(robot.links, bindingA.bodyName);
    const linkBId = resolveLinkKey(robot.links, bindingB.bodyName);
    if (!linkAId || !linkBId) {
      return [];
    }

    const linkAMatrix = linkWorldMatrices[linkAId];
    if (!linkAMatrix) {
      return [];
    }

    const anchorWorldVector = new THREE.Vector3(
      bindingA.anchorLocal.x,
      bindingA.anchorLocal.y,
      bindingA.anchorLocal.z,
    ).applyMatrix4(linkAMatrix);

    return [
      createRobotDistanceClosedLoopConstraint(
        `mjcf-distance-${tendon.name}`,
        linkAId,
        linkBId,
        bindingA.anchorLocal,
        bindingB.anchorLocal,
        {
          x: anchorWorldVector.x,
          y: anchorWorldVector.y,
          z: anchorWorldVector.z,
        },
        tendon.range[0],
        {
          format: 'mjcf',
          body1Name: bindingA.bodyName,
          body2Name: bindingB.bodyName,
        },
      ),
    ];
  });

  return closedLoopConstraints.length > 0 ? closedLoopConstraints : undefined;
}

function buildClosedLoopConstraints(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId'>,
  connectConstraints: MJCFModelConnectConstraint[],
  tendonMap: ParsedMJCFModel['tendonMap'],
  worldBody: ParsedMJCFModel['worldBody'],
): RobotState['closedLoopConstraints'] {
  if (connectConstraints.length === 0 && tendonMap.size === 0) {
    return undefined;
  }

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const bodyBindings = collectBodyLinkFrameOffsets(worldBody);
  const connectClosedLoopConstraints = connectConstraints.flatMap((constraint) => {
    const linkAId = resolveLinkKey(robot.links, constraint.body1);
    const linkBId = resolveLinkKey(robot.links, constraint.body2);

    if (!linkAId || !linkBId) {
      return [];
    }

    const linkAMatrix = linkWorldMatrices[linkAId];
    const linkBMatrix = linkWorldMatrices[linkBId];
    if (!linkAMatrix || !linkBMatrix) {
      return [];
    }

    const rawAnchorLocalA = {
      x: constraint.anchor[0] ?? 0,
      y: constraint.anchor[1] ?? 0,
      z: constraint.anchor[2] ?? 0,
    };
    const anchorLocalA =
      subtractLocalOffset(
        rawAnchorLocalA,
        bodyBindings.get(constraint.body1)?.linkFrameOffsetLocal ?? null,
      ) ?? rawAnchorLocalA;
    const anchorWorldVector = new THREE.Vector3(
      anchorLocalA.x,
      anchorLocalA.y,
      anchorLocalA.z,
    ).applyMatrix4(linkAMatrix);
    const anchorLocalBVector = anchorWorldVector.clone().applyMatrix4(linkBMatrix.clone().invert());

    return [
      createRobotClosedLoopConstraint(
        constraint.name || `mjcf-connect-${constraint.body1}-${constraint.body2}`,
        linkAId,
        linkBId,
        anchorLocalA,
        {
          x: anchorLocalBVector.x,
          y: anchorLocalBVector.y,
          z: anchorLocalBVector.z,
        },
        {
          x: anchorWorldVector.x,
          y: anchorWorldVector.y,
          z: anchorWorldVector.z,
        },
        {
          format: 'mjcf',
          body1Name: constraint.body1,
          body2Name: constraint.body2,
        },
      ),
    ];
  });

  const tendonClosedLoopConstraints =
    buildTendonDistanceClosedLoopConstraints(robot, tendonMap, worldBody) ?? [];
  const closedLoopConstraints = [...connectClosedLoopConstraints, ...tendonClosedLoopConstraints];

  return closedLoopConstraints.length > 0 ? closedLoopConstraints : undefined;
}

function applyJointEqualityMimics(
  robot: Pick<RobotState, 'joints'>,
  jointEqualityConstraints: MJCFModelJointEqualityConstraint[],
): void {
  jointEqualityConstraints.forEach((constraint) => {
    const joint1 = robot.joints[constraint.joint1];
    const joint2 = robot.joints[constraint.joint2];
    if (!joint1 || !joint2) {
      return;
    }

    const [, multiplier = 1, quadratic = 0, cubic = 0, quartic = 0] = constraint.polycoef;
    if (Math.abs(quadratic) > 1e-9 || Math.abs(cubic) > 1e-9 || Math.abs(quartic) > 1e-9) {
      return;
    }

    const joint1Reference = Number.isFinite(joint1.referencePosition)
      ? joint1.referencePosition!
      : 0;
    const joint2Reference = Number.isFinite(joint2.referencePosition)
      ? joint2.referencePosition!
      : 0;
    const offset = joint1Reference + constraint.polycoef[0] - multiplier * joint2Reference;

    joint1.mimic = {
      joint: joint2.id,
      multiplier,
      offset,
    };
  });
}

type MJCFQposJointKind = 'free' | 'ball' | 'scalar';

interface MJCFQposJointBinding {
  jointName: string;
  kind: MJCFQposJointKind;
  qposAddress: number;
  qposSize: number;
}

function getJointQposSize(joint: MJCFJointDef): number {
  switch (joint.type.toLowerCase()) {
    case 'free':
      return 7;
    case 'ball':
      return 4;
    case 'hinge':
    case 'slide':
      return 1;
    default:
      return 0;
  }
}

function getQposJointKind(joint: MJCFJointDef): MJCFQposJointKind {
  switch (joint.type.toLowerCase()) {
    case 'free':
      return 'free';
    case 'ball':
      return 'ball';
    default:
      return 'scalar';
  }
}

function collectQposJointBindings(
  body: MJCFBody,
  bindings: MJCFQposJointBinding[] = [],
  qposCursor = { value: 0 },
): MJCFQposJointBinding[] {
  body.joints.forEach((joint) => {
    const qposSize = getJointQposSize(joint);
    if (qposSize <= 0) {
      return;
    }

    bindings.push({
      jointName: joint.name,
      kind: getQposJointKind(joint),
      qposAddress: qposCursor.value,
      qposSize,
    });
    qposCursor.value += qposSize;
  });

  body.children.forEach((child) => collectQposJointBindings(child, bindings, qposCursor));
  return bindings;
}

function getExpectedQposLength(bindings: MJCFQposJointBinding[]): number {
  return bindings.reduce(
    (length, binding) => Math.max(length, binding.qposAddress + binding.qposSize),
    0,
  );
}

function selectInitialPoseKeyframe(
  keyframes: MJCFModelKeyframe[],
  expectedQposLength: number,
): MJCFModelKeyframe | null {
  if (expectedQposLength <= 0) {
    return null;
  }

  const usableKeyframes = keyframes.filter((keyframe) => {
    return keyframe.qpos && keyframe.qpos.length >= expectedQposLength;
  });
  return (
    usableKeyframes.find((keyframe) => keyframe.name?.trim().toLowerCase() === 'home') ??
    usableKeyframes[0] ??
    null
  );
}

function readFiniteQposValue(qpos: number[], index: number): number | null {
  const value = qpos[index];
  return Number.isFinite(value) ? value! : null;
}

function readFiniteQposQuaternion(
  qpos: number[],
  address: number,
): { w: number; x: number; y: number; z: number } | null {
  const w = readFiniteQposValue(qpos, address);
  const x = readFiniteQposValue(qpos, address + 1);
  const y = readFiniteQposValue(qpos, address + 2);
  const z = readFiniteQposValue(qpos, address + 3);
  if (w == null || x == null || y == null || z == null) {
    return null;
  }

  const length = Math.hypot(w, x, y, z);
  if (length <= 1e-12) {
    return null;
  }

  return {
    w: w / length,
    x: x / length,
    y: y / length,
    z: z / length,
  };
}

function applyInitialPoseKeyframe(
  robot: Pick<RobotState, 'joints'>,
  worldBody: MJCFBody,
  keyframes: MJCFModelKeyframe[],
): void {
  if (keyframes.length === 0) {
    return;
  }

  const qposBindings = collectQposJointBindings(worldBody);
  const keyframe = selectInitialPoseKeyframe(keyframes, getExpectedQposLength(qposBindings));
  const qpos = keyframe?.qpos;
  if (!qpos) {
    return;
  }

  qposBindings.forEach((binding) => {
    const joint = robot.joints[binding.jointName];
    if (!joint) {
      return;
    }

    if (binding.kind === 'free') {
      const x = readFiniteQposValue(qpos, binding.qposAddress);
      const y = readFiniteQposValue(qpos, binding.qposAddress + 1);
      const z = readFiniteQposValue(qpos, binding.qposAddress + 2);
      const quaternion = readFiniteQposQuaternion(qpos, binding.qposAddress + 3);
      if (x == null || y == null || z == null || !quaternion) {
        return;
      }

      joint.origin = {
        xyz: { x, y, z },
        rpy: toRPYObjectFromQuat(quaternion) ?? joint.origin.rpy,
      };
      return;
    }

    if (binding.kind === 'ball') {
      const quaternion = readFiniteQposQuaternion(qpos, binding.qposAddress);
      if (!quaternion) {
        return;
      }

      joint.quaternion = {
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w,
      };
      return;
    }

    const value = readFiniteQposValue(qpos, binding.qposAddress);
    if (value != null) {
      joint.angle = value;
    }
  });
}

function applySolvedClosedLoopInitialPose(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  actuatorMap: Map<string, MJCFActuator[]>,
): void {
  if (!robot.closedLoopConstraints || robot.closedLoopConstraints.length === 0) {
    return;
  }

  const lockedActuatedJointIds = Array.from(actuatorMap.keys()).filter((jointId) =>
    Boolean(robot.joints[jointId]),
  );
  const lockedSolution = solveClosedLoopMotionCompensation(robot, {
    lockedJointIds: lockedActuatedJointIds,
  });
  const solution =
    lockedSolution.converged || lockedActuatedJointIds.length === 0
      ? lockedSolution
      : solveClosedLoopMotionCompensation(robot);

  if (!solution.converged) {
    return;
  }

  Object.entries(solution.angles).forEach(([jointId, angle]) => {
    const joint = robot.joints[jointId];
    if (joint && Number.isFinite(angle)) {
      joint.angle = angle;
    }
  });

  Object.entries(solution.quaternions).forEach(([jointId, quaternion]) => {
    const joint = robot.joints[jointId];
    if (!joint) {
      return;
    }

    const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    if (length <= 1e-12) {
      return;
    }

    joint.quaternion = {
      x: quaternion.x / length,
      y: quaternion.y / length,
      z: quaternion.z / length,
      w: quaternion.w / length,
    };
  });
}

function refreshClosedLoopAnchorWorlds(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
): void {
  if (!robot.closedLoopConstraints || robot.closedLoopConstraints.length === 0) {
    return;
  }

  const linkWorldMatrices = computeLinkWorldMatrices(robot);

  robot.closedLoopConstraints = robot.closedLoopConstraints.map((constraint) => {
    const linkMatrix = linkWorldMatrices[constraint.linkAId];
    if (!linkMatrix) {
      return constraint;
    }

    const anchorWorld = new THREE.Vector3(
      constraint.anchorLocalA.x,
      constraint.anchorLocalA.y,
      constraint.anchorLocalA.z,
    ).applyMatrix4(linkMatrix);

    return {
      ...constraint,
      anchorWorld: {
        x: anchorWorld.x,
        y: anchorWorld.y,
        z: anchorWorld.z,
      },
    };
  });
}

function buildMjcfInspectionContext(
  parsedModel: ParsedMJCFModel,
): NonNullable<RobotState['inspectionContext']> {
  const bodiesWithSites: NonNullable<
    NonNullable<RobotState['inspectionContext']>['mjcf']
  >['bodiesWithSites'] = [];
  let siteCount = 0;

  const visitBody = (body: ParsedMJCFModel['worldBody']): void => {
    const bodySites = body.sites || [];
    if (bodySites.length > 0) {
      bodiesWithSites.push({
        bodyId: body.name,
        siteCount: bodySites.length,
        siteNames: bodySites.map((site) => site.name),
      });
      siteCount += bodySites.length;
    }

    (body.children || []).forEach(visitBody);
  };

  visitBody(parsedModel.worldBody);

  const tendonActuatorNamesByTendon = new Map<string, string[]>();
  parsedModel.tendonActuators.forEach((actuator) => {
    if (!actuator.tendon) {
      return;
    }

    const names = tendonActuatorNamesByTendon.get(actuator.tendon) || [];
    names.push(actuator.name);
    tendonActuatorNamesByTendon.set(actuator.tendon, names);
  });

  const resolveTendonVisualizationAttachmentRef = (
    attachment: MJCFModelTendonAttachment,
  ): string | undefined => {
    return attachment.ref || attachment.sidesite;
  };

  return {
    sourceFormat: 'mjcf',
    mjcf: {
      siteCount,
      tendonCount: parsedModel.tendonMap.size,
      tendonActuatorCount: parsedModel.tendonActuators.length,
      bodiesWithSites,
      tendons: Array.from(parsedModel.tendonMap.values()).map((tendon) => ({
        className: tendon.className,
        group: tendon.group,
        name: tendon.name,
        type: tendon.type,
        limited: tendon.limited,
        range: tendon.range,
        width: tendon.width,
        stiffness: tendon.stiffness,
        springlength: tendon.springlength,
        rgba: tendon.rgba,
        attachmentRefs: tendon.attachments
          .map(resolveTendonVisualizationAttachmentRef)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
        attachments: tendon.attachments.map((attachment) => ({
          type: attachment.type,
          ref: attachment.ref,
          sidesite: attachment.sidesite,
          divisor: attachment.divisor,
          coef: attachment.coef,
        })),
        actuatorNames: tendonActuatorNamesByTendon.get(tendon.name) || [],
      })),
    },
  };
}

// Convert parsed MJCF to RobotState
function mjcfToRobotState(
  robotName: string,
  bodies: MJCFBody[],
  meshMap: Map<string, MJCFMesh>,
  hfieldMap: Map<string, MJCFHfield>,
  materialMap: Map<string, MJCFMaterial>,
  textureMap: Map<string, MJCFTexture>,
  actuatorMap: Map<string, MJCFActuator[]>,
): RobotState {
  const links: Record<string, UrdfLink> = {};
  const joints: Record<string, UrdfJoint> = {};
  const materials: NonNullable<RobotState['materials']> = {};
  let rootLinkId = '';
  let linkCounter = 0;

  function resolveGeomMaterialState(
    geom: MJCFGeom,
  ): { color?: string; colorRgba?: [number, number, number, number]; texture?: string } | null {
    const materialDef = geom.material ? materialMap.get(geom.material) : undefined;
    const texturePath = materialDef?.texture
      ? textureMap.get(materialDef.texture)?.file
      : undefined;

    const explicitGeomRgba =
      geom.hasExplicitRgba && geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const materialRgba =
      materialDef?.rgba && materialDef.rgba.length >= 3 ? materialDef.rgba : undefined;
    const inheritedGeomRgba = geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const resolvedRgba = explicitGeomRgba ?? materialRgba ?? inheritedGeomRgba;
    const resolvedColor = resolvedRgba ? rgbaToHexColor(resolvedRgba) || undefined : undefined;
    const resolvedColorRgba = rgbaToColorRgbaTuple(resolvedRgba);

    // MJCF textures use white as the neutral color multiplier when rgba is absent.
    const neutralTextureColor = texturePath ? '#ffffff' : undefined;
    const color = resolvedColor ?? neutralTextureColor;

    if (!color && !texturePath) {
      return null;
    }

    return {
      ...(color ? { color } : {}),
      ...(resolvedColorRgba ? { colorRgba: resolvedColorRgba } : {}),
      ...(texturePath ? { texture: texturePath } : {}),
    };
  }

  function resolveGeomAuthoredMaterials(geom: MJCFGeom): UrdfVisual['authoredMaterials'] {
    const materialDef = geom.material ? materialMap.get(geom.material) : undefined;
    const textureDef = materialDef?.texture ? textureMap.get(materialDef.texture) : undefined;
    const cubeFaceRecord =
      geom.type?.toLowerCase() === 'box' ? getMjcfCubeTextureFaceRecord(textureDef) : null;

    const explicitGeomRgba =
      geom.hasExplicitRgba && geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const materialRgba =
      materialDef?.rgba && materialDef.rgba.length >= 3 ? materialDef.rgba : undefined;
    const inheritedGeomRgba = geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const resolvedRgba = explicitGeomRgba ?? materialRgba ?? inheritedGeomRgba;
    const sharedColor = resolvedRgba ? rgbaToHexColor(resolvedRgba) || undefined : undefined;
    const sharedColorRgba = rgbaToColorRgbaTuple(resolvedRgba);

    if (cubeFaceRecord) {
      return buildMjcfCubeAuthoredMaterials(cubeFaceRecord, sharedColor, sharedColorRgba);
    }

    const texturePath = textureDef?.file;
    if (!sharedColor && !texturePath) {
      return undefined;
    }

    return [
      {
        ...(geom.material ? { name: geom.material } : {}),
        ...(sharedColor ? { color: sharedColor } : {}),
        ...(sharedColorRgba ? { colorRgba: sharedColorRgba } : {}),
        ...(texturePath ? { texture: texturePath } : {}),
        ...(Number.isFinite(materialDef?.shininess)
          ? { roughness: Math.max(0, Math.min(1, 1 - Number(materialDef!.shininess))) }
          : {}),
        ...(Number.isFinite(materialDef?.reflectance)
          ? { metalness: Math.max(0, Math.min(1, Number(materialDef!.reflectance))) }
          : {}),
        ...(Number.isFinite(materialDef?.emission) && sharedColor
          ? {
              emissive: sharedColor,
              emissiveIntensity: Math.max(0, Number(materialDef!.emission)),
            }
          : {}),
      },
    ];
  }

  function assignLinkMaterial(linkId: string, geom: MJCFGeom | null | undefined): void {
    if (!geom) {
      return;
    }

    const materialState = resolveGeomMaterialState(geom);
    if (!materialState) {
      return;
    }

    materials[linkId] = materialState;
  }

  function buildImplicitFixedJointId(parentLinkId: string, childLinkId: string): string {
    const baseId = `${parentLinkId}_to_${childLinkId}`;
    let candidate = baseId;
    let suffix = 2;

    while (joints[candidate]) {
      candidate = `${baseId}_${suffix++}`;
    }

    return candidate;
  }

  function processGeometry(
    geom: MJCFGeom,
    linkFrameOffsetLocal: { x: number; y: number; z: number } | null = null,
  ): UrdfVisual {
    const result: UrdfVisual = { ...DEFAULT_LINK.visual };
    if (geom.name?.trim()) {
      result.name = geom.name.trim();
    }
    const convertedType = convertGeomType(geom.type);
    const hasExplicitPrimitiveParams = Boolean(
      (geom.size && geom.size.length > 0) || (geom.fromto && geom.fromto.length >= 6),
    );
    const isMeshBackedPrimitiveWithoutResolvedFit = Boolean(
      geom.mesh &&
      !hasExplicitPrimitiveParams &&
      (convertedType === GeometryType.BOX ||
        convertedType === GeometryType.SPHERE ||
        convertedType === GeometryType.PLANE ||
        convertedType === GeometryType.ELLIPSOID ||
        convertedType === GeometryType.CYLINDER ||
        convertedType === GeometryType.CAPSULE),
    );
    result.type =
      convertedType === GeometryType.NONE && geom.mesh
        ? GeometryType.MESH
        : isMeshBackedPrimitiveWithoutResolvedFit
          ? GeometryType.MESH
          : convertedType;

    if (geom.mesh && meshMap.has(geom.mesh)) {
      const meshDef = meshMap.get(geom.mesh)!;
      result.mjcfMesh = cloneMjcfMeshAsset(meshDef);
      if (meshDef.file) {
        result.meshPath = meshDef.file;
      } else {
        result.assetRef = geom.mesh;
      }
      const scale = meshDef.scale;
      if (scale && scale.length >= 3) {
        result.dimensions = { x: scale[0], y: scale[1], z: scale[2] };
      } else {
        result.dimensions = { x: 1, y: 1, z: 1 };
      }
    } else if (geom.mesh) {
      result.meshPath = geom.mesh;
      result.dimensions = { x: 1, y: 1, z: 1 };
    }

    if (result.type === GeometryType.HFIELD) {
      result.assetRef = geom.hfield;
      const hfieldAsset = geom.hfield ? hfieldMap.get(geom.hfield) : undefined;
      if (hfieldAsset) {
        result.mjcfHfield = {
          name: hfieldAsset.name,
          file: hfieldAsset.file,
          contentType: hfieldAsset.contentType,
          nrow: hfieldAsset.nrow,
          ncol: hfieldAsset.ncol,
          size: hfieldAsset.size
            ? {
                radiusX: hfieldAsset.size[0] ?? 0,
                radiusY: hfieldAsset.size[1] ?? 0,
                elevationZ: hfieldAsset.size[2] ?? 0,
                baseZ: hfieldAsset.size[3] ?? 0,
              }
            : undefined,
          elevation: hfieldAsset.elevation ? [...hfieldAsset.elevation] : undefined,
        };
      }
    } else if (result.type === GeometryType.SDF) {
      result.assetRef = geom.mesh;
    }

    if (geom.size && geom.size.length > 0) {
      const geomType = geom.type?.toLowerCase() || 'sphere';
      switch (geomType) {
        case 'box':
          result.dimensions = {
            x: (geom.size[0] || 0.1) * 2,
            y: ((geom.size[1] ?? geom.size[0]) || 0.1) * 2,
            z: ((geom.size[2] ?? geom.size[0]) || 0.1) * 2,
          };
          break;
        case 'sphere':
          result.dimensions = { x: geom.size[0] || 0.1, y: 0, z: 0 };
          break;
        case 'plane':
          result.dimensions = {
            x: ((geom.size[0] ?? 1) || 1) * 2,
            y: ((geom.size[1] ?? geom.size[0] ?? 1) || 1) * 2,
            z: 0,
          };
          break;
        case 'ellipsoid':
          result.dimensions = {
            x: geom.size[0] || 0.1,
            y: (geom.size[1] ?? geom.size[0]) || 0.1,
            z: (geom.size[2] ?? geom.size[0]) || 0.1,
          };
          break;
        case 'cylinder':
        case 'capsule':
          result.dimensions = {
            x: geom.size[0] || 0.1,
            y: (geom.size[1] || 0.1) * 2,
            z: 0,
          };
          break;
        case 'hfield':
          result.dimensions = buildHfieldDimensions(
            geom.hfield ? hfieldMap.get(geom.hfield) : undefined,
            geom.size,
          );
          break;
        case 'sdf':
          result.dimensions = {
            x: geom.size[0] || 1,
            y: (geom.size[1] ?? geom.size[0]) || 1,
            z: (geom.size[2] ?? 0) || 0,
          };
          break;
        default:
          result.dimensions = { x: geom.size[0] || 0.1, y: 0, z: 0 };
          break;
      }
    } else if (!geom.mesh) {
      switch (result.type) {
        case GeometryType.PLANE:
          result.dimensions = { x: 2, y: 2, z: 0 };
          break;
        case GeometryType.HFIELD:
          result.dimensions = buildHfieldDimensions(
            geom.hfield ? hfieldMap.get(geom.hfield) : undefined,
            geom.size,
          );
          break;
        case GeometryType.SDF:
          result.dimensions = { x: 1, y: 1, z: 0 };
          break;
        default:
          result.dimensions = { x: 0.05, y: 0, z: 0 };
          break;
      }
    }

    const materialState = resolveGeomMaterialState(geom);
    if (materialState?.color) {
      result.color = materialState.color;
    }
    const authoredMaterials = resolveGeomAuthoredMaterials(geom);
    if (authoredMaterials && authoredMaterials.length > 0) {
      result.authoredMaterials = authoredMaterials;
    }

    const geomRotation = toRPYObjectFromQuat(geom.quat);
    const hasMeaningfulRotation =
      !!geomRotation &&
      (Math.abs(geomRotation.r) > 1e-9 ||
        Math.abs(geomRotation.p) > 1e-9 ||
        Math.abs(geomRotation.y) > 1e-9);
    const geomPosition = subtractLocalOffset(geom.pos, linkFrameOffsetLocal);

    if (geomPosition || hasMeaningfulRotation) {
      result.origin = {
        xyz: {
          x: geomPosition?.x ?? 0,
          y: geomPosition?.y ?? 0,
          z: geomPosition?.z ?? 0,
        },
        rpy: geomRotation || { r: 0, p: 0, y: 0 },
      };
    }

    return result;
  }

  function processBody(body: MJCFBody, parentLinkId: string | null): string {
    const mainLinkId = body.name || `link_${linkCounter++}`;
    const bodyRotation = toRPYObjectFromQuat(body.quat) || body.euler || { r: 0, p: 0, y: 0 };
    const mjcfJoint = body.joints[0];
    const linkFrameOffsetLocal = isNonZeroPosition(mjcfJoint?.pos)
      ? {
          x: mjcfJoint!.pos!.x,
          y: mjcfJoint!.pos!.y,
          z: mjcfJoint!.pos!.z,
        }
      : null;
    const jointFrameOffsetInParent = rotateLocalOffsetToParentFrame(
      linkFrameOffsetLocal,
      bodyRotation,
    );

    // 1. Classify Geoms
    const visuals: MJCFGeom[] = [];
    const collisions: MJCFGeom[] = [];
    const geomRoles = assignMJCFBodyGeomRoles(body.geoms);

    geomRoles.forEach(({ geom, renderVisual, renderCollision }) => {
      if (renderVisual) {
        visuals.push(geom);
      }
      if (renderCollision) {
        collisions.push(geom);
      }
    });

    // 2. Pair Visuals and Collisions
    const pairs: MJCFLinkPair[] = [];
    const usedCollisions = new Set<MJCFGeom>();

    // Pass 1: Match visuals to collisions (by mesh name match)
    for (const vis of visuals) {
      // Plain MuJoCo geoms often act as both visual and collision. Once such a geom has
      // already been consumed as the collision partner for an earlier visual geom, emitting
      // it again as a standalone visual creates the exact regression seen on HighTorque:
      // a base-link collision box gets duplicated into the visual tree.
      const visClassification = classifyMJCFGeom(vis);
      if (visClassification.isCollision && usedCollisions.has(vis)) {
        continue;
      }

      let matchIndex = -1;
      if (vis.mesh) {
        matchIndex = collisions.findIndex((c) => c.mesh === vis.mesh && !usedCollisions.has(c));
      } else if (vis.name) {
        matchIndex = collisions.findIndex((c) => c.name === vis.name && !usedCollisions.has(c));
      }

      // Fallback for Main Link (index 0): if no strict match, grab first available collision
      // Only if this is the very first visual we are processing for the body
      if (
        matchIndex === -1 &&
        pairs.length === 0 &&
        collisions.length > 0 &&
        !usedCollisions.has(collisions[0])
      ) {
        // Check if collision[0] is also nameless/meshless or generically compatible?
        // For G1: torso (mesh) matches torso (mesh).
        // For simple models, often 1 vis 1 col.
        matchIndex = 0;
      }

      let col: MJCFGeom | null = null;
      if (matchIndex !== -1) {
        col = collisions[matchIndex];
        usedCollisions.add(col);
      }
      pairs.push({ visual: vis, collision: col });
    }

    // Pass 2: Remaining collisions (create collision-only links)
    for (const col of collisions) {
      if (!usedCollisions.has(col)) {
        pairs.push({ visual: null, collision: col });
      }
    }

    // 3. Create Links
    // If no pairs (empty body), create a dummy pair to generate the link
    if (pairs.length === 0) {
      pairs.push({ visual: null, collision: null });
    }

    // Process Main Link (Index 0)
    const mainPair = pairs[0];

    let visual: UrdfVisual = { ...DEFAULT_LINK.visual };
    if (mainPair.visual) {
      visual = processGeometry(mainPair.visual, linkFrameOffsetLocal);
      assignLinkMaterial(mainLinkId, mainPair.visual);
    } else {
      visual.type = GeometryType.NONE;
    }

    let collision: UrdfVisual = { ...DEFAULT_LINK.collision };
    if (mainPair.collision) {
      const colGeo = processGeometry(mainPair.collision, linkFrameOffsetLocal);
      collision = {
        ...collision,
        ...(mainPair.collision.name?.trim() ? { name: mainPair.collision.name.trim() } : {}),
        type: colGeo.type,
        dimensions: colGeo.dimensions,
        origin: colGeo.origin,
        meshPath: colGeo.meshPath,
        assetRef: colGeo.assetRef,
        mjcfMesh: colGeo.mjcfMesh,
        mjcfHfield: colGeo.mjcfHfield,
      };
      if (colGeo.color) {
        collision.color = colGeo.color;
      }
    } else {
      collision.type = GeometryType.NONE;
    }

    let linkInertial = createEmptyLinkInertial();

    if (body.inertial) {
      const {
        mass,
        pos: inertialPos,
        quat: inertialQuat,
        diaginertia,
        fullinertia,
      } = body.inertial;
      const linkInertialPos = subtractLocalOffset(inertialPos, linkFrameOffsetLocal) || {
        x: 0,
        y: 0,
        z: 0,
      };
      linkInertial.mass = mass;
      linkInertial.origin = {
        xyz: { x: linkInertialPos.x, y: linkInertialPos.y, z: linkInertialPos.z },
        rpy: toRPYObjectFromQuat(inertialQuat) || { r: 0, p: 0, y: 0 },
      };
      if (fullinertia && fullinertia.length >= 6) {
        linkInertial.inertia = {
          ixx: fullinertia[0],
          iyy: fullinertia[1],
          izz: fullinertia[2],
          ixy: fullinertia[3],
          ixz: fullinertia[4],
          iyz: fullinertia[5],
        };
      } else if (diaginertia) {
        linkInertial.inertia = {
          ixx: diaginertia.ixx,
          ixy: 0,
          ixz: 0,
          iyy: diaginertia.iyy,
          iyz: 0,
          izz: diaginertia.izz,
        };
      }
    } else {
      const derivedGeomMassInertial = deriveGeomMassInertial(body.geoms);
      if (derivedGeomMassInertial) {
        if (linkFrameOffsetLocal && derivedGeomMassInertial.origin) {
          derivedGeomMassInertial.origin.xyz = subtractLocalOffset(
            derivedGeomMassInertial.origin.xyz,
            linkFrameOffsetLocal,
          ) || { x: 0, y: 0, z: 0 };
        }
        linkInertial = derivedGeomMassInertial;
      }
    }

    const mjcfSites = (body.sites || []).map((site): UrdfMjcfSite => {
      const rebasedPosition = subtractLocalOffset(site.pos, linkFrameOffsetLocal);

      return {
        name: site.name,
        ...(site.sourceName ? { sourceName: site.sourceName } : {}),
        type: site.type,
        ...(Array.isArray(site.size) ? { size: [...site.size] } : {}),
        ...(Array.isArray(site.rgba)
          ? { rgba: [...site.rgba] as [number, number, number, number] }
          : {}),
        ...(rebasedPosition
          ? {
              pos: [rebasedPosition.x, rebasedPosition.y, rebasedPosition.z] as [
                number,
                number,
                number,
              ],
            }
          : {}),
        ...(site.quat
          ? {
              quat: [site.quat.w, site.quat.x, site.quat.y, site.quat.z] as [
                number,
                number,
                number,
                number,
              ],
            }
          : {}),
        ...(typeof site.group === 'number' ? { group: site.group } : {}),
      };
    });

    const mainLink: UrdfLink = {
      ...DEFAULT_LINK,
      id: mainLinkId,
      name: body.name,
      visual,
      collision,
      inertial: linkInertial,
      ...(mjcfSites.length > 0 ? { mjcfSites } : {}),
    };
    links[mainLinkId] = mainLink;

    // Create Main Joint
    if (parentLinkId) {
      const jointId = mjcfJoint?.name || buildImplicitFixedJointId(parentLinkId, mainLinkId);
      const jointType = mjcfJoint
        ? convertJointType(mjcfJoint.type, mjcfJoint.range, mjcfJoint.limited)
        : JointType.FIXED;
      const jointMechanicalRange = resolveJointMechanicalRange(mjcfJoint, jointType);
      const jointEffort = resolveJointEffortLimit(mjcfJoint, actuatorMap.get(jointId));
      const jointLimit = buildImportedJointLimit(jointType, jointMechanicalRange, jointEffort, 0);
      const jointInitialAngle = resolveJointInitialAngle(mjcfJoint, jointType);
      const jointOrigin = {
        xyz: {
          x: body.pos.x + (jointFrameOffsetInParent?.x ?? 0),
          y: body.pos.y + (jointFrameOffsetInParent?.y ?? 0),
          z: body.pos.z + (jointFrameOffsetInParent?.z ?? 0),
        },
        rpy: bodyRotation,
      };
      const joint: UrdfJoint = {
        ...DEFAULT_JOINT,
        id: jointId,
        name: jointId,
        type: jointType,
        parentLinkId: parentLinkId,
        childLinkId: mainLinkId,
        origin: jointOrigin,
        axis: mjcfJoint?.axis || { x: 0, y: 0, z: 1 },
        limit: jointLimit as UrdfJoint['limit'],
        dynamics: {
          ...DEFAULT_JOINT.dynamics,
          damping: mjcfJoint?.damping ?? DEFAULT_JOINT.dynamics.damping,
          friction: mjcfJoint?.frictionloss ?? DEFAULT_JOINT.dynamics.friction,
          ...(typeof mjcfJoint?.stiffness === 'number' ? { stiffness: mjcfJoint.stiffness } : {}),
        },
        ...(jointInitialAngle != null ? { referencePosition: jointInitialAngle } : {}),
        ...(jointInitialAngle != null ? { angle: jointInitialAngle } : {}),
        hardware: {
          ...DEFAULT_JOINT.hardware,
          armature: mjcfJoint?.armature ?? DEFAULT_JOINT.hardware.armature,
        },
      };
      joints[jointId] = joint;
    } else {
      rootLinkId = mainLinkId;
    }

    // Process remaining pairs (Pairs 1..N)
    for (let i = 1; i < pairs.length; i++) {
      const pair = pairs[i];

      // Preserve additional collision-only geoms on the same link. The rest of the stack
      // already understands `collisionBodies`, so emitting synthetic links here only makes
      // URDF exports drift away from the source MJCF topology.
      if (!pair.visual && pair.collision) {
        const colGeo = processGeometry(pair.collision, linkFrameOffsetLocal);
        const extraCollision: UrdfLink['collision'] = {
          ...DEFAULT_LINK.collision,
          ...(pair.collision.name?.trim() ? { name: pair.collision.name.trim() } : {}),
          type: colGeo.type,
          dimensions: colGeo.dimensions,
          origin: colGeo.origin,
          meshPath: colGeo.meshPath,
          assetRef: colGeo.assetRef,
          mjcfMesh: colGeo.mjcfMesh,
          mjcfHfield: colGeo.mjcfHfield,
        };

        if (colGeo.color) {
          extraCollision.color = colGeo.color;
        }

        mainLink.collisionBodies = [...(mainLink.collisionBodies || []), extraCollision];
        continue;
      }

      if (pair.visual) {
        const extraVisual = processGeometry(pair.visual, linkFrameOffsetLocal);
        mainLink.visualBodies = [...(mainLink.visualBodies || []), extraVisual];
      }

      if (pair.collision) {
        const colGeo = processGeometry(pair.collision, linkFrameOffsetLocal);
        const extraCollision: UrdfLink['collision'] = {
          ...DEFAULT_LINK.collision,
          ...(pair.collision.name?.trim() ? { name: pair.collision.name.trim() } : {}),
          type: colGeo.type,
          dimensions: colGeo.dimensions,
          origin: colGeo.origin,
          meshPath: colGeo.meshPath,
          assetRef: colGeo.assetRef,
          mjcfMesh: colGeo.mjcfMesh,
          mjcfHfield: colGeo.mjcfHfield,
        };
        if (colGeo.color) {
          extraCollision.color = colGeo.color;
        }

        mainLink.collisionBodies = [...(mainLink.collisionBodies || []), extraCollision];
      }
    }

    body.children.forEach((child) => processBody(child, mainLinkId));
    return mainLinkId;
  }

  bodies.forEach((body, index) => {
    const linkId = processBody(body, index === 0 ? null : rootLinkId);
    if (index === 0) rootLinkId = linkId;
  });

  if (!rootLinkId) {
    rootLinkId = 'base_link';
    links[rootLinkId] = { ...DEFAULT_LINK, id: rootLinkId, name: 'base_link' };
  }

  return {
    name: robotName,
    links,
    joints,
    rootLinkId,
    ...(Object.keys(materials).length > 0 ? { materials } : {}),
    selection: { type: 'link', id: rootLinkId },
  };
}

export function parseMJCF(xmlContent: string): RobotState | null {
  try {
    const parsedModel = parseMJCFModel(xmlContent);
    if (!parsedModel) {
      return null;
    }

    const parserModelWorldBody = normalizeMultiJointBodies(parsedModel.worldBody);
    const worldBody = toParserBody(parserModelWorldBody, parsedModel.compilerSettings);
    const rootBodies = shouldPreserveSyntheticWorldRoot(worldBody)
      ? [worldBody]
      : worldBody.children;

    const robot = mjcfToRobotState(
      parsedModel.modelName,
      rootBodies,
      parsedModel.meshMap,
      parsedModel.hfieldMap,
      parsedModel.materialMap,
      parsedModel.textureMap,
      toParserActuatorMap(parsedModel.actuatorMap),
    );

    applyJointEqualityMimics(robot, parsedModel.jointEqualityConstraints);
    robot.closedLoopConstraints = buildClosedLoopConstraints(
      robot,
      parsedModel.connectConstraints,
      parsedModel.tendonMap,
      parserModelWorldBody,
    );
    applyInitialPoseKeyframe(robot, worldBody, parsedModel.keyframes);
    applySolvedClosedLoopInitialPose(robot, parsedModel.actuatorMap);
    refreshClosedLoopAnchorWorlds(robot);
    robot.inspectionContext = buildMjcfInspectionContext(parsedModel);
    return robot;
  } finally {
    // The parsed model cache is only needed within a single top-level parse
    // call; retaining entire MJCF model trees across file switches keeps
    // old robots alive in memory for no runtime benefit.
    clearParsedMJCFModelCache(xmlContent);
  }
}

export function isMJCF(xmlContent: string): boolean {
  return looksLikeMJCFDocument(xmlContent);
}
