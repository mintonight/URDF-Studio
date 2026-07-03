/**
 * App Layout Component
 * Main application layout with Header and workspace area
 */
import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import type { RootState } from '@react-three/fiber';
import { AppLayoutView } from './components/AppLayoutView';
import { preloadSourceCodeEditorRuntime } from './utils/sourceCodeEditorLoader';
import { setOptionsPanelVisibility } from './components/header/viewMenuState.js';
import type { ToolMode } from '@/features/editor';
import type { AppLayoutProps, ProModeRoundtripSession } from './appLayoutTypes';
import { useAppLayoutEffects } from './hooks/useAppLayoutEffects';
import { useAppLayoutStoreSlices } from './hooks/useAppLayoutStoreSlices';
import { useAssemblyComponentPreparation } from './hooks/assemblyComponentPreparation';
import { useCollisionOptimizationWorkflow } from './hooks/useCollisionOptimizationWorkflow';
import { useEditableSourceCodeApply } from './hooks/useEditableSourceCodeApply';
import { useEditableSourcePatches } from './hooks/useEditableSourcePatches';
import { useLibraryRobotLoadRequest } from './hooks/useLibraryRobotLoadRequest';
import { useLibraryFileActions } from './hooks/useLibraryFileActions';
import { usePreviewFileWithFeedback } from './hooks/usePreviewFileWithFeedback';
import { usePreparedUsdViewerAssets } from './hooks/usePreparedUsdViewerAssets';
import { useResponsiveSidebarCollapse } from './hooks/useResponsiveSidebarCollapse';
import { useSourceCodeEditorWarmup } from './hooks/useSourceCodeEditorWarmup';
import { useIkToolController } from './hooks/useIkToolController';
import { useIkDragPanelActions } from './hooks/use_ik_drag_panel_actions';
import { useSnapshotDialogController } from './hooks/useSnapshotDialogController';
import { useSnapshotCaptureRequest } from './hooks/use_snapshot_capture_request';
import { useToolItems } from './hooks/useToolItems';
import {
  useTreePanelJointPreview,
  type TreePanelJointCommitSnapshot,
} from './hooks/useTreePanelJointPreview';
import { useUsdDocumentLifecycle } from './hooks/useUsdDocumentLifecycle';
import { useWorkspaceLayoutDerivations } from './hooks/useWorkspaceLayoutDerivations';
import { useWorkspaceAssemblyRenderFailureNotice } from './hooks/useWorkspaceAssemblyRenderFailureNotice';
import { useViewerOrchestration } from './hooks/useViewerOrchestration';
import { useWorkspaceMutations } from './hooks/useWorkspaceMutations';
import { useWorkspaceOverlayActions } from './hooks/useWorkspaceOverlayActions';
import { useWorkspaceModeTransitions } from './hooks/useWorkspaceModeTransitions';
import { useWorkspaceSeedForAdd } from './hooks/useWorkspaceSeedForAdd';
import { useWorkspaceSourceSync } from './hooks/useWorkspaceSourceSync';
import { useWorkspaceViewerSelectionBridge } from './hooks/useWorkspaceViewerSelectionBridge';
import { useSourceCodeEditorDocuments } from './hooks/useSourceCodeEditorDocuments';
import {
  getViewerSourceFile,
  shouldUseEmptyRobotForUsdHydration,
} from './hooks/workspaceSourceSyncUtils';
import { shouldDeferUsdStageHydrationSelectionCleanup } from './utils/usdStageHydration';
import type { BridgeJoint, RobotFile } from '@/types';
import { translations } from '@/shared/i18n';
import type {
  SnapshotCaptureAction,
  SnapshotCaptureOptions,
} from '@/shared/components/3d/scene/snapshotConfig';
import { resolveViewerDocumentLifecycleCallbacks } from './utils/viewerDocumentLifecycleCallbacks';
import { normalizeMergedAppMode } from '@/shared/utils/appMode';
import { resolveAssemblyRootComponentSelectionAvailability } from './utils/assemblyRootComponentSelection';
import type { SnapshotPreviewSession } from './components/snapshot-preview/types';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';

export function AppLayout({
  importInputRef,
  importFolderInputRef,
  onFileDrop,
  onOpenExport,
  onOpenLibraryExport,
  onExportProject,
  isExportingProject = false,
  showToast,
  onOpenAIInspection,
  onOpenAIConversation,
  isCodeViewerOpen,
  setIsCodeViewerOpen,
  onOpenSettings,
  headerQuickAction,
  headerSecondaryAction,
  viewConfig,
  setViewConfig,
  onLoadRobot,
  viewerReloadKey,
  importPreparationOverlay = null,
  onExposeLayoutActions,
}: AppLayoutProps) {
  const {
    uiStore: {
      appMode,
      lang,
      theme,
      sidebar,
      panelLayout,
      toggleSidebar,
      setSidebar,
      sourceCodeAutoApply,
      setViewOption,
      groundPlaneOffset,
    },
    selectionStore: {
      selection,
      setSelection,
      setHoveredSelection,
      focusTarget,
      focusOn,
      pulseSelection,
    },
    assemblySelectionStore: {
      assemblySelection,
      clearSelection: clearAssemblySelection,
      selectComponent,
    },
    assetsStore: {
      assets,
      motorLibrary,
      availableFiles,
      selectedFile,
      documentLoadState,
      documentLoadLifecycleState,
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
      usdPreparedExportCaches,
      setDocumentLoadState,
    },
    robotStore: {
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
      updateMjcfTendon,
      setAllLinksVisibility,
      setJointAngle,
      applyJointKinematicOverrides,
    },
    assemblyStore: {
      assemblyState,
      assemblyRevision,
      addComponent,
      initAssembly,
      removeComponent,
      addBridge,
      removeBridge,
      updateComponentName,
      updateComponentTransform,
      updateComponentRobot,
      updateAssemblyTransform,
      renameComponentSourceFolder,
    },
    collisionTransformStore: {
      setPendingCollisionTransform,
      clearPendingCollisionTransform,
    },
  } = useAppLayoutStoreSlices();

  useResponsiveSidebarCollapse({ sidebar, setSidebar });
  const mergedAppMode = normalizeMergedAppMode(appMode);
  const t = translations[lang];
  const normalizedAssemblyState = assemblyState ?? null;

  const snapshotActionRef = useRef<
    ((options?: Partial<SnapshotCaptureOptions>) => Promise<void>) | null
  >(null);
  const viewerCanvasStateRef = useRef<RootState | null>(null);
  const transformPendingRef = useRef(false);
  const pendingUsdAssemblyFileRef = useRef<RobotFile | null>(null);
  const proModeRoundtripSessionRef = useRef<ProModeRoundtripSession | null>(null);
  const pendingTreePanelJointCommitRef = useRef<TreePanelJointCommitSnapshot | null>(null);
  const [pendingViewerToolMode, setPendingViewerToolMode] = useState<ToolMode | null>(null);
  const [workspaceTransformPending, setWorkspaceTransformPending] = useState(false);
  const [isBridgeModalOpen, setIsBridgeModalOpen] = useState(false);
  const [isCollisionOptimizerOpen, setIsCollisionOptimizerOpen] = useState(false);
  const [isSnapshotDialogOpen, setIsSnapshotDialogOpen] = useState(false);
  const [isSnapshotCapturing, setIsSnapshotCapturing] = useState(false);
  const [snapshotPreviewSession, setSnapshotPreviewSession] =
    useState<SnapshotPreviewSession | null>(null);
  const snapshotPreviewCaptureActionRef = useRef<SnapshotCaptureAction | null>(null);
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
  const shouldDeferSelectionCleanup = shouldDeferUsdStageHydrationSelectionCleanup({
    documentLoadFileName: documentLoadLifecycleState.fileName,
    documentLoadFormat: documentLoadLifecycleState.format,
    documentLoadStatus: documentLoadLifecycleState.status,
    selectedFileFormat: selectedFile?.format ?? null,
    selectedFileName: selectedFile?.name ?? null,
  });

  const {
    assemblyComponentPreparationOverlay,
    prepareAssemblyComponentForInsert,
    showAssemblyComponentPreparationOverlay,
    clearAssemblyComponentPreparationOverlay,
    activateInsertedAssemblyComponent,
    insertAssemblyComponentIntoWorkspace,
  } = useAssemblyComponentPreparation({
    assemblyState: normalizedAssemblyState,
    availableFiles,
    assets,
    allFileContents,
    t,
    addComponent,
    focusOn,
    selectComponent,
    setSelection,
  });

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
    renderSelectedUsdFromRobotState,
    workspaceViewerMjcfSourceFile,
    sourceCodeDocuments,
    hasSimpleModeSourceEdits,
    shouldPreviewLibraryRobotLoad,
    filePreview,
    previewRobot,
    previewFileName,
    handlePreviewFile,
    handleClosePreview,
  } = useWorkspaceSourceSync({
    assemblyState: normalizedAssemblyState,
    assemblyRevision,
    assemblyBridgePreview: bridgePreview,
    assemblySelection,
    workspaceTransformPending,
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

  useEffect(() => {
    if (!shouldRenderAssembly) {
      setWorkspaceTransformPending(false);
    }
  }, [shouldRenderAssembly]);

  useWorkspaceAssemblyRenderFailureNotice({
    assemblyRevision,
    assemblyState: normalizedAssemblyState,
    labels: {
      workspaceAssemblyRenderFailedMergedData: t.workspaceAssemblyRenderFailedMergedData,
      workspaceAssemblyRenderFailedViewerData: t.workspaceAssemblyRenderFailedViewerData,
    },
    selectedFile,
    shouldRenderAssembly,
    workspaceAssemblyRenderFailureReason,
  });

  const previewFile = previewFileName
    ? (availableFiles.find((file) => file.name === previewFileName) ?? null)
    : null;
  const preparedAssetSourceFiles = useMemo(
    () =>
      [selectedFile, previewFile].filter((file): file is RobotFile =>
        Boolean(file && file.format === 'usd'),
      ),
    [previewFile, selectedFile],
  );

  const viewerAssets = usePreparedUsdViewerAssets({
    assemblyState: normalizedAssemblyState,
    assets,
    availableFiles,
    additionalSourceFiles: preparedAssetSourceFiles,
    preparedExportCaches: usdPreparedExportCaches,
    getUsdPreparedExportCache,
    shouldRenderAssembly,
  });

  useEffect(() => {
    if (!assemblyState) {
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
  ]);

  const {
    updateProModeRoundtripBaseline,
    handleRequestSwitchTreeEditorToStructure,
    handleSwitchTreeEditorToProMode,
  } = useWorkspaceModeTransitions({
    previewFile: null,
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
  const {
    handleViewerDocumentLoadEvent,
    handleViewerRuntimeRobotLoaded,
    handleViewerRuntimeSceneReadyForDisplay,
  } = useUsdDocumentLifecycle({
    clearAssemblyComponentPreparationOverlay,
    insertAssemblyComponentIntoWorkspace,
    isSelectedUsdHydrating,
    labels: {
      addedComponent: t.addedComponent,
      failedToParseFormat: t.failedToParseFormat,
    },
    pendingUsdAssemblyFileRef,
    previewFile: null,
    selectedFile,
    setDocumentLoadState,
    setRobot,
    setSelection,
    showToast,
    updateProModeRoundtripBaseline,
  });

  // Keep drag-time joint previews scoped to the active viewer runtime. Feeding them
  // through AppLayout forces the tree and property sidebars into high-frequency re-render.
  const previewContextRobot = robot;
  const isPreviewingWorkspaceSource = false;
  const {
    ikDragActive,
    isIkToolPanelOpen,
    handleIkDragActiveChange,
    handleOpenIkTool,
  } = useIkDragPanelActions({
    selection,
    setSelection,
    setViewOption,
  });
  const {
    ikToolSelectionState,
    ikLinkOptions,
    selectedIkLinkId,
    selectedIkLinkLabel,
    currentIkLinkLabel,
    selectIkLink,
  } = useIkToolController({
    ikDragActive,
    previewContextRobot,
    robotLinks,
    robotJoints,
    rootLinkId,
    selection,
    setSelection,
  });
  const {
    propertyEditorSelectionContext,
    workspaceLayoutClassNames,
    workspaceOverlaySafeAreaStyle,
    workspaceOverlayGizmoMargin,
  } = useWorkspaceLayoutDerivations({
    normalizedAssemblyState,
    panelLayout,
    previewContextRobot,
    sidebar,
  });

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
    selectionRobot: previewContextRobot,
  });
  const {
    handleWorkspaceTransformPendingChange,
    handleViewerSelectWithBridgePreview,
    handleSelectWithAssemblyClear,
    handleSelectGeometryWithAssemblyClear,
    handleViewerMeshSelectWithAssemblyClear,
  } = useWorkspaceViewerSelectionBridge({
    assemblyState: normalizedAssemblyState,
    canSelectAssemblyRootComponent: resolveAssemblyRootComponentSelectionAvailability({
      shouldRenderAssembly,
      sourceSceneAssemblyComponentId,
    }),
    clearAssemblySelection,
    handleSelect,
    handleSelectGeometry,
    handleTransformPendingChange,
    handleViewerMeshSelect,
    handleViewerSelect,
    selectComponent,
    setWorkspaceTransformPending,
  });

  const {
    patchEditableSourceAddChild,
    patchEditableSourceDeleteSubtree,
    patchEditableSourceAddCollisionBody,
    patchEditableSourceDeleteCollisionBody,
    patchEditableSourceUpdateCollisionBody,
    patchEditableSourceUpdateJointLimit,
    patchEditableSourceRobotName,
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
    handleCollisionTransformPreview,
    handleCollisionTransform,
    handleAssemblyTransform,
    handleComponentTransform,
    handleBridgeTransform,
    handleAddChild,
    handleAddCollisionBody,
    handleDelete,
    handleRenameComponent,
    handleSetShowVisual,
    handleJointChange: handleCommittedJointChange,
  } = useWorkspaceMutations({
    assemblyState: normalizedAssemblyState,
    robotLinks,
    rootLinkId,
    setName,
    addChild,
    deleteSubtree,
    updateLink,
    updateJoint,
    updateMjcfTendon,
    setAllLinksVisibility,
    setJointAngle,
    applyJointKinematicOverrides,
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
    patchEditableSourceUpdateJointLimit,
    patchEditableSourceRobotName,
    patchEditableSourceRenameEntities,
    setSelection,
    setPendingCollisionTransform,
    clearPendingCollisionTransform,
    handleTransformPendingChange: handleWorkspaceTransformPendingChange,
  });

  const { handleJointPreview, handleJointChange } = useTreePanelJointPreview({
    previewContextRobot,
    jointAngleState,
    jointMotionState,
    pendingTreePanelJointCommitRef,
    handleCommittedJointChange,
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
    assemblyState: normalizedAssemblyState,
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

  const ensureWorkspaceSeededForAdd = useWorkspaceSeedForAdd({
    addComponent,
    allFileContents,
    assets,
    availableFiles,
    closedLoopConstraints,
    initAssembly,
    robotJoints,
    robotLinks,
    robotMaterials,
    robotName,
    rootLinkId,
    selectedFile,
  });

  const {
    handleAddComponent,
    handleCreateBridge,
    handleCloseBridgeModal,
    handleBridgePreviewChange,
    handleCreateBridgeCommit,
    handleOpenCollisionOptimizer,
  } = useWorkspaceOverlayActions({
    getUsdPreparedExportCache,
    onLoadRobot,
    ensureWorkspaceSeededForAdd,
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
  });
  const {
    collisionOptimizationSource,
    handlePreviewCollisionOptimizationTarget,
    handleApplyCollisionOptimization,
  } = useCollisionOptimizationWorkflow({
    assemblyState: normalizedAssemblyState,
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

  const { handleCodeChange } = useEditableSourceCodeApply({
    allFileContents,
    availableFiles,
    selectedFile,
    setAllFileContents,
    setAvailableFiles,
    setOriginalUrdfContent,
    setRobot,
    setSelectedFile,
  });
  const sourceCodeEditorDocuments = useSourceCodeEditorDocuments(
    sourceCodeDocuments,
    handleCodeChange,
  );

  const viewerSourceFile = useMemo(
    () =>
      getViewerSourceFile({
        selectedFile,
        shouldRenderAssembly,
        workspaceSourceFile: workspaceViewerMjcfSourceFile,
        renderSelectedUsdFromRobotState,
      }),
    [
      renderSelectedUsdFromRobotState,
      selectedFile,
      shouldRenderAssembly,
      workspaceViewerMjcfSourceFile,
    ],
  );
  const viewerDocumentLifecycleCallbacks = useMemo(
    () =>
      resolveViewerDocumentLifecycleCallbacks({
        shouldRenderAssembly,
        callbacks: {
          onDocumentLoadEvent: handleViewerDocumentLoadEvent,
          onRuntimeRobotLoaded: handleViewerRuntimeRobotLoaded,
          onRuntimeSceneReadyForDisplay: handleViewerRuntimeSceneReadyForDisplay,
        },
      }),
    [
      handleViewerDocumentLoadEvent,
      handleViewerRuntimeRobotLoaded,
      handleViewerRuntimeSceneReadyForDisplay,
      shouldRenderAssembly,
    ],
  );

  const {
    handleCloseSnapshotDialog,
    handleSnapshotPreviewCaptureActionChange,
    handleSnapshot,
  } = useSnapshotDialogController({
    availableFiles,
    groundPlaneOffset,
    jointAngleState,
    jointMotionState,
    selectedFileFormat: selectedFile?.format ?? null,
    showVisual,
    theme,
    urdfContentForViewer,
    viewerAssets,
    viewerCanvasStateRef,
    viewerReloadKey,
    viewerRobot,
    viewerSourceFile,
    viewerSourceFilePath,
    viewerSourceFormat,
    snapshotPreviewCaptureActionRef,
    setIsSnapshotDialogOpen,
    setSnapshotPreviewSession,
  });

  const { items: toolboxItems, openTool } = useToolItems({
    t,
    openAIInspection: onOpenAIInspection,
    openAIConversation: onOpenAIConversation,
    openIkTool: handleOpenIkTool,
    openCollisionOptimizer: handleOpenCollisionOptimizer,
  });

  // Expose layout-level handlers to the parent
  useEffect(() => {
    onExposeLayoutActions?.({
      openIkTool: handleOpenIkTool,
      openCollisionOptimizer: handleOpenCollisionOptimizer,
      openTool,
    });
  }, [onExposeLayoutActions, handleOpenIkTool, handleOpenCollisionOptimizer, openTool]);

  const handleSetDetailOptionsPanelVisibility = useCallback(
    (show: boolean) => {
      setViewConfig((prev) => setOptionsPanelVisibility(prev, show));
    },
    [setViewConfig],
  );

  const handleCaptureSnapshot = useSnapshotCaptureRequest({
    liveCaptureActionRef: snapshotActionRef,
    frozenPreviewCaptureActionRef: snapshotPreviewCaptureActionRef,
    snapshotPreviewSession,
    setIsSnapshotCapturing,
    showToast,
    snapshotFailedMessage: t.snapshotFailed,
  });

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
    shouldDeferSelectionCleanup,
    onFileDrop,
    onDropError: () => showToast(t.failedToProcessFiles, 'info'),
  });
  const handleSourceCodeEditorPreloadError = useCallback((error: unknown) => {
    logRegressionError('[AppLayout] Failed to preload source code editor runtime:', error);
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

  const assemblyComponentFileNames = useMemo(() => {
    if (!assemblyState) {
      return undefined;
    }
    const names = new Set<string>();
    for (const component of Object.values(assemblyState.components)) {
      if (component.sourceFile) {
        names.add(component.sourceFile);
      }
    }
    return names.size > 0 ? names : undefined;
  }, [assemblyState]);

  const { handlePreviewFileWithFeedback } = usePreviewFileWithFeedback({
    allFileContents,
    assemblyComponentFileNames,
    assets,
    availableFiles,
    getUsdPreparedExportCache,
    handlePreviewFile,
    labels: {
      failedToParseFormat: t.failedToParseFormat,
      importPackageAssetBundleHint: t.importPackageAssetBundleHint,
      importPrimitiveGeometryHint: t.importPrimitiveGeometryHint,
      usdPreviewRequiresOpen: t.usdPreviewRequiresOpen,
      xacroSourceOnlyPreviewHint: t.xacroSourceOnlyPreviewHint,
    },
    setDocumentLoadState,
    showToast,
  });

  const handleRequestLoadRobot = useLibraryRobotLoadRequest({
    handlePreviewFileWithFeedback,
    hasSimpleModeSourceEdits,
    onLoadRobot,
    selectedFile,
    shouldPreviewLibraryRobotLoad,
  });

  return (
    <AppLayoutView
      drag={{
        handlers: {
          onDragEnter: handleDragEnter,
          onDragOver: handleDragOver,
          onDragLeave: handleDragLeave,
          onDrop: handleDrop,
        },
        isFileDragActive,
        t,
      }}
      importInputs={{
        importInputRef,
        importFolderInputRef,
      }}
      header={{
        onOpenExport,
        onExportProject,
        isExportingProject,
        onOpenSettings,
        headerQuickAction,
        headerSecondaryAction,
        viewConfig,
        setViewConfig,
        toolboxItems,
        handleOpenCodeViewer,
        handlePrefetchCodeViewer,
        handleSnapshot,
      }}
      ikPanel={{
        isOpen: isIkToolPanelOpen,
        t,
        ikLinkOptions,
        selectedIkLinkId,
        selectedIkLinkLabel,
        currentIkLinkLabel,
        ikToolSelectionStatus: ikToolSelectionState.status,
        onSelectIkLink: selectIkLink,
        onClose: () => handleIkDragActiveChange(false),
      }}
      workspaceChrome={{
        classNames: workspaceLayoutClassNames,
        overlaySafeAreaStyle: workspaceOverlaySafeAreaStyle,
        overlayGizmoMargin: workspaceOverlayGizmoMargin,
      }}
      viewer={{
        viewerRobot,
        editorRobot: robot,
        mergedAppMode,
        handleViewerSelectWithBridgePreview,
        handleViewerMeshSelectWithAssemblyClear,
        handleHover,
        handleUpdate,
        viewerAssets,
        allFileContents,
        showVisual,
        handleSetShowVisual,
        handleSetDetailOptionsPanelVisibility,
        snapshotActionRef,
        viewerCanvasStateRef,
        availableFiles,
        urdfContentForViewer,
        viewerSourceFormat,
        viewerSourceFilePath,
        viewerSourceFile,
        viewerDocumentLifecycleCallbacks,
        jointAngleState,
        jointMotionState,
        handleJointChange,
        selection,
        focusTarget,
        selectedFile,
        handleWorkspaceTransformPendingChange,
        handleCollisionTransformPreview,
        handleCollisionTransform,
        normalizedAssemblyState,
        shouldRenderAssembly,
        assemblySelection,
        sourceSceneAssemblyComponentId,
        handleAssemblyTransform,
        handleComponentTransform,
        handleBridgeTransform,
        ikDragActive,
        pendingViewerToolMode,
        setPendingViewerToolMode,
        viewerReloadKey,
        documentLoadLifecycleState,
        documentLoadState,
        importPreparationOverlay,
        lang,
        theme,
        viewConfig,
      }}
      sidebars={{
        previewContextRobot,
        handleSelectWithAssemblyClear,
        handleSelectGeometryWithAssemblyClear,
        handleFocus,
        handleAddChild,
        handleAddCollisionBody,
        handleDelete,
        handleNameChange,
        handleUpdate,
        showVisual,
        handleSetShowVisual,
        mergedAppMode,
        lang,
        theme,
        leftSidebarCollapsed: sidebar.leftCollapsed,
        rightSidebarCollapsed: sidebar.rightCollapsed,
        onToggleLeftSidebar: () => toggleSidebar('left'),
        onToggleRightSidebar: () => toggleSidebar('right'),
        availableFiles,
        handlePreviewFileWithFeedback,
        handleRequestLoadRobot,
        selectedFile,
        viewerSourceFilePath,
        normalizedAssemblyState,
        handleAddComponent,
        handleDeleteLibraryFile,
        handleDeleteLibraryFolder,
        handleRenameLibraryFolder,
        handleDeleteAllLibraryFiles,
        handleExportLibraryFile,
        handleCreateBridge,
        removeComponent,
        removeBridge,
        handleRenameComponent,
        handleSwitchTreeEditorToProMode,
        handleRequestSwitchTreeEditorToStructure,
        isPreviewingWorkspaceSource,
        viewConfig,
        setViewConfig,
        handleJointPreview,
        handleJointChange,
        previewFile,
        previewRobot,
        filePreview,
        viewerAssets,
        allFileContents,
        documentLoadState,
        handleClosePreview,
        propertyEditorSelectionContext,
        handleHover,
        handleUploadAsset,
        motorLibrary,
        t,
      }}
      snapshot={{
        isOpen: isSnapshotDialogOpen,
        isCapturing: isSnapshotCapturing,
        lang,
        previewSession: snapshotPreviewSession,
        onPreviewCaptureActionChange: handleSnapshotPreviewCaptureActionChange,
        onClose: handleCloseSnapshotDialog,
        onCapture: handleCaptureSnapshot,
        loadingLabel: t.loadingPanel,
      }}
      assemblyPreparation={{
        overlay: assemblyComponentPreparationOverlay,
      }}
      overlays={{
        isCodeViewerOpen,
        sourceCodeEditorDocuments,
        sourceCodeAutoApply,
        setIsCodeViewerOpen,
        theme,
        lang,
        labels: {
          loadingEditor: t.loadingEditor,
          loadingOptimizer: t.loadingOptimizer,
          loadingBridgeDialog: t.loadingBridgeDialog,
        },
        isCollisionOptimizerOpen,
        setIsCollisionOptimizerOpen,
        collisionOptimizationSource,
        viewerAssets,
        viewerSourceFilePath,
        selection,
        handlePreviewCollisionOptimizationTarget,
        handleApplyCollisionOptimization,
        normalizedAssemblyState,
        shouldRenderBridgeModal,
        isBridgeModalOpen,
        handleCloseBridgeModal,
        handleCreateBridgeCommit,
        handleBridgePreviewChange,
      }}
    />
  );
}

export default AppLayout;
