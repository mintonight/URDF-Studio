import { useMemo } from 'react';
import {
  resolveWorkspaceOverlayGizmoMargin,
  resolveWorkspaceOverlaySafeAreaStyle,
  type WorkspaceOverlayGizmoMargin,
} from '@/shared/components/3d/scene/viewerOverlaySafeArea';
import { buildPropertyEditorSelectionContext } from '../utils/propertyEditorSelectionContext';
import { resolveWorkspaceOverlayLayoutClassNames } from '../utils/workspaceOverlayLayout';

type PropertyEditorRobot = Parameters<typeof buildPropertyEditorSelectionContext>[0];
type PropertyEditorAssemblyState = Parameters<typeof buildPropertyEditorSelectionContext>[1];

interface UseWorkspaceLayoutDerivationsParams {
  normalizedAssemblyState: PropertyEditorAssemblyState;
  panelLayout: {
    propertyEditorWidth: number;
    treeSidebarWidth: number;
  };
  previewContextRobot: PropertyEditorRobot;
  sidebar: {
    leftCollapsed: boolean;
    rightCollapsed: boolean;
  };
}

export function useWorkspaceLayoutDerivations({
  normalizedAssemblyState,
  panelLayout,
  previewContextRobot,
  sidebar,
}: UseWorkspaceLayoutDerivationsParams) {
  const propertyEditorSelectionContext = useMemo(
    () => buildPropertyEditorSelectionContext(previewContextRobot, normalizedAssemblyState),
    [normalizedAssemblyState, previewContextRobot],
  );
  const workspaceLayoutClassNames = useMemo(() => resolveWorkspaceOverlayLayoutClassNames(), []);
  const workspaceOverlaySafeAreaStyle = useMemo(
    () =>
      resolveWorkspaceOverlaySafeAreaStyle({
        leftCollapsed: sidebar.leftCollapsed,
        propertyEditorWidth: panelLayout.propertyEditorWidth,
        rightCollapsed: sidebar.rightCollapsed,
        treeSidebarWidth: panelLayout.treeSidebarWidth,
      }),
    [
      panelLayout.propertyEditorWidth,
      panelLayout.treeSidebarWidth,
      sidebar.leftCollapsed,
      sidebar.rightCollapsed,
    ],
  );
  const workspaceOverlayGizmoMargin = useMemo<WorkspaceOverlayGizmoMargin>(
    () =>
      resolveWorkspaceOverlayGizmoMargin({
        leftCollapsed: sidebar.leftCollapsed,
        propertyEditorWidth: panelLayout.propertyEditorWidth,
        rightCollapsed: sidebar.rightCollapsed,
        treeSidebarWidth: panelLayout.treeSidebarWidth,
      }),
    [
      panelLayout.propertyEditorWidth,
      panelLayout.treeSidebarWidth,
      sidebar.leftCollapsed,
      sidebar.rightCollapsed,
    ],
  );

  return {
    propertyEditorSelectionContext,
    workspaceLayoutClassNames,
    workspaceOverlaySafeAreaStyle,
    workspaceOverlayGizmoMargin,
  };
}
