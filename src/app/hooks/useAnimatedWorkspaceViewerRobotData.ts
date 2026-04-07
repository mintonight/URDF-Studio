import { useEffect, useRef, useState } from 'react';

import type { RobotData } from '@/types';
import {
  buildWorkspaceViewerRobotTransitionFrame,
  hasWorkspaceViewerRobotTransitionDiff,
} from './workspaceViewerAnimation.ts';

const WORKSPACE_VIEWER_TRANSITION_DURATION_MS = 340;

function easeOutCubic(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return 1 - (1 - clamped) ** 3;
}

export function useAnimatedWorkspaceViewerRobotData(
  targetRobotData: RobotData | null,
  enabled: boolean,
): RobotData | null {
  const [animatedRobotData, setAnimatedRobotData] = useState<RobotData | null>(targetRobotData);
  const animationFrameRef = useRef<number | null>(null);
  const currentRobotDataRef = useRef<RobotData | null>(targetRobotData);

  useEffect(() => {
    currentRobotDataRef.current = animatedRobotData;
  }, [animatedRobotData]);

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!enabled || !targetRobotData) {
      currentRobotDataRef.current = targetRobotData;
      setAnimatedRobotData(targetRobotData);
      return undefined;
    }

    const fromRobotData = currentRobotDataRef.current;
    if (!hasWorkspaceViewerRobotTransitionDiff(fromRobotData, targetRobotData)) {
      currentRobotDataRef.current = targetRobotData;
      setAnimatedRobotData(targetRobotData);
      return undefined;
    }

    const animationStart = performance.now();

    const step = (timestamp: number) => {
      const alpha = Math.min(
        1,
        (timestamp - animationStart) / WORKSPACE_VIEWER_TRANSITION_DURATION_MS,
      );
      const nextRobotData = buildWorkspaceViewerRobotTransitionFrame({
        fromRobot: fromRobotData,
        toRobot: targetRobotData,
        alpha: easeOutCubic(alpha),
      });

      currentRobotDataRef.current = nextRobotData;
      setAnimatedRobotData(nextRobotData);

      if (alpha >= 1) {
        animationFrameRef.current = null;
        return;
      }

      animationFrameRef.current = requestAnimationFrame(step);
    };

    animationFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [enabled, targetRobotData]);

  return animatedRobotData;
}
