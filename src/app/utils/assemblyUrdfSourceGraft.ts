/**
 * Source-preserving URDF graft for a bridge-connected assembly group.
 *
 * Goal: keep the master (group root) component's original URDF text verbatim and
 * inject each bridge-connected slave — re-rooted so the bridge link becomes the
 * slave root, joints reversed along the path, names namespaced only on collision —
 * as text fragments before the master's closing `</robot>`. The result is a single
 * flat URDF that reads as one robot while the 3D workspace keeps its per-component
 * model. Anything this cannot express verbatim returns `{ ok: false }` so the caller
 * can fall back to a fully re-serialized read-only merge.
 *
 * This lives in the app layer (not core/robot) on purpose: it needs `generateURDF`
 * from core/parsers, and core/parsers already imports core/robot — importing the
 * serializer back into core/robot would create a dependency cycle.
 */
import type { AssemblyState, BridgeJoint, RobotData, UrdfJoint, UrdfLink } from '@/types';
import { generateURDF } from '@/core/parsers';
import { rerootAssemblyComponentRobot } from '@/core/robot/assemblyReroot';
import {
  buildAssemblyParentByChildComponentId,
  wouldCreateAssemblyComponentCycle,
} from '@/core/robot/assemblyBridgeTopology';

export interface GraftAssemblyGroupUrdfSourceParams {
  assembly: AssemblyState;
  groupComponentIds: string[];
  masterComponentId: string;
  /** The master component's original URDF draft text; preserved verbatim. */
  masterSourceUrdfText: string;
}

export interface GraftAssemblyGroupUrdfSourceResult {
  ok: boolean;
  urdfText?: string;
  /** Present when `ok` is false; explains why the caller must fall back. */
  reason?: string;
}

const CLOSING_ROBOT_TAG = /\s*<\/robot>\s*$/;
const BRIDGE_PARENT_LINK_KEY = '__graft_bridge_parent__';
const BRIDGE_CHILD_LINK_KEY = '__graft_bridge_child__';

function fail(reason: string): GraftAssemblyGroupUrdfSourceResult {
  return { ok: false, reason };
}

/**
 * The master (root) of a group is the component that is never a bridge child.
 * Returns null when the group has zero or multiple such roots (a shape this graft
 * cannot express as one verbatim-master URDF).
 */
export function resolveAssemblyGroupMasterComponentId(
  assembly: AssemblyState,
  groupComponentIds: string[],
): string | null {
  const idSet = new Set(groupComponentIds);
  const groupBridges = Object.values(assembly.bridges).filter(
    (bridge) => idSet.has(bridge.parentComponentId) && idSet.has(bridge.childComponentId),
  );
  const parentByChild = buildAssemblyParentByChildComponentId(groupBridges);
  const masters = groupComponentIds.filter((componentId) => !parentByChild.has(componentId));
  return masters.length === 1 ? masters[0] : null;
}

function sanitizeNamePrefix(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'comp';
}

function uniquifyName(name: string, used: Set<string>, prefix: string): string {
  if (!used.has(name)) {
    return name;
  }
  const base = `${prefix}__${name}`;
  if (!used.has(base)) {
    return base;
  }
  let counter = 2;
  while (used.has(`${base}_${counter}`)) {
    counter += 1;
  }
  return `${base}_${counter}`;
}

interface NamespacedRobot {
  robot: RobotData;
  linkNameByOldId: Map<string, string>;
}

/**
 * Rename a slave robot's link/joint names only where they collide with names
 * already used by the master or earlier slaves. Link/joint id keys are preserved,
 * so every internal parent/child/mimic reference (resolved by id) keeps pointing at
 * the renamed name automatically. Mutates the `used*` sets with the final names.
 */
function namespaceRobotOnCollision(
  robot: RobotData,
  usedLinkNames: Set<string>,
  usedJointNames: Set<string>,
  prefix: string,
): NamespacedRobot {
  const linkNameByOldId = new Map<string, string>();
  const links: Record<string, UrdfLink> = {};
  for (const [linkId, link] of Object.entries(robot.links)) {
    const finalName = uniquifyName(link.name, usedLinkNames, prefix);
    usedLinkNames.add(finalName);
    linkNameByOldId.set(linkId, finalName);
    links[linkId] = finalName === link.name ? link : { ...link, name: finalName };
  }

  const joints: Record<string, UrdfJoint> = {};
  for (const [jointId, joint] of Object.entries(robot.joints)) {
    const finalName = uniquifyName(joint.name, usedJointNames, prefix);
    usedJointNames.add(finalName);
    joints[jointId] = finalName === joint.name ? joint : { ...joint, name: finalName };
  }

  return { robot: { ...robot, links, joints }, linkNameByOldId };
}

function stripRobotWrapper(urdf: string): string {
  return urdf
    .replace(/^\s*<\?xml[^>]*\?>\s*/, '')
    .replace(/^\s*<robot\b[^>]*>\s*/, '')
    .replace(/\s*<\/robot>\s*$/, '')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
}

/**
 * Serialize just the bridge `<joint>` block by round-tripping a throwaway two-link
 * robot through `generateURDF` (synthetic distinct keys so identical parent/child
 * ids never collapse), then extracting the joint element. Reuses the canonical
 * serializer instead of hand-writing joint XML.
 */
function serializeBridgeJointXml(
  bridge: BridgeJoint,
  parentLink: UrdfLink,
  parentLinkName: string,
  childLink: UrdfLink,
): string {
  const tempRobot = {
    name: 'graft-bridge',
    links: {
      [BRIDGE_PARENT_LINK_KEY]: { ...parentLink, id: BRIDGE_PARENT_LINK_KEY, name: parentLinkName },
      [BRIDGE_CHILD_LINK_KEY]: { ...childLink, id: BRIDGE_CHILD_LINK_KEY },
    },
    joints: {
      [bridge.id]: {
        ...bridge.joint,
        id: bridge.id,
        name: bridge.name,
        parentLinkId: BRIDGE_PARENT_LINK_KEY,
        childLinkId: BRIDGE_CHILD_LINK_KEY,
      },
    },
    rootLinkId: BRIDGE_PARENT_LINK_KEY,
    selection: { type: null, id: null },
  } as const;

  const full = generateURDF(tempRobot, { preserveMeshPaths: true });
  const match = full.match(/[ \t]*<joint\b[\s\S]*?<\/joint>/);
  if (!match) {
    throw new Error(`Failed to serialize bridge joint "${bridge.id}"`);
  }
  return match[0];
}

interface GroupTopology {
  bridgeByChildComponentId: Map<string, BridgeJoint>;
  orderedChildComponentIds: string[];
}

/** Classify group bridges into a single-rooted tree, or fail on shapes URDF can't express. */
function resolveGroupTopology(
  assembly: AssemblyState,
  groupComponentIds: string[],
  masterComponentId: string,
): GroupTopology | GraftAssemblyGroupUrdfSourceResult {
  const idSet = new Set(groupComponentIds);
  const groupBridges = Object.values(assembly.bridges).filter(
    (bridge) => idSet.has(bridge.parentComponentId) && idSet.has(bridge.childComponentId),
  );

  const incomingCountByChild = new Map<string, number>();
  for (const bridge of groupBridges) {
    incomingCountByChild.set(
      bridge.childComponentId,
      (incomingCountByChild.get(bridge.childComponentId) ?? 0) + 1,
    );
  }

  const parentByChild = new Map<string, string>();
  const bridgeByChildComponentId = new Map<string, BridgeJoint>();
  for (const bridge of groupBridges) {
    const { childComponentId: child, parentComponentId: parent } = bridge;
    if ((incomingCountByChild.get(child) ?? 0) > 1) {
      return fail(`component "${child}" has multiple incoming bridges`);
    }
    if (wouldCreateAssemblyComponentCycle(parentByChild, parent, child)) {
      return fail(`bridge "${bridge.id}" closes a cycle that URDF cannot express`);
    }
    parentByChild.set(child, parent);
    bridgeByChildComponentId.set(child, bridge);
  }

  const masters = groupComponentIds.filter((componentId) => !parentByChild.has(componentId));
  if (masters.length !== 1 || masters[0] !== masterComponentId) {
    return fail('group does not have a single resolved master root');
  }

  const childrenByParent = new Map<string, string[]>();
  for (const [child, parent] of parentByChild) {
    const children = childrenByParent.get(parent) ?? [];
    children.push(child);
    childrenByParent.set(parent, children);
  }

  const orderedChildComponentIds: string[] = [];
  const queue = [masterComponentId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of childrenByParent.get(current) ?? []) {
      orderedChildComponentIds.push(child);
      queue.push(child);
    }
  }

  return { bridgeByChildComponentId, orderedChildComponentIds };
}

export function graftAssemblyGroupUrdfSource(
  params: GraftAssemblyGroupUrdfSourceParams,
): GraftAssemblyGroupUrdfSourceResult {
  const { assembly, groupComponentIds, masterComponentId, masterSourceUrdfText } = params;

  try {
    if (!CLOSING_ROBOT_TAG.test(masterSourceUrdfText)) {
      return fail('master source text does not end with </robot>');
    }
    const masterRobot = assembly.components[masterComponentId]?.robot;
    if (!masterRobot) {
      return fail(`master component "${masterComponentId}" has no robot`);
    }

    const topology = resolveGroupTopology(assembly, groupComponentIds, masterComponentId);
    if ('ok' in topology) {
      return topology;
    }
    const { bridgeByChildComponentId, orderedChildComponentIds } = topology;

    const usedLinkNames = new Set(Object.values(masterRobot.links).map((link) => link.name));
    const usedJointNames = new Set(Object.values(masterRobot.joints).map((joint) => joint.name));

    // Per-component maps used to resolve a bridge parent link's final name/object,
    // whether the parent is the master or an already-processed ancestor slave.
    const linkNameByOldIdByComponent = new Map<string, Map<string, string>>();
    const linkObjectsByComponent = new Map<string, Record<string, UrdfLink>>();
    linkNameByOldIdByComponent.set(
      masterComponentId,
      new Map(Object.entries(masterRobot.links).map(([id, link]) => [id, link.name])),
    );
    linkObjectsByComponent.set(masterComponentId, masterRobot.links);

    const injectionFragments: string[] = [];

    for (const childComponentId of orderedChildComponentIds) {
      const bridge = bridgeByChildComponentId.get(childComponentId);
      if (!bridge) {
        return fail(`missing bridge for component "${childComponentId}"`);
      }
      const childRobot = assembly.components[childComponentId]?.robot;
      if (!childRobot) {
        return fail(`child component "${childComponentId}" has no robot`);
      }
      if (!childRobot.links[bridge.childLinkId]) {
        return fail(`bridge "${bridge.id}" child link "${bridge.childLinkId}" is missing`);
      }

      const parentLinkNames = linkNameByOldIdByComponent.get(bridge.parentComponentId);
      const parentLinkObjects = linkObjectsByComponent.get(bridge.parentComponentId);
      const parentLinkName = parentLinkNames?.get(bridge.parentLinkId);
      const parentLink = parentLinkObjects?.[bridge.parentLinkId];
      if (!parentLinkName || !parentLink) {
        return fail(`bridge "${bridge.id}" parent link "${bridge.parentLinkId}" is missing`);
      }
      // When the parent is the verbatim master, its link name must actually exist in
      // the preserved text (guards against id != name components).
      if (
        bridge.parentComponentId === masterComponentId &&
        !masterSourceUrdfText.includes(`name="${parentLinkName}"`)
      ) {
        return fail(`master link "${parentLinkName}" not found in preserved source text`);
      }

      const rerootedRobot = rerootAssemblyComponentRobot(
        childRobot,
        bridge.childLinkId,
        childComponentId,
      );
      const prefix = sanitizeNamePrefix(assembly.components[childComponentId]?.name ?? childComponentId);
      const { robot: namespacedRobot, linkNameByOldId } = namespaceRobotOnCollision(
        rerootedRobot,
        usedLinkNames,
        usedJointNames,
        prefix,
      );
      linkNameByOldIdByComponent.set(childComponentId, linkNameByOldId);
      linkObjectsByComponent.set(childComponentId, namespacedRobot.links);

      const childRootLink = namespacedRobot.links[bridge.childLinkId];
      const slaveBody = stripRobotWrapper(
        generateURDF(
          { ...namespacedRobot, selection: { type: null, id: null } },
          { preserveMeshPaths: true },
        ),
      );
      const bridgeJointXml = serializeBridgeJointXml(bridge, parentLink, parentLinkName, childRootLink);
      injectionFragments.push(`${slaveBody}\n\n${bridgeJointXml}`);
    }

    if (injectionFragments.length === 0) {
      return fail('no slave components to graft');
    }

    const injection = injectionFragments.join('\n\n');
    const urdfText = masterSourceUrdfText.replace(
      CLOSING_ROBOT_TAG,
      `\n\n${injection}\n\n</robot>\n`,
    );
    return { ok: true, urdfText };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
