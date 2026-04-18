import type { RobotData, RobotState } from '@/types';

export function shouldAnimateWorkspaceViewerRobot({
  shouldRenderAssembly,
  previouslyRenderedAssembly,
  isPreviewingAssemblyBridge = false,
}: {
  shouldRenderAssembly: boolean;
  previouslyRenderedAssembly: boolean;
  isPreviewingAssemblyBridge?: boolean;
}): boolean {
  if (isPreviewingAssemblyBridge) {
    return false;
  }

  return shouldRenderAssembly && previouslyRenderedAssembly;
}

export function shouldPersistStableWorkspaceViewerRobot({
  shouldRenderAssembly,
  hasWorkspaceDisplayRobot,
}: {
  shouldRenderAssembly: boolean;
  hasWorkspaceDisplayRobot: boolean;
}): boolean {
  return !shouldRenderAssembly || hasWorkspaceDisplayRobot;
}

export function resolveWorkspaceViewerFallbackRobot({
  shouldRenderAssembly,
  hasWorkspaceDisplayRobot,
  hasWorkspaceRenderFailure = false,
  liveRobot,
  lastStableViewerRobot,
  selection,
}: {
  shouldRenderAssembly: boolean;
  hasWorkspaceDisplayRobot: boolean;
  hasWorkspaceRenderFailure?: boolean;
  liveRobot: RobotState;
  lastStableViewerRobot: RobotState | null;
  selection: RobotState['selection'];
}): RobotState {
  if (
    !shouldRenderAssembly ||
    hasWorkspaceDisplayRobot ||
    hasWorkspaceRenderFailure ||
    !lastStableViewerRobot
  ) {
    return liveRobot;
  }

  return {
    ...lastStableViewerRobot,
    selection,
  };
}

export function resolveWorkspaceViewerRobot({
  shouldRenderAssembly,
  liveRobot,
  workspaceViewerRobotData,
  animatedWorkspaceViewerRobotData,
  selection,
}: {
  shouldRenderAssembly: boolean;
  liveRobot: RobotState;
  workspaceViewerRobotData: RobotData | null;
  animatedWorkspaceViewerRobotData: RobotData | null;
  selection: RobotState['selection'];
}): RobotState {
  if (!shouldRenderAssembly) {
    return liveRobot;
  }

  const displayRobot = animatedWorkspaceViewerRobotData ?? workspaceViewerRobotData;
  if (!displayRobot) {
    return liveRobot;
  }

  return {
    ...displayRobot,
    selection,
  };
}
