import { type MeshAnalysis, type MeshAnalysisOptions } from './geometryConversion';

interface MeshAnalysisBatchTask {
  targetId: string;
  cacheKey: string;
  meshPath: string;
  dimensions?: { x: number; y: number; z: number };
  sourceFilePath?: string;
}

interface AnalyzeMeshBatchArgs {
  assets: Record<string, string>;
  tasks: MeshAnalysisBatchTask[];
  options?: MeshAnalysisOptions;
  signal?: AbortSignal;
}

interface MeshAnalysisWorkerResult {
  targetId: string;
  cacheKey: string;
  analysis: MeshAnalysis | null;
}

interface MeshAnalysisWorkerResponse {
  type: 'batch-result' | 'batch-error';
  requestId: number;
  results?: MeshAnalysisWorkerResult[];
  error?: string;
}

interface MeshAnalysisWorkerClientDependencies {
  canUseWorker?: () => boolean;
  createWorker?: () => Worker;
  getWorkerCount?: () => number;
}

interface WorkerPoolEntry {
  worker: Worker;
  pendingCount: number;
}

interface PendingWorkerRequest {
  workerEntry: WorkerPoolEntry;
  results: Record<string, MeshAnalysis | null>;
  resolve: () => void;
  reject: (error: unknown) => void;
  abortHandler?: () => void;
  signal?: AbortSignal;
}

const MAX_MESH_ANALYSIS_CACHE_SIZE = 256;
const MAX_MESH_ANALYSIS_WORKER_COUNT = 4;

function createOptionsCacheKey(options?: MeshAnalysisOptions): string {
  return JSON.stringify({
    includePrimitiveFits: options?.includePrimitiveFits ?? 'default',
    includeSurfacePoints: options?.includeSurfacePoints ?? 'default',
    pointCollectionLimit: options?.pointCollectionLimit ?? 'default',
    surfacePointLimit: options?.surfacePointLimit ?? 'default',
  });
}

function createRequestCacheKey(cacheKey: string, options?: MeshAnalysisOptions): string {
  return `${cacheKey}::${createOptionsCacheKey(options)}`;
}

function createAbortError(): DOMException {
  return new DOMException('Mesh analysis aborted', 'AbortError');
}

function resolveDefaultWorkerCount(): number {
  const hardwareConcurrency =
    typeof navigator !== 'undefined' ? Number(navigator.hardwareConcurrency || 2) : 2;
  const normalizedHardwareConcurrency =
    Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 ? hardwareConcurrency : 2;

  return Math.max(
    1,
    Math.min(MAX_MESH_ANALYSIS_WORKER_COUNT, Math.ceil(normalizedHardwareConcurrency / 3)),
  );
}

function createTaskChunks(
  pendingTasks: MeshAnalysisBatchTask[],
  chunkCount: number,
): MeshAnalysisBatchTask[][] {
  if (pendingTasks.length === 0) {
    return [];
  }

  const boundedChunkCount = Math.max(1, Math.min(chunkCount, pendingTasks.length));
  const taskGroupsByCacheKey = new Map<string, MeshAnalysisBatchTask[]>();
  pendingTasks.forEach((task) => {
    const taskGroup = taskGroupsByCacheKey.get(task.cacheKey);
    if (taskGroup) {
      taskGroup.push(task);
      return;
    }

    taskGroupsByCacheKey.set(task.cacheKey, [task]);
  });

  const chunks = Array.from({ length: boundedChunkCount }, () => [] as MeshAnalysisBatchTask[]);
  const chunkLoads = Array.from({ length: boundedChunkCount }, () => 0);
  const taskGroups = Array.from(taskGroupsByCacheKey.values()).sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length;
    }

    return left[0]!.cacheKey.localeCompare(right[0]!.cacheKey);
  });

  taskGroups.forEach((group) => {
    let targetChunkIndex = 0;
    for (let index = 1; index < chunks.length; index += 1) {
      if (chunkLoads[index]! < chunkLoads[targetChunkIndex]!) {
        targetChunkIndex = index;
      }
    }

    chunks[targetChunkIndex]!.push(...group);
    chunkLoads[targetChunkIndex]! += group.length;
  });

  return chunks.filter((chunk) => chunk.length > 0);
}

export function createMeshAnalysisWorkerClient({
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = () =>
    new Worker(new URL('../workers/meshAnalysis.worker.ts', import.meta.url), { type: 'module' }),
  getWorkerCount = resolveDefaultWorkerCount,
}: MeshAnalysisWorkerClientDependencies = {}) {
  const meshAnalysisCache = new Map<string, MeshAnalysis | null>();
  const pendingWorkerRequests = new Map<number, PendingWorkerRequest>();
  const workerPool: WorkerPoolEntry[] = [];
  let requestIdCounter = 0;
  let workerUnavailable = false;
  let maxWorkerCount: number | null = null;

  const setMeshAnalysisCacheEntry = (cacheKey: string, analysis: MeshAnalysis | null): void => {
    if (meshAnalysisCache.has(cacheKey)) {
      meshAnalysisCache.delete(cacheKey);
    }

    meshAnalysisCache.set(cacheKey, analysis);

    while (meshAnalysisCache.size > MAX_MESH_ANALYSIS_CACHE_SIZE) {
      const oldestKey = meshAnalysisCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }

      meshAnalysisCache.delete(oldestKey);
    }
  };

  const clearPendingWorkerRequest = (requestId: number): PendingWorkerRequest | null => {
    const pendingRequest = pendingWorkerRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingWorkerRequests.delete(requestId);
    pendingRequest.workerEntry.pendingCount = Math.max(
      0,
      pendingRequest.workerEntry.pendingCount - 1,
    );
    if (pendingRequest.abortHandler) {
      pendingRequest.signal?.removeEventListener('abort', pendingRequest.abortHandler);
    }

    return pendingRequest;
  };

  const handleSharedWorkerMessage = (event: MessageEvent<MeshAnalysisWorkerResponse>): void => {
    const message = event.data;
    if (!message) {
      return;
    }

    const pendingRequest = clearPendingWorkerRequest(message.requestId);
    if (!pendingRequest) {
      return;
    }

    if (message.type === 'batch-error') {
      pendingRequest.reject(new Error(message.error || 'Mesh analysis worker failed'));
      return;
    }

    const workerResults = message.results ?? [];
    workerResults.forEach((entry) => {
      setMeshAnalysisCacheEntry(entry.cacheKey, entry.analysis ?? null);
      pendingRequest.results[entry.targetId] = entry.analysis ?? null;
    });
    pendingRequest.resolve();
  };

  const disposeWorkerPool = (rejectPendingWith?: unknown): void => {
    workerPool.forEach((entry) => {
      entry.worker.removeEventListener('message', handleSharedWorkerMessage as EventListener);
      entry.worker.removeEventListener('error', handleSharedWorkerError as EventListener);
      entry.worker.terminate();
      entry.pendingCount = 0;
    });
    workerPool.length = 0;

    if (rejectPendingWith !== undefined) {
      pendingWorkerRequests.forEach((request, requestId) => {
        clearPendingWorkerRequest(requestId);
        request.reject(rejectPendingWith);
      });
    }
  };

  const handleSharedWorkerError = (event: ErrorEvent): void => {
    workerUnavailable = true;
    const error = event.error ?? new Error(event.message || 'Mesh analysis worker failed');
    disposeWorkerPool(error);
  };

  const resolveMaxWorkerCount = (): number => {
    if (maxWorkerCount === null) {
      maxWorkerCount = Math.max(1, getWorkerCount());
    }
    return maxWorkerCount;
  };

  const createWorkerPoolEntry = (): WorkerPoolEntry => {
    const worker = createWorker();
    worker.addEventListener('message', handleSharedWorkerMessage as EventListener);
    worker.addEventListener('error', handleSharedWorkerError as EventListener);
    const entry: WorkerPoolEntry = {
      worker,
      pendingCount: 0,
    };
    workerPool.push(entry);
    return entry;
  };

  const ensureWorkerPool = (minimumWorkerCount = 1): WorkerPoolEntry[] => {
    const targetWorkerCount = Math.max(1, Math.min(resolveMaxWorkerCount(), minimumWorkerCount));
    while (workerPool.length < targetWorkerCount) {
      createWorkerPoolEntry();
    }

    return workerPool;
  };

  const pickWorkerEntry = (): WorkerPoolEntry => {
    const pool = ensureWorkerPool();
    const bestEntry = pool.reduce(
      (best, candidate) => (candidate.pendingCount < best.pendingCount ? candidate : best),
      pool[0]!,
    );

    if (bestEntry.pendingCount > 0 && workerPool.length < resolveMaxWorkerCount()) {
      return createWorkerPoolEntry();
    }

    return bestEntry;
  };

  const dispatchChunkToWorker = async ({
    assets,
    options,
    results,
    signal,
    tasks,
  }: AnalyzeMeshBatchArgs & {
    results: Record<string, MeshAnalysis | null>;
    tasks: MeshAnalysisBatchTask[];
  }): Promise<void> => {
    if (tasks.length === 0) {
      return;
    }

    if (signal?.aborted) {
      throw createAbortError();
    }

    return await new Promise<void>((resolve, reject) => {
      let workerEntry: WorkerPoolEntry;

      try {
        workerEntry = pickWorkerEntry();
      } catch (error) {
        workerUnavailable = true;
        reject(error);
        return;
      }

      const requestId = ++requestIdCounter;
      workerEntry.pendingCount += 1;

      const handleAbort = () => {
        const pendingRequest = clearPendingWorkerRequest(requestId);
        if (!pendingRequest) {
          return;
        }
        pendingRequest.reject(createAbortError());
      };

      pendingWorkerRequests.set(requestId, {
        workerEntry,
        results,
        resolve,
        reject,
        abortHandler: handleAbort,
        signal,
      });
      signal?.addEventListener('abort', handleAbort, { once: true });

      workerEntry.worker.postMessage({
        type: 'analyze-batch',
        requestId,
        assets,
        tasks,
        options,
      });
    });
  };

  const analyzeBatch = async ({
    assets,
    tasks,
    options,
    signal,
  }: AnalyzeMeshBatchArgs): Promise<Record<string, MeshAnalysis | null>> => {
    if (workerUnavailable) {
      throw new Error('Mesh analysis worker is unavailable');
    }

    const results: Record<string, MeshAnalysis | null> = {};
    const pendingTasks: MeshAnalysisBatchTask[] = [];

    tasks.forEach((task) => {
      const requestCacheKey = createRequestCacheKey(task.cacheKey, options);
      if (meshAnalysisCache.has(requestCacheKey)) {
        results[task.targetId] = meshAnalysisCache.get(requestCacheKey) ?? null;
        return;
      }

      pendingTasks.push({
        ...task,
        cacheKey: requestCacheKey,
      });
    });

    if (pendingTasks.length === 0) {
      return results;
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    const taskChunks = createTaskChunks(
      pendingTasks,
      Math.min(resolveMaxWorkerCount(), pendingTasks.length),
    );

    await Promise.all(
      taskChunks.map((chunk) =>
        dispatchChunkToWorker({
          assets,
          options,
          results,
          signal,
          tasks: chunk,
        }),
      ),
    );

    return results;
  };

  return {
    analyzeBatch,
    clearCache: () => {
      meshAnalysisCache.clear();
    },
    dispose: (rejectPendingWith?: unknown) => {
      disposeWorkerPool(rejectPendingWith);
    },
    reset: () => {
      disposeWorkerPool();
      meshAnalysisCache.clear();
      pendingWorkerRequests.clear();
      requestIdCounter = 0;
      workerUnavailable = false;
      maxWorkerCount = null;
    },
  };
}

const sharedMeshAnalysisWorkerClient = createMeshAnalysisWorkerClient();

export async function analyzeMeshBatchWithWorker({
  assets,
  tasks,
  options,
  signal,
}: AnalyzeMeshBatchArgs): Promise<Record<string, MeshAnalysis | null>> {
  return sharedMeshAnalysisWorkerClient.analyzeBatch({
    assets,
    tasks,
    options,
    signal,
  });
}

export function __resetMeshAnalysisWorkerBridgeForTests(): void {
  sharedMeshAnalysisWorkerClient.reset();
}
