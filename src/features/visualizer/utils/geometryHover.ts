import type * as THREE from 'three';

import { findNearestVisualizerTargetFromHits } from './hoverPicking';
import type { VisualizerInteractiveLayer } from './interactiveLayerPriority';

interface HoverSelectionLike {
  type: 'link' | 'joint' | 'tendon' | null;
  id: string | null;
  subType?: 'visual' | 'collision';
  objectIndex?: number;
  helperKind?: string;
}

type GeometryHoverHit = Pick<THREE.Intersection<THREE.Object3D>, 'object' | 'distance'>;

export interface GeometryHoverTargetSelection {
  type: 'link';
  id: string;
  subType: 'visual' | 'collision';
  objectIndex?: number;
}

export function createGeometryHoverTargetSelection(
  linkId: string,
  subType: 'visual' | 'collision',
  objectIndex?: number,
): GeometryHoverTargetSelection {
  return subType === 'collision'
    ? { type: 'link', id: linkId, subType, objectIndex: objectIndex ?? 0 }
    : { type: 'link', id: linkId, subType };
}

export function resolveGeometryHoverTargetFromHits(
  fallbackTarget: GeometryHoverTargetSelection,
  hits: readonly GeometryHoverHit[],
  options: {
    interactionLayerPriority?: readonly VisualizerInteractiveLayer[];
  } = {},
): GeometryHoverTargetSelection | null {
  const prioritizedTarget = findNearestVisualizerTargetFromHits(hits, {
    ...options,
    deprioritizeSupportSurfaces: true,
  });

  if (!prioritizedTarget) {
    return fallbackTarget;
  }

  if (prioritizedTarget.type !== 'link' || !prioritizedTarget.subType) {
    return null;
  }

  return createGeometryHoverTargetSelection(
    prioritizedTarget.id,
    prioritizedTarget.subType,
    prioritizedTarget.objectIndex,
  );
}

export function matchesGeometryHoverSelection(
  hoveredSelection: HoverSelectionLike,
  target: GeometryHoverTargetSelection,
  options: {
    allowLabelHoverFallback?: boolean;
  } = {},
): boolean {
  if (hoveredSelection.type !== 'link' || hoveredSelection.id !== target.id) {
    return false;
  }

  if (!hoveredSelection.subType) {
    if (hoveredSelection.helperKind) {
      return false;
    }

    return (options.allowLabelHoverFallback ?? true) && target.subType === 'visual';
  }

  if (hoveredSelection.subType !== target.subType) {
    return false;
  }

  if (target.subType === 'collision') {
    return (hoveredSelection.objectIndex ?? 0) === (target.objectIndex ?? 0);
  }

  if (hoveredSelection.objectIndex === undefined || target.objectIndex === undefined) {
    return true;
  }

  return hoveredSelection.objectIndex === target.objectIndex;
}
