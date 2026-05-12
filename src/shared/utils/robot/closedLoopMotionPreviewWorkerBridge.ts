import type {
  ClosedLoopDrivenJointMotionResult,
  ClosedLoopMotionCompensation,
  ClosedLoopMotionSolveOptions,
} from '@/core/robot/closedLoops';
import type { RobotState } from '@/types';

type ClosedLoopMotionPreviewWorkerSolveOptions = Omit<
  ClosedLoopMotionSolveOptions,
  'angles' | 'quaternions' | 'lockedJointIds'
>;

interface ClosedLoopMotionPreviewWorkerRequest {
  type: 'resolve-motion-preview';
  requestId: number;
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>;
  jointId: string;
  angle: number;
  options?: ClosedLoopMotionPreviewWorkerSolveOptions;
}

interface ClosedLoopMotionPreviewWorkerSuccessResponse {
  type: 'resolve-motion-preview-result';
  requestId: number;
  solution: ClosedLoopDrivenJointMotionResult;
}

interface ClosedLoopMotionPreviewWorkerErrorResponse {
  type: 'resolve-motion-preview-error';
  requestId: number;
  error: string;
}

type ClosedLoopMotionPreviewWorkerResponse =
  | ClosedLoopMotionPreviewWorkerSuccessResponse
  | ClosedLoopMotionPreviewWorkerErrorResponse;

interface PendingRequest {
  resolve: (value: ClosedLoopDrivenJointMotionResult) => void;
  reject: (error: unknown) => void;
}

const pendingRequests = new Map<number, PendingRequest>();
let requestIdCounter = 0;
let sharedWorker: Worker | null = null;
let workerUnavailable = false;

function clearPendingRequest(requestId: number): PendingRequest | null {
  const pendingRequest = pendingRequests.get(requestId) ?? null;
  if (!pendingRequest) {
    return null;
  }

  pendingRequests.delete(requestId);
  return pendingRequest;
}

function disposeSharedWorker(rejectPendingWith?: unknown): void {
  if (sharedWorker) {
    sharedWorker.removeEventListener('message', handleWorkerMessage);
    sharedWorker.removeEventListener('error', handleWorkerError);
    sharedWorker.terminate();
    sharedWorker = null;
  }

  if (rejectPendingWith !== undefined) {
    pendingRequests.forEach((request, requestId) => {
      clearPendingRequest(requestId);
      request.reject(rejectPendingWith);
    });
  }
}

function handleWorkerMessage(event: MessageEvent<ClosedLoopMotionPreviewWorkerResponse>): void {
  const message = event.data;
  if (!message) {
    return;
  }

  const pendingRequest = clearPendingRequest(message.requestId);
  if (!pendingRequest) {
    return;
  }

  if (message.type === 'resolve-motion-preview-error') {
    pendingRequest.reject(new Error(message.error || 'Closed-loop motion preview worker failed'));
    return;
  }

  pendingRequest.resolve(message.solution);
}

function handleWorkerError(event: ErrorEvent): void {
  workerUnavailable = true;
  const error =
    event.error ?? new Error(event.message || 'Closed-loop motion preview worker failed');
  disposeSharedWorker(error);
}

function ensureSharedWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(
      new URL('../../workers/closedLoopMotionPreview.worker.ts', import.meta.url),
      { type: 'module' },
    );
    sharedWorker.addEventListener('message', handleWorkerMessage);
    sharedWorker.addEventListener('error', handleWorkerError);
  }

  return sharedWorker;
}

export async function resolveClosedLoopDrivenJointMotionWithWorker(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  jointId: string,
  angle: number,
  options: ClosedLoopMotionPreviewWorkerSolveOptions = {},
): Promise<ClosedLoopDrivenJointMotionResult> {
  if (workerUnavailable) {
    throw new Error('Closed-loop motion preview worker is unavailable');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Web Worker is not available in this environment');
  }

  return new Promise<ClosedLoopDrivenJointMotionResult>((resolve, reject) => {
    const requestId = ++requestIdCounter;
    let worker: Worker;

    try {
      worker = ensureSharedWorker();
    } catch (error) {
      workerUnavailable = true;
      reject(error);
      return;
    }

    const request: ClosedLoopMotionPreviewWorkerRequest = {
      type: 'resolve-motion-preview',
      requestId,
      robot,
      jointId,
      angle,
      options,
    };

    pendingRequests.set(requestId, { resolve, reject });

    try {
      worker.postMessage(request);
    } catch (error) {
      workerUnavailable = true;
      clearPendingRequest(requestId);
      disposeSharedWorker(error);
      reject(error);
    }
  });
}

export async function resolveClosedLoopJointMotionCompensationWithWorker(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  jointId: string,
  angle: number,
): Promise<ClosedLoopMotionCompensation> {
  const solution = await resolveClosedLoopDrivenJointMotionWithWorker(robot, jointId, angle);
  return {
    angles: solution.angles,
    quaternions: solution.quaternions,
  };
}

export function disposeClosedLoopMotionPreviewWorker(rejectPendingWith?: unknown): void {
  disposeSharedWorker(rejectPendingWith);
}
