import { parseURDF } from '@/core/parsers';
import { createStableJsonSnapshot } from '@/core/robot/semanticSnapshot';
import type { RobotData, RobotMaterialState, UrdfJoint, UrdfLink } from '@/types';
import type {
  GraftAssemblyGroupUrdfSourceProvenance,
  GraftComponentEntityOwner,
} from './assemblyUrdfSourceGraft.ts';
import {
  createFlattenedComponentPartitionHash,
  toRobotData,
} from './assemblyUrdfSourcePartitionModel.ts';

export interface FlattenedBridgeJointEdit {
  bridgeId: string;
  joint: UrdfJoint;
}

export interface PartitionFlattenedGroupEditResult {
  ok: boolean;
  componentRobots?: Map<string, RobotData>;
  bridgeJointEdits?: FlattenedBridgeJointEdit[];
  reason?: string;
}

function fail(reason: string): PartitionFlattenedGroupEditResult {
  return { ok: false, reason };
}

function findDuplicateDirectEntityName(text: string): string | null {
  const document = new DOMParser().parseFromString(text, 'text/xml');
  const robot = document.querySelector('robot');
  if (!robot) return null;
  for (const tagName of ['link', 'joint']) {
    const names = new Set<string>();
    for (const element of Array.from(robot.children)) {
      if (element.tagName !== tagName) continue;
      const name = element.getAttribute('name')?.trim();
      if (name && names.has(name)) return `${tagName} "${name}"`;
      if (name) names.add(name);
    }
  }
  return null;
}

function findOriginalEntityId<T extends { name: string }>(
  entities: Record<string, T>,
  originalName: string,
): string | null {
  const match = Object.entries(entities).find(([, entity]) => entity.name === originalName);
  return match?.[0] ?? null;
}

function resolveOriginalLinkId(
  flattenedLinkName: string,
  componentId: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): string | null {
  const owner = provenance.linkOwnerByName.get(flattenedLinkName);
  const originalRobot = provenance.componentRobotById.get(componentId);
  if (!owner || owner.componentId !== componentId || !originalRobot) return null;
  return findOriginalEntityId(originalRobot.links, owner.originalName);
}

function resolveOriginalMimicName(
  flattenedJointName: string,
  componentId: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): string | null {
  const owner = provenance.jointOwnerByName.get(flattenedJointName);
  return owner?.kind === 'component' && owner.componentId === componentId
    ? owner.originalName
    : null;
}

function partitionFlatComponentRobot(
  parsedRobot: RobotData,
  componentId: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): RobotData | null {
  const links: Record<string, UrdfLink> = {};
  for (const [linkId, link] of Object.entries(parsedRobot.links)) {
    if (provenance.linkOwnerByName.get(link.name)?.componentId === componentId) {
      links[linkId] = link;
    }
  }

  const joints: Record<string, UrdfJoint> = {};
  for (const [jointId, joint] of Object.entries(parsedRobot.joints)) {
    const owner = provenance.jointOwnerByName.get(joint.name);
    if (owner?.kind === 'component' && owner.componentId === componentId) {
      joints[jointId] = joint;
    }
  }

  const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const rootLinkIds = Object.keys(links).filter((linkId) => !childLinkIds.has(linkId));
  if (rootLinkIds.length !== 1) return null;

  const materials = parsedRobot.materials
    ? Object.fromEntries(
        Object.entries(parsedRobot.materials).filter(([linkId]) => Boolean(links[linkId])),
      )
    : undefined;
  return {
    name: 'flattened-component-partition',
    links,
    joints,
    rootLinkId: rootLinkIds[0],
    ...(materials && Object.keys(materials).length > 0 ? { materials } : {}),
  };
}

function rebuildMasterRobot(
  parsedRobot: RobotData,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): RobotData | null {
  const componentId = provenance.masterComponentId;
  const originalRobot = provenance.componentRobotById.get(componentId);
  if (!originalRobot) return null;

  const links: Record<string, UrdfLink> = {};
  const materials: Record<string, RobotMaterialState> = {};
  for (const [flattenedId, parsedLink] of Object.entries(parsedRobot.links)) {
    const owner = provenance.linkOwnerByName.get(parsedLink.name);
    if (owner?.componentId !== componentId) continue;
    const originalId = findOriginalEntityId(originalRobot.links, owner.originalName);
    if (!originalId) return null;
    links[originalId] = { ...parsedLink, id: originalId, name: owner.originalName };
    const material = parsedRobot.materials?.[flattenedId];
    if (material) materials[originalId] = material;
  }

  const joints: Record<string, UrdfJoint> = {};
  for (const parsedJoint of Object.values(parsedRobot.joints)) {
    const owner = provenance.jointOwnerByName.get(parsedJoint.name);
    if (owner?.kind !== 'component' || owner.componentId !== componentId) continue;
    const originalId = findOriginalEntityId(originalRobot.joints, owner.originalName);
    const parentLinkId = resolveOriginalLinkId(
      parsedJoint.parentLinkId,
      componentId,
      provenance,
    );
    const childLinkId = resolveOriginalLinkId(parsedJoint.childLinkId, componentId, provenance);
    if (!originalId || !parentLinkId || !childLinkId) return null;
    const mimicName = parsedJoint.mimic?.joint
      ? resolveOriginalMimicName(parsedJoint.mimic.joint, componentId, provenance)
      : null;
    if (parsedJoint.mimic?.joint && !mimicName) return null;
    joints[originalId] = {
      ...parsedJoint,
      id: originalId,
      name: owner.originalName,
      parentLinkId,
      childLinkId,
      ...(parsedJoint.mimic
        ? { mimic: { ...parsedJoint.mimic, joint: mimicName as string } }
        : {}),
    };
  }

  const rootOwner = provenance.linkOwnerByName.get(parsedRobot.rootLinkId);
  const rootLinkId = rootOwner?.componentId === componentId
    ? findOriginalEntityId(originalRobot.links, rootOwner.originalName)
    : null;
  if (!rootLinkId || !links[rootLinkId]) return null;

  return {
    ...originalRobot,
    name: parsedRobot.name,
    version: parsedRobot.version,
    links,
    joints,
    rootLinkId,
    ...(Object.keys(materials).length > 0 ? { materials } : { materials: undefined }),
  };
}

function validateComponentJointEndpoints(
  joint: UrdfJoint,
  owner: GraftComponentEntityOwner,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): boolean {
  const parentOwner = provenance.linkOwnerByName.get(joint.parentLinkId);
  const childOwner = provenance.linkOwnerByName.get(joint.childLinkId);
  if (
    parentOwner?.componentId !== owner.componentId
    || childOwner?.componentId !== owner.componentId
  ) {
    return false;
  }
  const mimicOwner = joint.mimic?.joint
    ? provenance.jointOwnerByName.get(joint.mimic.joint)
    : null;
  return !mimicOwner
    || (mimicOwner.kind === 'component' && mimicOwner.componentId === owner.componentId);
}

function bridgeEditableSnapshot(joint: UrdfJoint): string {
  const dynamic = joint.type === 'revolute' || joint.type === 'continuous' || joint.type === 'prismatic';
  const axisBearing = dynamic || joint.type === 'planar';
  return createStableJsonSnapshot({
    type: joint.type,
    origin: joint.origin,
    ...(axisBearing ? { axis: joint.axis } : {}),
    ...(dynamic ? { limit: joint.limit, dynamics: joint.dynamics } : {}),
  });
}

function buildBridgeEdit(
  parsedJoint: UrdfJoint,
  bridgeId: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): FlattenedBridgeJointEdit | PartitionFlattenedGroupEditResult | null {
  const baseline = provenance.bridgeById.get(bridgeId);
  if (!baseline) return fail(`bridge "${bridgeId}" has no provenance`);
  if (
    parsedJoint.parentLinkId !== baseline.flattenedParentLinkName
    || parsedJoint.childLinkId !== baseline.flattenedChildLinkName
  ) {
    return fail(`bridge "${bridgeId}" endpoints cannot be edited in the flattened view`);
  }
  if (bridgeEditableSnapshot(parsedJoint) === bridgeEditableSnapshot(baseline.bridge.joint)) {
    return null;
  }
  return {
    bridgeId,
    joint: {
      ...baseline.bridge.joint,
      type: parsedJoint.type,
      origin: structuredClone(parsedJoint.origin),
      axis: parsedJoint.axis ? structuredClone(parsedJoint.axis) : undefined,
      limit: parsedJoint.limit ? structuredClone(parsedJoint.limit) : undefined,
      dynamics: structuredClone(parsedJoint.dynamics),
    },
  };
}

function validateParsedEntityAttribution(
  parsedRobot: RobotData,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): string | null {
  const unknownLink = Object.values(parsedRobot.links).find(
    (link) => !provenance.linkOwnerByName.has(link.name),
  );
  if (unknownLink) return `link "${unknownLink.name}" has no component provenance`;

  for (const joint of Object.values(parsedRobot.joints)) {
    const owner = provenance.jointOwnerByName.get(joint.name);
    if (!owner) return `joint "${joint.name}" has no component or bridge provenance`;
    if (owner.kind === 'component' && !validateComponentJointEndpoints(joint, owner, provenance)) {
      return `joint "${joint.name}" crosses its component boundary`;
    }
  }
  return null;
}

function validateSlavePartitions(
  parsedRobot: RobotData,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): string | null {
  for (const [componentId, baselineHash] of provenance.flattenedComponentHashById) {
    const flatRobot = partitionFlatComponentRobot(parsedRobot, componentId, provenance);
    if (!flatRobot) return `component "${componentId}" could not be partitioned`;
    const changed = createFlattenedComponentPartitionHash(flatRobot) !== baselineHash;
    if (componentId !== provenance.masterComponentId && changed) {
      return `slave component "${componentId}" cannot be edited in the flattened view yet`;
    }
  }
  return null;
}

type BridgeEditCollection =
  | { edits: FlattenedBridgeJointEdit[] }
  | { reason: string };

function collectBridgeEdits(
  parsedRobot: RobotData,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): BridgeEditCollection {
  const edits: FlattenedBridgeJointEdit[] = [];
  const seenBridgeIds = new Set<string>();
  for (const joint of Object.values(parsedRobot.joints)) {
    const owner = provenance.jointOwnerByName.get(joint.name);
    if (owner?.kind !== 'bridge') continue;
    const edit = buildBridgeEdit(joint, owner.bridgeId, provenance);
    if (edit && 'ok' in edit) return { reason: edit.reason ?? 'bridge edit is invalid' };
    if (edit) edits.push(edit);
    seenBridgeIds.add(owner.bridgeId);
  }
  const missingBridgeId = Array.from(provenance.bridgeById.keys()).find(
    (bridgeId) => !seenBridgeIds.has(bridgeId),
  );
  return missingBridgeId
    ? { reason: `bridge joint "${missingBridgeId}" cannot be removed in the flattened view` }
    : { edits };
}

/** Partition a flattened group edit; Phase 1 accepts master and bridge changes only. */
export function partitionFlattenedGroupEdit(
  editedText: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): PartitionFlattenedGroupEditResult {
  try {
    const duplicate = findDuplicateDirectEntityName(editedText);
    if (duplicate) return fail(`duplicate ${duplicate} cannot be attributed safely`);
    const parsedState = parseURDF(editedText);
    if (!parsedState) return fail('edited flattened URDF could not be parsed');
    const parsedRobot = toRobotData(parsedState);

    const attributionError = validateParsedEntityAttribution(parsedRobot, provenance);
    if (attributionError) return fail(attributionError);
    const slavePartitionError = validateSlavePartitions(parsedRobot, provenance);
    if (slavePartitionError) return fail(slavePartitionError);

    const componentRobots = new Map<string, RobotData>();
    const masterRobot = rebuildMasterRobot(parsedRobot, provenance);
    if (!masterRobot || !provenance.componentRobotById.has(provenance.masterComponentId)) {
      return fail('master component could not be rebuilt');
    }
    const flatMaster = partitionFlatComponentRobot(
      parsedRobot,
      provenance.masterComponentId,
      provenance,
    );
    const masterPartitionChanged = Boolean(
      flatMaster
      && createFlattenedComponentPartitionHash(flatMaster)
        !== provenance.flattenedComponentHashById.get(provenance.masterComponentId),
    );
    const masterDocumentMetadataChanged = parsedRobot.name !== provenance.masterRobotName
      || parsedRobot.version !== provenance.masterRobotVersion;
    if (masterPartitionChanged || masterDocumentMetadataChanged) {
      componentRobots.set(provenance.masterComponentId, masterRobot);
    }

    const bridgeEdits = collectBridgeEdits(parsedRobot, provenance);
    if ('reason' in bridgeEdits) return fail(bridgeEdits.reason);

    return { ok: true, componentRobots, bridgeJointEdits: bridgeEdits.edits };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
