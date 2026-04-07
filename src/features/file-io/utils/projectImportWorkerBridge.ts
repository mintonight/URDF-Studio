import type { Language } from '@/shared/i18n';

import { hydrateImportedProjectResult, type ImportResult } from './projectImport.ts';
import type {
  ImportProjectWorkerRequest,
  ProjectImportWorkerRequest,
  ProjectImportWorkerResponse,
} from './projectImportWorker.ts';

interface WorkerLike {
  addEventListener: (
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener: (
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  postMessage: (message: ProjectImportWorkerRequest, transfer?: Transferable[]) => void;
  terminate: () => void;
}

interface PendingWorkerRequest {
  resolve: (value: ImportResult) => void;
  reject: (error: unknown) => void;
}

interface CreateProjectImportWorkerClientOptions {
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
}

interface ProjectImportWorkerClient {
  dispose: (rejectPendingWith?: unknown) => void;
  import: (file: File, lang?: Language) => Promise<ImportResult>;
}

function createWorkerError(event: ErrorEvent | { error?: unknown; message?: string }): Error {
  if (event.error instanceof Error) {
    return event.error;
  }

  return new Error(event.message || 'Project import worker failed');
}

export function createProjectImportWorkerClient({
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = () =>
    new Worker(new URL('../workers/projectImport.worker.ts', import.meta.url), {
      type: 'module',
    }),
}: CreateProjectImportWorkerClientOptions = {}): ProjectImportWorkerClient {
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

  const handleSharedWorkerMessage = (event: MessageEvent<ProjectImportWorkerResponse>): void => {
    const message = event.data;
    if (!message) {
      return;
    }

    const pendingRequest = clearPendingRequest(message.requestId);
    if (!pendingRequest) {
      return;
    }

    if (message.type === 'import-project-error') {
      pendingRequest.reject(new Error(message.error || 'Project import worker failed'));
      return;
    }

    try {
      pendingRequest.resolve(hydrateImportedProjectResult(message.result));
    } catch (error) {
      pendingRequest.reject(error);
    }
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

  const importProjectArchive = async (file: File, lang: Language = 'en'): Promise<ImportResult> => {
    if (workerUnavailable) {
      throw new Error('Project import worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<ImportResult>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let worker: WorkerLike;

      try {
        worker = ensureSharedWorker();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const request: ImportProjectWorkerRequest = {
        type: 'import-project',
        requestId,
        file,
        lang,
      };

      pendingRequests.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
      });

      try {
        worker.postMessage(request);
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
    import: importProjectArchive,
  };
}

const sharedProjectImportWorkerClient = createProjectImportWorkerClient();

export function importProjectWithWorker(file: File, lang: Language = 'en'): Promise<ImportResult> {
  return sharedProjectImportWorkerClient.import(file, lang);
}

export function disposeProjectImportWorker(rejectPendingWith?: unknown): void {
  sharedProjectImportWorkerClient.dispose(rejectPendingWith);
}
