import { WORKSPACE_DEFAULT_CAMERA_POSITION } from '../../../shared/components/3d/scene/constants.ts';

const EMBEDDED_USD_VIEWER_SAFE_LOAD_FLAGS = {
  fastLoad: '1',
  nonBlockingLoad: '0',
  aggressiveInitialDraw: '1',
  strictOneShot: '1',
  yieldDuringLoad: '0',
  // Keep the viewer blocked until the runtime has authored joint/dynamics
  // metadata for the stage. Large quadrupeds such as Unitree B2 collapse into
  // a zero-pose fallback if interactive mode begins before this data is ready.
  resolveRobotMetadataBeforeReady: '1',
  requireCompleteRobotMetadata: '1',
  warmupRuntimeBridge: '1',
} as const;

export interface CreateEmbeddedUsdViewerLoadParamsOptions {
  preferWorkerResolvedRobotData?: boolean;
  preferSlicedMainThreadLoadForLargePureUsd?: boolean;
  dependenciesPreloadedToVirtualFs?: boolean;
}

export type EmbeddedUsdViewerLoadProfile =
  | 'default-embedded'
  | 'worker-bootstrap'
  | 'large-pure-usd-sliced';

export function resolveEmbeddedUsdViewerLoadProfile(
  options: CreateEmbeddedUsdViewerLoadParamsOptions = {},
): EmbeddedUsdViewerLoadProfile {
  if (options.preferWorkerResolvedRobotData) {
    return 'worker-bootstrap';
  }

  if (options.preferSlicedMainThreadLoadForLargePureUsd) {
    return 'large-pure-usd-sliced';
  }

  return 'default-embedded';
}

export function createEmbeddedUsdViewerLoadParams(
  threadCount: number,
  options: CreateEmbeddedUsdViewerLoadParamsOptions = {},
): URLSearchParams {
  const params = new URLSearchParams();
  const safeLoadFlags: Record<string, string> = {
    ...EMBEDDED_USD_VIEWER_SAFE_LOAD_FLAGS,
  };

  const loadProfile = resolveEmbeddedUsdViewerLoadProfile(options);

  if (loadProfile === 'worker-bootstrap') {
    // Once the stage-open bundle and RobotData bootstrap are already running in
    // workers, prefer an interactive load profile so the renderer yields during
    // mesh hydration instead of monopolizing the main thread until one-shot
    // completion.
    safeLoadFlags.nonBlockingLoad = '1';
    safeLoadFlags.aggressiveInitialDraw = '0';
    safeLoadFlags.strictOneShot = '0';
    safeLoadFlags.yieldDuringLoad = '1';
    safeLoadFlags.resolveRobotMetadataBeforeReady = '0';
    safeLoadFlags.requireCompleteRobotMetadata = '0';
  }

  if (loadProfile === 'large-pure-usd-sliced') {
    // Folder-imported pure `.usd` roots such as `unitree_model/*/usd/*.usd`
    // should reveal the first drawable scene as early as possible, then keep
    // hydrating remaining meshes/dependencies in the background. This improves
    // perceived responsiveness during large vendor bundle imports.
    safeLoadFlags.nonBlockingLoad = '1';
    safeLoadFlags.aggressiveInitialDraw = '0';
    safeLoadFlags.strictOneShot = '0';
    safeLoadFlags.yieldDuringLoad = '1';
    safeLoadFlags.resolveRobotMetadataBeforeReady = '0';
    safeLoadFlags.requireCompleteRobotMetadata = '0';
  }

  if (options.dependenciesPreloadedToVirtualFs) {
    safeLoadFlags.dependenciesPreloadedToVirtualFs = '1';
    safeLoadFlags.autoLoadDependencies = '0';
  }

  params.set('threads', String(threadCount));
  // Preserve the viewer's proven embedded-load defaults while optionally
  // relaxing robot metadata readiness when a parallel worker bootstrap is active.
  Object.entries(safeLoadFlags).forEach(([key, value]) => {
    params.set(key, value);
  });

  // Keep embedded USD framing aligned with the URDF/MJCF workspace viewer.
  params.set('cameraX', String(WORKSPACE_DEFAULT_CAMERA_POSITION[0]));
  params.set('cameraY', String(WORKSPACE_DEFAULT_CAMERA_POSITION[1]));
  params.set('cameraZ', String(WORKSPACE_DEFAULT_CAMERA_POSITION[2]));

  return params;
}
