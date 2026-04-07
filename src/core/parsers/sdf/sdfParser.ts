import * as THREE from 'three';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotClosedLoopConstraint,
  type Euler,
  type RobotMaterialState,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
  type UrdfVisual,
  type UrdfVisualMaterial,
  type Vector3,
} from '@/types';
import { resolveGazeboScriptMaterial } from './gazeboMaterialScripts';
import { resolveSdfIncludeSource } from './sdfIncludeResolution';

type Pose = { xyz: Vector3; rpy: Euler };
type ParsedPose = { pose: Pose; relativeTo: string | null; specified: boolean };

const ZERO_VECTOR: Vector3 = { x: 0, y: 0, z: 0 };
const ZERO_EULER: Euler = { r: 0, p: 0, y: 0 };
const IDENTITY_POSE: Pose = { xyz: ZERO_VECTOR, rpy: ZERO_EULER };
const IDENTITY_SCALE = new THREE.Vector3(1, 1, 1);
const MODEL_FRAME = '__model__';
const WORLD_FRAME = 'world';

const GAZEBO_COLORS: Record<string, string> = {
  'Gazebo/Black': '#000000',
  'Gazebo/Blue': '#0000FF',
  'Gazebo/Green': '#00FF00',
  'Gazebo/Red': '#FF0000',
  'Gazebo/White': '#FFFFFF',
  'Gazebo/Yellow': '#FFFF00',
  'Gazebo/Grey': '#808080',
  'Gazebo/DarkGrey': '#333333',
  'Gazebo/LightGrey': '#CCCCCC',
  'Gazebo/Orange': '#FFA500',
  'Gazebo/Purple': '#800080',
  'Gazebo/Turquoise': '#40E0D0',
  'Gazebo/Gold': '#FFD700',
  'Gazebo/Indigo': '#4B0082',
  'Gazebo/SkyBlue': '#87CEEB',
  'Gazebo/Wood': '#8B4513',
  'Gazebo/FlatBlack': '#000000',
};

interface ParsedMaterialDefinition {
  color?: string;
  texture?: string;
  materialSource?: UrdfVisual['materialSource'];
  authoredMaterials?: UrdfVisualMaterial[];
}

interface ParsedSdfGeometry {
  type: GeometryType;
  dimensions: Vector3;
  meshPath?: string;
}

interface ParsedSdfVisual {
  name: string;
  geometry: ParsedSdfGeometry;
  pose: Pose;
  color?: string;
  texture?: string;
  materialSource?: UrdfVisual['materialSource'];
  authoredMaterials?: UrdfVisualMaterial[];
}

interface ParsedSdfCollision {
  geometry: ParsedSdfGeometry;
  pose: Pose;
}

interface ParsedSdfLinkRecord {
  parsedPose: ParsedPose;
  pose: Pose;
  worldMatrix: THREE.Matrix4;
}

interface ParsedSdfJointRecord {
  joint: UrdfJoint;
  worldMatrix: THREE.Matrix4;
}

interface ParsedSdfGraph {
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  materials: Record<string, RobotMaterialState>;
  linkRecords: Map<string, ParsedSdfLinkRecord>;
  jointRecords: Map<string, ParsedSdfJointRecord>;
}

export interface ParseSDFOptions {
  allFileContents?: Record<string, string>;
  sourcePath?: string | null;
}

interface ParseSdfModelOptions extends ParseSDFOptions {
  parentMatrix?: THREE.Matrix4;
  namespacePrefix?: string;
  includeStack?: Set<string>;
}

const AXIS_IMPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
  JointType.PLANAR,
]);

const LIMIT_IMPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

function isElementNode(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === 1;
}

function getDirectChildElements(parent: Element, tagName?: string): Element[] {
  return Array.from(parent.childNodes)
    .filter(isElementNode)
    .filter((child) => !tagName || child.tagName === tagName);
}

function getFirstDirectChild(parent: Element, tagName: string): Element | null {
  return getDirectChildElements(parent, tagName)[0] ?? null;
}

function parseFloatSafe(value: string | null | undefined, fallback = 0): number {
  if (value == null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberTuple(text: string | null | undefined): number[] {
  return (text ?? '')
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
}

function parseVec3(text: string | null | undefined): Vector3 {
  const [x = 0, y = 0, z = 0] = parseNumberTuple(text);
  return { x, y, z };
}

function parseRPY(text: string | null | undefined): Euler {
  const [r = 0, p = 0, y = 0] = parseNumberTuple(text);
  return { r, p, y };
}

function parsePoseText(text: string | null | undefined): Pose {
  const [x = 0, y = 0, z = 0, r = 0, p = 0, yaw = 0] = parseNumberTuple(text);
  return {
    xyz: { x, y, z },
    rpy: { r, p, y: yaw },
  };
}

function parsePoseElement(parent: Element): ParsedPose {
  const poseEl = getFirstDirectChild(parent, 'pose');
  if (!poseEl) {
    return {
      pose: IDENTITY_POSE,
      relativeTo: null,
      specified: false,
    };
  }

  return {
    pose: parsePoseText(poseEl.textContent),
    relativeTo: poseEl.getAttribute('relative_to')?.trim() || null,
    specified: true,
  };
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

function rgbaTextToHex(text: string | null | undefined): string | undefined {
  const [r, g, b] = parseNumberTuple(text);
  if (![r, g, b].every((value) => Number.isFinite(value))) {
    return undefined;
  }

  const toByte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  return `#${[toByte(r), toByte(g), toByte(b)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function parseSdfMaterial(
  visualEl: Element,
  { allFileContents = {}, sourcePath }: ParseSDFOptions = {},
): ParsedMaterialDefinition {
  const materialEl = getFirstDirectChild(visualEl, 'material');
  if (!materialEl) {
    return {};
  }

  const scriptEl = getFirstDirectChild(materialEl, 'script');
  const scriptName = getFirstDirectChild(scriptEl ?? materialEl, 'name')?.textContent?.trim() || '';
  const scriptUris = getDirectChildElements(scriptEl ?? materialEl, 'uri')
    .map((uriEl) => uriEl.textContent?.trim() || '')
    .filter(Boolean);
  const diffuse = rgbaTextToHex(getFirstDirectChild(materialEl, 'diffuse')?.textContent);
  const ambient = rgbaTextToHex(getFirstDirectChild(materialEl, 'ambient')?.textContent);
  if (scriptName && GAZEBO_COLORS[scriptName]) {
    return {
      color: GAZEBO_COLORS[scriptName],
      materialSource: 'gazebo',
      authoredMaterials: [{ name: scriptName, color: GAZEBO_COLORS[scriptName] }],
    };
  }

  if (scriptName) {
    const scriptMaterial = resolveGazeboScriptMaterial({
      allFileContents,
      scriptName,
      scriptUris,
      sourcePath: sourcePath ?? undefined,
    });
    if (scriptMaterial) {
      return {
        ...(scriptMaterial.color || diffuse || ambient
          ? { color: scriptMaterial.color || diffuse || ambient }
          : {}),
        ...(scriptMaterial.texture ? { texture: scriptMaterial.texture } : {}),
        materialSource: 'gazebo',
        authoredMaterials: [
          {
            ...scriptMaterial,
            ...(scriptMaterial.color || diffuse || ambient
              ? { color: scriptMaterial.color || diffuse || ambient }
              : {}),
          },
        ],
      };
    }
  }

  if (diffuse) {
    return {
      color: diffuse,
      materialSource: 'inline',
      authoredMaterials: [{ color: diffuse }],
    };
  }

  return ambient
    ? {
        color: ambient,
        materialSource: 'inline',
        authoredMaterials: [{ color: ambient }],
      }
    : {};
}

function parseSdfGeometry(
  geometryEl: Element | null,
  defaultGeometry: UrdfLink['visual'],
): ParsedSdfGeometry {
  if (!geometryEl) {
    return {
      type: defaultGeometry.type,
      dimensions: { ...defaultGeometry.dimensions },
      ...(defaultGeometry.meshPath ? { meshPath: defaultGeometry.meshPath } : {}),
    };
  }

  const boxEl = getFirstDirectChild(geometryEl, 'box');
  if (boxEl) {
    return {
      type: GeometryType.BOX,
      dimensions: parseVec3(getFirstDirectChild(boxEl, 'size')?.textContent),
    };
  }

  const cylinderEl = getFirstDirectChild(geometryEl, 'cylinder');
  if (cylinderEl) {
    return {
      type: GeometryType.CYLINDER,
      dimensions: {
        x: parseFloatSafe(getFirstDirectChild(cylinderEl, 'radius')?.textContent, 0.1),
        y: parseFloatSafe(getFirstDirectChild(cylinderEl, 'length')?.textContent, 0.5),
        z: 0,
      },
    };
  }

  const sphereEl = getFirstDirectChild(geometryEl, 'sphere');
  if (sphereEl) {
    return {
      type: GeometryType.SPHERE,
      dimensions: {
        x: parseFloatSafe(getFirstDirectChild(sphereEl, 'radius')?.textContent, 0.1),
        y: 0,
        z: 0,
      },
    };
  }

  const capsuleEl = getFirstDirectChild(geometryEl, 'capsule');
  if (capsuleEl) {
    return {
      type: GeometryType.CAPSULE,
      dimensions: {
        x: parseFloatSafe(getFirstDirectChild(capsuleEl, 'radius')?.textContent, 0.1),
        y: parseFloatSafe(getFirstDirectChild(capsuleEl, 'length')?.textContent, 0.5),
        z: 0,
      },
    };
  }

  const meshEl = getFirstDirectChild(geometryEl, 'mesh');
  if (meshEl) {
    const scale = parseVec3(getFirstDirectChild(meshEl, 'scale')?.textContent);
    const normalizedScale = isIdentityPose({ xyz: scale, rpy: ZERO_EULER })
      ? { x: 1, y: 1, z: 1 }
      : scale;

    return {
      type: GeometryType.MESH,
      dimensions: normalizedScale,
      meshPath: getFirstDirectChild(meshEl, 'uri')?.textContent?.trim() || '',
    };
  }

  return {
    type: GeometryType.NONE,
    dimensions: { x: 0, y: 0, z: 0 },
  };
}

function qualifyScopedName(name: string | null | undefined, namespacePrefix?: string): string {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    return '';
  }

  return namespacePrefix ? `${namespacePrefix}::${normalizedName}` : normalizedName;
}

function qualifyScopedReference(name: string | null | undefined, namespacePrefix?: string): string {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    return '';
  }

  if (
    normalizedName === MODEL_FRAME ||
    normalizedName === WORLD_FRAME ||
    normalizedName.includes('::')
  ) {
    return normalizedName;
  }

  return qualifyScopedName(normalizedName, namespacePrefix);
}

function resolvePoseWorldMatrix(
  pose: ParsedPose,
  defaultFrame: string,
  resolveFrameWorldMatrix: (frame: string) => THREE.Matrix4,
): THREE.Matrix4 {
  const baseFrame = pose.relativeTo || defaultFrame;
  const baseMatrix = resolveFrameWorldMatrix(baseFrame);

  if (!pose.specified) {
    return baseMatrix.clone();
  }

  return baseMatrix.clone().multiply(poseToMatrix(pose.pose));
}

function resolvePoseRelativeToFrame(
  pose: ParsedPose,
  defaultFrame: string,
  targetFrame: string,
  resolveFrameWorldMatrix: (frame: string) => THREE.Matrix4,
): Pose {
  const targetMatrix = resolveFrameWorldMatrix(targetFrame);
  const worldMatrix = resolvePoseWorldMatrix(pose, defaultFrame, resolveFrameWorldMatrix);
  return matrixToPose(targetMatrix.clone().invert().multiply(worldMatrix));
}

function mapSdfJointType(rawType: string | null): JointType {
  switch ((rawType || '').trim().toLowerCase()) {
    case 'revolute':
      return JointType.REVOLUTE;
    case 'continuous':
      return JointType.CONTINUOUS;
    case 'prismatic':
      return JointType.PRISMATIC;
    case 'ball':
      return JointType.BALL;
    case 'planar':
      return JointType.PLANAR;
    case 'fixed':
    default:
      return JointType.FIXED;
  }
}

function createEmptyLink(id: string, name = id): UrdfLink {
  return {
    ...DEFAULT_LINK,
    id,
    name,
    visible: true,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      origin: IDENTITY_POSE,
    },
    visualBodies: [],
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      origin: IDENTITY_POSE,
    },
    collisionBodies: [],
    inertial: {
      ...DEFAULT_LINK.inertial,
      mass: 0,
      origin: IDENTITY_POSE,
    },
  };
}

function createFixedJoint(
  id: string,
  parentLinkId: string,
  childLinkId: string,
  origin: Pose,
): UrdfJoint {
  return {
    ...DEFAULT_JOINT,
    id,
    name: id,
    type: JointType.FIXED,
    parentLinkId,
    childLinkId,
    origin,
    axis: undefined,
    limit: undefined,
    dynamics: { damping: 0, friction: 0 },
    hardware: {
      armature: 0,
      brand: '',
      motorType: 'None',
      motorId: '',
      motorDirection: 1,
    },
  };
}

class LinkDisjointSet {
  private readonly parent = new Map<string, string>();

  constructor(linkIds: Iterable<string>) {
    for (const linkId of linkIds) {
      this.parent.set(linkId, linkId);
    }
  }

  find(linkId: string): string {
    const directParent = this.parent.get(linkId);
    if (!directParent || directParent === linkId) {
      return linkId;
    }

    const root = this.find(directParent);
    this.parent.set(linkId, root);
    return root;
  }

  union(linkAId: string, linkBId: string): void {
    const rootA = this.find(linkAId);
    const rootB = this.find(linkBId);
    if (rootA !== rootB) {
      this.parent.set(rootA, rootB);
    }
  }
}

function buildSyntheticJointStageName(linkId: string, stageIndex: number): string {
  return `${linkId}__joint_stage_${stageIndex}`;
}

function extractTranslation(matrix: THREE.Matrix4): Vector3 {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return { x: position.x, y: position.y, z: position.z };
}

function buildClosedLoopConstraintFromSdfJoint(
  jointId: string,
  joint: UrdfJoint,
  graph: ParsedSdfGraph,
): RobotClosedLoopConstraint | null {
  if (joint.type !== JointType.BALL || !joint.parentLinkId || !joint.childLinkId) {
    return null;
  }

  const parentWorldMatrix = graph.linkRecords.get(joint.parentLinkId)?.worldMatrix;
  const childWorldMatrix = graph.linkRecords.get(joint.childLinkId)?.worldMatrix;
  if (!parentWorldMatrix || !childWorldMatrix) {
    return null;
  }

  const jointWorldMatrix =
    graph.jointRecords.get(jointId)?.worldMatrix ??
    parentWorldMatrix.clone().multiply(poseToMatrix(joint.origin));

  return {
    id: jointId,
    type: 'connect',
    linkAId: joint.parentLinkId,
    linkBId: joint.childLinkId,
    anchorWorld: extractTranslation(jointWorldMatrix),
    anchorLocalA: extractTranslation(
      parentWorldMatrix.clone().invert().multiply(jointWorldMatrix.clone()),
    ),
    anchorLocalB: extractTranslation(
      childWorldMatrix.clone().invert().multiply(jointWorldMatrix.clone()),
    ),
  };
}

function selectTreeJointsAndClosedLoops(graph: ParsedSdfGraph): {
  joints: Record<string, UrdfJoint>;
  closedLoopConstraints?: RobotClosedLoopConstraint[];
} {
  const selectedJoints: Record<string, UrdfJoint> = {};
  const closedLoopConstraints: RobotClosedLoopConstraint[] = [];
  const childLinkIds = new Set<string>();
  const disjointSet = new LinkDisjointSet(Object.keys(graph.links));

  Object.entries(graph.joints).forEach(([jointId, joint]) => {
    const parentLinkId = joint.parentLinkId;
    const childLinkId = joint.childLinkId;

    if (!graph.links[childLinkId]) {
      return;
    }

    if (!parentLinkId || !graph.links[parentLinkId]) {
      selectedJoints[jointId] = joint;
      childLinkIds.add(childLinkId);
      return;
    }

    const childAlreadyAssigned = childLinkIds.has(childLinkId);
    const introducesCycle = disjointSet.find(parentLinkId) === disjointSet.find(childLinkId);

    if (!childAlreadyAssigned && !introducesCycle) {
      selectedJoints[jointId] = joint;
      childLinkIds.add(childLinkId);
      disjointSet.union(parentLinkId, childLinkId);
      return;
    }

    const closedLoopConstraint = buildClosedLoopConstraintFromSdfJoint(jointId, joint, graph);
    if (closedLoopConstraint) {
      closedLoopConstraints.push(closedLoopConstraint);
    }
  });

  return {
    joints: selectedJoints,
    ...(closedLoopConstraints.length > 0 ? { closedLoopConstraints } : {}),
  };
}

function applyVisualToLink(link: UrdfLink, visual: ParsedSdfVisual): UrdfLink {
  return {
    ...link,
    visual: {
      ...DEFAULT_LINK.visual,
      ...visual.geometry,
      origin: visual.pose,
      color: visual.color,
      materialSource: visual.materialSource,
      authoredMaterials: visual.authoredMaterials,
    },
  };
}

function applyCollisionToLink(link: UrdfLink, collision: ParsedSdfCollision): UrdfLink {
  return {
    ...link,
    collision: {
      ...DEFAULT_LINK.collision,
      ...collision.geometry,
      origin: collision.pose,
    },
  };
}

function parseLinkInertial(
  linkEl: Element,
  linkId: string,
  resolveFrameWorldMatrix: (frame: string) => THREE.Matrix4,
): UrdfLink['inertial'] | undefined {
  const inertialEl = getFirstDirectChild(linkEl, 'inertial');
  if (!inertialEl) {
    return undefined;
  }

  const inertiaEl = getFirstDirectChild(inertialEl, 'inertia');
  const inertialPose = resolvePoseRelativeToFrame(
    parsePoseElement(inertialEl),
    linkId,
    linkId,
    resolveFrameWorldMatrix,
  );
  return {
    mass: parseFloatSafe(getFirstDirectChild(inertialEl, 'mass')?.textContent, 0),
    origin: inertialPose,
    inertia: {
      ixx: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'ixx')?.textContent, 0),
      ixy: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'ixy')?.textContent, 0),
      ixz: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'ixz')?.textContent, 0),
      iyy: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'iyy')?.textContent, 0),
      iyz: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'iyz')?.textContent, 0),
      izz: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'izz')?.textContent, 0),
    },
  };
}

function mergeParsedSdfGraph(target: ParsedSdfGraph, source: ParsedSdfGraph): void {
  Object.assign(target.links, source.links);
  Object.assign(target.joints, source.joints);
  Object.assign(target.materials, source.materials);
  source.linkRecords.forEach((record, linkId) => {
    target.linkRecords.set(linkId, record);
  });
  source.jointRecords.forEach((record, jointId) => {
    target.jointRecords.set(jointId, record);
  });
}

function parseIncludedModelGraph(
  includeEl: Element,
  parentGraph: ParsedSdfGraph,
  {
    allFileContents = {},
    sourcePath,
    parentMatrix = new THREE.Matrix4().identity(),
    namespacePrefix,
    includeStack = new Set<string>(),
  }: ParseSdfModelOptions,
): void {
  const includeUri = getFirstDirectChild(includeEl, 'uri')?.textContent?.trim() || '';
  if (!includeUri) {
    return;
  }

  const resolvedInclude = resolveSdfIncludeSource(includeUri, allFileContents, sourcePath);
  if (!resolvedInclude || includeStack.has(resolvedInclude.path)) {
    return;
  }

  const includeDoc = new DOMParser().parseFromString(resolvedInclude.content.trim(), 'text/xml');
  if (includeDoc.querySelector('parsererror')) {
    return;
  }

  const includeModelEl = includeDoc.querySelector('sdf > model, model');
  if (!includeModelEl) {
    return;
  }

  const includeName =
    getFirstDirectChild(includeEl, 'name')?.textContent?.trim() ||
    includeModelEl.getAttribute('name')?.trim() ||
    resolvedInclude.path.split('/').slice(-2, -1)[0] ||
    'included_model';

  const includePose = parsePoseElement(includeEl);
  const nextIncludeStack = new Set(includeStack);
  nextIncludeStack.add(resolvedInclude.path);

  const includeGraph = parseSdfModel(includeModelEl, {
    allFileContents,
    sourcePath: resolvedInclude.path,
    parentMatrix: parentMatrix.clone().multiply(poseToMatrix(includePose.pose)),
    namespacePrefix: qualifyScopedName(includeName, namespacePrefix),
    includeStack: nextIncludeStack,
  });

  if (includeGraph) {
    mergeParsedSdfGraph(parentGraph, includeGraph);
  }
}

function parseSdfModel(
  modelEl: Element,
  {
    allFileContents = {},
    sourcePath,
    parentMatrix = new THREE.Matrix4().identity(),
    namespacePrefix,
    includeStack = new Set<string>(),
  }: ParseSdfModelOptions = {},
): ParsedSdfGraph | null {
  const modelPose = parsePoseElement(modelEl);
  const modelMatrix = parentMatrix.clone().multiply(poseToMatrix(modelPose.pose));
  const graph: ParsedSdfGraph = {
    links: {},
    joints: {},
    materials: {},
    linkRecords: new Map<string, ParsedSdfLinkRecord>(),
    jointRecords: new Map<string, ParsedSdfJointRecord>(),
  };

  const linkElements = new Map<string, Element>();
  const jointElements = new Map<string, Element>();
  const frameElements = new Map<string, Element>();

  for (const linkEl of getDirectChildElements(modelEl, 'link')) {
    const linkId = qualifyScopedName(linkEl.getAttribute('name')?.trim(), namespacePrefix);
    if (linkId) {
      linkElements.set(linkId, linkEl);
    }
  }

  for (const jointEl of getDirectChildElements(modelEl, 'joint')) {
    const jointId = qualifyScopedName(jointEl.getAttribute('name')?.trim(), namespacePrefix);
    if (jointId) {
      jointElements.set(jointId, jointEl);
    }
  }

  for (const frameEl of getDirectChildElements(modelEl, 'frame')) {
    const frameId = qualifyScopedName(frameEl.getAttribute('name')?.trim(), namespacePrefix);
    if (frameId) {
      frameElements.set(frameId, frameEl);
    }
  }

  const resolvedFrameCache = new Map<string, THREE.Matrix4>();
  const resolvingFrames = new Set<string>();
  resolvedFrameCache.set(MODEL_FRAME, modelMatrix);
  resolvedFrameCache.set(WORLD_FRAME, new THREE.Matrix4().identity());

  const resolveFrameWorldMatrix = (frame: string): THREE.Matrix4 => {
    const normalizedFrame = frame || MODEL_FRAME;
    const cachedFrame = resolvedFrameCache.get(normalizedFrame);
    if (cachedFrame) {
      return cachedFrame;
    }

    const knownLinkRecord = graph.linkRecords.get(normalizedFrame);
    if (knownLinkRecord) {
      return knownLinkRecord.worldMatrix;
    }

    if (resolvingFrames.has(normalizedFrame)) {
      throw new Error(`SDF frame resolution cycle detected at ${normalizedFrame}`);
    }

    resolvingFrames.add(normalizedFrame);

    let resolvedFrame: THREE.Matrix4 | null = null;

    const linkEl = linkElements.get(normalizedFrame);
    if (linkEl) {
      resolvedFrame = resolvePoseWorldMatrix(
        parsePoseElement(linkEl),
        MODEL_FRAME,
        resolveFrameWorldMatrix,
      );
    }

    if (!resolvedFrame) {
      const jointEl = jointElements.get(normalizedFrame);
      if (jointEl) {
        const childLinkId =
          qualifyScopedReference(
            getFirstDirectChild(jointEl, 'child')?.textContent?.trim(),
            namespacePrefix,
          ) || MODEL_FRAME;
        resolvedFrame = resolvePoseWorldMatrix(
          parsePoseElement(jointEl),
          childLinkId,
          resolveFrameWorldMatrix,
        );
      }
    }

    if (!resolvedFrame) {
      const frameEl = frameElements.get(normalizedFrame);
      if (frameEl) {
        const attachedTo =
          qualifyScopedReference(frameEl.getAttribute('attached_to')?.trim(), namespacePrefix) ||
          MODEL_FRAME;
        resolvedFrame = resolvePoseWorldMatrix(
          parsePoseElement(frameEl),
          attachedTo,
          resolveFrameWorldMatrix,
        );
      }
    }

    resolvingFrames.delete(normalizedFrame);

    if (!resolvedFrame) {
      throw new Error(`Unknown SDF frame reference: ${normalizedFrame}`);
    }

    resolvedFrameCache.set(normalizedFrame, resolvedFrame);
    return resolvedFrame;
  };

  for (const linkEl of getDirectChildElements(modelEl, 'link')) {
    const linkName = linkEl.getAttribute('name')?.trim();
    const linkId = qualifyScopedName(linkName, namespacePrefix);
    if (!linkId) {
      continue;
    }

    const baseLink = createEmptyLink(linkId, linkId);
    const linkPose = parsePoseElement(linkEl);
    const linkWorldMatrix = resolveFrameWorldMatrix(linkId);

    const visuals = getDirectChildElements(linkEl, 'visual').map(
      (visualEl, index): ParsedSdfVisual => ({
        name: visualEl.getAttribute('name')?.trim() || `${linkId}_visual_${index}`,
        geometry: parseSdfGeometry(getFirstDirectChild(visualEl, 'geometry'), DEFAULT_LINK.visual),
        pose: resolvePoseRelativeToFrame(
          parsePoseElement(visualEl),
          linkId,
          linkId,
          resolveFrameWorldMatrix,
        ),
        ...parseSdfMaterial(visualEl, {
          allFileContents,
          sourcePath,
        }),
      }),
    );

    const collisions = getDirectChildElements(linkEl, 'collision').map(
      (collisionEl): ParsedSdfCollision => ({
        geometry: parseSdfGeometry(
          getFirstDirectChild(collisionEl, 'geometry'),
          DEFAULT_LINK.collision,
        ),
        pose: resolvePoseRelativeToFrame(
          parsePoseElement(collisionEl),
          linkId,
          linkId,
          resolveFrameWorldMatrix,
        ),
      }),
    );

    const inertial = parseLinkInertial(linkEl, linkId, resolveFrameWorldMatrix);
    let nextLink: UrdfLink = {
      ...baseLink,
      ...(inertial ? { inertial } : {}),
    };

    if (visuals[0]) {
      nextLink = applyVisualToLink(nextLink, visuals[0]);
      nextLink.visualBodies = visuals.slice(1).map((visual) => ({
        ...DEFAULT_LINK.visual,
        ...visual.geometry,
        origin: visual.pose,
        color: visual.color,
        materialSource: visual.materialSource,
        authoredMaterials: visual.authoredMaterials,
      }));
      if (visuals[0].color || visuals[0].texture) {
        graph.materials[linkId] = {
          ...(visuals[0].color ? { color: visuals[0].color } : {}),
          ...(visuals[0].texture ? { texture: visuals[0].texture } : {}),
        };
      }
    }

    if (collisions[0]) {
      nextLink = applyCollisionToLink(nextLink, collisions[0]);
      nextLink.collisionBodies = collisions.slice(1).map((collision) => ({
        ...DEFAULT_LINK.collision,
        ...collision.geometry,
        origin: collision.pose,
      }));
    }

    graph.links[linkId] = nextLink;
    graph.linkRecords.set(linkId, {
      parsedPose: linkPose,
      pose: linkPose.pose,
      worldMatrix: linkWorldMatrix,
    });
  }

  for (const includeEl of getDirectChildElements(modelEl, 'include')) {
    parseIncludedModelGraph(includeEl, graph, {
      allFileContents,
      sourcePath,
      parentMatrix: modelMatrix,
      namespacePrefix,
      includeStack,
    });
  }

  for (const jointEl of getDirectChildElements(modelEl, 'joint')) {
    const jointName = jointEl.getAttribute('name')?.trim();
    const jointId = qualifyScopedName(jointName, namespacePrefix);
    if (!jointId) {
      continue;
    }

    const childLinkId = qualifyScopedName(
      getFirstDirectChild(jointEl, 'child')?.textContent?.trim(),
      namespacePrefix,
    );
    const parentLinkId = qualifyScopedName(
      getFirstDirectChild(jointEl, 'parent')?.textContent?.trim(),
      namespacePrefix,
    );
    if (!childLinkId || !graph.links[childLinkId]) {
      continue;
    }
    if (parentLinkId && !graph.links[parentLinkId]) {
      continue;
    }

    const childRecord = graph.linkRecords.get(childLinkId);
    if (!childRecord) {
      continue;
    }

    const jointWorldMatrix = resolveFrameWorldMatrix(jointId);
    const parentWorldMatrix = parentLinkId
      ? (graph.linkRecords.get(parentLinkId)?.worldMatrix ?? resolveFrameWorldMatrix(parentLinkId))
      : new THREE.Matrix4().identity();
    const relativeMatrix = parentWorldMatrix.clone().invert().multiply(jointWorldMatrix);
    const origin = matrixToPose(relativeMatrix);

    const jointType = mapSdfJointType(jointEl.getAttribute('type'));
    const axisEl = getFirstDirectChild(jointEl, 'axis');
    const limitEl = getFirstDirectChild(axisEl ?? jointEl, 'limit');
    const dynamicsEl = getFirstDirectChild(axisEl ?? jointEl, 'dynamics');

    const joint: UrdfJoint = {
      ...DEFAULT_JOINT,
      id: jointId,
      name: jointId,
      type: jointType,
      parentLinkId,
      childLinkId,
      origin,
      axis: AXIS_IMPORT_TYPES.has(jointType)
        ? parseVec3(getFirstDirectChild(axisEl ?? jointEl, 'xyz')?.textContent || '0 0 1')
        : undefined,
      limit: LIMIT_IMPORT_TYPES.has(jointType)
        ? {
            lower: parseFloatSafe(
              getFirstDirectChild(limitEl ?? jointEl, 'lower')?.textContent,
              Number.NaN,
            ),
            upper: parseFloatSafe(
              getFirstDirectChild(limitEl ?? jointEl, 'upper')?.textContent,
              Number.NaN,
            ),
            effort: parseFloatSafe(
              getFirstDirectChild(limitEl ?? jointEl, 'effort')?.textContent,
              Number.NaN,
            ),
            velocity: parseFloatSafe(
              getFirstDirectChild(limitEl ?? jointEl, 'velocity')?.textContent,
              Number.NaN,
            ),
          }
        : undefined,
      dynamics: {
        damping: parseFloatSafe(
          getFirstDirectChild(dynamicsEl ?? jointEl, 'damping')?.textContent,
          0,
        ),
        friction: parseFloatSafe(
          getFirstDirectChild(dynamicsEl ?? jointEl, 'friction')?.textContent,
          0,
        ),
      },
      hardware: {
        armature: 0,
        brand: '',
        motorType: 'None',
        motorId: '',
        motorDirection: 1,
      },
    };
    graph.joints[jointId] = joint;
    graph.jointRecords.set(jointId, {
      joint,
      worldMatrix: jointWorldMatrix.clone(),
    });
  }

  const incomingJointIdsByChild = new Map<string, string[]>();
  Object.values(graph.joints).forEach((joint) => {
    const incomingJointIds = incomingJointIdsByChild.get(joint.childLinkId) ?? [];
    incomingJointIds.push(joint.id);
    incomingJointIdsByChild.set(joint.childLinkId, incomingJointIds);
  });

  graph.linkRecords.forEach((record, linkId) => {
    if (!record.parsedPose.specified || isIdentityPose(record.parsedPose.pose)) {
      return;
    }

    const relativeJointId = qualifyScopedReference(record.parsedPose.relativeTo, namespacePrefix);
    if (!relativeJointId) {
      return;
    }

    const incomingJointIds = incomingJointIdsByChild.get(linkId) ?? [];
    if (incomingJointIds.length !== 1 || incomingJointIds[0] !== relativeJointId) {
      return;
    }

    const incomingJoint = graph.joints[relativeJointId];
    if (!incomingJoint) {
      return;
    }

    let stageIndex = 0;
    let stageLinkId = buildSyntheticJointStageName(linkId, stageIndex);
    while (graph.links[stageLinkId] || graph.joints[`${stageLinkId}_fixed`]) {
      stageIndex += 1;
      stageLinkId = buildSyntheticJointStageName(linkId, stageIndex);
    }

    const stageJointId = `${stageLinkId}_fixed`;
    const jointWorldMatrix = resolveFrameWorldMatrix(relativeJointId);

    graph.links[stageLinkId] = createEmptyLink(stageLinkId, stageLinkId);
    graph.linkRecords.set(stageLinkId, {
      parsedPose: {
        pose: IDENTITY_POSE,
        relativeTo: relativeJointId,
        specified: false,
      },
      pose: IDENTITY_POSE,
      worldMatrix: jointWorldMatrix,
    });

    incomingJoint.childLinkId = stageLinkId;
    const stageJoint = createFixedJoint(stageJointId, stageLinkId, linkId, record.parsedPose.pose);
    graph.joints[stageJointId] = stageJoint;
    graph.jointRecords.set(stageJointId, {
      joint: stageJoint,
      worldMatrix: jointWorldMatrix.clone().multiply(poseToMatrix(record.parsedPose.pose)),
    });
  });

  return Object.keys(graph.links).length > 0 ? graph : null;
}

export function isSDF(content: string): boolean {
  return /<sdf\b/i.test(content) && /<model\b/i.test(content);
}

export function parseSDF(xmlString: string, options: ParseSDFOptions = {}): RobotState | null {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString.trim(), 'text/xml');
  if (xmlDoc.querySelector('parsererror')) {
    return null;
  }

  const modelEl = xmlDoc.querySelector('sdf > model, model');
  if (!modelEl) {
    return null;
  }

  const modelName = modelEl.getAttribute('name')?.trim() || 'imported_sdf_model';
  const parsedGraph = parseSdfModel(modelEl, options);
  if (!parsedGraph) {
    return null;
  }

  const { links, materials, linkRecords } = parsedGraph;
  const { joints, closedLoopConstraints } = selectTreeJointsAndClosedLoops(parsedGraph);

  const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const rootCandidates = Object.keys(links).filter((linkId) => !childLinkIds.has(linkId));

  rootCandidates.forEach((rootLinkId) => {
    const record = linkRecords.get(rootLinkId);
    if (!record || isIdentityPose(matrixToPose(record.worldMatrix))) {
      return;
    }

    const anchorLinkId = `${rootLinkId}__root`;
    const anchorJointId = `${anchorLinkId}_fixed`;
    if (links[anchorLinkId] || joints[anchorJointId]) {
      return;
    }

    links[anchorLinkId] = createEmptyLink(anchorLinkId, anchorLinkId);
    joints[anchorJointId] = createFixedJoint(
      anchorJointId,
      anchorLinkId,
      rootLinkId,
      matrixToPose(record.worldMatrix),
    );
  });

  const finalChildLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const rootLinkId =
    Object.keys(links).find((linkId) => !finalChildLinkIds.has(linkId)) ||
    Object.keys(links)[0] ||
    '';

  return {
    name: modelName,
    links,
    joints,
    rootLinkId,
    ...(Object.keys(materials).length > 0 ? { materials } : {}),
    ...(closedLoopConstraints ? { closedLoopConstraints } : {}),
    selection: { type: 'link', id: rootLinkId },
  };
}
