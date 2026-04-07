import {
  type PrepareImportPayloadArgs,
  type ImportPreparationFileDescriptor,
  type PreparedDeferredImportAssetFile,
  type PreparedImportBlobFile,
  type PreparedImportPayload,
  type PrepareImportProgress,
  type ImportPreparationWorkerRequest,
  type ImportPreparationWorkerResponse,
} from '@/app/utils/importPreparation';

interface PendingWorkerRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: PrepareImportProgress) => void;
}

const pendingWorkerRequests = new Map<number, PendingWorkerRequest>();
let requestIdCounter = 0;
let sharedWorker: Worker | null = null;
let workerUnavailable = false;

function clearPendingWorkerRequest(requestId: number): PendingWorkerRequest | null {
  const pendingRequest = pendingWorkerRequests.get(requestId) ?? null;
  if (!pendingRequest) {
    return null;
  }

  pendingWorkerRequests.delete(requestId);
  return pendingRequest;
}

function disposeSharedWorker(rejectPendingWith?: unknown): void {
  if (sharedWorker) {
    sharedWorker.removeEventListener('message', handleSharedWorkerMessage);
    sharedWorker.removeEventListener('error', handleSharedWorkerError);
    sharedWorker.terminate();
    sharedWorker = null;
  }

  if (rejectPendingWith !== undefined) {
    pendingWorkerRequests.forEach((request, requestId) => {
      clearPendingWorkerRequest(requestId);
      request.reject(rejectPendingWith);
    });
  }
}

function handleSharedWorkerMessage(event: MessageEvent<ImportPreparationWorkerResponse>): void {
  const message = event.data;
  if (!message) {
    return;
  }

  const pendingRequest = pendingWorkerRequests.get(message.requestId) ?? null;
  if (!pendingRequest) {
    return;
  }

  if (
    message.type === 'prepare-import-progress' ||
    message.type === 'hydrate-deferred-import-assets-progress'
  ) {
    if (message.progress) {
      pendingRequest.onProgress?.(message.progress);
    }
    return;
  }

  clearPendingWorkerRequest(message.requestId);

  if (
    message.type === 'prepare-import-error' ||
    message.type === 'hydrate-deferred-import-assets-error'
  ) {
    pendingRequest.reject(new Error(message.error || 'Import preparation worker failed'));
    return;
  }

  if (message.type === 'prepare-import-result') {
    if (!message.payload) {
      pendingRequest.reject(new Error('Import preparation worker returned no payload'));
      return;
    }

    pendingRequest.resolve(message.payload);
    return;
  }

  if (message.type === 'hydrate-deferred-import-assets-result') {
    pendingRequest.resolve(message.assetFiles ?? []);
    return;
  }

  pendingRequest.reject(new Error('Import preparation worker returned an unexpected response'));
}

function handleSharedWorkerError(event: ErrorEvent): void {
  workerUnavailable = true;
  const error = event.error ?? new Error(event.message || 'Import preparation worker failed');
  disposeSharedWorker(error);
}

function ensureSharedWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('../workers/importPreparation.worker.ts', import.meta.url), {
      type: 'module',
    });
    sharedWorker.addEventListener('message', handleSharedWorkerMessage);
    sharedWorker.addEventListener('error', handleSharedWorkerError);
  }

  return sharedWorker;
}

export async function prepareImportPayloadWithWorker(
  args: PrepareImportPayloadArgs,
): Promise<PreparedImportPayload> {
  if (workerUnavailable) {
    throw new Error('Import preparation worker is unavailable');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Web Worker is not available in this environment');
  }

  return new Promise<PreparedImportPayload>((resolve, reject) => {
    const requestId = ++requestIdCounter;
    let worker: Worker;

    try {
      worker = ensureSharedWorker();
    } catch (error) {
      workerUnavailable = true;
      reject(error);
      return;
    }

    const files: ImportPreparationFileDescriptor[] = [...args.files].map((input) => {
      if (input instanceof File) {
        return {
          file: input,
          relativePath: input.webkitRelativePath || input.name,
        };
      }

      return {
        file: input.file,
        relativePath: input.relativePath || input.file.webkitRelativePath || input.file.name,
      };
    });
    const request: ImportPreparationWorkerRequest = {
      type: 'prepare-import',
      requestId,
      files,
      existingPaths: [...args.existingPaths],
      preResolvePreferredImport: args.preResolvePreferredImport,
    };

    pendingWorkerRequests.set(requestId, {
      resolve: (value) => resolve(value as PreparedImportPayload),
      reject,
      onProgress: args.onProgress,
    });

    try {
      worker.postMessage(request);
    } catch (error) {
      workerUnavailable = true;
      clearPendingWorkerRequest(requestId);
      disposeSharedWorker(error);
      reject(error);
    }
  });
}

interface HydrateDeferredImportAssetsWithWorkerArgs {
  zipFile: File;
  assetFiles: readonly PreparedDeferredImportAssetFile[];
  onProgress?: (progress: PrepareImportProgress) => void;
}

export async function hydrateDeferredImportAssetsWithWorker({
  zipFile,
  assetFiles,
  onProgress,
}: HydrateDeferredImportAssetsWithWorkerArgs): Promise<PreparedImportBlobFile[]> {
  if (workerUnavailable) {
    throw new Error('Import preparation worker is unavailable');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Web Worker is not available in this environment');
  }

  return new Promise<PreparedImportBlobFile[]>((resolve, reject) => {
    const requestId = ++requestIdCounter;
    let worker: Worker;

    try {
      worker = ensureSharedWorker();
    } catch (error) {
      workerUnavailable = true;
      reject(error);
      return;
    }

    const request: ImportPreparationWorkerRequest = {
      type: 'hydrate-deferred-import-assets',
      requestId,
      zipFile,
      assetFiles: [...assetFiles],
    };

    pendingWorkerRequests.set(requestId, {
      resolve: (value) => resolve(value as PreparedImportBlobFile[]),
      reject,
      onProgress,
    });

    try {
      worker.postMessage(request);
    } catch (error) {
      workerUnavailable = true;
      clearPendingWorkerRequest(requestId);
      disposeSharedWorker(error);
      reject(error);
    }
  });
}
