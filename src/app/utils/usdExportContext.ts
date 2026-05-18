import type { RobotState, UsdPreparedExportCache } from '@/types';
import {
  buildUsdExportBundleFromPreparedCache,
  buildUsdExportBundleFromSnapshot,
  resolveUsdExportSceneSnapshot,
  type UsdExportBundle,
} from '@/features/urdf-viewer/utils/usdExportBundle';

export interface ResolveCurrentUsdExportBundleOptions {
  stageSourcePath: string;
  currentRobot: RobotState;
  cachedSnapshot?: unknown | null;
  preparedCache?: UsdPreparedExportCache | null;
  targetWindow?: Parameters<typeof resolveUsdExportSceneSnapshot>[0]['targetWindow'];
}

export function resolveCurrentUsdExportBundle({
  stageSourcePath,
  currentRobot,
  cachedSnapshot = null,
  preparedCache = null,
  targetWindow,
}: ResolveCurrentUsdExportBundleOptions): UsdExportBundle | null {
  const snapshot = resolveUsdExportSceneSnapshot({
    stageSourcePath,
    cachedSnapshot: cachedSnapshot as Parameters<
      typeof resolveUsdExportSceneSnapshot
    >[0]['cachedSnapshot'],
    targetWindow,
  });

  if (preparedCache) {
    const preparedBundle = buildUsdExportBundleFromPreparedCache(preparedCache, {
      currentRobot,
    });
    if (preparedBundle) {
      return preparedBundle;
    }
  }

  if (snapshot) {
    const snapshotBundle = buildUsdExportBundleFromSnapshot(snapshot, {
      fileName: stageSourcePath,
      currentRobot,
      targetWindow,
    });
    if (snapshotBundle) {
      return snapshotBundle;
    }
  }

  return null;
}
