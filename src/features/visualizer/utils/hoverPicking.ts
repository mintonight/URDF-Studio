import * as THREE from 'three';
import type { InteractionHelperKind } from '@/types';
import type { VisualizerInteractiveLayer } from './interactiveLayerPriority';
import { isHoverSupportSurface } from '@/shared/utils/three/hoverSupportSurface';

export interface VisualizerHoverTarget {
  type: 'link' | 'joint';
  id: string;
  subType?: 'visual' | 'collision';
  objectIndex?: number;
  helperKind?: InteractionHelperKind;
}

export const VISUALIZER_HOVER_TARGET_KEY = '__visualizerHoverTarget';
export const VISUALIZER_INTERACTIVE_LAYER_KEY = '__visualizerInteractiveLayer';

type VisualizerObjectHit = Pick<THREE.Intersection<THREE.Object3D>, 'object' | 'distance'> & {
  point?: THREE.Vector3;
};

interface VisualizerHoverResolutionOptions {
  interactionLayerPriority?: readonly VisualizerInteractiveLayer[];
  deprioritizeSupportSurfaces?: boolean;
}

interface VisualizerHitCandidate {
  distance: number;
  layerScore: number;
  isHelper: boolean;
  target: VisualizerHoverTarget;
}

interface ResolvedVisualizerHit {
  distance: number;
  object: THREE.Object3D;
  isHelper: boolean;
  target: VisualizerHoverTarget;
  isSupportSurface: boolean;
}

const SUPPORT_SURFACE_HOVER_PENALTY = 10_000_000;
const SUPPORT_SURFACE_FOREGROUND_DISTANCE_EPSILON = 1e-3;
const HELPER_FOREGROUND_DISTANCE_EPSILON = 1e-3;
const INERTIA_OUTLINE_EDGE_BAND_RATIO = 0.12;
const MIN_INERTIA_OUTLINE_EDGE_BAND = 0.015;
const MAX_INERTIA_OUTLINE_EDGE_BAND = 0.08;
const INERTIA_SURFACE_EPSILON = 1e-4;

function hasPickableMaterial(material: THREE.Material | THREE.Material[] | undefined): boolean {
  if (!material) {
    return true;
  }

  const materials = Array.isArray(material) ? material : [material];
  return materials.some((entry) => {
    if (!entry || entry.visible === false) {
      return false;
    }

    const opacity = typeof entry.opacity === 'number' ? entry.opacity : 1;
    return opacity > 1e-3;
  });
}

function getObjectMaterials(object: THREE.Object3D | null): THREE.Material[] {
  const material = (object as { material?: THREE.Material | THREE.Material[] } | null)?.material;
  if (!material) {
    return [];
  }

  return Array.isArray(material) ? material.filter(Boolean) : [material];
}

function hasHelperAncestor(object: THREE.Object3D | null): boolean {
  let current = object;

  while (current) {
    if (current.userData?.isHelper === true) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

function hasOverlayMaterial(object: THREE.Object3D | null): boolean {
  const materials = getObjectMaterials(object);
  if (materials.length === 0) {
    return false;
  }

  return materials.some((entry) => {
    const materialWithOverlayFlags = entry as THREE.Material & {
      colorWrite?: boolean;
      depthTest?: boolean;
      depthWrite?: boolean;
    };

    return (
      materialWithOverlayFlags.depthTest === false ||
      materialWithOverlayFlags.depthWrite === false ||
      materialWithOverlayFlags.colorWrite === false
    );
  });
}

function hasOverlayPresentation(object: THREE.Object3D | null): boolean {
  let current = object;

  while (current) {
    if (current.renderOrder > 0 || hasOverlayMaterial(current)) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

function getEffectiveRenderOrder(object: THREE.Object3D | null): number {
  let current = object;
  let maxRenderOrder = 0;

  while (current) {
    if (Number.isFinite(current.renderOrder)) {
      maxRenderOrder = Math.max(maxRenderOrder, current.renderOrder);
    }
    current = current.parent;
  }

  return maxRenderOrder;
}

function getVisualizerInteractiveLayer(
  object: THREE.Object3D | null,
  target: VisualizerHoverTarget,
): VisualizerInteractiveLayer | null {
  let current = object;

  while (current) {
    const layer = current.userData?.[VISUALIZER_INTERACTIVE_LAYER_KEY] as
      | VisualizerInteractiveLayer
      | undefined;
    if (layer) {
      return layer;
    }
    current = current.parent;
  }

  if (target.subType === 'collision') {
    return 'collision';
  }

  if (target.subType === 'visual') {
    return 'visual';
  }

  return null;
}

function getInteractionLayerPriorityScore(
  object: THREE.Object3D | null,
  target: VisualizerHoverTarget,
  interactionLayerPriority: readonly VisualizerInteractiveLayer[] | undefined,
): number {
  if (!interactionLayerPriority || interactionLayerPriority.length === 0) {
    return 0;
  }

  const layer = getVisualizerInteractiveLayer(object, target);
  if (!layer) {
    return 0;
  }

  const layerIndex = interactionLayerPriority.indexOf(layer);
  if (layerIndex === -1) {
    return 0;
  }

  return (interactionLayerPriority.length - layerIndex) * 10_000;
}

function getTargetLayerScore(
  object: THREE.Object3D | null,
  target: VisualizerHoverTarget,
  options: VisualizerHoverResolutionOptions,
  supportSurfacePenalty = 0,
): number {
  const renderOrder = getEffectiveRenderOrder(object);
  const overlayBias = hasOverlayPresentation(object) ? 100_000 : 0;
  const helperBias = hasHelperAncestor(object) ? 1_000 : 0;
  const interactionLayerBias = getInteractionLayerPriorityScore(
    object,
    target,
    options.interactionLayerPriority,
  );
  const collisionBias = interactionLayerBias === 0 && target.subType === 'collision' ? 10_000 : 0;

  return (
    overlayBias +
    interactionLayerBias +
    collisionBias +
    helperBias +
    renderOrder -
    supportSurfacePenalty
  );
}

function preferVisualizerHitCandidate(
  current: VisualizerHitCandidate | null,
  next: VisualizerHitCandidate,
): VisualizerHitCandidate {
  if (!current) {
    return next;
  }

  if (current.isHelper !== next.isHelper) {
    const nextHelperInForeground =
      next.isHelper && next.distance + HELPER_FOREGROUND_DISTANCE_EPSILON < current.distance;
    if (nextHelperInForeground) {
      return next;
    }

    const currentHelperInForeground =
      current.isHelper && current.distance + HELPER_FOREGROUND_DISTANCE_EPSILON < next.distance;
    if (currentHelperInForeground) {
      return current;
    }
  }

  const layerDelta = next.layerScore - current.layerScore;
  if (Math.abs(layerDelta) > 1e-6) {
    return layerDelta > 0 ? next : current;
  }

  const distanceDelta = current.distance - next.distance;
  if (Math.abs(distanceDelta) > 1e-6) {
    return distanceDelta > 0 ? next : current;
  }

  return current;
}

function isVisibleInHierarchy(object: THREE.Object3D | null): boolean {
  let current = object;

  while (current) {
    if (!current.visible) {
      return false;
    }
    current = current.parent;
  }

  return true;
}

function collectResolvedVisualizerHits(
  hits: readonly VisualizerObjectHit[],
): ResolvedVisualizerHit[] {
  const resolvedHits: ResolvedVisualizerHit[] = [];

  for (const hit of hits) {
    const hitObject = hit.object;
    if (!isVisibleInHierarchy(hitObject)) {
      continue;
    }

    if (
      (hitObject as THREE.Mesh).isMesh &&
      !hasPickableMaterial((hitObject as THREE.Mesh).material)
    ) {
      continue;
    }

    const target = getVisualizerHoverTarget(hitObject);
    if (!target) {
      continue;
    }

    if (!shouldAcceptVisualizerHit(hit, target)) {
      continue;
    }

    resolvedHits.push({
      distance: hit.distance,
      object: hitObject,
      isHelper: hasHelperAncestor(hitObject),
      target,
      isSupportSurface: isHoverSupportSurface(hitObject),
    });
  }

  return resolvedHits;
}

function shouldAcceptVisualizerHit(
  hit: VisualizerObjectHit,
  target: VisualizerHoverTarget,
): boolean {
  if (target.helperKind !== 'inertia' || !(hit.object as THREE.Mesh).isMesh || !hit.point) {
    return true;
  }

  const mesh = hit.object as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!geometry) {
    return true;
  }

  if (geometry.boundingBox === null) {
    geometry.computeBoundingBox();
  }

  const boundingBox = geometry.boundingBox;
  if (!boundingBox) {
    return true;
  }

  const localPoint = mesh.worldToLocal(hit.point.clone());
  const centerX = (boundingBox.min.x + boundingBox.max.x) * 0.5;
  const centerY = (boundingBox.min.y + boundingBox.max.y) * 0.5;
  const centerZ = (boundingBox.min.z + boundingBox.max.z) * 0.5;
  const halfExtents = [
    Math.max((boundingBox.max.x - boundingBox.min.x) * 0.5, 0),
    Math.max((boundingBox.max.y - boundingBox.min.y) * 0.5, 0),
    Math.max((boundingBox.max.z - boundingBox.min.z) * 0.5, 0),
  ];
  const distancesToFace = [
    halfExtents[0] - Math.abs(localPoint.x - centerX),
    halfExtents[1] - Math.abs(localPoint.y - centerY),
    halfExtents[2] - Math.abs(localPoint.z - centerZ),
  ];

  let surfaceAxis = 0;
  for (let index = 1; index < distancesToFace.length; index += 1) {
    if (distancesToFace[index] < distancesToFace[surfaceAxis]) {
      surfaceAxis = index;
    }
  }

  if (distancesToFace[surfaceAxis] > INERTIA_SURFACE_EPSILON) {
    return true;
  }

  const otherMargins = distancesToFace.filter((_, index) => index !== surfaceAxis);
  const outlineDistance = Math.min(...otherMargins);
  const positiveHalfExtents = halfExtents.filter((value) => value > 0);
  const smallestHalfExtent = positiveHalfExtents.length > 0 ? Math.min(...positiveHalfExtents) : 0;
  const edgeBand = THREE.MathUtils.clamp(
    smallestHalfExtent * INERTIA_OUTLINE_EDGE_BAND_RATIO,
    MIN_INERTIA_OUTLINE_EDGE_BAND,
    MAX_INERTIA_OUTLINE_EDGE_BAND,
  );

  return outlineDistance <= edgeBand;
}

function shouldDeprioritizeSupportSurfaceHit(
  hit: ResolvedVisualizerHit,
  resolvedHits: readonly ResolvedVisualizerHit[],
  options: VisualizerHoverResolutionOptions,
): boolean {
  if (!options.deprioritizeSupportSurfaces || !hit.isSupportSurface) {
    return false;
  }

  return resolvedHits.some(
    (otherHit) =>
      otherHit !== hit &&
      !otherHit.isSupportSurface &&
      otherHit.distance + SUPPORT_SURFACE_FOREGROUND_DISTANCE_EPSILON < hit.distance,
  );
}

export function getVisualizerHoverTarget(
  object: THREE.Object3D | null,
): VisualizerHoverTarget | null {
  let current = object;

  while (current) {
    const target = current.userData?.[VISUALIZER_HOVER_TARGET_KEY] as
      | VisualizerHoverTarget
      | undefined;
    if (target) {
      return target;
    }
    current = current.parent;
  }

  return null;
}

export function createVisualizerHoverUserData(
  target: VisualizerHoverTarget,
  interactionLayer?: VisualizerInteractiveLayer,
) {
  return interactionLayer
    ? {
        [VISUALIZER_HOVER_TARGET_KEY]: target,
        [VISUALIZER_INTERACTIVE_LAYER_KEY]: interactionLayer,
      }
    : {
        [VISUALIZER_HOVER_TARGET_KEY]: target,
      };
}

export function findNearestVisualizerTargetFromHits(
  hits: readonly VisualizerObjectHit[],
  options: VisualizerHoverResolutionOptions = {},
): VisualizerHoverTarget | null {
  let bestCandidate: VisualizerHitCandidate | null = null;
  const resolvedHits = collectResolvedVisualizerHits(hits);

  for (const hit of resolvedHits) {
    const supportSurfacePenalty = shouldDeprioritizeSupportSurfaceHit(hit, resolvedHits, options)
      ? SUPPORT_SURFACE_HOVER_PENALTY
      : 0;
    bestCandidate = preferVisualizerHitCandidate(bestCandidate, {
      distance: hit.distance,
      layerScore: getTargetLayerScore(hit.object, hit.target, options, supportSurfacePenalty),
      isHelper: hit.isHelper,
      target: hit.target,
    });
  }

  return bestCandidate?.target ?? null;
}

export function resolveVisualizerInteractionTargetFromHits(
  object: THREE.Object3D | null,
  hits: readonly VisualizerObjectHit[],
  options: VisualizerHoverResolutionOptions = {},
): VisualizerHoverTarget | null {
  const directTarget = getVisualizerHoverTarget(object);
  const resolvedTarget = findNearestVisualizerTargetFromHits(hits, options);

  // Mesh inertia helpers use a visual fill plus an outline, so let the
  // narrowed hit list decide whether the user was actually targeting the
  // visible helper edge instead of blindly trusting the first mesh hit.
  if (
    directTarget &&
    !(directTarget.helperKind === 'inertia' && (object as THREE.Mesh | null)?.isMesh)
  ) {
    // When multiple helpers overlap, the front-most event target is not
    // enough. Re-run helper/helper conflicts through the shared hit resolver
    // so interaction-layer priority can pick the intended helper.
    if (directTarget.helperKind && resolvedTarget?.helperKind) {
      return resolvedTarget;
    }

    return directTarget;
  }

  return resolvedTarget;
}

export function findNearestVisualizerHoverTarget(
  root: THREE.Object3D | null,
  raycaster: THREE.Raycaster,
  options: VisualizerHoverResolutionOptions = {},
): VisualizerHoverTarget | null {
  if (!root) {
    return null;
  }

  const hits = raycaster.intersectObject(root, true);
  return findNearestVisualizerTargetFromHits(hits, {
    ...options,
    deprioritizeSupportSurfaces: true,
  });
}
