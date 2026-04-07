/**
 * App Layout Component
 * Main application layout with Header and workspace area
 */
import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Header } from './components/Header';
import { AppLayoutOverlays } from './components/AppLayoutOverlays';
import { ConnectedDocumentLoadingOverlay } from './components/ConnectedDocumentLoadingOverlay';
import { FileDropOverlay } from './components/FileDropOverlay';
import { ImportPreparationOverlay } from './components/ImportPreparationOverlay';
import { SnapshotDialog } from './components/SnapshotDialog';
import { UnifiedViewer } from './components/UnifiedViewer';
import {
  loadBridgeCreateModalModule,
  loadCollisionOptimizationDialogModule,
} from './utils/overlayLoaders';
import { preloadSourceCodeEditorRuntime } from './utils/sourceCodeEditorLoader';
import type { HeaderAction } from './components/header/types';
import { TreeEditor } from '@/features/robot-tree';
import { PropertyEditor } from '@/features/property-editor';
import {
  getCurrentUsdViewerSceneSnapshot,
  prepareUsdExportCacheFromSnapshot,
  prepareUsdPreparedExportCacheWithWorker,
  resolveUsdExportResolution,
  type ToolMode,
  type ViewerDocumentLoadEvent,
  type ViewerRobotDataResolution,
} from '@/features/urdf-viewer';
import {
  useAppLayoutEffects,
  useAssemblyComponentPreparation,
  useCollisionOptimizationWorkflow,
  useEditableSourcePatches,
  useLibraryFileActions,
  usePreparedUsdViewerAssets,
  useSourceCodeEditorWarmup,
  useViewerOrchestration,
  useWorkspaceMutations,
  useWorkspaceOverlayActions,
  useWorkspaceModeTransitions,
  useWorkspaceSourceSync,
} from './hooks';
import {
  parseEditableRobotSourceWithWorker,
  resolveRobotFileDataWithWorker,
} from './hooks/robotImportWorkerBridge';
import {
  createGeneratedWorkspaceUrdfFile,
  createRobotSourceSnapshot,
  getViewerSourceFile,
  isGeneratedWorkspaceUrdfFileName,
  resolveWorkspaceGeneratedUrdfRobotData,
  shouldPromptGenerateWorkspaceUrdfOnStructureSwitch,
  shouldReseedSingleComponentAssemblyFromActiveFile,
  shouldUseEmptyRobotForUsdHydration,
} from './hooks/workspaceSourceSyncUtils';
import {
  useUIStore,
  useSelectionStore,
  useAssetsStore,
  useRobotStore,
  useAssemblyStore,
  useAssemblySelectionStore,
  useCollisionTransformStore,
} from '@/store';
import { generateURDF } from '@/core/parsers';
import { analyzeAssemblyConnectivity } from '@/core/robot';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import { rewriteRobotMeshPathsForSource } from '@/core/parsers/meshPathUtils';
import type {
  BridgeJoint,
  InteractionSelection,
  RobotData,
  RobotFile,
  UrdfJoint,
  UrdfLink,
  UsdSceneSnapshot,
} from '@/types';
import { translations } from '@/shared/i18n';
import type { SnapshotCaptureOptions } from '@/shared/components/3d';
import { normalizeMergedAppMode } from '@/shared/utils/appMode';
import { ROBOT_IMPORT_ACCEPT_ATTRIBUTE } from '@/shared/utils';
import { createRobotSemanticSnapshot } from '@/shared/utils/robot/semanticSnapshot';
import { recordUsdStageLoadDebug } from '@/shared/debug/usdStageLoadDebug';
import { registerPendingUsdCacheFlusher } from './utils/pendingUsdCache';
import { shouldApplyUsdStageHydration } from './utils/usdStageHydration';
import { buildUsdHydrationPersistencePlan } from './utils/usdHydrationPersistence';
import {
  shouldIgnoreStaleViewerDocumentLoadEvent,
  shouldIgnoreViewerLoadRegressionAfterReadySameFile,
} from './utils/documentLoadFlow';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import type { DocumentLoadState, DocumentLoadStatus } from '@/store/assetsStore';
import { toDocumentLoadLifecycleState } from '@/store/assetsStore';
import { BRIDGE_PREVIEW_ID, resolveAssemblyViewerComponentSelection } from '@/features/assembly';
import { markUnsavedChangesBaselineSaved } from './utils/unsavedChangesBaseline';
import { buildStandaloneImportAssetWarning } from './utils/importPackageAssetReferences';
import { buildPropertyEditorSelectionContext } from './utils/propertyEditorSelectionContext';

interface UsdPersistenceBaseline {
  fileName: string | null;
  robotSnapshot: string | null;
  fallbackSceneSnapshot: UsdSceneSnapshot | null;
  hadPreparedExportCache: boolean;
  hadSceneSnapshot: boolean;
}

const EMPTY_USD_PERSISTENCE_BASELINE: UsdPersistenceBaseline = {
  fileName: null,
  robotSnapshot: null,
  fallbackSceneSnapshot: null,
  hadPreparedExportCache: false,
  hadSceneSnapshot: false,
};

interface ProModeRoundtripSession {
  baselineSnapshot: string;
  generatedFileName: string | null;
}

function normalizeUsdPersistenceFileName(path: string | null | undefined): string {
  return String(path || '')
    .trim()
    .replace(/^\/+/, '')
    .split('?')[0];
}

interface AppLayoutProps {
  // Import handlers (passed from App)
  importInputRef: React.RefObject<HTMLInputElement>;
  importFolderInputRef: React.RefObject<HTMLInputElement>;
  onFileDrop: (files: File[]) => void;
  onOpenExport: () => void;
  onOpenLibraryExport: (file: RobotFile) => void;
  onExportProject: () => void;
  // Toast handler
  showToast: (message: string, type?: 'info' | 'success') => void;
  // Modal handlers
  onOpenAI: () => void;
  isCodeViewerOpen: boolean;
  setIsCodeViewerOpen: (open: boolean) => void;
  onOpenSettings: () => void;
  headerQuickAction?: HeaderAction;
  headerSecondaryAction?: HeaderAction;
  // View config
  viewConfig: {
    showToolbar: boolean;
    showOptionsPanel: boolean;
    showVisualizerOptionsPanel: boolean;
    showJointPanel: boolean;
  };
  setViewConfig: React.Dispatch<
    React.SetStateAction<{
      showToolbar: boolean;
      showOptionsPanel: boolean;
      showVisualizerOptionsPanel: boolean;
      showJointPanel: boolean;
    }>
  >;
  // Robot file handling
  onLoadRobot: (file: RobotFile) => void;
  viewerReloadKey: number;
}

export function AppLayout({
  importInputRef,
  importFolderInputRef,
  onFileDrop,
  onOpenExport,
  onOpenLibraryExport,
  onExportProject,
  showToast,
  onOpenAI,
  isCodeViewerOpen,
  setIsCodeViewerOpen,
  onOpenSettings,
  headerQuickAction,
  headerSecondaryAction,
  viewConfig,
  setViewConfig,
  onLoadRobot,
  viewerReloadKey,
}: AppLayoutProps) {
  // UI Store (grouped with useShallow to reduce subscriptions)
  const { appMode, lang, theme, sidebar, toggleSidebar, sidebarTab, sourceCodeAutoApply } =
    useUIStore(
      useShallow((state) => ({
        appMode: state.appMode,
        lang: state.lang,
        theme: state.theme,
        sidebar: state.sidebar,
        toggleSidebar: state.toggleSidebar,
        sidebarTab: state.sidebarTab,
        sourceCodeAutoApply: state.sourceCodeAutoApply,
      })),
    );
  const mergedAppMode = normalizeMergedAppMode(appMode);
  const t = translations[lang];

  // Selection Store
  const { selection, setSelection, setHoveredSelection, focusTarget, focusOn, pulseSelection } =
    useSelectionStore(
      useShallow((state) => ({
        selection: state.selection,
        setSelection: state.setSelection,
        setHoveredSelection: state.setHoveredSelection,
        focusTarget: state.focusTarget,
        focusOn: state.focusOn,
        pulseSelection: state.pulseSelection,
      })),
    );
  const {
    assemblySelection,
    clearSelection: clearAssemblySelection,
    selectComponent,
  } = useAssemblySelectionStore(
    useShallow((state) => ({
      assemblySelection: state.selection,
      clearSelection: state.clearSelection,
      selectComponent: state.selectComponent,
    })),
  );

  // Assets Store
  const {
    assets,
    motorLibrary,
    availableFiles,
    selectedFile,
    documentLoadState,
    allFileContents,
    setAvailableFiles,
    setSelectedFile,
    setAllFileContents,
    originalUrdfContent,
    setOriginalUrdfContent,
    uploadAsset,
    removeRobotFile,
    removeRobotFolder,
    renameRobotFolder,
    clearRobotLibrary,
    getUsdPreparedExportCache,
    setDocumentLoadState,
  } = useAssetsStore(
    useShallow((state) => ({
      assets: state.assets,
      motorLibrary: state.motorLibrary,
      availableFiles: state.availableFiles,
      selectedFile: state.selectedFile,
      documentLoadState: state.documentLoadState,
      allFileContents: state.allFileContents,
      setAvailableFiles: state.setAvailableFiles,
      setSelectedFile: state.setSelectedFile,
      setAllFileContents: state.setAllFileContents,
      originalUrdfContent: state.originalUrdfContent,
      setOriginalUrdfContent: state.setOriginalUrdfContent,
      uploadAsset: state.uploadAsset,
      removeRobotFile: state.removeRobotFile,
      removeRobotFolder: state.removeRobotFolder,
      renameRobotFolder: state.renameRobotFolder,
      clearRobotLibrary: state.clearRobotLibrary,
      getUsdPreparedExportCache: state.getUsdPreparedExportCache,
      setDocumentLoadState: state.setDocumentLoadState,
    })),
  );
  const documentLoadLifecycleState = useMemo(
    () => toDocumentLoadLifecycleState(documentLoadState),
    [documentLoadState],
  );

  // Robot Store
  const {
    robotName,
    robotLinks,
    robotJoints,
    rootLinkId,
    robotMaterials,
    closedLoopConstraints,
    setName,
    setRobot,
    resetRobot,
    addChild,
    deleteSubtree,
    updateLink,
    updateJoint,
    setAllLinksVisibility,
    setJointAngle,
  } = useRobotStore(
    useShallow((state) => ({
      robotName: state.name,
      robotLinks: state.links,
      robotJoints: state.joints,
      rootLinkId: state.rootLinkId,
      robotMaterials: state.materials,
      closedLoopConstraints: state.closedLoopConstraints,
      setName: state.setName,
      setRobot: state.setRobot,
      resetRobot: state.resetRobot,
      addChild: state.addChild,
      deleteSubtree: state.deleteSubtree,
      updateLink: state.updateLink,
      updateJoint: state.updateJoint,
      setAllLinksVisibility: state.setAllLinksVisibility,
      setJointAngle: state.setJointAngle,
    })),
  );
  // Assembly Store
  const {
    assemblyState,
    assemblyRevision,
    addComponent,
    initAssembly,
    removeComponent,
    addBridge,
    removeBridge,
    getMergedRobotData,
    updateComponentName,
    updateComponentTransform,
    updateComponentRobot,
    updateAssemblyTransform,
    renameComponentSourceFolder,
  } = useAssemblyStore(
    useShallow((state) => ({
      assemblyState: state.assemblyState,
      assemblyRevision: state.assemblyRevision,
      addComponent: state.addComponent,
      initAssembly: state.initAssembly,
      removeComponent: state.removeComponent,
      addBridge: state.addBridge,
      removeBridge: state.removeBridge,
      getMergedRobotData: state.getMergedRobotData,
      updateComponentName: state.updateComponentName,
      updateComponentTransform: state.updateComponentTransform,
      updateComponentRobot: state.updateComponentRobot,
      updateAssemblyTransform: state.updateAssemblyTransform,
      renameComponentSourceFolder: state.renameComponentSourceFolder,
    })),
  );

  const snapshotActionRef = useRef<
    ((options?: Partial<SnapshotCaptureOptions>) => Promise<void>) | null
  >(null);
  const transformPendingRef = useRef(false);
  const editableSourceParseRequestRef = useRef(0);
  const pendingUsdAssemblyFileRef = useRef<RobotFile | null>(null);
  const pendingUsdHydrationFileRef = useRef<string | null>(null);
  const usdPersistenceBaselineRef = useRef<UsdPersistenceBaseline>(EMPTY_USD_PERSISTENCE_BASELINE);
  const usdPreparedExportCacheRequestIdRef = useRef(0);
  const proModeRoundtripSessionRef = useRef<ProModeRoundtripSession | null>(null);
  const [pendingViewerToolMode, setPendingViewerToolMode] = useState<ToolMode | null>(null);
  const [isBridgeModalOpen, setIsBridgeModalOpen] = useState(false);
  const [isCollisionOptimizerOpen, setIsCollisionOptimizerOpen] = useState(false);
  const [isSnapshotDialogOpen, setIsSnapshotDialogOpen] = useState(false);
  const [isSnapshotCapturing, setIsSnapshotCapturing] = useState(false);
  const [shouldRenderBridgeModal, setShouldRenderBridgeModal] = useState(false);
  const [bridgePreview, setBridgePreview] = useState<BridgeJoint | null>(null);
  const clearSelection = useCallback(() => {
    setSelection({ type: null, id: null });
    clearAssemblySelection();
  }, [clearAssemblySelection, setSelection]);

  const isSelectedUsdHydrating = shouldUseEmptyRobotForUsdHydration({
    selectedFileFormat: selectedFile?.format ?? null,
    selectedFileName: selectedFile?.name ?? null,
    documentLoadStatus: documentLoadLifecycleState.status,
    documentLoadFileName: documentLoadLifecycleState.fileName,
  });

  useEffect(() => {
    if (!isSelectedUsdHydrating || selectedFile?.format !== 'usd') {
      pendingUsdHydrationFileRef.current = null;
      return;
    }

    pendingUsdHydrationFileRef.current = selectedFile.name;
  }, [isSelectedUsdHydrating, selectedFile]);

  const {
    assemblyComponentPreparationOverlay,
    prepareAssemblyComponentForInsert,
    showAssemblyComponentPreparationOverlay,
    clearAssemblyComponentPreparationOverlay,
    activateInsertedAssemblyComponent,
    insertAssemblyComponentIntoWorkspace,
  } = useAssemblyComponentPreparation({
    assemblyState,
    availableFiles,
    assets,
    allFileContents,
    t,
    addComponent,
    focusOn,
    selectComponent,
    setSelection,
  });

  const queueUsdPreparedExportCacheBuild = useCallback(
    (args: {
      fileName: string;
      sceneSnapshot: UsdSceneSnapshot;
      resolution: ViewerRobotDataResolution;
      robotSnapshot: string;
    }) => {
      const requestId = ++usdPreparedExportCacheRequestIdRef.current;

      void prepareUsdPreparedExportCacheWithWorker(args.sceneSnapshot, args.resolution)
        .then((preparedCache) => {
          if (requestId !== usdPreparedExportCacheRequestIdRef.current) {
            return;
          }

          const liveAssetsState = useAssetsStore.getState();
          liveAssetsState.setUsdPreparedExportCache(args.fileName, preparedCache);
          usdPersistenceBaselineRef.current = {
            fileName: normalizeUsdPersistenceFileName(args.fileName),
            robotSnapshot: args.robotSnapshot,
            fallbackSceneSnapshot: args.sceneSnapshot,
            hadPreparedExportCache: Boolean(preparedCache),
            hadSceneSnapshot: true,
          };
        })
        .catch((error) => {
          if (requestId !== usdPreparedExportCacheRequestIdRef.current) {
            return;
          }

          const reason = error instanceof Error ? error.message : String(error);
          scheduleFailFastInDev(
            'AppLayout:prepareUsdPreparedExportCacheWithWorker',
            new Error(`Failed to prepare USD export cache for "${args.fileName}": ${reason}`, {
              cause: error,
            }),
          );
        });
    },
    [],
  );

  const flushPendingUsdCache = useCallback(() => {
    const liveAssetsState = useAssetsStore.getState();
    const currentSelectedFile = liveAssetsState.selectedFile;
    if (!currentSelectedFile || currentSelectedFile.format !== 'usd') {
      return;
    }

    const normalizedSelectedFileName = normalizeUsdPersistenceFileName(currentSelectedFile.name);
    const baseline = usdPersistenceBaselineRef.current;
    if (
      !baseline.fileName ||
      baseline.fileName !== normalizedSelectedFileName ||
      !baseline.robotSnapshot
    ) {
      return;
    }

    const liveRobotState = useRobotStore.getState();
    const currentRobotData: RobotData = {
      name: liveRobotState.name,
      links: liveRobotState.links,
      joints: liveRobotState.joints,
      rootLinkId: liveRobotState.rootLinkId,
      materials: liveRobotState.materials,
      closedLoopConstraints: liveRobotState.closedLoopConstraints,
    };
    const currentRobotSnapshot = createRobotSemanticSnapshot(currentRobotData);
    const hasSemanticEdits = currentRobotSnapshot !== baseline.robotSnapshot;

    if (!hasSemanticEdits) {
      if (!baseline.hadSceneSnapshot) {
        liveAssetsState.setUsdSceneSnapshot(currentSelectedFile.name, null);
      }
      if (!baseline.hadPreparedExportCache) {
        liveAssetsState.setUsdPreparedExportCache(currentSelectedFile.name, null);
      }
      return;
    }

    const sceneSnapshot = getCurrentUsdViewerSceneSnapshot({
      stageSourcePath: currentSelectedFile.name,
    });

    if (!sceneSnapshot) {
      scheduleFailFastInDev(
        'AppLayout:flushPendingUsdCache',
        new Error(
          `Missing live USD scene snapshot for "${currentSelectedFile.name}" while semantic edits are pending.`,
        ),
        'warn',
      );
      liveAssetsState.setUsdSceneSnapshot(currentSelectedFile.name, null);
      liveAssetsState.setUsdPreparedExportCache(currentSelectedFile.name, null);
      usdPersistenceBaselineRef.current = {
        fileName: normalizedSelectedFileName,
        robotSnapshot: currentRobotSnapshot,
        fallbackSceneSnapshot: null,
        hadPreparedExportCache: false,
        hadSceneSnapshot: false,
      };
      return;
    }

    liveAssetsState.setUsdSceneSnapshot(currentSelectedFile.name, sceneSnapshot);

    const resolution = resolveUsdExportResolution(sceneSnapshot, {
      fileName: currentSelectedFile.name,
    });
    if (!resolution) {
      liveAssetsState.setUsdPreparedExportCache(currentSelectedFile.name, null);
      usdPersistenceBaselineRef.current = {
        fileName: normalizedSelectedFileName,
        robotSnapshot: currentRobotSnapshot,
        fallbackSceneSnapshot: sceneSnapshot,
        hadPreparedExportCache: false,
        hadSceneSnapshot: true,
      };
      return;
    }

    liveAssetsState.setUsdPreparedExportCache(currentSelectedFile.name, null);
    usdPersistenceBaselineRef.current = {
      fileName: normalizedSelectedFileName,
      robotSnapshot: currentRobotSnapshot,
      fallbackSceneSnapshot: sceneSnapshot,
      hadPreparedExportCache: false,
      hadSceneSnapshot: true,
    };
    queueUsdPreparedExportCacheBuild({
      fileName: currentSelectedFile.name,
      sceneSnapshot,
      resolution,
      robotSnapshot: currentRobotSnapshot,
    });
  }, [queueUsdPreparedExportCacheBuild]);

  useEffect(() => {
    registerPendingUsdCacheFlusher(flushPendingUsdCache);
    return () => {
      registerPendingUsdCacheFlusher(null);
    };
  }, [flushPendingUsdCache]);

  useEffect(() => {
    if (selectedFile?.format === 'usd') {
      return;
    }

    usdPersistenceBaselineRef.current = EMPTY_USD_PERSISTENCE_BASELINE;
  }, [selectedFile?.format]);

  const {
    emptyRobot,
    robot,
    viewerRobot,
    sourceSceneAssemblyComponentId,
    shouldRenderAssembly,
    workspaceAssemblyRenderFailureReason,
    jointAngleState,
    jointMotionState,
    showVisual,
    urdfContentForViewer,
    viewerSourceFormat,
    viewerSourceFilePath,
    workspaceViewerMjcfSourceFile,
    sourceCodeContent,
    sourceCodeDocumentFlavor,
    sourceCodeFileName,
    filePreview,
    previewRobot,
    previewFileName,
    handlePreviewFile,
    handleClosePreview,
  } = useWorkspaceSourceSync({
    assemblyState,
    assemblyRevision,
    assemblyBridgePreview: bridgePreview,
    assemblySelection,
    sidebarTab,
    getMergedRobotData,
    selection,
    robotName,
    robotLinks,
    robotJoints,
    rootLinkId,
    robotMaterials,
    closedLoopConstraints,
    isCodeViewerOpen,
    selectedFile,
    setSelectedFile,
    availableFiles,
    allFileContents,
    setAvailableFiles,
    setAllFileContents,
    originalUrdfContent,
    isSelectedUsdHydrating,
    assets,
    getUsdPreparedExportCache,
    setOriginalUrdfContent,
  });

  const workspaceAssemblyRenderFailureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldRenderAssembly || !workspaceAssemblyRenderFailureReason) {
      workspaceAssemblyRenderFailureRef.current = null;
      return;
    }

    if (workspaceAssemblyRenderFailureRef.current === workspaceAssemblyRenderFailureReason) {
      return;
    }

    workspaceAssemblyRenderFailureRef.current = workspaceAssemblyRenderFailureReason;

    const message =
      workspaceAssemblyRenderFailureReason === 'missing-viewer-merged-robot-data'
        ? t.workspaceAssemblyRenderFailedViewerData
        : t.workspaceAssemblyRenderFailedMergedData;

    scheduleFailFastInDev(
      `[Workspace] Failed to build renderable assembly robot data: ${workspaceAssemblyRenderFailureReason}`,
      {
        assemblyRevision,
        componentCount: assemblyState ? Object.keys(assemblyState.components).length : 0,
        selectedFile: selectedFile?.name ?? null,
      },
    );
    showToast(message, 'info');
  }, [
    assemblyRevision,
    assemblyState,
    selectedFile,
    shouldRenderAssembly,
    showToast,
    t.workspaceAssemblyRenderFailedMergedData,
    t.workspaceAssemblyRenderFailedViewerData,
    workspaceAssemblyRenderFailureReason,
  ]);

  const previewFile = previewFileName
    ? (availableFiles.find((file) => file.name === previewFileName) ?? null)
    : null;

  const viewerAssets = usePreparedUsdViewerAssets({
    assemblyState,
    assets,
    availableFiles,
    getUsdPreparedExportCache,
    shouldRenderAssembly,
  });

  useEffect(() => {
    if (sidebarTab !== 'workspace' || !assemblyState) {
      clearAssemblySelection();
      return;
    }

    if (
      assemblySelection.type === 'component' &&
      (!assemblySelection.id || !assemblyState.components[assemblySelection.id])
    ) {
      clearAssemblySelection();
    }
  }, [
    assemblySelection.id,
    assemblySelection.type,
    assemblyState,
    clearAssemblySelection,
    sidebarTab,
  ]);

  const {
    updateProModeRoundtripBaseline,
    handleRequestSwitchTreeEditorToStructure,
    handleSwitchTreeEditorToProMode,
  } = useWorkspaceModeTransitions({
    previewFile,
    selectedFile,
    availableFiles,
    allFileContents,
    assets,
    getUsdPreparedExportCache,
    robotName,
    robotLinks,
    robotJoints,
    rootLinkId,
    robotMaterials,
    closedLoopConstraints,
    setRobot,
    setSelection,
    showToast,
    t,
    handleClosePreview,
    prepareAssemblyComponentForInsert,
    activateInsertedAssemblyComponent,
    addComponent,
    initAssembly,
    onLoadRobot,
    pendingUsdAssemblyFileRef,
    proModeRoundtripSessionRef,
  });

  const handleRobotDataResolved = useCallback(
    (result: ViewerRobotDataResolution) => {
      const liveAssetsState = useAssetsStore.getState();
      const normalizedStageSourcePath = String(result.stageSourcePath || '').replace(/^\/+/, '');
      const emitCommitWorkerRobotData = (
        status: 'resolved' | 'rejected',
        detail: Record<string, unknown>,
      ) => {
        const sourceFileName =
          normalizedStageSourcePath ||
          String(liveAssetsState.selectedFile?.name || selectedFile?.name || '').replace(
            /^\/+/,
            '',
          );
        if (!sourceFileName) {
          return;
        }

        recordUsdStageLoadDebug({
          sourceFileName,
          step: 'commit-worker-robot-data',
          status,
          timestamp: Date.now(),
          detail,
        });
      };
      const resolvedSelectedFile =
        liveAssetsState.selectedFile ??
        (normalizedStageSourcePath
          ? (liveAssetsState.availableFiles.find(
              (file) =>
                file.format === 'usd' &&
                String(file.name || '').replace(/^\/+/, '') === normalizedStageSourcePath,
            ) ?? null)
          : null) ??
        selectedFile;

      if (!resolvedSelectedFile) {
        emitCommitWorkerRobotData('rejected', {
          reason: 'selected-file-unavailable',
          stageSourcePath: normalizedStageSourcePath || null,
        });
        return;
      }

      const normalizedSelectedFileName = String(resolvedSelectedFile.name || '').replace(
        /^\/+/,
        '',
      );
      if (
        normalizedSelectedFileName &&
        normalizedStageSourcePath &&
        normalizedSelectedFileName !== normalizedStageSourcePath
      ) {
        emitCommitWorkerRobotData('rejected', {
          reason: 'selected-file-mismatch',
          selectedFileName: normalizedSelectedFileName,
          stageSourcePath: normalizedStageSourcePath,
        });
        return;
      }

      if (resolvedSelectedFile.format === 'usd') {
        const existingSceneSnapshot = liveAssetsState.getUsdSceneSnapshot(
          resolvedSelectedFile.name,
        );
        const existingPreparedExportCache = liveAssetsState.getUsdPreparedExportCache(
          resolvedSelectedFile.name,
        );
        const resolvedRobotSnapshot = createRobotSemanticSnapshot(result.robotData);
        const hydrationPersistencePlan = buildUsdHydrationPersistencePlan({
          resolution: result,
          existingSceneSnapshot,
          existingPreparedExportCache,
        });
        const shouldBuildPreparedHydrationExportCache = Boolean(
          hydrationPersistencePlan.shouldSeedPreparedExportCache &&
          hydrationPersistencePlan.sceneSnapshot,
        );

        if (
          hydrationPersistencePlan.shouldSeedSceneSnapshot &&
          hydrationPersistencePlan.sceneSnapshot
        ) {
          liveAssetsState.setUsdSceneSnapshot(
            resolvedSelectedFile.name,
            hydrationPersistencePlan.sceneSnapshot,
          );
        }
        if (shouldBuildPreparedHydrationExportCache && hydrationPersistencePlan.sceneSnapshot) {
          liveAssetsState.setUsdPreparedExportCache(resolvedSelectedFile.name, null);
          queueUsdPreparedExportCacheBuild({
            fileName: resolvedSelectedFile.name,
            sceneSnapshot: hydrationPersistencePlan.sceneSnapshot,
            resolution: result,
            robotSnapshot: resolvedRobotSnapshot,
          });
        }

        usdPersistenceBaselineRef.current = {
          fileName: normalizedSelectedFileName,
          robotSnapshot: resolvedRobotSnapshot,
          fallbackSceneSnapshot: hydrationPersistencePlan.sceneSnapshot as UsdSceneSnapshot | null,
          hadPreparedExportCache: shouldBuildPreparedHydrationExportCache
            ? false
            : Boolean(existingPreparedExportCache),
          hadSceneSnapshot: Boolean(hydrationPersistencePlan.sceneSnapshot),
        };
      }

      const pendingHydrationFileName =
        pendingUsdHydrationFileRef.current ??
        (liveAssetsState.documentLoadState.status === 'hydrating'
          ? liveAssetsState.documentLoadState.fileName
          : null);

      const shouldApplyResolvedRobotData =
        resolvedSelectedFile.format !== 'usd' ||
        shouldApplyUsdStageHydration({
          pendingFileName: pendingHydrationFileName,
          selectedFileName: resolvedSelectedFile.name,
          stageSourcePath: result.stageSourcePath,
        });

      if (shouldApplyResolvedRobotData) {
        const isColdUsdHydration =
          resolvedSelectedFile.format === 'usd' &&
          pendingHydrationFileName === resolvedSelectedFile.name;
        setRobot(
          result.robotData,
          resolvedSelectedFile.format === 'usd'
            ? isColdUsdHydration
              ? { resetHistory: true, label: 'Hydrate USD stage' }
              : { skipHistory: true, label: 'Hydrate USD stage' }
            : undefined,
        );
        setSelection({ type: null, id: null });
        if (isColdUsdHydration) {
          markUnsavedChangesBaselineSaved('robot');
        }
        if (
          resolvedSelectedFile.format === 'usd' &&
          pendingUsdHydrationFileRef.current === resolvedSelectedFile.name
        ) {
          pendingUsdHydrationFileRef.current = null;
        }
        if (resolvedSelectedFile.format === 'usd') {
          emitCommitWorkerRobotData('resolved', {
            selectedFileName: normalizedSelectedFileName,
            stageSourcePath: normalizedStageSourcePath || null,
            linkCount: Object.keys(result.robotData.links || {}).length,
            jointCount: Object.keys(result.robotData.joints || {}).length,
            linkIdByPathCount: Object.keys(result.linkIdByPath || {}).length,
            childLinkPathByJointIdCount: Object.keys(result.childLinkPathByJointId || {}).length,
            metadataSource: result.usdSceneSnapshot?.robotMetadataSnapshot?.source ?? null,
            commitMode: isColdUsdHydration ? 'reset-history' : 'skip-history',
          });
        }
      } else if (resolvedSelectedFile.format === 'usd') {
        emitCommitWorkerRobotData('rejected', {
          reason: 'hydration-gated',
          selectedFileName: normalizedSelectedFileName,
          pendingHydrationFileName,
          stageSourcePath: normalizedStageSourcePath || null,
        });
      }

      const pendingUsdAssemblyFile = pendingUsdAssemblyFileRef.current;
      if (
        pendingUsdAssemblyFile &&
        resolvedSelectedFile.format === 'usd' &&
        pendingUsdAssemblyFile.name === resolvedSelectedFile.name
      ) {
        pendingUsdAssemblyFileRef.current = null;
        void insertAssemblyComponentIntoWorkspace(pendingUsdAssemblyFile, {
          preResolvedRobotData: result.robotData,
        })
          .then((component) => {
            showToast(t.addedComponent.replace('{name}', component.name), 'success');
            updateProModeRoundtripBaseline(
              isGeneratedWorkspaceUrdfFileName(pendingUsdAssemblyFile.name)
                ? pendingUsdAssemblyFile.name
                : null,
            );
          })
          .catch((error) => {
            scheduleFailFastInDev(
              'AppLayout:handleRobotDataResolved:prepareAssemblyComponent',
              error instanceof Error
                ? error
                : new Error(
                    `Failed to prepare assembly component "${pendingUsdAssemblyFile.name}".`,
                  ),
            );
            showToast(`Failed to add assembly component: ${pendingUsdAssemblyFile.name}`, 'info');
          })
          .finally(() => {
            clearAssemblyComponentPreparationOverlay();
          });
      }
    },
    [
      clearAssemblyComponentPreparationOverlay,
      insertAssemblyComponentIntoWorkspace,
      queueUsdPreparedExportCacheBuild,
      selectedFile,
      setRobot,
      setSelection,
      showToast,
      t,
      updateProModeRoundtripBaseline,
    ],
  );

  const handleViewerDocumentLoadEvent = useCallback(
    (event: ViewerDocumentLoadEvent) => {
      const liveAssetsState = useAssetsStore.getState();
      const activeDocumentFile = previewFile ?? liveAssetsState.selectedFile;
      const currentDocumentLoadState = liveAssetsState.documentLoadState;

      if (!activeDocumentFile) {
        return;
      }

      // A different file is staged for load but not yet committed as the active
      // viewer document. Ignore progress from the still-visible old scene so the
      // pending file keeps ownership of document loading state.
      if (
        shouldIgnoreStaleViewerDocumentLoadEvent({
          isPreviewing: Boolean(previewFile),
          activeDocumentFileName: activeDocumentFile.name,
          documentLoadState: currentDocumentLoadState,
        })
      ) {
        return;
      }

      const keepHydrating =
        !previewFile &&
        activeDocumentFile.format === 'usd' &&
        currentDocumentLoadState.status === 'hydrating' &&
        currentDocumentLoadState.fileName === activeDocumentFile.name;

      const nextStatus: DocumentLoadStatus =
        event.status === 'ready'
          ? 'ready'
          : event.status === 'error'
            ? 'error'
            : keepHydrating
              ? 'hydrating'
              : 'loading';

      const nextDocumentLoadState: DocumentLoadState = {
        status: nextStatus,
        fileName: activeDocumentFile.name,
        format: activeDocumentFile.format,
        error:
          event.status === 'error'
            ? (event.error ??
              t.failedToParseFormat.replace('{format}', activeDocumentFile.format.toUpperCase()))
            : null,
        phase: event.phase ?? null,
        message: event.message ?? null,
        progressMode: event.progressMode ?? null,
        progressPercent: event.progressPercent ?? null,
        loadedCount: event.loadedCount ?? null,
        totalCount: event.totalCount ?? null,
      };

      if (
        shouldIgnoreViewerLoadRegressionAfterReadySameFile({
          currentState: currentDocumentLoadState,
          nextState: nextDocumentLoadState,
        })
      ) {
        return;
      }

      if (
        currentDocumentLoadState.status !== nextDocumentLoadState.status ||
        currentDocumentLoadState.fileName !== nextDocumentLoadState.fileName ||
        currentDocumentLoadState.format !== nextDocumentLoadState.format ||
        currentDocumentLoadState.error !== nextDocumentLoadState.error ||
        currentDocumentLoadState.phase !== nextDocumentLoadState.phase ||
        currentDocumentLoadState.message !== nextDocumentLoadState.message ||
        currentDocumentLoadState.progressMode !== nextDocumentLoadState.progressMode ||
        currentDocumentLoadState.progressPercent !== nextDocumentLoadState.progressPercent ||
        currentDocumentLoadState.loadedCount !== nextDocumentLoadState.loadedCount ||
        currentDocumentLoadState.totalCount !== nextDocumentLoadState.totalCount
      ) {
        setDocumentLoadState(nextDocumentLoadState);
      }

      if (!previewFile && event.status === 'error' && activeDocumentFile.format === 'usd') {
        pendingUsdHydrationFileRef.current = null;
      }

      if (
        event.status === 'error' &&
        pendingUsdAssemblyFileRef.current &&
        pendingUsdAssemblyFileRef.current.name === activeDocumentFile.name
      ) {
        pendingUsdAssemblyFileRef.current = null;
        clearAssemblyComponentPreparationOverlay();
      }
    },
    [
      clearAssemblyComponentPreparationOverlay,
      previewFile,
      setDocumentLoadState,
      t.failedToParseFormat,
    ],
  );

  // Keep drag-time joint previews scoped to the active viewer runtime. Feeding them
  // through AppLayout forces the tree and property sidebars into high-frequency re-render.
  const previewContextRobot = previewRobot ?? robot;
  const isPreviewingWorkspaceSource = Boolean(previewRobot);
  const propertyEditorSelectionContext = useMemo(
    () => buildPropertyEditorSelectionContext(previewContextRobot, assemblyState),
    [assemblyState, previewContextRobot],
  );

  const {
    handleSelect,
    handleSelectGeometry,
    handleViewerSelect,
    handleViewerMeshSelect,
    handleTransformPendingChange,
    handleHover,
    handleFocus,
  } = useViewerOrchestration({
    transformPendingRef,
    setSelection,
    pulseSelection,
    setHoveredSelection,
    focusOn,
  });
  const trySelectViewerAssemblyComponent = useCallback(
    (nextSelection: {
      type: Exclude<InteractionSelection['type'], null>;
      id: string;
      subType?: 'visual' | 'collision';
      objectIndex?: number;
    }) => {
      if (nextSelection.type === 'tendon') {
        return false;
      }

      if (!shouldRenderAssembly || !assemblyState) {
        return false;
      }

      const componentId = resolveAssemblyViewerComponentSelection(assemblyState, nextSelection, {
        hasInteractionGuard: Boolean(useSelectionStore.getState().interactionGuard),
      });
      if (!componentId) {
        return false;
      }

      setSelection({ type: null, id: null });
      selectComponent(componentId);
      return true;
    },
    [assemblyState, selectComponent, setSelection, shouldRenderAssembly],
  );
  const handleViewerSelectWithBridgePreview = useCallback(
    (...args: Parameters<typeof handleViewerSelect>) => {
      const [type, id, subType] = args;
      if (type === 'joint' && id === BRIDGE_PREVIEW_ID) {
        return;
      }

      if (type !== 'tendon' && trySelectViewerAssemblyComponent({ type, id, subType })) {
        return;
      }

      clearAssemblySelection();
      handleViewerSelect(...args);
    },
    [clearAssemblySelection, handleViewerSelect, trySelectViewerAssemblyComponent],
  );
  const handleSelectWithAssemblyClear = useCallback(
    (...args: Parameters<typeof handleSelect>) => {
      clearAssemblySelection();
      handleSelect(...args);
    },
    [clearAssemblySelection, handleSelect],
  );
  const handleSelectGeometryWithAssemblyClear = useCallback(
    (...args: Parameters<typeof handleSelectGeometry>) => {
      clearAssemblySelection();
      handleSelectGeometry(...args);
    },
    [clearAssemblySelection, handleSelectGeometry],
  );
  const handleViewerMeshSelectWithAssemblyClear = useCallback(
    (...args: Parameters<typeof handleViewerMeshSelect>) => {
      const [linkId, _jointId, objectIndex, objectType] = args;
      if (
        trySelectViewerAssemblyComponent({
          type: 'link',
          id: linkId,
          subType: objectType,
          objectIndex,
        })
      ) {
        return;
      }

      clearAssemblySelection();
      handleViewerMeshSelect(...args);
    },
    [clearAssemblySelection, handleViewerMeshSelect, trySelectViewerAssemblyComponent],
  );

  const setPendingCollisionTransform = useCollisionTransformStore(
    (state) => state.setPendingCollisionTransform,
  );
  const clearPendingCollisionTransform = useCollisionTransformStore(
    (state) => state.clearPendingCollisionTransform,
  );
  const {
    patchEditableSourceAddChild,
    patchEditableSourceDeleteSubtree,
    patchEditableSourceAddCollisionBody,
    patchEditableSourceDeleteCollisionBody,
    patchEditableSourceUpdateCollisionBody,
    patchEditableSourceRenameEntities,
  } = useEditableSourcePatches({
    selectedFile,
    availableFiles,
    allFileContents,
    setSelectedFile,
    setAvailableFiles,
    setAllFileContents,
    showToast,
  });

  const {
    handleNameChange,
    handleUpdate,
    handleCollisionTransform,
    handleAssemblyTransform,
    handleComponentTransform,
    handleBridgeTransform,
    handleAddChild,
    handleAddCollisionBody,
    handleDelete,
    handleRenameComponent,
    handleSetShowVisual,
    handleJointChange,
  } = useWorkspaceMutations({
    sidebarTab,
    assemblyState,
    robotLinks,
    rootLinkId,
    setName,
    addChild,
    deleteSubtree,
    updateLink,
    updateJoint,
    setAllLinksVisibility,
    setJointAngle,
    updateComponentName,
    updateComponentTransform,
    updateComponentRobot,
    updateAssemblyTransform,
    removeComponent,
    removeBridge,
    focusOn,
    patchEditableSourceAddChild,
    patchEditableSourceDeleteSubtree,
    patchEditableSourceAddCollisionBody,
    patchEditableSourceDeleteCollisionBody,
    patchEditableSourceUpdateCollisionBody,
    patchEditableSourceRenameEntities,
    setSelection,
    setPendingCollisionTransform,
    clearPendingCollisionTransform,
    handleTransformPendingChange,
  });

  const {
    handleUploadAsset,
    handleDeleteLibraryFile,
    handleDeleteLibraryFolder,
    handleRenameLibraryFolder,
    handleDeleteAllLibraryFiles,
    handleExportLibraryFile,
  } = useLibraryFileActions({
    availableFiles,
    selectedFile,
    assemblyState,
    emptyRobot,
    removeComponent,
    removeRobotFile,
    removeRobotFolder,
    renameRobotFolder,
    renameComponentSourceFolder,
    clearRobotLibrary,
    resetRobot,
    clearSelection,
    uploadAsset,
    openLibraryExportDialog: onOpenLibraryExport,
    showToast,
    t,
  });

  const {
    handleAddComponent,
    handleCreateBridge,
    handleCloseBridgeModal,
    handleBridgePreviewChange,
    handleCreateBridgeCommit,
    handleOpenCollisionOptimizer,
    handleOpenMeasureTool,
  } = useWorkspaceOverlayActions({
    getUsdPreparedExportCache,
    onLoadRobot,
    setPendingUsdAssemblyFile: (file) => {
      pendingUsdAssemblyFileRef.current = file;
    },
    insertAssemblyComponentIntoWorkspace,
    showAssemblyComponentPreparationOverlay,
    clearAssemblyComponentPreparationOverlay,
    showToast,
    t,
    setBridgePreview,
    setShouldRenderBridgeModal,
    setIsBridgeModalOpen,
    addBridge,
    setIsCollisionOptimizerOpen,
    setViewConfig,
    setPendingViewerToolMode,
  });

  const {
    collisionOptimizationSource,
    handlePreviewCollisionOptimizationTarget,
    handleApplyCollisionOptimization,
  } = useCollisionOptimizationWorkflow({
    assemblyState,
    sidebarTab,
    robotName,
    robotLinks,
    robotJoints,
    rootLinkId,
    robotMaterials,
    setRobot,
    updateComponentRobot,
    focusOn,
    pulseSelection,
    setSelection,
    showToast,
    t,
  });

  const syncSelectedEditableFileContent = useCallback(
    (file: RobotFile, content: string) => {
      if (selectedFile?.name === file.name && selectedFile.content !== content) {
        setSelectedFile({
          ...selectedFile,
          content,
        });
      }

      if (availableFiles.some((entry) => entry.name === file.name && entry.content !== content)) {
        setAvailableFiles(
          availableFiles.map((entry) => (entry.name === file.name ? { ...entry, content } : entry)),
        );
      }

      if (allFileContents[file.name] !== content) {
        setAllFileContents({
          ...allFileContents,
          [file.name]: content,
        });
      }
    },
    [
      allFileContents,
      availableFiles,
      selectedFile,
      setAllFileContents,
      setAvailableFiles,
      setSelectedFile,
    ],
  );

  const handleCodeChange = useCallback(
    async (newCode: string): Promise<boolean> => {
      if (!selectedFile || selectedFile.format === 'usd') {
        return false;
      }

      const sourceFile = selectedFile;
      const requestId = ++editableSourceParseRequestRef.current;

      try {
        const parsedState = await parseEditableRobotSourceWithWorker({
          file: sourceFile,
          content: newCode,
          availableFiles,
          allFileContents,
        });

        if (requestId !== editableSourceParseRequestRef.current) {
          return false;
        }

        if (useAssetsStore.getState().selectedFile?.name !== sourceFile.name) {
          return false;
        }

        const newState = parsedState
          ? rewriteRobotMeshPathsForSource(parsedState, sourceFile.name)
          : null;

        if (!newState) {
          return false;
        }

        if (sourceFile.format === 'xacro') {
          syncSelectedEditableFileContent(sourceFile, newCode);
          setOriginalUrdfContent(generateURDF(newState, { preserveMeshPaths: true }));
        }

        const newData = {
          name: newState.name,
          links: newState.links,
          joints: newState.joints,
          rootLinkId: newState.rootLinkId,
          materials: newState.materials,
        };
        setRobot(newData);
        return true;
      } catch (error) {
        if (requestId !== editableSourceParseRequestRef.current) {
          return false;
        }

        console.error('[AppLayout] Failed to parse editable source in worker:', error);
        return false;
      }
    },
    [
      allFileContents,
      availableFiles,
      selectedFile,
      setOriginalUrdfContent,
      setRobot,
      syncSelectedEditableFileContent,
    ],
  );

  const handleSnapshot = useCallback(() => {
    setIsSnapshotDialogOpen(true);
  }, []);

  const handleCaptureSnapshot = useCallback(
    async (options: SnapshotCaptureOptions) => {
      if (!snapshotActionRef.current) {
        showToast(t.snapshotFailed, 'info');
        return;
      }

      try {
        setIsSnapshotCapturing(true);
        await snapshotActionRef.current(options);
        setIsSnapshotDialogOpen(false);
      } catch (error) {
        console.error('Snapshot failed:', error);
        showToast(t.snapshotFailed, 'info');
      } finally {
        setIsSnapshotCapturing(false);
      }
    },
    [showToast, t],
  );

  const {
    isFileDragActive,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    prefetchSourceCodeEditor,
  } = useAppLayoutEffects({
    robot,
    selection,
    clearSelection,
    onFileDrop,
    onDropError: () => showToast(t.failedToProcessFiles, 'info'),
  });
  const handleSourceCodeEditorPreloadError = useCallback((error: unknown) => {
    console.error('[AppLayout] Failed to preload source code editor runtime:', error);
  }, []);

  const { handleOpenCodeViewer, handlePrefetchCodeViewer } = useSourceCodeEditorWarmup({
    isSelectedUsdHydrating,
    setIsCodeViewerOpen,
    showToast,
    usdLoadInProgressMessage: t.usdLoadInProgress,
    preloadRuntime: preloadSourceCodeEditorRuntime,
    prefetchSourceCodeEditor,
    onPreloadError: handleSourceCodeEditorPreloadError,
  });

  const handlePreviewFileWithFeedback = useCallback(
    (file: RobotFile) => {
      const standaloneImportAssetWarning = buildStandaloneImportAssetWarning(
        file,
        Object.keys(assets),
      );
      if (standaloneImportAssetWarning) {
        const assetLabel =
          standaloneImportAssetWarning.missingAssetPaths.length > 3
            ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, …`
            : standaloneImportAssetWarning.missingAssetPaths.join(', ');
        const warningMessage = t.importPackageAssetBundleHint.replace('{assets}', assetLabel);

        setDocumentLoadState({
          status: 'error',
          fileName: file.name,
          format: file.format,
          error: warningMessage,
          phase: null,
          message: null,
          progressPercent: null,
          loadedCount: null,
          totalCount: null,
        });
        showToast(warningMessage, 'info');
        return;
      }

      setDocumentLoadState({
        status: 'loading',
        fileName: file.name,
        format: file.format,
        error: null,
        phase: file.format === 'usd' ? 'checking-path' : 'preparing-scene',
        message: null,
        progressPercent: null,
        loadedCount: null,
        totalCount: null,
      });
      handlePreviewFile(file);

      void resolveRobotFileDataWithWorker(file, {
        availableFiles,
        assets,
        allFileContents,
        usdRobotData: getUsdPreparedExportCache(file.name)?.robotData ?? null,
      })
        .then((previewResult) => {
          if (previewResult.status === 'ready') {
            return;
          }

          if (previewResult.status === 'needs_hydration') {
            setDocumentLoadState({
              status: 'ready',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: null,
              message: t.usdPreviewRequiresOpen,
              progressPercent: null,
              loadedCount: null,
              totalCount: null,
            });
            showToast(t.usdPreviewRequiresOpen, 'info');
            return;
          }

          if (previewResult.reason === 'source_only_fragment') {
            setDocumentLoadState({
              status: 'ready',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: null,
              message: t.xacroSourceOnlyPreviewHint,
              progressPercent: null,
              loadedCount: null,
              totalCount: null,
            });
            showToast(t.xacroSourceOnlyPreviewHint, 'info');
            return;
          }

          setDocumentLoadState({
            status: 'error',
            fileName: file.name,
            format: file.format,
            error: t.failedToParseFormat.replace('{format}', file.format.toUpperCase()),
          });
          showToast(t.failedToParseFormat.replace('{format}', file.format.toUpperCase()), 'info');
        })
        .catch((error) => {
          console.error(
            `[AppLayout] Failed to resolve preview robot data for "${file.name}".`,
            error,
          );
          setDocumentLoadState({
            status: 'error',
            fileName: file.name,
            format: file.format,
            error: t.failedToParseFormat.replace('{format}', file.format.toUpperCase()),
          });
          showToast(t.failedToParseFormat.replace('{format}', file.format.toUpperCase()), 'info');
        });
    },
    [
      allFileContents,
      assets,
      availableFiles,
      getUsdPreparedExportCache,
      handlePreviewFile,
      setDocumentLoadState,
      showToast,
      t,
    ],
  );

  return (
    <div
      className="flex flex-col h-screen font-sans bg-google-light-bg dark:bg-app-bg text-slate-800 dark:text-slate-200"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <FileDropOverlay
        visible={isFileDragActive}
        title={t.dropFilesToImport}
        hint={t.dropFilesToImportHint}
      />

      {/* Hidden file inputs */}
      <input
        type="file"
        accept={ROBOT_IMPORT_ACCEPT_ATTRIBUTE}
        ref={importInputRef}
        className="hidden"
      />
      <input
        type="file"
        ref={importFolderInputRef}
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
      />

      {/* Header */}
      <Header
        onImportFile={() => importInputRef.current?.click()}
        onImportFolder={() => importFolderInputRef.current?.click()}
        onOpenExport={onOpenExport}
        onExportProject={onExportProject}
        onOpenAI={onOpenAI}
        onOpenMeasureTool={handleOpenMeasureTool}
        onOpenCodeViewer={handleOpenCodeViewer}
        onPrefetchCodeViewer={handlePrefetchCodeViewer}
        onOpenSettings={onOpenSettings}
        quickAction={headerQuickAction}
        secondaryAction={headerSecondaryAction}
        onSnapshot={handleSnapshot}
        onOpenCollisionOptimizer={handleOpenCollisionOptimizer}
        viewConfig={viewConfig}
        setViewConfig={setViewConfig}
      />

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        <TreeEditor
          robot={previewContextRobot}
          onSelect={handleSelectWithAssemblyClear}
          onSelectGeometry={handleSelectGeometryWithAssemblyClear}
          onFocus={handleFocus}
          onAddChild={handleAddChild}
          onAddCollisionBody={handleAddCollisionBody}
          onDelete={handleDelete}
          onNameChange={handleNameChange}
          onUpdate={handleUpdate}
          showVisual={showVisual}
          setShowVisual={handleSetShowVisual}
          mode={mergedAppMode}
          lang={lang}
          theme={theme}
          collapsed={sidebar.leftCollapsed}
          onToggle={() => toggleSidebar('left')}
          availableFiles={availableFiles}
          onLoadRobot={onLoadRobot}
          currentFileName={previewFileName ?? selectedFile?.name}
          assemblyState={assemblyState}
          onAddComponent={handleAddComponent}
          onDeleteLibraryFile={handleDeleteLibraryFile}
          onDeleteLibraryFolder={handleDeleteLibraryFolder}
          onRenameLibraryFolder={handleRenameLibraryFolder}
          onDeleteAllLibraryFiles={handleDeleteAllLibraryFiles}
          onExportLibraryFile={handleExportLibraryFile}
          onCreateBridge={handleCreateBridge}
          onRemoveComponent={removeComponent}
          onRemoveBridge={removeBridge}
          onRenameComponent={handleRenameComponent}
          onSwitchToProMode={handleSwitchTreeEditorToProMode}
          onRequestSwitchToStructure={handleRequestSwitchTreeEditorToStructure}
          isReadOnly={isPreviewingWorkspaceSource}
        />

        {/* Viewer Container */}
        <div className="flex-1 relative min-w-0">
          <UnifiedViewer
            robot={viewerRobot}
            visualizerRobot={robot}
            mode={mergedAppMode}
            onSelect={handleViewerSelectWithBridgePreview}
            onMeshSelect={handleViewerMeshSelectWithAssemblyClear}
            onHover={handleHover}
            onUpdate={handleUpdate}
            assets={viewerAssets}
            lang={lang}
            theme={theme}
            showVisual={showVisual}
            setShowVisual={handleSetShowVisual}
            snapshotAction={snapshotActionRef}
            showToolbar={viewConfig.showToolbar}
            setShowToolbar={(show) => setViewConfig((prev) => ({ ...prev, showToolbar: show }))}
            showOptionsPanel={viewConfig.showOptionsPanel}
            setShowOptionsPanel={(show) =>
              setViewConfig((prev) => ({ ...prev, showOptionsPanel: show }))
            }
            showVisualizerOptionsPanel={viewConfig.showVisualizerOptionsPanel}
            setShowVisualizerOptionsPanel={(show) =>
              setViewConfig((prev) => ({ ...prev, showVisualizerOptionsPanel: show }))
            }
            showJointPanel={viewConfig.showJointPanel}
            setShowJointPanel={(show) =>
              setViewConfig((prev) => ({ ...prev, showJointPanel: show }))
            }
            availableFiles={availableFiles}
            urdfContent={urdfContentForViewer}
            viewerSourceFormat={viewerSourceFormat}
            sourceFilePath={viewerSourceFilePath}
            sourceFile={getViewerSourceFile({
              selectedFile,
              shouldRenderAssembly,
              workspaceSourceFile: workspaceViewerMjcfSourceFile,
            })}
            onRobotDataResolved={handleRobotDataResolved}
            onDocumentLoadEvent={handleViewerDocumentLoadEvent}
            jointAngleState={jointAngleState}
            jointMotionState={jointMotionState}
            onJointChange={handleJointChange}
            syncJointChangesToApp
            selection={robot.selection}
            focusTarget={focusTarget}
            isMeshPreview={selectedFile?.format === 'mesh'}
            onTransformPendingChange={handleTransformPendingChange}
            onCollisionTransform={handleCollisionTransform}
            assemblyState={assemblyState}
            assemblyWorkspaceActive={shouldRenderAssembly}
            assemblySelection={assemblySelection}
            sourceSceneAssemblyComponentId={sourceSceneAssemblyComponentId}
            onAssemblyTransform={handleAssemblyTransform}
            onComponentTransform={handleComponentTransform}
            onBridgeTransform={handleBridgeTransform}
            filePreview={filePreview}
            onClosePreview={handleClosePreview}
            pendingViewerToolMode={pendingViewerToolMode}
            onConsumePendingViewerToolMode={() => setPendingViewerToolMode(null)}
            viewerReloadKey={viewerReloadKey}
            documentLoadState={documentLoadLifecycleState}
          />
          <ConnectedDocumentLoadingOverlay
            lang={lang}
            targetFileName={previewFileName ?? selectedFile?.name ?? null}
          />
        </div>

        <PropertyEditor
          robot={propertyEditorSelectionContext.robot}
          onUpdate={handleUpdate}
          onSelect={handleSelectWithAssemblyClear}
          onHover={handleHover}
          mode={mergedAppMode}
          assets={assets}
          onUploadAsset={handleUploadAsset}
          motorLibrary={motorLibrary}
          lang={lang}
          theme={theme}
          collapsed={sidebar.rightCollapsed}
          onToggle={() => toggleSidebar('right')}
          readOnlyMessage={isPreviewingWorkspaceSource ? t.previewReadOnlyHint : undefined}
          jointTypeLocked={Boolean(propertyEditorSelectionContext.selectedClosedLoopBridge)}
        />
      </div>

      <SnapshotDialog
        isOpen={isSnapshotDialogOpen}
        isCapturing={isSnapshotCapturing}
        lang={lang}
        onClose={() => setIsSnapshotDialogOpen(false)}
        onCapture={handleCaptureSnapshot}
      />

      {assemblyComponentPreparationOverlay ? (
        <ImportPreparationOverlay
          label={assemblyComponentPreparationOverlay.label}
          detail={assemblyComponentPreparationOverlay.detail}
          progress={assemblyComponentPreparationOverlay.progress}
          statusLabel={assemblyComponentPreparationOverlay.statusLabel}
          stageLabel={assemblyComponentPreparationOverlay.stageLabel}
        />
      ) : null}

      <AppLayoutOverlays
        isCodeViewerOpen={isCodeViewerOpen}
        sourceCodeContent={sourceCodeContent}
        sourceCodeDocumentFlavor={sourceCodeDocumentFlavor}
        forceSourceCodeReadOnly={Boolean(previewFileName)}
        autoApplyEnabled={sourceCodeAutoApply}
        onCodeChange={handleCodeChange}
        onSourceCodeDownload={() => markUnsavedChangesBaselineSaved('robot')}
        onCloseCodeViewer={() => setIsCodeViewerOpen(false)}
        theme={theme}
        selectedFileName={sourceCodeFileName}
        robotName={robot.name}
        lang={lang}
        loadingEditorLabel={t.loadingEditor}
        isCollisionOptimizerOpen={isCollisionOptimizerOpen}
        loadingOptimizerLabel={t.loadingOptimizer}
        collisionOptimizationSource={collisionOptimizationSource}
        assets={assets}
        selection={selection}
        onCloseCollisionOptimizer={() => setIsCollisionOptimizerOpen(false)}
        onSelectCollisionTarget={handlePreviewCollisionOptimizationTarget}
        onApplyCollisionOptimization={handleApplyCollisionOptimization}
        assemblyState={assemblyState}
        shouldRenderBridgeModal={shouldRenderBridgeModal}
        loadingBridgeDialogLabel={t.loadingBridgeDialog}
        isBridgeModalOpen={isBridgeModalOpen}
        onCloseBridgeModal={handleCloseBridgeModal}
        onCreateBridge={handleCreateBridgeCommit}
        onPreviewBridgeChange={handleBridgePreviewChange}
      />
    </div>
  );
}

export default AppLayout;
