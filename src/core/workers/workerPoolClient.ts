/**
 * Generic worker pool client factory.
 *
 * Provides the shared infrastructure used by all worker bridges:
 * - Worker pool creation and lifecycle (create, terminate, pick least-loaded)
 * - Pending request tracking with cleanup
 * - Error normalization
 * - `workerUnavailable` flag management
 * - Optional LRU cache with configurable limit
 *
 * Two usage patterns are supported via the same factory:
 * - Pool-based (poolSize > 1): STL/OBJ/Collada parse bridges with LRU caching
 * - Single-worker (poolSize = 1, default): USD/ProjectArchive bridges without caching
 */

// ---- Types ----

export interface WorkerLike {
  addEventListener(type: 'message' | 'error', listener: EventListenerOrEventListenerObject): void;
  removeEventListener(
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface WorkerPoolEntry {
  worker: WorkerLike;
  pendingCount: number;
}

export interface PendingRequest<Result, Progress = unknown> {
  resolve: (value: Result) => void;
  reject: (error: unknown) => void;
  workerEntry?: WorkerPoolEntry;
  onProgress?: (progress: Progress) => void;
}

export interface WorkerPoolClientConfig<Response, Result, Progress = unknown> {
  /** Label for error/log messages (e.g. 'STL parse') */
  label: string;
  /** Factory to create a new Worker instance */
  createWorker: () => WorkerLike;
  /** Check if Worker API is available (default: () => typeof Worker !== 'undefined') */
  canUseWorker?: () => boolean;
  /** Pool size or function returning pool size (default: 1 for single-worker) */
  poolSize?: number | (() => number);
  /** LRU cache limit; 0 or undefined means no caching */
  cacheLimit?: number;

  // Response routing
  getRequestId: (response: Response) => number;
  isError: (response: Response) => boolean;
  getError: (response: Response) => string;
  getResult: (response: Response) => Result;
  /** Optional: check if response is a progress update */
  isProgress?: (response: Response) => boolean;
  /** Optional: extract progress payload and deliver to pending request callback */
  handleProgress?: (response: Response, request: PendingRequest<Result, Progress>) => void;
}

export interface WorkerPoolClient<Result> {
  dispose(rejectPendingWith?: unknown): void;
  clearCache(): void;
  /** Current pending request count (for diagnostics) */
  readonly pendingCount: number;
  /** Whether the worker pool has crashed and is unavailable */
  readonly unavailable: boolean;
  /** Whether workers can be used in this environment */
  readonly canUseWorker: boolean;
  /** Ensure a worker is initialized and pick the least-loaded one */
  ensureWorker(): WorkerPoolEntry;
  /** Dispatch a request to the worker pool and return a promise for the result */
  dispatch(
    request: unknown,
    transfer?: Transferable[],
    onProgress?: (progress: unknown) => void,
  ): Promise<Result>;
  /** Look up cached result by key */
  getCached(key: string): Result | undefined;
  /** Store result in cache */
  setCached(key: string, result: Result): void;
}

// ---- Shared Utilities ----

export function createWorkerError(
  event: ErrorEvent | { error?: unknown; message?: string },
  label: string,
): Error {
  if ((event as ErrorEvent).error instanceof Error) {
    return (event as ErrorEvent).error;
  }

  return new Error((event as { message?: string }).message || `${label} worker failed`);
}

export function resolveDefaultWorkerCount(): number {
  if (typeof navigator === 'undefined') {
    return 1;
  }

  const hardwareConcurrency = Number(navigator.hardwareConcurrency || 2);
  return Math.max(1, Math.min(10, hardwareConcurrency - 1));
}

// ---- Factory ----

export function createWorkerPoolClient<Response, Result, Progress = unknown>(
  config: WorkerPoolClientConfig<Response, Result, Progress>,
): WorkerPoolClient<Result> {
  const {
    label,
    createWorker,
    canUseWorker = () => typeof Worker !== 'undefined',
    cacheLimit = 0,
    getRequestId,
    isError,
    getError,
    getResult,
    isProgress,
    handleProgress,
  } = config;

  const poolSize = config.poolSize ?? 1;
  const resolvePoolSize = typeof poolSize === 'function' ? poolSize : () => poolSize;

  const workerPool: WorkerPoolEntry[] = [];
  const pendingRequests = new Map<number, PendingRequest<Result, Progress>>();
  const resolvedCache = cacheLimit > 0 ? new Map<string, Result>() : null;
  let workerUnavailable = false;
  let nextRequestId = 1;

  // ---- LRU Cache ----

  function touchCache(key: string, result: Result): void {
    if (!resolvedCache) return;

    if (resolvedCache.has(key)) {
      resolvedCache.delete(key);
    }
    resolvedCache.set(key, result);

    while (resolvedCache.size > cacheLimit!) {
      const oldestEntry = resolvedCache.keys().next();
      if (oldestEntry.done) return;
      resolvedCache.delete(oldestEntry.value);
    }
  }

  // ---- Pending Request Management ----

  function clearPendingRequest(requestId: number): PendingRequest<Result, Progress> | null {
    const pendingRequest = pendingRequests.get(requestId) ?? null;
    if (!pendingRequest) return null;

    pendingRequests.delete(requestId);
    if (pendingRequest.workerEntry) {
      pendingRequest.workerEntry.pendingCount = Math.max(
        0,
        pendingRequest.workerEntry.pendingCount - 1,
      );
    }
    return pendingRequest;
  }

  // ---- Worker Lifecycle ----

  function handleWorkerMessage(event: MessageEvent<Response>): void {
    const message = event.data;
    if (!message) return;

    const requestId = getRequestId(message);

    // Progress messages don't clear the pending request
    if (isProgress?.(message)) {
      const pendingRequest = pendingRequests.get(requestId);
      if (pendingRequest) {
        handleProgress!(message, pendingRequest);
      }
      return;
    }

    const pendingRequest = clearPendingRequest(requestId);
    if (!pendingRequest) return;

    if (isError(message)) {
      const workerError = new Error(getError(message) || `${label} worker failed`);
      console.error(`[${label}WorkerBridge] Worker returned an error.`, workerError);
      pendingRequest.reject(workerError);
      return;
    }

    pendingRequest.resolve(getResult(message));
  }

  function handleWorkerError(event: ErrorEvent): void {
    const workerError = createWorkerError(event, label);
    console.error(`[${label}WorkerBridge] ${label} worker crashed.`, workerError);
    workerUnavailable = true;
    disposePool(workerError);
  }

  function createWorkerEntry(): WorkerPoolEntry {
    const worker = createWorker();
    worker.addEventListener('message', handleWorkerMessage as EventListener);
    worker.addEventListener('error', handleWorkerError as EventListener);
    const entry = { worker, pendingCount: 0 };
    workerPool.push(entry);
    return entry;
  }

  function ensureWorker(): WorkerPoolEntry {
    if (workerPool.length === 0) {
      return createWorkerEntry();
    }

    const best = pickLeastLoaded();
    const count = Math.max(1, resolvePoolSize());
    if (best.pendingCount > 0 && workerPool.length < count) {
      return createWorkerEntry();
    }

    return best;
  }

  function pickLeastLoaded(): WorkerPoolEntry {
    let best = workerPool[0];
    for (let i = 1; i < workerPool.length; i += 1) {
      if (workerPool[i].pendingCount < best.pendingCount) {
        best = workerPool[i];
      }
    }
    return best;
  }

  function disposePool(rejectPendingWith?: unknown): void {
    workerPool.forEach((entry) => {
      entry.worker.removeEventListener('message', handleWorkerMessage as EventListener);
      entry.worker.removeEventListener('error', handleWorkerError as EventListener);
      entry.worker.terminate();
    });
    workerPool.length = 0;

    if (rejectPendingWith !== undefined) {
      pendingRequests.forEach((request, requestId) => {
        clearPendingRequest(requestId);
        request.reject(rejectPendingWith);
      });
    }
  }

  // ---- Dispatch ----

  function dispatch(
    request: unknown,
    transfer?: Transferable[],
    onProgress?: (progress: unknown) => void,
  ): Promise<Result> {
    if (workerUnavailable) {
      throw new Error(`${label} worker is unavailable`);
    }

    if (!canUseWorker()) {
      throw new Error(`${label} worker is not available in this environment`);
    }

    const entry = ensureWorker();
    const requestId = nextRequestId;
    nextRequestId += 1;

    return new Promise<Result>((resolveRequest, rejectRequest) => {
      const pending: PendingRequest<Result, Progress> = {
        resolve: resolveRequest,
        reject: rejectRequest,
        workerEntry: entry,
        onProgress: onProgress as ((progress: Progress) => void) | undefined,
      };
      pendingRequests.set(requestId, pending);
      entry.pendingCount += 1;

      try {
        entry.worker.postMessage({ ...(request as Record<string, unknown>), requestId }, transfer);
      } catch (error) {
        console.error(`[${label}WorkerBridge] Failed to dispatch request to worker.`, error);
        clearPendingRequest(requestId);
        workerUnavailable = true;
        disposePool(error);
        rejectRequest(error);
      }
    });
  }

  return {
    dispose: disposePool,
    clearCache: () => resolvedCache?.clear(),
    get pendingCount() {
      return pendingRequests.size;
    },
    get unavailable() {
      return workerUnavailable;
    },
    get canUseWorker() {
      return canUseWorker();
    },
    ensureWorker,
    dispatch,
    getCached: (key) => resolvedCache?.get(key),
    setCached: touchCache,
  };
}
