import type { RobotData } from '@/types';

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

// Selection deliberately stays out of the viewer robot so that selection-only
// changes do not bump the robotData reference and cascade into RobotModel /
// useRendererBackend patch detection + visibility re-sync (the source of the
// "models flash off for a frame on empty click" symptom).
export function resolveWorkspaceViewerFallbackRobot({
  shouldRenderAssembly,
  hasWorkspaceDisplayRobot,
  hasWorkspaceRenderFailure = false,
  liveRobot,
  lastStableViewerRobot,
}: {
  shouldRenderAssembly: boolean;
  hasWorkspaceDisplayRobot: boolean;
  hasWorkspaceRenderFailure?: boolean;
  liveRobot: RobotData;
  lastStableViewerRobot: RobotData | null;
}): RobotData {
  if (
    !shouldRenderAssembly ||
    hasWorkspaceDisplayRobot ||
    hasWorkspaceRenderFailure ||
    !lastStableViewerRobot
  ) {
    return liveRobot;
  }

  return lastStableViewerRobot;
}

export function resolveWorkspaceViewerRobot({
  shouldRenderAssembly,
  liveRobot,
  workspaceViewerRobotData,
  animatedWorkspaceViewerRobotData,
}: {
  shouldRenderAssembly: boolean;
  liveRobot: RobotData;
  workspaceViewerRobotData: RobotData | null;
  animatedWorkspaceViewerRobotData: RobotData | null;
}): RobotData {
  if (!shouldRenderAssembly) {
    return liveRobot;
  }

  const displayRobot = animatedWorkspaceViewerRobotData ?? workspaceViewerRobotData;
  if (!displayRobot) {
    return liveRobot;
  }

  return displayRobot;
}
