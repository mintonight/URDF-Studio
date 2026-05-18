import type {
  ClosedLoopDrivenJointMotionResult,
  ClosedLoopMotionCompensation,
  ClosedLoopMotionSolveOptions,
} from '@/core/robot/closedLoops';
import { resolveDefaultWorkerCount } from '@/core/workers/workerPoolClient';
import type { RobotState } from '@/types';
import type { ClosedLoopMotionPreviewState } from './closedLoopMotionPreview';

type ClosedLoopMotionPreviewWorkerSolveOptions = Omit<
  ClosedLoopMotionSolveOptions,
  'angles' | 'quaternions' | 'lockedJointIds'
>;

interface ClosedLoopMotionPreviewWorkerRequest {
  type: 'resolve-motion-preview';
  requestId: number;
  robot?: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>;
  jointId: string;
  angle: number;
  options?: ClosedLoopMotionPreviewWorkerSolveOptions;
  previewState?: ClosedLoopMotionPreviewState;
}

interface ClosedLoopMotionPreviewWorkerSetBaseRobotRequest {
  type: 'set-base-robot';
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'> | null;
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
  workerEntry: ClosedLoopMotionPreviewWorkerPoolEntry;
}

interface ClosedLoopMotionPreviewWorkerPoolEntry {
  worker: Worker;
  pendingCount: number;
  baseRobot:
    | Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>
    | null;
}

const pendingRequests = new Map<number, PendingRequest>();
let requestIdCounter = 0;
const workerPool: ClosedLoopMotionPreviewWorkerPoolEntry[] = [];
let workerUnavailable = false;

function clearPendingRequest(requestId: number): PendingRequest | null {
  const pendingRequest = pendingRequests.get(requestId) ?? null;
  if (!pendingRequest) {
    return null;
  }

  pendingRequests.delete(requestId);
  pendingRequest.workerEntry.pendingCount = Math.max(0, pendingRequest.workerEntry.pendingCount - 1);
  return pendingRequest;
}

function disposeWorkerPool(rejectPendingWith?: unknown): void {
  workerPool.forEach((entry) => {
    entry.worker.removeEventListener('message', handleWorkerMessage);
    entry.worker.removeEventListener('error', handleWorkerError);
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
  disposeWorkerPool(error);
}

function createPreviewWorker(): Worker {
  const worker = new Worker(
    new URL('../../workers/closedLoopMotionPreview.worker.ts', import.meta.url),
    { type: 'module' },
  );
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', handleWorkerError);
  return worker;
}

function resolveClosedLoopPreviewWorkerCount(): number {
  return Math.max(1, Math.min(4, resolveDefaultWorkerCount()));
}

function ensureWorkerPool(): ClosedLoopMotionPreviewWorkerPoolEntry {
  if (workerPool.length === 0) {
    const workerCount = resolveClosedLoopPreviewWorkerCount();
    for (let index = 0; index < workerCount; index += 1) {
      workerPool.push({
        worker: createPreviewWorker(),
        pendingCount: 0,
        baseRobot: null,
      });
    }
  }

  let bestEntry = workerPool[0];
  for (let index = 1; index < workerPool.length; index += 1) {
    if (workerPool[index].pendingCount < bestEntry.pendingCount) {
      bestEntry = workerPool[index];
    }
  }

  return bestEntry;
}

export async function resolveClosedLoopDrivenJointMotionWithWorker(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  jointId: string,
  angle: number,
  options: ClosedLoopMotionPreviewWorkerSolveOptions = {},
  previewState?: ClosedLoopMotionPreviewState,
): Promise<ClosedLoopDrivenJointMotionResult> {
  if (workerUnavailable) {
    throw new Error('Closed-loop motion preview worker is unavailable');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Web Worker is not available in this environment');
  }

  return new Promise<ClosedLoopDrivenJointMotionResult>((resolve, reject) => {
    const requestId = ++requestIdCounter;
    let workerEntry: ClosedLoopMotionPreviewWorkerPoolEntry;

    try {
      workerEntry = ensureWorkerPool();
    } catch (error) {
      workerUnavailable = true;
      reject(error);
      return;
    }

    try {
      if (workerEntry.baseRobot !== robot) {
        const setBaseRequest: ClosedLoopMotionPreviewWorkerSetBaseRobotRequest = {
          type: 'set-base-robot',
          robot,
        };
        workerEntry.worker.postMessage(setBaseRequest);
        workerEntry.baseRobot = robot;
      }
    } catch (error) {
      workerUnavailable = true;
      disposeWorkerPool(error);
      reject(error);
      return;
    }

    const request: ClosedLoopMotionPreviewWorkerRequest = {
      type: 'resolve-motion-preview',
      requestId,
      jointId,
      angle,
      options,
      previewState,
    };

    pendingRequests.set(requestId, { resolve, reject, workerEntry });
    workerEntry.pendingCount += 1;

    try {
      workerEntry.worker.postMessage(request);
    } catch (error) {
      workerUnavailable = true;
      clearPendingRequest(requestId);
      disposeWorkerPool(error);
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
  disposeWorkerPool(rejectPendingWith);
  workerUnavailable = false;
}
