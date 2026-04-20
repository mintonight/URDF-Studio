import {
  prewarmUsdOffscreenViewerRuntimeInBackground,
  prewarmUsdWasmRuntimeInBackground,
} from '@/features/editor';

interface UsdRuntimeStartupPrewarmDependencies {
  prewarmMainThreadRuntime: () => void;
  prewarmOffscreenRuntime: () => void;
}

export function createUsdRuntimeStartupPrewarmHandler({
  prewarmMainThreadRuntime,
  prewarmOffscreenRuntime,
}: UsdRuntimeStartupPrewarmDependencies): () => void {
  let started = false;

  return () => {
    if (started) {
      return;
    }

    started = true;
    prewarmMainThreadRuntime();
    prewarmOffscreenRuntime();
  };
}

export const prewarmUsdViewerRuntimesInBackground = createUsdRuntimeStartupPrewarmHandler({
  prewarmMainThreadRuntime: prewarmUsdWasmRuntimeInBackground,
  prewarmOffscreenRuntime: prewarmUsdOffscreenViewerRuntimeInBackground,
});
