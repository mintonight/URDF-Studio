import JSZip from 'jszip';

import {
  exportRobotToUsdWithWorker,
  getUsdExportWorkerUnsupportedMeshPaths,
  type ExportDialogConfig,
} from '@/features/file-io';
import { convertUsdArchiveFilesToBinaryWithWorker } from '@/app/utils/usdBinaryArchiveWorkerBridge';
import { buildLiveUsdRoundtripArchive } from '@/app/utils/liveUsdRoundtripExport';
import { translations } from '@/shared/i18n';
import type { RobotFile, RobotState } from '@/types';

import type { ExportProgressReporter } from './progress';
import type {
  ExportContext,
  ExportExecutionResult,
  ExportTarget,
  HandleExportWithConfigOptions,
} from './types';

type ExportTranslations = typeof translations.en;

const USD_EXPORT_STAGE_PROGRESS_RANGES = {
  links: { start: 0.08, end: 0.34 },
  geometry: { start: 0.34, end: 0.62 },
  scene: { start: 0.62, end: 0.92 },
  assets: { start: 0.92, end: 0.99 },
} as const;

interface ExecuteUsdExportParams {
  config: ExportDialogConfig;
  target: ExportTarget;
  options: HandleExportWithConfigOptions;
  selectedFile: RobotFile | null;
  sidebarTab: string;
  currentUsdExportMode: string;
  availableFiles: RobotFile[];
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
  requiresResolvedUsdContext: boolean;
  t: ExportTranslations;
  resolveLibraryRobotForExport: (file: RobotFile) => Promise<RobotState>;
  getFileBaseName: (path: string) => string;
  resolveExportContext: (target?: ExportTarget) => ExportContext | null;
  createProgressReporter: (
    onProgress: HandleExportWithConfigOptions['onProgress'],
    totalSteps: number,
  ) => ExportProgressReporter;
  replaceTemplate: (template: string, replacements: Record<string, string | number>) => string;
  trimProgressFileLabel: (filePath: string | null | undefined) => string;
  generateZipBlobWithProgress: (
    zip: JSZip,
    reportProgress: ExportProgressReporter,
    currentStep: number,
  ) => Promise<Blob>;
  downloadBlob: (blob: Blob, fileName: string) => void;
  markCurrentTargetSaved: () => void;
}

export async function executeUsdExport({
  config,
  target,
  options,
  selectedFile,
  sidebarTab,
  currentUsdExportMode,
  availableFiles,
  assets,
  allFileContents,
  requiresResolvedUsdContext,
  t,
  resolveLibraryRobotForExport,
  getFileBaseName,
  resolveExportContext,
  createProgressReporter,
  replaceTemplate,
  trimProgressFileLabel,
  generateZipBlobWithProgress,
  downloadBlob,
  markCurrentTargetSaved,
}: ExecuteUsdExportParams): Promise<ExportExecutionResult> {
  const shouldConvertUsdLayers = config.usd.fileFormat !== 'usda';
  const reportProgress = createProgressReporter(options.onProgress, shouldConvertUsdLayers ? 4 : 3);
  reportProgress(1, t.exportProgressPreparing, t.exportProgressPreparingDetail, {
    stageProgress: 0.2,
    indeterminate: true,
  });

  const exportContext =
    target.type === 'library-file'
      ? {
          robot: await resolveLibraryRobotForExport(target.file),
          exportName: getFileBaseName(target.file.name),
        }
      : resolveExportContext(target);

  const shouldFallbackToLiveUsdStage =
    target.type === 'current' &&
    selectedFile?.format === 'usd' &&
    sidebarTab !== 'workspace' &&
    currentUsdExportMode === 'live-stage' &&
    config.usd.fileFormat === 'usd' &&
    selectedFile.name.toLowerCase().endsWith('.usd');

  if (!exportContext) {
    if (shouldFallbackToLiveUsdStage && selectedFile) {
      reportProgress(2, t.exportProgressBuildingUsdScene, t.exportProgressUsdScenePreparingDetail, {
        stageProgress: 0.16,
        indeterminate: true,
      });

      const roundtripArchive = await buildLiveUsdRoundtripArchive({
        sourceFile: selectedFile,
        availableFiles,
        assets,
        allFileContents,
      });

      reportProgress(3, t.exportProgressPreparing, t.exportProgressPreparingDetail, {
        stageProgress: 0.64,
        indeterminate: true,
      });

      const zip = new JSZip();
      roundtripArchive.archiveFiles.forEach((blob, filePath) => {
        zip.file(filePath, blob);
      });

      const content = await generateZipBlobWithProgress(
        zip,
        reportProgress,
        shouldConvertUsdLayers ? 4 : 3,
      );
      downloadBlob(content, roundtripArchive.archiveFileName);
      markCurrentTargetSaved();

      return {
        partial: false,
        warnings: [],
        issues: [],
      };
    }

    if (requiresResolvedUsdContext) {
      throw new Error(t.usdExportUnavailable);
    }
    throw new Error(t.exportFailedParse);
  }

  const unsupportedWorkerMeshPaths = getUsdExportWorkerUnsupportedMeshPaths(exportContext.robot);
  if (unsupportedWorkerMeshPaths.length > 0) {
    throw new Error(
      replaceTemplate(t.usdExportWorkerUnsupportedMeshes, {
        count: unsupportedWorkerMeshPaths.length,
        meshPath: unsupportedWorkerMeshPaths[0],
      }),
    );
  }

  reportProgress(2, t.exportProgressBuildingUsdScene, t.exportProgressUsdScenePreparingDetail, {
    stageProgress: 0.04,
    indeterminate: true,
  });

  const usdExport = await exportRobotToUsdWithWorker({
    robot: exportContext.robot,
    exportName: exportContext.exportName,
    assets,
    extraMeshFiles: exportContext.extraMeshFiles,
    fileFormat: config.usd.fileFormat,
    layoutProfile: 'isaacsim',
    meshCompression: {
      enabled: config.usd.compressMeshes,
      quality: config.usd.meshQuality,
    },
    onProgress: (progress) => {
      const range = USD_EXPORT_STAGE_PROGRESS_RANGES[progress.phase];
      const normalizedPhaseProgress = progress.total > 0 ? progress.completed / progress.total : 1;
      const stageProgress = range.start + (range.end - range.start) * normalizedPhaseProgress;

      let detail = t.exportProgressUsdScenePreparingDetail;
      switch (progress.phase) {
        case 'links':
          detail = replaceTemplate(t.exportProgressUsdSceneDetail, {
            current: progress.completed,
            total: progress.total,
            name: progress.label || t.exportProgressArchiveFallbackFile,
          });
          break;
        case 'geometry':
          detail = replaceTemplate(t.exportProgressUsdSceneGeometryDetail, {
            current: progress.completed,
            total: progress.total,
          });
          break;
        case 'scene':
          detail = replaceTemplate(t.exportProgressUsdSceneSerializingDetail, {
            current: progress.completed,
            total: progress.total,
          });
          break;
        case 'assets':
          detail = replaceTemplate(t.exportProgressUsdSceneAssetsDetail, {
            current: progress.completed,
            total: progress.total,
          });
          break;
        default:
          break;
      }

      reportProgress(2, t.exportProgressBuildingUsdScene, detail, {
        stageProgress,
        indeterminate: false,
      });
    },
  });

  const zip = new JSZip();
  if (shouldConvertUsdLayers) {
    reportProgress(
      3,
      t.exportProgressConvertingUsdLayers,
      t.exportProgressConvertingUsdLayersPreparingDetail,
      {
        stageProgress: 0.04,
        indeterminate: true,
      },
    );

    const binaryArchiveFiles = await convertUsdArchiveFilesToBinaryWithWorker(
      usdExport.archiveFiles,
      {
        onProgress: ({ current, total, filePath }) => {
          reportProgress(
            3,
            t.exportProgressConvertingUsdLayers,
            replaceTemplate(t.exportProgressConvertingUsdLayersDetail, {
              current,
              total,
              file: trimProgressFileLabel(filePath) || t.exportProgressArchiveFallbackFile,
            }),
            {
              stageProgress: total > 0 ? current / total : 1,
              indeterminate: false,
            },
          );
        },
      },
    );

    binaryArchiveFiles.forEach((blob, filePath) => {
      zip.file(filePath, blob);
    });
  } else {
    usdExport.archiveFiles.forEach((blob, filePath) => {
      zip.file(filePath, blob);
    });
  }

  const content = await generateZipBlobWithProgress(
    zip,
    reportProgress,
    shouldConvertUsdLayers ? 4 : 3,
  );
  downloadBlob(content, usdExport.archiveFileName);
  markCurrentTargetSaved();

  return {
    partial: false,
    warnings: [],
    issues: [],
  };
}
