/**
 * App Layout Component
 * Main application layout with Header and workspace area
 */
import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
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
  SnapshotPreviewAction,
} from '@/shared/components/3d/scene/snapshotConfig';
import {
  captureWorkspaceCameraSnapshot,
  type WorkspaceCameraSnapshot,
} from '@/shared/components/3d';
import { resolveViewerDocumentLifecycleCallbacks } from './utils/viewerDocumentLifecycleCallbacks';
import { normalizeMergedAppMode } from '@/shared/utils/appMode';
import { resolveAssemblyRootComponentSelectionAvailability } from './utils/assemblyRootComponentSelection';
import type { SnapshotPreviewSession } from './components/snapshot-preview/types';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';
import { isRegressionDebugEnabled } from '@/shared/debug/regressionDebugEnabled';

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
    collisionTransformStore: { setPendingCollisionTransform, clearPendingCollisionTransform },
  } = useAppLayoutStoreSlices();

  useResponsiveSidebarCollapse({ sidebar, setSidebar });
  const mergedAppMode = normalizeMergedAppMode(appMode);
  const t = translations[lang];
  const normalizedAssemblyState = assemblyState ?? null;

  const snapshotActionRef = useRef<
    ((options?: Partial<SnapshotCaptureOptions>) => Promise<void>) | null
  >(null);
  // previewActionRef feeds SnapshotManager's preview pipeline (off-screen render
  // target, supersampling, background fill) and is exposed to automation via the
  // regression debug API as `captureSnapshot` (see effect below). Unlike
  // snapshotAction (which downloads), preview returns a blob for programmatic use.
  const previewActionRef = useRef<SnapshotPreviewAction | null>(null);

  // Expose captureSnapshot on the regression debug API so batch automation
  // (scripts/batch-export-thumbnails.mjs) can capture the current scene via
  // SnapshotManager's preview pipeline (off-screen render target, supersampling,
  // background fill). The debug API is installed asynchronously by
  // useRegressionDebugApi (App.tsx), so poll until it appears, then attach.
  useEffect(() => {
    if (typeof window === 'undefined' || !isRegressionDebugEnabled(window)) {
      return;
    }

    let disposed = false;

    const blobToBase64 = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onloadend = () => {
          const result = reader.result;
          if (typeof result !== 'string') {
            reject(new Error('FileReader did not return a data URL'));
            return;
          }
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(blob);
      });

    const attach = () => {
      if (disposed) {
        return;
      }
      const api = window.__URDF_STUDIO_DEBUG__;
      if (!api) {
        window.setTimeout(attach, 100);
        return;
      }
      api.captureSnapshot = async (options) => {
        const action = previewActionRef.current;
        if (!action) {
          return { ok: false, base64: null, width: 0, height: 0, format: 'png' };
        }
        try {
          const result = await action(options);
          return {
            ok: true,
            base64: await blobToBase64(result.blob),
            width: result.width,
            height: result.height,
            format: result.options.imageFormat,
          };
        } catch (error) {
          logRegressionError('[AppLayout] captureSnapshot failed', error);
          return { ok: false, base64: null, width: 0, height: 0, format: 'png' };
        }
      };
      // Dolly the active camera toward the orbit target. Used by batch
      // thumbnail automation to tighten or loosen the auto-framed view before
      // capture. Reads the live R3F state (camera + controls.target) captured
      // by onCanvasCreated; OrbitControls has damping disabled, so a direct
      // position write survives until the off-screen capture clones the camera.
      api.setCameraZoom = (factor: number): { ok: boolean } => {
        const state = viewerCanvasStateRef.current;
        if (!state?.camera || !Number.isFinite(factor) || factor <= 0) {
          return { ok: false };
        }
        const controls = state.controls as { target?: THREE.Vector3 } | undefined;
        const target = controls?.target
          ? new THREE.Vector3(controls.target.x, controls.target.y, controls.target.z)
          : new THREE.Vector3(0, 0, 0);
        state.camera.position.lerp(target, 1 - 1 / factor);
        state.camera.updateMatrixWorld();
        state.invalidate?.();
        return { ok: true };
      };
      // Re-frame onto the unioned robot-mesh bounding box, skipping the flat
      // ground plane. Used before captureSnapshot for SDF (and other) assets
      // whose cameraFollowPrimary did not converge — without it the robot can
      // render off-frame and the thumbnail comes out blank.
      api.frameScene = (): {
        ok: boolean;
        meshCount?: number;
        center?: number[];
        size?: number[];
        camPos?: number[];
        cameraSnapshot?: WorkspaceCameraSnapshot | null;
      } => {
        const state = viewerCanvasStateRef.current;
        if (!state?.scene || !state.camera) {
          return { ok: false };
        }
        const box = new THREE.Box3();
        let robotMeshCount = 0;
        state.scene.traverse((obj: THREE.Object3D) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry) {
            return;
          }
          mesh.updateMatrixWorld(true);
          const meshBox = new THREE.Box3().setFromObject(mesh);
          if (meshBox.isEmpty()) {
            return;
          }
          const size = new THREE.Vector3();
          meshBox.getSize(size);
          // Skip scene helpers (ground plane, shadow catcher, grid, gizmos) by
          // name first — GroundShadowPlane / ReferenceGrid / axes report huge
          // 20x20 footprints that would otherwise dwarf the robot bbox.
          const helperName = (mesh.name || (mesh.parent?.name ?? '') || '').toLowerCase();
          if (
            helperName.includes('ground') ||
            helperName.includes('grid') ||
            helperName.includes('shadow') ||
            helperName.includes('axes') ||
            helperName.includes('gizmo') ||
            helperName.includes('plane')
          ) {
            return;
          }
          const maxHorizontal = Math.max(size.x, size.z);
          // Fallback: drop any broad, relatively-thin slab (an unnamed ground).
          if (maxHorizontal > 1 && size.y < maxHorizontal * 0.1) {
            return;
          }
          box.union(meshBox);
          robotMeshCount += 1;
        });
        if (robotMeshCount === 0) {
          return { ok: false, meshCount: 0 };
        }
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const camera = state.camera as THREE.PerspectiveCamera;
        const controls = state.controls as
          | { target?: THREE.Vector3; update?: () => void }
          | undefined;
        if (controls?.target) {
          controls.target.set(center.x, center.y, center.z);
          controls.update?.();
        }
        const fov = camera.fov ? THREE.MathUtils.degToRad(camera.fov) : Math.PI / 4;
        const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.5;
        const dir = new THREE.Vector3();
        if (controls?.target) {
          dir.subVectors(camera.position, controls.target);
        }
        if (dir.lengthSq() === 0) {
          dir.set(0.7, 0.5, 1);
        }
        dir.normalize();
        camera.position.copy(center).addScaledVector(dir, distance);
        // OrbitControls.update() ran against the *previous* camera position, so
        // the cloned camera's quaternion may not actually face `center` after
        // we repositioned. Force a lookAt so the bbox center is the view axis.
        camera.lookAt(center);
        camera.updateMatrixWorld();
        state.invalidate?.();
        // Snapshot the workspace camera synchronously — in the same tick, before
        // any animation frame runs — so callers (batch thumbnail automation) can
        // pass it to captureSnapshot and lock this framing onto the off-screen
        // capture camera. Without it, cameraFollowPrimary's per-frame update
        // reverts frameScene during the capture warmup frames for SDF assets
        // whose auto-frame does not converge, leaving the robot off-frame.
        const glDomElement = state.gl?.domElement ?? null;
        const cameraSnapshot = captureWorkspaceCameraSnapshot(
          state,
          glDomElement?.parentElement ?? glDomElement,
        );
        return {
          ok: true,
          meshCount: robotMeshCount,
          center: [
            Number(center.x.toFixed(3)),
            Number(center.y.toFixed(3)),
            Number(center.z.toFixed(3)),
          ],
          size: [Number(size.x.toFixed(3)), Number(size.y.toFixed(3)), Number(size.z.toFixed(3))],
          camPos: [
            Number(camera.position.x.toFixed(3)),
            Number(camera.position.y.toFixed(3)),
            Number(camera.position.z.toFixed(3)),
          ],
          cameraSnapshot,
        };
      };
    };

    attach();

    return () => {
      disposed = true;
      const api = window.__URDF_STUDIO_DEBUG__;
      if (api) {
        delete api.captureSnapshot;
        delete api.setCameraZoom;
        delete api.frameScene;
      }
    };
  }, []);

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
  }, [assemblySelection.id, assemblySelection.type, assemblyState, clearAssemblySelection]);

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
  const { ikDragActive, isIkToolPanelOpen, handleIkDragActiveChange, handleOpenIkTool } =
    useIkDragPanelActions({
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

  const { handleCloseSnapshotDialog, handleSnapshotPreviewCaptureActionChange, handleSnapshot } =
    useSnapshotDialogController({
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
        previewActionRef,
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
