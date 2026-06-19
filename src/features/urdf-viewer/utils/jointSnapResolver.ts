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

/** Minimal structural view of a raycast hit (decoupled from THREE.Intersection for testability). */
export interface JointSnapHit {
  object: THREE.Object3D;
  point: THREE.Vector3;
  faceIndex?: number | null;
}

type MaybeUrdfLink = THREE.Object3D & { isURDFLink?: boolean };

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

function toWorldPose(
  pointWorld: THREE.Vector3,
  normalLocal: THREE.Vector3 | undefined,
  normalMatrix: THREE.Matrix3,
  matrixWorld: THREE.Matrix4,
  hintTangentWorld: THREE.Vector3,
): THREE.Matrix4 {
  // Surface normals must use the inverse-transpose so non-uniform mesh scale
  // does not skew the snap frame orientation.
  const normalWorld = normalLocal
    ? normalLocal.clone().applyMatrix3(normalMatrix).normalize()
    : new THREE.Vector3(0, 0, 1).transformDirection(matrixWorld);
  return makeFrameFromPointAndNormal(pointWorld, normalWorld, hintTangentWorld);
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
      poseWorld: toWorldPose(
        pointWorld,
        candidate.normalLocal,
        normalMatrix,
        matrixWorld,
        hintTangentWorld,
      ),
    };
  });

  if (!snapFilter || snapFilter.includes('bboxCenter')) {
    const center = getObjectWorldCenter(linkObject);
    const faceNormalLocal = localCandidates.find((candidate) => candidate.normalLocal)?.normalLocal;
    candidates.push({
      kind: 'bboxCenter',
      pointWorld: center,
      poseWorld: toWorldPose(center, faceNormalLocal, normalMatrix, matrixWorld, hintTangentWorld),
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Choose the candidate closest to the raw cursor hit so snapping feels direct.
  let chosen = candidates[0];
  let chosenDistance = chosen.pointWorld.distanceToSquared(hit.point);
  for (let i = 1; i < candidates.length; i += 1) {
    const distance = candidates[i].pointWorld.distanceToSquared(hit.point);
    if (distance < chosenDistance) {
      chosen = candidates[i];
      chosenDistance = distance;
    }
  }

  return {
    componentId: resolved.componentId,
    linkId: resolved.linkId,
    linkWorldMatrix: getObjectWorldPoseMatrix(linkObject),
    candidates,
    chosen,
  };
}
