/**
 * Main App Component
 * Root component that assembles all pieces together
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Providers } from './Providers';
import { AppLayout } from './AppLayout';
import { SettingsModal } from './components/SettingsModal';
import { LazyOverlayFallback } from './components/LazyOverlayFallback';
import { ImportPreparationOverlay } from './components/ImportPreparationOverlay';
import {
  useAppShellState,
  useFileImport,
  useFileExport,
  useImportInputBinding,
  useUnsavedChangesPrompt,
} from './hooks';
import { resolveRobotFileDataWithWorker } from './hooks/robotImportWorkerBridge';
import { resolveCurrentUsdExportMode } from './utils/currentUsdExportMode';
import {
  buildRobotLoadSupportContextKey,
  preserveDocumentLoadProgressForSameFile,
  shouldCommitResolvedRobotSelection,
  shouldSkipRedundantRobotReload,
} from './utils/documentLoadFlow';
import { peekPreResolvedRobotImport } from './utils/preResolvedRobotImportCache';
import { prewarmUsdSelectionInBackground } from './utils/usdSelectionPrewarm';
import { resolveAppModeAfterRobotContentChange } from './utils/contentChangeAppMode';
import { buildStandaloneImportAssetWarning } from './utils/importPackageAssetReferences';
import {
  useRobotStore,
  useUIStore,
  useSelectionStore,
  useAssetsStore,
  useAssemblyStore,
} from '@/store';
import type { RobotFile, RobotState, UrdfLink, UrdfJoint } from '@/types';
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { translations, type Language } from '@/shared/i18n';
import { isLibraryRobotExportableFormat } from '@/shared/utils';
import type { ExportDialogConfig } from '@/features/file-io/components/ExportDialog/ExportDialog';
import type { ExportProgressState } from '@/features/file-io/types';
import { getUsdStageExportHandler } from '@/features/urdf-viewer/utils/usdStageExport';
import type { ImportPreparationOverlayState } from './hooks/useFileImport';
import {
  installRegressionDebugApi,
  setRegressionAppHandlers,
  setRegressionBeforeUnloadPromptSuppressed,
} from '@/shared/debug/regressionBridge';
import { markUnsavedChangesBaselineSaved } from './utils/unsavedChangesBaseline';
import { toDocumentLoadLifecycleState } from '@/store/assetsStore';

const loadAIModalModule = () => import('@/features/ai-assistant');
const loadExportDialogModule = () => import('@/features/file-io');
const loadDisconnectedWorkspaceUrdfExportDialogModule = () =>
  import('@/features/file-io/components/DisconnectedWorkspaceUrdfExportDialog');
const loadExportProgressDialogModule = () =>
  import('@/features/file-io/components/ExportProgressDialog');

const AIModal = lazy(() => loadAIModalModule().then((module) => ({ default: module.AIModal })));
const DisconnectedWorkspaceUrdfExportDialog = lazy(() =>
  loadDisconnectedWorkspaceUrdfExportDialogModule().then((module) => ({
    default: module.DisconnectedWorkspaceUrdfExportDialog,
  })),
);
const ExportProgressDialog = lazy(() =>
  loadExportProgressDialogModule().then((module) => ({
    default: module.ExportProgressDialog,
  })),
);

const ExportDialog = lazy(() =>
  loadExportDialogModule().then((module) => ({ default: module.ExportDialog })),
);

interface AIApplyChangesPayload {
  name?: string;
  links?: Record<string, UrdfLink>;
  joints?: Record<string, UrdfJoint>;
  rootLinkId?: string;
}

function validateAIApplyPayload(data: AIApplyChangesPayload):
  | {
      ok: true;
      value: Required<Pick<AIApplyChangesPayload, 'links' | 'joints' | 'rootLinkId'>> &
        Pick<AIApplyChangesPayload, 'name'>;
    }
  | { ok: false; reason: 'aiNoDataToApply' | 'aiNoLinksGenerated' } {
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: 'aiNoDataToApply' };
  }

  if (!data.links || Object.keys(data.links).length === 0) {
    return { ok: false, reason: 'aiNoLinksGenerated' };
  }

  if (!data.joints || typeof data.joints !== 'object') {
    return { ok: false, reason: 'aiNoDataToApply' };
  }

  if (!data.rootLinkId || !data.links[data.rootLinkId]) {
    return { ok: false, reason: 'aiNoDataToApply' };
  }

  return {
    ok: true,
    value: {
      name: data.name,
      links: data.links,
      joints: data.joints,
      rootLinkId: data.rootLinkId,
    },
  };
}

function AIModalConnector({
  isOpen,
  onClose,
  lang,
  onApplyChanges,
}: {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  onApplyChanges: (data: AIApplyChangesPayload) => void;
}) {
  const { sidebarTab } = useUIStore(
    useShallow((state) => ({
      sidebarTab: state.sidebarTab,
    })),
  );
  const { selection, setSelection, focusOn } = useSelectionStore(
    useShallow((state) => ({
      selection: state.selection,
      setSelection: state.setSelection,
      focusOn: state.focusOn,
    })),
  );
  const { robotName, robotLinks, robotJoints, rootLinkId } = useRobotStore(
    useShallow((state) => ({
      robotName: state.name,
      robotLinks: state.links,
      robotJoints: state.joints,
      rootLinkId: state.rootLinkId,
    })),
  );
  const { assemblyState, getMergedRobotData } = useAssemblyStore(
    useShallow((state) => ({
      assemblyState: state.assemblyState,
      getMergedRobotData: state.getMergedRobotData,
    })),
  );
  const motorLibrary = useAssetsStore((state) => state.motorLibrary);

  const mergedWorkspaceRobot = useMemo(() => {
    if (!assemblyState || sidebarTab !== 'workspace') {
      return null;
    }

    return getMergedRobotData();
  }, [assemblyState, getMergedRobotData, sidebarTab]);

  const robot: RobotState = useMemo(() => {
    if (mergedWorkspaceRobot) {
      return {
        ...mergedWorkspaceRobot,
        selection,
      };
    }

    return {
      name: robotName,
      links: robotLinks,
      joints: robotJoints,
      rootLinkId,
      selection,
    };
  }, [mergedWorkspaceRobot, robotJoints, robotLinks, robotName, rootLinkId, selection]);

  return (
    <AIModal
      isOpen={isOpen}
      onClose={onClose}
      robot={robot}
      motorLibrary={motorLibrary}
      lang={lang}
      onApplyChanges={onApplyChanges}
      onSelectItem={(type, id) => {
        setSelection({ type, id });
        focusOn(id);
      }}
    />
  );
}

function ExportDialogConnector({
  target,
  lang,
  isExporting,
  onClose,
  onExport,
}: {
  target: ExportDialogTarget;
  lang: Language;
  isExporting: boolean;
  onClose: () => void;
  onExport: (
    config: ExportDialogConfig,
    options?: { onProgress?: (progress: ExportProgressState) => void },
  ) => Promise<void>;
}) {
  const { sidebarTab } = useUIStore(
    useShallow((state) => ({
      sidebarTab: state.sidebarTab,
    })),
  );
  const { selectedFile, documentLoadState, getUsdSceneSnapshot, getUsdPreparedExportCache } =
    useAssetsStore(
      useShallow((state) => ({
        selectedFile: state.selectedFile,
        documentLoadState: state.documentLoadState,
        getUsdSceneSnapshot: state.getUsdSceneSnapshot,
        getUsdPreparedExportCache: state.getUsdPreparedExportCache,
      })),
    );
  const documentLoadLifecycleState = useMemo(
    () => toDocumentLoadLifecycleState(documentLoadState),
    [documentLoadState],
  );

  const isSelectedUsdHydrating =
    selectedFile?.format === 'usd' &&
    documentLoadLifecycleState.status === 'hydrating' &&
    documentLoadLifecycleState.fileName === selectedFile.name;

  const currentUsdExportMode =
    selectedFile?.format === 'usd' && sidebarTab !== 'workspace'
      ? resolveCurrentUsdExportMode({
          isHydrating: isSelectedUsdHydrating,
          hasLiveStageExportHandler: Boolean(getUsdStageExportHandler()),
          hasPreparedExportCache: Boolean(getUsdPreparedExportCache(selectedFile.name)),
          hasSceneSnapshot: Boolean(getUsdSceneSnapshot(selectedFile.name)),
        })
      : 'unavailable';

  const canExportUsd =
    target.type === 'current'
      ? selectedFile?.format === 'usd' && sidebarTab !== 'workspace'
        ? currentUsdExportMode !== 'unavailable'
        : !isSelectedUsdHydrating
      : isLibraryRobotExportableFormat(target.file.format);
  const defaultFormat: ExportDialogConfig['format'] = 'mjcf';

  return (
    <ExportDialog
      onClose={onClose}
      onExport={onExport}
      lang={lang}
      isExporting={isExporting}
      canExportUsd={canExportUsd}
      defaultFormat={defaultFormat}
    />
  );
}

function waitForNextPaint(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

type ExportDialogTarget = { type: 'current' } | { type: 'library-file'; file: RobotFile };

function AppContent() {
  useUnsavedChangesPrompt();

  // Refs for file inputs
  const importInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
  const loadRobotByNameRef = useRef<
    ((file: RobotFile, options?: { forceReload?: boolean }) => Promise<void> | void) | null
  >(null);
  const loadRequestIdRef = useRef(0);
  const lastLoadSupportContextKeyRef = useRef<string | null>(null);
  const [shouldRenderAIModal, setShouldRenderAIModal] = useState(false);
  const [exportDialogTarget, setExportDialogTarget] = useState<ExportDialogTarget>({
    type: 'current',
  });
  const [disconnectedWorkspaceUrdfDialog, setDisconnectedWorkspaceUrdfDialog] = useState<{
    config: ExportDialogConfig;
    request: {
      type: 'disconnected-workspace-urdf';
      componentCount: number;
      connectedGroupCount: number;
      exportName: string;
    };
  } | null>(null);
  const [isDisconnectedWorkspaceUrdfExporting, setIsDisconnectedWorkspaceUrdfExporting] =
    useState(false);
  const [viewerReloadKey, setViewerReloadKey] = useState(0);
  const [importPreparationOverlay, setImportPreparationOverlay] =
    useState<ImportPreparationOverlayState | null>(null);

  // UI Store
  const { lang, setAppMode, openSettings } = useUIStore(
    useShallow((state) => ({
      lang: state.lang,
      setAppMode: state.setAppMode,
      openSettings: state.openSettings,
    })),
  );
  const t = translations[lang];

  // Selection Store
  const setSelection = useSelectionStore((state) => state.setSelection);

  // Assets Store
  const { setOriginalUrdfContent, setOriginalFileFormat, setSelectedFile, setDocumentLoadState } =
    useAssetsStore(
      useShallow((state) => ({
        setOriginalUrdfContent: state.setOriginalUrdfContent,
        setOriginalFileFormat: state.setOriginalFileFormat,
        setSelectedFile: state.setSelectedFile,
        setDocumentLoadState: state.setDocumentLoadState,
      })),
    );

  // Robot Store
  const setRobot = useRobotStore((state) => state.setRobot);

  const {
    toast,
    closeToast,
    showToast,
    isAIModalOpen,
    setIsAIModalOpen,
    isCodeViewerOpen,
    setIsCodeViewerOpen,
    isExportDialogOpen,
    setIsExportDialogOpen,
    isExporting,
    setIsExporting,
    projectExportProgress,
    setProjectExportProgress,
    viewConfig,
    setViewConfig,
  } = useAppShellState();

  const applyResolvedRobotImport = useCallback(
    (file: RobotFile, importResult: RobotImportResult) => {
      if (importResult.status === 'ready' || importResult.status === 'needs_hydration') {
        if (importResult.status === 'ready') {
          setRobot(importResult.robotData, {
            resetHistory: true,
            label: file.format === 'usd' ? 'Load USD stage' : 'Load imported robot',
          });

          if (file.format === 'xacro' && importResult.resolvedUrdfContent) {
            setOriginalUrdfContent(importResult.resolvedUrdfContent);
          }
          markUnsavedChangesBaselineSaved('robot');
        }
        const currentDocumentLoadState = useAssetsStore.getState().documentLoadState;
        setDocumentLoadState(
          preserveDocumentLoadProgressForSameFile({
            currentState: currentDocumentLoadState,
            nextState: {
              status: importResult.status === 'needs_hydration' ? 'hydrating' : 'loading',
              fileName: file.name,
              format: file.format,
              error: null,
              phase:
                importResult.status === 'needs_hydration'
                  ? 'checking-path'
                  : file.format === 'usd'
                    ? 'checking-path'
                    : 'preparing-scene',
              message: null,
              progressPercent: null,
              loadedCount: null,
              totalCount: null,
            },
          }),
        );
        return;
      }

      if (importResult.reason === 'source_only_fragment') {
        setDocumentLoadState({
          status: 'ready',
          fileName: file.name,
          format: file.format,
          error: null,
          phase: null,
          message: t.xacroSourceOnlyPreviewHint,
          progressPercent: 100,
          loadedCount: null,
          totalCount: null,
        });
        showToast(t.xacroSourceOnlyPreviewHint, 'info');
        return;
      }

      const message =
        importResult.message ??
        t.failedToParseFormat.replace('{format}', file.format.toUpperCase());
      setDocumentLoadState({
        status: 'error',
        fileName: file.name,
        format: file.format,
        error: message,
      });
      showToast(message, 'info');
    },
    [setDocumentLoadState, setOriginalUrdfContent, setRobot, showToast, t],
  );

  const commitResolvedFileSelection = useCallback(
    (file: RobotFile) => {
      setViewerReloadKey((value) => value + 1);
      setSelectedFile(file);
      setOriginalUrdfContent(file.format === 'mesh' ? '' : file.content);
      setOriginalFileFormat(file.format === 'mesh' ? null : file.format);
      setSelection({ type: null, id: null });
      const currentAppMode = useUIStore.getState().appMode;
      const nextAppMode = resolveAppModeAfterRobotContentChange(currentAppMode);
      if (nextAppMode !== currentAppMode) {
        setAppMode(nextAppMode);
      }
    },
    [setAppMode, setOriginalFileFormat, setOriginalUrdfContent, setSelectedFile, setSelection],
  );

  // Keep one internal loader so debug automation can force a reload of the
  // currently selected file without changing normal click behavior.
  const loadRobotFile = useCallback(
    async (file: RobotFile, options?: { forceReload?: boolean }) => {
      const liveAssetsState = useAssetsStore.getState();
      const currentSelectedFile = liveAssetsState.selectedFile;
      const nextLoadSupportContextKey = buildRobotLoadSupportContextKey({
        availableFiles: liveAssetsState.availableFiles,
        assets: liveAssetsState.assets,
        allFileContents: liveAssetsState.allFileContents,
      });
      if (
        shouldSkipRedundantRobotReload({
          forceReload: options?.forceReload,
          currentSelectedFile,
          currentDocumentLoadState: liveAssetsState.documentLoadState,
          nextFile: file,
          previousLoadSupportContextKey: lastLoadSupportContextKeyRef.current,
          nextLoadSupportContextKey,
        })
      ) {
        const currentAppMode = useUIStore.getState().appMode;
        const nextAppMode = resolveAppModeAfterRobotContentChange(currentAppMode);
        if (nextAppMode !== currentAppMode) {
          setAppMode(nextAppMode);
        }
        return;
      }

      const standaloneImportAssetWarning = buildStandaloneImportAssetWarning(
        file,
        Object.keys(liveAssetsState.assets),
      );
      if (standaloneImportAssetWarning) {
        const assetLabel =
          standaloneImportAssetWarning.missingAssetPaths.length > 3
            ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, …`
            : standaloneImportAssetWarning.missingAssetPaths.join(', ');
        const message = t.importPackageAssetBundleHint.replace('{assets}', assetLabel);
        setDocumentLoadState({
          status: 'error',
          fileName: file.name,
          format: file.format,
          error: message,
        });
        showToast(message, 'info');
        return;
      }

      setDocumentLoadState(
        preserveDocumentLoadProgressForSameFile({
          currentState: liveAssetsState.documentLoadState,
          nextState: {
            status: 'loading',
            fileName: file.name,
            format: file.format,
            error: null,
            phase: file.format === 'usd' ? 'checking-path' : 'preparing-scene',
            message: null,
            progressPercent: null,
            loadedCount: null,
            totalCount: null,
          },
        }),
      );
      const requestId = ++loadRequestIdRef.current;

      prewarmUsdSelectionInBackground(file, liveAssetsState.availableFiles, liveAssetsState.assets);

      const preResolvedImportResult = peekPreResolvedRobotImport(file);
      if (preResolvedImportResult) {
        if (requestId !== loadRequestIdRef.current) {
          return;
        }

        if (shouldCommitResolvedRobotSelection(preResolvedImportResult)) {
          lastLoadSupportContextKeyRef.current = nextLoadSupportContextKey;
          commitResolvedFileSelection(file);
        }
        applyResolvedRobotImport(file, preResolvedImportResult);
        return;
      }

      const importResultPromise = resolveRobotFileDataWithWorker(file, {
        availableFiles: liveAssetsState.availableFiles,
        assets: liveAssetsState.assets,
        usdRobotData: liveAssetsState.getUsdPreparedExportCache(file.name)?.robotData ?? null,
      });

      await waitForNextPaint();

      let importResult: Awaited<ReturnType<typeof resolveRobotFileDataWithWorker>>;
      try {
        importResult = await importResultPromise;
      } catch (error) {
        if (requestId !== loadRequestIdRef.current) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : t.failedToParseFormat.replace('{format}', file.format.toUpperCase());
        setDocumentLoadState({
          status: 'error',
          fileName: file.name,
          format: file.format,
          error: message,
        });
        showToast(message, 'info');
        return;
      }

      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      if (shouldCommitResolvedRobotSelection(importResult)) {
        lastLoadSupportContextKeyRef.current = nextLoadSupportContextKey;
        commitResolvedFileSelection(file);
      }
      applyResolvedRobotImport(file, importResult);
    },
    [
      applyResolvedRobotImport,
      commitResolvedFileSelection,
      setDocumentLoadState,
      setAppMode,
      showToast,
      t,
    ],
  );

  const handleLoadRobot = useCallback(
    (file: RobotFile) => {
      loadRobotFile(file);
    },
    [loadRobotFile],
  );

  loadRobotByNameRef.current = loadRobotFile;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const regressionDebugEnabled =
      import.meta.env.DEV ||
      new URLSearchParams(window.location.search).get('regressionDebug') === '1';
    if (!regressionDebugEnabled) {
      return;
    }

    installRegressionDebugApi(window);

    setRegressionAppHandlers({
      getAvailableFiles: () => useAssetsStore.getState().availableFiles,
      getSelectedFile: () => useAssetsStore.getState().selectedFile,
      getRobotState: () => ({
        name: useRobotStore.getState().name,
        links: useRobotStore.getState().links,
        joints: useRobotStore.getState().joints,
        rootLinkId: useRobotStore.getState().rootLinkId,
        selection: useSelectionStore.getState().selection,
      }),
      getAssetDebugState: () => {
        const assetsState = useAssetsStore.getState();
        return {
          appAssetKeys: Object.keys(assetsState.assets).sort((left, right) =>
            left.localeCompare(right),
          ),
          preparedUsdCacheKeysByFile: Object.fromEntries(
            Object.entries(assetsState.usdPreparedExportCaches)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([fileName, cache]) => [
                fileName,
                Object.keys(cache.meshFiles || {}).sort((left, right) => left.localeCompare(right)),
              ]),
          ),
        };
      },
      getInteractionState: () => ({
        selection: useSelectionStore.getState().selection,
        hoveredSelection: useSelectionStore.getState().hoveredSelection,
      }),
      loadRobotByName: async (fileName: string) => {
        const file =
          useAssetsStore.getState().availableFiles.find((entry) => entry.name === fileName) ?? null;
        if (!file) {
          return {
            loaded: false,
            selectedFile: useAssetsStore.getState().selectedFile?.name ?? null,
          };
        }

        loadRobotByNameRef.current?.(file, { forceReload: true });
        return {
          loaded: true,
          selectedFile: file.name,
        };
      },
    });

    return () => {
      setRegressionAppHandlers(null);
      setRegressionBeforeUnloadPromptSuppressed(false);
      delete window.__URDF_STUDIO_DEBUG__;
    };
  }, []);

  // File import/export hooks
  const { handleImport } = useFileImport({
    onLoadRobot: handleLoadRobot,
    onShowToast: showToast,
    onImportPreparationStateChange: setImportPreparationOverlay,
    onProjectImported: () => {
      setViewerReloadKey((value) => value + 1);
    },
  });
  const {
    handleExportProject: runProjectExport,
    handleExportWithConfig,
    handleExportDisconnectedWorkspaceUrdfBundle,
  } = useFileExport();

  const handleExportProject = useCallback(() => {
    void (async () => {
      void loadExportProgressDialogModule();
      setIsExporting(true);
      setProjectExportProgress({
        stepLabel: t.exportProgressPreparing,
        detail: t.exportProgressPreparingDetail,
        progress: 0.05,
        currentStep: 1,
        totalSteps: 6,
        indeterminate: true,
      });
      await waitForNextPaint();
      try {
        const result = await runProjectExport({
          onProgress: setProjectExportProgress,
        });
        if (result.partial && result.warnings.length > 0) {
          showToast(result.warnings[0], 'info');
        }
      } catch (error) {
        showToast(
          error instanceof Error && error.message ? error.message : t.exportFailedParse,
          'error',
        );
      } finally {
        setProjectExportProgress(null);
        setIsExporting(false);
      }
    })();
  }, [
    runProjectExport,
    setIsExporting,
    setProjectExportProgress,
    showToast,
    t.exportFailedParse,
    t.exportProgressPreparing,
    t.exportProgressPreparingDetail,
  ]);

  // AI changes handler
  const handleApplyAIChanges = useCallback(
    (data: AIApplyChangesPayload) => {
      const validated = validateAIApplyPayload(data);
      if (validated.ok === false) {
        showToast(t[validated.reason], 'info');
        return;
      }

      const currentRobot = useRobotStore.getState();
      setRobot({
        name: validated.value.name?.trim() || currentRobot.name,
        links: validated.value.links,
        joints: validated.value.joints,
        rootLinkId: validated.value.rootLinkId,
      });
      setAppMode(resolveAppModeAfterRobotContentChange(useUIStore.getState().appMode));
    },
    [setAppMode, setRobot, showToast, t],
  );

  useImportInputBinding({
    importInputRef,
    importFolderInputRef,
    onImport: handleImport,
  });

  const handleOpenAIModal = useCallback(() => {
    const liveAssetsState = useAssetsStore.getState();
    const currentSelectedFile = liveAssetsState.selectedFile;
    const currentDocumentLoadState = liveAssetsState.documentLoadState;
    const isSelectedUsdHydrating =
      currentSelectedFile?.format === 'usd' &&
      currentDocumentLoadState.status === 'hydrating' &&
      currentDocumentLoadState.fileName === currentSelectedFile.name;

    if (isSelectedUsdHydrating) {
      showToast(t.usdLoadInProgress, 'info');
      return;
    }
    setShouldRenderAIModal(true);
    void loadAIModalModule();
    setIsAIModalOpen(true);
  }, [setIsAIModalOpen, showToast, t.usdLoadInProgress]);

  const handleOpenExportDialog = useCallback(() => {
    void loadExportDialogModule();
    setExportDialogTarget({ type: 'current' });
    setIsExportDialogOpen(true);
  }, [setIsExportDialogOpen]);

  const handleOpenLibraryExportDialog = useCallback(
    (file: RobotFile) => {
      void loadExportDialogModule();
      setExportDialogTarget({ type: 'library-file', file });
      setIsExportDialogOpen(true);
    },
    [setIsExportDialogOpen],
  );

  const handleConfirmDisconnectedWorkspaceUrdfExport = useCallback(async () => {
    if (!disconnectedWorkspaceUrdfDialog) {
      return;
    }

    setIsDisconnectedWorkspaceUrdfExporting(true);
    try {
      const result = await handleExportDisconnectedWorkspaceUrdfBundle(
        disconnectedWorkspaceUrdfDialog.config,
      );
      if (result.partial && result.warnings.length > 0) {
        showToast(result.warnings[0], 'info');
      }
      setDisconnectedWorkspaceUrdfDialog(null);
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : t.exportFailedParse,
        'error',
      );
    } finally {
      setIsDisconnectedWorkspaceUrdfExporting(false);
    }
  }, [
    disconnectedWorkspaceUrdfDialog,
    handleExportDisconnectedWorkspaceUrdfBundle,
    showToast,
    t.exportFailedParse,
  ]);

  const loadingLabel = t.loadingPanel;
  const toastPresentation =
    toast.type === 'success'
      ? {
          badgeClassName: 'border border-success-border bg-success-soft text-success',
          iconPath: 'M5 13l4 4L19 7',
        }
      : toast.type === 'error'
        ? {
            badgeClassName: 'border border-danger-border bg-danger-soft text-danger',
            iconPath:
              'M12 8v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
          }
        : {
            badgeClassName: 'border border-system-blue/20 bg-system-blue/10 text-system-blue',
            iconPath: 'M12 8h.01M11 12h1v4h1m-1-13a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
          };

  return (
    <>
      <AppLayout
        importInputRef={importInputRef}
        importFolderInputRef={importFolderInputRef}
        onFileDrop={(files) => handleImport(files as any)}
        onOpenExport={handleOpenExportDialog}
        onOpenLibraryExport={handleOpenLibraryExportDialog}
        onExportProject={handleExportProject}
        showToast={showToast}
        onOpenAI={handleOpenAIModal}
        isCodeViewerOpen={isCodeViewerOpen}
        setIsCodeViewerOpen={setIsCodeViewerOpen}
        onOpenSettings={() => openSettings()}
        viewConfig={viewConfig}
        setViewConfig={setViewConfig}
        onLoadRobot={handleLoadRobot}
        viewerReloadKey={viewerReloadKey}
      />

      {/* Modals */}
      <SettingsModal />
      {shouldRenderAIModal && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <AIModalConnector
            isOpen={isAIModalOpen}
            onClose={() => {
              setIsAIModalOpen(false);
              setShouldRenderAIModal(false);
            }}
            lang={lang}
            onApplyChanges={handleApplyAIChanges}
          />
        </Suspense>
      )}

      {/* Export Dialog */}
      {isExportDialogOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <ExportDialogConnector
            target={exportDialogTarget}
            lang={lang}
            isExporting={isExporting}
            onClose={() => {
              if (!isExporting) {
                setIsExportDialogOpen(false);
              }
            }}
            onExport={async (config, options) => {
              setIsExporting(true);
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
              });
              try {
                const result =
                  config.format === 'project'
                    ? await runProjectExport({
                        onProgress: options?.onProgress,
                      })
                    : await handleExportWithConfig(config, exportDialogTarget, {
                        onProgress: options?.onProgress,
                      });
                if (result.actionRequired?.type === 'disconnected-workspace-urdf') {
                  void loadDisconnectedWorkspaceUrdfExportDialogModule();
                  setDisconnectedWorkspaceUrdfDialog({
                    config,
                    request: result.actionRequired,
                  });
                  setIsExportDialogOpen(false);
                  return;
                }
                if (result.partial && result.warnings.length > 0) {
                  showToast(result.warnings[0], 'info');
                }
                setIsExportDialogOpen(false);
              } catch (error) {
                showToast(
                  error instanceof Error && error.message ? error.message : t.exportFailedParse,
                  'error',
                );
              } finally {
                setIsExporting(false);
              }
            }}
          />
        </Suspense>
      )}

      {disconnectedWorkspaceUrdfDialog && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <DisconnectedWorkspaceUrdfExportDialog
            isOpen={true}
            lang={lang}
            componentCount={disconnectedWorkspaceUrdfDialog.request.componentCount}
            connectedGroupCount={disconnectedWorkspaceUrdfDialog.request.connectedGroupCount}
            isExporting={isDisconnectedWorkspaceUrdfExporting}
            onClose={() => {
              if (!isDisconnectedWorkspaceUrdfExporting) {
                setDisconnectedWorkspaceUrdfDialog(null);
              }
            }}
            onExportMultiple={() => {
              void handleConfirmDisconnectedWorkspaceUrdfExport();
            }}
          />
        </Suspense>
      )}

      {projectExportProgress && !isExportDialogOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <ExportProgressDialog lang={lang} progress={projectExportProgress} />
        </Suspense>
      )}

      {importPreparationOverlay && (
        <ImportPreparationOverlay
          label={importPreparationOverlay.label}
          detail={importPreparationOverlay.detail}
          progress={importPreparationOverlay.progress}
          statusLabel={importPreparationOverlay.statusLabel}
          stageLabel={importPreparationOverlay.stageLabel}
        />
      )}

      {/* Toast */}
      {toast.show && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex max-w-[min(44rem,calc(100vw-2rem))] items-center gap-2.5 rounded-[1.75rem] border border-border-black bg-panel-bg px-3.5 py-2.5 shadow-2xl dark:shadow-black/40">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${toastPresentation.badgeClassName}`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={toastPresentation.iconPath}
                />
              </svg>
            </div>
            <div className="flex min-h-6 min-w-0 flex-1 items-center whitespace-pre-line break-words text-[15px] font-semibold leading-5 text-text-primary">
              {toast.message}
            </div>
            <button
              onClick={closeToast}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-element-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <Providers>
      <AppContent />
    </Providers>
  );
}
