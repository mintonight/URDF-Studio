/**
 * File Import Hook
 * Handles importing URDF, MJCF, USD, Xacro files and supported archive packages
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
import {
  isAssetLibraryOnlyFormat,
  isLibraryPreviewableFile,
  isRobotDefinitionFormat,
  isVisibleLibraryEntry,
  isSupportedArchiveImportFile,
} from '@/shared/utils/robotFileSupport';
import { isStandaloneXacroEntry } from '@/core/parsers/importRobotFile';
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
import {
  buildStandaloneImportAssetWarning,
  buildStandalonePrimitiveGeometryHint,
  canProceedWithStandaloneImportAssetWarning,
  collectStandaloneImportSupportAssetPaths,
} from '@/app/utils/importPackageAssetReferences.ts';
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

export type ImportInputFiles = FileList | readonly File[] | null;
export type HandleImportResult = {
  status: 'completed' | 'skipped' | 'failed';
};

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

function normalizeImportSourcePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
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

function canAutoSeedImportedArchiveAssemblyFile(file: RobotFile): boolean {
  if (!isRobotDefinitionFormat(file.format) || file.format === 'usd') {
    return false;
  }

  if (file.format === 'xacro') {
    return isStandaloneXacroEntry(file);
  }

  return true;
}

function collectAutoSeedImportedArchiveAssemblyFiles(
  files: readonly RobotFile[],
  preferredFile: RobotFile | null,
): RobotFile[] {
  const eligibleFiles = files.filter(canAutoSeedImportedArchiveAssemblyFile);
  if (eligibleFiles.length <= 1) {
    return preferredFile && canAutoSeedImportedArchiveAssemblyFile(preferredFile)
      ? [preferredFile]
      : [];
  }

  if (!preferredFile || !canAutoSeedImportedArchiveAssemblyFile(preferredFile)) {
    return eligibleFiles;
  }

  return [preferredFile, ...eligibleFiles.filter((file) => file.name !== preferredFile.name)];
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

      useAssetsStore.getState().addAssets(createAssetUrls(hydratedAssetFiles));
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
      const robotState = useRobotStore.getState();
      const selectionState = useSelectionStore.getState();
      const assemblyStoreState = useAssemblyStore.getState();
      const t = translations[uiState.lang];
      const inputFiles = Array.from(files);
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
      const assetsSnapshot = {
        assets: assetsState.assets,
        availableFiles: assetsState.availableFiles,
        usdSceneSnapshots: assetsState.usdSceneSnapshots,
        usdPreparedExportCaches: assetsState.usdPreparedExportCaches,
        selectedFile: assetsState.selectedFile,
        documentLoadState: assetsState.documentLoadState,
        allFileContents: assetsState.allFileContents,
        motorLibrary: assetsState.motorLibrary,
        originalUrdfContent: assetsState.originalUrdfContent,
        originalFileFormat: assetsState.originalFileFormat,
      };
      const assemblySnapshot = {
        assemblyState: assemblyStoreState.assemblyState,
        _history: assemblyStoreState._history,
        _activity: assemblyStoreState._activity,
      };
      const robotSnapshot = structuredClone({
        name: robotState.name,
        links: robotState.links,
        joints: robotState.joints,
        rootLinkId: robotState.rootLinkId,
        materials: robotState.materials,
        closedLoopConstraints: robotState.closedLoopConstraints,
        inspectionContext: robotState.inspectionContext,
        _history: robotState._history,
        _activity: robotState._activity,
      });
      const selectionSnapshot = structuredClone({
        selection: selectionState.selection,
        interactionGuard: selectionState.interactionGuard,
        hoveredSelection: selectionState.hoveredSelection,
        deferredHoveredSelection: selectionState.deferredHoveredSelection,
        hoverFrozen: selectionState.hoverFrozen,
        attentionSelection: selectionState.attentionSelection,
        focusTarget: selectionState.focusTarget,
      });
      const uiSnapshot = {
        sidebarTab: uiState.sidebarTab,
      };
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

          useAssemblyStore.setState({
            assemblyState: result.assemblyState,
            _history: result.assemblyHistory,
            _activity: result.assemblyActivity,
          });

          uiState.setSidebarTab(result.assemblyState ? 'workspace' : 'structure');
          markUnsavedChangesBaselineSaved('all');

          return { status: 'completed' };
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

        const newAssets = createAssetUrls(renamedAssetFiles);
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
              ...createAssetUrls(hydratedAssetFiles),
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
          assetsState.addAssets(sourceAssets);
          assetsState.setAvailableFiles(mergedFiles);
          assetsState.setAllFileContents(mergedAllFileContents);
          importStateMutated = true;
        }

        if (renamedLibraryFiles.length > 0) {
          assetsState.setMotorLibrary(nextMotorLibrary);
          importStateMutated = true;
        }

        let shouldMarkAssemblyBaselineSaved = false;

        if (visibleImportedFiles.length > 0) {
          const preferredFile = pickPreparedPreferredFile(
            visibleImportedFiles,
            preferredFileName,
            preResolvedImports[0]?.fileName ?? null,
          );
          const visibleRobotDefinitionCount = visibleImportedFiles.filter((file) =>
            isRobotDefinitionFormat(file.format),
          ).length;
          const autoSeedAssemblyFiles =
            isArchiveImport && !hadExistingAvailableFiles
              ? collectAutoSeedImportedArchiveAssemblyFiles(
                  renamedRobotFilesWithSources,
                  preferredFile,
                )
              : [];
          const shouldAutoSeedArchiveAssembly = autoSeedAssemblyFiles.length > 1;
          const shouldSeedSingleImportedAssembly =
            !shouldAutoSeedArchiveAssembly && visibleRobotDefinitionCount === 1;
          const activatedImportedFile = shouldAutoSeedArchiveAssembly
            ? (autoSeedAssemblyFiles[0] ?? preferredFile)
            : preferredFile;
          const importedAssetPathsForWarning = collectStandaloneImportSupportAssetPaths(
            mergedAssets,
            mergedFiles,
          );

          const standaloneImportAssetWarning = buildStandaloneImportAssetWarning(
            preferredFile,
            importedAssetPathsForWarning,
            {
              allFileContents: mergedAllFileContents,
              sourcePath: preferredFile?.name,
            },
          );
          const primitiveGeometryHint = buildStandalonePrimitiveGeometryHint(
            preferredFile,
            importedAssetPathsForWarning,
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
            const canProceedDespiteStandaloneAssetWarning =
              canProceedWithStandaloneImportAssetWarning(preferredFile);

            if (standaloneImportAssetWarning) {
              const assetLabel =
                standaloneImportAssetWarning.missingAssetPaths.length > 3
                  ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, …`
                  : standaloneImportAssetWarning.missingAssetPaths.join(', ');
              const warningMessage = t.importPackageAssetBundleHint
                .replace('{packages}', assetLabel)
                .replace('{assets}', assetLabel);

              if (onShowToast) {
                onShowToast(warningMessage, 'info');
              } else {
                alert(warningMessage);
              }
            }

            if (!standaloneImportAssetWarning && primitiveGeometryHint) {
              const assetLabel =
                primitiveGeometryHint.siblingMeshAssetCount >
                primitiveGeometryHint.siblingMeshAssetPaths.length
                  ? `${primitiveGeometryHint.siblingMeshAssetPaths.join(', ')}, …`
                  : primitiveGeometryHint.siblingMeshAssetPaths.join(', ');
              const warningMessage = t.importPrimitiveGeometryHint.replace('{assets}', assetLabel);

              if (onShowToast) {
                onShowToast(warningMessage, 'info');
              } else {
                alert(warningMessage);
              }
            }

            if (!standaloneImportAssetWarning || canProceedDespiteStandaloneAssetWarning) {
              if (!hadExistingAvailableFiles) {
                const preResolvedRobotData: RobotData | null =
                  preferredFile.format === 'usd'
                    ? preferredPreResolvedImportResult?.status === 'ready'
                      ? preferredPreResolvedImportResult.robotData
                      : (assetsState.getUsdPreparedExportCache(preferredFile.name)?.robotData ??
                        null)
                    : null;
                const canSeedAssembly =
                  !isAssetLibraryOnlyFormat(preferredFile.format) &&
                  (preferredFile.format !== 'usd' || Boolean(preResolvedRobotData));

                if (shouldAutoSeedArchiveAssembly) {
                  assemblyStoreState.initAssembly(robotState.name || 'my_project');
                  autoSeedAssemblyFiles.forEach((seedFile) => {
                    const seedPreResolvedImportResult =
                      seedFile.name === preferredFile.name
                        ? preferredPreResolvedImportResult
                        : null;
                    const seedPreResolvedRobotData =
                      seedFile.name === preferredFile.name && seedFile.format === 'usd'
                        ? preResolvedRobotData
                        : null;
                    const component = assemblyStoreState.addComponent(seedFile, {
                      availableFiles: mergedFiles,
                      assets: mergedAssets,
                      allFileContents: mergedAllFileContents,
                      preResolvedImportResult: seedPreResolvedImportResult,
                      preResolvedRobotData: seedPreResolvedRobotData,
                      queueAutoGround: false,
                    });
                    if (!component) {
                      throw new Error(
                        `Failed to add imported assembly component: ${seedFile.name}`,
                      );
                    }
                  });
                  shouldMarkAssemblyBaselineSaved = true;
                } else if (shouldSeedSingleImportedAssembly && canSeedAssembly) {
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
                  shouldMarkAssemblyBaselineSaved = true;
                }

                uiState.setSidebarTab(shouldAutoSeedArchiveAssembly ? 'workspace' : 'structure');
                clearImportPreparationOverlay();
                prewarmUsdSelectionInBackground(activatedImportedFile, mergedFiles, mergedAssets);
                if (onLoadRobot) {
                  onLoadRobot(activatedImportedFile);
                } else {
                  await loadRobot(
                    activatedImportedFile,
                    mergedFiles,
                    mergedAssets,
                    mergedAllFileContents,
                  );
                }
                if (shouldMarkAssemblyBaselineSaved) {
                  markUnsavedChangesBaselineSaved('assembly');
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
        } else {
          useAssetsStore.setState(assetsSnapshot);
          useAssemblyStore.setState(assemblySnapshot);
          useRobotStore.setState(robotSnapshot);
          useSelectionStore.setState(selectionSnapshot);
          useUIStore.setState(uiSnapshot);
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
    [loadRobot, onImportPreparationStateChange, onLoadRobot, onProjectImported, onShowToast],
  );

  return {
    handleImport,
    loadRobot,
    detectFormat: detectImportFormat,
  };
}

export default useFileImport;
