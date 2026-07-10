import { resolveAIWorkspaceRobotTarget } from '@/features/ai-assistant';
import type {
  AIConversationFocusedIssue,
  AIConversationLaunchContext,
  AIConversationMode,
  AIConversationSelection,
} from '@/features/ai-assistant';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { InspectionReport, InteractionSelection, RobotState } from '@/types';

const EMPTY_AI_SNAPSHOT_SELECTION: InteractionSelection = { type: null, id: null };

export function cloneAISnapshot<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function resolveCurrentAIConversationSelection(): AIConversationSelection | null {
  const workspace = useWorkspaceStore.getState().workspace;
  const selection = useSelectionStore.getState().selection;
  return resolveAIWorkspaceRobotTarget(workspace, selection).selectedEntity;
}

export function createConversationLaunchContext({
  sessionId,
  mode,
  robotSnapshot,
  inspectionReportSnapshot = null,
  selectedEntity,
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
  const resolvedSelectedEntity = selectedEntity === undefined
    ? resolveCurrentAIConversationSelection()
    : selectedEntity;

  return {
    sessionId,
    mode,
    robotSnapshot: nextRobotSnapshot,
    inspectionReportSnapshot: inspectionReportSnapshot
      ? cloneAISnapshot(inspectionReportSnapshot)
      : null,
    selectedEntity: resolvedSelectedEntity
      ? cloneAISnapshot(resolvedSelectedEntity)
      : null,
    focusedIssue: nextFocusedIssue,
  };
}

export function resolveCurrentAIRobotSnapshot(): RobotState {
  const workspace = useWorkspaceStore.getState().workspace;
  const selection = useSelectionStore.getState().selection;
  const target = resolveAIWorkspaceRobotTarget(workspace, selection);

  return cloneAISnapshot({
    ...target.robotData,
    // RobotState is an external AI snapshot shape. Canonical selection travels
    // separately as AIConversationSelection and is never mirrored here.
    selection: EMPTY_AI_SNAPSHOT_SELECTION,
  });
}
