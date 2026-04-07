import { exportProjectWithWorker } from '@/features/file-io';
import type { ExportProjectParams } from '@/features/file-io';
import { translations } from '@/shared/i18n';
import type { RobotMaterialState, UrdfJoint, UrdfLink } from '@/types';
import {
  buildCurrentRobotExportData,
  type RobotActivityEntryLike,
  type RobotHistoryLike,
} from '../projectRobotStateUtils';
import { materializeAssemblyHistorySnapshots } from './assemblyHistory';
import type {
  AssemblyHistoryState,
  HandleProjectExportOptions,
  ProjectExportExecutionResult,
} from './types';
import type { ExportProgressReporter } from './progress';

type ExportTranslations = typeof translations.en;

interface ExecuteProjectExportParams {
  options?: HandleProjectExportOptions;
  robotName: string;
  robotLinks: Record<string, UrdfLink>;
  robotJoints: Record<string, UrdfJoint>;
  rootLinkId: string;
  robotMaterials?: Record<string, RobotMaterialState>;
  closedLoopConstraints?: import('@/types').RobotClosedLoopConstraint[];
  robotHistory: RobotHistoryLike;
  robotActivity: RobotActivityEntryLike[];
  assemblyState: import('@/types').AssemblyState | null;
  assemblyHistory: AssemblyHistoryState;
  assemblyActivity: ExportProjectParams['assemblyState']['activity'];
  mergedAppMode: ExportProjectParams['uiState']['appMode'];
  lang: ExportProjectParams['uiState']['lang'];
  availableFiles: ExportProjectParams['assetsState']['availableFiles'];
  assets: ExportProjectParams['assetsState']['assets'];
  allFileContents: ExportProjectParams['assetsState']['allFileContents'];
  motorLibrary: ExportProjectParams['assetsState']['motorLibrary'];
  selectedFileName: ExportProjectParams['assetsState']['selectedFileName'];
  originalUrdfContent: ExportProjectParams['assetsState']['originalUrdfContent'];
  originalFileFormat: ExportProjectParams['assetsState']['originalFileFormat'];
  usdPreparedExportCaches: ExportProjectParams['assetsState']['usdPreparedExportCaches'];
  getMergedRobotData: () => import('@/types').RobotData | null;
  createProgressReporter: (
    onProgress: HandleProjectExportOptions['onProgress'],
    totalSteps: number,
  ) => ExportProgressReporter;
  downloadBlob: (blob: Blob, fileName: string) => void;
  replaceTemplate: (template: string, replacements: Record<string, string | number>) => string;
  t: ExportTranslations;
  markAllSaved: () => void;
}

export async function executeProjectExport({
  options = {},
  robotName,
  robotLinks,
  robotJoints,
  rootLinkId,
  robotMaterials,
  closedLoopConstraints,
  robotHistory,
  robotActivity,
  assemblyState,
  assemblyHistory,
  assemblyActivity,
  mergedAppMode,
  lang,
  availableFiles,
  assets,
  allFileContents,
  motorLibrary,
  selectedFileName,
  originalUrdfContent,
  originalFileFormat,
  usdPreparedExportCaches,
  getMergedRobotData,
  createProgressReporter,
  downloadBlob,
  replaceTemplate,
  t,
  markAllSaved,
}: ExecuteProjectExportParams): Promise<ProjectExportExecutionResult> {
  const reportProgress = createProgressReporter(options.onProgress, 6);
  reportProgress(1, t.exportProgressPreparing, t.exportProgressPreparingDetail, {
    stageProgress: 0.18,
    indeterminate: true,
  });
  reportProgress(
    2,
    t.exportProgressPackingProjectAssets,
    t.exportProgressPackingProjectAssetsPreparingDetail,
    {
      stageProgress: 0.04,
      indeterminate: true,
    },
  );

  const exportableAssemblyHistory = materializeAssemblyHistorySnapshots(
    assemblyHistory,
    assemblyState,
  );

  const result = await exportProjectWithWorker({
    name: robotName || assemblyState?.name || 'my_project',
    uiState: {
      appMode: mergedAppMode,
      lang,
    },
    assetsState: {
      availableFiles,
      assets,
      allFileContents,
      motorLibrary,
      selectedFileName,
      originalUrdfContent,
      originalFileFormat,
      usdPreparedExportCaches,
    },
    robotState: {
      present: buildCurrentRobotExportData({
        robotName,
        robotLinks,
        robotJoints,
        rootLinkId,
        robotMaterials,
        closedLoopConstraints,
      }),
      history: robotHistory,
      activity: robotActivity,
    },
    assemblyState: {
      present: assemblyState,
      history: exportableAssemblyHistory,
      activity: assemblyActivity,
    },
    getMergedRobotData,
    onProgress: (progress) => {
      switch (progress.phase) {
        case 'assets':
          reportProgress(
            2,
            t.exportProgressPackingProjectAssets,
            replaceTemplate(t.exportProgressPackingProjectAssetsDetail, {
              current: progress.completed,
              total: progress.total,
              file: progress.label || t.exportProgressArchiveFallbackFile,
            }),
            {
              stageProgress: progress.total > 0 ? progress.completed / progress.total : 1,
              indeterminate: false,
            },
          );
          break;
        case 'metadata':
          reportProgress(
            3,
            t.exportProgressWritingProjectData,
            replaceTemplate(t.exportProgressWritingProjectDataDetail, {
              current: progress.completed,
              total: progress.total,
              item: progress.label || 'project.json',
            }),
            {
              stageProgress: progress.total > 0 ? progress.completed / progress.total : 1,
              indeterminate: false,
            },
          );
          break;
        case 'components':
          reportProgress(
            4,
            t.exportProgressBundlingProjectComponents,
            replaceTemplate(t.exportProgressBundlingProjectComponentsDetail, {
              current: progress.completed,
              total: progress.total,
              item: progress.label || t.exportProgressArchiveFallbackFile,
            }),
            {
              stageProgress: progress.total > 0 ? progress.completed / progress.total : 1,
              indeterminate: false,
            },
          );
          break;
        case 'output':
          reportProgress(
            5,
            t.exportProgressGeneratingProjectOutputs,
            replaceTemplate(t.exportProgressGeneratingProjectOutputsDetail, {
              current: progress.completed,
              total: progress.total,
              item: progress.label || t.exportProgressArchiveFallbackFile,
            }),
            {
              stageProgress: progress.total > 0 ? progress.completed / progress.total : 1,
              indeterminate: false,
            },
          );
          break;
        case 'archive':
          reportProgress(
            6,
            t.exportProgressPackaging,
            progress.label
              ? replaceTemplate(t.exportProgressPackagingDetailFile, { file: progress.label })
              : t.exportProgressPackagingDetail,
            {
              stageProgress: progress.total > 0 ? progress.completed / progress.total : 1,
              indeterminate: false,
            },
          );
          break;
        default:
          break;
      }
    },
  });

  if (!options.skipDownload) {
    downloadBlob(result.blob, `${robotName || assemblyState?.name || 'my_project'}.usp`);
  }
  markAllSaved();

  return {
    partial: result.partial,
    blob: result.blob,
    warnings: result.warnings.map((warning) => warning.message),
    issues: result.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      context: warning.context,
    })),
  };
}
