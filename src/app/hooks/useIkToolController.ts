import { useCallback, useMemo } from 'react';
import { resolveDirectManipulableLinkIkJointIds } from '@/core/robot';
import { resolveIkToolSelectionState } from '../utils/ikToolSelectionState';
import type { RobotData } from '@/types';
import type { InteractionSelection } from '@/types';

export interface IkToolLinkOption {
  value: string;
  label: string;
}

interface UseIkToolControllerParams {
  ikDragActive: boolean;
  previewContextRobot: RobotData;
  robotLinks: RobotData['links'];
  robotJoints: RobotData['joints'];
  rootLinkId: string | null;
  selection: InteractionSelection | null;
  setSelection: (selection: InteractionSelection) => void;
}

interface ResolveIkToolLinkOptionsParams {
  robotLinks?: RobotData['links'] | null;
  robotJoints?: RobotData['joints'] | null;
  rootLinkId?: string | null;
}

function resolveLinkOptionLabel(linkId: string, linkName: string | undefined): string {
  if (!linkName || linkName === linkId) {
    return linkId;
  }

  return `${linkName} (${linkId})`;
}

export function resolveIkToolLinkOptions({
  robotLinks,
  robotJoints,
  rootLinkId,
}: ResolveIkToolLinkOptionsParams): IkToolLinkOption[] {
  if (!robotLinks || !robotJoints || !rootLinkId) {
    return [];
  }

  return Object.entries(robotLinks)
    .filter(([linkId]) => linkId !== rootLinkId)
    .filter(([linkId]) => {
      const jointIds = resolveDirectManipulableLinkIkJointIds(
        {
          links: robotLinks,
          joints: robotJoints,
          rootLinkId,
        },
        linkId,
      );

      return Boolean(jointIds?.length);
    })
    .map(([linkId, link]) => ({
      value: linkId,
      label: resolveLinkOptionLabel(linkId, link?.name),
    }))
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );
}

export function useIkToolController({
  ikDragActive,
  previewContextRobot,
  robotLinks,
  robotJoints,
  rootLinkId,
  selection,
  setSelection,
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
  const ikLinkOptions = useMemo(
    () =>
      resolveIkToolLinkOptions({
        robotLinks: previewContextRobot.links,
        robotJoints,
        rootLinkId,
      }),
    [previewContextRobot.links, robotJoints, rootLinkId],
  );
  const selectableIkLinkIds = useMemo(
    () => new Set(ikLinkOptions.map((option) => option.value)),
    [ikLinkOptions],
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
  const selectIkLink = useCallback(
    (linkId: string) => {
      if (!selectableIkLinkIds.has(linkId)) {
        return;
      }

      setSelection({
        type: 'link',
        id: linkId,
        helperKind: 'ik-handle',
      });
    },
    [selectableIkLinkIds, setSelection],
  );

  return {
    ikToolSelectionState,
    ikLinkOptions,
    selectedIkLinkId,
    selectedIkLinkLabel,
    currentIkLinkLabel,
    selectIkLink,
  };
}
