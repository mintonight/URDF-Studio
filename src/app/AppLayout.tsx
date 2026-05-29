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
import { LazyOverlayFallback } from './components/LazyOverlayFallback';
import { TreeEditor } from '@/features/robot-tree/components/TreeEditor';
import { PropertyEditor } from '@/features/property-editor/components/PropertyEditor';
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
const SnapshotDialog = lazy(() =>
  import('./components/SnapshotDialog').then((m) => ({ default: m.SnapshotDialog })),
);

import type { HeaderAction } from './components/header/types';
import { setOptionsPanelVisibility } from './components/header/viewMenuState.js';
import type { ToolMode, ViewerJointChangeContext } from '@/features/urdf-viewer/types';
import { useAppLayoutEffects } from './hooks/useAppLayoutEffects';
import { useAssemblyComponentPreparation } from './hooks/assemblyComponentPreparation';
import { useCollisionOptimizationWorkflow } from './hooks/useCollisionOptimizationWorkflow';
import { useEditableSourceCodeApply } from './hooks/useEditableSourceCodeApply';
import { useEditableSourcePatches } from './hooks/useEditableSourcePatches';
import { useLibraryFileActions } from './hooks/useLibraryFileActions';
import { usePreviewFileWithFeedback } from './hooks/usePreviewFileWithFeedback';
import { usePreparedUsdViewerAssets } from './hooks/usePreparedUsdViewerAssets';
import { useSourceCodeEditorWarmup } from './hooks/useSourceCodeEditorWarmup';
import { useToolItems } from './hooks/useToolItems';
import { useUsdDocumentLifecycle } from './hooks/useUsdDocumentLifecycle';
import { useWorkspaceAssemblyRenderFailureNotice } from './hooks/useWorkspaceAssemblyRenderFailureNotice';
import { useViewerOrchestration } from './hooks/useViewerOrchestration';
import { useWorkspaceMutations } from './hooks/useWorkspaceMutations';
import { useWorkspaceOverlayActions } from './hooks/useWorkspaceOverlayActions';
import { useWorkspaceModeTransitions } from './hooks/useWorkspaceModeTransitions';
import { useWorkspaceSourceSync } from './hooks/useWorkspaceSourceSync';
import { useWorkspaceViewerSelectionBridge } from './hooks/useWorkspaceViewerSelectionBridge';
import {
  getViewerSourceFile,
  shouldUseEmptyRobotForUsdHydration,
} from './hooks/workspaceSourceSyncUtils';
import { shouldDeferUsdStageHydrationSelectionCleanup } from './utils/usdStageHydration';
import type { ImportPreparationOverlayState } from './hooks/useFileImport';
import {
  useUIStore,
  useSelectionStore,
  useAssetsStore,
  useRobotStore,
  useAssemblySelectionStore,
  useCollisionTransformStore,
  useJointInteractionPreviewStore,
} from '@/store';
import { resolveClosedLoopDrivenJointMotion, resolveJointKey } from '@/core/robot';
import type {
  BridgeJoint,
  JointQuaternion,
  RobotData,
  RobotFile,
  UrdfJoint,
  UrdfLink,
} from '@/types';
import { translations } from '@/shared/i18n';
import {
  resolveWorkspaceOverlayGizmoMargin,
  resolveWorkspaceOverlaySafeAreaStyle,
  type WorkspaceOverlayGizmoMargin,
} from '@/shared/components/3d/scene/viewerOverlaySafeArea';
import type {
  SnapshotCaptureAction,
  SnapshotCaptureOptions,
} from '@/shared/components/3d/scene/snapshotConfig';
import type { SourceCodeEditorApplyRequest } from '@/features/code-editor/utils/sourceCodeEditorSession';
import { resolveViewerDocumentLifecycleCallbacks } from './utils/viewerDocumentLifecycleCallbacks';
import { normalizeMergedAppMode } from '@/shared/utils/appMode';
import { isAssetLibraryOnlyFormat, ROBOT_IMPORT_ACCEPT_ATTRIBUTE } from '@/shared/utils';
import { isIkDragToolEnabled } from '@/shared/utils/ikDragFeatureGate';
import { toDocumentLoadLifecycleState } from '@/store/assetsStore';
import { markUnsavedChangesBaselineSaved } from './utils/unsavedChangesBaseline';
import { buildPropertyEditorSelectionContext } from './utils/propertyEditorSelectionContext';
import { resolveDocumentLoadingOverlayTargetFileName } from './utils/documentLoadProgress';
import { clearIkDragHelperSelection } from './utils/ikDragSession';
import { resolveIkToolSelectionState } from './utils/ikToolSelectionState';
import { resolveAssemblyRootComponentSelectionAvailability } from './utils/assemblyRootComponentSelection';
import { resolveWorkspaceOverlayLayoutClassNames } from './utils/workspaceOverlayLayout';
import { resolveLibraryRobotLoadAction } from './utils/libraryRobotLoadPolicy';
import type { SnapshotPreviewSession } from './components/snapshot-preview/types';

const TREE_PANEL_JOINT_PREVIEW_SESSION_ID = 'tree-panel-joint-slider';
const TREE_PANEL_JOINT_COMMIT_EPSILON = 1e-6;

interface TreePanelJointCommitSnapshot {
  jointAngles: Record<string, number>;
  jointQuaternions: Record<string, JointQuaternion>;
}

interface ProModeRoundtripSession {
  baselineSnapshot: string;
  generatedFileName: string | null;
}

interface AppLayoutProps {
  // Import handlers (passed from App)
  importInputRef: React.RefObject<HTMLInputElement | null>;
  importFolderInputRef: React.RefObject<HTMLInputElement | null>;
  onFileDrop: (files: File[]) => void;
  onOpenExport: () => void;
  onOpenLibraryExport: (file: RobotFile) => void;
  onExportProject: () => void;
  // Toast handler
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
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
  onLoadRobot: (file: RobotFile, options?: { preserveAssemblyState?: boolean }) => void;
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
  // UI Store (grouped with useShallow to reduce subscriptions)
  const {
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
  } = useUIStore(
    useShallow((state) => ({
      appMode: state.appMode,
      lang: state.lang,
      theme: state.theme,
      sidebar: state.sidebar,
      panelLayout: state.panelLayout,
      toggleSidebar: state.toggleSidebar,
      setSidebar: state.setSidebar,
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
    updateMjcfTendon,
    setAllLinksVisibility,
    setJointAngle,
    applyJointKinematicOverrides,
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
      updateMjcfTendon: state.updateMjcfTendon,
      setAllLinksVisibility: state.setAllLinksVisibility,
      setJointAngle: state.setJointAngle,
      applyJointKinematicOverrides: state.applyJointKinematicOverrides,
    })),
  );
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
  } = useRobotStore(
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
    patchEditableSourceRenameEntities,
    setSelection,
    setPendingCollisionTransform,
    clearPendingCollisionTransform,
    handleTransformPendingChange: handleWorkspaceTransformPendingChange,
  });

  const isTreePanelJointCommitVisible = useCallback(
    (commit: TreePanelJointCommitSnapshot) =>
      Object.entries(commit.jointAngles).every(([jointId, committedAngle]) => {
        const jointName = previewContextRobot.joints[jointId]?.name;
        const motionAngle =
          jointMotionState[jointId]?.angle ??
          (jointName ? jointMotionState[jointName]?.angle : undefined);
        const snapshotAngle =
          jointAngleState[jointId] ?? (jointName ? jointAngleState[jointName] : undefined);
        const currentAngle =
          typeof motionAngle === 'number'
            ? motionAngle
            : typeof snapshotAngle === 'number'
              ? snapshotAngle
              : previewContextRobot.joints[jointId]?.angle;

        return (
          typeof currentAngle === 'number' &&
          Math.abs(currentAngle - committedAngle) <= TREE_PANEL_JOINT_COMMIT_EPSILON
        );
      }) &&
      Object.entries(commit.jointQuaternions).every(([jointId, committedQuaternion]) => {
        const jointName = previewContextRobot.joints[jointId]?.name;
        const currentQuaternion =
          jointMotionState[jointId]?.quaternion ??
          (jointName ? jointMotionState[jointName]?.quaternion : undefined) ??
          previewContextRobot.joints[jointId]?.quaternion;

        if (!currentQuaternion) {
          return false;
        }

        return (
          Math.abs(currentQuaternion.x - committedQuaternion.x) <=
            TREE_PANEL_JOINT_COMMIT_EPSILON &&
          Math.abs(currentQuaternion.y - committedQuaternion.y) <=
            TREE_PANEL_JOINT_COMMIT_EPSILON &&
          Math.abs(currentQuaternion.z - committedQuaternion.z) <=
            TREE_PANEL_JOINT_COMMIT_EPSILON &&
          Math.abs(currentQuaternion.w - committedQuaternion.w) <= TREE_PANEL_JOINT_COMMIT_EPSILON
        );
      }),
    [jointAngleState, jointMotionState, previewContextRobot.joints],
  );

  const clearTreePanelJointPreview = useCallback((deferToNextFrame = false) => {
    const clearPreview = () => {
      useJointInteractionPreviewStore.getState().clearPreview({
        source: 'tree-panel',
        dragSessionId: TREE_PANEL_JOINT_PREVIEW_SESSION_ID,
      });
    };

    if (
      deferToNextFrame &&
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      window.requestAnimationFrame(clearPreview);
      return;
    }

    clearPreview();
  }, []);

  const publishTreePanelJointPreview = useCallback(
    (jointName: string, angle: number) => {
      const jointId = resolveJointKey(previewContextRobot.joints, jointName);
      if (!jointId) {
        return null;
      }

      const solution = resolveClosedLoopDrivenJointMotion(previewContextRobot, jointId, angle);
      const preview = {
        source: 'tree-panel',
        dragSessionId: TREE_PANEL_JOINT_PREVIEW_SESSION_ID,
        activeJointId: jointId,
        jointAngles: solution.angles,
        jointQuaternions: solution.quaternions,
        jointOrigins: {},
      } as const;
      useJointInteractionPreviewStore.getState().publishPreview(preview);
      return preview;
    },
    [previewContextRobot],
  );

  const handleJointPreview = useCallback(
    (jointName: string, angle: number) => {
      publishTreePanelJointPreview(jointName, angle);
    },
    [publishTreePanelJointPreview],
  );

  const handleJointChange = useCallback(
    (jointName: string, angle: number, context?: ViewerJointChangeContext) => {
      const preview = publishTreePanelJointPreview(jointName, angle);
      if (preview) {
        pendingTreePanelJointCommitRef.current = {
          jointAngles: preview.jointAngles,
          jointQuaternions: preview.jointQuaternions,
        };
      }

      handleCommittedJointChange(jointName, angle, context);
      if (!preview) {
        clearTreePanelJointPreview(true);
        return;
      }

      const pendingCommit = pendingTreePanelJointCommitRef.current;
      if (pendingCommit && isTreePanelJointCommitVisible(pendingCommit)) {
        pendingTreePanelJointCommitRef.current = null;
        clearTreePanelJointPreview(true);
      }
    },
    [
      clearTreePanelJointPreview,
      handleCommittedJointChange,
      isTreePanelJointCommitVisible,
      publishTreePanelJointPreview,
    ],
  );

  useEffect(() => {
    const pendingCommit = pendingTreePanelJointCommitRef.current;
    if (!pendingCommit || !isTreePanelJointCommitVisible(pendingCommit)) {
      return;
    }

    pendingTreePanelJointCommitRef.current = null;
    clearTreePanelJointPreview(true);
  }, [clearTreePanelJointPreview, isTreePanelJointCommitVisible, jointAngleState, jointMotionState]);

  useEffect(
    () => () => {
      pendingTreePanelJointCommitRef.current = null;
      clearTreePanelJointPreview();
    },
    [clearTreePanelJointPreview],
  );

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

  const ensureWorkspaceSeededForAdd = useCallback(
    (targetFile: RobotFile) => {
      const currentAssemblyState = useRobotStore.getState().assemblyState;
      if (currentAssemblyState && Object.keys(currentAssemblyState.components).length > 0) {
        return;
      }

      if (!currentAssemblyState) {
        initAssembly(robotName || 'assembly');
      }

      const activeFile = selectedFile;
      if (
        !activeFile ||
        activeFile.name === targetFile.name ||
        activeFile.format === 'mesh' ||
        activeFile.format === 'asset'
      ) {
        return;
      }

      const currentRobotData: RobotData = structuredClone({
        name: robotName,
        links: robotLinks,
        joints: robotJoints,
        rootLinkId,
        materials: robotMaterials,
        closedLoopConstraints,
      });

      addComponent(activeFile, {
        availableFiles,
        assets,
        allFileContents,
        preResolvedImportResult: {
          status: 'ready',
          format: activeFile.format,
          robotData: currentRobotData,
          resolvedUrdfContent: null,
          resolvedUrdfSourceFilePath: null,
        },
        queueAutoGround: false,
      });
    },
    [
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
    ],
  );

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
  const sourceCodeEditorDocuments = useMemo(
    () =>
      sourceCodeDocuments.map((document) => ({
        id: document.id,
        code: document.content,
        fileName: document.fileName,
        tabLabel: document.tabLabel,
        filePath: document.filePath ?? undefined,
        contentUrl: document.contentUrl,
        documentFlavor: document.documentFlavor,
        readOnly: document.readOnly,
        validationEnabled: document.validationEnabled,
        onCodeChange: (newCode: string, applyRequest?: SourceCodeEditorApplyRequest) =>
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

  const handleSnapshot = useCallback(async () => {
    const viewerCanvasState = viewerCanvasStateRef.current;
    let cameraSnapshot: SnapshotPreviewSession['cameraSnapshot'] = null;
    if (viewerCanvasState) {
      try {
        const { captureWorkspaceCameraSnapshot } = await import(
          '@/shared/components/3d/workspace/workspaceCameraSnapshot'
        );
        cameraSnapshot = captureWorkspaceCameraSnapshot(viewerCanvasState);
      } catch (error) {
        console.error('[AppLayout] Failed to capture workspace camera snapshot:', error);
      }
    }
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
    if (!isIkDragToolEnabled()) {
      handleSetIkDragActive(false);
      return;
    }

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
    shouldDeferSelectionCleanup,
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

  const handleRequestLoadRobot = useCallback(
    async (
      file: RobotFile,
      intent: 'direct' | 'preview' | 'discard',
    ): Promise<'loaded' | 'needs-preview-or-discard-confirm' | 'blocked'> => {
      if (selectedFile?.name === file.name) {
        return 'loaded';
      }

      const loadAction = resolveLibraryRobotLoadAction({
        selectedFileName: selectedFile?.name,
        targetFileName: file.name,
        shouldPreviewCurrentState: shouldPreviewLibraryRobotLoad,
        hasSimpleModeSourceEdits,
        intent,
      });

      if (loadAction === 'already-loaded') {
        return 'loaded';
      }

      if (loadAction === 'preview') {
        handlePreviewFileWithFeedback(file);
        return 'loaded';
      }

      if (loadAction === 'load') {
        onLoadRobot(file);
        return 'loaded';
      }

      if (loadAction === 'needs-preview-or-discard-confirm') {
        return 'needs-preview-or-discard-confirm';
      }

      return 'blocked';
    },
    [
      handlePreviewFileWithFeedback,
      hasSimpleModeSourceEdits,
      onLoadRobot,
      selectedFile,
      shouldPreviewLibraryRobotLoad,
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
      <div className={workspaceLayoutClassNames.root}>
        {/* Viewer Container — fills the workspace while sidebars cover it, so sidebar width
            changes do not resize or stretch the Three.js canvas. */}
        <div
          className={workspaceLayoutClassNames.viewerLayer}
          style={workspaceOverlaySafeAreaStyle}
        >
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
              onDocumentLoadEvent={viewerDocumentLifecycleCallbacks.onDocumentLoadEvent}
              onRuntimeRobotLoaded={viewerDocumentLifecycleCallbacks.onRuntimeRobotLoaded}
              onRuntimeSceneReadyForDisplay={
                viewerDocumentLifecycleCallbacks.onRuntimeSceneReadyForDisplay
              }
              jointAngleState={jointAngleState}
              jointMotionState={jointMotionState}
              onJointChange={handleJointChange}
              syncJointChangesToApp
              selection={selection}
              focusTarget={focusTarget}
              isMeshPreview={selectedFile?.format === 'mesh'}
              onTransformPendingChange={handleWorkspaceTransformPendingChange}
              onCollisionTransform={handleCollisionTransform}
              assemblyState={normalizedAssemblyState}
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
              gizmoMargin={workspaceOverlayGizmoMargin}
            />
          </Suspense>
          <ConnectedDocumentLoadingOverlay
            lang={lang}
            targetFileName={resolveDocumentLoadingOverlayTargetFileName({
              previewFileName: null,
              selectedFileName: selectedFile?.name ?? null,
              suppressDocumentLoadingOverlay:
                shouldRenderAssembly || Boolean(assemblyComponentPreparationOverlay),
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

        <div className={workspaceLayoutClassNames.leftSidebarLayer}>
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
              assemblyState={normalizedAssemblyState}
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
            onJointAnglePreview={handleJointPreview}
            onJointAngleChange={handleJointChange}
          />
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
          showVisual={showVisual}
          onClose={handleClosePreview}
          onAddComponent={handleAddComponent}
        />

        <div className={workspaceLayoutClassNames.rightSidebarLayer}>
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
      </div>

      {isSnapshotDialogOpen ? (
        <Suspense fallback={<LazyOverlayFallback label={t.loadingPanel} />}>
          <SnapshotDialog
            isOpen={isSnapshotDialogOpen}
            isCapturing={isSnapshotCapturing}
            lang={lang}
            previewSession={snapshotPreviewSession}
            onPreviewCaptureActionChange={handleSnapshotPreviewCaptureActionChange}
            onClose={handleCloseSnapshotDialog}
            onCapture={handleCaptureSnapshot}
          />
        </Suspense>
      ) : null}

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
        assemblyState={normalizedAssemblyState}
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
