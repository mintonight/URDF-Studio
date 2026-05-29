import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
  type UrdfVisual,
} from '../../../../types/index.ts';
import { getVisualGeometryEntries } from '@/core/robot';

import { resolveUsdPrimitiveGeometryFromDescriptor as resolvePrimitiveGeometryFromDescriptor } from '../usdPrimitiveGeometry.ts';
import type { ViewerRobotDataResolution } from '../viewerRobotData.ts';

import {
  getDescriptorLinkPath,
  getDescriptorRole,
  getDescriptorSemanticName,
  normalizeSemanticToken,
  normalizeUsdPath,
  parseDescriptorOrdinal,
  sanitizeFileToken,
} from './usdExportPaths.ts';
import {
  applyDescriptorMaterialToLink,
  applySnapshotMaterialRecordToLink,
  applyVisualMaterialFallbackToLink,
  buildGeomSubsetDisplayColors,
  buildGeomSubsetMaterialGroups,
  colorArrayToVertexColor,
  colorHexToVertexColor,
  getDescriptorMaterialRecord,
  getSnapshotMaterialLookup,
  getSnapshotPreferredVisualMaterialLookup,
  hasNonEmptyTexturePath,
  mergeRobotMaterials,
  resolveVisualMaterialFallbackForDescriptor,
  shouldAdoptSnapshotColor,
  snapshotMaterialUsesTextureCoordinates,
  visualUsesTextureCoordinates,
} from './usdExportMaterials.ts';
import { ORIGIN_EPSILON } from './internalTypes.ts';

import type {
  ExportDescriptor,
  RobotLike,
  SnapshotMaterialRecord,
  SnapshotMeshDescriptor,
  UsdExportSnapshot,
} from './internalTypes.ts';

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

function cloneVisualOrigin(
  origin: NonNullable<UrdfVisual['origin']> | null | undefined,
): NonNullable<UrdfVisual['origin']> {
  return {
    xyz: {
      x: origin?.xyz?.x || 0,
      y: origin?.xyz?.y || 0,
      z: origin?.xyz?.z || 0,
    },
    rpy: {
      r: origin?.rpy?.r || 0,
      p: origin?.rpy?.p || 0,
      y: origin?.rpy?.y || 0,
    },
  };
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

function mergeCurrentRobotWithSnapshotMeshPaths(
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

function ensureMeshDimensions(
  dimensions: UrdfVisual['dimensions'] | null | undefined,
): UrdfVisual['dimensions'] {
  if (!dimensions) {
    return { x: 1, y: 1, z: 1 };
  }

  const values = [dimensions.x, dimensions.y, dimensions.z];
  const hasMeaningfulDimension = values.some(
    (value) => Number.isFinite(value) && Math.abs(value) > 1e-9,
  );
  return hasMeaningfulDimension ? dimensions : { x: 1, y: 1, z: 1 };
}

function buildFixedChildLinksByParent(robot: RobotState): Map<string, string[]> {
  const result = new Map<string, string[]>();

  Object.values(robot.joints).forEach((joint) => {
    if (joint.type !== JointType.FIXED) {
      return;
    }

    const list = result.get(joint.parentLinkId) || [];
    list.push(joint.childLinkId);
    result.set(joint.parentLinkId, list);
  });

  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getGeomSuffixOrder(candidate: string, parentLinkId: string, parentName: string): number {
  const patterns = [
    new RegExp(`^${escapeRegExp(parentLinkId)}_geom_(\\d+)$`),
    new RegExp(`^${escapeRegExp(parentName)}_geom_(\\d+)$`),
  ];

  for (const pattern of patterns) {
    const match = candidate.match(pattern);
    if (match) {
      const numeric = Number(match[1]);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
  }

  return Number.POSITIVE_INFINITY;
}

function getLinkSemanticCandidates(link: UrdfLink): string[] {
  const candidates = [normalizeSemanticToken(link.id), normalizeSemanticToken(link.name)].filter(
    Boolean,
  );

  return Array.from(new Set(candidates));
}

function scoreDescriptorAgainstLink(descriptor: SnapshotMeshDescriptor, link: UrdfLink): number {
  const descriptorToken = normalizeSemanticToken(getDescriptorSemanticName(descriptor));
  if (!descriptorToken) {
    return 0;
  }

  let bestScore = 0;
  getLinkSemanticCandidates(link).forEach((candidate) => {
    if (candidate === descriptorToken) {
      bestScore = Math.max(bestScore, 8);
      return;
    }

    if (candidate.endsWith(`_${descriptorToken}`) || candidate.startsWith(`${descriptorToken}_`)) {
      bestScore = Math.max(bestScore, 6);
      return;
    }

    if (candidate.includes(descriptorToken) || descriptorToken.includes(candidate)) {
      bestScore = Math.max(bestScore, 4);
    }
  });

  return bestScore;
}

function isVisualAttachmentLink(
  link: UrdfLink | undefined,
  parentLinkId: string,
  parentName: string,
): boolean {
  if (!link) {
    return false;
  }

  const zeroMass = (link.inertial?.mass || 0) <= 1e-9;
  const visualPresent = link.visual.type !== GeometryType.NONE;
  const collisionOnly =
    link.visual.type === GeometryType.NONE && link.collision.type !== GeometryType.NONE;
  const syntheticName =
    getGeomSuffixOrder(link.id, parentLinkId, parentName) !== Number.POSITIVE_INFINITY ||
    getGeomSuffixOrder(link.name, parentLinkId, parentName) !== Number.POSITIVE_INFINITY;

  return !collisionOnly && (syntheticName || (zeroMass && visualPresent));
}

function sortVisualAttachmentLinkIds(
  robot: RobotState,
  parentLinkId: string,
  candidateIds: string[],
): string[] {
  const parent = robot.links[parentLinkId];
  const parentName = parent?.name || parentLinkId;

  return [...candidateIds].sort((leftId, rightId) => {
    const leftLink = robot.links[leftId];
    const rightLink = robot.links[rightId];
    const leftOrder = getGeomSuffixOrder(leftId, parentLinkId, parentName);
    const rightOrder = getGeomSuffixOrder(rightId, parentLinkId, parentName);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    const leftName = leftLink?.name || leftId;
    const rightName = rightLink?.name || rightId;
    return leftName.localeCompare(rightName);
  });
}

function collectVisualAttachmentLinkIds(
  robot: RobotState,
  parentLinkId: string,
  fixedChildrenByParent: Map<string, string[]>,
): string[] {
  const parent = robot.links[parentLinkId];
  if (!parent) {
    return [];
  }

  const childIds = (fixedChildrenByParent.get(parentLinkId) || []).filter((childId) =>
    isVisualAttachmentLink(robot.links[childId], parentLinkId, parent.name),
  );

  return [parentLinkId, ...sortVisualAttachmentLinkIds(robot, parentLinkId, childIds)];
}

function createUniqueRobotRecordKey(
  existing: Record<string, unknown>,
  preferredKeys: string[],
  fallbackKey: string,
): string {
  const candidates = [...preferredKeys, fallbackKey]
    .map((value) => sanitizeFileToken(value))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!existing[candidate]) {
      return candidate;
    }
  }

  const base = sanitizeFileToken(fallbackKey);
  let suffix = 2;
  while (existing[`${base}_${suffix}`]) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

function createSyntheticVisualAttachmentLink(
  robot: RobotState,
  parentLinkId: string,
  descriptor: SnapshotMeshDescriptor,
  ordinal: number,
): string {
  const descriptorToken = normalizeSemanticToken(getDescriptorSemanticName(descriptor));
  const linkId = createUniqueRobotRecordKey(
    robot.links,
    [
      descriptorToken ? `${descriptorToken}_link` : '',
      descriptorToken ? `${parentLinkId}_${descriptorToken}` : '',
    ],
    `${parentLinkId}_geom_${ordinal}`,
  );
  const jointId = createUniqueRobotRecordKey(
    robot.joints,
    [`fixed_${linkId}`],
    `${parentLinkId}_fixed_${linkId}`,
  );

  robot.links[linkId] = {
    ...DEFAULT_LINK,
    id: linkId,
    name: linkId,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.MESH,
      dimensions: { x: 1, y: 1, z: 1 },
      origin: { ...DEFAULT_LINK.visual.origin },
    },
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      origin: { ...DEFAULT_LINK.collision.origin },
    },
    inertial: {
      ...DEFAULT_LINK.inertial,
      mass: 0,
    },
  };

  robot.joints[jointId] = {
    ...DEFAULT_JOINT,
    id: jointId,
    name: jointId,
    type: JointType.FIXED,
    parentLinkId,
    childLinkId: linkId,
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    axis: { x: 0, y: 0, z: 1 },
    limit: undefined as UrdfJoint['limit'],
  };

  return linkId;
}

function assignVisualDescriptorToLink(
  snapshot: UsdExportSnapshot,
  robot: RobotState,
  linkId: string,
  entry: ExportDescriptor,
  descriptorByPath: Map<string, ExportDescriptor>,
  materialLookup: Map<string, SnapshotMaterialRecord>,
  preferredMaterialRecord?: SnapshotMaterialRecord | null,
  explicitMaterialFallback?: {
    color?: string;
    texture?: string;
  } | null,
): void {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const descriptorMaterialRecord = getDescriptorMaterialRecord(entry, materialLookup);
  const explicitFallbackColor = colorHexToVertexColor(explicitMaterialFallback?.color);
  const preferredFallbackColor = colorArrayToVertexColor(preferredMaterialRecord?.color);
  entry.writeTextureCoordinates =
    snapshotMaterialUsesTextureCoordinates(descriptorMaterialRecord) ||
    snapshotMaterialUsesTextureCoordinates(preferredMaterialRecord) ||
    hasNonEmptyTexturePath(explicitMaterialFallback?.texture) ||
    visualUsesTextureCoordinates(link.visual);
  entry.displayColor =
    colorArrayToVertexColor(descriptorMaterialRecord?.color) ||
    explicitFallbackColor ||
    preferredFallbackColor;

  const primitiveGeometry = resolvePrimitiveGeometryFromDescriptor(
    entry.descriptor,
    link.visual,
    snapshot,
  );
  if (primitiveGeometry) {
    link.visual = {
      ...DEFAULT_LINK.visual,
      ...(link.visual || {}),
      ...primitiveGeometry,
      meshPath: undefined,
      origin: link.visual?.origin || { ...DEFAULT_LINK.visual.origin },
    };
    const appliedMaterial = applyDescriptorMaterialToLink(robot, linkId, entry, materialLookup);
    if (
      !appliedMaterial &&
      !applyVisualMaterialFallbackToLink(robot, linkId, explicitMaterialFallback)
    ) {
      applySnapshotMaterialRecordToLink(robot, linkId, preferredMaterialRecord);
    }
    return;
  }

  const visual = link.visual;
  link.visual = {
    ...DEFAULT_LINK.visual,
    ...(visual || {}),
    type: GeometryType.MESH,
    meshPath: entry.exportPath,
    doubleSided: true,
    dimensions: ensureMeshDimensions(visual?.dimensions),
    origin: visual?.origin || { ...DEFAULT_LINK.visual.origin },
  };
  entry.bakeTransformIntoMesh = !hasNonIdentityOrigin(link.visual.origin);
  descriptorByPath.set(entry.exportPath, entry);
  const appliedMaterial = applyDescriptorMaterialToLink(robot, linkId, entry, materialLookup);
  if (
    !appliedMaterial &&
    !applyVisualMaterialFallbackToLink(robot, linkId, explicitMaterialFallback)
  ) {
    applySnapshotMaterialRecordToLink(robot, linkId, preferredMaterialRecord);
  }
  const meshMaterialGroups = buildGeomSubsetMaterialGroups(entry.descriptor, link.visual);
  const subsetDisplayColors = buildGeomSubsetDisplayColors(entry.descriptor, link.visual);
  if (meshMaterialGroups) {
    link.visual = {
      ...link.visual,
      meshMaterialGroups,
    };
  }
  if (subsetDisplayColors) {
    entry.subsetDisplayColors = subsetDisplayColors;
  }
}

function assignCollisionDescriptorToLink(
  snapshot: UsdExportSnapshot,
  robot: RobotState,
  linkId: string,
  entry: ExportDescriptor,
  descriptorByPath: Map<string, ExportDescriptor>,
  collisionIndex: number,
): void {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const currentCollision =
    collisionIndex === 0 ? link.collision : link.collisionBodies?.[collisionIndex - 1];
  const primitiveGeometry = resolvePrimitiveGeometryFromDescriptor(
    entry.descriptor,
    currentCollision,
    snapshot,
  );
  if (primitiveGeometry) {
    const nextCollision = {
      ...DEFAULT_LINK.collision,
      ...(currentCollision || {}),
      ...primitiveGeometry,
      meshPath: undefined,
      origin: currentCollision?.origin || { ...DEFAULT_LINK.collision.origin },
    };

    if (collisionIndex === 0) {
      link.collision = nextCollision;
      return;
    }

    const bodies = [...(link.collisionBodies || [])];
    bodies[collisionIndex - 1] = nextCollision;
    link.collisionBodies = bodies;
    return;
  }

  const sanitizedCollision = currentCollision;
  if (collisionIndex === 0) {
    link.collision = {
      ...DEFAULT_LINK.collision,
      ...(sanitizedCollision || {}),
      type: GeometryType.MESH,
      meshPath: entry.exportPath,
      dimensions: ensureMeshDimensions(sanitizedCollision?.dimensions),
      origin: sanitizedCollision?.origin || { ...DEFAULT_LINK.collision.origin },
    };
    entry.bakeTransformIntoMesh = !hasNonIdentityOrigin(link.collision.origin);
    descriptorByPath.set(entry.exportPath, entry);
    return;
  }

  const bodies = [...(link.collisionBodies || [])];
  const currentBody = sanitizedCollision;
  bodies[collisionIndex - 1] = {
    ...DEFAULT_LINK.collision,
    ...(currentBody || {}),
    type: GeometryType.MESH,
    meshPath: entry.exportPath,
    dimensions: ensureMeshDimensions(currentBody?.dimensions),
    origin: currentBody?.origin || { ...DEFAULT_LINK.collision.origin },
  };
  link.collisionBodies = bodies;
  entry.bakeTransformIntoMesh = !hasNonIdentityOrigin(bodies[collisionIndex - 1]?.origin);
  descriptorByPath.set(entry.exportPath, entry);
}

function assignLinkDescriptors(
  snapshot: UsdExportSnapshot,
  robot: RobotState,
  linkId: string,
  linkPath: string,
  visualDescriptors: ExportDescriptor[],
  collisionDescriptors: ExportDescriptor[],
  descriptorByPath: Map<string, ExportDescriptor>,
  materialLookup: Map<string, SnapshotMaterialRecord>,
  preferredMaterialLookup: Map<string, SnapshotMaterialRecord>,
  fixedChildrenByParent: Map<string, string[]>,
): void {
  if (!robot.links[linkId]) {
    return;
  }

  const visualLinkIds = collectVisualAttachmentLinkIds(robot, linkId, fixedChildrenByParent);
  const usedVisualLinkIds = new Set<string>();
  const preferredMaterialRecord = preferredMaterialLookup.get(normalizeUsdPath(linkPath)) || null;
  const sourceLink = robot.links[linkId];

  visualDescriptors.forEach((entry, index) => {
    let targetLinkId: string | undefined;
    const explicitMaterialFallback = resolveVisualMaterialFallbackForDescriptor(
      sourceLink,
      entry,
      index,
    );

    if (index === 0) {
      targetLinkId = linkId;
    } else {
      const availableLinkIds = visualLinkIds.filter(
        (candidateId) => candidateId !== linkId && !usedVisualLinkIds.has(candidateId),
      );

      let bestMatchId: string | undefined;
      let bestScore = 0;
      availableLinkIds.forEach((candidateId) => {
        const candidateLink = robot.links[candidateId];
        const score = candidateLink
          ? scoreDescriptorAgainstLink(entry.descriptor, candidateLink)
          : 0;
        if (score > bestScore) {
          bestScore = score;
          bestMatchId = candidateId;
        }
      });

      targetLinkId = bestMatchId || availableLinkIds[0];
      if (!targetLinkId) {
        targetLinkId = createSyntheticVisualAttachmentLink(robot, linkId, entry.descriptor, index);
        visualLinkIds.push(targetLinkId);
        const children = fixedChildrenByParent.get(linkId) || [];
        children.push(targetLinkId);
        fixedChildrenByParent.set(linkId, children);
      }
    }

    if (entry.subsetSection && targetLinkId !== linkId) {
      const sourceOrigin = robot.links[linkId]?.visual?.origin;
      const targetLink = robot.links[targetLinkId];
      if (
        targetLink &&
        hasNonIdentityOrigin(sourceOrigin) &&
        !hasNonIdentityOrigin(targetLink.visual.origin)
      ) {
        targetLink.visual = {
          ...targetLink.visual,
          origin: cloneVisualOrigin(sourceOrigin),
        };
      }
    }

    usedVisualLinkIds.add(targetLinkId);
    assignVisualDescriptorToLink(
      snapshot,
      robot,
      targetLinkId,
      entry,
      descriptorByPath,
      materialLookup,
      preferredMaterialRecord,
      explicitMaterialFallback,
    );
  });

  collisionDescriptors.forEach((entry, index) => {
    assignCollisionDescriptorToLink(snapshot, robot, linkId, entry, descriptorByPath, index);
  });
}

export function collectReferencedMeshPaths(robot: RobotState): Set<string> {
  const referenced = new Set<string>();

  Object.values(robot.links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.MESH && entry.geometry.meshPath) {
        referenced.add(entry.geometry.meshPath);
      }
    });
    if (link.collision.type === GeometryType.MESH && link.collision.meshPath) {
      referenced.add(link.collision.meshPath);
    }
    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH && body.meshPath) {
        referenced.add(body.meshPath);
      }
    });
  });

  return referenced;
}

export function createDescriptorExportMap(
  snapshot: UsdExportSnapshot,
  resolution: ViewerRobotDataResolution,
  currentRobot?: RobotLike | null,
): {
  robot: RobotState;
  descriptorByPath: Map<string, ExportDescriptor>;
} {
  const snapshotRobot = cloneRobotState({
    ...resolution.robotData,
    selection: { type: null, id: null },
  });
  const baseRobot = currentRobot
    ? mergeCurrentRobotWithSnapshotMeshPaths(currentRobot, snapshotRobot)
    : snapshotRobot;
  const descriptors = Array.from(snapshot.render?.meshDescriptors || []);
  const descriptorsByLinkRole = new Map<string, ExportDescriptor[]>();
  const materialLookup = getSnapshotMaterialLookup(snapshot);
  const preferredMaterialLookup = getSnapshotPreferredVisualMaterialLookup(snapshot);

  descriptors.forEach((descriptor, index) => {
    const linkPath = getDescriptorLinkPath(descriptor);
    if (!linkPath) return;

    const linkId = resolution.linkIdByPath[linkPath];
    if (!linkId) return;

    const role = getDescriptorRole(descriptor);
    const ordinal = parseDescriptorOrdinal(descriptor, index);
    const key = `${linkId}:${role}`;
    const current = descriptorsByLinkRole.get(key) || [];
    current.push({
      descriptor,
      meshId: normalizeUsdPath(descriptor.meshId || ''),
      linkPath,
      linkId,
      role,
      exportPath: `${sanitizeFileToken(linkId)}_${role}_${ordinal}.obj`,
      ordinal,
      subsetIndex: 0,
      subsetSection: null,
      materialIdOverride: null,
    } satisfies ExportDescriptor);
    descriptorsByLinkRole.set(key, current);
  });

  descriptorsByLinkRole.forEach((entries) => {
    entries.sort((left, right) => {
      if (left.ordinal !== right.ordinal) {
        return left.ordinal - right.ordinal;
      }
      if ((left.subsetIndex || 0) !== (right.subsetIndex || 0)) {
        return (left.subsetIndex || 0) - (right.subsetIndex || 0);
      }
      return left.meshId.localeCompare(right.meshId);
    });
  });

  const descriptorByPath = new Map<string, ExportDescriptor>();
  const fixedChildrenByParent = buildFixedChildLinksByParent(baseRobot);

  Object.entries(resolution.linkIdByPath).forEach(([linkPath, linkId]) => {
    assignLinkDescriptors(
      snapshot,
      baseRobot,
      linkId,
      linkPath,
      descriptorsByLinkRole.get(`${linkId}:visual`) || [],
      descriptorsByLinkRole.get(`${linkId}:collision`) || [],
      descriptorByPath,
      materialLookup,
      preferredMaterialLookup,
      fixedChildrenByParent,
    );
  });

  return {
    robot: stripSyntheticWorldRootForExport(baseRobot),
    descriptorByPath,
  };
}
