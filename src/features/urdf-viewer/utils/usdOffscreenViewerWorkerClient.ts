import { logRuntimeFailure } from '@/core/utils/runtimeDiagnostics';
import type { RobotFile } from '@/types';
import {
  buildUsdStageOpenPreparationWorkerDispatch,
  type PreparedUsdStageOpenWorkerDispatch,
} from './usdStageOpenPreparationWorkerPayload.ts';
import type {
  UsdOffscreenViewerWorkerRequest,
  UsdOffscreenViewerWorkerResponse,
} from './usdOffscreenViewerProtocol';

interface WorkerLike {
  addEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  postMessage: (message: UsdOffscreenViewerWorkerRequest, transfer?: Transferable[]) => void;
  terminate: () => void;
}

interface CreateUsdOffscreenViewerWorkerClientOptions {
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
}

type WorkerResponseMessageEvent = MessageEvent<UsdOffscreenViewerWorkerResponse | undefined>;
type WorkerFailureEvent = ErrorEvent | MessageEvent<unknown> | Event;

export interface UsdOffscreenViewerWorkerClient {
  disposeStage: () => void;
  getWorker: () => WorkerLike;
  prepareStageOpenDispatch: (
    sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>,
    availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>,
    assets: Record<string, string>,
  ) => {
    worker: WorkerLike;
    sourceFile: PreparedUsdStageOpenWorkerDispatch['sourceFile'];
    stageOpenContextKey?: string;
    stageOpenContext: PreparedUsdStageOpenWorkerDispatch['contextSnapshot'];
    stageOpenContextCacheHit: boolean;
    commitStageOpenContext: () => void;
  };
  prewarmRuntime: () => void;
  shutdown: () => void;
}

export function createUsdOffscreenViewerWorkerClient({
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = () =>
    new Worker(new URL('../workers/usdOffscreenViewer.worker.ts', import.meta.url), {
      type: 'module',
    }),
}: CreateUsdOffscreenViewerWorkerClientOptions = {}): UsdOffscreenViewerWorkerClient {
  let sharedWorker: WorkerLike | null = null;
  const syncedContextKeys = new Set<string>();
  const syncedContextKeyOrder: string[] = [];
  const CONTEXT_CACHE_LIMIT = 24;
  const handleSharedWorkerMessage: EventListener = (event): void => {
    const message = (event as WorkerResponseMessageEvent).data;
    if (!message || typeof message !== 'object') {
      return;
    }

    if (
      message.type === 'load-debug' &&
      message.entry?.status === 'rejected' &&
      message.entry?.detail?.prewarmOnly === true
    ) {
      return;
    }

    if (message.type === 'fatal-error') {
      logRuntimeFailure(
        'usdOffscreenViewerWorker',
        new Error(message.error || 'USD offscreen viewer worker reported a fatal error.'),
        'warn',
      );
    }
  };
  const handleSharedWorkerError: EventListener = (event): void => {
    const workerEvent = event as WorkerFailureEvent;
    const errorEvent = workerEvent as Partial<ErrorEvent>;
    logRuntimeFailure(
      'usdOffscreenViewerWorker',
      errorEvent.error ??
        new Error(
          errorEvent.message ||
            (workerEvent.type === 'messageerror'
              ? 'USD offscreen viewer worker message deserialization failed.'
              : 'USD offscreen viewer worker failed.'),
        ),
      'warn',
    );
  };

  const getWorker = (): WorkerLike => {
    if (!canUseWorker()) {
      throw new Error('USD offscreen viewer worker is unavailable in this environment');
    }

    if (!sharedWorker) {
      syncedContextKeys.clear();
      syncedContextKeyOrder.splice(0, syncedContextKeyOrder.length);
      sharedWorker = createWorker();
      sharedWorker.addEventListener('message', handleSharedWorkerMessage);
      sharedWorker.addEventListener('error', handleSharedWorkerError);
      sharedWorker.addEventListener('messageerror', handleSharedWorkerError);
    }

    return sharedWorker;
  };

  const postSharedMessage = (
    message: UsdOffscreenViewerWorkerRequest,
    transfer?: Transferable[],
  ): void => {
    getWorker().postMessage(message, transfer);
  };

  const commitStageOpenContextKey = (contextKey?: string): void => {
    if (!contextKey || syncedContextKeys.has(contextKey)) {
      return;
    }

    syncedContextKeys.add(contextKey);
    syncedContextKeyOrder.push(contextKey);
    while (syncedContextKeyOrder.length > CONTEXT_CACHE_LIMIT) {
      const oldestContextKey = syncedContextKeyOrder.shift();
      if (oldestContextKey) {
        syncedContextKeys.delete(oldestContextKey);
      }
    }
  };

  return {
    getWorker,
    prepareStageOpenDispatch: (sourceFile, availableFiles, assets) => {
      const worker = getWorker();
      const preparedDispatch = buildUsdStageOpenPreparationWorkerDispatch(
        sourceFile,
        availableFiles,
        assets,
      );
      const stageOpenContextKey = preparedDispatch.contextCacheKey ?? undefined;
      const stageOpenContextCacheHit = Boolean(
        stageOpenContextKey &&
        preparedDispatch.contextSnapshot &&
        syncedContextKeys.has(stageOpenContextKey),
      );
      const stageOpenContext = stageOpenContextCacheHit
        ? null
        : (preparedDispatch.contextSnapshot ?? {
            availableFiles: preparedDispatch.availableFiles,
            assets: preparedDispatch.assets,
          });

      return {
        worker,
        sourceFile: preparedDispatch.sourceFile,
        stageOpenContextKey,
        stageOpenContext,
        stageOpenContextCacheHit,
        commitStageOpenContext: () => {
          if (!stageOpenContextCacheHit) {
            commitStageOpenContextKey(stageOpenContextKey);
          }
        },
      };
    },
    prewarmRuntime: () => {
      try {
        postSharedMessage({ type: 'prewarm-runtime' });
      } catch {}
    },
    disposeStage: () => {
      if (!sharedWorker) {
        return;
      }

      try {
        sharedWorker.postMessage({ type: 'dispose-stage' });
      } catch (error) {
        logRuntimeFailure(
          'disposeUsdOffscreenViewerStageInBackground',
          error instanceof Error
            ? error
            : new Error('Failed to dispose the shared USD offscreen viewer stage.'),
          'warn',
        );
      }
    },
    shutdown: () => {
      if (!sharedWorker) {
        return;
      }

      sharedWorker.removeEventListener('message', handleSharedWorkerMessage);
      sharedWorker.removeEventListener('error', handleSharedWorkerError);
      sharedWorker.removeEventListener('messageerror', handleSharedWorkerError);

      try {
        sharedWorker.postMessage({ type: 'dispose' });
      } catch (error) {
        logRuntimeFailure(
          'disposeUsdOffscreenViewerWorker',
          error instanceof Error
            ? error
            : new Error('Failed to dispose the shared USD offscreen viewer worker.'),
          'warn',
        );
      }

      sharedWorker.terminate();
      sharedWorker = null;
      syncedContextKeys.clear();
      syncedContextKeyOrder.splice(0, syncedContextKeyOrder.length);
    },
  };
}

const sharedUsdOffscreenViewerWorkerClient = createUsdOffscreenViewerWorkerClient();

export function getSharedUsdOffscreenViewerWorker(): WorkerLike {
  return sharedUsdOffscreenViewerWorkerClient.getWorker();
}

export function prepareSharedUsdOffscreenViewerStageOpenDispatch(
  sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>,
  availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>,
  assets: Record<string, string>,
): ReturnType<UsdOffscreenViewerWorkerClient['prepareStageOpenDispatch']> {
  return sharedUsdOffscreenViewerWorkerClient.prepareStageOpenDispatch(
    sourceFile,
    availableFiles,
    assets,
  );
}

export function prewarmUsdOffscreenViewerRuntimeInBackground(): void {
  sharedUsdOffscreenViewerWorkerClient.prewarmRuntime();
}

export function disposeUsdOffscreenViewerStageInBackground(): void {
  sharedUsdOffscreenViewerWorkerClient.disposeStage();
}

export function disposeUsdOffscreenViewerWorker(): void {
  sharedUsdOffscreenViewerWorkerClient.shutdown();
}
