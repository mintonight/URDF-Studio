import type { ViewerRobotDataResolution } from '@/features/editor';
import type { RobotData, UsdPreparedExportCache, UsdSceneSnapshot } from '@/types';

interface UsdHydrationResolutionLike {
  robotData: RobotData;
  stageSourcePath?: string | null;
  usdSceneSnapshot?: UsdSceneSnapshot | null;
}

interface UsdHydrationPersistencePlanOptions {
  resolution: UsdHydrationResolutionLike;
  existingSceneSnapshot?: unknown | null;
  existingPreparedExportCache?: unknown | null;
}

export interface UsdHydrationPersistencePlan {
  sceneSnapshot: unknown | null;
  shouldSeedSceneSnapshot: boolean;
  shouldSeedPreparedExportCache: boolean;
}

export interface ResolvedUsdHydrationRobotData {
  robotData: RobotData;
  preparedExportCache: UsdPreparedExportCache | null;
}

interface ResolveUsdHydrationRobotDataOptions {
  resolution: ViewerRobotDataResolution & UsdHydrationResolutionLike;
  allowSynchronousPreparedCacheFromSnapshot?: boolean;
  existingPreparedExportCache?: UsdPreparedExportCache | null;
  prepareExportCacheFromSnapshot: (
    snapshot: UsdSceneSnapshot,
    options?: {
      fileName?: string;
      resolution?: ViewerRobotDataResolution | null;
    },
  ) => UsdPreparedExportCache | null;
}

export function buildUsdHydrationPersistencePlan({
  resolution,
  existingSceneSnapshot = null,
  existingPreparedExportCache = null,
}: UsdHydrationPersistencePlanOptions): UsdHydrationPersistencePlan {
  const resolvedSceneSnapshot = existingSceneSnapshot ?? resolution.usdSceneSnapshot ?? null;

  return {
    sceneSnapshot: resolvedSceneSnapshot,
    shouldSeedSceneSnapshot: existingSceneSnapshot == null && resolution.usdSceneSnapshot != null,
    shouldSeedPreparedExportCache:
      existingPreparedExportCache == null && resolvedSceneSnapshot != null,
  };
}

export function resolveUsdHydrationRobotData({
  resolution,
  allowSynchronousPreparedCacheFromSnapshot = true,
  existingPreparedExportCache = null,
  prepareExportCacheFromSnapshot,
}: ResolveUsdHydrationRobotDataOptions): ResolvedUsdHydrationRobotData {
  const sceneSnapshot = resolution.usdSceneSnapshot ?? null;

  // Fresh worker snapshots should outrank any previously prepared cache for the
  // same file path. Reusing cached RobotData here can rehydrate a newer USD
  // import with stale mesh assignments or transforms until the deferred full
  // scene snapshot arrives.
  if (!sceneSnapshot && existingPreparedExportCache?.robotData) {
    return {
      robotData: existingPreparedExportCache.robotData,
      preparedExportCache: existingPreparedExportCache,
    };
  }

  if (sceneSnapshot && allowSynchronousPreparedCacheFromSnapshot) {
    const preparedExportCache = prepareExportCacheFromSnapshot(sceneSnapshot, {
      fileName: resolution.stageSourcePath || sceneSnapshot.stageSourcePath || undefined,
      resolution,
    });
    if (preparedExportCache?.robotData) {
      return {
        robotData: preparedExportCache.robotData,
        preparedExportCache,
      };
    }
  }

  return {
    robotData: resolution.robotData,
    preparedExportCache: null,
  };
}
