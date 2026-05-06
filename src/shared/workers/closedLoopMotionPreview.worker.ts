/// <reference lib="webworker" />

import { resolveClosedLoopDrivenJointMotion } from '@/core/robot';
import type {
  ClosedLoopDrivenJointMotionResult,
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

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

workerScope.addEventListener(
  'message',
  (event: MessageEvent<ClosedLoopMotionPreviewWorkerRequest>) => {
    const message = event.data;
    if (!message || message.type !== 'resolve-motion-preview') {
      return;
    }

    try {
      const solution = resolveClosedLoopDrivenJointMotion(
        message.robot,
        message.jointId,
        message.angle,
        message.options ?? {},
      );

      const response: ClosedLoopMotionPreviewWorkerResponse = {
        type: 'resolve-motion-preview-result',
        requestId: message.requestId,
        solution,
      };
      workerScope.postMessage(response);
    } catch (error) {
      const response: ClosedLoopMotionPreviewWorkerResponse = {
        type: 'resolve-motion-preview-error',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : 'Closed-loop motion preview worker failed',
      };
      workerScope.postMessage(response);
    }
  },
);

export {};
