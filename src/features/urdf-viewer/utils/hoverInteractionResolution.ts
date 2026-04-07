import type * as THREE from 'three';

import type { ViewerInteractiveLayer } from '../types';
import type { ResolvedInteractionSelectionHit } from './selectionTargets';
import { isHoverSupportSurface } from '@/shared/utils/three/hoverSupportSurface';

export interface ResolvedHoverInteractionCandidate extends ResolvedInteractionSelectionHit {
  distance: number;
  screenSpaceProjected?: boolean;
}

export interface HoverInteractionResolution {
  primaryInteraction: ResolvedHoverInteractionCandidate | null;
}

const SUPPORT_SURFACE_HOVER_PENALTY = 10_000_000;
const SUPPORT_SURFACE_FOREGROUND_DISTANCE_EPSILON = 1e-3;
const SCREEN_SPACE_PROJECTED_HELPER_BIAS = 100_000_000;

function resolveCandidateLayer(
  candidate: ResolvedHoverInteractionCandidate,
): ViewerInteractiveLayer | null {
  if (candidate.targetKind === 'helper') {
    switch (candidate.helperKind) {
      case 'ik-handle':
        return 'ik-handle';
      case 'origin-axes':
        return 'origin-axes';
      case 'joint-axis':
        return 'joint-axis';
      case 'center-of-mass':
        return 'center-of-mass';
      case 'inertia':
        return 'inertia';
      default:
        return null;
    }
  }

  if (candidate.subType === 'collision') {
    return 'collision';
  }

  if (candidate.subType === 'visual') {
    return 'visual';
  }

  return null;
}

function getCandidateObject(candidate: ResolvedHoverInteractionCandidate): THREE.Object3D | null {
  return candidate.highlightTarget ?? candidate.linkObject ?? null;
}

function getStableObjectId(candidate: ResolvedHoverInteractionCandidate): number {
  return getCandidateObject(candidate)?.id ?? 0;
}

function getEffectiveRenderOrder(object: THREE.Object3D | null): number {
  let current: THREE.Object3D | null = object;
  let renderOrder = 0;

  while (current) {
    if (typeof current.renderOrder === 'number' && current.renderOrder > renderOrder) {
      renderOrder = current.renderOrder;
    }

    current = current.parent;
  }

  return renderOrder;
}

function hasOverlayPresentation(object: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (typeof current.renderOrder === 'number' && current.renderOrder > 0) {
      return true;
    }

    if ((current as THREE.Mesh).isMesh) {
      const material = (current as THREE.Mesh).material;
      const materials = Array.isArray(material) ? material : [material];
      if (materials.some((entry) => entry && entry.depthTest === false)) {
        return true;
      }
    }

    current = current.parent;
  }

  return false;
}

function getInteractionLayerPriorityScore(
  layer: ViewerInteractiveLayer | null,
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
): number {
  if (!layer || !interactionLayerPriority || interactionLayerPriority.length === 0) {
    return 0;
  }

  const layerIndex = interactionLayerPriority.indexOf(layer);
  if (layerIndex === -1) {
    return 0;
  }

  return (interactionLayerPriority.length - layerIndex) * 1_000_000;
}

function getInteractionScore(
  candidate: ResolvedHoverInteractionCandidate,
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
  supportSurfacePenalty = 0,
): number {
  const interactionLayer = resolveCandidateLayer(candidate);
  const candidateObject = getCandidateObject(candidate);
  const layerPriorityScore = getInteractionLayerPriorityScore(
    interactionLayer,
    interactionLayerPriority,
  );
  const helperBias = layerPriorityScore === 0 && candidate.targetKind === 'helper' ? 100_000 : 0;
  const overlayBias = hasOverlayPresentation(candidateObject) ? 10_000 : 0;
  const screenSpaceHelperBias = candidate.screenSpaceProjected
    ? SCREEN_SPACE_PROJECTED_HELPER_BIAS
    : 0;

  return (
    layerPriorityScore +
    helperBias +
    overlayBias +
    screenSpaceHelperBias +
    getEffectiveRenderOrder(candidateObject) -
    supportSurfacePenalty
  );
}

function isSupportSurfaceGeometryCandidate(candidate: ResolvedHoverInteractionCandidate): boolean {
  return (
    candidate.targetKind === 'geometry' && isHoverSupportSurface(getCandidateObject(candidate))
  );
}

function shouldDeprioritizeSupportSurfaceCandidate(
  candidate: ResolvedHoverInteractionCandidate,
  candidates: readonly ResolvedHoverInteractionCandidate[],
): boolean {
  if (!isSupportSurfaceGeometryCandidate(candidate)) {
    return false;
  }

  return candidates.some(
    (otherCandidate) =>
      otherCandidate !== candidate &&
      !isSupportSurfaceGeometryCandidate(otherCandidate) &&
      otherCandidate.distance + SUPPORT_SURFACE_FOREGROUND_DISTANCE_EPSILON < candidate.distance,
  );
}

export function resolveHoverInteractionResolution(
  candidates: ResolvedHoverInteractionCandidate[],
  interactionLayerPriority?: readonly ViewerInteractiveLayer[],
): HoverInteractionResolution {
  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftScore = getInteractionScore(
      left,
      interactionLayerPriority,
      shouldDeprioritizeSupportSurfaceCandidate(left, candidates)
        ? SUPPORT_SURFACE_HOVER_PENALTY
        : 0,
    );
    const rightScore = getInteractionScore(
      right,
      interactionLayerPriority,
      shouldDeprioritizeSupportSurfaceCandidate(right, candidates)
        ? SUPPORT_SURFACE_HOVER_PENALTY
        : 0,
    );

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    return getStableObjectId(left) - getStableObjectId(right);
  });

  return {
    primaryInteraction: sortedCandidates[0] ?? null,
  };
}
