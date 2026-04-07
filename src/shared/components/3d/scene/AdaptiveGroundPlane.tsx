import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { computeVisibleMeshBounds } from '@/shared/utils/threeBounds';
import type { Theme } from '@/types';
import { GroundShadowPlane } from './GroundShadowPlane';
import { ReferenceGrid } from './ReferenceGrid';
import { useWorkspaceCanvasInteractionState } from './interactionQuality';
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

const GROUND_LAYOUT_REFRESH_INTERVAL_SECONDS = 0.25;

export function AdaptiveGroundPlane({
  theme,
  groundOffset = 0,
  showShadow = false,
}: AdaptiveGroundPlaneProps) {
  const scene = useThree((state) => state.scene);
  const isInteracting = useWorkspaceCanvasInteractionState();
  const [layout, setLayout] = useState<GroundPlaneLayout>(() => resolveGroundPlaneLayout(null));
  const layoutRef = useRef(layout);
  const lastRefreshAtRef = useRef(Number.NEGATIVE_INFINITY);

  const refreshLayout = useCallback(() => {
    const nextLayout = resolveGroundPlaneLayout(computeVisibleMeshBounds(scene));
    if (areGroundPlaneLayoutsEqual(layoutRef.current, nextLayout)) {
      return;
    }

    layoutRef.current = nextLayout;
    setLayout(nextLayout);
  }, [scene]);

  useLayoutEffect(() => {
    if (isInteracting) {
      return;
    }
    refreshLayout();
  }, [isInteracting, refreshLayout]);

  useFrame((state) => {
    if (isInteracting) {
      return;
    }

    if (
      state.clock.elapsedTime - lastRefreshAtRef.current <
      GROUND_LAYOUT_REFRESH_INTERVAL_SECONDS
    ) {
      return;
    }

    lastRefreshAtRef.current = state.clock.elapsedTime;
    refreshLayout();
  });

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
