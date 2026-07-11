/**
 * STEP export orchestration.
 *
 * STEP exports the robot's visual geometry as a single `.step` file (ISO 10303-21)
 * for CAD design reference. Unlike the zip-based formats, it produces one text file
 * downloaded directly via `downloadBlob`. Meshes are tessellated; primitives become
 * analytic B-rep solids.
 */

import { generateSTEP, type StepGeometryProvider } from '@/core/parsers';
import { translations } from '@/shared/i18n';
import type { RobotFile } from '@/types';

import type { ExportProgressReporter } from './progress';
import type {
  ExportContext,
  ExportExecutionResult,
  ExportTarget,
  HandleExportWithConfigOptions,
} from './types';
import type { ExportDialogConfig } from '@/features/file-io';

type ExportTranslations = typeof translations.en;

interface ExecuteStepExportParams {
  config: ExportDialogConfig;
  target: ExportTarget;
  options: HandleExportWithConfigOptions;
  resolveLibraryExportContext: (file: RobotFile) => Promise<ExportContext>;
  resolveExportContext: (target?: ExportTarget) => Promise<ExportContext | null>;
  createProgressReporter: (
    onProgress: HandleExportWithConfigOptions['onProgress'],
    totalSteps: number,
  ) => ExportProgressReporter;
  t: ExportTranslations;
  downloadBlob: (blob: Blob, fileName: string) => void;
  markCurrentTargetSaved: () => void;
  /** Optional mesh geometry provider. When omitted, mesh visuals are skipped. */
  geometryProvider?: StepGeometryProvider;
}

const STEP_TOTAL_STEPS = 2;

export async function executeStepExport({
  config,
  target,
  options,
  resolveLibraryExportContext,
  resolveExportContext,
  createProgressReporter,
  t,
  downloadBlob,
  markCurrentTargetSaved,
  geometryProvider,
}: ExecuteStepExportParams): Promise<ExportExecutionResult> {
  const reportProgress = createProgressReporter(options.onProgress, STEP_TOTAL_STEPS);
  reportProgress(1, t.exportProgressPreparing, t.exportProgressPreparingDetail, {
    stageProgress: 0.3,
    indeterminate: true,
  });

  const exportContext =
    target.type === 'library-file'
      ? await resolveLibraryExportContext(target.file)
      : await resolveExportContext(target);

  if (!exportContext) {
    throw new Error(t.exportFailedParse);
  }

  reportProgress(
    2,
    t.exportProgressGeneratingStep,
    t.exportProgressGeneratingStepDetail,
    { stageProgress: 0.5, indeterminate: true },
  );

  const { robot, exportName } = exportContext;
  const result = await generateSTEP(robot, {
    provider: geometryProvider,
    includeMeshes: config.step.includeMeshes,
  });

  const blob = new Blob([result.content], { type: 'application/step' });
  downloadBlob(blob, `${exportName}.step`);
  markCurrentTargetSaved();

  return {
    partial: false,
    warnings: [],
    issues: [],
  };
}
