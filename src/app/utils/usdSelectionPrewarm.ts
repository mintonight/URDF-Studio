import { logRuntimeFailure } from '@/core/utils/runtimeDiagnostics';
import type { RobotFile } from '@/types';

type StageOpenSourceFile = Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>;
type StageOpenAvailableFile = Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>;

interface UsdSelectionPrewarmDependencies {
  prewarmMainThreadRuntime: () => void;
  prewarmOffscreenRuntime: () => void;
  prewarmStageOpen: (
    file: StageOpenSourceFile,
    availableFiles: StageOpenAvailableFile[],
    assets: Record<string, string>,
  ) => void;
  hasBlobBackedLargeUsdaInStageScope: (
    file: StageOpenSourceFile,
    availableFiles: StageOpenAvailableFile[],
  ) => boolean;
}

interface UsdSelectionBackgroundPrewarmDependencies {
  loadHandler: () => Promise<ReturnType<typeof createUsdSelectionPrewarmHandler>>;
  logFailure?: typeof logRuntimeFailure;
}

export function createUsdSelectionPrewarmHandler({
  prewarmMainThreadRuntime,
  prewarmOffscreenRuntime,
  prewarmStageOpen,
  hasBlobBackedLargeUsdaInStageScope,
}: UsdSelectionPrewarmDependencies): (
  file: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
) => void {
  return (file, availableFiles, assets) => {
    if (file.format !== 'usd') {
      return;
    }

    prewarmMainThreadRuntime();
    prewarmOffscreenRuntime();

    if (hasBlobBackedLargeUsdaInStageScope(file, availableFiles)) {
      return;
    }

    prewarmStageOpen(file, availableFiles, assets);
  };
}

let usdSelectionPrewarmHandlerPromise: Promise<
  ReturnType<typeof createUsdSelectionPrewarmHandler>
> | null = null;

function loadUsdSelectionPrewarmHandler() {
  if (!usdSelectionPrewarmHandlerPromise) {
    usdSelectionPrewarmHandlerPromise = Promise.all([
      import('@/features/urdf-viewer/utils/usdBlobBackedUsda'),
      import('@/features/urdf-viewer/utils/preparedUsdStageOpenCache'),
      import('@/features/urdf-viewer/utils/usdOffscreenViewerWorkerClient'),
      import('@/features/urdf-viewer/utils/usdWasmRuntime'),
    ])
      .then(([blobBackedUsda, preparedStageOpenCache, offscreenRuntime, mainThreadRuntime]) =>
        createUsdSelectionPrewarmHandler({
          hasBlobBackedLargeUsdaInStageScope: blobBackedUsda.hasBlobBackedLargeUsdaInStageScope,
          prewarmMainThreadRuntime: mainThreadRuntime.prewarmUsdWasmRuntimeInBackground,
          prewarmOffscreenRuntime: offscreenRuntime.prewarmUsdOffscreenViewerRuntimeInBackground,
          prewarmStageOpen: preparedStageOpenCache.prewarmPreparedUsdStageOpenDataInBackground,
        }),
      )
      .catch((error) => {
        usdSelectionPrewarmHandlerPromise = null;
        throw error;
      });
  }

  return usdSelectionPrewarmHandlerPromise;
}

export function createUsdSelectionBackgroundPrewarm({
  loadHandler,
  logFailure = logRuntimeFailure,
}: UsdSelectionBackgroundPrewarmDependencies): (
  file: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
) => void {
  return (file, availableFiles, assets) => {
    if (file.format !== 'usd') {
      return;
    }

    void loadHandler()
      .then((prewarm) => prewarm(file, availableFiles, assets))
      .catch((error) => {
        logFailure('prewarmUsdSelectionInBackground', error, 'warn');
      });
  };
}

const prewarmUsdSelectionInBackgroundImpl = createUsdSelectionBackgroundPrewarm({
  loadHandler: loadUsdSelectionPrewarmHandler,
});

export function prewarmUsdSelectionInBackground(
  file: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
): void {
  prewarmUsdSelectionInBackgroundImpl(file, availableFiles, assets);
}
