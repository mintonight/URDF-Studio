import * as THREE from 'three';
import {
  getCollisionGeometryEntries,
  mergeAssembly,
  removeCollisionGeometryByObjectIndex,
  updateCollisionGeometryByObjectIndex,
} from '@/core/robot';
import type {
  AssemblyState,
  GeometryType as GeometryTypeValue,
  RobotData,
  UrdfJoint,
  UrdfLink,
  UrdfVisual,
} from '@/types';
import { GeometryType } from '@/types';
import {
  convertGeometryType,
  type MeshAnalysis,
  type MeshClearanceObstacle,
} from './geometryConversion';
import { analyzeMeshBatchWithWorker } from './meshAnalysisWorkerBridge';

export type CollisionOptimizationSource =
  | { kind: 'robot'; robot: RobotData }
  | { kind: 'assembly'; assembly: AssemblyState };

export type CollisionOptimizationScope = 'all' | 'mesh' | 'primitive' | 'selected';
export type MeshOptimizationStrategy = 'keep' | 'smart' | 'box' | 'sphere' | 'cylinder' | 'capsule';
export type CylinderOptimizationStrategy = 'keep' | 'capsule';
export type RodBoxOptimizationStrategy = 'keep' | 'capsule' | 'cylinder';
export type CoaxialJointMergeStrategy = 'keep' | 'capsule' | 'cylinder';
export type CollisionOptimizationManualMergeStrategy = Exclude<CoaxialJointMergeStrategy, 'keep'>;

export interface CollisionOptimizationManualMergePair {
  primaryTargetId: string;
  secondaryTargetId: string;
  strategy?: CollisionOptimizationManualMergeStrategy | null;
}

export interface CollisionOptimizationSettings {
  scope: CollisionOptimizationScope;
  meshStrategy: MeshOptimizationStrategy;
  cylinderStrategy: CylinderOptimizationStrategy;
  rodBoxStrategy: RodBoxOptimizationStrategy;
  coaxialJointMergeStrategy: CoaxialJointMergeStrategy;
  manualMergePairs?: CollisionOptimizationManualMergePair[];
  avoidSiblingOverlap: boolean;
  selectedTargetId?: string | null;
}

export interface CollisionTargetRef {
  id: string;
  componentId?: string;
  componentName?: string;
  linkId: string;
  linkName: string;
  objectIndex: number;
  bodyIndex: number | null;
  geometry: UrdfVisual;
  isPrimary: boolean;
  sequenceIndex: number;
}

export type CollisionOptimizationReason =
  | 'mesh-smart-fit'
  | 'mesh-manual-fit'
  | 'cylinder-to-capsule'
  | 'rod-box-to-capsule'
  | 'rod-box-to-cylinder'
  | 'coaxial-merge-to-capsule'
  | 'coaxial-merge-to-cylinder';

export type CollisionOptimizationStatus =
  | 'ready'
  | 'disabled'
  | 'missing-mesh-path'
  | 'mesh-analysis-failed'
  | 'no-rule-match';

export interface CollisionOptimizationCandidate {
  target: CollisionTargetRef;
  secondaryTarget?: CollisionTargetRef;
  eligible: boolean;
  currentType: GeometryTypeValue;
  suggestedType: GeometryTypeValue | null;
  status: CollisionOptimizationStatus;
  reason?: CollisionOptimizationReason;
  nextGeometry?: UrdfVisual;
  mutations?: CollisionOptimizationMutation[];
  affectedTargetIds?: string[];
  conflictPriority?: number;
  autoSelect?: boolean;
}

export function createCollisionOptimizationCandidateKey(
  candidate: Pick<CollisionOptimizationCandidate, 'target' | 'secondaryTarget'>,
): string {
  return candidate.secondaryTarget
    ? `${candidate.target.id}::${candidate.secondaryTarget.id}`
    : `${candidate.target.id}::single`;
}

export function createCollisionOptimizationCandidateKeyFromTargets(
  primaryTargetId: string,
  secondaryTargetId?: string | null,
): string {
  return secondaryTargetId
    ? `${primaryTargetId}::${secondaryTargetId}`
    : `${primaryTargetId}::single`;
}

export interface CollisionOptimizationMutation {
  componentId?: string;
  linkId: string;
  objectIndex: number;
  type: 'update' | 'remove';
  nextGeometry?: UrdfVisual;
}

export interface CollisionOptimizationOperation {
  id: string;
  componentId?: string;
  linkId: string;
  objectIndex: number;
  nextGeometry: UrdfVisual;
  reason: CollisionOptimizationReason;
  fromTypes: GeometryTypeValue[];
  toType: GeometryTypeValue;
  mutations: CollisionOptimizationMutation[];
  affectedTargetIds: string[];
}

export interface CollisionOptimizationAnalysis {
  targets: CollisionTargetRef[];
  filteredTargets: CollisionTargetRef[];
  candidates: CollisionOptimizationCandidate[];
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>;
}

export type CollisionOptimizationSkeletonProjectionPlane = 'xz' | 'xy' | 'yz';
export type CollisionOptimizationSkeletonProjectionViewMode = 'auto' | 'front';

export interface CollisionOptimizationSkeletonProjectionNode {
  linkId: string;
  clusterId: string;
  world: {
    x: number;
    y: number;
    z: number;
  };
  projected: {
    x: number;
    y: number;
  };
}

export interface CollisionOptimizationSkeletonProjectionEdge {
  id: string;
  fromLinkId: string;
  toLinkId: string;
  clusterId: string;
}

export interface CollisionOptimizationSkeletonProjection {
  plane: CollisionOptimizationSkeletonProjectionPlane;
  nodes: Record<string, CollisionOptimizationSkeletonProjectionNode>;
  edges: CollisionOptimizationSkeletonProjectionEdge[];
}

interface CollisionOptimizationSkeletonProjectionOptions {
  viewMode?: CollisionOptimizationSkeletonProjectionViewMode;
}

export interface CollisionOptimizationBaseAnalysis {
  source: CollisionOptimizationSource;
  targets: CollisionTargetRef[];
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>;
  clearanceWorld: CollisionOptimizationClearanceWorld | null;
}

interface CollisionOptimizationClearanceWorld {
  robot: RobotData;
  linkWorldMatrices: Record<string, THREE.Matrix4>;
  broadPhaseByTargetId: Record<string, { center: THREE.Vector3; radius: number }>;
}

interface CollisionClearanceContext {
  siblingGeometries?: UrdfVisual[];
  meshClearanceObstacles?: MeshClearanceObstacle[];
}

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const DEFAULT_CANDIDATE_ANALYSIS_YIELD_EVERY = 8;
const LOCAL_Z_AXIS = new THREE.Vector3(0, 0, 1);
const COAXIAL_AXIS_ALIGNMENT_DOT = Math.cos(THREE.MathUtils.degToRad(8));
const COAXIAL_AXIS_OFFSET_RATIO = 0.35;
const COAXIAL_RADIUS_RATIO_LIMIT = 1.25;
const COAXIAL_MIN_RADIUS = 1e-4;
const COAXIAL_GAP_FLOOR = 0.01;
const COAXIAL_JOINT_PROXIMITY_FLOOR = 0.02;
const AUTO_COAXIAL_CONFLICT_PRIORITY = 1;
const MANUAL_COAXIAL_CONFLICT_PRIORITY = 2;

type PrimitiveFitCandidate = NonNullable<
  NonNullable<MeshAnalysis['primitiveFits']>['capsuleCandidates']
>[number];

interface PrimitiveAxisWorldDescriptor {
  centerWorld: THREE.Vector3;
  axisWorld: THREE.Vector3;
  radius: number;
  length: number;
  sourceType: GeometryTypeValue;
}

interface CoaxialMergeCandidateParams {
  parentTarget: CollisionTargetRef;
  jointAxisWorld: THREE.Vector3;
  jointOriginWorld: THREE.Vector3;
  parentDescriptor: PrimitiveAxisWorldDescriptor;
  childDescriptor: PrimitiveAxisWorldDescriptor;
  parentLinkMatrix: THREE.Matrix4;
  strategy: Exclude<CoaxialJointMergeStrategy, 'keep'>;
}

export interface CollisionOptimizationAsyncOptions {
  signal?: AbortSignal;
  yieldEvery?: number;
  includeClearanceData?: boolean;
  includeMeshClearanceObstacles?: boolean;
  includePrimitiveFits?: boolean;
  pointCollectionLimit?: number;
  surfacePointLimit?: number;
  sourceFilePath?: string;
}

function createAbortError(): DOMException {
  return new DOMException('Collision optimization analysis aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    setTimeout(resolve, 0);
  });
}

async function maybeYieldAfterBatch(
  index: number,
  yieldEvery: number,
  signal?: AbortSignal,
): Promise<void> {
  if (yieldEvery > 0 && (index + 1) % yieldEvery === 0) {
    throwIfAborted(signal);
    await yieldToMainThread();
  }
}

function createTargetId(
  componentId: string | undefined,
  linkId: string,
  objectIndex: number,
): string {
  return `${componentId ?? 'robot'}::${linkId}::${objectIndex}`;
}

function getLinkGroupKey(target: Pick<CollisionTargetRef, 'componentId' | 'linkId'>): string {
  return `${target.componentId ?? 'robot'}::${target.linkId}`;
}

function createMeshAnalysisCacheKey(
  geometry: Pick<UrdfVisual, 'meshPath' | 'dimensions'>,
  sourceFilePath?: string,
): string {
  return [
    geometry.meshPath ?? '',
    geometry.dimensions?.x ?? 1,
    geometry.dimensions?.y ?? 1,
    geometry.dimensions?.z ?? 1,
    sourceFilePath ?? '',
  ].join('::');
}

function resolveCollisionTargetSourceFilePath(
  source: CollisionOptimizationSource,
  target: Pick<CollisionTargetRef, 'componentId'>,
  fallbackSourceFilePath?: string,
): string | undefined {
  if (source.kind === 'assembly' && target.componentId) {
    return source.assembly.components[target.componentId]?.sourceFile ?? fallbackSourceFilePath;
  }

  return fallbackSourceFilePath;
}

function cloneGeometry(geometry: UrdfVisual): UrdfVisual {
  return {
    ...geometry,
    dimensions: { ...geometry.dimensions },
    origin: {
      xyz: { ...geometry.origin.xyz },
      rpy: { ...geometry.origin.rpy },
    },
  };
}

function normalizeGeometry(geometry: UrdfVisual): UrdfVisual {
  return {
    ...cloneGeometry(geometry),
    dimensions: {
      x: Number.isFinite(geometry.dimensions?.x) ? geometry.dimensions.x : 0,
      y: Number.isFinite(geometry.dimensions?.y) ? geometry.dimensions.y : 0,
      z: Number.isFinite(geometry.dimensions?.z) ? geometry.dimensions.z : 0,
    },
    origin: {
      xyz: {
        x: Number.isFinite(geometry.origin?.xyz?.x) ? geometry.origin.xyz.x : 0,
        y: Number.isFinite(geometry.origin?.xyz?.y) ? geometry.origin.xyz.y : 0,
        z: Number.isFinite(geometry.origin?.xyz?.z) ? geometry.origin.xyz.z : 0,
      },
      rpy: {
        r: Number.isFinite(geometry.origin?.rpy?.r) ? geometry.origin.rpy.r : 0,
        p: Number.isFinite(geometry.origin?.rpy?.p) ? geometry.origin.rpy.p : 0,
        y: Number.isFinite(geometry.origin?.rpy?.y) ? geometry.origin.rpy.y : 0,
      },
    },
  };
}

function applyOriginRotationToVector(
  origin: UrdfVisual['origin'] | undefined,
  vector: THREE.Vector3,
): THREE.Vector3 {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(origin?.rpy?.r ?? 0, origin?.rpy?.p ?? 0, origin?.rpy?.y ?? 0, 'ZYX'),
  );

  return vector.clone().applyQuaternion(quaternion);
}

function offsetLocalPointByOrigin(
  origin: UrdfVisual['origin'] | undefined,
  localPoint: { x: number; y: number; z: number },
): THREE.Vector3 {
  const rotatedPoint = applyOriginRotationToVector(
    origin,
    new THREE.Vector3(localPoint.x, localPoint.y, localPoint.z),
  );

  return rotatedPoint.add(
    new THREE.Vector3(origin?.xyz?.x ?? 0, origin?.xyz?.y ?? 0, origin?.xyz?.z ?? 0),
  );
}

function getDirectionAlignmentEuler(direction: THREE.Vector3): THREE.Euler {
  const safeDirection = direction.clone();
  if (safeDirection.lengthSq() <= 1e-12) {
    safeDirection.copy(LOCAL_Z_AXIS);
  } else {
    safeDirection.normalize();
  }

  const quaternion = new THREE.Quaternion().setFromUnitVectors(LOCAL_Z_AXIS, safeDirection);
  return new THREE.Euler().setFromQuaternion(quaternion, 'ZYX');
}

function createOriginMatrix(origin?: UrdfVisual['origin']): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(origin?.xyz?.x ?? 0, origin?.xyz?.y ?? 0, origin?.xyz?.z ?? 0);
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(origin?.rpy?.r ?? 0, origin?.rpy?.p ?? 0, origin?.rpy?.y ?? 0, 'ZYX'),
  );
  matrix.compose(position, quaternion, UNIT_SCALE);
  return matrix;
}

function createJointMotionMatrix(joint: UrdfJoint): THREE.Matrix4 {
  const matrix = new THREE.Matrix4().identity();
  const angle = Number.isFinite(joint.angle) ? joint.angle! : 0;

  if (joint.type === 'revolute' || joint.type === 'continuous') {
    const axisVector = new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z);
    if (axisVector.lengthSq() > 1e-12 && Math.abs(angle) > 1e-12) {
      axisVector.normalize();
      matrix.makeRotationAxis(axisVector, angle);
    }
    return matrix;
  }

  if (joint.type === 'prismatic') {
    const axisVector = new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z);
    if (axisVector.lengthSq() > 1e-12 && Math.abs(angle) > 1e-12) {
      axisVector.normalize().multiplyScalar(angle);
      matrix.makeTranslation(axisVector.x, axisVector.y, axisVector.z);
    }
  }

  return matrix;
}

function computeLinkWorldMatrices(robot: RobotData): Record<string, THREE.Matrix4> {
  const linkMatrices: Record<string, THREE.Matrix4> = {};
  const jointsByParent = new Map<string, UrdfJoint[]>();
  const childLinkIds = new Set<string>();

  Object.values(robot.joints).forEach((joint) => {
    const siblings = jointsByParent.get(joint.parentLinkId) ?? [];
    siblings.push(joint);
    jointsByParent.set(joint.parentLinkId, siblings);
    childLinkIds.add(joint.childLinkId);
  });

  const visit = (linkId: string, parentMatrix: THREE.Matrix4) => {
    if (linkMatrices[linkId]) {
      return;
    }

    linkMatrices[linkId] = parentMatrix.clone();
    const childJoints = jointsByParent.get(linkId) ?? [];

    childJoints.forEach((joint) => {
      const childMatrix = parentMatrix
        .clone()
        .multiply(createOriginMatrix(joint.origin))
        .multiply(createJointMotionMatrix(joint));
      visit(joint.childLinkId, childMatrix);
    });
  };

  const rootCandidates = [
    robot.rootLinkId,
    ...Object.keys(robot.links).filter((linkId) => !childLinkIds.has(linkId)),
    ...Object.keys(robot.links),
  ].filter(
    (linkId, index, values): linkId is string =>
      Boolean(linkId) && values.indexOf(linkId) === index,
  );

  rootCandidates.forEach((rootLinkId) => {
    visit(rootLinkId, new THREE.Matrix4().identity());
  });

  return linkMatrices;
}

function chooseSkeletonProjectionPlane(
  positions: THREE.Vector3[],
): CollisionOptimizationSkeletonProjectionPlane {
  if (positions.length === 0) {
    return 'xz';
  }

  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  positions.forEach((position) => {
    min.min(position);
    max.max(position);
  });

  const spanX = Math.max(max.x - min.x, 1e-6);
  const spanY = Math.max(max.y - min.y, 1e-6);
  const spanZ = Math.max(max.z - min.z, 1e-6);
  const candidates: Array<{ plane: CollisionOptimizationSkeletonProjectionPlane; area: number }> = [
    { plane: 'xz', area: spanX * spanZ },
    { plane: 'xy', area: spanX * spanY },
    { plane: 'yz', area: spanY * spanZ },
  ];

  candidates.sort((left, right) => right.area - left.area);
  return candidates[0]?.plane ?? 'xz';
}

function chooseFrontSkeletonProjectionPlane(
  positions: THREE.Vector3[],
): CollisionOptimizationSkeletonProjectionPlane {
  if (positions.length === 0) {
    return 'yz';
  }

  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  positions.forEach((position) => {
    min.min(position);
    max.max(position);
  });

  const spanX = Math.max(max.x - min.x, 1e-6);
  const spanY = Math.max(max.y - min.y, 1e-6);
  const hasReadableLateralSpread = spanY >= Math.max(spanX * 0.15, 1e-3);

  return hasReadableLateralSpread ? 'yz' : 'xz';
}

function projectSkeletonPosition(
  plane: CollisionOptimizationSkeletonProjectionPlane,
  position: THREE.Vector3,
): { x: number; y: number } {
  switch (plane) {
    case 'xy':
      return { x: position.x, y: -position.y };
    case 'yz':
      return { x: position.y, y: -position.z };
    case 'xz':
    default:
      return { x: position.x, y: -position.z };
  }
}

function buildSkeletonClusterIds(robot: RobotData): Record<string, string> {
  const adjacency = new Map<string, string[]>();
  Object.keys(robot.links).forEach((linkId) => {
    adjacency.set(linkId, []);
  });

  Object.values(robot.joints).forEach((joint) => {
    adjacency.get(joint.parentLinkId)?.push(joint.childLinkId);
    adjacency.get(joint.childLinkId)?.push(joint.parentLinkId);
  });

  const clusterIds: Record<string, string> = {};
  const visited = new Set<string>();
  let clusterIndex = 0;

  Object.keys(robot.links)
    .sort((left, right) => left.localeCompare(right))
    .forEach((linkId) => {
      if (visited.has(linkId)) {
        return;
      }

      const clusterId = `cluster-${clusterIndex}`;
      clusterIndex += 1;
      const queue = [linkId];
      visited.add(linkId);

      while (queue.length > 0) {
        const current = queue.shift()!;
        clusterIds[current] = clusterId;

        (adjacency.get(current) ?? []).forEach((neighbor) => {
          if (visited.has(neighbor)) {
            return;
          }

          visited.add(neighbor);
          queue.push(neighbor);
        });
      }
    });

  return clusterIds;
}

export function buildCollisionOptimizationSkeletonProjection(
  source: CollisionOptimizationSource,
  options: CollisionOptimizationSkeletonProjectionOptions = {},
): CollisionOptimizationSkeletonProjection {
  const robot = source.kind === 'robot' ? source.robot : mergeAssembly(source.assembly);
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const linkPositions = Object.entries(linkWorldMatrices).map(([linkId, matrix]) => {
    const position = new THREE.Vector3();
    position.setFromMatrixPosition(matrix);
    return { linkId, position };
  });
  const positions = linkPositions.map(({ position }) => position);
  const plane =
    options.viewMode === 'front'
      ? chooseFrontSkeletonProjectionPlane(positions)
      : chooseSkeletonProjectionPlane(positions);
  const clusterIds = buildSkeletonClusterIds(robot);

  return {
    plane,
    nodes: Object.fromEntries(
      linkPositions.map(({ linkId, position }) => [
        linkId,
        {
          linkId,
          clusterId: clusterIds[linkId] ?? 'cluster-0',
          world: {
            x: position.x,
            y: position.y,
            z: position.z,
          },
          projected: projectSkeletonPosition(plane, position),
        },
      ]),
    ),
    edges: Object.values(robot.joints).map((joint, index) => ({
      id: `skeleton-edge::${index}::${joint.parentLinkId}::${joint.childLinkId}`,
      fromLinkId: joint.parentLinkId,
      toLinkId: joint.childLinkId,
      clusterId:
        clusterIds[joint.parentLinkId] ?? clusterIds[joint.childLinkId] ?? `cluster-${index}`,
    })),
  };
}

function transformDirectionToWorld(
  linkMatrix: THREE.Matrix4,
  localDirection: THREE.Vector3,
): THREE.Vector3 {
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  linkMatrix.decompose(position, quaternion, scale);
  return localDirection.clone().applyQuaternion(quaternion).normalize();
}

function transformDirectionToLinkFrame(
  linkMatrix: THREE.Matrix4,
  worldDirection: THREE.Vector3,
): THREE.Vector3 {
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  linkMatrix.decompose(position, quaternion, scale);
  return worldDirection.clone().applyQuaternion(quaternion.invert()).normalize();
}

function getPrimitiveFitCandidates(
  analysis: MeshAnalysis,
  strategy: Exclude<CoaxialJointMergeStrategy, 'keep'>,
): PrimitiveFitCandidate[] {
  const primitiveFits = analysis.primitiveFits;
  if (!primitiveFits) {
    return [];
  }

  if (strategy === 'cylinder') {
    return (
      primitiveFits.cylinderCandidates ?? (primitiveFits.cylinder ? [primitiveFits.cylinder] : [])
    );
  }

  return primitiveFits.capsuleCandidates ?? (primitiveFits.capsule ? [primitiveFits.capsule] : []);
}

function buildPrimitiveAxisDescriptorForGeometry(
  geometry: UrdfVisual,
  meshAnalysis: MeshAnalysis | null | undefined,
  strategy: Exclude<CoaxialJointMergeStrategy, 'keep'>,
  linkMatrix: THREE.Matrix4,
  preferredAxisWorld?: THREE.Vector3,
): PrimitiveAxisWorldDescriptor | null {
  if (geometry.type === GeometryType.CYLINDER || geometry.type === GeometryType.CAPSULE) {
    const centerLocal = new THREE.Vector3(
      geometry.origin?.xyz?.x ?? 0,
      geometry.origin?.xyz?.y ?? 0,
      geometry.origin?.xyz?.z ?? 0,
    );
    const axisLocal = applyOriginRotationToVector(geometry.origin, LOCAL_Z_AXIS).normalize();
    const centerWorld = centerLocal.clone().applyMatrix4(linkMatrix);
    const axisWorld = transformDirectionToWorld(linkMatrix, axisLocal);

    return {
      centerWorld,
      axisWorld,
      radius: Math.max(geometry.dimensions?.x ?? 0, COAXIAL_MIN_RADIUS),
      length: Math.max(geometry.dimensions?.y ?? 0, COAXIAL_MIN_RADIUS * 2),
      sourceType: geometry.type,
    };
  }

  if (geometry.type !== GeometryType.MESH || !meshAnalysis) {
    return null;
  }

  const fitCandidates = getPrimitiveFitCandidates(meshAnalysis, strategy);
  if (fitCandidates.length === 0) {
    return null;
  }

  let bestFit: PrimitiveFitCandidate | null = null;
  let bestAlignment = -Infinity;

  fitCandidates.forEach((fit) => {
    const axisLocal = applyOriginRotationToVector(
      geometry.origin,
      new THREE.Vector3(fit.axis.x, fit.axis.y, fit.axis.z),
    ).normalize();
    const axisWorld = transformDirectionToWorld(linkMatrix, axisLocal);
    const alignment = preferredAxisWorld ? Math.abs(axisWorld.dot(preferredAxisWorld)) : 1;
    if (alignment > bestAlignment + 1e-8) {
      bestAlignment = alignment;
      bestFit = fit;
      return;
    }

    if (Math.abs(alignment - bestAlignment) <= 1e-8 && bestFit && fit.volume < bestFit.volume) {
      bestFit = fit;
    }
  });

  if (!bestFit) {
    return null;
  }

  const centerLocal = offsetLocalPointByOrigin(geometry.origin, bestFit.center);
  const axisLocal = applyOriginRotationToVector(
    geometry.origin,
    new THREE.Vector3(bestFit.axis.x, bestFit.axis.y, bestFit.axis.z),
  ).normalize();

  return {
    centerWorld: centerLocal.clone().applyMatrix4(linkMatrix),
    axisWorld: transformDirectionToWorld(linkMatrix, axisLocal),
    radius: Math.max(bestFit.radius, COAXIAL_MIN_RADIUS),
    length: Math.max(bestFit.length, COAXIAL_MIN_RADIUS * 2),
    sourceType: geometry.type,
  };
}

function distanceToInterval(value: number, intervalStart: number, intervalEnd: number): number {
  if (value < intervalStart) return intervalStart - value;
  if (value > intervalEnd) return value - intervalEnd;
  return 0;
}

function buildCoaxialMergeGeometry(params: CoaxialMergeCandidateParams): UrdfVisual | null {
  const {
    parentTarget,
    jointAxisWorld,
    jointOriginWorld,
    parentDescriptor,
    childDescriptor,
    parentLinkMatrix,
    strategy,
  } = params;

  const axis = jointAxisWorld.clone().normalize();
  const parentCenterOffset = parentDescriptor.centerWorld.clone().sub(jointOriginWorld);
  const childCenterOffset = childDescriptor.centerWorld.clone().sub(jointOriginWorld);
  const parentT = parentCenterOffset.dot(axis);
  const childT = childCenterOffset.dot(axis);
  const parentHalfExtent = Math.max(parentDescriptor.length / 2, COAXIAL_MIN_RADIUS);
  const childHalfExtent = Math.max(childDescriptor.length / 2, COAXIAL_MIN_RADIUS);
  const parentStart = parentT - parentHalfExtent;
  const parentEnd = parentT + parentHalfExtent;
  const childStart = childT - childHalfExtent;
  const childEnd = childT + childHalfExtent;
  const jointProximityLimit = Math.max(
    Math.max(parentDescriptor.radius, childDescriptor.radius) * 1.2,
    COAXIAL_JOINT_PROXIMITY_FLOOR,
  );

  if (
    distanceToInterval(0, parentStart, parentEnd) > jointProximityLimit ||
    distanceToInterval(0, childStart, childEnd) > jointProximityLimit
  ) {
    return null;
  }

  const mergedStart = Math.min(parentStart, childStart);
  const mergedEnd = Math.max(parentEnd, childEnd);
  const mergedLength = Math.max(mergedEnd - mergedStart, COAXIAL_MIN_RADIUS * 2);
  const mergedCenterWorld = jointOriginWorld
    .clone()
    .add(axis.clone().multiplyScalar((mergedStart + mergedEnd) / 2));
  const mergedRadius = Math.max(
    parentDescriptor.radius,
    childDescriptor.radius,
    COAXIAL_MIN_RADIUS,
  );
  const centerLocal = mergedCenterWorld.clone().applyMatrix4(parentLinkMatrix.clone().invert());
  const axisLocal = transformDirectionToLinkFrame(parentLinkMatrix, axis);
  const alignedEuler = getDirectionAlignmentEuler(axisLocal);

  return {
    ...normalizeGeometry(parentTarget.geometry),
    type: strategy === 'capsule' ? GeometryType.CAPSULE : GeometryType.CYLINDER,
    meshPath: undefined,
    dimensions: {
      x: mergedRadius,
      y: strategy === 'capsule' ? Math.max(mergedLength, mergedRadius * 2) : mergedLength,
      z: mergedRadius,
    },
    origin: {
      xyz: {
        x: centerLocal.x,
        y: centerLocal.y,
        z: centerLocal.z,
      },
      rpy: {
        r: alignedEuler.x,
        p: alignedEuler.y,
        y: alignedEuler.z,
      },
    },
  };
}

function transformGeometryToTargetLinkFrame(
  geometry: UrdfVisual,
  sourceLinkMatrix: THREE.Matrix4,
  targetLinkInverseMatrix: THREE.Matrix4,
): UrdfVisual {
  const relativeMatrix = targetLinkInverseMatrix
    .clone()
    .multiply(sourceLinkMatrix)
    .multiply(createOriginMatrix(geometry.origin));
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  relativeMatrix.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'ZYX');

  return {
    ...geometry,
    dimensions: geometry.dimensions ? { ...geometry.dimensions } : geometry.dimensions,
    origin: {
      xyz: {
        x: position.x,
        y: position.y,
        z: position.z,
      },
      rpy: {
        r: rotation.x,
        p: rotation.y,
        y: rotation.z,
      },
    },
  };
}

function transformMeshObstaclePointsToTargetLinkFrame(
  points: NonNullable<MeshAnalysis['surfacePoints']>,
  sourceLinkMatrix: THREE.Matrix4,
  geometryOrigin: UrdfVisual['origin'],
  targetLinkInverseMatrix: THREE.Matrix4,
): MeshClearanceObstacle {
  const transformMatrix = targetLinkInverseMatrix
    .clone()
    .multiply(sourceLinkMatrix)
    .multiply(createOriginMatrix(geometryOrigin));
  const transformedPoint = new THREE.Vector3();

  return {
    points: points.map((point) => {
      transformedPoint.set(point.x, point.y, point.z).applyMatrix4(transformMatrix);
      return {
        x: transformedPoint.x,
        y: transformedPoint.y,
        z: transformedPoint.z,
      };
    }),
  };
}

function buildCollisionTargetsForRobot(
  robot: RobotData,
  componentMeta?: { componentId: string; componentName: string },
): CollisionTargetRef[] {
  const targets: CollisionTargetRef[] = [];

  Object.values(robot.links).forEach((link) => {
    const entries = getCollisionGeometryEntries(link);
    entries.forEach((entry, index) => {
      targets.push({
        id: createTargetId(componentMeta?.componentId, link.id, entry.objectIndex),
        componentId: componentMeta?.componentId,
        componentName: componentMeta?.componentName,
        linkId: link.id,
        linkName: link.name,
        objectIndex: entry.objectIndex,
        bodyIndex: entry.bodyIndex,
        geometry: cloneGeometry(entry.geometry),
        isPrimary: entry.bodyIndex === null,
        sequenceIndex: index,
      });
    });
  });

  return targets;
}

export function collectCollisionTargets(source: CollisionOptimizationSource): CollisionTargetRef[] {
  if (source.kind === 'robot') {
    return buildCollisionTargetsForRobot(source.robot);
  }

  return Object.values(source.assembly.components).flatMap((component) =>
    buildCollisionTargetsForRobot(component.robot, {
      componentId: component.id,
      componentName: component.name,
    }),
  );
}

function filterTargets(
  targets: CollisionTargetRef[],
  settings: CollisionOptimizationSettings,
): CollisionTargetRef[] {
  if (settings.scope === 'selected') {
    return settings.selectedTargetId
      ? targets.filter((target) => target.id === settings.selectedTargetId)
      : [];
  }

  if (settings.scope === 'mesh') {
    return targets.filter((target) => target.geometry.type === GeometryType.MESH);
  }

  if (settings.scope === 'primitive') {
    return targets.filter((target) => target.geometry.type !== GeometryType.MESH);
  }

  return targets;
}

function isRodLikeBox(geometry: UrdfVisual): boolean {
  if (geometry.type !== GeometryType.BOX) return false;

  const dims = [geometry.dimensions.x, geometry.dimensions.y, geometry.dimensions.z]
    .map((value) => Math.max(value, 1e-6))
    .sort((left, right) => left - right);
  const [smallest, middle, largest] = dims;

  return (
    largest / Math.max(middle, smallest) >= 1.75 &&
    Math.abs(middle - smallest) / Math.max(middle, smallest) <= 0.35
  );
}

function pickSmartMeshStrategy(analysis: MeshAnalysis): MeshOptimizationStrategy {
  const dims = [analysis.bounds.x, analysis.bounds.y, analysis.bounds.z]
    .map((value) => Math.max(value, 1e-6))
    .sort((left, right) => left - right);
  const [smallest, middle, largest] = dims;

  const nearSphere = largest / smallest <= 1.12;
  if (nearSphere) {
    return 'sphere';
  }

  const rodLike =
    largest / Math.max(middle, smallest) >= 1.75 &&
    Math.abs(middle - smallest) / Math.max(middle, smallest) <= 0.28;
  if (rodLike) {
    return analysis.primitiveFits?.capsule ? 'capsule' : 'cylinder';
  }

  return 'box';
}

function toGeometryType(strategy: MeshOptimizationStrategy): GeometryTypeValue {
  switch (strategy) {
    case 'box':
      return GeometryType.BOX;
    case 'sphere':
      return GeometryType.SPHERE;
    case 'cylinder':
      return GeometryType.CYLINDER;
    case 'capsule':
      return GeometryType.CAPSULE;
    case 'keep':
    case 'smart':
    default:
      return GeometryType.BOX;
  }
}

function buildSiblingGeometries(
  targets: CollisionTargetRef[],
  target: CollisionTargetRef,
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
): UrdfVisual[] {
  const groupKey = getLinkGroupKey(target);
  return targets
    .filter((candidate) => candidate.id !== target.id && getLinkGroupKey(candidate) === groupKey)
    .map((candidate) => {
      if (candidate.geometry.type !== GeometryType.MESH) {
        return cloneGeometry(candidate.geometry);
      }

      const analysis = meshAnalysisByTargetId[candidate.id];
      if (!analysis) {
        return cloneGeometry(candidate.geometry);
      }

      const converted = convertGeometryType(candidate.geometry, GeometryType.BOX, analysis);
      return {
        ...normalizeGeometry(candidate.geometry),
        type: GeometryType.BOX,
        dimensions: { ...converted.dimensions },
        origin: {
          xyz: { ...converted.origin.xyz },
          rpy: { ...converted.origin.rpy },
        },
        meshPath: undefined,
      };
    });
}

function computeWorldBroadPhaseSphere(
  geometry: UrdfVisual,
  meshAnalysis: MeshAnalysis | null | undefined,
  sourceLinkMatrix: THREE.Matrix4 | undefined,
): { center: THREE.Vector3; radius: number } | null {
  if (!sourceLinkMatrix) {
    return null;
  }

  const radius = computeBroadPhaseRadius(geometry, meshAnalysis);
  if (!radius || radius <= 1e-8) {
    return null;
  }

  const localCenter = computeBroadPhaseCenter(geometry, meshAnalysis);
  const worldCenter = new THREE.Vector3(localCenter.x, localCenter.y, localCenter.z).applyMatrix4(
    sourceLinkMatrix,
  );

  return {
    center: worldCenter,
    radius,
  };
}

function buildCollisionOptimizationClearanceWorld(
  source: CollisionOptimizationSource,
  targets: CollisionTargetRef[],
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
): CollisionOptimizationClearanceWorld | null {
  const robot = source.kind === 'robot' ? source.robot : mergeAssembly(source.assembly);
  if (!robot.rootLinkId || Object.keys(robot.links).length === 0) {
    return null;
  }

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  if (Object.keys(linkWorldMatrices).length === 0) {
    return null;
  }

  const broadPhaseByTargetId: Record<string, { center: THREE.Vector3; radius: number }> = {};
  targets.forEach((target) => {
    const sphere = computeWorldBroadPhaseSphere(
      target.geometry,
      meshAnalysisByTargetId[target.id],
      linkWorldMatrices[target.linkId],
    );
    if (sphere) {
      broadPhaseByTargetId[target.id] = sphere;
    }
  });

  return {
    robot,
    linkWorldMatrices,
    broadPhaseByTargetId,
  };
}

function buildNearbyCollisionClearanceContext(
  targets: CollisionTargetRef[],
  target: CollisionTargetRef,
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  clearanceWorld: CollisionOptimizationClearanceWorld | null,
  includeMeshClearanceObstacles = true,
): CollisionClearanceContext {
  if (!clearanceWorld) {
    const siblingGeometries = buildSiblingGeometries(targets, target, meshAnalysisByTargetId);
    return {
      siblingGeometries: siblingGeometries.length > 0 ? siblingGeometries : undefined,
    };
  }

  const currentLinkMatrix = clearanceWorld.linkWorldMatrices[target.linkId];
  if (!currentLinkMatrix) {
    const siblingGeometries = buildSiblingGeometries(targets, target, meshAnalysisByTargetId);
    return {
      siblingGeometries: siblingGeometries.length > 0 ? siblingGeometries : undefined,
    };
  }

  const currentLinkInverseMatrix = currentLinkMatrix.clone().invert();
  const targetSphere = clearanceWorld.broadPhaseByTargetId[target.id] ?? null;
  const siblingGeometries: UrdfVisual[] = [];
  const meshClearanceObstacles: MeshClearanceObstacle[] = [];

  targets.forEach((candidate) => {
    if (candidate.id === target.id) {
      return;
    }

    const sourceLinkMatrix = clearanceWorld.linkWorldMatrices[candidate.linkId];
    if (!sourceLinkMatrix) {
      return;
    }

    const obstacleSphere = clearanceWorld.broadPhaseByTargetId[candidate.id] ?? null;
    if (targetSphere && obstacleSphere) {
      const maxInfluenceDistance = targetSphere.radius + obstacleSphere.radius + 0.05;
      if (targetSphere.center.distanceTo(obstacleSphere.center) > maxInfluenceDistance) {
        return;
      }
    }

    const geometry = candidate.geometry;
    const analysis = meshAnalysisByTargetId[candidate.id];
    const meshObstacle =
      includeMeshClearanceObstacles &&
      analysis?.surfacePoints?.length &&
      geometry.type === GeometryType.MESH
        ? transformMeshObstaclePointsToTargetLinkFrame(
            analysis.surfacePoints,
            sourceLinkMatrix,
            geometry.origin,
            currentLinkInverseMatrix,
          )
        : null;

    if (meshObstacle?.points.length) {
      meshClearanceObstacles.push(meshObstacle);
    }

    if (geometry.type !== GeometryType.MESH || !analysis) {
      siblingGeometries.push(
        transformGeometryToTargetLinkFrame(geometry, sourceLinkMatrix, currentLinkInverseMatrix),
      );
      return;
    }

    const boxedGeometry = convertGeometryType(geometry, GeometryType.BOX, analysis);
    siblingGeometries.push(
      transformGeometryToTargetLinkFrame(
        {
          ...geometry,
          type: GeometryType.BOX,
          dimensions: { ...boxedGeometry.dimensions },
          origin: {
            xyz: { ...boxedGeometry.origin.xyz },
            rpy: { ...boxedGeometry.origin.rpy },
          },
          meshPath: undefined,
        },
        sourceLinkMatrix,
        currentLinkInverseMatrix,
      ),
    );
  });

  return {
    siblingGeometries: siblingGeometries.length > 0 ? siblingGeometries : undefined,
    meshClearanceObstacles: meshClearanceObstacles.length > 0 ? meshClearanceObstacles : undefined,
  };
}

function buildMeshCandidate(
  target: CollisionTargetRef,
  settings: CollisionOptimizationSettings,
  analysis: MeshAnalysis | null | undefined,
  clearanceContext: CollisionClearanceContext,
): CollisionOptimizationCandidate {
  if (settings.meshStrategy === 'keep') {
    return {
      target,
      eligible: false,
      currentType: target.geometry.type,
      suggestedType: null,
      status: 'disabled',
    };
  }

  if (!target.geometry.meshPath) {
    return {
      target,
      eligible: false,
      currentType: target.geometry.type,
      suggestedType: null,
      status: 'missing-mesh-path',
    };
  }

  if (!analysis) {
    return {
      target,
      eligible: false,
      currentType: target.geometry.type,
      suggestedType: null,
      status: 'mesh-analysis-failed',
    };
  }

  const resolvedStrategy =
    settings.meshStrategy === 'smart' ? pickSmartMeshStrategy(analysis) : settings.meshStrategy;
  const suggestedType = toGeometryType(resolvedStrategy);
  const converted = convertGeometryType(
    target.geometry,
    suggestedType,
    analysis,
    settings.avoidSiblingOverlap ? clearanceContext : undefined,
  );

  const nextGeometry: UrdfVisual = {
    ...normalizeGeometry(target.geometry),
    type: converted.type,
    dimensions: { ...converted.dimensions },
    origin: {
      xyz: { ...converted.origin.xyz },
      rpy: { ...converted.origin.rpy },
    },
    meshPath: undefined,
  };

  return {
    target,
    eligible: true,
    currentType: target.geometry.type,
    suggestedType,
    status: 'ready',
    reason: settings.meshStrategy === 'smart' ? 'mesh-smart-fit' : 'mesh-manual-fit',
    nextGeometry,
  };
}

function buildPrimitiveCandidate(
  target: CollisionTargetRef,
  settings: CollisionOptimizationSettings,
  clearanceContext: CollisionClearanceContext,
): CollisionOptimizationCandidate {
  if (target.geometry.type === GeometryType.CYLINDER) {
    if (settings.cylinderStrategy === 'keep') {
      return {
        target,
        eligible: false,
        currentType: target.geometry.type,
        suggestedType: null,
        status: 'disabled',
      };
    }

    const converted = convertGeometryType(
      target.geometry,
      GeometryType.CAPSULE,
      undefined,
      settings.avoidSiblingOverlap ? clearanceContext : undefined,
    );

    return {
      target,
      eligible: true,
      currentType: target.geometry.type,
      suggestedType: GeometryType.CAPSULE,
      status: 'ready',
      reason: 'cylinder-to-capsule',
      nextGeometry: {
        ...normalizeGeometry(target.geometry),
        type: GeometryType.CAPSULE,
        dimensions: { ...converted.dimensions },
        origin: {
          xyz: { ...converted.origin.xyz },
          rpy: { ...converted.origin.rpy },
        },
      },
    };
  }

  if (
    target.geometry.type === GeometryType.BOX &&
    settings.rodBoxStrategy !== 'keep' &&
    isRodLikeBox(target.geometry)
  ) {
    const suggestedType =
      settings.rodBoxStrategy === 'capsule' ? GeometryType.CAPSULE : GeometryType.CYLINDER;
    const converted = convertGeometryType(
      target.geometry,
      suggestedType,
      undefined,
      settings.avoidSiblingOverlap ? clearanceContext : undefined,
    );

    return {
      target,
      eligible: true,
      currentType: target.geometry.type,
      suggestedType,
      status: 'ready',
      reason: settings.rodBoxStrategy === 'capsule' ? 'rod-box-to-capsule' : 'rod-box-to-cylinder',
      nextGeometry: {
        ...normalizeGeometry(target.geometry),
        type: suggestedType,
        dimensions: { ...converted.dimensions },
        origin: {
          xyz: { ...converted.origin.xyz },
          rpy: { ...converted.origin.rpy },
        },
      },
    };
  }

  return {
    target,
    eligible: false,
    currentType: target.geometry.type,
    suggestedType: null,
    status: 'no-rule-match',
  };
}

function buildCandidate(
  target: CollisionTargetRef,
  targets: CollisionTargetRef[],
  settings: CollisionOptimizationSettings,
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  clearanceWorld: CollisionOptimizationClearanceWorld | null,
): CollisionOptimizationCandidate {
  const clearanceContext = buildNearbyCollisionClearanceContext(
    targets,
    target,
    meshAnalysisByTargetId,
    clearanceWorld,
  );

  if (target.geometry.type === GeometryType.MESH) {
    return buildMeshCandidate(
      target,
      settings,
      meshAnalysisByTargetId[target.id],
      clearanceContext,
    );
  }

  return buildPrimitiveCandidate(target, settings, clearanceContext);
}

function shouldAnalyzeCoaxialMerge(
  settings: CollisionOptimizationSettings,
): settings is CollisionOptimizationSettings & {
  coaxialJointMergeStrategy: Exclude<CoaxialJointMergeStrategy, 'keep'>;
} {
  return settings.coaxialJointMergeStrategy !== 'keep';
}

function shouldIncludeCoaxialPairForScope(
  settings: CollisionOptimizationSettings,
  parentTarget: CollisionTargetRef,
  childTarget: CollisionTargetRef,
): boolean {
  switch (settings.scope) {
    case 'selected':
      return Boolean(
        settings.selectedTargetId &&
        (parentTarget.id === settings.selectedTargetId ||
          childTarget.id === settings.selectedTargetId),
      );
    case 'mesh':
      return (
        parentTarget.geometry.type === GeometryType.MESH ||
        childTarget.geometry.type === GeometryType.MESH
      );
    case 'primitive':
      return (
        parentTarget.geometry.type !== GeometryType.MESH &&
        childTarget.geometry.type !== GeometryType.MESH
      );
    case 'all':
    default:
      return true;
  }
}

function buildCoaxialMergeCandidateForJoint(
  joint: UrdfJoint,
  parentTarget: CollisionTargetRef,
  childTarget: CollisionTargetRef,
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  linkWorldMatrices: Record<string, THREE.Matrix4>,
  strategy: CollisionOptimizationManualMergeStrategy,
  conflictPriority: number,
): CollisionOptimizationCandidate | null {
  if (joint.type !== 'fixed' && joint.type !== 'revolute' && joint.type !== 'continuous') {
    return null;
  }

  if (parentTarget.componentId !== childTarget.componentId) {
    return null;
  }

  const parentLinkMatrix = linkWorldMatrices[joint.parentLinkId];
  const childLinkMatrix = linkWorldMatrices[joint.childLinkId];
  if (!parentLinkMatrix || !childLinkMatrix) {
    return null;
  }

  const jointAxisLocal = new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z);
  if (jointAxisLocal.lengthSq() <= 1e-12) {
    return null;
  }

  const jointWorldMatrix = parentLinkMatrix.clone().multiply(createOriginMatrix(joint.origin));
  const jointOriginWorld = new THREE.Vector3().setFromMatrixPosition(jointWorldMatrix);
  const jointAxisWorld = transformDirectionToWorld(jointWorldMatrix, jointAxisLocal.normalize());

  const parentDescriptor = buildPrimitiveAxisDescriptorForGeometry(
    parentTarget.geometry,
    meshAnalysisByTargetId[parentTarget.id],
    strategy,
    parentLinkMatrix,
    jointAxisWorld,
  );
  const childDescriptor = buildPrimitiveAxisDescriptorForGeometry(
    childTarget.geometry,
    meshAnalysisByTargetId[childTarget.id],
    strategy,
    childLinkMatrix,
    jointAxisWorld,
  );

  if (!parentDescriptor || !childDescriptor) {
    return null;
  }

  const parentAxisAlignment = Math.abs(parentDescriptor.axisWorld.dot(jointAxisWorld));
  const childAxisAlignment = Math.abs(childDescriptor.axisWorld.dot(jointAxisWorld));
  const mutualAxisAlignment = Math.abs(parentDescriptor.axisWorld.dot(childDescriptor.axisWorld));

  if (
    parentAxisAlignment < COAXIAL_AXIS_ALIGNMENT_DOT ||
    childAxisAlignment < COAXIAL_AXIS_ALIGNMENT_DOT ||
    mutualAxisAlignment < COAXIAL_AXIS_ALIGNMENT_DOT
  ) {
    return null;
  }

  const centerDelta = childDescriptor.centerWorld.clone().sub(parentDescriptor.centerWorld);
  const axialDelta = Math.abs(centerDelta.dot(jointAxisWorld));
  const lineOffset = centerDelta
    .sub(jointAxisWorld.clone().multiplyScalar(centerDelta.dot(jointAxisWorld)))
    .length();
  const maxRadius = Math.max(parentDescriptor.radius, childDescriptor.radius, COAXIAL_MIN_RADIUS);
  const radiusRatio =
    Math.max(parentDescriptor.radius, childDescriptor.radius) /
    Math.max(Math.min(parentDescriptor.radius, childDescriptor.radius), COAXIAL_MIN_RADIUS);
  const parentHalfExtent = Math.max(parentDescriptor.length / 2, COAXIAL_MIN_RADIUS);
  const childHalfExtent = Math.max(childDescriptor.length / 2, COAXIAL_MIN_RADIUS);
  const axialGap = Math.max(axialDelta - parentHalfExtent - childHalfExtent, 0);

  if (lineOffset > maxRadius * COAXIAL_AXIS_OFFSET_RATIO) {
    return null;
  }

  if (radiusRatio > COAXIAL_RADIUS_RATIO_LIMIT) {
    return null;
  }

  if (axialGap > Math.max(maxRadius * 1.15, COAXIAL_GAP_FLOOR)) {
    return null;
  }

  const mergedGeometry = buildCoaxialMergeGeometry({
    parentTarget,
    jointAxisWorld,
    jointOriginWorld,
    parentDescriptor,
    childDescriptor,
    parentLinkMatrix,
    strategy,
  });
  if (!mergedGeometry) {
    return null;
  }

  return {
    target: parentTarget,
    secondaryTarget: childTarget,
    eligible: true,
    currentType: parentTarget.geometry.type,
    suggestedType: strategy === 'capsule' ? GeometryType.CAPSULE : GeometryType.CYLINDER,
    status: 'ready',
    reason: strategy === 'capsule' ? 'coaxial-merge-to-capsule' : 'coaxial-merge-to-cylinder',
    nextGeometry: mergedGeometry,
    affectedTargetIds: [parentTarget.id, childTarget.id],
    conflictPriority,
    autoSelect: false,
    mutations: [
      {
        componentId: parentTarget.componentId,
        linkId: parentTarget.linkId,
        objectIndex: parentTarget.objectIndex,
        type: 'update',
        nextGeometry: mergedGeometry,
      },
      {
        componentId: childTarget.componentId,
        linkId: childTarget.linkId,
        objectIndex: childTarget.objectIndex,
        type: 'remove',
      },
    ],
  };
}

function buildCoaxialMergeCandidatesForRobot(
  robot: RobotData,
  settings: CollisionOptimizationSettings & {
    coaxialJointMergeStrategy: Exclude<CoaxialJointMergeStrategy, 'keep'>;
  },
  targets: CollisionTargetRef[],
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  componentId?: string,
): CollisionOptimizationCandidate[] {
  const candidates: CollisionOptimizationCandidate[] = [];
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const targetsByLink = new Map<string, CollisionTargetRef[]>();

  targets
    .filter((target) => target.componentId === componentId)
    .forEach((target) => {
      const key = target.linkId;
      const bucket = targetsByLink.get(key) ?? [];
      bucket.push(target);
      targetsByLink.set(key, bucket);
    });

  Object.values(robot.joints).forEach((joint) => {
    const parentTargets = targetsByLink.get(joint.parentLinkId) ?? [];
    const childTargets = targetsByLink.get(joint.childLinkId) ?? [];

    if (parentTargets.length !== 1 || childTargets.length !== 1) {
      return;
    }

    const parentTarget = parentTargets[0];
    const childTarget = childTargets[0];
    if (!shouldIncludeCoaxialPairForScope(settings, parentTarget, childTarget)) {
      return;
    }

    const candidate = buildCoaxialMergeCandidateForJoint(
      joint,
      parentTarget,
      childTarget,
      meshAnalysisByTargetId,
      linkWorldMatrices,
      settings.coaxialJointMergeStrategy,
      AUTO_COAXIAL_CONFLICT_PRIORITY,
    );

    if (candidate) {
      candidates.push(candidate);
    }
  });

  return candidates;
}

function buildManualMergeCandidatesForRobot(
  robot: RobotData,
  settings: CollisionOptimizationSettings,
  targets: CollisionTargetRef[],
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  componentId?: string,
): CollisionOptimizationCandidate[] {
  if (!settings.manualMergePairs?.length) {
    return [];
  }

  const candidates: CollisionOptimizationCandidate[] = [];
  const componentTargets = targets.filter((target) => target.componentId === componentId);
  const targetsById = new Map(componentTargets.map((target) => [target.id, target] as const));
  const joints = Object.values(robot.joints);
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const seenPairIds = new Set<string>();

  settings.manualMergePairs.forEach((pair) => {
    const firstTarget = targetsById.get(pair.primaryTargetId);
    const secondTarget = targetsById.get(pair.secondaryTargetId);

    if (!firstTarget || !secondTarget || firstTarget.id === secondTarget.id) {
      return;
    }

    let joint = joints.find(
      (entry) =>
        entry.parentLinkId === firstTarget.linkId && entry.childLinkId === secondTarget.linkId,
    );
    let parentTarget = firstTarget;
    let childTarget = secondTarget;

    if (!joint) {
      joint = joints.find(
        (entry) =>
          entry.parentLinkId === secondTarget.linkId && entry.childLinkId === firstTarget.linkId,
      );
      if (!joint) {
        return;
      }

      parentTarget = secondTarget;
      childTarget = firstTarget;
    }

    const pairKey = `${parentTarget.id}::${childTarget.id}`;
    if (seenPairIds.has(pairKey)) {
      return;
    }
    seenPairIds.add(pairKey);

    if (!shouldIncludeCoaxialPairForScope(settings, parentTarget, childTarget)) {
      return;
    }

    const candidate = buildCoaxialMergeCandidateForJoint(
      joint,
      parentTarget,
      childTarget,
      meshAnalysisByTargetId,
      linkWorldMatrices,
      pair.strategy ??
        (settings.coaxialJointMergeStrategy === 'keep'
          ? 'capsule'
          : settings.coaxialJointMergeStrategy),
      MANUAL_COAXIAL_CONFLICT_PRIORITY,
    );

    if (candidate) {
      candidates.push(candidate);
    }
  });

  return candidates;
}

function buildManualMergeCandidates(
  baseAnalysis: CollisionOptimizationBaseAnalysis,
  settings: CollisionOptimizationSettings,
): CollisionOptimizationCandidate[] {
  if (!settings.manualMergePairs?.length) {
    return [];
  }

  if (baseAnalysis.source.kind === 'robot') {
    return buildManualMergeCandidatesForRobot(
      baseAnalysis.source.robot,
      settings,
      baseAnalysis.targets,
      baseAnalysis.meshAnalysisByTargetId,
      undefined,
    );
  }

  return Object.values(baseAnalysis.source.assembly.components).flatMap((component) =>
    buildManualMergeCandidatesForRobot(
      component.robot,
      settings,
      baseAnalysis.targets,
      baseAnalysis.meshAnalysisByTargetId,
      component.id,
    ),
  );
}

function buildCoaxialMergeCandidates(
  baseAnalysis: CollisionOptimizationBaseAnalysis,
  settings: CollisionOptimizationSettings,
): CollisionOptimizationCandidate[] {
  if (!shouldAnalyzeCoaxialMerge(settings)) {
    return [];
  }

  if (baseAnalysis.source.kind === 'robot') {
    return buildCoaxialMergeCandidatesForRobot(
      baseAnalysis.source.robot,
      settings,
      baseAnalysis.targets,
      baseAnalysis.meshAnalysisByTargetId,
      undefined,
    );
  }

  return Object.values(baseAnalysis.source.assembly.components).flatMap((component) =>
    buildCoaxialMergeCandidatesForRobot(
      component.robot,
      settings,
      baseAnalysis.targets,
      baseAnalysis.meshAnalysisByTargetId,
      component.id,
    ),
  );
}

export function buildCollisionOptimizationAnalysis(
  baseAnalysis: CollisionOptimizationBaseAnalysis,
  settings: CollisionOptimizationSettings,
): CollisionOptimizationAnalysis {
  const filteredTargets = filterTargets(baseAnalysis.targets, settings);
  const candidates = filteredTargets.map((target) =>
    buildCandidate(
      target,
      baseAnalysis.targets,
      settings,
      baseAnalysis.meshAnalysisByTargetId,
      baseAnalysis.clearanceWorld,
    ),
  );
  candidates.push(...buildManualMergeCandidates(baseAnalysis, settings));
  candidates.push(...buildCoaxialMergeCandidates(baseAnalysis, settings));

  return {
    targets: baseAnalysis.targets,
    filteredTargets,
    candidates,
    meshAnalysisByTargetId: baseAnalysis.meshAnalysisByTargetId,
  };
}

export async function prepareCollisionOptimizationBaseAnalysis(
  source: CollisionOptimizationSource,
  assets: Record<string, string>,
  options: CollisionOptimizationAsyncOptions = {},
): Promise<CollisionOptimizationBaseAnalysis> {
  const targets = collectCollisionTargets(source);
  const meshTargets = targets.filter(
    (target) => target.geometry.type === GeometryType.MESH && Boolean(target.geometry.meshPath),
  );
  const meshAnalysisByTargetId: Record<string, MeshAnalysis | null> = {};
  const includeClearanceData = options.includeClearanceData ?? false;
  const includeMeshClearanceObstacles =
    options.includeMeshClearanceObstacles ?? includeClearanceData;
  const includePrimitiveFits = options.includePrimitiveFits ?? false;
  const clearancePointCollectionLimit = Math.max(options.pointCollectionLimit ?? 1024, 1);
  const clearanceSurfacePointLimit = Math.max(options.surfacePointLimit ?? 512, 1);
  const workerResults = await analyzeMeshBatchWithWorker({
    assets,
    tasks: meshTargets.map((target) => {
      const targetSourceFilePath = resolveCollisionTargetSourceFilePath(
        source,
        target,
        options.sourceFilePath,
      );

      return {
        targetId: target.id,
        cacheKey: createMeshAnalysisCacheKey(target.geometry, targetSourceFilePath),
        meshPath: target.geometry.meshPath!,
        dimensions: target.geometry.dimensions,
        sourceFilePath: targetSourceFilePath,
      };
    }),
    options: {
      includePrimitiveFits,
      includeSurfacePoints: includeMeshClearanceObstacles,
      pointCollectionLimit: includeMeshClearanceObstacles ? clearancePointCollectionLimit : 1,
      surfacePointLimit: includeMeshClearanceObstacles ? clearanceSurfacePointLimit : 1,
    },
    signal: options.signal,
  });

  meshTargets.forEach((target) => {
    throwIfAborted(options.signal);
    meshAnalysisByTargetId[target.id] = workerResults[target.id] ?? null;
  });

  throwIfAborted(options.signal);
  const clearanceWorld = includeClearanceData
    ? buildCollisionOptimizationClearanceWorld(source, targets, meshAnalysisByTargetId)
    : null;

  return {
    source,
    targets,
    meshAnalysisByTargetId,
    clearanceWorld,
  };
}

export async function buildCollisionClearanceContextForTarget(
  robot: RobotData,
  assets: Record<string, string>,
  linkId: string,
  objectIndex: number,
  options: Pick<
    CollisionOptimizationAsyncOptions,
    | 'includeMeshClearanceObstacles'
    | 'pointCollectionLimit'
    | 'surfacePointLimit'
    | 'sourceFilePath'
  > = {},
): Promise<{
  siblingGeometries?: UrdfVisual[];
  meshClearanceObstacles?: MeshClearanceObstacle[];
}> {
  const baseAnalysis = await prepareCollisionOptimizationBaseAnalysis(
    { kind: 'robot', robot },
    assets,
    {
      includeClearanceData: true,
      includeMeshClearanceObstacles: options.includeMeshClearanceObstacles,
      pointCollectionLimit: options.pointCollectionLimit,
      surfacePointLimit: options.surfacePointLimit,
      sourceFilePath: options.sourceFilePath,
    },
  );

  const target = baseAnalysis.targets.find(
    (entry) => entry.linkId === linkId && entry.objectIndex === objectIndex,
  );

  if (!target) {
    return {};
  }

  return buildNearbyCollisionClearanceContext(
    baseAnalysis.targets,
    target,
    baseAnalysis.meshAnalysisByTargetId,
    baseAnalysis.clearanceWorld,
    options.includeMeshClearanceObstacles ?? true,
  );
}

export async function buildCollisionOptimizationAnalysisAsync(
  baseAnalysis: CollisionOptimizationBaseAnalysis,
  settings: CollisionOptimizationSettings,
  options: CollisionOptimizationAsyncOptions = {},
): Promise<CollisionOptimizationAnalysis> {
  const filteredTargets = filterTargets(baseAnalysis.targets, settings);
  const candidates: CollisionOptimizationCandidate[] = [];
  const yieldEvery = Math.max(options.yieldEvery ?? DEFAULT_CANDIDATE_ANALYSIS_YIELD_EVERY, 1);

  for (let index = 0; index < filteredTargets.length; index += 1) {
    throwIfAborted(options.signal);

    const target = filteredTargets[index];
    candidates.push(
      buildCandidate(
        target,
        baseAnalysis.targets,
        settings,
        baseAnalysis.meshAnalysisByTargetId,
        baseAnalysis.clearanceWorld,
      ),
    );

    await maybeYieldAfterBatch(index, yieldEvery, options.signal);
  }

  candidates.push(...buildManualMergeCandidates(baseAnalysis, settings));
  candidates.push(...buildCoaxialMergeCandidates(baseAnalysis, settings));

  return {
    targets: baseAnalysis.targets,
    filteredTargets,
    candidates,
    meshAnalysisByTargetId: baseAnalysis.meshAnalysisByTargetId,
  };
}

export async function analyzeCollisionOptimization(
  source: CollisionOptimizationSource,
  assets: Record<string, string>,
  settings: CollisionOptimizationSettings,
): Promise<CollisionOptimizationAnalysis> {
  const baseAnalysis = await prepareCollisionOptimizationBaseAnalysis(source, assets, {
    includePrimitiveFits:
      settings.coaxialJointMergeStrategy !== 'keep' || Boolean(settings.manualMergePairs?.length),
  });
  return buildCollisionOptimizationAnalysisAsync(baseAnalysis, settings);
}

function computeBroadPhaseRadius(
  geometry: UrdfVisual,
  meshAnalysis?: MeshAnalysis | null,
): number | null {
  const dims = geometry.dimensions;

  switch (geometry.type) {
    case GeometryType.SPHERE:
      return Math.max(dims.x, 0);
    case GeometryType.BOX:
      return Math.hypot(dims.x, dims.y, dims.z) / 2;
    case GeometryType.CYLINDER:
      return Math.hypot(Math.max(dims.x, 0), Math.max(dims.y, 0) / 2);
    case GeometryType.CAPSULE:
      return Math.max(Math.max(dims.y, 0) / 2, Math.max(dims.x, 0));
    case GeometryType.MESH:
      if (!meshAnalysis) return null;
      return Math.hypot(meshAnalysis.bounds.x, meshAnalysis.bounds.y, meshAnalysis.bounds.z) / 2;
    default:
      return null;
  }
}

function computeBroadPhaseCenter(
  geometry: UrdfVisual,
  meshAnalysis?: MeshAnalysis | null,
): { x: number; y: number; z: number } {
  const origin = geometry.origin?.xyz ?? { x: 0, y: 0, z: 0 };

  if (geometry.type === GeometryType.MESH && meshAnalysis?.bounds) {
    return {
      x: origin.x + meshAnalysis.bounds.cx,
      y: origin.y + meshAnalysis.bounds.cy,
      z: origin.z + meshAnalysis.bounds.cz,
    };
  }

  return {
    x: origin.x,
    y: origin.y,
    z: origin.z,
  };
}

export function countSameLinkOverlapWarnings(
  targets: CollisionTargetRef[],
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  overridesByTargetId: Record<string, UrdfVisual | undefined> = {},
): number {
  const grouped = new Map<string, CollisionTargetRef[]>();
  targets.forEach((target) => {
    const key = getLinkGroupKey(target);
    const group = grouped.get(key) ?? [];
    group.push(target);
    grouped.set(key, group);
  });

  let overlapPairs = 0;

  grouped.forEach((groupTargets) => {
    for (let index = 0; index < groupTargets.length; index += 1) {
      const leftTarget = groupTargets[index];
      const leftGeometry = overridesByTargetId[leftTarget.id] ?? leftTarget.geometry;
      const leftRadius = computeBroadPhaseRadius(
        leftGeometry,
        meshAnalysisByTargetId[leftTarget.id],
      );
      if (!leftRadius || leftRadius <= 1e-8) continue;

      for (let innerIndex = index + 1; innerIndex < groupTargets.length; innerIndex += 1) {
        const rightTarget = groupTargets[innerIndex];
        const rightGeometry = overridesByTargetId[rightTarget.id] ?? rightTarget.geometry;
        const rightRadius = computeBroadPhaseRadius(
          rightGeometry,
          meshAnalysisByTargetId[rightTarget.id],
        );
        if (!rightRadius || rightRadius <= 1e-8) continue;

        const leftCenter = computeBroadPhaseCenter(
          leftGeometry,
          meshAnalysisByTargetId[leftTarget.id],
        );
        const rightCenter = computeBroadPhaseCenter(
          rightGeometry,
          meshAnalysisByTargetId[rightTarget.id],
        );
        const dx = leftCenter.x - rightCenter.x;
        const dy = leftCenter.y - rightCenter.y;
        const dz = leftCenter.z - rightCenter.z;
        const distance = Math.hypot(dx, dy, dz);

        if (distance + 1e-6 < leftRadius + rightRadius) {
          overlapPairs += 1;
        }
      }
    }
  });

  return overlapPairs;
}

export function buildCollisionOptimizationOperations(
  candidates: CollisionOptimizationCandidate[],
  checkedIds: Set<string>,
): CollisionOptimizationOperation[] {
  const consumedTargetIds = new Set<string>();

  return candidates
    .filter(
      (candidate) =>
        candidate.eligible &&
        candidate.nextGeometry &&
        checkedIds.has(candidate.target.id) &&
        candidate.reason,
    )
    .sort(
      (left, right) =>
        (right.conflictPriority ?? 0) - (left.conflictPriority ?? 0) ||
        (right.affectedTargetIds?.length ?? 1) - (left.affectedTargetIds?.length ?? 1),
    )
    .flatMap((candidate) => {
      const affectedTargetIds = candidate.affectedTargetIds ?? [candidate.target.id];
      if (affectedTargetIds.some((targetId) => consumedTargetIds.has(targetId))) {
        return [];
      }

      affectedTargetIds.forEach((targetId) => consumedTargetIds.add(targetId));
      const mutations = candidate.mutations?.length
        ? candidate.mutations.map((mutation) => ({
            ...mutation,
            nextGeometry: mutation.nextGeometry ? cloneGeometry(mutation.nextGeometry) : undefined,
          }))
        : [
            {
              componentId: candidate.target.componentId,
              linkId: candidate.target.linkId,
              objectIndex: candidate.target.objectIndex,
              type: 'update' as const,
              nextGeometry: cloneGeometry(candidate.nextGeometry!),
            },
          ];

      return [
        {
          id: candidate.target.id,
          componentId: candidate.target.componentId,
          linkId: candidate.target.linkId,
          objectIndex: candidate.target.objectIndex,
          nextGeometry: cloneGeometry(candidate.nextGeometry!),
          reason: candidate.reason!,
          fromTypes: [
            candidate.currentType,
            ...(candidate.secondaryTarget ? [candidate.secondaryTarget.geometry.type] : []),
          ],
          toType: candidate.suggestedType!,
          mutations,
          affectedTargetIds,
        },
      ];
    });
}

export function applyCollisionOptimizationOperationsToLinks(
  links: Record<string, UrdfLink>,
  operations: CollisionOptimizationOperation[],
): Record<string, UrdfLink> {
  const nextLinks: Record<string, UrdfLink> = { ...links };

  operations.forEach((operation) => {
    operation.mutations.forEach((mutation) => {
      const link = nextLinks[mutation.linkId];
      if (!link) return;

      if (mutation.type === 'remove') {
        nextLinks[mutation.linkId] = removeCollisionGeometryByObjectIndex(
          link,
          mutation.objectIndex,
        ).link;
        return;
      }

      if (mutation.nextGeometry) {
        nextLinks[mutation.linkId] = updateCollisionGeometryByObjectIndex(
          link,
          mutation.objectIndex,
          mutation.nextGeometry,
        );
      }
    });
  });

  return nextLinks;
}
