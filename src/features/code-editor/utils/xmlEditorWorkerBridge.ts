import type { SourceCodeDocumentFlavor, XmlCompletionEntry } from '../types';
import type { ValidationError } from './urdfValidation.ts';
import type { XmlDocumentValidationTexts } from './xmlDocumentValidation.ts';
import type {
  XmlEditorWorkerRequest,
  XmlEditorWorkerResponse,
} from './xmlEditorWorkerProtocol.ts';

interface PendingWorkerRequest<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const pendingWorkerRequests = new Map<number, PendingWorkerRequest<unknown>>();

let requestIdCounter = 0;
let sharedWorker: Worker | null = null;
let workerUnavailable = false;

const nextRequestId = (): number => {
  requestIdCounter += 1;
  return requestIdCounter;
};

const clearPendingRequest = (requestId: number): PendingWorkerRequest<unknown> | null => {
  const pendingRequest = pendingWorkerRequests.get(requestId) ?? null;
  if (!pendingRequest) {
    return null;
  }

  pendingWorkerRequests.delete(requestId);
  return pendingRequest;
};

const rejectAllPendingRequests = (error: unknown): void => {
  pendingWorkerRequests.forEach((pendingRequest, requestId) => {
    clearPendingRequest(requestId);
    pendingRequest.reject(error);
  });
};

const disposeSharedWorker = (rejectPendingWith?: unknown): void => {
  if (sharedWorker) {
    sharedWorker.removeEventListener('message', handleSharedWorkerMessage);
    sharedWorker.removeEventListener('error', handleSharedWorkerError);
    sharedWorker.terminate();
    sharedWorker = null;
  }

  if (rejectPendingWith !== undefined) {
    rejectAllPendingRequests(rejectPendingWith);
  }
};

const ensureSharedWorker = (): Worker => {
  if (!sharedWorker) {
    sharedWorker = new Worker(
      new URL('../workers/xmlEditor.worker.ts', import.meta.url),
      { type: 'module' },
    );
    sharedWorker.addEventListener('message', handleSharedWorkerMessage);
    sharedWorker.addEventListener('error', handleSharedWorkerError);
  }

  return sharedWorker;
};

const handleSharedWorkerMessage = (event: MessageEvent<XmlEditorWorkerResponse>): void => {
  const response = event.data;
  if (!response) {
    return;
  }

  const pendingRequest = clearPendingRequest(response.requestId);
  if (!pendingRequest) {
    return;
  }

  if (response.type === 'xml-worker-error') {
    pendingRequest.reject(new Error(response.error || 'XML editor worker failed'));
    return;
  }

  if (response.type === 'xml-completion-result') {
    pendingRequest.resolve(response.entries);
    return;
  }

  if (response.type === 'xml-validation-result') {
    pendingRequest.resolve(response.errors);
    return;
  }

  pendingRequest.reject(new Error('Unexpected XML editor worker response'));
};

const handleSharedWorkerError = (event: ErrorEvent): void => {
  workerUnavailable = true;
  const error = event.error ?? new Error(event.message || 'XML editor worker failed');
  disposeSharedWorker(error);
};

const postRequestToWorker = <TResponse>(request: XmlEditorWorkerRequest): Promise<TResponse> => {
  if (workerUnavailable) {
    return Promise.reject(new Error('XML editor worker is unavailable'));
  }

  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('Web Worker is not available in this environment'));
  }

  return new Promise<TResponse>((resolve, reject) => {
    let worker: Worker;

    try {
      worker = ensureSharedWorker();
    } catch (error) {
      workerUnavailable = true;
      reject(error);
      return;
    }

    pendingWorkerRequests.set(request.requestId, {
      resolve: (value: unknown) => resolve(value as TResponse),
      reject,
    });

    try {
      worker.postMessage(request);
    } catch (error) {
      workerUnavailable = true;
      clearPendingRequest(request.requestId);
      disposeSharedWorker(error);
      reject(error);
    }
  });
};

export const requestXmlCompletionsWithWorker = (
  documentFlavor: SourceCodeDocumentFlavor,
  textBeforeCursor: string,
): Promise<XmlCompletionEntry[]> => postRequestToWorker<XmlCompletionEntry[]>({
  type: 'xml-completion',
  requestId: nextRequestId(),
  documentFlavor,
  textBeforeCursor,
});

export const requestXmlValidationWithWorker = (
  code: string,
  documentFlavor: SourceCodeDocumentFlavor,
  texts: XmlDocumentValidationTexts,
): Promise<ValidationError[]> => postRequestToWorker<ValidationError[]>({
  type: 'xml-validation',
  requestId: nextRequestId(),
  documentFlavor,
  code,
  texts,
});

export const disposeXmlEditorWorker = (): void => {
  workerUnavailable = false;
  disposeSharedWorker();
};
