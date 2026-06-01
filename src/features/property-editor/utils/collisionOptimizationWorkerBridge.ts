import { analyzeCollisionOptimizationInline } from './collisionOptimizationWorkerAnalysis';
import type {
  CollisionOptimizationInlineAnalyzeArgs,
  CollisionOptimizationWorkerAnalyzeArgs,
  CollisionOptimizationWorkerRequest,
  CollisionOptimizationWorkerResponse,
} from './collisionOptimizationWorkerTypes';
import type { CollisionOptimizationAnalysis } from './collisionOptimization';
import type { WorkerLike } from '@/core/workers/workerPoolClient';

interface CreateCollisionOptimizationWorkerClientOptions {
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
  fallbackToInline?: boolean;
  runInlineAnalysis?: (
    args: CollisionOptimizationInlineAnalyzeArgs,
  ) => Promise<CollisionOptimizationAnalysis>;
}

interface CollisionOptimizationWorkerClient {
  analyze: (
    args: CollisionOptimizationWorkerAnalyzeArgs,
  ) => Promise<CollisionOptimizationAnalysis>;
  dispose: (rejectPendingWith?: unknown) => void;
}

interface PendingRequest {
  args: CollisionOptimizationWorkerAnalyzeArgs;
  reject: (error: unknown) => void;
  resolve: (analysis: CollisionOptimizationAnalysis) => void;
  abortHandler?: () => void;
}

function createAbortError(): DOMException {
  return new DOMException('Collision optimization analysis aborted', 'AbortError');
}

function normalizeWorkerError(message: string, name?: string): Error | DOMException {
  if (name === 'AbortError') {
    return createAbortError();
  }

  const error = new Error(message || 'Collision optimization worker failed');
  error.name = name || error.name;
  return error;
}

export function createCollisionOptimizationWorkerClient({
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = () =>
    new Worker(new URL('../workers/collisionOptimization.worker.ts', import.meta.url), {
      type: 'module',
    }),
  fallbackToInline = true,
  runInlineAnalysis = analyzeCollisionOptimizationInline,
}: CreateCollisionOptimizationWorkerClientOptions = {}): CollisionOptimizationWorkerClient {
  const pendingRequests = new Map<number, PendingRequest>();
  let requestIdCounter = 0;
  let sharedWorker: WorkerLike | null = null;
  let workerUnavailable = false;

  const clearPendingRequest = (requestId: number): PendingRequest | null => {
    const pendingRequest = pendingRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingRequests.delete(requestId);
    if (pendingRequest.abortHandler) {
      pendingRequest.args.signal?.removeEventListener('abort', pendingRequest.abortHandler);
    }
    return pendingRequest;
  };

  const runInline = async (
    requestId: number,
    args: CollisionOptimizationWorkerAnalyzeArgs,
  ): Promise<CollisionOptimizationAnalysis> =>
    await runInlineAnalysis({
      ...args,
      requestId,
    });

  const dispose = (rejectPendingWith?: unknown): void => {
    if (sharedWorker) {
      sharedWorker.removeEventListener('message', handleWorkerMessage as EventListener);
      sharedWorker.removeEventListener('error', handleWorkerError as EventListener);
      sharedWorker.terminate();
      sharedWorker = null;
    }

    if (rejectPendingWith !== undefined) {
      pendingRequests.forEach((request, requestId) => {
        clearPendingRequest(requestId);
        request.reject(rejectPendingWith);
      });
    }
  };

  const fallbackPendingRequestInline = (requestId: number, pendingRequest: PendingRequest): void => {
    void runInline(requestId, pendingRequest.args).then(
      pendingRequest.resolve,
      pendingRequest.reject,
    );
  };

  function handleWorkerMessage(event: MessageEvent<CollisionOptimizationWorkerResponse>): void {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.type === 'progress') {
      const pendingRequest = pendingRequests.get(message.requestId);
      if (!pendingRequest) {
        return;
      }

      pendingRequest.args.onProgress?.({
        requestId: message.requestId,
        stage: message.stage,
        status: message.status,
        completed: message.completed,
        total: message.total,
      });
      return;
    }

    const pendingRequest = clearPendingRequest(message.requestId);
    if (!pendingRequest) {
      return;
    }

    if (message.type === 'result') {
      pendingRequest.resolve(message.analysis);
      return;
    }

    pendingRequest.reject(normalizeWorkerError(message.error, message.name));
  }

  function handleWorkerError(event: ErrorEvent | { error?: unknown; message?: string }): void {
    workerUnavailable = true;
    const error =
      event.error instanceof Error
        ? event.error
        : new Error(event.message || 'Collision optimization worker failed');
    const pendingEntries = Array.from(pendingRequests.entries());
    dispose();

    pendingEntries.forEach(([requestId, pendingRequest]) => {
      clearPendingRequest(requestId);
      if (fallbackToInline && !pendingRequest.args.signal?.aborted) {
        fallbackPendingRequestInline(requestId, pendingRequest);
        return;
      }
      pendingRequest.reject(error);
    });
  }

  const ensureWorker = (): WorkerLike => {
    if (!sharedWorker) {
      sharedWorker = createWorker();
      sharedWorker.addEventListener('message', handleWorkerMessage as EventListener);
      sharedWorker.addEventListener('error', handleWorkerError as EventListener);
    }

    return sharedWorker;
  };

  const analyze = async (
    args: CollisionOptimizationWorkerAnalyzeArgs,
  ): Promise<CollisionOptimizationAnalysis> => {
    const requestId = ++requestIdCounter;

    if (args.signal?.aborted) {
      throw createAbortError();
    }

    if (!canUseWorker() || workerUnavailable) {
      return await runInline(requestId, args);
    }

    return await new Promise<CollisionOptimizationAnalysis>((resolve, reject) => {
      let worker: WorkerLike;

      try {
        worker = ensureWorker();
      } catch (error) {
        workerUnavailable = true;
        if (fallbackToInline) {
          void runInline(requestId, args).then(resolve, reject);
          return;
        }
        reject(error);
        return;
      }

      const abortHandler = () => {
        const pendingRequest = clearPendingRequest(requestId);
        if (!pendingRequest) {
          return;
        }

        try {
          worker.postMessage({
            type: 'cancel',
            requestId,
          } satisfies CollisionOptimizationWorkerRequest);
        } catch {
          // Best effort cancellation; the stale result is ignored because the
          // request is no longer pending.
        }
        reject(createAbortError());
      };
      args.signal?.addEventListener('abort', abortHandler, { once: true });
      pendingRequests.set(requestId, {
        args,
        resolve,
        reject,
        abortHandler,
      });

      try {
        worker.postMessage({
          type: 'analyze',
          requestId,
          source: args.source,
          assets: args.assets,
          settings: args.settings,
          options: args.options,
        } satisfies CollisionOptimizationWorkerRequest);
      } catch (error) {
        clearPendingRequest(requestId);
        workerUnavailable = true;
        dispose(error);
        if (fallbackToInline && !args.signal?.aborted) {
          void runInline(requestId, args).then(resolve, reject);
          return;
        }
        reject(error);
      }
    });
  };

  return {
    analyze,
    dispose,
  };
}

const sharedCollisionOptimizationWorkerClient = createCollisionOptimizationWorkerClient();

export function analyzeCollisionOptimizationWithWorker(
  args: CollisionOptimizationWorkerAnalyzeArgs,
): Promise<CollisionOptimizationAnalysis> {
  return sharedCollisionOptimizationWorkerClient.analyze(args);
}

export function disposeCollisionOptimizationWorker(rejectPendingWith?: unknown): void {
  sharedCollisionOptimizationWorkerClient.dispose(rejectPendingWith);
}
