import {
  GeometryType,
  JointType,
  type RobotState,
  type UrdfLink,
  type UrdfVisual,
} from '../../../../types/index.ts';
import { getVisualGeometryEntries } from '@/core/robot';

import { ORIGIN_EPSILON } from './internalTypes.ts';
import { mergeRobotMaterials, shouldAdoptSnapshotColor } from './usdExportMaterials.ts';

import type { RobotLike } from './internalTypes.ts';

export function hasNonIdentityOrigin(
  origin: Pick<NonNullable<UrdfVisual['origin']>, 'xyz' | 'rpy'> | null | undefined,
): boolean {
  if (!origin) {
    return false;
  }

  return (
    Math.abs(origin.xyz?.x || 0) > 1e-9 ||
    Math.abs(origin.xyz?.y || 0) > 1e-9 ||
    Math.abs(origin.xyz?.z || 0) > 1e-9 ||
    Math.abs(origin.rpy?.r || 0) > 1e-9 ||
    Math.abs(origin.rpy?.p || 0) > 1e-9 ||
    Math.abs(origin.rpy?.y || 0) > 1e-9
  );
}

function cloneAuthoredMaterials(
  authoredMaterials: UrdfVisual['authoredMaterials'],
): UrdfVisual['authoredMaterials'] {
  return Array.isArray(authoredMaterials)
    ? authoredMaterials.map((material) => ({ ...material }))
    : undefined;
}

function cloneMeshMaterialGroups(
  meshMaterialGroups: UrdfVisual['meshMaterialGroups'],
): UrdfVisual['meshMaterialGroups'] {
  return Array.isArray(meshMaterialGroups)
    ? meshMaterialGroups.map((group) => ({ ...group }))
    : undefined;
}

function resolveMergedVisualMaterialMetadata(
  current: UrdfVisual | undefined,
  fallback?: UrdfVisual,
): Pick<UrdfVisual, 'authoredMaterials' | 'meshMaterialGroups' | 'materialSource'> {
  const authoredMaterials =
    current?.authoredMaterials !== undefined
      ? current.authoredMaterials
      : cloneAuthoredMaterials(fallback?.authoredMaterials);
  const meshMaterialGroups =
    current?.meshMaterialGroups !== undefined
      ? current.meshMaterialGroups
      : cloneMeshMaterialGroups(fallback?.meshMaterialGroups);
  const materialSource = current?.materialSource ?? fallback?.materialSource;

  return {
    ...(authoredMaterials !== undefined ? { authoredMaterials } : {}),
    ...(meshMaterialGroups !== undefined ? { meshMaterialGroups } : {}),
    ...(materialSource !== undefined ? { materialSource } : {}),
  };
}

function resolveMergedVisualColor(
  current: UrdfVisual | undefined,
  fallback?: UrdfVisual,
): string | undefined {
  const currentColor = current?.color?.trim() || undefined;
  const fallbackColor = fallback?.color?.trim() || undefined;
  if (fallbackColor && shouldAdoptSnapshotColor(currentColor)) {
    return fallbackColor;
  }
  return currentColor;
}

function resolveMergedVisualMaterialFields(
  current: UrdfVisual | undefined,
  fallback?: UrdfVisual,
): Pick<UrdfVisual, 'authoredMaterials' | 'meshMaterialGroups' | 'materialSource'> &
  Partial<Pick<UrdfVisual, 'color'>> {
  const color = resolveMergedVisualColor(current, fallback);
  return {
    ...resolveMergedVisualMaterialMetadata(current, fallback),
    ...(color !== undefined ? { color } : {}),
  };
}

function originsApproximatelyEqual(
  left: NonNullable<UrdfVisual['origin']> | null | undefined,
  right: NonNullable<UrdfVisual['origin']> | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    Math.abs((left.xyz?.x || 0) - (right.xyz?.x || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.xyz?.y || 0) - (right.xyz?.y || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.xyz?.z || 0) - (right.xyz?.z || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.rpy?.r || 0) - (right.rpy?.r || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.rpy?.p || 0) - (right.rpy?.p || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.rpy?.y || 0) - (right.rpy?.y || 0)) <= ORIGIN_EPSILON
  );
}

export function cloneRobotState(input: RobotLike): RobotState {
  const cloned = structuredClone(input) as RobotLike;
  return {
    ...cloned,
    selection:
      'selection' in cloned
        ? { ...(cloned.selection || { type: null, id: null }) }
        : { type: null, id: null },
  };
}

function dimensionsApproximatelyEqual(
  left: UrdfVisual['dimensions'] | null | undefined,
  right: UrdfVisual['dimensions'] | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    Math.abs((left.x || 0) - (right.x || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.y || 0) - (right.y || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.z || 0) - (right.z || 0)) <= ORIGIN_EPSILON
  );
}

function canReuseFallbackMeshPath(current: UrdfVisual, fallback?: UrdfVisual): boolean {
  if (!fallback || current.type !== GeometryType.MESH || fallback.type !== GeometryType.MESH) {
    return false;
  }

  return (
    dimensionsApproximatelyEqual(current.dimensions, fallback.dimensions) &&
    originsApproximatelyEqual(current.origin, fallback.origin)
  );
}

function fillMeshPath(current: UrdfVisual, fallback?: UrdfVisual): UrdfVisual {
  const preservedMaterialMetadata = resolveMergedVisualMaterialFields(current, fallback);
  if (current.type !== GeometryType.MESH) {
    return {
      ...current,
      ...preservedMaterialMetadata,
    };
  }

  if (current.meshPath || !fallback?.meshPath || !canReuseFallbackMeshPath(current, fallback)) {
    return {
      ...current,
      ...preservedMaterialMetadata,
    };
  }

  return {
    ...current,
    ...preservedMaterialMetadata,
    meshPath: fallback.meshPath,
  };
}

function mergeGeometryWithSnapshot(
  current: UrdfVisual | undefined,
  fallback?: UrdfVisual,
): UrdfVisual | undefined {
  if (!current) {
    return fallback;
  }

  if (!fallback) {
    return current;
  }

  return fillMeshPath(current, fallback);
}

function mergeLinkWithSnapshotMeshPaths(current: UrdfLink, fallback?: UrdfLink): UrdfLink {
  if (!fallback) {
    return current;
  }

  const fallbackBodies = fallback.collisionBodies || [];
  const currentBodies = current.collisionBodies || [];
  const usedFallbackBodyIndexes = new Set<number>();
  const resolveFallbackBody = (
    currentBody: UrdfVisual,
    bodyIndex: number,
  ): UrdfVisual | undefined => {
    const indexedFallbackBody = fallbackBodies[bodyIndex];
    if (
      indexedFallbackBody &&
      !usedFallbackBodyIndexes.has(bodyIndex) &&
      canReuseFallbackMeshPath(currentBody, indexedFallbackBody)
    ) {
      usedFallbackBodyIndexes.add(bodyIndex);
      return indexedFallbackBody;
    }

    for (let index = 0; index < fallbackBodies.length; index += 1) {
      if (usedFallbackBodyIndexes.has(index)) {
        continue;
      }

      const candidate = fallbackBodies[index];
      if (!canReuseFallbackMeshPath(currentBody, candidate)) {
        continue;
      }

      usedFallbackBodyIndexes.add(index);
      return candidate;
    }

    return undefined;
  };

  // Keep the live robot as source of truth for geometry existence. Snapshot fallback
  // may only supplement missing meshPath on already-existing geometry records.
  const mergedBodies =
    currentBodies.length > 0
      ? currentBodies
          .map((currentBody, index) =>
            mergeGeometryWithSnapshot(currentBody, resolveFallbackBody(currentBody, index)),
          )
          .filter((body): body is UrdfVisual => Boolean(body))
      : current.collisionBodies;

  return {
    ...fallback,
    ...current,
    visual: mergeGeometryWithSnapshot(current.visual, fallback.visual) || current.visual,
    collision:
      mergeGeometryWithSnapshot(current.collision, fallback.collision) || current.collision,
    collisionBodies: mergedBodies,
  };
}

function mergeGeometryWithPreparedCache(
  current: UrdfVisual | undefined,
  fallback?: UrdfVisual,
): UrdfVisual | undefined {
  if (!current) {
    return fallback;
  }

  if (!fallback) {
    return current;
  }

  if (current.type === GeometryType.NONE && fallback.type !== GeometryType.NONE) {
    return fallback;
  }

  if (current.type !== GeometryType.MESH || fallback.type !== GeometryType.MESH) {
    return current;
  }

  return {
    ...fallback,
    ...current,
    ...resolveMergedVisualMaterialFields(current, fallback),
    meshPath: current.meshPath || fallback.meshPath,
  };
}

function mergeLinkWithPreparedCacheGeometry(current: UrdfLink, fallback?: UrdfLink): UrdfLink {
  if (!fallback) {
    return current;
  }

  const fallbackBodies = fallback.collisionBodies || [];
  const currentBodies = current.collisionBodies || [];
  const mergedBodies =
    currentBodies.length > 0
      ? currentBodies
          .map((currentBody, index) =>
            mergeGeometryWithPreparedCache(currentBody, fallbackBodies[index]),
          )
          .filter((body): body is UrdfVisual => Boolean(body))
      : fallback.collisionBodies;

  return {
    ...fallback,
    ...current,
    visual:
      mergeGeometryWithPreparedCache(current.visual, fallback.visual) ||
      current.visual ||
      fallback.visual,
    collision:
      mergeGeometryWithPreparedCache(current.collision, fallback.collision) ||
      current.collision ||
      fallback.collision,
    collisionBodies: mergedBodies,
  };
}

export function mergeCurrentRobotWithPreparedCacheGeometry(
  currentRobot: RobotLike,
  preparedRobot: RobotState,
): RobotState {
  const baseRobot = cloneRobotState(currentRobot);
  const mergedLinks: Record<string, UrdfLink> = {};
  const linkIds = new Set([...Object.keys(preparedRobot.links), ...Object.keys(baseRobot.links)]);

  linkIds.forEach((linkId) => {
    const currentLink = baseRobot.links[linkId];
    const preparedLink = preparedRobot.links[linkId];
    if (currentLink && preparedLink) {
      mergedLinks[linkId] = mergeLinkWithPreparedCacheGeometry(currentLink, preparedLink);
      return;
    }
    mergedLinks[linkId] = currentLink || preparedLink;
  });

  return {
    ...preparedRobot,
    ...baseRobot,
    rootLinkId:
      preparedRobot.rootLinkId && mergedLinks[preparedRobot.rootLinkId]
        ? preparedRobot.rootLinkId
        : baseRobot.rootLinkId,
    links: mergedLinks,
    joints: {
      ...preparedRobot.joints,
      ...baseRobot.joints,
    },
    materials: mergeRobotMaterials(baseRobot.materials, preparedRobot.materials),
    closedLoopConstraints: baseRobot.closedLoopConstraints || preparedRobot.closedLoopConstraints,
    selection:
      'selection' in currentRobot
        ? { ...((currentRobot as RobotState).selection || { type: null, id: null }) }
        : { type: null, id: null },
  };
}

export function mergeCurrentRobotWithSnapshotMeshPaths(
  currentRobot: RobotLike,
  snapshotRobot: RobotState,
): RobotState {
  const baseRobot = cloneRobotState(currentRobot);
  const mergedLinks: Record<string, UrdfLink> = {};
  const linkIds = new Set([...Object.keys(snapshotRobot.links), ...Object.keys(baseRobot.links)]);

  linkIds.forEach((linkId) => {
    const currentLink = baseRobot.links[linkId];
    const snapshotLink = snapshotRobot.links[linkId];
    if (currentLink && snapshotLink) {
      mergedLinks[linkId] = mergeLinkWithSnapshotMeshPaths(currentLink, snapshotLink);
      return;
    }
    mergedLinks[linkId] = currentLink || snapshotLink;
  });

  return {
    ...snapshotRobot,
    ...baseRobot,
    rootLinkId:
      snapshotRobot.rootLinkId && mergedLinks[snapshotRobot.rootLinkId]
        ? snapshotRobot.rootLinkId
        : baseRobot.rootLinkId,
    links: mergedLinks,
    joints: {
      ...snapshotRobot.joints,
      ...baseRobot.joints,
    },
    materials: mergeRobotMaterials(baseRobot.materials, snapshotRobot.materials),
    closedLoopConstraints: baseRobot.closedLoopConstraints || snapshotRobot.closedLoopConstraints,
    selection:
      'selection' in currentRobot
        ? { ...((currentRobot as RobotState).selection || { type: null, id: null }) }
        : { type: null, id: null },
  };
}

function isSyntheticWorldLink(link: UrdfLink | undefined): boolean {
  if (!link) {
    return false;
  }

  return (
    getVisualGeometryEntries(link).length === 0 &&
    link.collision.type === GeometryType.NONE &&
    (link.inertial?.mass || 0) <= 1e-9
  );
}

export function stripSyntheticWorldRootForExport(robot: RobotState): RobotState {
  if (robot.rootLinkId !== 'world' || !isSyntheticWorldLink(robot.links.world)) {
    return robot;
  }

  const worldChildJoints = Object.values(robot.joints).filter(
    (joint) => joint.parentLinkId === 'world',
  );
  if (worldChildJoints.length !== 1) {
    return robot;
  }

  const rootAnchorJoint = worldChildJoints[0];
  if (rootAnchorJoint.type !== JointType.FIXED || !robot.links[rootAnchorJoint.childLinkId]) {
    return robot;
  }

  if (hasNonIdentityOrigin(rootAnchorJoint.origin)) {
    return robot;
  }

  const nextLinks = { ...robot.links };
  delete nextLinks.world;

  const nextJoints = { ...robot.joints };
  delete nextJoints[rootAnchorJoint.id];

  return {
    ...robot,
    rootLinkId: rootAnchorJoint.childLinkId,
    links: nextLinks,
    joints: nextJoints,
  };
}
