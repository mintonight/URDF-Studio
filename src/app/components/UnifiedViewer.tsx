import React, { useEffect } from 'react';
import type { Group as ThreeGroup, Object3D as ThreeObject3D } from 'three';
import type {
  AppMode,
  AssemblyState,
  InteractionSelection,
  RobotFile,
  RobotState,
  Theme,
} from '@/types';
import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { WorkspaceCanvas } from '@/shared/components/3d';
import {
  STUDIO_ENVIRONMENT_INTENSITY,
  WORKSPACE_CANVAS_BACKGROUND,
  type SnapshotCaptureAction,
} from '@/shared/components/3d';
import { useVisualizerController } from '@/features/visualizer/hooks/useVisualizerController';
import { useURDFViewerController } from '@/features/urdf-viewer/hooks/useURDFViewerController';
import { resolveDefaultViewerToolMode } from '@/features/urdf-viewer/utils/scopedToolMode';
import type {
  ViewerHelperKind,
  ToolMode,
  ViewerDocumentLoadEvent,
  ViewerJointMotionStateValue,
  ViewerRobotSourceFormat,
} from '@/features/urdf-viewer/types';
import type { ViewerRobotDataResolution } from '@/features/urdf-viewer/utils/viewerRobotData';
import { resolveViewerJointScopeKey } from '@/app/utils/viewerJointScopeKey';
import { resolveUnifiedViewerForcedSessionState } from '@/app/utils/unifiedViewerForcedSessionState';
import { resolveUnifiedViewerLoadReleaseState } from '@/app/utils/unifiedViewerLoadReleaseState';
import {
  captureUnifiedViewerOptionsVisibility,
  shouldRestoreUnifiedViewerOptionsPanel,
} from '@/app/utils/unifiedViewerOptionsRestore';
import { useUIStore } from '@/store';
import type { AssemblySelection } from '@/store/assemblySelectionStore';
import type { DocumentLoadLifecycleState } from '@/store/assetsStore';
import type { UpdateCommitOptions } from '@/types/viewer';
import {
  syncGroupRaycastInteractivity,
  type RaycastableObject,
} from './unified-viewer/raycastInteractivity';
import {
  preloadViewerModeModules,
  preloadVisualizerModeModules,
} from './unified-viewer/modeModuleLoaders';
import { handleUnifiedViewerWorkspaceLeave } from '@/app/utils/unifiedViewerHoverReset';
import { UnifiedViewerOverlays } from './unified-viewer/UnifiedViewerOverlays';
import { UnifiedViewerSceneRoots } from './unified-viewer/UnifiedViewerSceneRoots';
import type { FilePreviewState } from './unified-viewer/types';
import { useUnifiedViewerDerivedState } from './unified-viewer/useUnifiedViewerDerivedState';
import { useSelectionStore } from '@/store/selectionStore';

interface UnifiedViewerProps {
  robot: RobotState;
  visualizerRobot?: RobotState;
  mode: AppMode;
  onSelect: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  onMeshSelect?: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision',
  ) => void;
  onHover?: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  assets: Record<string, string>;
  lang: Language;
  theme: Theme;
  showVisual?: boolean;
  setShowVisual?: (show: boolean) => void;
  snapshotAction?: React.RefObject<SnapshotCaptureAction | null>;
  showToolbar?: boolean;
  setShowToolbar?: (show: boolean) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showVisualizerOptionsPanel?: boolean;
  setShowVisualizerOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
  availableFiles: RobotFile[];
  urdfContent: string;
  viewerSourceFormat?: ViewerRobotSourceFormat;
  sourceFilePath?: string;
  sourceFile?: RobotFile | null;
  onRobotDataResolved?: (result: ViewerRobotDataResolution) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  jointAngleState?: Record<string, number>;
  jointMotionState?: Record<string, ViewerJointMotionStateValue>;
  onJointChange?: (jointName: string, angle: number) => void;
  syncJointChangesToApp?: boolean;
  selection?: InteractionSelection;
  focusTarget?: string | null;
  isMeshPreview?: boolean;
  onTransformPendingChange?: (pending: boolean) => void;
  onCollisionTransformPreview?: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onCollisionTransform?: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  assemblyState?: AssemblyState | null;
  assemblyWorkspaceActive?: boolean;
  assemblySelection?: AssemblySelection;
  sourceSceneAssemblyComponentId?: string | null;
  onAssemblyTransform?: (transform: {
    position: { x: number; y: number; z: number };
    rotation: { r: number; p: number; y: number };
  }) => void;
  onComponentTransform?: (
    componentId: string,
    transform: {
      position: { x: number; y: number; z: number };
      rotation: { r: number; p: number; y: number };
    },
    options?: UpdateCommitOptions,
  ) => void;
  onBridgeTransform?: (
    bridgeId: string,
    origin: {
      xyz: { x: number; y: number; z: number };
      rpy: { r: number; p: number; y: number };
      quatXyzw?: { x: number; y: number; z: number; w: number };
    },
  ) => void;
  filePreview?: FilePreviewState;
  onClosePreview?: () => void;
  pendingViewerToolMode?: ToolMode | null;
  onConsumePendingViewerToolMode?: () => void;
  viewerReloadKey?: number;
  documentLoadState: DocumentLoadLifecycleState;
}

const INACTIVE_SCENE_UNMOUNT_DELAY_MS = 15_000;

type IdleScheduler = {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export const UnifiedViewer = React.memo(
  ({
    robot,
    visualizerRobot: visualizerRobotInput,
    mode,
    onSelect,
    onMeshSelect,
    onHover,
    onUpdate,
    assets,
    lang,
    theme,
    showVisual,
    setShowVisual,
    snapshotAction,
    showToolbar = true,
    setShowToolbar,
    showOptionsPanel = true,
    setShowOptionsPanel,
    showVisualizerOptionsPanel = true,
    setShowVisualizerOptionsPanel,
    showJointPanel = true,
    setShowJointPanel,
    availableFiles,
    urdfContent,
    viewerSourceFormat,
    sourceFilePath,
    sourceFile,
    onRobotDataResolved,
    onDocumentLoadEvent,
    jointAngleState,
    jointMotionState,
    onJointChange,
    syncJointChangesToApp = false,
    selection,
    focusTarget,
    isMeshPreview = false,
    onTransformPendingChange,
    onCollisionTransformPreview,
    onCollisionTransform,
    assemblyState,
    assemblyWorkspaceActive = false,
    assemblySelection,
    sourceSceneAssemblyComponentId = null,
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
    filePreview,
    onClosePreview,
    pendingViewerToolMode = null,
    onConsumePendingViewerToolMode,
    viewerReloadKey = 0,
    documentLoadState,
  }: UnifiedViewerProps) => {
    const t = translations[lang];
    const clearHover = useSelectionStore((state) => state.clearHover);
    const {
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
    } = useUnifiedViewerDerivedState({
      mode,
      filePreview,
      pendingViewerToolMode,
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
      sourceSceneAssemblyComponentId,
      assemblySelection,
      onComponentTransform,
      viewerReloadKey,
      documentLoadState,
    });
    const effectiveJointAngleState = isPreviewing ? undefined : jointAngleState;
    const effectiveJointMotionState = isPreviewing ? undefined : jointMotionState;
    const effectiveSyncJointChangesToApp = isPreviewing ? false : syncJointChangesToApp;
    const {
      viewerLoadScopeKey,
      hasPendingViewerHandoffForScope,
      visualizerAvailableForViewportHandoff,
      startViewerViewportHandoff,
      continueViewerViewportHandoff,
      keepExistingViewerViewportHandoff,
      displayVisualizerWhileViewerLoads,
      keepViewerMountedDuringHandoff,
      viewerVisible,
      visualizerVisible,
      shouldRenderViewerScene,
      shouldRenderVisualizerScene,
      activeScene,
      useViewerCanvasPresentation,
      visualizerRuntimeMode,
    } = viewportState;
    const viewerGroupRef = React.useRef<ThreeGroup | null>(null);
    const visualizerGroupRef = React.useRef<ThreeGroup | null>(null);
    const viewerRaycastCacheRef = React.useRef(
      new WeakMap<RaycastableObject, NonNullable<RaycastableObject['raycast']>>(),
    );
    const viewerRetainedRobotRef = React.useRef<ThreeObject3D | null>(null);
    const viewerRetainedRobotReleaseTimerRef = React.useRef<number | null>(null);
    const viewerUnmountTimerRef = React.useRef<number | null>(null);
    const visualizerUnmountTimerRef = React.useRef<number | null>(null);
    const visualizerRaycastCacheRef = React.useRef(
      new WeakMap<RaycastableObject, NonNullable<RaycastableObject['raycast']>>(),
    );
    const clearRetainedViewerRobot = React.useCallback(() => {
      if (viewerRetainedRobotReleaseTimerRef.current !== null) {
        window.clearTimeout(viewerRetainedRobotReleaseTimerRef.current);
        viewerRetainedRobotReleaseTimerRef.current = null;
      }

      viewerRetainedRobotRef.current = null;
    }, []);

    useEffect(() => {
      previousIsViewerModeRef.current = isViewerMode;
    }, [isViewerMode]);

    useEffect(() => {
      viewerPendingLoadScopeRef.current = handoffReadyState.pendingViewerLoadScopeKey;
      setViewerSceneReady(handoffReadyState.viewerSceneReady);
    }, [handoffReadyState.pendingViewerLoadScopeKey, handoffReadyState.viewerSceneReady]);

    // Keep quick mode flips warm, but unmount the inactive scene once the user
    // settles so hidden useFrame subscriptions stop consuming work in the background.
    useEffect(() => {
      if (viewerVisible || keepViewerMountedDuringHandoff) {
        if (viewerUnmountTimerRef.current !== null) {
          window.clearTimeout(viewerUnmountTimerRef.current);
          viewerUnmountTimerRef.current = null;
        }
        return;
      }

      if (!mountState.viewerMounted) {
        return;
      }

      viewerUnmountTimerRef.current = window.setTimeout(() => {
        viewerUnmountTimerRef.current = null;
        setMountState((current) =>
          current.viewerMounted ? { ...current, viewerMounted: false } : current,
        );
      }, INACTIVE_SCENE_UNMOUNT_DELAY_MS);

      return () => {
        if (viewerUnmountTimerRef.current !== null) {
          window.clearTimeout(viewerUnmountTimerRef.current);
          viewerUnmountTimerRef.current = null;
        }
      };
    }, [keepViewerMountedDuringHandoff, mountState.viewerMounted, viewerVisible]);

    useEffect(() => {
      if (visualizerVisible) {
        if (visualizerUnmountTimerRef.current !== null) {
          window.clearTimeout(visualizerUnmountTimerRef.current);
          visualizerUnmountTimerRef.current = null;
        }
        return;
      }

      if (!mountState.visualizerMounted) {
        return;
      }

      visualizerUnmountTimerRef.current = window.setTimeout(() => {
        visualizerUnmountTimerRef.current = null;
        setMountState((current) =>
          current.visualizerMounted ? { ...current, visualizerMounted: false } : current,
        );
      }, INACTIVE_SCENE_UNMOUNT_DELAY_MS);

      return () => {
        if (visualizerUnmountTimerRef.current !== null) {
          window.clearTimeout(visualizerUnmountTimerRef.current);
          visualizerUnmountTimerRef.current = null;
        }
      };
    }, [mountState.visualizerMounted, visualizerVisible]);

    useEffect(
      () => () => {
        if (viewerUnmountTimerRef.current !== null) {
          window.clearTimeout(viewerUnmountTimerRef.current);
          viewerUnmountTimerRef.current = null;
        }
        if (visualizerUnmountTimerRef.current !== null) {
          window.clearTimeout(visualizerUnmountTimerRef.current);
          visualizerUnmountTimerRef.current = null;
        }
        clearRetainedViewerRobot();
      },
      [clearRetainedViewerRobot],
    );

    const visualizerController = useVisualizerController({
      robot: visualizerRobot,
      onUpdate,
      mode: visualizerRuntimeMode,
      assemblyWorkspaceActive,
      propShowVisual: showVisual,
      propSetShowVisual: setShowVisual,
    });
    const viewerDefaultToolMode = resolveDefaultViewerToolMode(effectiveSourceFile?.format);
    const viewerToolModeScopeKey = effectiveSourceFile
      ? `${effectiveSourceFile.format}:${effectiveSourceFile.name}`
      : effectiveSourceFilePath
        ? `inline:${effectiveSourceFilePath}`
        : 'inline:unified-viewer';
    const viewerController = useURDFViewerController({
      onJointChange,
      syncJointChangesToApp: effectiveSyncJointChangesToApp,
      showJointPanel,
      jointAngleState: effectiveJointAngleState,
      jointMotionState: effectiveJointMotionState,
      onSelect,
      onMeshSelect,
      onHover,
      selection,
      showVisual,
      setShowVisual,
      onTransformPendingChange,
      groundPlaneOffset,
      setGroundPlaneOffset,
      active: isViewerMode,
      jointStateScopeKey: resolveViewerJointScopeKey({
        previewFileName: activePreview?.fileName,
        sourceFile,
        sourceFilePath,
        robotName: robot.name,
      }),
      defaultToolMode: viewerDefaultToolMode,
      toolModeScopeKey: viewerToolModeScopeKey,
      closedLoopRobotState: visualizerRobot,
    });
    const nextForcedViewerSession = resolveUnifiedViewerForcedSessionState({
      forcedViewerSession,
      pendingViewerToolMode,
      viewerToolMode: viewerController.toolMode,
    });

    useEffect(() => {
      if (forcedViewerSession === nextForcedViewerSession) {
        return;
      }

      setForcedViewerSession(nextForcedViewerSession);
    }, [forcedViewerSession, nextForcedViewerSession]);

    const handleViewerDocumentLoadEvent = React.useCallback(
      (event: ViewerDocumentLoadEvent) => {
        // `ready` means the runtime finished loading, not that the first frame has
        // already painted. Releasing handoff on `ready` can still expose one blank
        // frame, so only terminate immediately on hard errors.
        if (event.status === 'error') {
          const releaseState = resolveUnifiedViewerLoadReleaseState({
            pendingViewerLoadScopeKey: viewerPendingLoadScopeRef.current,
            viewerLoadScopeKey,
          });
          if (!releaseState.canReleaseViewerLoadScope) {
            onDocumentLoadEvent?.(event);
            return;
          }

          viewerReleasedLoadScopeRef.current = releaseState.releasedViewerLoadScopeKey;
          viewerPendingLoadScopeRef.current = releaseState.pendingViewerLoadScopeKey;
          setViewerSceneReady(releaseState.viewerSceneReady);
        }
        onDocumentLoadEvent?.(event);
      },
      [onDocumentLoadEvent, viewerLoadScopeKey],
    );
    const handleViewerSceneReadyForDisplay = React.useCallback(() => {
      const releaseState = resolveUnifiedViewerLoadReleaseState({
        pendingViewerLoadScopeKey: viewerPendingLoadScopeRef.current,
        viewerLoadScopeKey,
      });
      if (!releaseState.canReleaseViewerLoadScope) {
        return;
      }

      viewerReleasedLoadScopeRef.current = releaseState.releasedViewerLoadScopeKey;
      viewerPendingLoadScopeRef.current = releaseState.pendingViewerLoadScopeKey;
      setViewerSceneReady(releaseState.viewerSceneReady);
    }, [viewerLoadScopeKey]);

    const controlLayerKey = 'shared';
    const workspaceEnvironment = 'studio' as const;
    const workspaceEnvironmentIntensity = useViewerCanvasPresentation
      ? STUDIO_ENVIRONMENT_INTENSITY.viewer[resolvedTheme]
      : STUDIO_ENVIRONMENT_INTENSITY.workspace[resolvedTheme];
    const showWorldOriginAxesPreference = useUIStore((state) => state.viewOptions.showAxes);
    const showUsageGuidePreference = useUIStore((state) => state.viewOptions.showUsageGuide);
    const showWorldOriginAxes =
      showWorldOriginAxesPreference &&
      (activeScene === 'viewer'
        ? !viewerController.showOrigins
        : !visualizerController.state.showOrigin);

    const handleWorkspacePointerDownCapture = React.useCallback(() => {
      optionsVisibleAtPointerDownRef.current = captureUnifiedViewerOptionsVisibility({
        showViewerOptions: showOptionsPanel,
        showVisualizerOptions: showVisualizerOptionsPanel,
      });
    }, [showOptionsPanel, showVisualizerOptionsPanel]);

    // Blank-canvas clicks should clear selection, not dismiss an already-open options panel.
    const restoreOptionsPanelIfNeeded = React.useCallback(
      (
        wasVisibleAtPointerDown: boolean,
        panelVisibleRef: React.MutableRefObject<boolean>,
        restoreOptionsPanel: ((show: boolean) => void) | undefined,
      ) => {
        if (
          !shouldRestoreUnifiedViewerOptionsPanel({
            wasVisibleAtPointerDown,
            isVisibleNow: panelVisibleRef.current,
            hasRestoreHandler: Boolean(restoreOptionsPanel),
          }) ||
          !restoreOptionsPanel
        ) {
          return;
        }

        window.requestAnimationFrame(() => {
          if (
            shouldRestoreUnifiedViewerOptionsPanel({
              wasVisibleAtPointerDown,
              isVisibleNow: panelVisibleRef.current,
              hasRestoreHandler: true,
            })
          ) {
            restoreOptionsPanel(true);
          }
        });
      },
      [],
    );

    const handleViewerPointerMissed = React.useCallback(() => {
      viewerController.handlePointerMissed();
      restoreOptionsPanelIfNeeded(
        optionsVisibleAtPointerDownRef.current.viewer,
        viewerOptionsVisibleRef,
        setShowOptionsPanel,
      );
    }, [restoreOptionsPanelIfNeeded, setShowOptionsPanel, viewerController]);

    const handleVisualizerPointerMissed = React.useCallback(() => {
      visualizerController.clearSelection();
      restoreOptionsPanelIfNeeded(
        optionsVisibleAtPointerDownRef.current.visualizer,
        visualizerOptionsVisibleRef,
        setShowVisualizerOptionsPanel,
      );
    }, [restoreOptionsPanelIfNeeded, setShowVisualizerOptionsPanel, visualizerController]);

    const visualizerSceneSignature = React.useMemo(
      () =>
        [
          visualizerRobot.name,
          visualizerRobot.rootLinkId,
          Object.keys(visualizerRobot.links).length,
          Object.keys(visualizerRobot.joints).length,
          visualizerRuntimeMode,
        ].join(':'),
      [
        visualizerRobot.joints,
        visualizerRobot.links,
        visualizerRobot.name,
        visualizerRobot.rootLinkId,
        visualizerRuntimeMode,
      ],
    );

    useEffect(() => {
      const root = viewerGroupRef.current;
      syncGroupRaycastInteractivity(root, viewerVisible, viewerRaycastCacheRef.current);

      return () => {
        syncGroupRaycastInteractivity(root, true, viewerRaycastCacheRef.current);
      };
    }, [viewerVisible, shouldRenderViewerScene, viewerReloadKey]);

    useEffect(() => {
      if (
        viewerVisible ||
        keepViewerMountedDuringHandoff ||
        mountState.viewerMounted ||
        !viewerRetainedRobotRef.current
      ) {
        if (viewerRetainedRobotReleaseTimerRef.current !== null) {
          window.clearTimeout(viewerRetainedRobotReleaseTimerRef.current);
          viewerRetainedRobotReleaseTimerRef.current = null;
        }
        return;
      }

      // Preserve the last URDF scene only while the viewer is still mounted or
      // actively handoffing. After the scene has been torn down, release the
      // retained graph so Three.js resources are no longer pinned by this ref.
      viewerRetainedRobotReleaseTimerRef.current = window.setTimeout(() => {
        viewerRetainedRobotReleaseTimerRef.current = null;
        viewerRetainedRobotRef.current = null;
      }, 0);

      return () => {
        if (viewerRetainedRobotReleaseTimerRef.current !== null) {
          window.clearTimeout(viewerRetainedRobotReleaseTimerRef.current);
          viewerRetainedRobotReleaseTimerRef.current = null;
        }
      };
    }, [keepViewerMountedDuringHandoff, mountState.viewerMounted, viewerVisible]);

    useEffect(() => {
      if (effectiveSourceFile?.format === 'usd' || !effectiveSourceFile) {
        clearRetainedViewerRobot();
      }
    }, [clearRetainedViewerRobot, effectiveSourceFile]);

    useEffect(() => {
      const root = visualizerGroupRef.current;
      // Hidden R3F groups can still receive pointer raycasts, so explicitly disable
      // the inactive scene to prevent background hover/selection from leaking across modes.
      syncGroupRaycastInteractivity(root, visualizerVisible, visualizerRaycastCacheRef.current);

      return () => {
        syncGroupRaycastInteractivity(root, true, visualizerRaycastCacheRef.current);
      };
    }, [shouldRenderVisualizerScene, visualizerSceneSignature, visualizerVisible]);

    useEffect(() => {
      if (!pendingViewerToolMode || !isViewerMode) {
        return;
      }

      setShowToolbar?.(true);
      viewerController.handleToolModeChange(pendingViewerToolMode);
      onConsumePendingViewerToolMode?.();
    }, [
      isViewerMode,
      onConsumePendingViewerToolMode,
      pendingViewerToolMode,
      setShowToolbar,
      viewerController,
    ]);

    useEffect(() => {
      const preloadCurrentModeModules = isViewerMode
        ? preloadViewerModeModules
        : preloadVisualizerModeModules;

      void preloadCurrentModeModules().catch((error) => {
        console.warn('[UnifiedViewer] Failed to preload active mode modules.', error);
      });
    }, [isViewerMode]);

    useEffect(() => {
      const schedulerWindow = window as Window & IdleScheduler;
      let timeoutHandle: number | null = null;
      let idleHandle: number | null = null;
      let cancelled = false;

      const preloadInactiveModeModules = () => {
        if (cancelled) {
          return;
        }
        const preload = isViewerMode ? preloadVisualizerModeModules : preloadViewerModeModules;
        void preload().catch((error) => {
          console.warn('[UnifiedViewer] Failed to prefetch inactive mode modules.', error);
        });
      };

      if (typeof schedulerWindow.requestIdleCallback === 'function') {
        idleHandle = schedulerWindow.requestIdleCallback(preloadInactiveModeModules, {
          timeout: 1_500,
        });
      } else {
        timeoutHandle = window.setTimeout(preloadInactiveModeModules, 1_500);
      }

      return () => {
        cancelled = true;
        if (idleHandle !== null && typeof schedulerWindow.cancelIdleCallback === 'function') {
          schedulerWindow.cancelIdleCallback(idleHandle);
        }
        if (timeoutHandle !== null) {
          window.clearTimeout(timeoutHandle);
        }
      };
    }, [isViewerMode]);

    useEffect(() => {
      const handleWindowBlur = () => {
        clearHover();
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          clearHover();
        }
      };

      window.addEventListener('blur', handleWindowBlur);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        window.removeEventListener('blur', handleWindowBlur);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }, [clearHover]);

    const handleWorkspaceMouseLeave = React.useCallback(() => {
      handleUnifiedViewerWorkspaceLeave({
        activeScene,
        clearHover,
        handleViewerMouseUp: viewerController.handleMouseUp,
        handleVisualizerMouseUp: visualizerController.panel.handleMouseUp,
      });
    }, [
      activeScene,
      clearHover,
      viewerController.handleMouseUp,
      visualizerController.panel.handleMouseUp,
    ]);

    return (
      <WorkspaceCanvas
        theme={theme}
        lang={lang}
        robotName={activePreview ? activePreview.fileName : robot.name || 'robot'}
        renderKey={`${activeScene}:${displayVisualizerWhileViewerLoads ? 'handoff' : 'stable'}:${viewerReloadKey}`}
        containerRef={
          activeScene === 'viewer'
            ? viewerController.containerRef
            : visualizerController.panel.containerRef
        }
        sceneRef={activeScene === 'viewer' ? undefined : visualizerController.sceneRef}
        snapshotAction={snapshotAction}
        onPointerDownCapture={handleWorkspacePointerDownCapture}
        onPointerMissed={
          activeScene === 'viewer' ? handleViewerPointerMissed : handleVisualizerPointerMissed
        }
        onMouseMove={
          activeScene === 'viewer'
            ? viewerController.handleMouseMove
            : visualizerController.panel.handleMouseMove
        }
        onMouseUp={
          activeScene === 'viewer'
            ? viewerController.handleMouseUp
            : visualizerController.panel.handleMouseUp
        }
        onMouseLeave={handleWorkspaceMouseLeave}
        environment={workspaceEnvironment}
        environmentIntensity={workspaceEnvironmentIntensity}
        cameraFollowPrimary={useViewerCanvasPresentation}
        controlLayerKey={controlLayerKey}
        showWorldOriginAxes={showWorldOriginAxes}
        orbitControlsProps={
          activeScene === 'viewer'
            ? {
                minDistance: 0.05,
                maxDistance: 2000,
                enabled: !viewerController.isDragging,
                onStart: () => {
                  viewerController.isOrbitDragging.current = true;
                },
                onEnd: () => {
                  viewerController.isOrbitDragging.current = false;
                },
              }
            : undefined
        }
        background={WORKSPACE_CANVAS_BACKGROUND}
        contextLostMessage={activeScene === 'viewer' ? t.webglContextRestoring : undefined}
        showUsageGuide={showUsageGuidePreference}
        overlays={
          <UnifiedViewerOverlays
            activePreview={activePreview}
            activeScene={activeScene}
            lang={lang}
            onClosePreview={onClosePreview}
            viewerController={viewerController}
            visualizerController={visualizerController}
            onUpdate={onUpdate}
            showToolbar={showToolbar}
            setShowToolbar={setShowToolbar}
            showOptionsPanel={showOptionsPanel}
            setShowOptionsPanel={setShowOptionsPanel}
            showVisualizerOptionsPanel={showVisualizerOptionsPanel}
            setShowVisualizerOptionsPanel={setShowVisualizerOptionsPanel}
            showJointPanel={showJointPanel}
            setShowJointPanel={setShowJointPanel}
            isViewerMode={isViewerMode}
          />
        }
      >
        <UnifiedViewerSceneRoots
          shouldRenderViewerScene={shouldRenderViewerScene}
          viewerGroupRef={viewerGroupRef}
          viewerVisible={viewerVisible}
          viewerController={viewerController}
          activePreview={activePreview}
          viewerResourceScope={viewerResourceScope}
          retainedRobot={viewerRetainedRobotRef.current}
          effectiveSourceFile={effectiveSourceFile}
          effectiveSourceFilePath={effectiveSourceFilePath}
          effectiveUrdfContent={effectiveUrdfContent}
          effectiveSourceFormat={viewerSourceFormat}
          onRobotDataResolved={onRobotDataResolved}
          onDocumentLoadEvent={handleViewerDocumentLoadEvent}
          onSceneReadyForDisplay={handleViewerSceneReadyForDisplay}
          onRuntimeRobotLoaded={(loadedRobot) => {
            viewerRetainedRobotRef.current = loadedRobot;
          }}
          viewerSceneMode={viewerSceneMode}
          selection={selection}
          onHover={onHover}
          onMeshSelect={onMeshSelect}
          robot={robot}
          focusTarget={focusTarget}
          onCollisionTransformPreview={onCollisionTransformPreview}
          onCollisionTransform={onCollisionTransform}
          isMeshPreview={isMeshPreview}
          viewerReloadKey={viewerReloadKey}
          sourceSceneAssemblyComponent={sourceSceneAssemblyComponent}
          sourceSceneAssemblyComponentTransform={sourceSceneAssemblyComponentTransform}
          showSourceSceneAssemblyComponentControls={showSourceSceneAssemblyComponentControls}
          onSourceSceneAssemblyComponentTransform={handleSourceSceneAssemblyComponentTransform}
          t={t}
          shouldRenderVisualizerScene={shouldRenderVisualizerScene}
          visualizerGroupRef={visualizerGroupRef}
          visualizerVisible={visualizerVisible}
          visualizerRobot={visualizerRobot}
          onSelect={onSelect}
          onUpdate={onUpdate}
          visualizerRuntimeMode={visualizerRuntimeMode}
          visualizerResourceScope={visualizerResourceScope}
          lang={lang}
          visualizerController={visualizerController}
          assemblyState={assemblyState}
          assemblyWorkspaceActive={assemblyWorkspaceActive}
          assemblySelection={assemblySelection}
          sourceSceneAssemblyComponentId={sourceSceneAssemblyComponentId}
          onAssemblyTransform={onAssemblyTransform}
          onComponentTransform={onComponentTransform}
          onBridgeTransform={onBridgeTransform}
          onTransformPendingChange={onTransformPendingChange}
          isViewerMode={isViewerMode}
        />
      </WorkspaceCanvas>
    );
  },
);
