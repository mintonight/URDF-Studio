import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import type { Theme } from '@/types';
import { useRobotStore } from '@/store';
import { GroundShadowPlane } from './GroundShadowPlane';
import { ReferenceGrid } from './ReferenceGrid';
import { useWorkspaceCanvasInteractionState } from './interactionQuality';
import { useSceneBoundsCache } from './useSceneBoundsCache';
import {
  areGroundPlaneLayoutsEqual,
  resolveGroundPlaneLayout,
  type GroundPlaneLayout,
} from './groundPlaneSizing';

interface AdaptiveGroundPlaneProps {
  theme: Theme;
  groundOffset?: number;
  showShadow?: boolean;
}

interface SceneEventDispatcherLike {
  addEventListener?: (type: string, listener: (...args: never[]) => void) => void;
  removeEventListener?: (type: string, listener: (...args: never[]) => void) => void;
}

export function AdaptiveGroundPlane({
  theme,
  groundOffset = 0,
  showShadow = false,
}: AdaptiveGroundPlaneProps) {
  const scene = useThree((state) => state.scene);
  const isInteracting = useWorkspaceCanvasInteractionState();
  const { getLayoutBounds, invalidate: invalidateSceneBounds } = useSceneBoundsCache();
  const [layout, setLayout] = useState<GroundPlaneLayout>(() => resolveGroundPlaneLayout(null));
  const layoutRef = useRef(layout);

  const refreshLayout = useCallback(() => {
    const nextLayout = resolveGroundPlaneLayout(getLayoutBounds());
    if (areGroundPlaneLayoutsEqual(layoutRef.current, nextLayout)) {
      return;
    }

    layoutRef.current = nextLayout;
    setLayout(nextLayout);
  }, [getLayoutBounds]);

  // First mount + recover from interaction: pick up the latest bounds.
  // useLayoutEffect mirrors the prior behavior of running the refresh in
  // the same commit as the interaction-state change so the ground plane
  // does not visibly snap a frame later.
  useLayoutEffect(() => {
    if (isInteracting) {
      return;
    }
    refreshLayout();
  }, [isInteracting, refreshLayout]);

  // Event-driven refresh: scene tree mutations (robot load/unload,
  // helpers attach/detach) flip the cache's dirty flag via the cache's own
  // listeners. Mirror those listeners here so the ground plane re-renders
  // immediately on robot load/unload without waiting for the next
  // interaction tick. The previous implementation polled the scene at
  // 4 Hz via useFrame; that traversal dominated demand-driven idle work
  // once several MJCF models were loaded.
  //
  // Also subscribe to robotStore for joint-angle commits (slider release,
  // typed values, IK solver results). These mutate Three.js Object3D
  // matrices in place without changing the scene tree, so `childadded`
  // / `childremoved` would miss them. The subscription fires synchronously
  // from inside the store's set() call — before React has re-rendered
  // RobotModel and re-applied transforms to the meshes — so the refresh is
  // deferred to the next animation frame, by which point R3F has flushed
  // the new transforms and computeVisibleMeshBounds sees current geometry.
  useEffect(() => {
    if (isInteracting) {
      return;
    }

    let scheduledFrame: number | null = null;
    const scheduleRefresh = () => {
      if (scheduledFrame !== null) return;
      scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = null;
        invalidateSceneBounds();
        refreshLayout();
      });
    };

    const sceneHandler = () => {
      invalidateSceneBounds();
      refreshLayout();
    };

    const sceneDispatcher = scene as unknown as SceneEventDispatcherLike;
    sceneDispatcher.addEventListener?.('childadded' as never, sceneHandler as never);
    sceneDispatcher.addEventListener?.('childremoved' as never, sceneHandler as never);

    const unsubscribeRobotStore = useRobotStore.subscribe((state, prev) => {
      if (state.joints !== prev.joints || state.links !== prev.links) {
        scheduleRefresh();
      }
    });

    return () => {
      sceneDispatcher.removeEventListener?.('childadded' as never, sceneHandler as never);
      sceneDispatcher.removeEventListener?.('childremoved' as never, sceneHandler as never);
      unsubscribeRobotStore();
      if (scheduledFrame !== null) {
        cancelAnimationFrame(scheduledFrame);
        scheduledFrame = null;
      }
    };
  }, [invalidateSceneBounds, isInteracting, refreshLayout, scene]);

  return (
    <>
      {showShadow ? (
        <GroundShadowPlane
          theme={theme}
          groundOffset={groundOffset}
          centerX={layout.centerX}
          centerY={layout.centerY}
          size={layout.size}
        />
      ) : null}
      <ReferenceGrid
        theme={theme}
        groundOffset={groundOffset}
        centerX={layout.centerX}
        centerY={layout.centerY}
        size={layout.size}
        fadeDistance={layout.fadeDistance}
        fadeFrom={layout.fadeFrom}
      />
    </>
  );
}
