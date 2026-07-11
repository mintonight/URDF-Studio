/**
 * STEP export orchestration.
 *
 * STEP exports the robot's visual geometry as a single `.step` file (ISO 10303-21)
 * for CAD design reference. Unlike the zip-based formats, it produces one file
 * downloaded directly via `downloadBlob`. The OCCT WASM kernel builds analytic
 * solids from primitives and tessellated shapes from meshes.
 */

import { generateSTEP, type StepGeometryProvider } from '@/core/parsers';
import { translations } from '@/shared/i18n';
import type { RobotFile } from '@/types';

import type { ExportProgressReporter } from './progress';
import { createStepMeshGeometryProvider } from './stepMeshGeometryProvider';
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
  assets: Record<string, string>;
  resolveLibraryExportContext: (file: RobotFile) => Promise<ExportContext>;
  resolveExportContext: (target?: ExportTarget) => Promise<ExportContext | null>;
  createProgressReporter: (
    onProgress: HandleExportWithConfigOptions['onProgress'],
    totalSteps: number,
  ) => ExportProgressReporter;
  t: ExportTranslations;
  downloadBlob: (blob: Blob, fileName: string) => void;
  markCurrentTargetSaved: () => void;
}

const STEP_TOTAL_STEPS = 3;

/** Merge extraMeshFiles blobs into the assets map as blob URLs. */
export function mergeExtraMeshFiles(
  assets: Record<string, string>,
  extraMeshFiles?: Map<string, Blob>,
): { assets: Record<string, string>; createdBlobUrls: string[] } {
  if (!extraMeshFiles || extraMeshFiles.size === 0) {
    return { assets, createdBlobUrls: [] };
  }
  const merged: Record<string, string> = { ...assets };
  const createdBlobUrls: string[] = [];
  for (const [path, blob] of extraMeshFiles) {
    if (!merged[path]) {
      const url = URL.createObjectURL(blob);
      merged[path] = url;
      createdBlobUrls.push(url);
    }
  }
  return { assets: merged, createdBlobUrls };
}

export async function executeStepExport({
  config,
  target,
  options,
  assets,
  resolveLibraryExportContext,
  resolveExportContext,
  createProgressReporter,
  t,
  downloadBlob,
  markCurrentTargetSaved,
}: ExecuteStepExportParams): Promise<ExportExecutionResult> {
  const reportProgress = createProgressReporter(options.onProgress, STEP_TOTAL_STEPS);

  // Step 1: resolve the robot + assets.
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

  const { robot, exportName, extraMeshFiles } = exportContext;
  const { assets: mergedAssets, createdBlobUrls } = mergeExtraMeshFiles(assets, extraMeshFiles);

  try {
    // Step 2: build geometry + generate STEP via OCCT WASM worker.
    reportProgress(
      2,
      t.exportProgressGeneratingStep,
      t.exportProgressGeneratingStepDetail,
      { stageProgress: 0.4, indeterminate: true },
    );

    const geometryProvider: StepGeometryProvider = createStepMeshGeometryProvider({
      assets: mergedAssets,
      compression: {
        enabled: config.step.compressMeshes,
        quality: config.step.meshQuality,
      },
    });
    const result = await generateSTEP(robot, {
      provider: geometryProvider,
      includeMeshes: config.step.includeMeshes,
    });

    // Step 3: write + download.
    reportProgress(
      3,
      t.exportProgressGeneratingStep,
      t.exportProgressGeneratingStepDetail,
      { stageProgress: 0.9, indeterminate: false },
    );

    const blob = new Blob([result.content], { type: 'application/step' });
    downloadBlob(blob, `${exportName}.step`);
    markCurrentTargetSaved();

    return {
      partial: result.warnings.length > 0,
      warnings: result.warnings,
      issues: [],
    };
  } finally {
    createdBlobUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}
