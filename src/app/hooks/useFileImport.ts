/**
 * File Import Hook
 * Handles importing URDF, MJCF, USD, Xacro files and supported archive packages
 */
import { useCallback } from 'react';
import type { RobotFile } from '@/types';
import { DEFAULT_MOTOR_LIBRARY } from '@/shared/data/motorLibrary';
import { mergeMotorLibraryEntries } from '@/shared/data/motorLibraryMerge';
import {
  useAssetsStore,
  useRobotStore,
  useSelectionStore,
  useUIStore,
} from '@/store';
import type { ProjectImportResult } from '@/features/file-io';
import { translations } from '@/shared/i18n';
import {
  isAssetLibraryOnlyFormat,
  isLibraryPreviewableFile,
  isVisibleLibraryEntry,
  isSupportedArchiveImportFile,
  isRobotImportCandidatePath,
} from '@/shared/utils/robotFileSupport';
import { buildImportedRobotStoreState } from './projectRobotStateUtils';
import {
  prepareImportPayloadWithWorker,
  hydrateDeferredImportAssetsWithWorker,
} from './importPreparationWorkerBridge';
import { resolveRobotFileDataWithWorker } from './robotImportWorkerBridge';
import {
  detectImportFormat,
  type PreparedImportPayload,
  type PrepareImportProgress,
} from '@/app/utils/importPreparation';
import {
  buildContextualPreResolvedImports,
  shouldBuildContextualPreResolvedImports,
} from '@/app/utils/contextualPreResolvedImports';
import {
  buildStandaloneImportAssetWarning,
  buildStandalonePrimitiveGeometryHint,
  canProceedWithStandaloneImportAssetWarning,
  collectStandaloneImportSupportAssetPaths,
} from '@/app/utils/importPackageAssetReferences.ts';
import { primePreResolvedRobotImports } from '@/app/utils/preResolvedRobotImportCache';
import { prewarmUsdSelectionInBackground } from '@/app/utils/usdSelectionPrewarm';
import { markUnsavedChangesBaselineSaved } from '@/app/utils/unsavedChangesBaseline';
import { normalizeLibraryPathKey } from '@/shared/utils/pathKeys';

export interface ImportPreparationOverlayState {
  label: string;
  detail?: string;
  progress?: number | null;
  statusLabel?: string | null;
  stageLabel?: string | null;
}

export type ImportInputFiles = FileList | readonly File[] | null;
export type HandleImportResult = {
  status: 'completed' | 'skipped' | 'failed';
};

type BlobBackedAssetFile = {
  name: string;
  blob: Blob;
};

const ASSET_URL_CREATION_YIELD_INTERVAL = 256;

interface UseFileImportOptions {
  onLoadRobot?: (file: RobotFile) => void;
  onShowToast?: (message: string, type?: 'info' | 'success') => void;
  onImportPreparationStateChange?: (state: ImportPreparationOverlayState | null) => void;
  onProjectImported?: (selectedFile: RobotFile | null) => void;
  projectImporter?: (file: File, lang?: keyof typeof translations) => Promise<ProjectImportResult>;
}

function revokeBlobUrls(urls: readonly string[]): void {
  Array.from(new Set(urls)).forEach((url) => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  });
}

async function createAssetUrls(
  assetFiles: BlobBackedAssetFile[],
  options: {
    onProgress?: (progress: { processedEntries: number; totalEntries: number }) => void;
    yieldToBrowser?: boolean;
  } = {},
): Promise<Record<string, string>> {
  const assets: Record<string, string> = {};

  options.onProgress?.({ processedEntries: 0, totalEntries: assetFiles.length });

  for (let index = 0; index < assetFiles.length; index += 1) {
    const file = assetFiles[index];
    const normalizedPath = file.name.replace(/\\/g, '/').replace(/^\/+/, '');
    assets[normalizedPath] = URL.createObjectURL(file.blob);

    if (
      options.yieldToBrowser &&
      (index + 1) % ASSET_URL_CREATION_YIELD_INTERVAL === 0
    ) {
      await waitForNextPaint();
    }

    if (
      options.onProgress &&
      ((index + 1) % ASSET_URL_CREATION_YIELD_INTERVAL === 0 ||
        index + 1 === assetFiles.length)
    ) {
      options.onProgress({
        processedEntries: index + 1,
        totalEntries: assetFiles.length,
      });
    }
  }

  return assets;
}

function isRobotDefinitionFile(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  return (
    lowerName.endsWith('.urdf') ||
    lowerName.endsWith('.sdf') ||
    lowerName.endsWith('.xml') ||
    lowerName.endsWith('.mjcf') ||
    lowerName.endsWith('.usd') ||
    lowerName.endsWith('.usda') ||
    lowerName.endsWith('.usdc') ||
    lowerName.endsWith('.usdz') ||
    lowerName.endsWith('.xacro')
  );
}

function normalizeImportSourcePath(path: string): string {
  return normalizeLibraryPathKey(path);
}

function resolveImportSourceFilePath(file: File): string {
  return normalizeImportSourcePath(file.webkitRelativePath || file.name);
}

function pickPreparedPreferredFile(
  files: readonly RobotFile[],
  preferredFileName: string | null,
  preResolvedFileName: string | null,
): RobotFile | null {
  const visibleFiles = files.filter(isLibraryPreviewableFile);

  if (preferredFileName) {
    return visibleFiles.find((file) => file.name === preferredFileName) ?? null;
  }

  if (preResolvedFileName) {
    return visibleFiles.find((file) => file.name === preResolvedFileName) ?? null;
  }

  return (
    visibleFiles.find((file) => !isAssetLibraryOnlyFormat(file.format)) ??
    visibleFiles.find((file) => isLibraryPreviewableFile(file)) ??
    null
  );
}

function waitForNextPaint(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function hydrateDeferredArchiveAssetsInBackground(
  archiveFile: File,
  assetFiles: Parameters<typeof hydrateDeferredImportAssetsWithWorker>[0]['assetFiles'],
  options: {
    onShowToast?: (message: string, type?: 'info' | 'success') => void;
  },
): void {
  if (assetFiles.length === 0) {
    return;
  }

  void (async () => {
    try {
      const hydratedAssetFiles = await hydrateDeferredImportAssetsWithWorker({
        archiveFile,
        assetFiles,
      });
      if (hydratedAssetFiles.length === 0) {
        return;
      }

      useAssetsStore.getState().addAssets(await createAssetUrls(hydratedAssetFiles));
    } catch (error) {
      console.error('Deferred archive asset hydration failed after import completed:', error);
      const message =
        translations[useUIStore.getState().lang].importBackgroundAssetsStillLoadingFailed;
      options.onShowToast?.(message, 'info');
    }
  })();
}

function formatImportPreparationBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function resolveImportPreparationStageLabel(
  t: (typeof translations)[keyof typeof translations],
  progress: PrepareImportProgress,
): string {
  switch (progress.phase) {
    case 'reading-archive':
      return t.importPreparationReadingArchive;
    case 'extracting-files':
      return t.importPreparationExtractingFiles;
    case 'finalizing-import':
      return t.importPreparationFinalizingImport;
    default:
      return t.importPreparationLoadingTitle;
  }
}

function createInitialImportPreparationOverlayState(
  t: (typeof translations)[keyof typeof translations],
): ImportPreparationOverlayState {
  return {
    label: t.importPreparationLoadingTitle,
    detail: t.importPreparationLoadingDetail,
    progress: null,
    statusLabel: null,
    stageLabel: t.importPreparationReadingArchive,
  };
}

function createImportPreparationOverlayStateFromProgress(
  t: (typeof translations)[keyof typeof translations],
  progress: PrepareImportProgress,
): ImportPreparationOverlayState {
  const stageLabel = resolveImportPreparationStageLabel(t, progress);
  const normalizedProgress =
    progress.progressPercent == null
      ? null
      : Math.max(0, Math.min(1, progress.progressPercent / 100));
  const detail =
    progress.totalBytes > 0
      ? `${formatImportPreparationBytes(progress.processedBytes)} / ${formatImportPreparationBytes(progress.totalBytes)}`
      : progress.totalEntries > 0
        ? `${progress.processedEntries} / ${progress.totalEntries}`
        : stageLabel;
  const statusLabel =
    progress.totalEntries > 0
      ? `${progress.processedEntries} / ${progress.totalEntries}`
      : progress.progressPercent != null
        ? `${Math.round(progress.progressPercent)}%`
        : null;

  return {
    label: t.importPreparationLoadingTitle,
    detail,
    progress: normalizedProgress,
    statusLabel,
    stageLabel,
  };
}

export function useFileImport(options: UseFileImportOptions = {}) {
  const {
    onLoadRobot,
    onShowToast,
    onImportPreparationStateChange,
    onProjectImported,
    projectImporter,
  } = options;

  const loadRobot = useCallback(
    async (
      file: RobotFile,
      availableFiles?: RobotFile[],
      currentAssets?: Record<string, string>,
      currentAllFileContents?: Record<string, string>,
    ) => {
      const assetsState = useAssetsStore.getState();
      const importResult = await resolveRobotFileDataWithWorker(file, {
        availableFiles: availableFiles ?? assetsState.availableFiles,
        assets: currentAssets ?? assetsState.assets,
        allFileContents: currentAllFileContents ?? assetsState.allFileContents,
        // Let USD imports resolve through the current hydration pipeline. A
        // prepared cache is auxiliary export data, not an authoritative import
        // result for a new load of the same file path.
        usdRobotData:
          file.format === 'usd'
            ? null
            : (assetsState.getUsdPreparedExportCache(file.name)?.robotData ?? null),
      });

      if (
        (importResult.status === 'ready' || importResult.status === 'needs_hydration') &&
        onLoadRobot
      ) {
        onLoadRobot(file);
      }

      return importResult;
    },
    [onLoadRobot],
  );

  const handleImport = useCallback(
    async (files: ImportInputFiles): Promise<HandleImportResult> => {
      if (!files || files.length === 0) {
        return { status: 'skipped' };
      }

      const uiState = useUIStore.getState();
      const assetsState = useAssetsStore.getState();
      const selectionState = useSelectionStore.getState();
      const t = translations[uiState.lang];
      const rawInputFiles = Array.from(files);
      const candidateInputFiles = rawInputFiles.filter((file) =>
        isRobotImportCandidatePath(resolveImportSourceFilePath(file)),
      );
      const inputFiles = candidateInputFiles.length > 0 ? candidateInputFiles : rawInputFiles;
      const isArchiveImport =
        inputFiles.length === 1 && isSupportedArchiveImportFile(inputFiles[0]?.name ?? '');
      const importsRobotDefinition = inputFiles.some((file) => isRobotDefinitionFile(file.name));
      const shouldShowPreparationOverlay =
        inputFiles.length > 1 ||
        inputFiles.some((file) => Boolean(file.webkitRelativePath)) ||
        isArchiveImport ||
        importsRobotDefinition;

      const createdBlobUrls: string[] = [];
      let importStateMutated = false;
      let importOverlayActive = false;

      const setImportPreparationOverlay = (state: ImportPreparationOverlayState | null) => {
        onImportPreparationStateChange?.(state);
        importOverlayActive = state !== null;
      };

      const clearImportPreparationOverlay = () => {
        if (!importOverlayActive) {
          return;
        }

        setImportPreparationOverlay(null);
      };

      try {
        if (files.length === 1 && files[0].name.toLowerCase().endsWith('.usp')) {
          const importProject =
            projectImporter ??
            (async (file: File, lang?: keyof typeof translations) => {
              const { importProjectWithWorker } = await import('@/features/file-io');
              return importProjectWithWorker(file, lang);
            });
          const result = await importProject(files[0], uiState.lang);
          const { manifest, assets: newAssetUrls, availableFiles: newFiles } = result;

          importStateMutated = true;
          assetsState.clearAssets();
          assetsState.addAssets(newAssetUrls);
          assetsState.setAvailableFiles(newFiles);
          assetsState.setAllFileContents(result.allFileContents);
          assetsState.setMotorLibrary(result.motorLibrary);
          assetsState.setOriginalUrdfContent(result.originalUrdfContent);
          assetsState.setOriginalFileFormat(result.originalFileFormat);
          useAssetsStore.setState({
            usdSceneSnapshots: {},
            usdPreparedExportCaches: result.usdPreparedExportCaches,
          });
          selectionState.setSelection({ type: null, id: null });

          const restoredSelectedFile = result.selectedFileName
            ? (newFiles.find((file) => file.name === result.selectedFileName) ?? null)
            : null;
          assetsState.setSelectedFile(restoredSelectedFile);
          onProjectImported?.(restoredSelectedFile);

          useRobotStore.setState(
            buildImportedRobotStoreState(
              result.robotState,
              result.robotHistory,
              result.robotActivity,
            ),
          );

          useRobotStore.setState({
            assemblyState: result.assemblyState,
            components: result.assemblyState?.components ?? {},
            bridges: result.assemblyState?.bridges ?? {},
            workspaceTransform: result.assemblyState?.transform,
            activeComponentId: Object.keys(result.assemblyState?.components ?? {})[0] ?? null,
          });

          markUnsavedChangesBaselineSaved('all');

          return { status: 'completed' };
        }

        const hadExistingAvailableFiles = assetsState.availableFiles.length > 0;
        const hadSelectedFile = Boolean(assetsState.selectedFile);

        if (shouldShowPreparationOverlay) {
          setImportPreparationOverlay(createInitialImportPreparationOverlayState(t));
          await waitForNextPaint();
        }

        const existingImportPaths = [
          ...assetsState.availableFiles.map((file) => file.name),
          ...Object.keys(assetsState.assets),
          ...Object.keys(assetsState.allFileContents),
        ];
        const onPreparationProgress = shouldShowPreparationOverlay
          ? (progress: PrepareImportProgress) => {
              setImportPreparationOverlay(
                createImportPreparationOverlayStateFromProgress(t, progress),
              );
            }
          : undefined;
        const preparedImportPayload: PreparedImportPayload = await prepareImportPayloadWithWorker({
          files: inputFiles,
          existingPaths: existingImportPaths,
          preResolvePreferredImport: false,
          onProgress: onPreparationProgress,
        });

        const {
          robotFiles: renamedRobotFiles,
          assetFiles: renamedAssetFiles,
          deferredAssetFiles: renamedDeferredAssetFiles,
          usdSourceFiles: renamedUsdSourceFiles,
          libraryFiles: renamedLibraryFiles,
          textFiles: renamedTextFiles,
          preferredFileName,
          preResolvedImports,
        } = preparedImportPayload;
        const usdSourceBlobUrls = Object.fromEntries(
          renamedUsdSourceFiles.map((file) => [file.name, URL.createObjectURL(file.blob)]),
        );
        createdBlobUrls.push(...Object.values(usdSourceBlobUrls));

        const renamedRobotFilesWithSources = renamedRobotFiles.map((file) =>
          file.format === 'usd' && usdSourceBlobUrls[file.name]
            ? { ...file, blobUrl: usdSourceBlobUrls[file.name] }
            : file,
        );
        const visibleImportedFiles = renamedRobotFilesWithSources.filter(isVisibleLibraryEntry);
        const currentMotorLibrary =
          Object.keys(assetsState.motorLibrary).length > 0
            ? assetsState.motorLibrary
            : DEFAULT_MOTOR_LIBRARY;
        let nextMotorLibrary = currentMotorLibrary;

        if (renamedLibraryFiles.length > 0) {
          const mergeResult = mergeMotorLibraryEntries(renamedLibraryFiles, currentMotorLibrary);
          if (mergeResult.parseFailures.length > 0) {
            mergeResult.parseFailures.forEach((failedPath) => {
              console.error('Failed to parse motor spec', failedPath);
            });
            throw new Error(
              `Failed to import motor library entries: ${mergeResult.parseFailures.join(', ')}`,
            );
          }
          nextMotorLibrary = mergeResult.library;
        }

        const newAssets = await createAssetUrls(renamedAssetFiles, {
          onProgress:
            shouldShowPreparationOverlay && renamedAssetFiles.length > 512
              ? ({ processedEntries, totalEntries }) => {
                  setImportPreparationOverlay({
                    label: t.importPreparationLoadingTitle,
                    detail: `${processedEntries} / ${totalEntries}`,
                    progress: totalEntries > 0 ? processedEntries / totalEntries : null,
                    statusLabel:
                      totalEntries > 0 ? `${processedEntries} / ${totalEntries}` : null,
                    stageLabel: t.importPreparationFinalizingImport,
                  });
                }
              : undefined,
          yieldToBrowser: shouldShowPreparationOverlay && renamedAssetFiles.length > 512,
        });
        createdBlobUrls.push(...Object.values(newAssets));

        let hydratedDeferredAssets: Record<string, string> = {};
        const shouldHydrateArchiveAssetsInBackground =
          isArchiveImport && renamedDeferredAssetFiles.length > 0;

        if (renamedDeferredAssetFiles.length > 0 && !shouldHydrateArchiveAssetsInBackground) {
          const archiveFilesByImportPath = new Map(
            inputFiles
              .filter((file) => isSupportedArchiveImportFile(file.name))
              .map((file) => [resolveImportSourceFilePath(file), file] as const),
          );
          const legacySourceArchiveFile =
            inputFiles.length === 1 && isSupportedArchiveImportFile(inputFiles[0]?.name ?? '')
              ? inputFiles[0]
              : null;
          const legacySourceArchiveImportPath = legacySourceArchiveFile
            ? resolveImportSourceFilePath(legacySourceArchiveFile)
            : null;
          const deferredAssetFilesByArchive = new Map<string, typeof renamedDeferredAssetFiles>();

          renamedDeferredAssetFiles.forEach((assetFile) => {
            const sourceArchiveImportPath = normalizeImportSourcePath(
              assetFile.sourceArchiveImportPath || legacySourceArchiveImportPath || '',
            );
            if (!sourceArchiveImportPath) {
              throw new Error(
                `Deferred import assets were prepared without a supported source archive for "${assetFile.name}".`,
              );
            }

            const groupedAssetFiles =
              deferredAssetFilesByArchive.get(sourceArchiveImportPath) ?? [];
            groupedAssetFiles.push(assetFile);
            deferredAssetFilesByArchive.set(sourceArchiveImportPath, groupedAssetFiles);
          });

          for (const [sourceArchiveImportPath, deferredAssetFiles] of deferredAssetFilesByArchive) {
            const sourceArchiveFile =
              archiveFilesByImportPath.get(sourceArchiveImportPath) ??
              (legacySourceArchiveImportPath === sourceArchiveImportPath
                ? legacySourceArchiveFile
                : null);

            if (!sourceArchiveFile) {
              throw new Error(
                `Deferred import assets were prepared without a supported source archive for "${preferredFileName ?? sourceArchiveImportPath}".`,
              );
            }

            const hydratedAssetFiles = await hydrateDeferredImportAssetsWithWorker({
              archiveFile: sourceArchiveFile,
              assetFiles: deferredAssetFiles,
              onProgress: shouldShowPreparationOverlay
                ? (progress) => {
                    setImportPreparationOverlay(
                      createImportPreparationOverlayStateFromProgress(t, progress),
                    );
                  }
                : undefined,
            });
            hydratedDeferredAssets = {
              ...hydratedDeferredAssets,
              ...(await createAssetUrls(hydratedAssetFiles, {
                onProgress:
                  shouldShowPreparationOverlay && hydratedAssetFiles.length > 512
                    ? ({ processedEntries, totalEntries }) => {
                        setImportPreparationOverlay({
                          label: t.importPreparationLoadingTitle,
                          detail: `${processedEntries} / ${totalEntries}`,
                          progress: totalEntries > 0 ? processedEntries / totalEntries : null,
                          statusLabel:
                            totalEntries > 0 ? `${processedEntries} / ${totalEntries}` : null,
                          stageLabel: t.importPreparationFinalizingImport,
                        });
                      }
                    : undefined,
                yieldToBrowser: shouldShowPreparationOverlay && hydratedAssetFiles.length > 512,
              })),
            };
          }
          createdBlobUrls.push(...Object.values(hydratedDeferredAssets));
        }

        const sourceAssets = {
          ...newAssets,
          ...hydratedDeferredAssets,
          ...usdSourceBlobUrls,
        };
        const mergedAssets = {
          ...assetsState.assets,
          ...sourceAssets,
        };
        const deferredAssetResolutionAssets = Object.fromEntries(
          renamedDeferredAssetFiles.map((file) => [file.name, file.name]),
        );
        const mergedResolutionAssets = {
          ...mergedAssets,
          ...deferredAssetResolutionAssets,
        };

        const existingNames = new Set(assetsState.availableFiles.map((file) => file.name));
        const uniqueNewFiles = renamedRobotFilesWithSources.filter(
          (file) => !existingNames.has(file.name),
        );
        const mergedFiles = [...assetsState.availableFiles, ...uniqueNewFiles];
        const mergedAllFileContents = {
          ...assetsState.allFileContents,
          ...Object.fromEntries(renamedTextFiles.map((file) => [file.path, file.content])),
        };

        const contextualPreResolvedImports = shouldBuildContextualPreResolvedImports({
          availableFiles: assetsState.availableFiles,
          assets: assetsState.assets,
          allFileContents: assetsState.allFileContents,
        })
          ? await buildContextualPreResolvedImports(renamedRobotFilesWithSources, {
              availableFiles: mergedFiles,
              assets: mergedResolutionAssets,
              allFileContents: mergedAllFileContents,
            })
          : [];

        const resolvedImports = [...preResolvedImports, ...contextualPreResolvedImports];
        primePreResolvedRobotImports(resolvedImports);

        if (
          uniqueNewFiles.length > 0 ||
          Object.keys(sourceAssets).length > 0 ||
          renamedTextFiles.length > 0
        ) {
          assetsState.addAssets(sourceAssets);
          assetsState.setAvailableFiles(mergedFiles);
          assetsState.setAllFileContents(mergedAllFileContents);
          importStateMutated = true;
        }

        if (renamedLibraryFiles.length > 0) {
          assetsState.setMotorLibrary(nextMotorLibrary);
          importStateMutated = true;
        }

        // Yield to the browser so the library panel renders with the new assets
        // before the potentially heavy canvas loading begins.
        if (importStateMutated) {
          await waitForNextPaint();
        }

        if (visibleImportedFiles.length > 0) {
          const preferredFile = pickPreparedPreferredFile(
            visibleImportedFiles,
            preferredFileName,
            preResolvedImports[0]?.fileName ?? null,
          );
          const fileForStandaloneImportWarnings = preferredFile;
          const fileForStandaloneImportOpen = preferredFile;
          const importedAssetPathsForWarning = collectStandaloneImportSupportAssetPaths(
            mergedAssets,
            mergedFiles,
          );

          const standaloneImportAssetWarning = buildStandaloneImportAssetWarning(
            fileForStandaloneImportWarnings,
            importedAssetPathsForWarning,
            {
              allFileContents: mergedAllFileContents,
              availableFiles: mergedFiles,
              sourcePath: fileForStandaloneImportWarnings?.name,
            },
          );
          const primitiveGeometryHint = buildStandalonePrimitiveGeometryHint(
            fileForStandaloneImportWarnings,
            importedAssetPathsForWarning,
            {
              allFileContents: mergedAllFileContents,
              sourcePath: fileForStandaloneImportWarnings?.name,
            },
          );

          if (fileForStandaloneImportOpen) {
            const canProceedDespiteStandaloneAssetWarning =
              canProceedWithStandaloneImportAssetWarning(fileForStandaloneImportOpen);

            if (standaloneImportAssetWarning) {
              const assetLabel =
                standaloneImportAssetWarning.missingAssetPaths.length > 3
                  ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, …`
                  : standaloneImportAssetWarning.missingAssetPaths.join(', ');
              const warningMessage = t.importPackageAssetBundleHint
                .replace('{packages}', assetLabel)
                .replace('{assets}', assetLabel);

              console.warn(`[urdf-studio] ${warningMessage}`);
            }

            if (!standaloneImportAssetWarning && primitiveGeometryHint) {
              const assetLabel =
                primitiveGeometryHint.siblingMeshAssetCount >
                primitiveGeometryHint.siblingMeshAssetPaths.length
                  ? `${primitiveGeometryHint.siblingMeshAssetPaths.join(', ')}, …`
                  : primitiveGeometryHint.siblingMeshAssetPaths.join(', ');
              const warningMessage = t.importPrimitiveGeometryHint.replace('{assets}', assetLabel);

              console.warn(`[urdf-studio] ${warningMessage}`);
            }

            if (!standaloneImportAssetWarning || canProceedDespiteStandaloneAssetWarning) {
              if (!hadExistingAvailableFiles) {
                clearImportPreparationOverlay();
                prewarmUsdSelectionInBackground(
                  fileForStandaloneImportOpen,
                  mergedFiles,
                  mergedAssets,
                );
                if (onLoadRobot) {
                  onLoadRobot(fileForStandaloneImportOpen);
                } else {
                  await loadRobot(
                    fileForStandaloneImportOpen,
                    mergedFiles,
                    mergedResolutionAssets,
                    mergedAllFileContents,
                  );
                }
              } else if (!hadSelectedFile) {
                clearImportPreparationOverlay();
                prewarmUsdSelectionInBackground(
                  fileForStandaloneImportOpen,
                  mergedFiles,
                  mergedAssets,
                );
                if (onLoadRobot) {
                  onLoadRobot(fileForStandaloneImportOpen);
                } else {
                  await loadRobot(
                    fileForStandaloneImportOpen,
                    mergedFiles,
                    mergedResolutionAssets,
                    mergedAllFileContents,
                  );
                }
              }
            }
          }
        } else if (renamedLibraryFiles.length === 0) {
          const infoMessage = t.noSupportedImportFilesFound;
          console.info('[useFileImport] Skipped import with no visible library files.', {
            importedFileNames: inputFiles.map((file) => file.name),
          });
          if (onShowToast) {
            onShowToast(infoMessage, 'info');
          }
        }

        if (shouldHydrateArchiveAssetsInBackground && inputFiles[0]) {
          hydrateDeferredArchiveAssetsInBackground(inputFiles[0], renamedDeferredAssetFiles, {
            onShowToast,
          });
        }

        return {
          status:
            visibleImportedFiles.length > 0 || renamedLibraryFiles.length > 0
              ? 'completed'
              : 'skipped',
        };
      } catch (error) {
        console.error('Import failed:', error);
        if (!importStateMutated) {
          revokeBlobUrls(createdBlobUrls);
        }
        const fallbackMessage = translations[useUIStore.getState().lang].importFailedCheckFiles;
        const errorMessage = error instanceof Error ? error.message.trim() : '';
        alert(errorMessage ? `${fallbackMessage}\n${errorMessage}` : fallbackMessage);
        return { status: 'failed' };
      } finally {
        clearImportPreparationOverlay();
      }
    },
    [
      loadRobot,
      onImportPreparationStateChange,
      onLoadRobot,
      onProjectImported,
      onShowToast,
      projectImporter,
    ],
  );

  return {
    handleImport,
    loadRobot,
    detectFormat: detectImportFormat,
  };
}

export default useFileImport;
