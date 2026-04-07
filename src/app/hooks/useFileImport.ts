/**
 * File Import Hook
 * Handles importing URDF, MJCF, USD, Xacro files and ZIP packages
 */
import { useCallback } from 'react';
import type { RobotData, RobotFile } from '@/types';
import { DEFAULT_MOTOR_LIBRARY } from '@/shared/data/motorLibrary';
import { mergeMotorLibraryEntries } from '@/shared/data/motorLibraryMerge';
import {
  useAssemblyStore,
  useAssetsStore,
  useRobotStore,
  useSelectionStore,
  useUIStore,
} from '@/store';
import {
  createAssetUrls,
  importProjectWithWorker,
  isRobotDefinitionFile,
  type ProjectImportResult,
} from '@/features/file-io';
import { translations } from '@/shared/i18n';
import { buildImportedRobotStoreState } from './projectRobotStateUtils';
import {
  prepareImportPayloadWithWorker,
  hydrateDeferredImportAssetsWithWorker,
} from './importPreparationWorkerBridge';
import { resolveRobotFileDataWithWorker } from './robotImportWorkerBridge';
import { detectImportFormat, type PrepareImportProgress } from '@/app/utils/importPreparation';
import {
  buildContextualPreResolvedImports,
  shouldBuildContextualPreResolvedImports,
} from '@/app/utils/contextualPreResolvedImports';
import { buildStandaloneImportAssetWarning } from '@/app/utils/importPackageAssetReferences.ts';
import { primePreResolvedRobotImports } from '@/app/utils/preResolvedRobotImportCache';
import { prewarmUsdSelectionInBackground } from '@/app/utils/usdSelectionPrewarm';
import { markUnsavedChangesBaselineSaved } from '@/app/utils/unsavedChangesBaseline';

export interface ImportPreparationOverlayState {
  label: string;
  detail?: string;
  progress?: number | null;
  statusLabel?: string | null;
  stageLabel?: string | null;
}

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

function pickPreparedPreferredFile(
  files: readonly RobotFile[],
  preferredFileName: string | null,
  preResolvedFileName: string | null,
): RobotFile | null {
  if (preferredFileName) {
    return files.find((file) => file.name === preferredFileName) ?? null;
  }

  if (preResolvedFileName) {
    return files.find((file) => file.name === preResolvedFileName) ?? null;
  }

  return files.find((file) => file.format !== 'mesh') ?? files[0] ?? null;
}

function waitForNextPaint(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
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
    projectImporter = importProjectWithWorker,
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
        usdRobotData: assetsState.getUsdPreparedExportCache(file.name)?.robotData ?? null,
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
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }

      const uiState = useUIStore.getState();
      const assetsState = useAssetsStore.getState();
      const robotState = useRobotStore.getState();
      const selectionState = useSelectionStore.getState();
      const assemblyStoreState = useAssemblyStore.getState();
      const t = translations[uiState.lang];
      const inputFiles = Array.from(files);
      const importsRobotDefinition = inputFiles.some((file) => isRobotDefinitionFile(file.name));
      const shouldShowPreparationOverlay =
        inputFiles.length > 1 ||
        inputFiles.some((file) => Boolean(file.webkitRelativePath)) ||
        (inputFiles.length === 1 && inputFiles[0].name.toLowerCase().endsWith('.zip')) ||
        importsRobotDefinition;

      if (onShowToast && uiState.showImportWarning) {
        onShowToast(t.privacyNoticeLocalProcessing, 'success');
      }

      const createdBlobUrls: string[] = [];
      let importedAssetsCommitted = false;
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
          const result = await projectImporter(files[0], uiState.lang);
          const { manifest, assets: newAssetUrls, availableFiles: newFiles } = result;

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

          useAssemblyStore.setState({
            assemblyState: result.assemblyState,
            _history: result.assemblyHistory,
            _activity: result.assemblyActivity,
          });

          uiState.setSidebarTab(result.assemblyState ? 'workspace' : 'structure');
          markUnsavedChangesBaselineSaved('all');

          if (onShowToast) {
            onShowToast(t.importUspSuccess, 'success');
          }
          return;
        }

        const hadExistingAvailableFiles = assetsState.availableFiles.length > 0;
        const hadSelectedFile = Boolean(assetsState.selectedFile);

        if (shouldShowPreparationOverlay) {
          setImportPreparationOverlay(createInitialImportPreparationOverlayState(t));
          await waitForNextPaint();
        }

        const preparedImportPayload = await prepareImportPayloadWithWorker({
          files: inputFiles,
          existingPaths: [
            ...assetsState.availableFiles.map((file) => file.name),
            ...Object.keys(assetsState.assets),
            ...Object.keys(assetsState.allFileContents),
          ],
          preResolvePreferredImport: false,
          onProgress: shouldShowPreparationOverlay
            ? (progress) => {
                setImportPreparationOverlay(
                  createImportPreparationOverlayStateFromProgress(t, progress),
                );
              }
            : undefined,
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

        const motorSpecParseFailures: string[] = [];
        let motorSpecWarningShown = false;
        const usdSourceBlobUrls = Object.fromEntries(
          renamedUsdSourceFiles.map((file) => [file.name, URL.createObjectURL(file.blob)]),
        );
        createdBlobUrls.push(...Object.values(usdSourceBlobUrls));

        const renamedRobotFilesWithSources = renamedRobotFiles.map((file) =>
          file.format === 'usd' && usdSourceBlobUrls[file.name]
            ? { ...file, blobUrl: usdSourceBlobUrls[file.name] }
            : file,
        );

        if (renamedLibraryFiles.length > 0) {
          const mergeResult = mergeMotorLibraryEntries(renamedLibraryFiles, DEFAULT_MOTOR_LIBRARY);
          motorSpecParseFailures.push(...mergeResult.parseFailures);
          mergeResult.parseFailures.forEach((path) => {
            console.error('Failed to parse motor spec', path);
          });
          assetsState.setMotorLibrary(mergeResult.library);
        }

        const newAssets = createAssetUrls(renamedAssetFiles);
        createdBlobUrls.push(...Object.values(newAssets));

        const sourceAssets = {
          ...newAssets,
          ...usdSourceBlobUrls,
        };
        const mergedAssets = {
          ...assetsState.assets,
          ...sourceAssets,
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
              assets: mergedAssets,
              allFileContents: mergedAllFileContents,
            })
          : [];

        primePreResolvedRobotImports([...preResolvedImports, ...contextualPreResolvedImports]);

        if (
          uniqueNewFiles.length > 0 ||
          Object.keys(sourceAssets).length > 0 ||
          renamedTextFiles.length > 0
        ) {
          importedAssetsCommitted = true;
          assetsState.addAssets(sourceAssets);
          assetsState.setAvailableFiles(mergedFiles);
          assetsState.setAllFileContents(mergedAllFileContents);
        }

        if (
          renamedDeferredAssetFiles.length > 0 &&
          inputFiles.length === 1 &&
          inputFiles[0]?.name.toLowerCase().endsWith('.zip')
        ) {
          const sourceZipFile = inputFiles[0];
          void hydrateDeferredImportAssetsWithWorker({
            zipFile: sourceZipFile,
            assetFiles: renamedDeferredAssetFiles,
          })
            .then((hydratedAssetFiles) => {
              if (hydratedAssetFiles.length === 0) {
                return;
              }

              assetsState.addAssets(createAssetUrls(hydratedAssetFiles));
            })
            .catch((error) => {
              console.error('Deferred asset hydration failed for imported ZIP bundle:', error);
            });
        }

        if (renamedRobotFilesWithSources.length > 0) {
          const preferredFile = pickPreparedPreferredFile(
            renamedRobotFilesWithSources,
            preferredFileName,
            preResolvedImports[0]?.fileName ?? null,
          );

          const standaloneImportAssetWarning = buildStandaloneImportAssetWarning(
            preferredFile,
            Object.keys(mergedAssets),
            {
              allFileContents: mergedAllFileContents,
              sourcePath: preferredFile?.name,
            },
          );

          const preferredPreResolvedImportResult = preferredFile
            ? (preResolvedImports.find(
                (entry) =>
                  entry.fileName === preferredFile.name && entry.format === preferredFile.format,
              )?.result ?? null)
            : null;

          if (preferredFile) {
            if (standaloneImportAssetWarning) {
              const assetLabel =
                standaloneImportAssetWarning.missingAssetPaths.length > 3
                  ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, …`
                  : standaloneImportAssetWarning.missingAssetPaths.join(', ');
              const warningMessage = t.importPackageAssetBundleHint.replace('{assets}', assetLabel);

              if (onShowToast) {
                onShowToast(warningMessage, 'info');
              } else {
                alert(warningMessage);
              }
            } else if (!hadExistingAvailableFiles) {
              const preResolvedRobotData: RobotData | null =
                preferredFile.format === 'usd'
                  ? preferredPreResolvedImportResult?.status === 'ready'
                    ? preferredPreResolvedImportResult.robotData
                    : (assetsState.getUsdPreparedExportCache(preferredFile.name)?.robotData ?? null)
                  : null;
              const canSeedAssembly =
                preferredFile.format !== 'mesh' &&
                (preferredFile.format !== 'usd' || Boolean(preResolvedRobotData));

              if (canSeedAssembly) {
                assemblyStoreState.initAssembly(robotState.name || 'my_project');
                const component = assemblyStoreState.addComponent(preferredFile, {
                  availableFiles: mergedFiles,
                  assets: mergedAssets,
                  allFileContents: mergedAllFileContents,
                  preResolvedImportResult: preferredPreResolvedImportResult,
                  preResolvedRobotData,
                  queueAutoGround: false,
                });
                if (!component) {
                  throw new Error(
                    `Failed to add imported assembly component: ${preferredFile.name}`,
                  );
                }
                markUnsavedChangesBaselineSaved('assembly');
              }

              uiState.setSidebarTab('structure');
              clearImportPreparationOverlay();
              prewarmUsdSelectionInBackground(preferredFile, mergedFiles, mergedAssets);
              if (onLoadRobot) {
                onLoadRobot(preferredFile);
              } else {
                await loadRobot(preferredFile, mergedFiles, mergedAssets, mergedAllFileContents);
              }
            } else if (!hadSelectedFile) {
              uiState.setSidebarTab('structure');
              clearImportPreparationOverlay();
              prewarmUsdSelectionInBackground(preferredFile, mergedFiles, mergedAssets);
              if (onLoadRobot) {
                onLoadRobot(preferredFile);
              } else {
                await loadRobot(preferredFile, mergedFiles, mergedAssets, mergedAllFileContents);
              }
              if (onShowToast) {
                onShowToast(
                  t.addedFilesToAssetLibrary.replace(
                    '{count}',
                    String(renamedRobotFilesWithSources.length),
                  ),
                  'success',
                );
              }
            } else if (onShowToast) {
              onShowToast(
                t.addedFilesToAssetLibrary.replace(
                  '{count}',
                  String(renamedRobotFilesWithSources.length),
                ),
                'success',
              );
            }
          }
        } else if (renamedLibraryFiles.length > 0) {
          if (motorSpecParseFailures.length > 0) {
            const partialMessage = t.libraryImportPartialWithErrors
              .replace('{failed}', String(motorSpecParseFailures.length))
              .replace('{total}', String(renamedLibraryFiles.length));
            motorSpecWarningShown = true;
            if (onShowToast) {
              onShowToast(partialMessage, 'info');
            } else {
              alert(partialMessage);
            }
          } else {
            alert(t.libraryImportSuccessful);
          }
        } else if (
          renamedAssetFiles.length === 0 &&
          renamedRobotFiles.length === 0 &&
          renamedTextFiles.length === 0
        ) {
          alert(t.noDefinitionFilesFound);
        }

        if (
          renamedLibraryFiles.length > 0 &&
          motorSpecParseFailures.length > 0 &&
          !motorSpecWarningShown
        ) {
          const partialMessage = t.libraryImportPartialWithErrors
            .replace('{failed}', String(motorSpecParseFailures.length))
            .replace('{total}', String(renamedLibraryFiles.length));
          if (onShowToast) {
            onShowToast(partialMessage, 'info');
          } else {
            alert(partialMessage);
          }
        }
      } catch (error) {
        console.error('Import failed:', error);
        if (!importedAssetsCommitted) {
          revokeBlobUrls(createdBlobUrls);
        }
        const fallbackMessage = translations[useUIStore.getState().lang].importFailedCheckFiles;
        const errorMessage = error instanceof Error ? error.message.trim() : '';
        alert(errorMessage ? `${fallbackMessage}\n${errorMessage}` : fallbackMessage);
      } finally {
        clearImportPreparationOverlay();
      }
    },
    [loadRobot, onImportPreparationStateChange, onLoadRobot, onProjectImported, onShowToast],
  );

  return {
    handleImport,
    loadRobot,
    detectFormat: detectImportFormat,
  };
}

export default useFileImport;
