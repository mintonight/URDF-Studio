import {
  type ResolveRobotFileDataOptions,
  type RobotImportProgress,
  type RobotImportResult,
} from '@/core/parsers/importRobotFile';
import type { RobotFile } from '@/types';
import type {
  GenerateEditableRobotSourceWorkerRequest,
  GenerateEditableRobotSourceWorkerResponse,
  PrepareAssemblyComponentWorkerOptions,
  ParseEditableRobotSourceWorkerRequest,
  ParseEditableRobotSourceWorkerResponse,
  PreparedAssemblyComponentResult,
  PrepareAssemblyComponentWorkerRequest,
  RobotImportWorkerResponse,
  RobotImportWorkerContextSnapshot,
  ResolveRobotImportWorkerRequest,
  SyncRobotImportWorkerContextRequest,
  RobotImportWorkerRequest,
} from '@/app/utils/robotImportWorker';
import type { GenerateEditableRobotSourceOptions } from '@/app/utils/generateEditableRobotSource';
import type { ParseEditableRobotSourceOptions } from '@/app/utils/parseEditableRobotSource';
import {
  buildEditableRobotSourceWorkerDispatch,
  buildPrepareAssemblyComponentWorkerDispatch,
  buildResolveRobotImportWorkerDispatch,
  type PreparedRobotImportWorkerDispatch,
} from '@/app/utils/robotImportWorkerPayload';
import { consumePreResolvedRobotImport } from '@/app/utils/preResolvedRobotImportCache';
import type { RobotState } from '@/types';

interface WorkerLike {
  addEventListener: (
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener: (
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  postMessage: (message: RobotImportWorkerRequest) => void;
  terminate: () => void;
}

interface PendingRobotImportWorkerRequest {
  onProgress?: (progress: RobotImportProgress) => void;
  resolve: (value: RobotImportResult) => void;
  reject: (error: unknown) => void;
  workerEntry: WorkerPoolEntry;
}

interface PendingEditableParseWorkerRequest {
  resolve: (value: RobotState | null) => void;
  reject: (error: unknown) => void;
  workerEntry: WorkerPoolEntry;
}

interface PendingEditableSourceGenerationWorkerRequest {
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
  workerEntry: WorkerPoolEntry;
}

interface PendingPreparedAssemblyComponentWorkerRequest {
  resolve: (value: PreparedAssemblyComponentResult) => void;
  reject: (error: unknown) => void;
  workerEntry: WorkerPoolEntry;
}

interface WorkerPoolEntry {
  pendingCount: number;
  syncedContextIdsByCacheKey: Map<string, string>;
  worker: WorkerLike;
}

interface CreateRobotImportWorkerClientOptions {
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
  getWorkerCount?: () => number;
}

export interface RobotImportWorkerClient {
  dispose: (rejectPendingWith?: unknown) => void;
  generateEditableSource: (options: GenerateEditableRobotSourceOptions) => Promise<string>;
  resolve: (
    file: RobotFile,
    options?: ResolveRobotFileDataOptions,
    callbacks?: { onProgress?: (progress: RobotImportProgress) => void },
  ) => Promise<RobotImportResult>;
  prepareAssemblyComponent: (
    file: RobotFile,
    options: PrepareAssemblyComponentWorkerOptions & {
      componentId: string;
      rootName: string;
    },
  ) => Promise<PreparedAssemblyComponentResult>;
  parseEditableSource: (options: ParseEditableRobotSourceOptions) => Promise<RobotState | null>;
}

function createWorkerError(event: ErrorEvent | { error?: unknown; message?: string }): Error {
  if (event.error instanceof Error) {
    return event.error;
  }

  return new Error(event.message || 'Robot import worker failed');
}

function resolveDefaultWorkerCount(): number {
  if (typeof navigator === 'undefined') {
    return 1;
  }

  const hardwareConcurrency = Number(navigator.hardwareConcurrency || 2);
  return Math.max(1, Math.min(10, hardwareConcurrency - 1));
}

export function createRobotImportWorkerClient({
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = () =>
    new Worker(new URL('../workers/robotImport.worker.ts', import.meta.url), { type: 'module' }),
  getWorkerCount = resolveDefaultWorkerCount,
}: CreateRobotImportWorkerClientOptions = {}): RobotImportWorkerClient {
  const pendingRobotImportRequests = new Map<number, PendingRobotImportWorkerRequest>();
  const pendingEditableParseRequests = new Map<number, PendingEditableParseWorkerRequest>();
  const pendingEditableSourceGenerationRequests = new Map<
    number,
    PendingEditableSourceGenerationWorkerRequest
  >();
  const pendingPreparedAssemblyComponentRequests = new Map<
    number,
    PendingPreparedAssemblyComponentWorkerRequest
  >();
  const workerPool: WorkerPoolEntry[] = [];
  let requestIdCounter = 0;
  let contextIdCounter = 0;
  let workerUnavailable = false;
  let maxWorkerCount: number | null = null;

  const clearPendingRobotImportRequest = (
    requestId: number,
  ): PendingRobotImportWorkerRequest | null => {
    const pendingRequest = pendingRobotImportRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingRobotImportRequests.delete(requestId);
    pendingRequest.workerEntry.pendingCount = Math.max(
      0,
      pendingRequest.workerEntry.pendingCount - 1,
    );
    return pendingRequest;
  };

  const clearPendingEditableParseRequest = (
    requestId: number,
  ): PendingEditableParseWorkerRequest | null => {
    const pendingRequest = pendingEditableParseRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingEditableParseRequests.delete(requestId);
    pendingRequest.workerEntry.pendingCount = Math.max(
      0,
      pendingRequest.workerEntry.pendingCount - 1,
    );
    return pendingRequest;
  };

  const clearPendingEditableSourceGenerationRequest = (
    requestId: number,
  ): PendingEditableSourceGenerationWorkerRequest | null => {
    const pendingRequest = pendingEditableSourceGenerationRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingEditableSourceGenerationRequests.delete(requestId);
    pendingRequest.workerEntry.pendingCount = Math.max(
      0,
      pendingRequest.workerEntry.pendingCount - 1,
    );
    return pendingRequest;
  };

  const clearPendingPreparedAssemblyComponentRequest = (
    requestId: number,
  ): PendingPreparedAssemblyComponentWorkerRequest | null => {
    const pendingRequest = pendingPreparedAssemblyComponentRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingPreparedAssemblyComponentRequests.delete(requestId);
    pendingRequest.workerEntry.pendingCount = Math.max(
      0,
      pendingRequest.workerEntry.pendingCount - 1,
    );
    return pendingRequest;
  };

  const handleSharedWorkerMessage = (event: MessageEvent<RobotImportWorkerResponse>): void => {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.type === 'resolve-robot-file-progress') {
      const pendingRequest = pendingRobotImportRequests.get(message.requestId) ?? null;
      if (!pendingRequest?.onProgress) {
        return;
      }

      try {
        pendingRequest.onProgress(message.progress);
      } catch (error) {
        console.error('[robotImportWorkerBridge] Failed to handle worker progress event.', error);
      }
      return;
    }

    if (
      message.type === 'resolve-robot-file-result' ||
      message.type === 'resolve-robot-file-error'
    ) {
      const pendingRequest = clearPendingRobotImportRequest(message.requestId);
      if (!pendingRequest) {
        return;
      }

      if (message.type === 'resolve-robot-file-error') {
        pendingRequest.reject(new Error(message.error || 'Robot import worker failed'));
        return;
      }

      if (!message.result) {
        pendingRequest.reject(new Error('Robot import worker returned no result'));
        return;
      }

      pendingRequest.resolve(message.result);
      return;
    }

    if (
      message.type === 'prepare-assembly-component-result' ||
      message.type === 'prepare-assembly-component-error'
    ) {
      const pendingRequest = clearPendingPreparedAssemblyComponentRequest(message.requestId);
      if (!pendingRequest) {
        return;
      }

      if (message.type === 'prepare-assembly-component-error') {
        pendingRequest.reject(new Error(message.error || 'Assembly component worker failed'));
        return;
      }

      if (!message.result) {
        pendingRequest.reject(new Error('Assembly component worker returned no result'));
        return;
      }

      pendingRequest.resolve(message.result);
      return;
    }

    if (
      message.type === 'generate-editable-robot-source-result' ||
      message.type === 'generate-editable-robot-source-error'
    ) {
      const pendingRequest = clearPendingEditableSourceGenerationRequest(message.requestId);
      if (!pendingRequest) {
        return;
      }

      if (message.type === 'generate-editable-robot-source-error') {
        pendingRequest.reject(
          new Error(message.error || 'Editable source generation worker failed'),
        );
        return;
      }

      if (typeof message.result !== 'string') {
        pendingRequest.reject(new Error('Editable source generation worker returned no source'));
        return;
      }

      pendingRequest.resolve(message.result);
      return;
    }

    const pendingRequest = clearPendingEditableParseRequest(message.requestId);
    if (!pendingRequest) {
      return;
    }

    if (message.type === 'parse-editable-robot-source-error') {
      pendingRequest.reject(new Error(message.error || 'Editable source parse worker failed'));
      return;
    }

    if (message.type !== 'parse-editable-robot-source-result') {
      pendingRequest.reject(
        new Error('Editable source parse worker returned an unexpected response'),
      );
      return;
    }

    pendingRequest.resolve(message.result ?? null);
  };

  const handleSharedWorkerError = (event: ErrorEvent): void => {
    workerUnavailable = true;
    disposeWorkerPool(createWorkerError(event));
  };

  const disposeWorkerPool = (rejectPendingWith?: unknown): void => {
    workerPool.forEach((entry) => {
      entry.worker.removeEventListener('message', handleSharedWorkerMessage as EventListener);
      entry.worker.removeEventListener('error', handleSharedWorkerError as EventListener);
      entry.worker.terminate();
      entry.syncedContextIdsByCacheKey.clear();
    });
    workerPool.length = 0;

    if (rejectPendingWith !== undefined) {
      pendingRobotImportRequests.forEach((request, requestId) => {
        clearPendingRobotImportRequest(requestId);
        request.reject(rejectPendingWith);
      });
      pendingEditableParseRequests.forEach((request, requestId) => {
        clearPendingEditableParseRequest(requestId);
        request.reject(rejectPendingWith);
      });
      pendingEditableSourceGenerationRequests.forEach((request, requestId) => {
        clearPendingEditableSourceGenerationRequest(requestId);
        request.reject(rejectPendingWith);
      });
      pendingPreparedAssemblyComponentRequests.forEach((request, requestId) => {
        clearPendingPreparedAssemblyComponentRequest(requestId);
        request.reject(rejectPendingWith);
      });
    }
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
      syncedContextIdsByCacheKey: new Map<string, string>(),
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

  const ensureWorkerContext = (
    workerEntry: WorkerPoolEntry,
    preparedDispatch: PreparedRobotImportWorkerDispatch<unknown>,
  ): string | undefined => {
    if (!preparedDispatch.contextCacheKey || !preparedDispatch.contextSnapshot) {
      return undefined;
    }

    const cachedContextId = workerEntry.syncedContextIdsByCacheKey.get(
      preparedDispatch.contextCacheKey,
    );
    if (cachedContextId) {
      return cachedContextId;
    }

    const contextId = `robot-import-context-${++contextIdCounter}`;
    const syncContextRequest: SyncRobotImportWorkerContextRequest = {
      type: 'sync-context',
      contextId,
      context: preparedDispatch.contextSnapshot as RobotImportWorkerContextSnapshot,
    };

    workerEntry.worker.postMessage(syncContextRequest);
    workerEntry.syncedContextIdsByCacheKey.set(preparedDispatch.contextCacheKey, contextId);

    if (workerEntry.syncedContextIdsByCacheKey.size > 24) {
      const oldestEntry = workerEntry.syncedContextIdsByCacheKey.keys().next();
      if (!oldestEntry.done) {
        workerEntry.syncedContextIdsByCacheKey.delete(oldestEntry.value);
      }
    }

    return contextId;
  };

  const resolve = async (
    file: RobotFile,
    options: ResolveRobotFileDataOptions = {},
    callbacks?: { onProgress?: (progress: RobotImportProgress) => void },
  ): Promise<RobotImportResult> => {
    if (workerUnavailable) {
      throw new Error('Robot import worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<RobotImportResult>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let workerEntry: WorkerPoolEntry;

      try {
        workerEntry = pickWorkerEntry();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const preparedDispatch = buildResolveRobotImportWorkerDispatch(file, options);
      let contextId: string | undefined;

      try {
        contextId = ensureWorkerContext(workerEntry, preparedDispatch);
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        disposeWorkerPool(error);
        return;
      }

      const request: ResolveRobotImportWorkerRequest = {
        type: 'resolve-robot-file',
        requestId,
        file,
        options: preparedDispatch.options,
        contextId,
      };

      pendingRobotImportRequests.set(requestId, {
        onProgress: callbacks?.onProgress,
        resolve: resolveRequest,
        reject: rejectRequest,
        workerEntry,
      });
      workerEntry.pendingCount += 1;

      try {
        workerEntry.worker.postMessage(request);
      } catch (error) {
        workerUnavailable = true;
        clearPendingRobotImportRequest(requestId);
        disposeWorkerPool(error);
        rejectRequest(error);
      }
    });
  };

  const parseEditableSource = async (
    options: ParseEditableRobotSourceOptions,
  ): Promise<RobotState | null> => {
    if (workerUnavailable) {
      throw new Error('Robot import worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<RobotState | null>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let workerEntry: WorkerPoolEntry;

      try {
        workerEntry = pickWorkerEntry();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const preparedDispatch = buildEditableRobotSourceWorkerDispatch(options);
      let contextId: string | undefined;

      try {
        contextId = ensureWorkerContext(workerEntry, preparedDispatch);
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        disposeWorkerPool(error);
        return;
      }

      const request: ParseEditableRobotSourceWorkerRequest = {
        type: 'parse-editable-robot-source',
        requestId,
        options: preparedDispatch.options,
        contextId,
      };

      pendingEditableParseRequests.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
        workerEntry,
      });
      workerEntry.pendingCount += 1;

      try {
        workerEntry.worker.postMessage(request);
      } catch (error) {
        workerUnavailable = true;
        clearPendingEditableParseRequest(requestId);
        disposeWorkerPool(error);
        rejectRequest(error);
      }
    });
  };

  const generateEditableSource = async (
    options: GenerateEditableRobotSourceOptions,
  ): Promise<string> => {
    if (workerUnavailable) {
      throw new Error('Robot import worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<string>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let workerEntry: WorkerPoolEntry;

      try {
        workerEntry = pickWorkerEntry();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const request: GenerateEditableRobotSourceWorkerRequest = {
        type: 'generate-editable-robot-source',
        requestId,
        options,
      };

      pendingEditableSourceGenerationRequests.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
        workerEntry,
      });
      workerEntry.pendingCount += 1;

      try {
        workerEntry.worker.postMessage(request);
      } catch (error) {
        workerUnavailable = true;
        clearPendingEditableSourceGenerationRequest(requestId);
        disposeWorkerPool(error);
        rejectRequest(error);
      }
    });
  };

  const prepareAssemblyComponent = async (
    file: RobotFile,
    options: PrepareAssemblyComponentWorkerOptions & {
      componentId: string;
      rootName: string;
    },
  ): Promise<PreparedAssemblyComponentResult> => {
    if (workerUnavailable) {
      throw new Error('Robot import worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<PreparedAssemblyComponentResult>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let workerEntry: WorkerPoolEntry;

      try {
        workerEntry = pickWorkerEntry();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const preparedDispatch = buildPrepareAssemblyComponentWorkerDispatch(file, options);
      let contextId: string | undefined;

      try {
        contextId = ensureWorkerContext(workerEntry, preparedDispatch);
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        disposeWorkerPool(error);
        return;
      }

      const request: PrepareAssemblyComponentWorkerRequest = {
        type: 'prepare-assembly-component',
        requestId,
        file,
        options: preparedDispatch.options,
        componentId: options.componentId,
        rootName: options.rootName,
        contextId,
      };

      pendingPreparedAssemblyComponentRequests.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
        workerEntry,
      });
      workerEntry.pendingCount += 1;

      try {
        workerEntry.worker.postMessage(request);
      } catch (error) {
        workerUnavailable = true;
        clearPendingPreparedAssemblyComponentRequest(requestId);
        disposeWorkerPool(error);
        rejectRequest(error);
      }
    });
  };

  return {
    dispose: disposeWorkerPool,
    generateEditableSource,
    prepareAssemblyComponent,
    parseEditableSource,
    resolve,
  };
}

const sharedRobotImportWorkerClient = createRobotImportWorkerClient();

export function resolveRobotFileDataWithWorker(
  file: RobotFile,
  options: ResolveRobotFileDataOptions = {},
  callbacks?: { onProgress?: (progress: RobotImportProgress) => void },
): Promise<RobotImportResult> {
  const preResolvedImportResult = consumePreResolvedRobotImport(file);
  if (preResolvedImportResult) {
    callbacks?.onProgress?.({
      progressPercent: 100,
      message: null,
    });
    return Promise.resolve(preResolvedImportResult);
  }

  return sharedRobotImportWorkerClient.resolve(file, options, callbacks);
}

export function parseEditableRobotSourceWithWorker(
  options: ParseEditableRobotSourceOptions,
): Promise<RobotState | null> {
  return sharedRobotImportWorkerClient.parseEditableSource(options);
}

export function generateEditableRobotSourceWithWorker(
  options: GenerateEditableRobotSourceOptions,
): Promise<string> {
  return sharedRobotImportWorkerClient.generateEditableSource(options);
}

export function prepareAssemblyComponentWithWorker(
  file: RobotFile,
  options: PrepareAssemblyComponentWorkerOptions & {
    componentId: string;
    rootName: string;
  },
): Promise<PreparedAssemblyComponentResult> {
  return sharedRobotImportWorkerClient.prepareAssemblyComponent(file, options);
}

export function disposeRobotImportWorker(rejectPendingWith?: unknown): void {
  sharedRobotImportWorkerClient.dispose(rejectPendingWith);
}
