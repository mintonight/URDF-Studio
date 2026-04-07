import * as THREE from 'three';

import type { ViewerHelperKind, ViewerInteractiveLayer } from '../types';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import { hasPickableMaterial, isSelectableHelperObject, isVisibleInHierarchy } from './pickFilter';

export type UsdInteractiveGeometryRole = 'visual' | 'collision';

export interface ResolvedUsdHelperHit {
  type: 'link' | 'joint';
  id: string;
  helperKind: ViewerHelperKind;
  layer: ViewerInteractiveLayer;
}

export interface UsdGeometryInteractionCandidate<TMeta> {
  kind: 'geometry';
  distance: number;
  layer: UsdInteractiveGeometryRole;
  meta: TMeta;
  object: THREE.Object3D;
}

export interface UsdHelperInteractionCandidate {
  kind: 'helper';
  distance: number;
  layer: ViewerInteractiveLayer;
  object: THREE.Object3D;
  selection: ResolvedUsdHelperHit;
}

export type UsdInteractionCandidate<TMeta> =
  | UsdGeometryInteractionCandidate<TMeta>
  | UsdHelperInteractionCandidate;

function normalizeUsdPathToken(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

function findAncestor(
  object: THREE.Object3D | null,
  predicate: (candidate: THREE.Object3D) => boolean,
): THREE.Object3D | null {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (predicate(current)) {
      return current;
    }

    current = current.parent;
  }

  return null;
}

function resolveHelperKind(object: THREE.Object3D | null): ViewerHelperKind | null {
  let current: THREE.Object3D | null = object;

  while (current) {
    const explicitHelperKind = current.userData?.viewerHelperKind;
    if (
      explicitHelperKind === 'ik-handle' ||
      explicitHelperKind === 'center-of-mass' ||
      explicitHelperKind === 'inertia' ||
      explicitHelperKind === 'origin-axes' ||
      explicitHelperKind === 'joint-axis'
    ) {
      return explicitHelperKind;
    }

    switch (current.name) {
      case '__ik_handle__':
        return 'ik-handle';
      case '__com_visual__':
        return 'center-of-mass';
      case '__inertia_box__':
        return 'inertia';
      case '__origin_axes__':
        return 'origin-axes';
      case '__joint_axis__':
      case '__joint_axis_helper__':
        return 'joint-axis';
      default:
        break;
    }

    current = current.parent;
  }

  return null;
}

function resolveHelperLayer(helperKind: ViewerHelperKind): ViewerInteractiveLayer {
  switch (helperKind) {
    case 'ik-handle':
      return 'ik-handle';
    case 'origin-axes':
      return 'origin-axes';
    case 'joint-axis':
      return 'joint-axis';
    case 'center-of-mass':
      return 'center-of-mass';
    case 'inertia':
    default:
      return 'inertia';
  }
}

function resolveHelperLinkPath(object: THREE.Object3D | null): string | null {
  let current: THREE.Object3D | null = object;

  while (current) {
    const explicitLinkPath = normalizeUsdPathToken(current.userData?.usdLinkPath);
    if (explicitLinkPath) {
      return explicitLinkPath;
    }

    if (typeof current.name === 'string' && current.name.startsWith('origin:')) {
      return normalizeUsdPathToken(current.name.slice('origin:'.length));
    }

    if (typeof current.name === 'string' && current.name.startsWith('dynamics:')) {
      return normalizeUsdPathToken(current.name.slice('dynamics:'.length));
    }

    current = current.parent;
  }

  return null;
}

function resolveHelperJointId(
  object: THREE.Object3D,
  resolution: ViewerRobotDataResolution,
): string | null {
  const helperWithJointId = findAncestor(
    object,
    (candidate) =>
      typeof candidate.userData?.usdJointId === 'string' &&
      candidate.userData.usdJointId.trim().length > 0,
  );
  if (helperWithJointId) {
    return helperWithJointId.userData.usdJointId.trim();
  }

  const linkPath = resolveHelperLinkPath(object);
  if (!linkPath) {
    return null;
  }

  return (
    Object.entries(resolution.childLinkPathByJointId).find(
      ([, candidateLinkPath]) => normalizeUsdPathToken(candidateLinkPath) === linkPath,
    )?.[0] ?? null
  );
}

function resolveHelperLinkId(
  object: THREE.Object3D,
  resolution: ViewerRobotDataResolution,
): string | null {
  const linkPath = resolveHelperLinkPath(object);
  if (!linkPath) {
    return null;
  }

  return resolution.linkIdByPath[linkPath] ?? null;
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
  layer: ViewerInteractiveLayer,
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
): number {
  if (!interactionLayerPriority || interactionLayerPriority.length === 0) {
    return 0;
  }

  const layerIndex = interactionLayerPriority.indexOf(layer);
  if (layerIndex === -1) {
    return 0;
  }

  return (interactionLayerPriority.length - layerIndex) * 1_000_000;
}

function getInteractionScore<TMeta>(
  candidate: UsdInteractionCandidate<TMeta>,
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
): number {
  const layerPriorityScore = getInteractionLayerPriorityScore(
    candidate.layer,
    interactionLayerPriority,
  );
  const helperBias = layerPriorityScore === 0 && candidate.kind === 'helper' ? 100_000 : 0;
  const overlayBias = hasOverlayPresentation(candidate.object) ? 10_000 : 0;

  return layerPriorityScore + helperBias + overlayBias + getEffectiveRenderOrder(candidate.object);
}

export function sortUsdInteractionCandidates<TMeta>(
  candidates: readonly UsdInteractionCandidate<TMeta>[],
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
): UsdInteractionCandidate<TMeta>[] {
  return [...candidates].sort((left, right) => {
    const leftScore = getInteractionScore(left, interactionLayerPriority);
    const rightScore = getInteractionScore(right, interactionLayerPriority);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    return left.object.id - right.object.id;
  });
}

export function resolvePreferredUsdGeometryRole(options: {
  interactionLayerPriority?: readonly ViewerInteractiveLayer[];
  showVisual: boolean;
  showCollision: boolean;
  showCollisionAlwaysOnTop: boolean;
}): UsdInteractiveGeometryRole | null {
  const { interactionLayerPriority, showVisual, showCollision, showCollisionAlwaysOnTop } = options;

  if (interactionLayerPriority && interactionLayerPriority.length > 0) {
    for (const layer of interactionLayerPriority) {
      if (layer === 'visual' && showVisual) {
        return 'visual';
      }

      if (layer === 'collision' && showCollision) {
        return 'collision';
      }
    }
  }

  if (showVisual && showCollision) {
    return showCollisionAlwaysOnTop ? 'collision' : 'visual';
  }

  if (showCollision) {
    return 'collision';
  }

  if (showVisual) {
    return 'visual';
  }

  return null;
}

export function resolveUsdHelperHit(
  object: THREE.Object3D,
  resolution: ViewerRobotDataResolution | null | undefined,
): ResolvedUsdHelperHit | null {
  if (!resolution || !isSelectableHelperObject(object)) {
    return null;
  }

  const helperKind = resolveHelperKind(object);
  if (!helperKind) {
    return null;
  }

  if (helperKind === 'joint-axis') {
    const jointId = resolveHelperJointId(object, resolution);
    if (jointId) {
      return {
        type: 'joint',
        id: jointId,
        helperKind,
        layer: resolveHelperLayer(helperKind),
      };
    }
  }

  const linkId = resolveHelperLinkId(object, resolution);
  if (!linkId) {
    return null;
  }

  return {
    type: 'link',
    id: linkId,
    helperKind,
    layer: resolveHelperLayer(helperKind),
  };
}

export function isUsdPickableHelperObject(object: THREE.Object3D | null): boolean {
  if (!object || !isSelectableHelperObject(object) || !isVisibleInHierarchy(object)) {
    return false;
  }

  if (typeof (object as unknown as { raycast?: unknown }).raycast !== 'function') {
    return false;
  }

  const material = (object as THREE.Mesh & { material?: THREE.Material | THREE.Material[] })
    .material;
  return material === undefined || hasPickableMaterial(material);
}
