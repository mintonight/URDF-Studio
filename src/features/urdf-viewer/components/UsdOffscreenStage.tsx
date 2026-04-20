import { Html } from '@react-three/drei';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { ViewerLoadingHud } from './ViewerLoadingHud';
import { normalizeLoadingProgress } from '@/shared/components/3d/loadingHudState';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import { useAssetsStore } from '@/store';
import { JointType, type RobotFile } from '@/types';
import type {
  ToolMode,
  ViewerProps,
  ViewerDocumentLoadEvent,
  ViewerInteractiveLayer,
  ViewerRuntimeStageBridge,
  UsdLoadingPhaseLabels,
} from '../types';
import type { ViewerRobotDataResolution } from '../utils/viewerRobotData';
import type {
  OffscreenViewerInteractionSelection,
  UsdOffscreenViewerInitRequest,
  UsdOffscreenViewerInteractionState,
  UsdOffscreenViewerWorkerRequest,
  UsdOffscreenViewerWorkerResponse,
} from '../utils/usdOffscreenViewerProtocol';
import { normalizeUsdBootstrapDocumentLoadEvent } from '../utils/usdBootstrapDocumentLoadEvent';
import { createUsdViewerRuntimeRobot } from '../utils/usdViewerRuntimeRobot';
import { buildViewerLoadingHudState } from '../utils/viewerLoadingHud';
import { supportsUsdWorkerRenderer } from '../utils/usdWorkerRendererSupport';
import { resolveUsdOffscreenCanvasPresentation } from '../utils/usdOffscreenCanvasPresentation';
import { unwrapContinuousJointAngle } from '@/shared/utils/continuousJointAngle';
import {
  clampUsdRuntimeJointAngleDegrees,
  createUsdRuntimeJointInfo,
  radiansToDegrees,
  type UsdRuntimeJointInfoLike,
} from '../utils/usdRuntimeJointInfo';
import {
  disposeUsdOffscreenViewerStageInBackground,
  prepareSharedUsdOffscreenViewerStageOpenDispatch,
} from '../utils/usdOffscreenViewerWorkerClient';
import { prepareUsdPreparedExportCacheWithWorker } from '../utils/usdPreparedExportCacheWorkerBridge';
import {
  canPrepareUsdExportCacheFromSnapshot,
  resolveUsdExportResolution,
} from '../utils/usdExportBundle';
import { recordUsdStageLoadDebug } from '@/shared/debug/usdStageLoadDebug';

interface UsdOffscreenStageProps {
  resolvedTheme?: 'light' | 'dark';
  active?: boolean;
  sourceFile: RobotFile;
  availableFiles: RobotFile[];
  assets: Record<string, string>;
  groundPlaneOffset?: number;
  showVisual: boolean;
  showCollision: boolean;
  showCollisionAlwaysOnTop: boolean;
  showOrigins: boolean;
  showOriginsOverlay: boolean;
  originSize: number;
  loadingLabel: string;
  loadingDetailLabel: string;
  loadingPhaseLabels: UsdLoadingPhaseLabels;
  onRobotDataResolved?: (result: ViewerRobotDataResolution) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  selection?: ViewerProps['selection'];
  hoveredSelection?: ViewerProps['hoveredSelection'];
  hoverSelectionEnabled?: boolean;
  onHover?: ViewerProps['onHover'];
  onMeshSelect?: ViewerProps['onMeshSelect'];
  interactionLayerPriority?: readonly ViewerInteractiveLayer[];
  toolMode: ToolMode;
  runtimeBridge?: ViewerRuntimeStageBridge;
  registerAutoFitGroundHandler?: ((handler: (() => void) | null) => void) | null;
  retainReadyAsLoadingDuringBootstrapHandoff?: boolean;
}

function toOffscreenInteractionSelection(
  selection?: ViewerProps['selection'] | ViewerProps['hoveredSelection'],
): OffscreenViewerInteractionSelection | null {
  if (!selection || !selection.type || !selection.id) {
    return null;
  }

  return {
    type: selection.type,
    id: selection.id,
    subType: selection.subType,
    objectIndex: selection.objectIndex,
    helperKind: selection.helperKind,
  };
}

function buildInitialInteractionState({
  toolMode,
  selection,
  hoveredSelection,
  hoverSelectionEnabled,
  interactionLayerPriority,
}: {
  toolMode: ToolMode;
  selection?: ViewerProps['selection'];
  hoveredSelection?: ViewerProps['hoveredSelection'];
  hoverSelectionEnabled: boolean;
  interactionLayerPriority?: readonly ViewerInteractiveLayer[];
}): UsdOffscreenViewerInteractionState {
  return {
    toolMode,
    selection: toOffscreenInteractionSelection(selection),
    hoveredSelection: toOffscreenInteractionSelection(hoveredSelection),
    hoverSelectionEnabled,
    interactionLayerPriority: interactionLayerPriority ? [...interactionLayerPriority] : [],
  };
}

function getCanvasPointerPosition(event: ReactPointerEvent<HTMLCanvasElement>): {
  x: number;
  y: number;
} {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function resolveRuntimeProxyJointAngle(
  joint:
    | {
        type?: string | null;
      }
    | null
    | undefined,
  angleRad: number,
  referenceAngleRad: number | null | undefined,
) {
  if (joint?.type !== JointType.CONTINUOUS) {
    return angleRad;
  }

  return Number.isFinite(referenceAngleRad)
    ? unwrapContinuousJointAngle(angleRad, Number(referenceAngleRad))
    : angleRad;
}

export function UsdOffscreenStage({
  resolvedTheme = 'light',
  active = true,
  sourceFile,
  availableFiles,
  assets,
  groundPlaneOffset = 0,
  showVisual,
  showCollision,
  showCollisionAlwaysOnTop,
  showOrigins,
  showOriginsOverlay,
  originSize,
  loadingLabel,
  loadingDetailLabel,
  loadingPhaseLabels,
  onRobotDataResolved,
  onDocumentLoadEvent,
  selection,
  hoveredSelection,
  hoverSelectionEnabled = true,
  onHover,
  onMeshSelect,
  interactionLayerPriority,
  toolMode,
  runtimeBridge,
  registerAutoFitGroundHandler = null,
  retainReadyAsLoadingDuringBootstrapHandoff = false,
}: UsdOffscreenStageProps) {
  const workerRef = useRef<Worker | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const initCompleteRef = useRef(false);
  const onDocumentLoadEventRef = useRef(onDocumentLoadEvent);
  const onRobotDataResolvedRef = useRef(onRobotDataResolved);
  const onHoverRef = useRef(onHover);
  const onMeshSelectRef = useRef(onMeshSelect);
  const jointInfoByLinkPathRef = useRef(new Map<string, UsdRuntimeJointInfoLike>());
  const lastRobotResolutionRef = useRef<ViewerRobotDataResolution | null>(null);
  const runtimeRobotProxyRef = useRef<any | null>(null);
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setErrorMessage] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<ViewerDocumentLoadEvent | null>({
    status: 'loading',
    phase: 'checking-path',
    message: null,
    progressMode: 'indeterminate',
    progressPercent: null,
    loadedCount: null,
    totalCount: null,
  });

  const postWorkerMessage = useCallback((message: UsdOffscreenViewerWorkerRequest) => {
    workerRef.current?.postMessage(message);
  }, []);

  const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerElement(node);
  }, []);

  const handleCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    setCanvasElement(node);
  }, []);

  useEffect(() => {
    onDocumentLoadEventRef.current = onDocumentLoadEvent;
  }, [onDocumentLoadEvent]);

  useEffect(() => {
    onRobotDataResolvedRef.current = onRobotDataResolved;
  }, [onRobotDataResolved]);

  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    onMeshSelectRef.current = onMeshSelect;
  }, [onMeshSelect]);

  useEffect(() => {
    runtimeBridge?.onRobotResolved?.(null);
    runtimeBridge?.onActiveJointChange?.(null);
    runtimeBridge?.onJointAnglesChange?.({});
    runtimeRobotProxyRef.current = null;
    lastRobotResolutionRef.current = null;
    jointInfoByLinkPathRef.current.clear();

    return () => {
      runtimeBridge?.onRobotResolved?.(null);
      runtimeBridge?.onActiveJointChange?.(null);
      runtimeBridge?.onJointAnglesChange?.({});
      runtimeRobotProxyRef.current = null;
      lastRobotResolutionRef.current = null;
      jointInfoByLinkPathRef.current.clear();
    };
  }, [runtimeBridge]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!supportsUsdWorkerRenderer()) {
      const nextError = 'USD offscreen worker renderer is unavailable in this browser context.';
      setErrorMessage(nextError);
      setIsLoading(false);
      onDocumentLoadEventRef.current?.({
        status: 'error',
        phase: null,
        message: null,
        progressPercent: null,
        loadedCount: null,
        totalCount: null,
        error: nextError,
      });
      return;
    }

    if (!canvasElement || !containerElement || initCompleteRef.current) {
      return;
    }

    let resizeObserver: ResizeObserver | null = null;
    let worker: Worker | null = null;
    let disposed = false;

    const handleWorkerMessage = (event: MessageEvent<UsdOffscreenViewerWorkerResponse>) => {
      const message = event.data;
      if (!message) {
        return;
      }

      switch (message.type) {
        case 'progress': {
          setLoadingProgress(
            normalizeLoadingProgress<ViewerDocumentLoadEvent>({
              status: 'loading',
              phase: message.progress.phase,
              progressMode: message.progress.progressMode ?? null,
              message: message.progress.message ?? null,
              progressPercent: message.progress.progressPercent ?? null,
              loadedCount: message.progress.loadedCount ?? null,
              totalCount: message.progress.totalCount ?? null,
            }),
          );
          return;
        }
        case 'document-load': {
          const normalizedDocumentLoadEvent =
            message.event.status === 'loading'
              ? normalizeLoadingProgress<ViewerDocumentLoadEvent>(message.event)
              : message.event;
          const normalizedBootstrapEvent = normalizeUsdBootstrapDocumentLoadEvent(message.event, {
            useUsdOffscreenBootstrap: retainReadyAsLoadingDuringBootstrapHandoff,
          });
          if (normalizedDocumentLoadEvent.status === 'loading') {
            setIsLoading(true);
            setLoadingProgress(normalizedDocumentLoadEvent);
          } else if (normalizedDocumentLoadEvent.status === 'ready') {
            setIsLoading(normalizedBootstrapEvent.status === 'loading');
            setErrorMessage(null);
            setLoadingProgress(normalizedBootstrapEvent);
          } else if (normalizedDocumentLoadEvent.status === 'error') {
            setIsLoading(false);
            setErrorMessage(
              normalizedDocumentLoadEvent.error || 'Failed to load USD stage in offscreen worker',
            );
            setLoadingProgress(normalizedDocumentLoadEvent);
          }
          onDocumentLoadEventRef.current?.(normalizedDocumentLoadEvent);
          return;
        }
        case 'robot-data': {
          lastRobotResolutionRef.current = message.resolution;
          jointInfoByLinkPathRef.current = new Map(
            Object.entries(message.resolution.childLinkPathByJointId).flatMap(
              ([jointId, childLinkPath]) => {
                const joint = message.resolution.robotData.joints[jointId];
                if (!joint || !childLinkPath) {
                  return [];
                }

                return [[childLinkPath, createUsdRuntimeJointInfo(joint, joint.angle)]];
              },
            ),
          );
          runtimeRobotProxyRef.current = createUsdViewerRuntimeRobot({
            resolution: message.resolution,
            linkRotationController: {
              apply: () => false,
              getJointInfoForLink: (linkPath: string) =>
                jointInfoByLinkPathRef.current.get(linkPath) ?? null,
              setJointAngleForLink: (linkPath: string, angleDeg: number) => {
                const resolution = lastRobotResolutionRef.current;
                const jointId = Object.entries(resolution?.childLinkPathByJointId || {}).find(
                  ([, candidatePath]) => candidatePath === linkPath,
                )?.[0];
                const joint = jointId ? resolution?.robotData.joints[jointId] : undefined;
                const clampedAngleDeg = clampUsdRuntimeJointAngleDegrees(joint, angleDeg);
                const nextInfo = createUsdRuntimeJointInfo(
                  joint,
                  (clampedAngleDeg * Math.PI) / 180,
                );
                jointInfoByLinkPathRef.current.set(linkPath, nextInfo);

                if (jointId) {
                  workerRef.current?.postMessage({
                    type: 'set-joint-angle',
                    jointId,
                    angleRad: (clampedAngleDeg * Math.PI) / 180,
                  });
                  if (runtimeRobotProxyRef.current?.joints?.[jointId]) {
                    const proxyJoint = runtimeRobotProxyRef.current.joints[jointId];
                    proxyJoint.angle = resolveRuntimeProxyJointAngle(
                      joint,
                      (clampedAngleDeg * Math.PI) / 180,
                      proxyJoint.angle,
                    );
                  }
                }

                return nextInfo;
              },
            },
          });
          runtimeBridge?.onRobotResolved?.(runtimeRobotProxyRef.current);
          onRobotDataResolvedRef.current?.(message.resolution);
          return;
        }
        case 'scene-snapshot': {
          const normalizedMessageStagePath = String(message.stageSourcePath || '').replace(
            /^\/+/,
            '',
          );
          const normalizedSourceFileName = String(sourceFile.name || '').replace(/^\/+/, '');
          const debugSourceFileName = normalizedSourceFileName || normalizedMessageStagePath;
          if (
            normalizedMessageStagePath &&
            normalizedSourceFileName &&
            normalizedMessageStagePath !== normalizedSourceFileName
          ) {
            return;
          }

          const assetsState = useAssetsStore.getState();
          const hasExistingResolution = Boolean(lastRobotResolutionRef.current);
          const existingResolution =
            lastRobotResolutionRef.current ??
            resolveUsdExportResolution(message.snapshot, {
              fileName: sourceFile.name,
            });
          const existingPreparedCache = assetsState.getUsdPreparedExportCache(sourceFile.name);
          const canPrepareSnapshot = canPrepareUsdExportCacheFromSnapshot(message.snapshot);
          assetsState.setUsdSceneSnapshot(sourceFile.name, message.snapshot);
          if (debugSourceFileName) {
            recordUsdStageLoadDebug({
              sourceFileName: debugSourceFileName,
              step: 'commit-worker-scene-snapshot',
              status: 'resolved',
              timestamp: Date.now(),
              detail: {
                stageSourcePath: normalizedMessageStagePath || null,
                hasExistingResolution,
                derivedResolution: !hasExistingResolution && Boolean(existingResolution),
                hasExistingPreparedCache: Boolean(existingPreparedCache),
                canPrepareSnapshot,
                positionBufferLength: Number(message.snapshot.buffers?.positions?.length ?? 0),
              },
            });
          }

          if (existingResolution) {
            lastRobotResolutionRef.current = {
              ...existingResolution,
              usdSceneSnapshot: message.snapshot,
            };
          }

          if (!existingResolution || !canPrepareSnapshot) {
            return;
          }

          assetsState.setUsdPreparedExportCache(sourceFile.name, null);
          if (debugSourceFileName) {
            recordUsdStageLoadDebug({
              sourceFileName: debugSourceFileName,
              step: 'prepare-deferred-usd-export-cache',
              status: 'pending',
              timestamp: Date.now(),
              detail: {
                stageSourcePath: normalizedMessageStagePath || null,
              },
            });
          }
          void prepareUsdPreparedExportCacheWithWorker(message.snapshot, existingResolution)
            .then((preparedCache) => {
              useAssetsStore.getState().setUsdPreparedExportCache(sourceFile.name, preparedCache);
              if (debugSourceFileName) {
                recordUsdStageLoadDebug({
                  sourceFileName: debugSourceFileName,
                  step: 'prepare-deferred-usd-export-cache',
                  status: 'resolved',
                  timestamp: Date.now(),
                  detail: {
                    stageSourcePath: normalizedMessageStagePath || null,
                    meshFileCount: Object.keys(preparedCache?.meshFiles || {}).length,
                  },
                });
              }
            })
            .catch((error) => {
              const reason = error instanceof Error ? error.message : String(error);
              if (debugSourceFileName) {
                recordUsdStageLoadDebug({
                  sourceFileName: debugSourceFileName,
                  step: 'prepare-deferred-usd-export-cache',
                  status: 'rejected',
                  timestamp: Date.now(),
                  detail: {
                    stageSourcePath: normalizedMessageStagePath || null,
                    error: reason,
                  },
                });
              }
              scheduleFailFastInDev(
                'UsdOffscreenStage:prepareUsdPreparedExportCacheWithWorker',
                new Error(
                  `Failed to prepare USD export cache for "${sourceFile.name}" after deferred scene snapshot hydration: ${reason}`,
                  {
                    cause: error,
                  },
                ),
              );
            });
          return;
        }
        case 'selection-change': {
          if (!message.selection) {
            runtimeBridge?.onSelectionChange?.('link', '');
            return;
          }

          runtimeBridge?.onSelectionChange?.(
            message.selection.type,
            message.selection.id,
            message.selection.subType,
            message.selection.helperKind,
          );

          if (message.meshSelection) {
            onMeshSelectRef.current?.(
              message.meshSelection.linkId,
              null,
              message.meshSelection.objectIndex,
              message.meshSelection.objectType,
            );
          }
          return;
        }
        case 'hover-change': {
          const nextHover = message.hoveredSelection;
          onHoverRef.current?.(
            nextHover?.type ?? null,
            nextHover?.id ?? null,
            nextHover?.subType,
            nextHover?.objectIndex,
            nextHover?.helperKind,
          );
          return;
        }
        case 'joint-angles-change': {
          const resolution = lastRobotResolutionRef.current;
          if (resolution) {
            Object.entries(message.jointAngles).forEach(([jointId, angleRad]) => {
              const childLinkPath = resolution.childLinkPathByJointId[jointId];
              const existingInfo = childLinkPath
                ? (jointInfoByLinkPathRef.current.get(childLinkPath) ?? {})
                : {};
              if (childLinkPath) {
                jointInfoByLinkPathRef.current.set(childLinkPath, {
                  ...existingInfo,
                  angleDeg: radiansToDegrees(angleRad),
                });
              }
              if (runtimeRobotProxyRef.current?.joints?.[jointId]) {
                const proxyJoint = runtimeRobotProxyRef.current.joints[jointId];
                proxyJoint.angle = resolveRuntimeProxyJointAngle(
                  resolution.robotData.joints[jointId],
                  angleRad,
                  proxyJoint.angle,
                );
              }
            });
          }

          runtimeBridge?.onJointAnglesChange?.(message.jointAngles);
          return;
        }
        case 'load-debug': {
          recordUsdStageLoadDebug(message.entry);
          return;
        }
        case 'fatal-error': {
          setIsLoading(false);
          setErrorMessage(message.error);
          return;
        }
        default: {
          return;
        }
      }
    };

    const handleWorkerError = (event: ErrorEvent) => {
      const nextError =
        event.error instanceof Error
          ? event.error.message
          : event.message || 'USD offscreen worker crashed';
      setIsLoading(false);
      setErrorMessage(nextError);
      onDocumentLoadEventRef.current?.({
        status: 'error',
        phase: null,
        message: null,
        progressPercent: null,
        loadedCount: null,
        totalCount: null,
        error: nextError,
      });
    };

    const handleWorkerMessageError = () => {
      const nextError = 'USD offscreen worker message deserialization failed';
      setIsLoading(false);
      setErrorMessage(nextError);
      onDocumentLoadEventRef.current?.({
        status: 'error',
        phase: null,
        message: null,
        progressPercent: null,
        loadedCount: null,
        totalCount: null,
        error: nextError,
      });
    };

    const detachWorkerListeners = () => {
      if (!worker) {
        return;
      }

      worker.removeEventListener('message', handleWorkerMessage);
      worker.removeEventListener('error', handleWorkerError);
      worker.removeEventListener('messageerror', handleWorkerMessageError);
    };

    const reportInitializationError = (error: unknown) => {
      const nextError =
        error instanceof Error ? error.message : 'Failed to start USD offscreen worker';
      setIsLoading(false);
      setErrorMessage(nextError);
      onDocumentLoadEventRef.current?.({
        status: 'error',
        phase: null,
        message: null,
        progressPercent: null,
        loadedCount: null,
        totalCount: null,
        error: nextError,
      });
    };

    const initializeWorker = async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        onDocumentLoadEventRef.current?.({
          status: 'loading',
          phase: 'checking-path',
          message: null,
          progressMode: 'indeterminate',
          progressPercent: null,
          loadedCount: null,
          totalCount: null,
        });

        const stageOpenDispatch = prepareSharedUsdOffscreenViewerStageOpenDispatch(
          sourceFile,
          availableFiles,
          assets,
        );
        worker = stageOpenDispatch.worker as Worker;
        workerRef.current = worker;
        worker.addEventListener('message', handleWorkerMessage);
        worker.addEventListener('error', handleWorkerError);
        worker.addEventListener('messageerror', handleWorkerMessageError);
        if (disposed) {
          detachWorkerListeners();
          return;
        }

        const rect = containerElement.getBoundingClientRect();
        const offscreenCanvas = canvasElement.transferControlToOffscreen();
        const initRequest: UsdOffscreenViewerInitRequest = {
          type: 'init',
          canvas: offscreenCanvas,
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
          devicePixelRatio: window.devicePixelRatio || 1,
          theme: resolvedTheme,
          active,
          groundPlaneOffset,
          showVisual,
          showCollision,
          showCollisionAlwaysOnTop,
          showOrigins,
          showOriginsOverlay,
          originSize,
          sourceFile: stageOpenDispatch.sourceFile,
          stageOpenContextKey: stageOpenDispatch.stageOpenContextKey,
          stageOpenContext: stageOpenDispatch.stageOpenContext,
          stageOpenContextCacheHit: stageOpenDispatch.stageOpenContextCacheHit,
          initialInteractionState: buildInitialInteractionState({
            toolMode,
            selection,
            hoveredSelection,
            hoverSelectionEnabled,
            interactionLayerPriority,
          }),
        };

        worker.postMessage(initRequest, [offscreenCanvas]);
        stageOpenDispatch.commitStageOpenContext();
        initCompleteRef.current = true;

        resizeObserver = new ResizeObserver((entries) => {
          const nextEntry = entries[0];
          if (!nextEntry) {
            return;
          }

          const nextRect = nextEntry.contentRect;
          postWorkerMessage({
            type: 'resize',
            width: Math.max(1, Math.round(nextRect.width)),
            height: Math.max(1, Math.round(nextRect.height)),
            devicePixelRatio: window.devicePixelRatio || 1,
          });
        });

        resizeObserver.observe(containerElement);
      } catch (error) {
        detachWorkerListeners();
        workerRef.current = null;
        disposeUsdOffscreenViewerStageInBackground();
        if (!disposed) {
          reportInitializationError(error);
        }
      }
    };

    void initializeWorker();

    return () => {
      disposed = true;
      initCompleteRef.current = false;
      resizeObserver?.disconnect();
      detachWorkerListeners();
      disposeUsdOffscreenViewerStageInBackground();
      workerRef.current = null;
    };
  }, [canvasElement, containerElement, resolvedTheme]);

  useEffect(() => {
    postWorkerMessage({
      type: 'set-visibility',
      showVisual,
      showCollision,
      showCollisionAlwaysOnTop,
    });
  }, [postWorkerMessage, showCollision, showCollisionAlwaysOnTop, showVisual]);

  useEffect(() => {
    postWorkerMessage({
      type: 'set-decoration-state',
      showOrigins,
      showOriginsOverlay,
      originSize,
    });
  }, [originSize, postWorkerMessage, showOrigins, showOriginsOverlay]);

  useEffect(() => {
    postWorkerMessage({
      type: 'set-ground-offset',
      groundPlaneOffset,
    });
  }, [groundPlaneOffset, postWorkerMessage]);

  useEffect(() => {
    postWorkerMessage({
      type: 'set-active',
      active,
    });
  }, [active, postWorkerMessage]);

  useEffect(() => {
    if (!registerAutoFitGroundHandler) {
      return;
    }

    if (!active) {
      return;
    }

    registerAutoFitGroundHandler(() => {
      postWorkerMessage({ type: 'auto-fit-ground' });
    });

    return () => {
      registerAutoFitGroundHandler(null);
    };
  }, [active, postWorkerMessage, registerAutoFitGroundHandler]);

  useEffect(() => {
    postWorkerMessage({
      type: 'set-interaction-state',
      toolMode,
      selection: toOffscreenInteractionSelection(selection),
      hoveredSelection: toOffscreenInteractionSelection(hoveredSelection),
      hoverSelectionEnabled,
      interactionLayerPriority: interactionLayerPriority ? [...interactionLayerPriority] : [],
    });
  }, [
    hoverSelectionEnabled,
    hoveredSelection,
    interactionLayerPriority,
    postWorkerMessage,
    selection,
    toolMode,
  ]);

  const loadingHudState = useMemo(
    () =>
      buildViewerLoadingHudState({
        phase: loadingProgress?.phase,
        progressMode: loadingProgress?.progressMode,
        fallbackDetail: loadingDetailLabel,
        loadedCount: loadingProgress?.loadedCount,
        progressPercent: loadingProgress?.progressPercent,
        totalCount: loadingProgress?.totalCount,
      }),
    [
      loadingDetailLabel,
      loadingProgress?.loadedCount,
      loadingProgress?.progressPercent,
      loadingProgress?.totalCount,
    ],
  );

  const loadingDetail = loadingProgress?.message || loadingDetailLabel;
  const loadingStageLabel =
    loadingProgress?.phase &&
    loadingProgress.phase !== 'ready' &&
    loadingProgress.phase in loadingPhaseLabels
      ? loadingPhaseLabels[loadingProgress.phase as keyof typeof loadingPhaseLabels]
      : undefined;
  const offscreenCanvasPresentation = resolveUsdOffscreenCanvasPresentation(resolvedTheme);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!active) {
        return;
      }

      const pointer = getCanvasPointerPosition(event);
      activePointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      postWorkerMessage({
        type: 'pointer-down',
        pointerId: event.pointerId,
        button: event.button,
        localX: pointer.x,
        localY: pointer.y,
      });
    },
    [active, postWorkerMessage],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!active) {
        return;
      }

      const pointer = getCanvasPointerPosition(event);
      postWorkerMessage({
        type: 'pointer-move',
        pointerId: event.pointerId,
        buttons: event.buttons,
        localX: pointer.x,
        localY: pointer.y,
      });
    },
    [active, postWorkerMessage],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const pointer = getCanvasPointerPosition(event);

      if (activePointerIdRef.current === event.pointerId) {
        activePointerIdRef.current = null;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      postWorkerMessage({
        type: 'pointer-up',
        pointerId: event.pointerId,
        buttons: event.buttons,
        localX: pointer.x,
        localY: pointer.y,
      });
    },
    [postWorkerMessage],
  );

  const handlePointerLeave = useCallback(() => {
    activePointerIdRef.current = null;
    postWorkerMessage({ type: 'pointer-leave' });
  }, [postWorkerMessage]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      if (!active) {
        return;
      }

      event.preventDefault();
      postWorkerMessage({
        type: 'wheel',
        deltaY: event.deltaY,
      });
    },
    [active, postWorkerMessage],
  );

  return (
    <Html fullscreen>
      <div ref={handleContainerRef} className="absolute inset-0">
        <canvas
          ref={handleCanvasRef}
          data-testid="usd-offscreen-canvas"
          className="block h-full w-full"
          style={{
            backgroundColor: offscreenCanvasPresentation.backgroundColor,
            height: '100%',
            opacity: active ? 1 : 0,
            pointerEvents: active ? 'auto' : 'none',
            touchAction: 'none',
            userSelect: 'none',
            width: '100%',
          }}
          onContextMenuCapture={(event) => event.preventDefault()}
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerLeave={handlePointerLeave}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        />

        {isLoading && !onDocumentLoadEvent ? (
          <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-4">
            <ViewerLoadingHud
              title={loadingLabel}
              detail={loadingDetail}
              progress={loadingHudState.progress}
              progressMode={loadingHudState.progressMode}
              statusLabel={loadingHudState.statusLabel}
              stageLabel={loadingStageLabel}
              delayMs={0}
            />
          </div>
        ) : null}
      </div>
    </Html>
  );
}
