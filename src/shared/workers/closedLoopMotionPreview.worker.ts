/// <reference lib="webworker" />

import { resolveClosedLoopDrivenJointMotion } from '@/core/robot';
import type {
  ClosedLoopDrivenJointMotionResult,
  ClosedLoopMotionSolveOptions,
} from '@/core/robot/closedLoops';
import type { RobotState } from '@/types';
import { buildClosedLoopMotionPreviewRobot } from '@/shared/utils/robot/closedLoopMotionPreview';
import type { ClosedLoopMotionPreviewState } from '@/shared/utils/robot/closedLoopMotionPreview';

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

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
let baseRobot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'> | null =
  null;

workerScope.addEventListener(
  'message',
  (
    event: MessageEvent<
      ClosedLoopMotionPreviewWorkerRequest | ClosedLoopMotionPreviewWorkerSetBaseRobotRequest
    >,
  ) => {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.type === 'set-base-robot') {
      baseRobot = message.robot;
      return;
    }

    if (message.type !== 'resolve-motion-preview') {
      return;
    }

    try {
      const sourceRobot = message.robot ?? baseRobot;
      if (!sourceRobot) {
        throw new Error('Closed-loop motion preview worker has no base robot.');
      }

      const solveRobot = message.previewState
        ? buildClosedLoopMotionPreviewRobot(sourceRobot, message.previewState)
        : sourceRobot;
      const solution = resolveClosedLoopDrivenJointMotion(
        solveRobot,
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
