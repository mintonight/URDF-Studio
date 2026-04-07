import React from 'react';

import type { AppMode, AssemblyState, RobotFile, RobotState, Theme } from '@/types';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransforms';
import {
  denormalizeSourceSceneAssemblyComponentTransform,
  normalizeSourceSceneAssemblyComponentTransform,
} from '@/app/utils/sourceSceneAssemblyTransform';
import { useResolvedTheme } from '@/shared/hooks';
import {
  createInitialUnifiedViewerMountState,
  resolveUnifiedViewerMountState,
  resolveUnifiedViewerSessionState,
  type UnifiedViewerMountState,
} from '@/app/utils/unifiedViewerMountState';
import { resolveUnifiedViewerHandoffReadyState } from '@/app/utils/unifiedViewerHandoffReadyState';
import { captureUnifiedViewerOptionsVisibility } from '@/app/utils/unifiedViewerOptionsRestore';
import { buildUnifiedViewerResourceScopes } from '@/app/utils/unifiedViewerResourceScopes';
import { resolveUnifiedViewerVisualizerRobot } from '@/app/utils/unifiedViewerSceneRobots';
import { resolveUnifiedViewerViewportState } from '@/app/utils/unifiedViewerViewportState';
import { useUIStore } from '@/store';
import type { AssemblySelection } from '@/store/assemblySelectionStore';
import type { DocumentLoadLifecycleState } from '@/store/assetsStore';
import type { UpdateCommitOptions } from '@/types/viewer';
import { setRegressionViewerResourceScope } from '@/shared/debug/regressionBridge';
import {
  buildViewerRobotLinksScopeSignature,
  type ToolMode,
  type ViewerResourceScope,
  type ViewerRobotSourceFormat,
} from '@/features/urdf-viewer';

import type { FilePreviewState } from './types';

interface UseUnifiedViewerDerivedStateParams {
  mode: AppMode;
  filePreview?: FilePreviewState;
  pendingViewerToolMode?: ToolMode | null;
  theme: Theme;
  showOptionsPanel: boolean;
  showVisualizerOptionsPanel: boolean;
  visualizerRobotInput?: RobotState;
  robot: RobotState;
  assemblyWorkspaceActive: boolean;
  urdfContent: string;
  sourceFilePath?: string;
  sourceFile?: RobotFile | null;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  assemblyState?: AssemblyState | null;
  sourceSceneAssemblyComponentId?: string | null;
  assemblySelection?: AssemblySelection;
  onComponentTransform?: (
    componentId: string,
    transform: {
      position: { x: number; y: number; z: number };
      rotation: { r: number; p: number; y: number };
    },
    options?: UpdateCommitOptions,
  ) => void;
  viewerReloadKey?: number;
  documentLoadState: DocumentLoadLifecycleState;
}

export function useUnifiedViewerDerivedState({
  mode,
  filePreview,
  pendingViewerToolMode = null,
  theme,
  showOptionsPanel,
  showVisualizerOptionsPanel,
  visualizerRobotInput,
  robot,
  assemblyWorkspaceActive,
  urdfContent,
  sourceFilePath,
  sourceFile,
  assets,
  availableFiles,
  assemblyState,
  sourceSceneAssemblyComponentId = null,
  assemblySelection,
  onComponentTransform,
  viewerReloadKey = 0,
  documentLoadState,
}: UseUnifiedViewerDerivedStateParams) {
  const groundPlaneOffset = useUIStore((state) => state.groundPlaneOffset);
  const setGroundPlaneOffset = useUIStore((state) => state.setGroundPlaneOffset);
  const [forcedViewerSession, setForcedViewerSession] = React.useState(false);
  const viewerToolSessionActive = pendingViewerToolMode === 'measure' || forcedViewerSession;
  const sessionState = React.useMemo(
    () =>
      resolveUnifiedViewerSessionState({
        mode,
        filePreview,
        forceViewerSession: viewerToolSessionActive,
      }),
    [filePreview, mode, viewerToolSessionActive],
  );
  const { activePreview, isPreviewing, isViewerMode } = sessionState;
  const viewerSceneMode = sessionState.viewerSceneMode;
  const [mountState, setMountState] = React.useState<UnifiedViewerMountState>(() =>
    createInitialUnifiedViewerMountState({
      mode,
      isPreviewing,
      forceViewerSession: viewerToolSessionActive,
    }),
  );
  const [viewerSceneReady, setViewerSceneReady] = React.useState(!isViewerMode);
  const resolvedTheme = useResolvedTheme(theme);
  const viewerOptionsVisibleRef = React.useRef(showOptionsPanel);
  const visualizerOptionsVisibleRef = React.useRef(showVisualizerOptionsPanel);
  const previousIsViewerModeRef = React.useRef(isViewerMode);
  const viewerPendingLoadScopeRef = React.useRef<string | null>(null);
  const viewerReleasedLoadScopeRef = React.useRef<string | null>(null);
  const viewerResourceScopeRef = React.useRef<ViewerResourceScope | null>(null);
  const visualizerResourceScopeRef = React.useRef<ViewerResourceScope | null>(null);
  const optionsVisibleAtPointerDownRef = React.useRef(
    captureUnifiedViewerOptionsVisibility({
      showViewerOptions: showOptionsPanel,
      showVisualizerOptions: showVisualizerOptionsPanel,
    }),
  );

  React.useEffect(() => {
    viewerOptionsVisibleRef.current = showOptionsPanel;
  }, [showOptionsPanel]);

  React.useEffect(() => {
    visualizerOptionsVisibleRef.current = showVisualizerOptionsPanel;
  }, [showVisualizerOptionsPanel]);

  React.useEffect(() => {
    setMountState((current) =>
      resolveUnifiedViewerMountState(current, {
        mode,
        isPreviewing,
        forceViewerSession: viewerToolSessionActive,
      }),
    );
  }, [isPreviewing, mode, viewerToolSessionActive]);

  const visualizerRobot = React.useMemo(
    () =>
      resolveUnifiedViewerVisualizerRobot({
        robot: visualizerRobotInput ?? robot,
        viewerRobot: robot,
        assemblyWorkspaceActive,
      }),
    [assemblyWorkspaceActive, robot, visualizerRobotInput],
  );
  const viewerRobotLinksScopeSignature = React.useMemo(
    () => buildViewerRobotLinksScopeSignature(activePreview ? undefined : robot.links),
    [activePreview, robot.links],
  );
  const viewerRobotLinksForScope = React.useMemo(
    () => (activePreview ? undefined : robot.links),
    [activePreview, viewerRobotLinksScopeSignature],
  );
  const visualizerRobotLinksScopeSignature = React.useMemo(
    () => buildViewerRobotLinksScopeSignature(visualizerRobot.links),
    [visualizerRobot.links],
  );
  const visualizerRobotLinksForScope = React.useMemo(
    () => visualizerRobot.links,
    [visualizerRobotLinksScopeSignature],
  );
  const {
    effectiveUrdfContent,
    effectiveSourceFilePath,
    effectiveSourceFile,
    activeViewportFileName,
    viewerResourceScope,
    visualizerResourceScope,
  } = React.useMemo(() => {
    const next = buildUnifiedViewerResourceScopes({
      activePreview,
      urdfContent,
      sourceFilePath,
      sourceFile,
      assets,
      availableFiles,
      viewerRobotLinks: viewerRobotLinksForScope,
      visualizerRobotLinks: visualizerRobotLinksForScope,
      previousViewerResourceScope: viewerResourceScopeRef.current,
      previousVisualizerResourceScope: visualizerResourceScopeRef.current,
    });
    viewerResourceScopeRef.current = next.viewerResourceScope;
    visualizerResourceScopeRef.current = next.visualizerResourceScope;
    return next;
  }, [
    activePreview,
    assets,
    availableFiles,
    sourceFile,
    sourceFilePath,
    urdfContent,
    viewerRobotLinksForScope,
    visualizerRobotLinksForScope,
  ]);

  React.useEffect(() => {
    setRegressionViewerResourceScope({
      sourceFileName: effectiveSourceFile?.name ?? null,
      sourceFilePath: effectiveSourceFilePath ?? null,
      assetKeys: Object.keys(viewerResourceScope.assets).sort((left, right) =>
        left.localeCompare(right),
      ),
      availableFileNames: viewerResourceScope.availableFiles
        .map((file) => file.name)
        .sort((left, right) => left.localeCompare(right)),
      signature: viewerResourceScope.signature,
    });

    return () => {
      setRegressionViewerResourceScope(null);
    };
  }, [effectiveSourceFile?.name, effectiveSourceFilePath, viewerResourceScope]);

  const sourceSceneAssemblyComponent = React.useMemo(() => {
    if (!sourceSceneAssemblyComponentId || !assemblyState) {
      return null;
    }

    const component = assemblyState.components[sourceSceneAssemblyComponentId];
    if (!component || component.visible === false) {
      return null;
    }

    return component;
  }, [assemblyState, sourceSceneAssemblyComponentId]);
  const sourceSceneAssemblyComponentTransform = React.useMemo(
    () => normalizeSourceSceneAssemblyComponentTransform(sourceSceneAssemblyComponent),
    [sourceSceneAssemblyComponent],
  );
  const handleSourceSceneAssemblyComponentTransform = React.useCallback(
    (
      componentId: string,
      transform: {
        position: { x: number; y: number; z: number };
        rotation: { r: number; p: number; y: number };
      },
      options?: UpdateCommitOptions,
    ) => {
      if (!onComponentTransform) {
        return;
      }

      const normalizedTransform =
        sourceSceneAssemblyComponent && sourceSceneAssemblyComponent.id === componentId
          ? denormalizeSourceSceneAssemblyComponentTransform(
              sourceSceneAssemblyComponent,
              transform,
            )
          : cloneAssemblyTransform(transform);

      onComponentTransform(componentId, normalizedTransform, options);
    },
    [onComponentTransform, sourceSceneAssemblyComponent],
  );
  const showSourceSceneAssemblyComponentControls = Boolean(
    sourceSceneAssemblyComponent &&
    assemblySelection?.type === 'component' &&
    assemblySelection.id === sourceSceneAssemblyComponent.id,
  );

  const pendingViewerLoadScopeKey = viewerPendingLoadScopeRef.current;
  const releasedViewerLoadScopeKey = viewerReleasedLoadScopeRef.current;
  const viewportState = React.useMemo(
    () =>
      resolveUnifiedViewerViewportState({
        mode,
        isViewerMode,
        isPreviewing,
        mountState,
        previousIsViewerMode: previousIsViewerModeRef.current,
        viewerSceneReady,
        activeViewportFileName,
        viewerReloadKey,
        pendingViewerLoadScopeKey,
        releasedViewerLoadScopeKey,
        documentLoadState,
        shouldUseVisualizerViewportHandoff: false,
      }),
    [
      activeViewportFileName,
      documentLoadState,
      isPreviewing,
      isViewerMode,
      mode,
      mountState,
      pendingViewerLoadScopeKey,
      releasedViewerLoadScopeKey,
      viewerReloadKey,
      viewerSceneReady,
    ],
  );

  const handoffReadyState = React.useMemo(
    () =>
      resolveUnifiedViewerHandoffReadyState({
        isViewerMode,
        isPreviewing,
        visualizerAvailableForViewportHandoff: viewportState.visualizerAvailableForViewportHandoff,
        viewerLoadScopeKey: viewportState.viewerLoadScopeKey,
        pendingViewerLoadScopeKey,
        releasedViewerLoadScopeKey,
        startViewerViewportHandoff: viewportState.startViewerViewportHandoff,
        continueViewerViewportHandoff: viewportState.continueViewerViewportHandoff,
        keepExistingViewerViewportHandoff: viewportState.keepExistingViewerViewportHandoff,
        hasPendingViewerHandoffForScope: viewportState.hasPendingViewerHandoffForScope,
      }),
    [
      isPreviewing,
      isViewerMode,
      pendingViewerLoadScopeKey,
      releasedViewerLoadScopeKey,
      viewportState.continueViewerViewportHandoff,
      viewportState.hasPendingViewerHandoffForScope,
      viewportState.keepExistingViewerViewportHandoff,
      viewportState.startViewerViewportHandoff,
      viewportState.viewerLoadScopeKey,
      viewportState.visualizerAvailableForViewportHandoff,
    ],
  );

  return {
    groundPlaneOffset,
    setGroundPlaneOffset,
    forcedViewerSession,
    setForcedViewerSession,
    activePreview,
    isPreviewing,
    isViewerMode,
    viewerSceneMode,
    mountState,
    setMountState,
    viewerSceneReady,
    setViewerSceneReady,
    resolvedTheme,
    viewerOptionsVisibleRef,
    visualizerOptionsVisibleRef,
    previousIsViewerModeRef,
    viewerPendingLoadScopeRef,
    viewerReleasedLoadScopeRef,
    optionsVisibleAtPointerDownRef,
    visualizerRobot,
    effectiveUrdfContent,
    effectiveSourceFilePath,
    effectiveSourceFile,
    activeViewportFileName,
    viewerResourceScope,
    visualizerResourceScope,
    sourceSceneAssemblyComponent,
    sourceSceneAssemblyComponentTransform,
    handleSourceSceneAssemblyComponentTransform,
    showSourceSceneAssemblyComponentControls,
    pendingViewerLoadScopeKey,
    releasedViewerLoadScopeKey,
    viewportState,
    handoffReadyState,
  };
}
