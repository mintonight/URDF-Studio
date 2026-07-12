/**
 * Worker bridge for STEP export — mirrors the exportArchiveAssetsWorkerBridge
 * pattern. Lazily creates a single Web Worker that hosts the OpenCascade.js
 * WASM kernel, sends the link geometry payloads, and returns the STEP bytes.
 */

import type {
  StepLinkPayload,
  StepWorkerRequest,
  StepWorkerResponse,
  StepWorkerSuccess,
} from './stepOcctWorker';

export interface StepWorkerResult {
  /** STEP file bytes. */
  data: Uint8Array;
  linkCount: number;
  shapeCount: number;
  warnings: string[];
}

interface WorkerLike {
  addEventListener: Worker['addEventListener'];
  removeEventListener: Worker['removeEventListener'];
  postMessage: Worker['postMessage'];
  terminate: Worker['terminate'];
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function createWorkerError(event: ErrorEvent | { error?: unknown; message?: string }): Error {
  if (event.error instanceof Error) {
    return event.error;
  }
  return new Error(event.message || 'STEP export worker failed');
}

export interface ExportStepWithWorkerParams {
  robotName: string;
  links: StepLinkPayload[];
  meshMode?: import('./stepMeshTypes').StepMeshMode;
}

export async function exportStepWithWorker(
  params: ExportStepWithWorkerParams,
): Promise<StepWorkerResult> {
  if (typeof Worker === 'undefined') {
    throw new Error('STEP export requires Web Worker support, which is unavailable.');
  }

  const worker: WorkerLike = new Worker(
    new URL('./stepOcctWorker.ts', import.meta.url),
    { type: 'module' },
  );

  const request: StepWorkerRequest = {
    type: 'build',
    links: params.links,
    robotName: params.robotName,
    meshMode: params.meshMode,
  };

  return new Promise<StepWorkerResult>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutId);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('STEP export worker timed out — the model may be too complex.'));
    }, DEFAULT_REQUEST_TIMEOUT_MS);

    const onMessage = (event: MessageEvent<StepWorkerResponse>) => {
      const response = event.data;
      if (!response) return;
      cleanup();

      if (response.type === 'done') {
        const success = response as StepWorkerSuccess;
        resolve({
          data: success.data,
          linkCount: success.linkCount,
          shapeCount: success.shapeCount,
          warnings: success.warnings ?? [],
        });
      } else {
        reject(new Error(response.message || 'STEP export worker reported an error.'));
      }
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(createWorkerError(event));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(request);
  });
}
