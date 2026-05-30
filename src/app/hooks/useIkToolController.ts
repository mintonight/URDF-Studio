import { useMemo } from 'react';
import { resolveIkToolSelectionState } from '../utils/ikToolSelectionState';
import type { RobotData } from '@/types';
import type { InteractionSelection } from '@/types';

interface UseIkToolControllerParams {
  ikDragActive: boolean;
  previewContextRobot: RobotData;
  robotLinks: RobotData['links'];
  robotJoints: RobotData['joints'];
  rootLinkId: string | null;
  selection: InteractionSelection | null;
}

export function useIkToolController({
  ikDragActive,
  previewContextRobot,
  robotLinks,
  robotJoints,
  rootLinkId,
  selection,
}: UseIkToolControllerParams) {
  const ikToolSelectionState = useMemo(
    () =>
      resolveIkToolSelectionState({
        selection,
        ikDragActive,
        robotLinks: previewContextRobot.links,
        robotJoints,
        rootLinkId,
      }),
    [ikDragActive, previewContextRobot.links, robotJoints, rootLinkId, selection],
  );
  const selectedIkLinkId = ikToolSelectionState.selectedLinkId;
  const selectedIkLinkLabel = useMemo(() => {
    if (!selectedIkLinkId) {
      return null;
    }

    return (
      previewContextRobot.links[selectedIkLinkId]?.name ??
      robotLinks[selectedIkLinkId]?.name ??
      selectedIkLinkId
    );
  }, [previewContextRobot.links, robotLinks, selectedIkLinkId]);
  const currentIkLinkLabel = useMemo(() => {
    if (!ikToolSelectionState.currentLinkId) {
      return null;
    }

    return (
      previewContextRobot.links[ikToolSelectionState.currentLinkId]?.name ??
      robotLinks[ikToolSelectionState.currentLinkId]?.name ??
      ikToolSelectionState.currentLinkId
    );
  }, [ikToolSelectionState.currentLinkId, previewContextRobot.links, robotLinks]);

  return {
    ikToolSelectionState,
    selectedIkLinkId,
    selectedIkLinkLabel,
    currentIkLinkLabel,
  };
}
