/// <reference lib="webworker" />

import { readImportedProjectArchive } from '../utils/projectImport.ts';
import type {
  ProjectImportWorkerRequest,
  ProjectImportWorkerResponse,
} from '../utils/projectImportWorker.ts';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

function toWorkerErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function handleWorkerMessage(message: ProjectImportWorkerRequest): Promise<void> {
  if (message.type !== 'import-project') {
    return;
  }

  try {
    const result = await readImportedProjectArchive(message.file, message.lang);
    const response: ProjectImportWorkerResponse = {
      type: 'import-project-result',
      requestId: message.requestId,
      result,
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: ProjectImportWorkerResponse = {
      type: 'import-project-error',
      requestId: message.requestId,
      error: toWorkerErrorMessage(error),
    };
    workerScope.postMessage(response);
  }
}

workerScope.addEventListener('message', (event: MessageEvent<ProjectImportWorkerRequest>) => {
  void handleWorkerMessage(event.data);
});

export {};
