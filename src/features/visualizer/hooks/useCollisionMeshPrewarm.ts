import React from 'react';

import type { RobotState } from '@/types';
import {
  preloadManagedMeshAsset,
  useWorkspaceCanvasInteractionState,
} from '@/shared/components/3d';
import {
  collectVisualizerCollisionMeshPreloadSpecs,
  resolveVisualizerCollisionMeshPrewarmConcurrency,
} from '../utils/visualizerMeshLoading';
import { sortCollisionPreloadSpecs } from '../utils/collisionRevealScheduling';

interface UseCollisionMeshPrewarmOptions {
  active: boolean;
  assets: Record<string, string>;
  hoveredLinkId?: string | null;
  prioritizedComponentIds?: readonly (string | null | undefined)[];
  robot: RobotState;
  rootLinkId?: string | null;
  selectedLinkId?: string | null;
  visibleComponentIdByLinkId?: ReadonlyMap<string, string>;
}

interface CollisionMeshPrewarmState {
  expectedMeshLoadKeys: readonly string[];
  meshLoadKeys: ReadonlySet<string>;
  signature: string;
}

export function useCollisionMeshPrewarm({
  active,
  assets,
  hoveredLinkId,
  prioritizedComponentIds,
  robot,
  rootLinkId,
  selectedLinkId,
  visibleComponentIdByLinkId,
}: UseCollisionMeshPrewarmOptions): CollisionMeshPrewarmState {
  const isInteracting = useWorkspaceCanvasInteractionState();
  const basePreloadSpecs = React.useMemo(
    () => collectVisualizerCollisionMeshPreloadSpecs({ robot, assets }),
    [assets, robot],
  );
  const preloadSpecs = React.useMemo(
    () =>
      sortCollisionPreloadSpecs(basePreloadSpecs, {
        hoveredLinkId,
        prioritizedComponentIds,
        rootLinkId,
        selectedLinkId,
        visibleComponentIdByLinkId,
      }),
    [
      basePreloadSpecs,
      hoveredLinkId,
      prioritizedComponentIds,
      rootLinkId,
      selectedLinkId,
      visibleComponentIdByLinkId,
    ],
  );
  const preloadSignature = React.useMemo(
    () =>
      preloadSpecs
        .map((spec) => {
          return [
            spec.assetUrl,
            spec.assetBaseDir,
            spec.extension,
            spec.meshPath,
            spec.meshLoadKeys.join(','),
          ].join('|');
        })
        .join('\u0000'),
    [preloadSpecs],
  );
  const expectedMeshLoadKeys = React.useMemo(
    () => preloadSpecs.flatMap((spec) => spec.meshLoadKeys),
    [preloadSpecs],
  );
  const preloadConcurrency = React.useMemo(
    () =>
      resolveVisualizerCollisionMeshPrewarmConcurrency({
        specCount: preloadSpecs.length,
      }),
    [preloadSpecs.length],
  );
  const [prewarmedMeshLoadKeys, setPrewarmedMeshLoadKeys] = React.useState<Set<string>>(
    () => new Set<string>(),
  );

  React.useEffect(() => {
    setPrewarmedMeshLoadKeys(new Set<string>());
  }, [preloadSignature]);

  React.useEffect(() => {
    if (!active || isInteracting || preloadSpecs.length === 0) {
      return;
    }

    let cancelled = false;
    let preloadIndex = 0;
    let frameHandle: number | null = null;

    const cancelScheduledWork = () => {
      if (frameHandle !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(frameHandle);
        frameHandle = null;
      }
    };

    const preloadNextMesh = async () => {
      while (!cancelled) {
        const nextSpec = preloadSpecs[preloadIndex];
        preloadIndex += 1;
        if (!nextSpec) {
          return;
        }

        try {
          await preloadManagedMeshAsset({
            assetBaseDir: nextSpec.assetBaseDir,
            assetUrl: nextSpec.assetUrl,
            assets,
            extension: nextSpec.extension,
          });
          if (!cancelled && nextSpec.meshLoadKeys.length > 0) {
            React.startTransition(() => {
              setPrewarmedMeshLoadKeys((current) => {
                let next = current;

                nextSpec.meshLoadKeys.forEach((meshLoadKey) => {
                  if (next.has(meshLoadKey)) {
                    return;
                  }

                  if (next === current) {
                    next = new Set(current);
                  }
                  next.add(meshLoadKey);
                });

                return next;
              });
            });
          }
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn('[VisualizerScene] Collision mesh prewarm failed', {
              error,
              meshPath: nextSpec.meshPath,
            });
          }
        }
      }
    };

    const startPreloadWorkers = () => {
      const workerCount = Math.max(1, preloadConcurrency);
      for (let index = 0; index < workerCount; index += 1) {
        void preloadNextMesh();
      }
    };

    const waitForStableFrames = (remainingFrames: number) => {
      if (cancelled) {
        return;
      }

      if (
        typeof window === 'undefined' ||
        typeof window.requestAnimationFrame !== 'function' ||
        remainingFrames <= 0
      ) {
        startPreloadWorkers();
        return;
      }

      frameHandle = window.requestAnimationFrame(() => {
        frameHandle = null;
        waitForStableFrames(remainingFrames - 1);
      });
    };

    waitForStableFrames(2);

    return () => {
      cancelled = true;
      cancelScheduledWork();
    };
  }, [active, assets, isInteracting, preloadConcurrency, preloadSpecs]);

  return React.useMemo(
    () => ({
      expectedMeshLoadKeys,
      meshLoadKeys: prewarmedMeshLoadKeys,
      signature: preloadSignature,
    }),
    [expectedMeshLoadKeys, preloadSignature, prewarmedMeshLoadKeys],
  );
}
