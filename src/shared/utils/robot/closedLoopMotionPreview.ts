import { resolveClosedLoopDrivenJointMotion } from '@/core/robot';
import type {
  ClosedLoopDrivenJointMotionResult,
  ClosedLoopMotionSolveOptions,
} from '@/core/robot/closedLoops';
import type { JointQuaternion, RobotState } from '@/types';
import { resolveClosedLoopDrivenJointMotionWithWorker } from './closedLoopMotionPreviewWorkerBridge';

type ClosedLoopMotionPreviewRobot = Pick<
  RobotState,
  'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
>;

type ClosedLoopMotionPreviewWorkerSolveOptions = Omit<
  ClosedLoopMotionSolveOptions,
  'angles' | 'quaternions' | 'lockedJointIds'
>;

export type ClosedLoopMotionPreviewWorkerSolve = (
  robot: ClosedLoopMotionPreviewRobot,
  jointId: string,
  angle: number,
  options?: ClosedLoopMotionPreviewWorkerSolveOptions,
) => Promise<ClosedLoopDrivenJointMotionResult>;

export interface ClosedLoopMotionPreviewState {
  angles: Record<string, number>;
  quaternions: Record<string, JointQuaternion>;
}

export interface ClosedLoopMotionPreviewResult extends ClosedLoopMotionPreviewState {
  appliedAngle: number | null;
  constrained: boolean;
}

export interface ClosedLoopMotionPreviewSession {
  setBaseRobot: (robot: ClosedLoopMotionPreviewRobot | null) => void;
  solve: (jointId: string, angle: number) => ClosedLoopMotionPreviewResult;
  reset: () => void;
}

export interface AsyncClosedLoopMotionPreviewSession {
  setBaseRobot: (robot: ClosedLoopMotionPreviewRobot | null) => void;
  solve: (jointId: string, angle: number) => Promise<ClosedLoopMotionPreviewResult>;
  reset: () => void;
}

function isSameAngle(left: number | undefined, right: number | undefined): boolean {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return left === right;
  }

  return Math.abs(left - right) <= 1e-6;
}

function isSameQuaternion(
  left: JointQuaternion | undefined,
  right: JointQuaternion | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    isSameAngle(left.x, right.x) &&
    isSameAngle(left.y, right.y) &&
    isSameAngle(left.z, right.z) &&
    isSameAngle(left.w, right.w)
  );
}

export function buildClosedLoopMotionPreviewRobot(
  robot: ClosedLoopMotionPreviewRobot,
  previewState: ClosedLoopMotionPreviewState,
): ClosedLoopMotionPreviewRobot {
  const seededRobot = structuredClone(robot);

  Object.entries(previewState.angles).forEach(([jointId, angle]) => {
    if (seededRobot.joints[jointId]) {
      seededRobot.joints[jointId].angle = angle;
    }
  });

  Object.entries(previewState.quaternions).forEach(([jointId, quaternion]) => {
    if (seededRobot.joints[jointId]) {
      seededRobot.joints[jointId].quaternion = quaternion;
    }
  });

  return seededRobot;
}

export function resolveClosedLoopJointMotionPreview(
  robot: ClosedLoopMotionPreviewRobot,
  jointId: string,
  angle: number,
  previewState: ClosedLoopMotionPreviewState,
): ClosedLoopMotionPreviewResult {
  const seededRobot = buildClosedLoopMotionPreviewRobot(robot, previewState);
  const solution = resolveClosedLoopDrivenJointMotion(seededRobot, jointId, angle, {
    maxIterations: 4,
    tolerance: 1e-4,
  });

  return {
    angles: solution.angles,
    quaternions: solution.quaternions,
    appliedAngle: solution.appliedAngle,
    constrained: solution.constrained,
  };
}

function collectClosedLoopMotionPreviewState(
  baseRobot: Pick<RobotState, 'joints'>,
  workingRobot: Pick<RobotState, 'joints'>,
): ClosedLoopMotionPreviewState {
  const angles: Record<string, number> = {};
  const quaternions: Record<string, JointQuaternion> = {};

  Object.entries(workingRobot.joints).forEach(([jointId, joint]) => {
    const baseJoint = baseRobot.joints[jointId];
    if (!baseJoint) {
      return;
    }

    if (typeof joint.angle === 'number' && !isSameAngle(joint.angle, baseJoint.angle)) {
      angles[jointId] = joint.angle;
    }

    if (joint.quaternion && !isSameQuaternion(joint.quaternion, baseJoint.quaternion)) {
      quaternions[jointId] = joint.quaternion;
    }
  });

  return { angles, quaternions };
}

function applyClosedLoopMotionSolution(
  workingRobot: ClosedLoopMotionPreviewRobot,
  solution: ClosedLoopDrivenJointMotionResult,
): void {
  Object.entries(solution.angles).forEach(([compensatedJointId, compensatedAngle]) => {
    if (workingRobot.joints[compensatedJointId]) {
      workingRobot.joints[compensatedJointId].angle = compensatedAngle;
    }
  });

  Object.entries(solution.quaternions).forEach(([compensatedJointId, compensatedQuaternion]) => {
    if (workingRobot.joints[compensatedJointId]) {
      workingRobot.joints[compensatedJointId].quaternion = compensatedQuaternion;
    }
  });
}

export function createClosedLoopMotionPreviewSession(): ClosedLoopMotionPreviewSession {
  let baseRobot: ClosedLoopMotionPreviewRobot | null = null;
  let workingRobot: ClosedLoopMotionPreviewRobot | null = null;

  const resetWorkingRobot = () => {
    workingRobot = baseRobot ? structuredClone(baseRobot) : null;
  };

  return {
    setBaseRobot(robot) {
      if (baseRobot === robot) {
        return;
      }

      baseRobot = robot;
      resetWorkingRobot();
    },

    solve(jointId, angle) {
      if (!baseRobot) {
        return { angles: {}, quaternions: {}, appliedAngle: null, constrained: false };
      }

      if (!workingRobot) {
        resetWorkingRobot();
      }

      if (!workingRobot || !workingRobot.joints[jointId]) {
        return { angles: {}, quaternions: {}, appliedAngle: null, constrained: false };
      }

      const solution = resolveClosedLoopDrivenJointMotion(workingRobot, jointId, angle, {
        maxIterations: 4,
        tolerance: 1e-4,
      });

      applyClosedLoopMotionSolution(workingRobot, solution);

      return {
        ...collectClosedLoopMotionPreviewState(baseRobot, workingRobot),
        appliedAngle: solution.appliedAngle,
        constrained: solution.constrained,
      };
    },

    reset() {
      resetWorkingRobot();
    },
  };
}

export function createClosedLoopMotionPreviewWorkerSession(
  solveWithWorker: ClosedLoopMotionPreviewWorkerSolve = resolveClosedLoopDrivenJointMotionWithWorker,
): AsyncClosedLoopMotionPreviewSession {
  let baseRobot: ClosedLoopMotionPreviewRobot | null = null;
  let workingRobot: ClosedLoopMotionPreviewRobot | null = null;
  let solveGeneration = 0;

  const resetWorkingRobot = () => {
    solveGeneration += 1;
    workingRobot = baseRobot ? structuredClone(baseRobot) : null;
  };

  return {
    setBaseRobot(robot) {
      if (baseRobot === robot) {
        return;
      }

      baseRobot = robot;
      resetWorkingRobot();
    },

    async solve(jointId, angle) {
      if (!baseRobot) {
        return { angles: {}, quaternions: {}, appliedAngle: null, constrained: false };
      }

      if (!workingRobot) {
        resetWorkingRobot();
      }

      if (!workingRobot || !workingRobot.joints[jointId]) {
        return { angles: {}, quaternions: {}, appliedAngle: null, constrained: false };
      }

      const requestGeneration = ++solveGeneration;
      const solveRobot = structuredClone(workingRobot);
      const solution = await solveWithWorker(solveRobot, jointId, angle, {
        maxIterations: 4,
        tolerance: 1e-4,
      });

      if (requestGeneration !== solveGeneration || !baseRobot) {
        return { angles: {}, quaternions: {}, appliedAngle: null, constrained: false };
      }

      applyClosedLoopMotionSolution(solveRobot, solution);
      workingRobot = solveRobot;

      return {
        ...collectClosedLoopMotionPreviewState(baseRobot, workingRobot),
        appliedAngle: solution.appliedAngle,
        constrained: solution.constrained,
      };
    },

    reset() {
      resetWorkingRobot();
    },
  };
}
