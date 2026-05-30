import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { AIInspectionModal } from '@/features/ai-assistant/components/AIInspectionModal';
import type {
  AIConversationFocusedIssue,
  AIConversationSelection,
} from '@/features/ai-assistant/types';
import { useRobotStore, useSelectionStore } from '@/store';
import type { InspectionReport, RobotState } from '@/types';
import type { Language } from '@/shared/i18n';

interface AIInspectionConnectorProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  onOpenConversationWithReport: (
    report: InspectionReport,
    robotSnapshot: RobotState,
    options?: {
      selectedEntity?: AIConversationSelection | null;
      focusedIssue?: AIConversationFocusedIssue | null;
    },
  ) => void;
}

export function AIInspectionConnector({
  isOpen,
  onClose,
  lang,
  onOpenConversationWithReport,
}: AIInspectionConnectorProps) {
  const { selection, setSelection, focusOn, pulseSelection } = useSelectionStore(
    useShallow((state) => ({
      selection: state.selection,
      setSelection: state.setSelection,
      focusOn: state.focusOn,
      pulseSelection: state.pulseSelection,
    })),
  );
  const {
    robotName,
    robotLinks,
    robotJoints,
    rootLinkId,
    robotMaterials,
    robotClosedLoopConstraints,
    inspectionContext,
  } = useRobotStore(
    useShallow((state) => ({
      robotName: state.name,
      robotLinks: state.links,
      robotJoints: state.joints,
      rootLinkId: state.rootLinkId,
      robotMaterials: state.materials,
      robotClosedLoopConstraints: state.closedLoopConstraints,
      inspectionContext: state.inspectionContext,
    })),
  );
  const { assemblyState, getMergedRobotData } = useRobotStore(
    useShallow((state) => ({
      assemblyState: state.assemblyState,
      getMergedRobotData: state.getMergedRobotData,
    })),
  );

  const mergedWorkspaceRobot = useMemo(() => {
    if (!assemblyState) {
      return null;
    }

    return getMergedRobotData();
  }, [assemblyState, getMergedRobotData]);

  const robot: RobotState = useMemo(() => {
    if (mergedWorkspaceRobot) {
      return {
        ...mergedWorkspaceRobot,
        selection,
      };
    }

    return {
      name: robotName,
      links: robotLinks,
      joints: robotJoints,
      rootLinkId,
      materials: robotMaterials,
      closedLoopConstraints: robotClosedLoopConstraints,
      inspectionContext,
      selection,
    };
  }, [
    mergedWorkspaceRobot,
    robotJoints,
    robotLinks,
    robotName,
    rootLinkId,
    robotMaterials,
    robotClosedLoopConstraints,
    inspectionContext,
    selection,
  ]);

  return (
    <AIInspectionModal
      isOpen={isOpen}
      onClose={onClose}
      robot={robot}
      lang={lang}
      onSelectItem={(type, id) => {
        setSelection({ type, id });
        pulseSelection({ type, id });
        focusOn(id);
      }}
      onOpenConversationWithReport={onOpenConversationWithReport}
    />
  );
}
