import React, { useEffect } from 'react';
import type { RootState } from '@react-three/fiber';
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
import {
  useViewerController,
  resolveDefaultViewerToolMode,
  type ViewerHelperKind,
  type ToolMode,
  type ViewerDocumentLoadEvent,
  type ViewerJointMotionStateValue,
  type ViewerRobotSourceFormat,
  type ViewerRobotDataResolution,
} from '@/features/editor';
import { resolveViewerJointScopeKey } from '@/app/utils/viewerJointScopeKey';
import { resolveUnifiedViewerForcedSessionState } from '@/app/utils/unifiedViewerForcedSessionState';
import { resolveUnifiedViewerUsageGuideVisibility } from '@/app/utils/unifiedViewerUsageGuide';
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
import { preloadViewerModeModules } from './unified-viewer/modeModuleLoaders';
import {
  buildUnifiedViewerRetainedRobotScopeKey,
  shouldReuseUnifiedViewerRetainedRobot,
} from '@/app/utils/unifiedViewerRetainedRobot';
import { UnifiedViewerOverlays } from './unified-viewer/UnifiedViewerOverlays';
import { UnifiedViewerSceneRoots } from './unified-viewer/UnifiedViewerSceneRoots';
import type { FilePreviewState } from './unified-viewer/types';
import { useUnifiedViewerDerivedState } from './unified-viewer/useUnifiedViewerDerivedState';
import { useSelectionStore } from '@/store/selectionStore';

interface UnifiedViewerProps {
  robot: RobotState;
  editorRobot?: RobotState;
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
  allFileContents: Record<string, string>;
  lang: Language;
  theme: Theme;
  showVisual?: boolean;
  setShowVisual?: (show: boolean) => void;
  showUsageGuide?: boolean;
  snapshotAction?: React.RefObject<SnapshotCaptureAction | null>;
  onCanvasCreated?: (state: RootState) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
  availableFiles: RobotFile[];
  urdfContent: string;
  viewerSourceFormat?: ViewerRobotSourceFormat;
  sourceFilePath?: string;
  sourceFile?: RobotFile | null;
  onRobotDataResolved?: (result: ViewerRobotDataResolution) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onRuntimeRobotLoaded?: (robot: ThreeObject3D) => void;
  onRuntimeSceneReadyForDisplay?: () => void;
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
  ikDragActive?: boolean;
  pendingViewerToolMode?: ToolMode | null;
  onConsumePendingViewerToolMode?: () => void;
  viewerReloadKey?: number;
  documentLoadState: DocumentLoadLifecycleState;
}

const INACTIVE_SCENE_UNMOUNT_DELAY_MS = 15_000;

export const UnifiedViewer = React.memo(
  ({
    robot,
    editorRobot: editorRobotInput,
    mode,
    onSelect,
    onMeshSelect,
    onHover,
    onUpdate,
    assets,
    allFileContents,
    lang,
    theme,
    showVisual,
    setShowVisual,
    showUsageGuide,
    snapshotAction,
    onCanvasCreated,
    showOptionsPanel = true,
    setShowOptionsPanel,
    showJointPanel = true,
    setShowJointPanel,
    availableFiles,
    urdfContent,
    viewerSourceFormat,
    sourceFilePath,
    sourceFile,
    onRobotDataResolved,
    onDocumentLoadEvent,
    onRuntimeRobotLoaded,
    onRuntimeSceneReadyForDisplay,
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
    ikDragActive = false,
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
      resolvedTheme,
      viewerOptionsVisibleRef,
      optionsVisibleAtPointerDownRef,
      editorRobot,
      effectiveUrdfContent,
      effectiveSourceFilePath,
      effectiveSourceFile,
      viewerResourceScope,
      sourceSceneAssemblyComponent,
      sourceSceneAssemblyComponentTransform,
      handleSourceSceneAssemblyComponentTransform,
      showSourceSceneAssemblyComponentControls,
      viewportState,
    } = useUnifiedViewerDerivedState({
      mode,
      filePreview,
      pendingViewerToolMode,
      theme,
      showOptionsPanel,
      editorRobotInput,
      robot,
      assemblyWorkspaceActive,
      urdfContent,
      sourceFilePath,
      sourceFile,
      assets,
      allFileContents,
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
    const { viewerVisible, shouldRenderViewerScene, useViewerCanvasPresentation } = viewportState;
    const viewerGroupRef = React.useRef<ThreeGroup | null>(null);
    const viewerRaycastCacheRef = React.useRef(
      new WeakMap<RaycastableObject, NonNullable<RaycastableObject['raycast']>>(),
    );
    const viewerRetainedRobotRef = React.useRef<ThreeObject3D | null>(null);
    const viewerRetainedRobotScopeRef = React.useRef<string | null>(null);
    const viewerRetainedRobotReleaseTimerRef = React.useRef<number | null>(null);
    const viewerUnmountTimerRef = React.useRef<number | null>(null);
    const viewerRetainedRobotScopeKey = React.useMemo(
      () =>
        buildUnifiedViewerRetainedRobotScopeKey({
          sourceFile: effectiveSourceFile,
          sourceFilePath: effectiveSourceFilePath,
          sourceFormat: viewerSourceFormat,
        }),
      [effectiveSourceFile, effectiveSourceFilePath, viewerSourceFormat],
    );
    const retainedViewerRobot = shouldReuseUnifiedViewerRetainedRobot(
      viewerRetainedRobotScopeRef.current,
      viewerRetainedRobotScopeKey,
    )
      ? viewerRetainedRobotRef.current
      : null;
    const clearRetainedViewerRobot = React.useCallback(() => {
      if (viewerRetainedRobotReleaseTimerRef.current !== null) {
        window.clearTimeout(viewerRetainedRobotReleaseTimerRef.current);
        viewerRetainedRobotReleaseTimerRef.current = null;
      }

      viewerRetainedRobotRef.current = null;
      viewerRetainedRobotScopeRef.current = null;
    }, []);

    // Keep quick mode flips warm, but unmount the inactive scene once the user
    // settles so hidden useFrame subscriptions stop consuming work in the background.
    useEffect(() => {
      if (viewerVisible) {
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
    }, [mountState.viewerMounted, viewerVisible]);

    useEffect(
      () => () => {
        if (viewerUnmountTimerRef.current !== null) {
          window.clearTimeout(viewerUnmountTimerRef.current);
          viewerUnmountTimerRef.current = null;
        }
        clearRetainedViewerRobot();
      },
      [clearRetainedViewerRobot],
    );
    const viewerDefaultToolMode = resolveDefaultViewerToolMode(effectiveSourceFile?.format);
    const viewerToolModeScopeKey = effectiveSourceFile
      ? `${effectiveSourceFile.format}:${effectiveSourceFile.name}`
      : effectiveSourceFilePath
        ? `inline:${effectiveSourceFilePath}`
        : 'inline:unified-viewer';
    const viewerController = useViewerController({
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
      closedLoopRobotState: editorRobot,
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
        onDocumentLoadEvent?.(event);
      },
      [onDocumentLoadEvent],
    );
    const handleViewerSceneReadyForDisplay = React.useCallback(() => {
      onRuntimeSceneReadyForDisplay?.();
    }, [onRuntimeSceneReadyForDisplay]);

    const controlLayerKey = 'shared';
    const workspaceEnvironment = 'studio' as const;
    const workspaceEnvironmentIntensity = useViewerCanvasPresentation
      ? STUDIO_ENVIRONMENT_INTENSITY.viewer[resolvedTheme]
      : STUDIO_ENVIRONMENT_INTENSITY.workspace[resolvedTheme];
    const showWorldOriginAxesPreference = useUIStore((state) => state.viewOptions.showAxes);
    const showUsageGuidePreference = useUIStore((state) => state.viewOptions.showUsageGuide);
    const showWorldOriginAxes = showWorldOriginAxesPreference && !viewerController.showOrigins;
    const effectiveShowUsageGuide = resolveUnifiedViewerUsageGuideVisibility(
      showUsageGuidePreference,
      showUsageGuide,
    );

    const handleWorkspacePointerDownCapture = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        void event;
        optionsVisibleAtPointerDownRef.current = captureUnifiedViewerOptionsVisibility({
          showViewerOptions: showOptionsPanel,
        });
      },
      [showOptionsPanel],
    );

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

    useEffect(() => {
      const root = viewerGroupRef.current;
      syncGroupRaycastInteractivity(root, viewerVisible, viewerRaycastCacheRef.current);

      return () => {
        syncGroupRaycastInteractivity(root, true, viewerRaycastCacheRef.current);
      };
    }, [viewerVisible, shouldRenderViewerScene, viewerReloadKey]);

    useEffect(() => {
      if (viewerVisible || mountState.viewerMounted || !viewerRetainedRobotRef.current) {
        if (viewerRetainedRobotReleaseTimerRef.current !== null) {
          window.clearTimeout(viewerRetainedRobotReleaseTimerRef.current);
          viewerRetainedRobotReleaseTimerRef.current = null;
        }
        return;
      }

      // Preserve the last non-USD runtime only while the viewer is still mounted.
      // After the scene has been torn down, release the retained graph so
      // Three.js resources are no longer pinned by this ref.
      viewerRetainedRobotReleaseTimerRef.current = window.setTimeout(() => {
        viewerRetainedRobotReleaseTimerRef.current = null;
        viewerRetainedRobotRef.current = null;
        viewerRetainedRobotScopeRef.current = null;
      }, 0);

      return () => {
        if (viewerRetainedRobotReleaseTimerRef.current !== null) {
          window.clearTimeout(viewerRetainedRobotReleaseTimerRef.current);
          viewerRetainedRobotReleaseTimerRef.current = null;
        }
      };
    }, [mountState.viewerMounted, viewerVisible]);

    useEffect(() => {
      if (
        viewerRetainedRobotScopeRef.current !== null &&
        !shouldReuseUnifiedViewerRetainedRobot(
          viewerRetainedRobotScopeRef.current,
          viewerRetainedRobotScopeKey,
        )
      ) {
        clearRetainedViewerRobot();
      }
    }, [clearRetainedViewerRobot, viewerRetainedRobotScopeKey]);

    useEffect(() => {
      if (!pendingViewerToolMode || !isViewerMode) {
        return;
      }

      viewerController.handleToolModeChange(pendingViewerToolMode);
      onConsumePendingViewerToolMode?.();
    }, [isViewerMode, onConsumePendingViewerToolMode, pendingViewerToolMode, viewerController]);

    useEffect(() => {
      void preloadViewerModeModules().catch((error) => {
        console.warn('[UnifiedViewer] Failed to preload active mode modules.', error);
      });
    }, []);

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
      viewerController.handleMouseUp();
      clearHover();
    }, [clearHover, viewerController]);

    return (
      <WorkspaceCanvas
        className="relative w-full h-full overflow-hidden"
        theme={theme}
        lang={lang}
        robotName={activePreview ? activePreview.fileName : robot.name || 'robot'}
        renderKey={`viewer:stable:${viewerReloadKey}`}
        containerRef={viewerController.containerRef}
        snapshotAction={snapshotAction}
        onCreated={onCanvasCreated}
        onPointerDownCapture={handleWorkspacePointerDownCapture}
        onPointerMissed={handleViewerPointerMissed}
        onMouseMove={viewerController.handleMouseMove}
        onMouseUp={viewerController.handleMouseUp}
        onMouseLeave={handleWorkspaceMouseLeave}
        environment={workspaceEnvironment}
        environmentIntensity={workspaceEnvironmentIntensity}
        cameraFollowPrimary={useViewerCanvasPresentation}
        controlLayerKey={controlLayerKey}
        showWorldOriginAxes={showWorldOriginAxes}
        orbitControlsProps={{
          minDistance: 0.05,
          maxDistance: 2000,
          enabled: !viewerController.isDragging,
          onStart: () => {
            viewerController.isOrbitDragging.current = true;
          },
          onEnd: () => {
            viewerController.isOrbitDragging.current = false;
          },
        }}
        background={WORKSPACE_CANVAS_BACKGROUND}
        showUsageGuide={effectiveShowUsageGuide}
        overlays={
          <UnifiedViewerOverlays
            activePreview={activePreview}
            lang={lang}
            onClosePreview={onClosePreview}
            viewerController={viewerController}
            onUpdate={onUpdate}
            showOptionsPanel={showOptionsPanel}
            setShowOptionsPanel={setShowOptionsPanel}
            showJointPanel={showJointPanel}
            setShowJointPanel={setShowJointPanel}
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
          retainedRobot={retainedViewerRobot}
          effectiveSourceFile={effectiveSourceFile}
          effectiveSourceFilePath={effectiveSourceFilePath}
          effectiveUrdfContent={effectiveUrdfContent}
          effectiveSourceFormat={viewerSourceFormat}
          onRobotDataResolved={onRobotDataResolved}
          onDocumentLoadEvent={handleViewerDocumentLoadEvent}
          onSceneReadyForDisplay={handleViewerSceneReadyForDisplay}
          onRuntimeRobotLoaded={(loadedRobot) => {
            viewerRetainedRobotRef.current = loadedRobot;
            viewerRetainedRobotScopeRef.current = viewerRetainedRobotScopeKey;
            onRuntimeRobotLoaded?.(loadedRobot);
          }}
          viewerSceneMode={viewerSceneMode}
          selection={selection}
          onHover={onHover}
          onMeshSelect={onMeshSelect}
          onUpdate={onUpdate}
          robot={robot}
          focusTarget={focusTarget}
          onCollisionTransformPreview={onCollisionTransformPreview}
          onCollisionTransform={onCollisionTransform}
          isMeshPreview={isMeshPreview}
          viewerReloadKey={viewerReloadKey}
          assemblyState={assemblyState}
          assemblySelection={assemblySelection}
          onAssemblyTransform={onAssemblyTransform}
          onComponentTransform={onComponentTransform}
          onBridgeTransform={onBridgeTransform}
          sourceSceneAssemblyComponent={sourceSceneAssemblyComponent}
          sourceSceneAssemblyComponentTransform={sourceSceneAssemblyComponentTransform}
          showSourceSceneAssemblyComponentControls={showSourceSceneAssemblyComponentControls}
          onSourceSceneAssemblyComponentTransform={handleSourceSceneAssemblyComponentTransform}
          t={t}
          ikDragActive={ikDragActive}
        />
      </WorkspaceCanvas>
    );
  },
);
