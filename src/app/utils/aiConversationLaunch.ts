import { useRobotStore, useSelectionStore } from '@/store';
import type { InspectionReport, RobotState } from '@/types';
import type {
  AIConversationFocusedIssue,
  AIConversationLaunchContext,
  AIConversationMode,
  AIConversationSelection,
} from '@/features/ai-assistant/types';

export function cloneAISnapshot<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function resolveConversationSelectedEntity(
  robotSnapshot: RobotState,
): AIConversationSelection | null {
  if (!robotSnapshot.selection.type || !robotSnapshot.selection.id) {
    return null;
  }

  if (robotSnapshot.selection.type !== 'link' && robotSnapshot.selection.type !== 'joint') {
    return null;
  }

  return {
    type: robotSnapshot.selection.type,
    id: robotSnapshot.selection.id,
  };
}

export function createConversationLaunchContext({
  sessionId,
  mode,
  robotSnapshot,
  inspectionReportSnapshot = null,
  selectedEntity = null,
  focusedIssue = null,
}: {
  sessionId: number;
  mode: AIConversationMode;
  robotSnapshot: RobotState;
  inspectionReportSnapshot?: InspectionReport | null;
  selectedEntity?: AIConversationSelection | null;
  focusedIssue?: AIConversationFocusedIssue | null;
}): AIConversationLaunchContext {
  const nextRobotSnapshot = cloneAISnapshot(robotSnapshot);
  const nextFocusedIssue = focusedIssue ? cloneAISnapshot(focusedIssue) : null;

  return {
    sessionId,
    mode,
    robotSnapshot: nextRobotSnapshot,
    inspectionReportSnapshot: inspectionReportSnapshot
      ? cloneAISnapshot(inspectionReportSnapshot)
      : null,
    selectedEntity: selectedEntity
      ? cloneAISnapshot(selectedEntity)
      : resolveConversationSelectedEntity(nextRobotSnapshot),
    focusedIssue: nextFocusedIssue,
  };
}

export function resolveCurrentAIRobotSnapshot(): RobotState {
  const { selection } = useSelectionStore.getState();
  const { assemblyState, getMergedRobotData } = useRobotStore.getState();
  const robotState = useRobotStore.getState();

  if (assemblyState) {
    const mergedWorkspaceRobot = getMergedRobotData();
    if (mergedWorkspaceRobot) {
      return cloneAISnapshot({
        ...mergedWorkspaceRobot,
        selection,
      });
    }
  }

  return cloneAISnapshot({
    name: robotState.name,
    links: robotState.links,
    joints: robotState.joints,
    rootLinkId: robotState.rootLinkId,
    materials: robotState.materials,
    closedLoopConstraints: robotState.closedLoopConstraints,
    inspectionContext: robotState.inspectionContext,
    selection,
  });
}
