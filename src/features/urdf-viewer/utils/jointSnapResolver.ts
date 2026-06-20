import * as THREE from 'three';

import type { AssemblyState } from '@/types';
import {
  collectSnapCandidatesFromFace,
  type SnapPointKind,
} from '@/core/geometry/meshSnapPoints';
import { makeFrameFromPointAndNormal } from '@/core/geometry/snapGeometry';

import { getObjectWorldCenter, getObjectWorldPoseMatrix } from './measurements.ts';

export interface ResolvedJointSnapCandidate {
  kind: SnapPointKind;
  pointWorld: THREE.Vector3;
  poseWorld: THREE.Matrix4;
}

export interface ResolvedJointSnap {
  componentId: string;
  linkId: string;
  linkWorldMatrix: THREE.Matrix4;
  candidates: ResolvedJointSnapCandidate[];
  chosen: ResolvedJointSnapCandidate;
}

export interface JointSnapResolveOptions {
  camera?: THREE.Camera;
  domSize?: { width: number; height: number };
  freePointOverride?: boolean;
}

/** Minimal structural view of a raycast hit (decoupled from THREE.Intersection for testability). */
export interface JointSnapHit {
  object: THREE.Object3D;
  point: THREE.Vector3;
  faceIndex?: number | null;
}

type MaybeUrdfLink = THREE.Object3D & { isURDFLink?: boolean };

interface WorldPoseInput {
  pointWorld: THREE.Vector3;
  normalLocal?: THREE.Vector3;
  normalMatrix: THREE.Matrix3;
  matrixWorld: THREE.Matrix4;
  hintTangentWorld: THREE.Vector3;
}

interface ScreenDistanceInput {
  a: THREE.Vector3;
  b: THREE.Vector3;
  camera: THREE.Camera;
  domSize: { width: number; height: number };
}

const SNAP_PROFILE: Record<SnapPointKind, { priority: number; radiusPx: number }> = {
  circleCenter: { priority: 100, radiusPx: 80 },
  faceCenter: { priority: 60, radiusPx: 40 },
  vertex: { priority: 55, radiusPx: 16 },
  edgeMidpoint: { priority: 50, radiusPx: 16 },
  bboxCenter: { priority: 45, radiusPx: 200 },
  surface: { priority: 0, radiusPx: 0 },
};

function findLinkAncestor(object: THREE.Object3D): THREE.Object3D | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if ((current as MaybeUrdfLink).isURDFLink || current.type === 'URDFLink') {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Map a merged-runtime link name back to its owning component + component-local
 * link id. Component robots are stored already prefixed (`${componentId}_...`),
 * so a direct key lookup works; we also fall back to matching by display name.
 * Inlined here (rather than importing `resolveAssemblySelection` from the
 * assembly feature) to keep urdf-viewer free of cross-feature dependencies.
 */
function resolveComponentAndLink(
  assemblyState: AssemblyState,
  linkName: string,
): { componentId: string; linkId: string } | null {
  for (const component of Object.values(assemblyState.components)) {
    const direct = component.robot.links[linkName];
    if (direct) {
      return { componentId: component.id, linkId: direct.id };
    }
    const byName = Object.values(component.robot.links).find((link) => link.name === linkName);
    if (byName) {
      return { componentId: component.id, linkId: byName.id };
    }
  }
  return null;
}

function toWorldPose(input: WorldPoseInput): THREE.Matrix4 {
  const { pointWorld, normalLocal, normalMatrix, matrixWorld, hintTangentWorld } = input;
  // Surface normals must use the inverse-transpose so non-uniform mesh scale
  // does not skew the snap frame orientation.
  const normalWorld = normalLocal
    ? normalLocal.clone().applyMatrix3(normalMatrix).normalize()
    : new THREE.Vector3(0, 0, 1).transformDirection(matrixWorld);
  return makeFrameFromPointAndNormal(pointWorld, normalWorld, hintTangentWorld);
}

function screenDistancePx(input: ScreenDistanceInput): number {
  const { a, b, camera, domSize } = input;
  const aNdc = a.clone().project(camera);
  const bNdc = b.clone().project(camera);
  const ax = (aNdc.x * 0.5 + 0.5) * domSize.width;
  const ay = (-aNdc.y * 0.5 + 0.5) * domSize.height;
  const bx = (bNdc.x * 0.5 + 0.5) * domSize.width;
  const by = (-bNdc.y * 0.5 + 0.5) * domSize.height;
  return Math.hypot(ax - bx, ay - by);
}

export function chooseSnapCandidate(
  candidates: ResolvedJointSnapCandidate[],
  hitPoint: THREE.Vector3,
  options: JointSnapResolveOptions = {},
): ResolvedJointSnapCandidate {
  const surface = candidates.find((candidate) => candidate.kind === 'surface');
  if (options.freePointOverride) {
    return surface ?? candidates[0];
  }

  const hasScreenMetric =
    Boolean(options.camera) &&
    Boolean(options.domSize) &&
    (options.domSize?.width ?? 0) > 0 &&
    (options.domSize?.height ?? 0) > 0;
  const eligible = candidates
    .map((candidate) => {
      const profile = SNAP_PROFILE[candidate.kind];
      if (profile.radiusPx <= 0) {
        return null;
      }
      const distance = hasScreenMetric
        ? screenDistancePx({
            a: candidate.pointWorld,
            b: hitPoint,
            camera: options.camera!,
            domSize: options.domSize!,
          })
        : candidate.pointWorld.distanceTo(hitPoint);
      if (hasScreenMetric && distance > profile.radiusPx) {
        return null;
      }
      return { candidate, distance, profile };
    })
    .filter((entry): entry is {
      candidate: ResolvedJointSnapCandidate;
      distance: number;
      profile: { priority: number; radiusPx: number };
    } => entry !== null);

  if (eligible.length === 0) {
    return surface ?? candidates[0];
  }

  eligible.sort((a, b) => {
    const priorityDelta = b.profile.priority - a.profile.priority;
    return priorityDelta || a.distance - b.distance;
  });
  return eligible[0].candidate;
}

/**
 * Resolve a raycast hit on the merged assembly runtime into joint-origin snap
 * candidates (world space). Returns null when the hit cannot be attributed to a
 * component link or carries no usable face.
 */
export function resolveJointSnapFromHit(
  hit: JointSnapHit,
  assemblyState: AssemblyState,
  snapFilter: SnapPointKind[] | null,
  options: JointSnapResolveOptions = {},
): ResolvedJointSnap | null {
  const mesh = hit.object as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!geometry || hit.faceIndex == null) {
    return null;
  }

  const linkObject = findLinkAncestor(mesh);
  if (!linkObject) {
    return null;
  }

  const resolved = resolveComponentAndLink(assemblyState, linkObject.name);
  if (!resolved) {
    return null;
  }

  const matrixWorld = mesh.matrixWorld;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  const localHit = mesh.worldToLocal(hit.point.clone());
  // Use a stable in-plane hint so the snap frame's tangent does not jitter.
  const hintTangentWorld = new THREE.Vector3(1, 0, 0).transformDirection(matrixWorld);

  const localCandidates = collectSnapCandidatesFromFace(geometry, hit.faceIndex, localHit, snapFilter);
  const candidates: ResolvedJointSnapCandidate[] = localCandidates.map((candidate) => {
    const pointWorld = candidate.pointLocal.clone().applyMatrix4(matrixWorld);
    return {
      kind: candidate.kind,
      pointWorld,
      poseWorld: toWorldPose({
        pointWorld,
        normalLocal: candidate.normalLocal,
        normalMatrix,
        matrixWorld,
        hintTangentWorld,
      }),
    };
  });

  if (!snapFilter || snapFilter.includes('bboxCenter')) {
    const center = getObjectWorldCenter(linkObject);
    const faceNormalLocal = localCandidates.find((candidate) => candidate.normalLocal)?.normalLocal;
    candidates.push({
      kind: 'bboxCenter',
      pointWorld: center,
      poseWorld: toWorldPose({
        pointWorld: center,
        normalLocal: faceNormalLocal,
        normalMatrix,
        matrixWorld,
        hintTangentWorld,
      }),
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  const chosen = chooseSnapCandidate(candidates, hit.point, options);

  return {
    componentId: resolved.componentId,
    linkId: resolved.linkId,
    linkWorldMatrix: getObjectWorldPoseMatrix(linkObject),
    candidates,
    chosen,
  };
}
