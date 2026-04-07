/// <reference lib="webworker" />

import { resolveClosedLoopJointMotionCompensation } from '@/core/robot';
import type { ClosedLoopMotionCompensation } from '@/core/robot/closedLoops';
import type { RobotState } from '@/types';

interface ClosedLoopMotionPreviewWorkerRequest {
  type: 'resolve-motion-preview';
  requestId: number;
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>;
  jointId: string;
  angle: number;
}

interface ClosedLoopMotionPreviewWorkerSuccessResponse {
  type: 'resolve-motion-preview-result';
  requestId: number;
  compensation: ClosedLoopMotionCompensation;
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
      const compensation = resolveClosedLoopJointMotionCompensation(
        message.robot,
        message.jointId,
        message.angle,
      );

      const response: ClosedLoopMotionPreviewWorkerResponse = {
        type: 'resolve-motion-preview-result',
        requestId: message.requestId,
        compensation,
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
