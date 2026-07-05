import { prepareAssemblyRobotData } from '@/core/robot';
import { isIdentityAssemblyTransform } from '@/core/robot/assemblyTransforms';
import {
  detectGeometryPatches,
  detectJointPatches,
} from '@/core/robot/runtime_patch_diff';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import { createRobotSemanticSnapshot } from '@/shared/utils/robot/semanticSnapshot';
import type { AssemblyComponent, AssemblyState, RobotData, RobotFile, RobotState } from '@/types';
import { sortKeysDeep } from './robot_source_snapshot';

export function shouldReseedSingleComponentAssemblyFromActiveFile({
  assemblyState,
  activeFile,
}: {
  assemblyState: AssemblyState | null;
  activeFile: RobotFile | null;
}): boolean {
  if (!activeFile || activeFile.format === 'mesh') {
    return false;
  }

  if (!assemblyState) {
    return true;
  }

  const components = Object.values(assemblyState.components);
  if (components.length === 0) {
    return true;
  }

  if (components.length !== 1 || Object.keys(assemblyState.bridges).length > 0) {
    return false;
  }

  return components[0]?.sourceFile !== activeFile.name;
}

function sanitizeWorkspaceSeedNameFromFile(fileName: string): string {
  const base =
    fileName
      .split('/')
      .pop()
      ?.replace(/\.[^/.]+$/, '') ?? 'robot';
  const sanitized = base.replace(/[^a-zA-Z0-9_]/g, '_');
  return sanitized || 'robot';
}

function parseRobotSourceSnapshot(sourceSnapshot: string | null): RobotData | null {
  if (!sourceSnapshot) {
    return null;
  }

  try {
    return JSON.parse(sourceSnapshot) as RobotData;
  } catch (error) {
    scheduleFailFastInDev(
      'workspaceSourceSyncUtils:parseRobotSourceSnapshot',
      new Error('Failed to parse workspace source snapshot.', { cause: error }),
      'error',
    );
    return null;
  }
}

function buildAssemblySeedRobotFromSourceBaseline({
  sourceRobotData,
  sourceSnapshot,
  component,
  sourceFile,
}: {
  sourceRobotData?: RobotData | null;
  sourceSnapshot?: string | null;
  component: Pick<AssemblyComponent, 'id' | 'name'>;
  sourceFile: RobotFile | null;
}): RobotState | null {
  const parsedSnapshot = sourceRobotData ?? parseRobotSourceSnapshot(sourceSnapshot ?? null);

  if (!parsedSnapshot?.rootLinkId || !parsedSnapshot.links || !parsedSnapshot.joints) {
    return null;
  }

  const preparedRobotData = prepareAssemblyRobotData(parsedSnapshot, {
    componentId: component.id,
    rootName: component.name,
    sourceFilePath: sourceFile?.name ?? null,
    sourceFormat: sourceFile?.format ?? null,
  });

  return {
    name: preparedRobotData.name,
    rootLinkId: preparedRobotData.rootLinkId,
    links: preparedRobotData.links,
    joints: preparedRobotData.joints,
    materials: preparedRobotData.materials,
    closedLoopConstraints: preparedRobotData.closedLoopConstraints,
    selection: { type: null, id: null },
  };
}

function createSingleComponentAssemblyReuseSnapshot(robot: RobotData | RobotState): string {
  return createRobotSemanticSnapshot({
    ...robot,
    selection: { type: null, id: null },
  });
}

function createSingleComponentNonPatchableReuseSnapshot(robot: RobotData | RobotState): string {
  return JSON.stringify(
    sortKeysDeep({
      materials: robot.materials ?? null,
      closedLoopConstraints: robot.closedLoopConstraints ?? null,
    }),
  );
}

function hasOnlyRuntimePatchableSeedRobotChanges(
  baselineRobot: RobotData | RobotState,
  currentRobot: RobotData | RobotState,
): boolean {
  if (
    baselineRobot.name !== currentRobot.name ||
    baselineRobot.rootLinkId !== currentRobot.rootLinkId
  ) {
    return false;
  }

  const linkPatches = detectGeometryPatches(baselineRobot.links, currentRobot.links);
  if (!linkPatches) {
    return false;
  }

  const jointPatches = detectJointPatches(baselineRobot.joints, currentRobot.joints);
  if (!jointPatches) {
    return false;
  }

  if (linkPatches.length === 0 && jointPatches.length === 0) {
    return false;
  }

  return (
    createSingleComponentNonPatchableReuseSnapshot(baselineRobot) ===
    createSingleComponentNonPatchableReuseSnapshot(currentRobot)
  );
}

function canReuseSingleComponentRobot(
  baselineRobot: RobotData | RobotState,
  currentRobot: RobotData | RobotState,
): boolean {
  if (
    createSingleComponentAssemblyReuseSnapshot(baselineRobot) ===
    createSingleComponentAssemblyReuseSnapshot(currentRobot)
  ) {
    return true;
  }

  return hasOnlyRuntimePatchableSeedRobotChanges(baselineRobot, currentRobot);
}

export function shouldReuseSourceViewerForSingleComponentAssembly({
  assemblyState,
  activeFile,
  sourceSnapshot,
  sourceRobotData,
}: {
  assemblyState: AssemblyState | null;
  activeFile: RobotFile | null;
  sourceSnapshot: string | null;
  sourceRobotData?: RobotData | null;
}): boolean {
  if (!assemblyState || !activeFile || activeFile.format === 'mesh') {
    return false;
  }

  const visibleComponents = Object.values(assemblyState.components).filter(
    (component) => component.visible !== false,
  );

  if (visibleComponents.length !== 1 || Object.keys(assemblyState.bridges).length > 0) {
    return false;
  }

  if (!isIdentityAssemblyTransform(assemblyState.transform)) {
    return false;
  }

  const [component] = visibleComponents;
  const expectedSeedName = sanitizeWorkspaceSeedNameFromFile(activeFile.name);

  if (component.sourceFile !== activeFile.name || component.id !== `comp_${expectedSeedName}`) {
    return false;
  }

  if (!sourceSnapshot && !sourceRobotData) {
    return component.name === expectedSeedName;
  }

  const baselineRobotData = sourceRobotData ?? parseRobotSourceSnapshot(sourceSnapshot ?? null);
  if (!baselineRobotData) {
    return false;
  }

  const expectedComponentNames = new Set([expectedSeedName]);
  if (baselineRobotData.name?.trim()) {
    expectedComponentNames.add(baselineRobotData.name.trim());
  }

  if (!expectedComponentNames.has(component.name)) {
    return false;
  }

  const expectedSeedRobot = buildAssemblySeedRobotFromSourceBaseline({
    sourceRobotData: baselineRobotData,
    sourceSnapshot: null,
    component: { id: component.id, name: expectedSeedName },
    sourceFile: activeFile,
  });

  if (!expectedSeedRobot) {
    return false;
  }

  if (canReuseSingleComponentRobot(expectedSeedRobot, component.robot)) {
    return true;
  }

  return canReuseSingleComponentRobot(baselineRobotData, component.robot);
}

export function shouldPreviewLibraryRobotLoadFromWorkspace({
  assemblyState,
  activeFile,
  sourceSnapshot,
  sourceRobotData,
}: {
  assemblyState: AssemblyState | null;
  activeFile: RobotFile | null;
  sourceSnapshot: string | null;
  sourceRobotData?: RobotData | null;
}): boolean {
  if (!assemblyState || Object.keys(assemblyState.components).length === 0) {
    return false;
  }

  if (
    Object.keys(assemblyState.components).length <= 1 &&
    Object.keys(assemblyState.bridges).length === 0
  ) {
    return false;
  }

  return !shouldReuseSourceViewerForSingleComponentAssembly({
    assemblyState,
    activeFile,
    sourceSnapshot,
    sourceRobotData,
  });
}
