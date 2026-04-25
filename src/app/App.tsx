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
  shouldReuseResolvedMjcfViewerRuntime,
  shouldCommitResolvedRobotSelection,
  shouldSkipRedundantRobotReload,
} from './utils/documentLoadFlow';
import { peekPreResolvedRobotImport } from './utils/preResolvedRobotImportCache';
import { prewarmUsdSelectionInBackground } from './utils/usdSelectionPrewarm';
import { prewarmUsdViewerRuntimesInBackground } from './utils/usdRuntimeStartupPrewarm';
import { commitResolvedRobotLoad } from './utils/commitResolvedRobotLoad';
import { resolveUsdViewerRoundtripSelection } from './utils/usdViewerRoundtripSelection';
import { resolveAppModeAfterRobotContentChange } from './utils/contentChangeAppMode';
import { resolveExportErrorMessage } from './utils/exportErrorMessage';
import {
  mapRobotImportProgressToDocumentLoadPercent,
  resolveBootstrapDocumentLoadPhase,
  resolveRobotImportCompletedDocumentLoadPercent,
} from './utils/documentLoadProgress';
import {
  buildStandaloneImportAssetWarning,
  canProceedWithStandaloneImportAssetWarning,
  collectStandaloneImportSupportAssetPaths,
} from './utils/importPackageAssetReferences';
import {
  useRobotStore,
  useUIStore,
  useSelectionStore,
  useAssetsStore,
  useAssemblyStore,
} from '@/store';
import type { InspectionReport, RobotFile, RobotState } from '@/types';
import type { HeaderAction } from './components/header/types';

/** Render slots: allows external repos to inject extra modals and overlays */
export interface AppExtensionSlots {
  /** Rendered after core built-in modals, before toast */
  renderModals?: () => React.ReactNode;
  /** Rendered after toast (highest z-index layer) */
  renderTopOverlays?: () => React.ReactNode;
}

/** Config extension: allows external repos to inject header actions etc. */
export interface AppExtensionConfig {
  headerQuickAction?: HeaderAction;
  headerSecondaryAction?: HeaderAction;
}

/** Core internal actions exposed to external consumers */
export interface AppExposedActions {
  importFiles: (files: FileList | File[]) => void;
  openLibraryExport: (file: RobotFile) => void;
  openAIInspection: () => void;
  openAIConversation: () => void;
  openIkTool: () => void;
  openCollisionOptimizer: () => void;
  openTool: (key: string) => void;
  exportProjectBlob: () => Promise<Blob>;
  collectRawFilesBlob: () => Promise<Blob>;
}

interface AppContentProps {
  extensions?: {
    slots?: AppExtensionSlots;
    config?: AppExtensionConfig;
  };
  /** Core calls this on mount to expose internal handlers to the external host */
  onExposeActions?: (actions: AppExposedActions) => void;
}
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { resolveMJCFSource } from '@/core/parsers/mjcf/mjcfSourceResolver';
import { translations, type Language } from '@/shared/i18n';
import { isLibraryRobotExportableFormat } from '@/shared/utils';
import type { ExportDialogConfig } from '@/features/file-io/components/ExportDialog/ExportDialog';
import type { ExportProgressState } from '@/features/file-io/types';
import { getUsdStageExportHandler } from '@/features/editor';
import type { ImportPreparationOverlayState } from './hooks/useFileImport';
import { consumeHandoffImportFromUrl } from './handoff/bootstrap';
import {
  deletePendingHandoffImport,
  pruneExpiredPendingHandoffImports,
  readPendingHandoffImport,
} from './handoff/storage';
import {
  installRegressionDebugApi,
  setRegressionAppHandlers,
  setRegressionBeforeUnloadPromptSuppressed,
} from '@/shared/debug/regressionBridge';
import { markUnsavedChangesBaselineSaved } from './utils/unsavedChangesBaseline';
import type {
  AIConversationFocusedIssue,
  AIConversationLaunchContext,
  AIConversationMode,
  AIConversationSelection,
} from '@/features/ai-assistant/types';
import { toDocumentLoadLifecycleState } from '@/store/assetsStore';

const loadAIInspectionModalModule = () =>
  import('@/features/ai-assistant/components/AIInspectionModal');
const loadAIConversationModalModule = () =>
  import('@/features/ai-assistant/components/AIConversationModal');
const loadExportDialogModule = () => import('@/features/file-io');
const loadDisconnectedWorkspaceUrdfExportDialogModule = () =>
  import('@/features/file-io/components/DisconnectedWorkspaceUrdfExportDialog');
const loadExportProgressDialogModule = () =>
  import('@/features/file-io/components/ExportProgressDialog');

const AIInspectionModal = lazy(() =>
  loadAIInspectionModalModule().then((module) => ({ default: module.AIInspectionModal })),
);

const AIConversationModal = lazy(() =>
  loadAIConversationModalModule().then((module) => ({ default: module.AIConversationModal })),
);
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

function cloneAISnapshot<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveConversationSelectedEntity(robotSnapshot: RobotState) {
  if (!robotSnapshot.selection.type || !robotSnapshot.selection.id) {
    return null;
  }

  if (robotSnapshot.selection.type !== 'link' && robotSnapshot.selection.type !== 'joint') {
    return null;
  }

  return {
    type: robotSnapshot.selection.type,
    id: robotSnapshot.selection.id,
  };
}

function createConversationLaunchContext({
  sessionId,
  mode,
  robotSnapshot,
  inspectionReportSnapshot = null,
  selectedEntity = null,
  focusedIssue = null,
}: {
  sessionId: number;
  mode: AIConversationMode;
  robotSnapshot: RobotState;
  inspectionReportSnapshot?: InspectionReport | null;
  selectedEntity?: AIConversationSelection | null;
  focusedIssue?: AIConversationFocusedIssue | null;
}): AIConversationLaunchContext {
  const nextRobotSnapshot = cloneAISnapshot(robotSnapshot);
  const nextFocusedIssue = focusedIssue ? cloneAISnapshot(focusedIssue) : null;

  return {
    sessionId,
    mode,
    robotSnapshot: nextRobotSnapshot,
    inspectionReportSnapshot: inspectionReportSnapshot
      ? cloneAISnapshot(inspectionReportSnapshot)
      : null,
    selectedEntity: selectedEntity
      ? cloneAISnapshot(selectedEntity)
      : resolveConversationSelectedEntity(nextRobotSnapshot),
    focusedIssue: nextFocusedIssue,
  };
}

function AIInspectionConnector({
  isOpen,
  onClose,
  lang,
  onOpenConversationWithReport,
}: {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  onOpenConversationWithReport: (
    report: InspectionReport,
    robotSnapshot: RobotState,
    options?: {
      selectedEntity?: AIConversationSelection | null;
      focusedIssue?: AIConversationFocusedIssue | null;
    },
  ) => void;
}) {
  const { sidebarTab } = useUIStore(
    useShallow((state) => ({
      sidebarTab: state.sidebarTab,
    })),
  );
  const { selection, setSelection, focusOn, pulseSelection } = useSelectionStore(
    useShallow((state) => ({
      selection: state.selection,
      setSelection: state.setSelection,
      focusOn: state.focusOn,
      pulseSelection: state.pulseSelection,
    })),
  );
  const {
    robotName,
    robotLinks,
    robotJoints,
    rootLinkId,
    robotMaterials,
    robotClosedLoopConstraints,
    inspectionContext,
  } = useRobotStore(
    useShallow((state) => ({
      robotName: state.name,
      robotLinks: state.links,
      robotJoints: state.joints,
      rootLinkId: state.rootLinkId,
      robotMaterials: state.materials,
      robotClosedLoopConstraints: state.closedLoopConstraints,
      inspectionContext: state.inspectionContext,
    })),
  );
  const { assemblyState, getMergedRobotData } = useAssemblyStore(
    useShallow((state) => ({
      assemblyState: state.assemblyState,
      getMergedRobotData: state.getMergedRobotData,
    })),
  );

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
      materials: robotMaterials,
      closedLoopConstraints: robotClosedLoopConstraints,
      inspectionContext,
      selection,
    };
  }, [
    mergedWorkspaceRobot,
    robotJoints,
    robotLinks,
    robotName,
    rootLinkId,
    robotMaterials,
    robotClosedLoopConstraints,
    inspectionContext,
    selection,
  ]);

  return (
    <AIInspectionModal
      isOpen={isOpen}
      onClose={onClose}
      robot={robot}
      lang={lang}
      onSelectItem={(type, id) => {
        setSelection({ type, id });
        pulseSelection({ type, id });
        focusOn(id);
      }}
      onOpenConversationWithReport={onOpenConversationWithReport}
    />
  );
}

function AIConversationConnector({
  isOpen,
  onClose,
  lang,
  launchContext,
  onStartNewConversation,
}: {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  launchContext: AIConversationLaunchContext | null;
  onStartNewConversation: (launchContext: AIConversationLaunchContext) => void;
}) {
  return (
    <AIConversationModal
      isOpen={isOpen}
      onClose={onClose}
      lang={lang}
      launchContext={launchContext}
      onStartNewConversation={onStartNewConversation}
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

function resolveCurrentAIRobotSnapshot(): RobotState {
  const { sidebarTab } = useUIStore.getState();
  const { selection } = useSelectionStore.getState();
  const { assemblyState, getMergedRobotData } = useAssemblyStore.getState();
  const robotState = useRobotStore.getState();

  if (assemblyState && sidebarTab === 'workspace') {
    const mergedWorkspaceRobot = getMergedRobotData();
    if (mergedWorkspaceRobot) {
      return cloneAISnapshot({
        ...mergedWorkspaceRobot,
        selection,
      });
    }
  }

  return cloneAISnapshot({
    name: robotState.name,
    links: robotState.links,
    joints: robotState.joints,
    rootLinkId: robotState.rootLinkId,
    materials: robotState.materials,
    closedLoopConstraints: robotState.closedLoopConstraints,
    inspectionContext: robotState.inspectionContext,
    selection,
  });
}

export function AppContent({ extensions, onExposeActions }: AppContentProps = {}) {
  useUnsavedChangesPrompt();

  // Refs for file inputs
  const importInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
  const loadRobotByNameRef = useRef<
    ((file: RobotFile, options?: { forceReload?: boolean }) => Promise<void> | void) | null
  >(null);
  const loadRequestIdRef = useRef(0);
  const aiConversationSessionIdRef = useRef(0);
  const handoffBootstrapStartedRef = useRef(false);
  const [shouldRenderAIInspectionModal, setShouldRenderAIInspectionModal] = useState(false);
  const [shouldRenderAIConversationModal, setShouldRenderAIConversationModal] = useState(false);
  const [aiConversationLaunchContext, setAIConversationLaunchContext] =
    useState<AIConversationLaunchContext | null>(null);
  const lastLoadSupportContextKeyRef = useRef<string | null>(null);
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
  const { lang, setAppMode, setSidebarTab, openSettings } = useUIStore(
    useShallow((state) => ({
      lang: state.lang,
      setAppMode: state.setAppMode,
      setSidebarTab: state.setSidebarTab,
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
    isAIInspectionOpen,
    setIsAIInspectionOpen,
    isAIConversationOpen,
    setIsAIConversationOpen,
    setAILaunchMode,
    openAIInspection,
    openAIConversation,
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
              progressMode: 'percent',
              progressPercent: resolveRobotImportCompletedDocumentLoadPercent(file.format),
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
    [setDocumentLoadState, showToast, t],
  );

  // Keep one internal loader so debug automation can force a reload of the
  // currently selected file without changing normal click behavior.
  const loadRobotFile = useCallback(
    async (requestedFile: RobotFile, options?: { forceReload?: boolean }) => {
      const liveAssetsState = useAssetsStore.getState();
      const file = resolveUsdViewerRoundtripSelection(
        requestedFile,
        liveAssetsState.availableFiles,
      );
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

      const importedAssetPaths = collectStandaloneImportSupportAssetPaths(
        liveAssetsState.assets,
        liveAssetsState.availableFiles,
      );
      const standaloneImportAssetWarning = buildStandaloneImportAssetWarning(
        file,
        importedAssetPaths,
        {
          allFileContents: liveAssetsState.allFileContents,
          sourcePath: file.name,
        },
      );
      if (standaloneImportAssetWarning) {
        const assetLabel =
          standaloneImportAssetWarning.missingAssetPaths.length > 3
            ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, …`
            : standaloneImportAssetWarning.missingAssetPaths.join(', ');
        const message = t.importPackageAssetBundleHint
          .replace('{packages}', assetLabel)
          .replace('{assets}', assetLabel);
        showToast(message, 'info');
        if (!canProceedWithStandaloneImportAssetWarning(file)) {
          setDocumentLoadState({
            status: 'error',
            fileName: file.name,
            format: file.format,
            error: message,
          });
          return;
        }
      }

      const currentResolvedMjcfSource =
        currentSelectedFile?.format === 'mjcf'
          ? resolveMJCFSource(currentSelectedFile, liveAssetsState.availableFiles)
          : null;
      const nextResolvedMjcfSource =
        file.format === 'mjcf' ? resolveMJCFSource(file, liveAssetsState.availableFiles) : null;
      const shouldReloadViewer =
        options?.forceReload ||
        !shouldReuseResolvedMjcfViewerRuntime({
          currentSelectedFile,
          nextFile: file,
          currentResolvedSource: currentResolvedMjcfSource
            ? {
                effectiveFileName: currentResolvedMjcfSource.effectiveFile.name,
                content: currentResolvedMjcfSource.content,
              }
            : null,
          nextResolvedSource: nextResolvedMjcfSource
            ? {
                effectiveFileName: nextResolvedMjcfSource.effectiveFile.name,
                content: nextResolvedMjcfSource.content,
              }
            : null,
        });

      setDocumentLoadState(
        preserveDocumentLoadProgressForSameFile({
          currentState: liveAssetsState.documentLoadState,
          nextState: {
            status: 'loading',
            fileName: file.name,
            format: file.format,
            error: null,
            phase: resolveBootstrapDocumentLoadPhase(file.format),
            message: null,
            progressMode: 'percent',
            progressPercent: 0,
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
          commitResolvedRobotLoad({
            currentAppMode: useUIStore.getState().appMode,
            file,
            importResult: preResolvedImportResult,
            markRobotBaselineSaved: () => markUnsavedChangesBaselineSaved('robot'),
            onViewerReload: () => setViewerReloadKey((value) => value + 1),
            reloadViewer: shouldReloadViewer,
            setAppMode,
            setOriginalFileFormat,
            setOriginalUrdfContent,
            setRobot,
            setSelectedFile,
            setSelection,
            setSidebarTab,
          });
        }
        applyResolvedRobotImport(file, preResolvedImportResult);
        if (
          !shouldReloadViewer &&
          preResolvedImportResult.status === 'ready' &&
          file.format === 'mjcf'
        ) {
          setDocumentLoadState({
            status: 'ready',
            fileName: file.name,
            format: file.format,
            error: null,
            phase: 'ready',
            message: null,
            progressMode: 'percent',
            progressPercent: 100,
            loadedCount: null,
            totalCount: null,
          });
        }
        return;
      }

      const importResultPromise = resolveRobotFileDataWithWorker(
        file,
        {
          availableFiles: liveAssetsState.availableFiles,
          assets: liveAssetsState.assets,
          allFileContents: liveAssetsState.allFileContents,
          // Fresh USD loads must go through worker hydration instead of short-
          // circuiting through any previously prepared cache for the same path.
          usdRobotData:
            file.format === 'usd'
              ? null
              : (liveAssetsState.getUsdPreparedExportCache(file.name)?.robotData ?? null),
        },
        {
          onProgress: (progress) => {
            if (requestId !== loadRequestIdRef.current) {
              return;
            }

            const currentDocumentLoadState = useAssetsStore.getState().documentLoadState;
            const mappedProgressPercent = mapRobotImportProgressToDocumentLoadPercent(
              file.format,
              progress,
            );
            const nextProgressPercent =
              currentDocumentLoadState.fileName === file.name &&
              (currentDocumentLoadState.status === 'loading' ||
                currentDocumentLoadState.status === 'hydrating')
                ? Math.max(currentDocumentLoadState.progressPercent ?? 0, mappedProgressPercent)
                : mappedProgressPercent;

            setDocumentLoadState({
              status: 'loading',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: resolveBootstrapDocumentLoadPhase(file.format),
              message: progress.message ?? null,
              progressMode: 'percent',
              progressPercent: nextProgressPercent,
              loadedCount: null,
              totalCount: null,
            });
          },
        },
      );

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
        commitResolvedRobotLoad({
          currentAppMode: useUIStore.getState().appMode,
          file,
          importResult,
          markRobotBaselineSaved: () => markUnsavedChangesBaselineSaved('robot'),
          onViewerReload: () => setViewerReloadKey((value) => value + 1),
          reloadViewer: shouldReloadViewer,
          setAppMode,
          setOriginalFileFormat,
          setOriginalUrdfContent,
          setRobot,
          setSelectedFile,
          setSelection,
          setSidebarTab,
        });
      }
      applyResolvedRobotImport(file, importResult);
      if (!shouldReloadViewer && importResult.status === 'ready' && file.format === 'mjcf') {
        setDocumentLoadState({
          status: 'ready',
          fileName: file.name,
          format: file.format,
          error: null,
          phase: 'ready',
          message: null,
          progressMode: 'percent',
          progressPercent: 100,
          loadedCount: null,
          totalCount: null,
        });
      }
    },
    [
      applyResolvedRobotImport,
      setDocumentLoadState,
      setAppMode,
      setOriginalFileFormat,
      setOriginalUrdfContent,
      setRobot,
      setSelectedFile,
      setSelection,
      setSidebarTab,
      setViewerReloadKey,
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

    const requestIdle = window.requestIdleCallback?.bind(window);
    const cancelIdle = window.cancelIdleCallback?.bind(window);
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const runPrewarm = () => {
      prewarmUsdViewerRuntimesInBackground();
    };

    if (requestIdle) {
      idleHandle = requestIdle(
        () => {
          runPrewarm();
        },
        { timeout: 1200 },
      );

      return () => {
        if (idleHandle !== null && cancelIdle) {
          cancelIdle(idleHandle);
        }
      };
    }

    timeoutHandle = window.setTimeout(runPrewarm, 16);
    return () => {
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, []);

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
      getUsdSceneSnapshot: (fileName: string) =>
        useAssetsStore.getState().getUsdSceneSnapshot(fileName),
      getDocumentLoadState: () => useAssetsStore.getState().documentLoadState,
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
        showToast(resolveExportErrorMessage(error, t), 'error');
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
  useImportInputBinding({
    importInputRef,
    importFolderInputRef,
    onImport: handleImport,
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    void pruneExpiredPendingHandoffImports().catch((error) => {
      console.error('Failed to prune expired handoff imports:', error);
    });

    if (handoffBootstrapStartedRef.current) {
      return;
    }

    handoffBootstrapStartedRef.current = true;

    void consumeHandoffImportFromUrl({
      currentUrl: window.location.href,
      sessionStorage: window.sessionStorage,
      loadRecord: readPendingHandoffImport,
      deleteRecord: deletePendingHandoffImport,
      importArchive: (files) => handleImport(files),
      replaceUrl: (nextUrl) => {
        const currentUrl = window.location.href;
        if (nextUrl !== currentUrl) {
          window.history.replaceState(window.history.state, '', nextUrl);
        }
      },
      logger: console,
    });
  }, [handleImport]);

  const ensureAIEntryAvailable = useCallback(() => {
    const liveAssetsState = useAssetsStore.getState();
    const currentSelectedFile = liveAssetsState.selectedFile;
    const currentDocumentLoadState = liveAssetsState.documentLoadState;
    const isSelectedUsdHydrating =
      currentSelectedFile?.format === 'usd' &&
      currentDocumentLoadState.status === 'hydrating' &&
      currentDocumentLoadState.fileName === currentSelectedFile.name;

    if (isSelectedUsdHydrating) {
      showToast(t.usdLoadInProgress, 'info');
      return false;
    }
    return true;
  }, [showToast, t.usdLoadInProgress]);

  const createConversationLaunchContextFromSnapshot = useCallback(
    (
      mode: AIConversationMode,
      robotSnapshot: RobotState,
      inspectionReportSnapshot: InspectionReport | null = null,
      options: {
        selectedEntity?: AIConversationSelection | null;
        focusedIssue?: AIConversationFocusedIssue | null;
      } = {},
    ) => {
      aiConversationSessionIdRef.current += 1;
      return createConversationLaunchContext({
        sessionId: aiConversationSessionIdRef.current,
        mode,
        robotSnapshot,
        inspectionReportSnapshot,
        selectedEntity: options.selectedEntity,
        focusedIssue: options.focusedIssue,
      });
    },
    [],
  );

  const handleOpenAIInspection = useCallback(() => {
    if (!ensureAIEntryAvailable()) {
      return;
    }

    setShouldRenderAIInspectionModal(true);
    void loadAIInspectionModalModule();
    openAIInspection();
  }, [ensureAIEntryAvailable, openAIInspection]);

  const handleOpenAIConversation = useCallback(() => {
    if (!ensureAIEntryAvailable()) {
      return;
    }

    if (aiConversationLaunchContext?.mode === 'general') {
      setShouldRenderAIConversationModal(true);
      void loadAIConversationModalModule();
      openAIConversation();
      return;
    }

    const launchContext = createConversationLaunchContextFromSnapshot(
      'general',
      resolveCurrentAIRobotSnapshot(),
    );

    setAIConversationLaunchContext(launchContext);
    setShouldRenderAIConversationModal(true);
    void loadAIConversationModalModule();
    openAIConversation();
  }, [
    aiConversationLaunchContext,
    createConversationLaunchContextFromSnapshot,
    ensureAIEntryAvailable,
    openAIConversation,
  ]);

  const handleOpenConversationWithReport = useCallback(
    (
      report: InspectionReport,
      robotSnapshot: RobotState,
      options: {
        selectedEntity?: AIConversationSelection | null;
        focusedIssue?: AIConversationFocusedIssue | null;
      } = {},
    ) => {
      if (!ensureAIEntryAvailable()) {
        return;
      }

      const launchContext = createConversationLaunchContextFromSnapshot(
        'inspection-followup',
        robotSnapshot,
        report,
        options,
      );

      setAIConversationLaunchContext(launchContext);
      setShouldRenderAIConversationModal(true);
      void loadAIConversationModalModule();
      setIsAIConversationOpen(true);
      setAILaunchMode('conversation');
    },
    [
      createConversationLaunchContextFromSnapshot,
      ensureAIEntryAvailable,
      setAILaunchMode,
      setIsAIConversationOpen,
    ],
  );

  const handleStartNewAIConversation = useCallback(
    (currentLaunchContext: AIConversationLaunchContext) => {
      const nextLaunchContext = createConversationLaunchContextFromSnapshot(
        currentLaunchContext.mode,
        currentLaunchContext.robotSnapshot,
        currentLaunchContext.inspectionReportSnapshot ?? null,
        {
          selectedEntity: currentLaunchContext.selectedEntity,
          focusedIssue: currentLaunchContext.focusedIssue,
        },
      );

      setAIConversationLaunchContext(nextLaunchContext);
    },
    [createConversationLaunchContextFromSnapshot],
  );

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

  // Expose internal actions to external consumers (ref keeps the reference fresh)
  const layoutActionsRef = useRef<{
    openIkTool: () => void;
    openCollisionOptimizer: () => void;
    openTool: (key: string) => void;
  }>({ openIkTool: () => {}, openCollisionOptimizer: () => {}, openTool: () => {} });

  const handleExportProjectBlob = useCallback(async (): Promise<Blob> => {
    const result = await runProjectExport({ skipDownload: true });
    return result.blob;
  }, [runProjectExport]);

  const handleCollectRawFilesBlob = useCallback(async (): Promise<Blob> => {
    const { collectRawFilesZip } = await import('@/features/file-io/utils/rawFilesExport');
    const assetsState = useAssetsStore.getState();
    return collectRawFilesZip({
      assets: assetsState.assets,
      availableFiles: assetsState.availableFiles,
      allFileContents: assetsState.allFileContents,
      selectedFile: assetsState.selectedFile,
    });
  }, []);

  const exposedActionsRef = useRef<AppExposedActions | null>(null);
  exposedActionsRef.current = {
    importFiles: handleImport,
    openLibraryExport: handleOpenLibraryExportDialog,
    openAIInspection: handleOpenAIInspection,
    openAIConversation: handleOpenAIConversation,
    openIkTool: () => layoutActionsRef.current.openIkTool(),
    openCollisionOptimizer: () => layoutActionsRef.current.openCollisionOptimizer(),
    openTool: (key: string) => layoutActionsRef.current.openTool(key),
    exportProjectBlob: handleExportProjectBlob,
    collectRawFilesBlob: handleCollectRawFilesBlob,
  };

  useEffect(() => {
    onExposeActions?.(exposedActionsRef.current!);
  }, [onExposeActions]);

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
      showToast(resolveExportErrorMessage(error, t), 'error');
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
        onFileDrop={(files) => {
          void handleImport(files);
        }}
        onOpenExport={handleOpenExportDialog}
        onOpenLibraryExport={handleOpenLibraryExportDialog}
        onExportProject={handleExportProject}
        showToast={showToast}
        onOpenAIInspection={handleOpenAIInspection}
        onOpenAIConversation={handleOpenAIConversation}
        isCodeViewerOpen={isCodeViewerOpen}
        setIsCodeViewerOpen={setIsCodeViewerOpen}
        onOpenSettings={() => openSettings()}
        viewConfig={viewConfig}
        setViewConfig={setViewConfig}
        onLoadRobot={handleLoadRobot}
        viewerReloadKey={viewerReloadKey}
        importPreparationOverlay={importPreparationOverlay}
        headerQuickAction={extensions?.config?.headerQuickAction}
        headerSecondaryAction={extensions?.config?.headerSecondaryAction}
        onExposeLayoutActions={(actions) => {
          layoutActionsRef.current = actions;
        }}
      />

      {/* Modals */}
      <SettingsModal />
      {shouldRenderAIInspectionModal && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          {/* Keep the modal mounted after first open so inspection results survive close/reopen. */}
          <AIInspectionConnector
            isOpen={isAIInspectionOpen}
            onClose={() => {
              setIsAIInspectionOpen(false);
            }}
            lang={lang}
            onOpenConversationWithReport={handleOpenConversationWithReport}
          />
        </Suspense>
      )}
      {shouldRenderAIConversationModal && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <AIConversationConnector
            isOpen={isAIConversationOpen}
            onClose={() => {
              setIsAIConversationOpen(false);
            }}
            lang={lang}
            launchContext={aiConversationLaunchContext}
            onStartNewConversation={handleStartNewAIConversation}
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
                showToast(resolveExportErrorMessage(error, t), 'error');
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

      {/* Extension slot: external modal layer */}
      {extensions?.slots?.renderModals?.()}

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

      {/* Extension slot: top overlay layer (highest z-index) */}
      {extensions?.slots?.renderTopOverlays?.()}
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
