/**
 * App Layout Component
 * Main application layout with Header and workspace area
 */
import React, { useRef, useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import type { RootState } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import { Header } from './components/Header';
import { IkToolPanel } from './components/IkToolPanel';
import { AppLayoutOverlays } from './components/AppLayoutOverlays';
import { ConnectedDocumentLoadingOverlay } from './components/ConnectedDocumentLoadingOverlay';
import { FilePreviewWindow } from './components/FilePreviewWindow';
import { FileDropOverlay } from './components/FileDropOverlay';
import { ImportPreparationOverlay } from './components/ImportPreparationOverlay';
import { SnapshotDialog } from './components/SnapshotDialog';
import { resolveSnapshotCaptureAction } from './components/snapshot-preview/resolveSnapshotCaptureAction';
import {
  loadBridgeCreateModalModule,
  loadCollisionOptimizationDialogModule,
} from './utils/overlayLoaders';
import { preloadSourceCodeEditorRuntime } from './utils/sourceCodeEditorLoader';

// Lazy load heavy 3D viewer component
const UnifiedViewer = lazy(() =>
  import('./components/UnifiedViewer').then((m) => ({ default: m.UnifiedViewer })),
);

// Prefetch UnifiedViewer when AppLayout is loaded to reduce perceived latency
const prefetchUnifiedViewer = () => import('./components/UnifiedViewer');

import type { HeaderAction } from './components/header/types';
import { setOptionsPanelVisibility } from './components/header/viewMenuState.js';
import { TreeEditor } from '@/features/robot-tree';
import { PropertyEditor } from '@/features/property-editor';
import { type ToolMode } from '@/features/editor';
import {
  useAppLayoutEffects,
  useAssemblyComponentPreparation,
  useCollisionOptimizationWorkflow,
  useEditableSourceCodeApply,
  useEditableSourcePatches,
  useLibraryFileActions,
  usePreviewFileWithFeedback,
  usePreparedUsdViewerAssets,
  useSourceCodeEditorWarmup,
  useToolItems,
  useUsdDocumentLifecycle,
  useWorkspaceAssemblyRenderFailureNotice,
  useViewerOrchestration,
  useWorkspaceMutations,
  useWorkspaceOverlayActions,
  useWorkspaceModeTransitions,
  useWorkspaceSourceSync,
  useWorkspaceViewerSelectionBridge,
} from './hooks';
import {
  getViewerSourceFile,
  shouldUseEmptyRobotForUsdHydration,
} from './hooks/workspaceSourceSyncUtils';
import type { ImportPreparationOverlayState } from './hooks/useFileImport';
import {
  useUIStore,
  useSelectionStore,
  useAssetsStore,
  useRobotStore,
  useAssemblyStore,
  useAssemblySelectionStore,
  useCollisionTransformStore,
} from '@/store';
import type { BridgeJoint, RobotFile, UrdfJoint, UrdfLink } from '@/types';
import { translations } from '@/shared/i18n';
import {
  captureWorkspaceCameraSnapshot,
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
} from '@/shared/components/3d';
import { normalizeMergedAppMode } from '@/shared/utils/appMode';
import { isAssetLibraryOnlyFormat, ROBOT_IMPORT_ACCEPT_ATTRIBUTE } from '@/shared/utils';
import { toDocumentLoadLifecycleState } from '@/store/assetsStore';
import { markUnsavedChangesBaselineSaved } from './utils/unsavedChangesBaseline';
import { buildPropertyEditorSelectionContext } from './utils/propertyEditorSelectionContext';
import { resolveDocumentLoadingOverlayTargetFileName } from './utils/documentLoadProgress';
import { clearIkDragHelperSelection } from './utils/ikDragSession';
import { resolveIkToolSelectionState } from './utils/ikToolSelectionState';
import { resolveAssemblyRootComponentSelectionAvailability } from './utils/assemblyRootComponentSelection';
import { buildSimpleModeDraftFile } from './utils/simpleModeDrafts';
import type { SnapshotPreviewSession } from './components/snapshot-preview/types';

interface ProModeRoundtripSession {
  baselineSnapshot: string;
  generatedFileName: string | null;
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
  onOpenAIInspection: () => void;
  onOpenAIConversation: () => void;
  isCodeViewerOpen: boolean;
  setIsCodeViewerOpen: (open: boolean) => void;
  onOpenSettings: () => void;
  headerQuickAction?: HeaderAction;
  headerSecondaryAction?: HeaderAction;
  // View config
  viewConfig: {
    showOptionsPanel: boolean;
    showJointPanel: boolean;
  };
  setViewConfig: React.Dispatch<
    React.SetStateAction<{
      showOptionsPanel: boolean;
      showJointPanel: boolean;
    }>
  >;
  // Robot file handling
  onLoadRobot: (file: RobotFile) => void;
  viewerReloadKey: number;
  importPreparationOverlay?: ImportPreparationOverlayState | null;
  /** Called once layout handlers are ready, so the parent can expose them externally */
  onExposeLayoutActions?: (actions: {
    openIkTool: () => void;
    openCollisionOptimizer: () => void;
    openTool: (key: string) => void;
  }) => void;
}

export function AppLayout({
  importInputRef,
  importFolderInputRef,
  onFileDrop,
  onOpenExport,
  onOpenLibraryExport,
  onExportProject,
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
  useEffect(() => {
    prefetchUnifiedViewer();
    // Warm up the code editor too as it's a common next step
    preloadSourceCodeEditorRuntime();
  }, []);

  // UI Store (grouped with useShallow to reduce subscriptions)
  const {
    appMode,
    lang,
    theme,
    sidebar,
    toggleSidebar,
    setSidebar,
    sidebarTab,
    sourceCodeAutoApply,
    setViewOption,
    groundPlaneOffset,
  } = useUIStore(
    useShallow((state) => ({
      appMode: state.appMode,
      lang: state.lang,
      theme: state.theme,
      sidebar: state.sidebar,
      toggleSidebar: state.toggleSidebar,
      setSidebar: state.setSidebar,
      sidebarTab: state.sidebarTab,
      sourceCodeAutoApply: state.sourceCodeAutoApply,
      setViewOption: state.setViewOption,
      groundPlaneOffset: state.groundPlaneOffset,
    })),
  );

  // Responsive sidebar effect
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      // Use a ref-like approach to only trigger when crossing thresholds
      // to avoid fighting with user manual toggles on every pixel change
      if (width < 1024) {
        if (!sidebar.leftCollapsed) setSidebar('left', true);
        if (!sidebar.rightCollapsed) setSidebar('right', true);
      } else if (width < 1200) {
        if (!sidebar.rightCollapsed) setSidebar('right', true);
      }
    };

    // Run once on mount
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setSidebar]); // Minimal dependencies to prevent loops
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
    usdPreparedExportCaches,
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
      usdPreparedExportCaches: state.usdPreparedExportCaches,
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
  const viewerCanvasStateRef = useRef<RootState | null>(null);
  const transformPendingRef = useRef(false);
  const pendingUsdAssemblyFileRef = useRef<RobotFile | null>(null);
  const proModeRoundtripSessionRef = useRef<ProModeRoundtripSession | null>(null);
  const [pendingViewerToolMode, setPendingViewerToolMode] = useState<ToolMode | null>(null);
  const [ikDragActive, setIkDragActive] = useState(false);
  const [workspaceTransformPending, setWorkspaceTransformPending] = useState(false);
  const [isBridgeModalOpen, setIsBridgeModalOpen] = useState(false);
  const [isCollisionOptimizerOpen, setIsCollisionOptimizerOpen] = useState(false);
  const [isSnapshotDialogOpen, setIsSnapshotDialogOpen] = useState(false);
  const [isSnapshotCapturing, setIsSnapshotCapturing] = useState(false);
  const [snapshotPreviewSession, setSnapshotPreviewSession] =
    useState<SnapshotPreviewSession | null>(null);
  const snapshotPreviewCaptureActionRef = useRef<SnapshotCaptureAction | null>(null);
  const [isIkToolPanelOpen, setIsIkToolPanelOpen] = useState(false);
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
    sourceCodeDocuments,
    hasSimpleModeSourceEdits,
    draftUrdfContent,
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
    workspaceTransformPending,
    sidebarTab,
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
    assemblyState,
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
  const selectedFileDraftSourceContent = useMemo(() => {
    if (!selectedFile) {
      return null;
    }

    return (
      sourceCodeDocuments.find((document) => document.filePath === selectedFile.name)?.content ??
      selectedFile.content
    );
  }, [selectedFile, sourceCodeDocuments]);

  const preparedAssetSourceFiles = useMemo(
    () =>
      [selectedFile, previewFile].filter((file): file is RobotFile =>
        Boolean(file && file.format === 'usd'),
      ),
    [previewFile, selectedFile],
  );

  const viewerAssets = usePreparedUsdViewerAssets({
    assemblyState,
    assets,
    availableFiles,
    additionalSourceFiles: preparedAssetSourceFiles,
    preparedExportCaches: usdPreparedExportCaches,
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
    handleRobotDataResolved,
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
  const ikToolSelectionState = useMemo(
    () =>
      resolveIkToolSelectionState({
        selection,
        ikDragActive,
        robotLinks: previewContextRobot.links,
        robotJoints: previewContextRobot.joints,
        rootLinkId: previewContextRobot.rootLinkId,
      }),
    [
      ikDragActive,
      previewContextRobot.joints,
      previewContextRobot.links,
      previewContextRobot.rootLinkId,
      selection,
    ],
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
  const {
    handleWorkspaceTransformPendingChange,
    handleViewerSelectWithBridgePreview,
    handleSelectWithAssemblyClear,
    handleSelectGeometryWithAssemblyClear,
    handleViewerMeshSelectWithAssemblyClear,
  } = useWorkspaceViewerSelectionBridge({
    assemblyState,
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
    patchEditableSourceUpdateJointLimit,
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
    patchEditableSourceUpdateJointLimit,
    patchEditableSourceRenameEntities,
    setSelection,
    setPendingCollisionTransform,
    clearPendingCollisionTransform,
    handleTransformPendingChange: handleWorkspaceTransformPendingChange,
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
  const sourceCodeEditorDocuments = useMemo(
    () =>
      sourceCodeDocuments.map((document) => ({
        id: document.id,
        code: document.content,
        fileName: document.fileName,
        tabLabel: document.tabLabel,
        filePath: document.filePath ?? undefined,
        documentFlavor: document.documentFlavor,
        readOnly: document.readOnly,
        validationEnabled: document.validationEnabled,
        onCodeChange: (newCode: string, applyRequest) =>
          handleCodeChange(newCode, document.changeTarget, applyRequest),
        onDownload: document.readOnly
          ? undefined
          : () => {
              markUnsavedChangesBaselineSaved('robot');
            },
      })),
    [handleCodeChange, sourceCodeDocuments],
  );

  const viewerSourceFile = useMemo(
    () =>
      getViewerSourceFile({
        selectedFile,
        shouldRenderAssembly,
        workspaceSourceFile: workspaceViewerMjcfSourceFile,
      }),
    [selectedFile, shouldRenderAssembly, workspaceViewerMjcfSourceFile],
  );

  const handleCloseSnapshotDialog = useCallback(() => {
    setIsSnapshotDialogOpen(false);
    setSnapshotPreviewSession(null);
    snapshotPreviewCaptureActionRef.current = null;
  }, []);

  const handleSnapshotPreviewCaptureActionChange = useCallback(
    (action: SnapshotCaptureAction | null) => {
      snapshotPreviewCaptureActionRef.current = action;
    },
    [],
  );

  const handleSnapshot = useCallback(() => {
    const viewerCanvasState = viewerCanvasStateRef.current;
    const cameraSnapshot = viewerCanvasState
      ? captureWorkspaceCameraSnapshot(viewerCanvasState)
      : null;
    const viewportAspectRatio =
      cameraSnapshot?.aspectRatio ??
      (viewerCanvasState?.size.width && viewerCanvasState.size.height
        ? viewerCanvasState.size.width / viewerCanvasState.size.height
        : 16 / 9);

    snapshotPreviewCaptureActionRef.current = null;
    setSnapshotPreviewSession({
      theme,
      cameraSnapshot,
      viewportAspectRatio,
      robotName: viewerRobot.name || 'robot',
      robot: viewerRobot,
      assets: viewerAssets,
      availableFiles,
      urdfContent: urdfContentForViewer,
      viewerSourceFormat,
      sourceFilePath: viewerSourceFilePath,
      sourceFile: viewerSourceFile,
      jointAngleState,
      jointMotionState,
      showVisual,
      isMeshPreview: selectedFile?.format === 'mesh',
      viewerReloadKey,
      groundPlaneOffset,
    });
    setIsSnapshotDialogOpen(true);
  }, [
    availableFiles,
    groundPlaneOffset,
    jointAngleState,
    jointMotionState,
    selectedFile?.format,
    showVisual,
    theme,
    urdfContentForViewer,
    viewerAssets,
    viewerReloadKey,
    viewerRobot,
    viewerSourceFile,
    viewerSourceFilePath,
    viewerSourceFormat,
  ]);

  const handleSetIkDragActive = useCallback(
    (active: boolean) => {
      setIkDragActive(active);

      if (active) {
        setViewOption('showIkHandles', true);
        return;
      }

      setViewOption('showIkHandles', false);
      setIsIkToolPanelOpen(false);
      const clearedSelection = clearIkDragHelperSelection(selection);
      if (clearedSelection) {
        setSelection(clearedSelection);
      }
    },
    [selection, setSelection, setViewOption],
  );

  const handleOpenIkTool = useCallback(() => {
    handleSetIkDragActive(true);
    setIsIkToolPanelOpen(true);
  }, [handleSetIkDragActive]);

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

  const handleIkDragActiveChange = useCallback(
    (active: boolean) => {
      handleSetIkDragActive(active);
    },
    [handleSetIkDragActive],
  );

  const handleCaptureSnapshot = useCallback(
    async (options: SnapshotCaptureOptions) => {
      const captureAction = resolveSnapshotCaptureAction({
        liveCaptureAction: snapshotActionRef.current,
        frozenPreviewCaptureAction: snapshotPreviewCaptureActionRef.current,
        preferFrozenPreviewCapture: Boolean(snapshotPreviewSession),
      });

      if (!captureAction) {
        showToast(t.snapshotFailed, 'info');
        return;
      }

      try {
        setIsSnapshotCapturing(true);
        await captureAction({
          ...options,
          cameraSnapshot: snapshotPreviewSession?.cameraSnapshot ?? null,
        });
      } catch (error) {
        console.error('Snapshot failed:', error);
        showToast(t.snapshotFailed, 'info');
      } finally {
        setIsSnapshotCapturing(false);
      }
    },
    [handleCloseSnapshotDialog, showToast, snapshotPreviewSession, t],
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

  const { handlePreviewFileWithFeedback } = usePreviewFileWithFeedback({
    allFileContents,
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

  const handleRequestLoadRobot = useCallback(
    async (
      file: RobotFile,
      intent: 'direct' | 'save-draft' | 'discard',
    ): Promise<'loaded' | 'needs-draft-confirm' | 'blocked'> => {
      if (selectedFile?.name === file.name) {
        return 'loaded';
      }

      const shouldGuardLibrarySwitch =
        sidebarTab === 'structure' &&
        !shouldRenderAssembly &&
        Boolean(selectedFile) &&
        hasSimpleModeSourceEdits;

      if (!shouldGuardLibrarySwitch || intent === 'discard') {
        onLoadRobot(file);
        return 'loaded';
      }

      if (intent === 'direct') {
        return 'needs-draft-confirm';
      }

      if (!selectedFile) {
        return 'blocked';
      }

      const fallbackStandaloneDraftUrdfContent =
        selectedFile.format === 'mjcf'
          ? draftUrdfContent
          : (draftUrdfContent ?? urdfContentForViewer);
      const draftFile = buildSimpleModeDraftFile({
        selectedFile,
        currentSourceContent: selectedFileDraftSourceContent,
        fallbackUrdfContent: fallbackStandaloneDraftUrdfContent,
        availableFiles,
      });

      if (!draftFile) {
        showToast(t.simpleModeDraftSaveFailed, 'info');
        return 'blocked';
      }

      const existingDraftIndex = availableFiles.findIndex((entry) => entry.name === draftFile.name);
      const nextAvailableFiles =
        existingDraftIndex === -1
          ? [...availableFiles, draftFile]
          : availableFiles.map((entry, index) =>
              index === existingDraftIndex ? draftFile : entry,
            );
      setAvailableFiles(nextAvailableFiles);
      setAllFileContents({
        ...allFileContents,
        [draftFile.name]: draftFile.content,
      });
      markUnsavedChangesBaselineSaved('robot');
      showToast(
        t.simpleModeDraftSaved.replace('{name}', draftFile.name.split('/').pop() || draftFile.name),
        'success',
      );

      onLoadRobot(file);
      return 'loaded';
    },
    [
      allFileContents,
      availableFiles,
      draftUrdfContent,
      hasSimpleModeSourceEdits,
      onLoadRobot,
      selectedFile,
      selectedFileDraftSourceContent,
      setAllFileContents,
      setAvailableFiles,
      shouldRenderAssembly,
      showToast,
      sidebarTab,
      t.simpleModeDraftSaveFailed,
      t.simpleModeDraftSaved,
      urdfContentForViewer,
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
        toolboxItems={toolboxItems}
        onOpenCodeViewer={handleOpenCodeViewer}
        onPrefetchCodeViewer={handlePrefetchCodeViewer}
        onOpenSettings={onOpenSettings}
        quickAction={headerQuickAction}
        secondaryAction={headerSecondaryAction}
        onSnapshot={handleSnapshot}
        viewConfig={viewConfig}
        viewAvailability={{ jointPanel: true }}
        setViewConfig={setViewConfig}
      />

      <IkToolPanel
        show={isIkToolPanelOpen}
        t={t}
        selectedLinkLabel={selectedIkLinkLabel}
        currentLinkLabel={currentIkLinkLabel}
        selectionStatus={ikToolSelectionState.status}
        onClose={() => handleIkDragActiveChange(false)}
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
          onLoadRobot={handlePreviewFileWithFeedback}
          onRequestLoadRobot={handleRequestLoadRobot}
          currentFileName={selectedFile?.name}
          sourceFilePath={viewerSourceFilePath}
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
          showJointPanel={viewConfig.showJointPanel}
          onJointAngleChange={handleJointChange}
        />

        {/* Viewer Container — z-0 stacking context keeps floating panels below sidebars (z-20);
            overflow-hidden prevents panels from being dragged outside the 3D view area. */}
        <div className="flex-1 relative z-0 min-w-0 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex-1 h-full bg-google-light-bg dark:bg-app-bg animate-pulse" />
            }
          >
            <UnifiedViewer
              robot={viewerRobot}
              editorRobot={robot}
              mode={mergedAppMode}
              onSelect={handleViewerSelectWithBridgePreview}
              onMeshSelect={handleViewerMeshSelectWithAssemblyClear}
              onHover={handleHover}
              onUpdate={handleUpdate}
              assets={viewerAssets}
              allFileContents={allFileContents}
              lang={lang}
              theme={theme}
              showVisual={showVisual}
              setShowVisual={handleSetShowVisual}
              snapshotAction={snapshotActionRef}
              onCanvasCreated={(state) => {
                viewerCanvasStateRef.current = state;
              }}
              showOptionsPanel={viewConfig.showOptionsPanel}
              setShowOptionsPanel={handleSetDetailOptionsPanelVisibility}
              showJointPanel={false}
              availableFiles={availableFiles}
              urdfContent={urdfContentForViewer}
              viewerSourceFormat={viewerSourceFormat}
              sourceFilePath={viewerSourceFilePath}
              sourceFile={viewerSourceFile}
              onRobotDataResolved={handleRobotDataResolved}
              onDocumentLoadEvent={handleViewerDocumentLoadEvent}
              onRuntimeRobotLoaded={handleViewerRuntimeRobotLoaded}
              onRuntimeSceneReadyForDisplay={handleViewerRuntimeSceneReadyForDisplay}
              jointAngleState={jointAngleState}
              jointMotionState={jointMotionState}
              onJointChange={handleJointChange}
              syncJointChangesToApp
              selection={robot.selection}
              focusTarget={focusTarget}
              isMeshPreview={selectedFile?.format === 'mesh'}
              onTransformPendingChange={handleWorkspaceTransformPendingChange}
              onCollisionTransform={handleCollisionTransform}
              assemblyState={assemblyState}
              assemblyWorkspaceActive={shouldRenderAssembly}
              assemblySelection={assemblySelection}
              sourceSceneAssemblyComponentId={sourceSceneAssemblyComponentId}
              onAssemblyTransform={handleAssemblyTransform}
              onComponentTransform={handleComponentTransform}
              onBridgeTransform={handleBridgeTransform}
              ikDragActive={ikDragActive}
              pendingViewerToolMode={pendingViewerToolMode}
              onConsumePendingViewerToolMode={() => setPendingViewerToolMode(null)}
              viewerReloadKey={viewerReloadKey}
              documentLoadState={documentLoadLifecycleState}
            />
          </Suspense>
          <ConnectedDocumentLoadingOverlay
            lang={lang}
            targetFileName={resolveDocumentLoadingOverlayTargetFileName({
              previewFileName: null,
              selectedFileName: selectedFile?.name ?? null,
              documentLoadState,
            })}
          />
          {importPreparationOverlay ? (
            <ImportPreparationOverlay
              label={importPreparationOverlay.label}
              detail={importPreparationOverlay.detail}
              progress={importPreparationOverlay.progress}
              statusLabel={importPreparationOverlay.statusLabel}
              stageLabel={importPreparationOverlay.stageLabel}
              placement="viewer-corner"
            />
          ) : null}
        </div>
        <FilePreviewWindow
          file={previewFile}
          previewRobot={previewRobot}
          previewState={filePreview}
          assets={viewerAssets}
          allFileContents={allFileContents}
          availableFiles={availableFiles}
          documentLoadState={documentLoadState}
          lang={lang}
          theme={theme}
          onClose={handleClosePreview}
          onAddComponent={sidebarTab === 'workspace' ? handleAddComponent : undefined}
        />

        <PropertyEditor
          robot={propertyEditorSelectionContext.robot}
          onUpdate={handleUpdate}
          onSelect={handleSelectWithAssemblyClear}
          onSelectGeometry={handleSelectGeometryWithAssemblyClear}
          onAddCollisionBody={handleAddCollisionBody}
          onHover={handleHover}
          mode={mergedAppMode}
          assets={viewerAssets}
          onUploadAsset={handleUploadAsset}
          motorLibrary={motorLibrary}
          lang={lang}
          theme={theme}
          collapsed={sidebar.rightCollapsed}
          onToggle={() => toggleSidebar('right')}
          readOnlyMessage={isPreviewingWorkspaceSource ? t.previewReadOnlyHint : undefined}
          jointTypeLocked={Boolean(propertyEditorSelectionContext.selectedClosedLoopBridge)}
          sourceFilePath={viewerSourceFilePath}
        />
      </div>

      <SnapshotDialog
        isOpen={isSnapshotDialogOpen}
        isCapturing={isSnapshotCapturing}
        lang={lang}
        previewSession={snapshotPreviewSession}
        onPreviewCaptureActionChange={handleSnapshotPreviewCaptureActionChange}
        onClose={handleCloseSnapshotDialog}
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
        sourceCodeDocuments={sourceCodeEditorDocuments}
        autoApplyEnabled={sourceCodeAutoApply}
        onCloseCodeViewer={() => setIsCodeViewerOpen(false)}
        theme={theme}
        lang={lang}
        loadingEditorLabel={t.loadingEditor}
        isCollisionOptimizerOpen={isCollisionOptimizerOpen}
        loadingOptimizerLabel={t.loadingOptimizer}
        collisionOptimizationSource={collisionOptimizationSource}
        assets={viewerAssets}
        sourceFilePath={viewerSourceFilePath}
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
