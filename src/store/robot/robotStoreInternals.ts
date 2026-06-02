/**
 * Robot Store internals
 *
 * Stateless pure helper functions extracted verbatim from the former monolithic
 * `robotStore.ts`. These never touch `set`/`get` or any store closure; they
 * operate purely on the values handed to them.
 */
import type {
  AssemblyState,
  BridgeJoint,
  JointQuaternion,
  RobotFile,
} from '@/types';
import { describeRobotImportFailure } from '@/core/parsers';
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { mergeAssembly } from '@/core/robot';
import {
  cloneAssemblyTransform,
  IDENTITY_ASSEMBLY_TRANSFORM,
} from '@/core/robot/assemblyTransforms';
import { resolveAssemblyComponentLinkId } from '@/core/robot/assemblyBridgeAlignment';
import { wouldBridgeCreateUnsupportedAssemblyCycle } from '@/core/robot/assemblyBridgeTopology';
import { normalizeLibraryPathKey } from '@/shared/utils/pathKeys';
import {
  JOINT_MOTION_EPSILON,
  type ChangeLogEntry,
  type RobotData,
  type RobotSnapshot,
} from './robotStoreTypes';

export const cloneRobotData = (data: RobotData): RobotData =>
  structuredClone(normalizeRobotData(data));

export const createChangeLogEntry = (label: string): ChangeLogEntry => ({
  id: `robot_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
  label,
});

export function normalizeAssemblySourcePath(path: string): string {
  return normalizeLibraryPathKey(path);
}

export function isSameOrNestedAssemblySourcePath(path: string, basePath: string): boolean {
  const normalizedPath = normalizeAssemblySourcePath(path);
  return normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`);
}

export function replaceAssemblySourcePathPrefix(
  path: string,
  fromPath: string,
  toPath: string,
): string {
  const normalizedPath = normalizeAssemblySourcePath(path);
  if (normalizedPath === fromPath) {
    return toPath;
  }

  if (normalizedPath.startsWith(`${fromPath}/`)) {
    return `${toPath}/${normalizedPath.slice(fromPath.length + 1)}`;
  }

  return normalizedPath;
}

export function cloneAssemblySnapshot(
  snapshot: AssemblyState | null | undefined,
): AssemblyState | null {
  return snapshot ? structuredClone(snapshot) : null;
}

export function buildAssemblyBridgeId(): string {
  return `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildAssemblyComponentImportError(
  file: RobotFile,
  importResult: Exclude<RobotImportResult, { status: 'ready' }>,
): Error {
  const detail = describeRobotImportFailure(importResult);
  return new Error(`Failed to add assembly component from "${file.name}". ${detail}`);
}

export function normalizeRobotData(data: RobotData): RobotData {
  const assemblyState = cloneAssemblySnapshot(data.assemblyState);
  const components = structuredClone(data.components ?? assemblyState?.components ?? {});
  const bridges = structuredClone(data.bridges ?? assemblyState?.bridges ?? {});
  const workspaceTransform = cloneAssemblyTransform(
    data.workspaceTransform ?? assemblyState?.transform ?? IDENTITY_ASSEMBLY_TRANSFORM,
  );
  if (assemblyState) {
    assemblyState.components = components;
    assemblyState.bridges = bridges;
    assemblyState.transform = workspaceTransform;
  }
  const normalizedAssemblyState =
    assemblyState ??
    (Object.keys(components).length > 0
      ? {
          name: data.name || 'assembly',
          transform: workspaceTransform,
          components,
          bridges,
        }
      : null);

  return {
    ...data,
    components,
    bridges,
    workspaceTransform,
    activeComponentId: data.activeComponentId ?? null,
    assemblyState: normalizedAssemblyState,
  };
}

export function createRobotSnapshotFromState(state: RobotData): RobotSnapshot {
  return cloneRobotData({
    name: state.name,
    version: state.version,
    links: state.links,
    joints: state.joints,
    rootLinkId: state.rootLinkId,
    components: state.components,
    bridges: state.bridges,
    workspaceTransform: state.workspaceTransform,
    activeComponentId: state.activeComponentId,
    assemblyState: state.assemblyState,
    materials: state.materials,
    closedLoopConstraints: state.closedLoopConstraints,
    inspectionContext: state.inspectionContext,
  });
}

export function isAssemblySnapshot(
  value: RobotData | AssemblyState | null,
): value is AssemblyState | null {
  if (value === null) {
    return true;
  }

  return (
    typeof value === 'object' &&
    'components' in value &&
    'bridges' in value &&
    !('links' in value)
  );
}

export function buildRobotSnapshotForAssemblySnapshot(
  currentState: RobotData,
  snapshot: AssemblyState | null,
): RobotSnapshot {
  const nextAssemblyState = cloneAssemblySnapshot(snapshot);
  const nextComponents = structuredClone(nextAssemblyState?.components ?? {});
  const nextBridges = structuredClone(nextAssemblyState?.bridges ?? {});
  const nextWorkspaceTransform = cloneAssemblyTransform(
    nextAssemblyState?.transform ?? IDENTITY_ASSEMBLY_TRANSFORM,
  );

  return cloneRobotData({
    name: nextAssemblyState?.name || currentState.name,
    version: currentState.version,
    links: currentState.links,
    joints: currentState.joints,
    rootLinkId: currentState.rootLinkId,
    components: nextComponents,
    bridges: nextBridges,
    workspaceTransform: nextWorkspaceTransform,
    activeComponentId: nextAssemblyState ? currentState.activeComponentId : null,
    assemblyState: nextAssemblyState,
    materials: currentState.materials,
    closedLoopConstraints: currentState.closedLoopConstraints,
    inspectionContext: currentState.inspectionContext,
  });
}

export function shouldProjectAssemblyToTopLevel(
  assemblyState: AssemblyState | null | undefined,
): boolean {
  if (!assemblyState) {
    return false;
  }

  return (
    Object.keys(assemblyState.components).length > 1 ||
    Object.keys(assemblyState.bridges).length > 0
  );
}

export function syncWorkspaceFieldsFromAssemblyDraft(
  state: RobotData,
  assemblyState: AssemblyState | null,
): void {
  state.assemblyState = assemblyState;
  state.components = assemblyState?.components ?? {};
  state.bridges = assemblyState?.bridges ?? {};
  state.workspaceTransform = cloneAssemblyTransform(
    assemblyState?.transform ?? IDENTITY_ASSEMBLY_TRANSFORM,
  );
  state.activeComponentId =
    state.activeComponentId && state.components[state.activeComponentId]
      ? state.activeComponentId
      : (Object.keys(state.components)[0] ?? null);

  if (!assemblyState || !shouldProjectAssemblyToTopLevel(assemblyState)) {
    return;
  }

  const mergedRobot = mergeAssembly(assemblyState);
  state.name = assemblyState.name || mergedRobot.name || state.name;
  state.links = mergedRobot.links;
  state.joints = mergedRobot.joints;
  state.rootLinkId = mergedRobot.rootLinkId;
  state.materials = mergedRobot.materials;
  state.closedLoopConstraints = mergedRobot.closedLoopConstraints;
  state.inspectionContext = mergedRobot.inspectionContext;
}

export function appendPendingAutoGroundComponentId(
  pendingComponentIds: string[],
  componentId: string,
): void {
  if (!pendingComponentIds.includes(componentId)) {
    pendingComponentIds.push(componentId);
  }
}

export function removePendingAutoGroundComponentIds(
  pendingComponentIds: string[],
  componentIds: Iterable<string>,
): void {
  const pendingComponentIdSet = new Set(componentIds);
  if (pendingComponentIdSet.size === 0) {
    return;
  }

  for (let index = pendingComponentIds.length - 1; index >= 0; index -= 1) {
    if (pendingComponentIdSet.has(pendingComponentIds[index])) {
      pendingComponentIds.splice(index, 1);
    }
  }
}

export function shouldRecomputeBridgeAlignedChildTransform(
  currentBridge: BridgeJoint,
  updates: Partial<BridgeJoint>,
): boolean {
  if (
    Object.prototype.hasOwnProperty.call(updates, 'parentComponentId') ||
    Object.prototype.hasOwnProperty.call(updates, 'parentLinkId') ||
    Object.prototype.hasOwnProperty.call(updates, 'childComponentId') ||
    Object.prototype.hasOwnProperty.call(updates, 'childLinkId')
  ) {
    return true;
  }

  const nextJoint = updates.joint;
  if (!nextJoint) {
    return false;
  }

  return (
    nextJoint.parentLinkId !== currentBridge.joint.parentLinkId ||
    nextJoint.childLinkId !== currentBridge.joint.childLinkId ||
    nextJoint.origin?.xyz?.x !== currentBridge.joint.origin?.xyz?.x ||
    nextJoint.origin?.xyz?.y !== currentBridge.joint.origin?.xyz?.y ||
    nextJoint.origin?.xyz?.z !== currentBridge.joint.origin?.xyz?.z ||
    nextJoint.origin?.rpy?.r !== currentBridge.joint.origin?.rpy?.r ||
    nextJoint.origin?.rpy?.p !== currentBridge.joint.origin?.rpy?.p ||
    nextJoint.origin?.rpy?.y !== currentBridge.joint.origin?.rpy?.y
  );
}

export function assertStructuralBridgeCanBeApplied(
  assembly: AssemblyState,
  bridge: BridgeJoint,
  options?: { ignoreBridgeId?: string },
): void {
  const parentComponent = assembly.components[bridge.parentComponentId];
  if (!parentComponent) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because parent component "${bridge.parentComponentId}" does not exist.`,
    );
  }

  const childComponent = assembly.components[bridge.childComponentId];
  if (!childComponent) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because child component "${bridge.childComponentId}" does not exist.`,
    );
  }

  if (bridge.parentComponentId === bridge.childComponentId) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because parent and child component are both "${bridge.parentComponentId}".`,
    );
  }

  if (!resolveAssemblyComponentLinkId(parentComponent, bridge.parentLinkId)) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because parent link "${bridge.parentLinkId}" does not exist on component "${bridge.parentComponentId}".`,
    );
  }

  if (!resolveAssemblyComponentLinkId(childComponent, bridge.childLinkId)) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because child link "${bridge.childLinkId}" does not exist on component "${bridge.childComponentId}".`,
    );
  }

  const conflictingIncomingBridgeIds = Object.values(assembly.bridges)
    .filter((existingBridge) => existingBridge.id !== options?.ignoreBridgeId)
    .filter((existingBridge) => existingBridge.childComponentId === bridge.childComponentId)
    .filter((existingBridge) =>
      Boolean(resolveAssemblyComponentLinkId(childComponent, existingBridge.childLinkId)),
    )
    .map((existingBridge) => existingBridge.id);

  if (conflictingIncomingBridgeIds.length > 0) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because child component "${bridge.childComponentId}" already has an incoming bridge: ${conflictingIncomingBridgeIds.join(', ')}.`,
    );
  }

  if (
    wouldBridgeCreateUnsupportedAssemblyCycle(
      Object.values(assembly.bridges),
      bridge,
      bridge.joint.type,
      options,
    )
  ) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because it would close a cycle with joint type "${bridge.joint.type}". Only fixed cyclic bridges can be converted into closed-loop constraints.`,
    );
  }
}

export function jointQuaternionValuesEqual(
  left: JointQuaternion | undefined,
  right: JointQuaternion,
): boolean {
  if (!left) {
    return false;
  }

  return (
    Math.abs(left.x - right.x) <= JOINT_MOTION_EPSILON &&
    Math.abs(left.y - right.y) <= JOINT_MOTION_EPSILON &&
    Math.abs(left.z - right.z) <= JOINT_MOTION_EPSILON &&
    Math.abs(left.w - right.w) <= JOINT_MOTION_EPSILON
  );
}

export function jointMotionSolutionChangesState(
  robot: Pick<RobotData, 'joints'>,
  solution: {
    angles: Record<string, number>;
    quaternions: Record<string, JointQuaternion>;
  },
): boolean {
  for (const [jointId, angle] of Object.entries(solution.angles)) {
    const joint = robot.joints[jointId];
    if (!joint) {
      continue;
    }

    if (
      joint.angle === undefined ||
      Math.abs(joint.angle - angle) > JOINT_MOTION_EPSILON
    ) {
      return true;
    }
  }

  for (const [jointId, quaternion] of Object.entries(solution.quaternions)) {
    const joint = robot.joints[jointId];
    if (!joint) {
      continue;
    }

    if (!jointQuaternionValuesEqual(joint.quaternion, quaternion)) {
      return true;
    }
  }

  return false;
}
