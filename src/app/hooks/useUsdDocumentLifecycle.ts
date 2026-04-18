import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import {
  canPrepareUsdExportCacheFromSnapshot,
  getCurrentUsdViewerSceneSnapshot,
  prepareUsdExportCacheFromSnapshot,
  prepareUsdPreparedExportCacheWithWorker,
  resolveUsdExportResolution,
  type ViewerDocumentLoadEvent,
  type ViewerRobotDataResolution,
} from '@/features/editor';
import { useAssetsStore, useRobotStore } from '@/store';
import type { DocumentLoadState, DocumentLoadStatus } from '@/store/assetsStore';
import type { RobotData, RobotFile, UsdSceneSnapshot } from '@/types';
import { createRobotSemanticSnapshot } from '@/shared/utils/robot/semanticSnapshot';
import { recordUsdStageLoadDebug } from '@/shared/debug/usdStageLoadDebug';
import { registerPendingUsdCacheFlusher } from '../utils/pendingUsdCache';
import { shouldApplyUsdStageHydration } from '../utils/usdStageHydration';
import {
  buildUsdHydrationPersistencePlan,
  resolveUsdHydrationRobotData,
} from '../utils/usdHydrationPersistence';
import { mapViewerDocumentLoadEventToDocumentLoadPercent } from '../utils/documentLoadProgress';
import {
  resolveRuntimeRobotReadyDocumentLoadState,
  shouldIgnoreStaleViewerDocumentLoadEvent,
  shouldIgnoreViewerLoadRegressionAfterReadySameFile,
} from '../utils/documentLoadFlow';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import { markUnsavedChangesBaselineSaved } from '../utils/unsavedChangesBaseline';
import { isGeneratedWorkspaceUrdfFileName } from './workspaceSourceSyncUtils';

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

function normalizeUsdPersistenceFileName(path: string | null | undefined): string {
  return String(path || '')
    .trim()
    .replace(/^\/+/, '')
    .split('?')[0];
}

interface UseUsdDocumentLifecycleLabels {
  addedComponent: string;
  failedToParseFormat: string;
}

interface UseUsdDocumentLifecycleOptions {
  clearAssemblyComponentPreparationOverlay: () => void;
  insertAssemblyComponentIntoWorkspace: (
    file: RobotFile,
    options?: { preResolvedRobotData?: RobotData | null },
  ) => Promise<{ name: string }>;
  isSelectedUsdHydrating: boolean;
  labels: UseUsdDocumentLifecycleLabels;
  pendingUsdAssemblyFileRef: MutableRefObject<RobotFile | null>;
  previewFile: RobotFile | null;
  selectedFile: RobotFile | null;
  setDocumentLoadState: (state: DocumentLoadState) => void;
  setRobot: (
    data: RobotData,
    options?: { label?: string; resetHistory?: boolean; skipHistory?: boolean },
  ) => void;
  setSelection: (selection: { type: null; id: null }) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
  updateProModeRoundtripBaseline: (generatedFileName: string | null) => unknown;
}

export function useUsdDocumentLifecycle({
  clearAssemblyComponentPreparationOverlay,
  insertAssemblyComponentIntoWorkspace,
  isSelectedUsdHydrating,
  labels,
  pendingUsdAssemblyFileRef,
  previewFile,
  selectedFile,
  setDocumentLoadState,
  setRobot,
  setSelection,
  showToast,
  updateProModeRoundtripBaseline,
}: UseUsdDocumentLifecycleOptions) {
  const pendingUsdHydrationFileRef = useRef<string | null>(null);
  const usdPersistenceBaselineRef = useRef<UsdPersistenceBaseline>(EMPTY_USD_PERSISTENCE_BASELINE);
  const usdPreparedExportCacheRequestIdRef = useRef(0);

  useEffect(() => {
    if (!isSelectedUsdHydrating || selectedFile?.format !== 'usd') {
      pendingUsdHydrationFileRef.current = null;
      return;
    }

    pendingUsdHydrationFileRef.current = selectedFile.name;
  }, [isSelectedUsdHydrating, selectedFile]);

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
            'useUsdDocumentLifecycle:prepareUsdPreparedExportCacheWithWorker',
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
        'useUsdDocumentLifecycle:flushPendingUsdCache',
        new Error(
          `Missing live USD scene snapshot for "${currentSelectedFile.name}" while semantic edits are pending.`,
        ),
        'warn',
      );
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

  const commitRuntimeReadyDocumentLoadState = useCallback(() => {
    const liveAssetsState = useAssetsStore.getState();
    const activeDocumentFile = previewFile ?? liveAssetsState.selectedFile ?? selectedFile;
    if (!activeDocumentFile) {
      return;
    }

    const nextDocumentLoadState = resolveRuntimeRobotReadyDocumentLoadState({
      activeFile: activeDocumentFile,
      currentState: liveAssetsState.documentLoadState,
    });
    if (!nextDocumentLoadState) {
      return;
    }

    setDocumentLoadState(nextDocumentLoadState);
  }, [previewFile, selectedFile, setDocumentLoadState]);

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

      let committedRobotData = result.robotData;
      if (resolvedSelectedFile.format === 'usd') {
        const hasFreshUsdHydrationSnapshot = Boolean(result.usdSceneSnapshot);
        const existingSceneSnapshot = hasFreshUsdHydrationSnapshot
          ? null
          : liveAssetsState.getUsdSceneSnapshot(resolvedSelectedFile.name);
        const storedPreparedExportCache = liveAssetsState.getUsdPreparedExportCache(
          resolvedSelectedFile.name,
        );
        if (hasFreshUsdHydrationSnapshot && storedPreparedExportCache) {
          liveAssetsState.setUsdPreparedExportCache(resolvedSelectedFile.name, null);
        }
        const existingPreparedExportCache = hasFreshUsdHydrationSnapshot
          ? null
          : storedPreparedExportCache;
        let resolvedPreparedExportCache = existingPreparedExportCache;
        try {
          const hydratedRobotData = resolveUsdHydrationRobotData({
            resolution: result,
            allowSynchronousPreparedCacheFromSnapshot: false,
            existingPreparedExportCache,
            prepareExportCacheFromSnapshot: prepareUsdExportCacheFromSnapshot,
          });
          committedRobotData = hydratedRobotData.robotData;
          resolvedPreparedExportCache =
            hydratedRobotData.preparedExportCache ?? existingPreparedExportCache;
          if (!existingPreparedExportCache && hydratedRobotData.preparedExportCache) {
            liveAssetsState.setUsdPreparedExportCache(
              resolvedSelectedFile.name,
              hydratedRobotData.preparedExportCache,
            );
          }
        } catch (error) {
          scheduleFailFastInDev(
            'useUsdDocumentLifecycle:resolveUsdHydrationRobotData',
            new Error(
              `Failed to materialize USD hydration robot data for "${resolvedSelectedFile.name}".`,
              {
                cause: error,
              },
            ),
          );
        }
        const resolvedRobotSnapshot = createRobotSemanticSnapshot(committedRobotData);
        const hydrationPersistencePlan = buildUsdHydrationPersistencePlan({
          resolution: result,
          existingSceneSnapshot,
          existingPreparedExportCache,
        });
        const shouldBuildPreparedHydrationExportCache = Boolean(
          hydrationPersistencePlan.shouldSeedPreparedExportCache &&
          hydrationPersistencePlan.sceneSnapshot &&
          !resolvedPreparedExportCache &&
          canPrepareUsdExportCacheFromSnapshot(
            hydrationPersistencePlan.sceneSnapshot as UsdSceneSnapshot | null,
          ),
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
          hadPreparedExportCache: Boolean(resolvedPreparedExportCache),
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
          committedRobotData,
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
            linkCount: Object.keys(committedRobotData.links || {}).length,
            jointCount: Object.keys(committedRobotData.joints || {}).length,
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
          preResolvedRobotData: committedRobotData,
        })
          .then((component) => {
            showToast(labels.addedComponent.replace('{name}', component.name), 'success');
            updateProModeRoundtripBaseline(
              isGeneratedWorkspaceUrdfFileName(pendingUsdAssemblyFile.name)
                ? pendingUsdAssemblyFile.name
                : null,
            );
          })
          .catch((error) => {
            scheduleFailFastInDev(
              'useUsdDocumentLifecycle:handleRobotDataResolved:prepareAssemblyComponent',
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
      labels.addedComponent,
      pendingUsdAssemblyFileRef,
      queueUsdPreparedExportCacheBuild,
      selectedFile,
      setRobot,
      setSelection,
      showToast,
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
      const mappedProgressPercent = mapViewerDocumentLoadEventToDocumentLoadPercent(
        activeDocumentFile.format,
        event,
      );
      const nextProgressPercent =
        event.status === 'error'
          ? 0
          : event.status === 'ready'
            ? 100
            : currentDocumentLoadState.fileName === activeDocumentFile.name &&
                (currentDocumentLoadState.status === 'loading' ||
                  currentDocumentLoadState.status === 'hydrating')
              ? Math.max(currentDocumentLoadState.progressPercent ?? 0, mappedProgressPercent)
              : mappedProgressPercent;

      const nextDocumentLoadState: DocumentLoadState = {
        status: nextStatus,
        fileName: activeDocumentFile.name,
        format: activeDocumentFile.format,
        error:
          event.status === 'error'
            ? (event.error ??
              labels.failedToParseFormat.replace(
                '{format}',
                activeDocumentFile.format.toUpperCase(),
              ))
            : null,
        phase: event.phase ?? null,
        message: event.message ?? null,
        progressMode: 'percent',
        progressPercent: nextProgressPercent,
        loadedCount: null,
        totalCount: null,
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
      labels.failedToParseFormat,
      pendingUsdAssemblyFileRef,
      previewFile,
      setDocumentLoadState,
    ],
  );

  const handleViewerRuntimeRobotLoaded = useCallback(() => {
    commitRuntimeReadyDocumentLoadState();
  }, [commitRuntimeReadyDocumentLoadState]);

  const handleViewerRuntimeSceneReadyForDisplay = useCallback(() => {
    commitRuntimeReadyDocumentLoadState();
  }, [commitRuntimeReadyDocumentLoadState]);

  return {
    handleRobotDataResolved,
    handleViewerDocumentLoadEvent,
    handleViewerRuntimeRobotLoaded,
    handleViewerRuntimeSceneReadyForDisplay,
  };
}
