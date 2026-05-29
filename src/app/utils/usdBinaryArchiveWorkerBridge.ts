import type {
  ConvertUsdArchiveFilesToBinaryWorkerRequest,
  UsdBinaryArchiveWorkerResponse,
} from './usdBinaryArchiveWorker.ts';
import {
  hydrateUsdBinaryArchiveFilesFromWorker,
  serializeUsdBinaryArchiveFilesForWorker,
} from './usdBinaryArchiveWorkerTransfer.ts';

interface WorkerLike {
  addEventListener: Worker['addEventListener'];
  removeEventListener: Worker['removeEventListener'];
  postMessage: Worker['postMessage'];
  terminate: Worker['terminate'];
}

interface PendingWorkerRequest {
  resolve: (value: Map<string, Blob>) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: {
    current: number;
    total: number;
    filePath: string;
  }) => void;
}

interface CreateUsdBinaryArchiveWorkerClientOptions {
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
}

interface ConvertUsdArchiveFilesToBinaryWithWorkerOptions {
  onProgress?: (progress: {
    current: number;
    total: number;
    filePath: string;
  }) => void;
}

interface UsdBinaryArchiveWorkerClient {
  dispose: (rejectPendingWith?: unknown) => void;
  convert: (
    archiveFiles: Map<string, Blob>,
    options?: ConvertUsdArchiveFilesToBinaryWithWorkerOptions,
  ) => Promise<Map<string, Blob>>;
}

function createWorkerError(event: ErrorEvent | { error?: unknown; message?: string }): Error {
  if (event.error instanceof Error) {
    return event.error;
  }

  return new Error(event.message || 'USD binary archive worker failed');
}

export function createUsdBinaryArchiveWorkerClient(
  {
    canUseWorker = () => typeof Worker !== 'undefined',
    createWorker = () => new Worker(
      new URL('../workers/usdBinaryArchive.worker.ts', import.meta.url),
      { type: 'module' },
    ),
  }: CreateUsdBinaryArchiveWorkerClientOptions = {},
): UsdBinaryArchiveWorkerClient {
  const pendingRequests = new Map<number, PendingWorkerRequest>();
  let requestIdCounter = 0;
  let sharedWorker: WorkerLike | null = null;
  let workerUnavailable = false;

  const clearPendingRequest = (requestId: number): PendingWorkerRequest | null => {
    const pendingRequest = pendingRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingRequests.delete(requestId);
    return pendingRequest;
  };

  const disposeSharedWorker = (rejectPendingWith?: unknown): void => {
    if (sharedWorker) {
      sharedWorker.removeEventListener('message', handleSharedWorkerMessage as EventListener);
      sharedWorker.removeEventListener('error', handleSharedWorkerError as EventListener);
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

  const handleSharedWorkerMessage = (event: MessageEvent<UsdBinaryArchiveWorkerResponse>): void => {
    const message = event.data;
    if (!message) {
      return;
    }

    const pendingRequest = pendingRequests.get(message.requestId) ?? null;
    if (!pendingRequest) {
      return;
    }

    if (message.type === 'convert-usd-archive-files-to-binary-progress') {
      pendingRequest.onProgress?.({
        current: message.current,
        total: message.total,
        filePath: message.filePath,
      });
      return;
    }

    clearPendingRequest(message.requestId);

    if (message.type === 'convert-usd-archive-files-to-binary-error') {
      pendingRequest.reject(new Error(message.error || 'USD binary archive worker failed'));
      return;
    }

    pendingRequest.resolve(hydrateUsdBinaryArchiveFilesFromWorker(message.result));
  };

  const handleSharedWorkerError = (event: ErrorEvent): void => {
    workerUnavailable = true;
    disposeSharedWorker(createWorkerError(event));
  };

  const ensureSharedWorker = (): WorkerLike => {
    if (!sharedWorker) {
      sharedWorker = createWorker();
      sharedWorker.addEventListener('message', handleSharedWorkerMessage as EventListener);
      sharedWorker.addEventListener('error', handleSharedWorkerError as EventListener);
    }

    return sharedWorker;
  };

  const convert = async (
    archiveFiles: Map<string, Blob>,
    options: ConvertUsdArchiveFilesToBinaryWithWorkerOptions = {},
  ): Promise<Map<string, Blob>> => {
    if (workerUnavailable) {
      throw new Error('USD binary archive worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    const serialized = await serializeUsdBinaryArchiveFilesForWorker(archiveFiles);

    return new Promise<Map<string, Blob>>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let worker: WorkerLike;

      try {
        worker = ensureSharedWorker();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const request: ConvertUsdArchiveFilesToBinaryWorkerRequest = {
        type: 'convert-usd-archive-files-to-binary',
        requestId,
        archiveFiles: serialized.payload,
      };

      pendingRequests.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
        onProgress: options.onProgress,
      });

      try {
        worker.postMessage(request, serialized.transferables);
      } catch (error) {
        workerUnavailable = true;
        clearPendingRequest(requestId);
        disposeSharedWorker(error);
        rejectRequest(error);
      }
    });
  };

  return {
    dispose: disposeSharedWorker,
    convert,
  };
}

const sharedUsdBinaryArchiveWorkerClient = createUsdBinaryArchiveWorkerClient();

export function convertUsdArchiveFilesToBinaryWithWorker(
  archiveFiles: Map<string, Blob>,
  options: ConvertUsdArchiveFilesToBinaryWithWorkerOptions = {},
): Promise<Map<string, Blob>> {
  return sharedUsdBinaryArchiveWorkerClient.convert(archiveFiles, options);
}

export function disposeUsdBinaryArchiveWorker(rejectPendingWith?: unknown): void {
  sharedUsdBinaryArchiveWorkerClient.dispose(rejectPendingWith);
}
