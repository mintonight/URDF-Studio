/**
 * File Export Hook
 * Handles exporting robot as URDF, extended URDF, BOM, and MuJoCo XML
 */
import { useCallback, useMemo } from 'react';
import type JSZip from 'jszip';
import { useShallow } from 'zustand/react/shallow';
import type { RobotFile, RobotState } from '@/types';
import {
  generateSDF,
  generateSdfModelConfig,
  generateURDF,
  generateMujocoXML,
  injectGazeboTags,
} from '@/core/parsers';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import { useAssetsStore, useRobotStore, useUIStore } from '@/store';
import { toDocumentLoadLifecycleState } from '@/store/assetsStore';
import type { ExportDialogConfig } from '@/features/file-io';
import { translations } from '@/shared/i18n';
import { normalizeMergedAppMode } from '@/shared/utils/appMode';
import type { RobotAssetPackagingFailure } from '../utils/exportArchiveAssets';
import { addRobotAssetsToZip } from '../utils/exportArchiveAssets';
import { flushPendingHistory } from '../utils/pendingHistory';
import { buildCurrentRobotExportState } from './projectRobotStateUtils';
import { buildGeneratedUrdfOptions } from '../utils/generatedUrdfOptions';
import { resolveRobotFileDataWithWorker } from './robotImportWorkerBridge';
import { markUnsavedChangesBaselineSaved } from '../utils/unsavedChangesBaseline';
import {
  resolveSourcePreservingExportContent,
  type SourcePreservingExportFile,
  type SourcePreservingExportFormat,
} from './sourcePreservingExportUtils';
import {
  addArchiveFilesToZip,
  addSkeletonToZip,
  createArchiveRoot,
  getFileBaseName,
} from './file-export/archive';
import { generateRobotBomCsv } from './file-export/bom';
import {
  createExportProgressReporter,
  replaceTemplate,
  trimProgressFileLabel,
  type ExportProgressReporter,
} from './file-export/progress';
import {
  DEFAULT_EXPORT_TARGET,
  type AssemblyHistoryState,
  type ExportContext,
  type ExportExecutionResult,
  type HandleExportWithConfigOptions,
  type HandleProjectExportOptions,
  type ProjectExportExecutionResult,
  type UrdfSourceExportPreference,
  type ExportTarget,
} from './file-export/types';
import {
  assertAssemblyUrdfExportSupported,
  assertUrdfExportSupported,
  buildAssemblyExportName,
  createBoxFaceTextureFallbackWarnings,
  resolveDisconnectedWorkspaceUrdfAction,
} from './file-export/urdfSupport';
import { applyBoxFaceMaterialExportFallback } from './file-export/materialFallbacks';

export type {
  ExportActionRequired,
  ExportExecutionResult,
  ProjectExportExecutionResult,
} from './file-export/types';

type JSZipInstance = JSZip;

async function createZip(): Promise<JSZipInstance> {
  const { default: JSZip } = await import('jszip');
  return new JSZip();
}

async function prepareMjcfMeshExportAssetsLazy(
  params: Parameters<
    typeof import('@/features/file-io/utils/mjcfMeshExport').prepareMjcfMeshExportAssets
  >[0],
) {
  const { prepareMjcfMeshExportAssets } = await import('@/features/file-io/utils/mjcfMeshExport');
  return prepareMjcfMeshExportAssets(params);
}

export function useFileExport() {
  const { lang, appMode } = useUIStore(
    useShallow((state) => ({
      lang: state.lang,
      appMode: state.appMode,
    })),
  );
  const mergedAppMode = normalizeMergedAppMode(appMode);
  const t = translations[lang];
  const {
    assets,
    availableFiles,
    allFileContents,
    motorLibrary,
    selectedFile,
    documentLoadState,
    getUsdSceneSnapshot,
    getUsdPreparedExportCache,
    usdPreparedExportCaches,
    originalUrdfContent,
    originalFileFormat,
  } = useAssetsStore(
    useShallow((state) => ({
      assets: state.assets,
      availableFiles: state.availableFiles,
      allFileContents: state.allFileContents,
      motorLibrary: state.motorLibrary,
      selectedFile: state.selectedFile,
      documentLoadState: state.documentLoadState,
      getUsdSceneSnapshot: state.getUsdSceneSnapshot,
      getUsdPreparedExportCache: state.getUsdPreparedExportCache,
      usdPreparedExportCaches: state.usdPreparedExportCaches,
      originalUrdfContent: state.originalUrdfContent,
      originalFileFormat: state.originalFileFormat,
    })),
  );
  const documentLoadLifecycleState = useMemo(
    () => toDocumentLoadLifecycleState(documentLoadState),
    [documentLoadState],
  );
  const {
    assemblyState,
    assemblyHistoryPast,
    assemblyHistoryFuture,
    assemblyActivity,
    getMergedRobotData,
  } = useRobotStore(
    useShallow((state) => ({
      assemblyState: state.assemblyState,
      assemblyHistoryPast: state._history.past,
      assemblyHistoryFuture: state._history.future,
      assemblyActivity: state._activity,
      getMergedRobotData: state.getMergedRobotData,
    })),
  );
  const normalizedAssemblyState = assemblyState ?? null;
  const assemblyHistory = useMemo<AssemblyHistoryState>(
    () => ({
      past: assemblyHistoryPast.map((entry) => entry.assemblyState ?? null),
      future: assemblyHistoryFuture.map((entry) => entry.assemblyState ?? null),
    }),
    [assemblyHistoryFuture, assemblyHistoryPast],
  );

  // Get robot state from store
  const {
    robotName,
    robotLinks,
    robotJoints,
    rootLinkId,
    robotMaterials,
    closedLoopConstraints,
    robotHistory,
    robotActivity,
  } = useRobotStore(
    useShallow((state) => ({
      robotName: state.name,
      robotLinks: state.links,
      robotJoints: state.joints,
      rootLinkId: state.rootLinkId,
      robotMaterials: state.materials,
      closedLoopConstraints: state.closedLoopConstraints,
      robotHistory: state._history,
      robotActivity: state._activity,
    })),
  );

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const createProgressReporter = useCallback(
    (
      onProgress: HandleExportWithConfigOptions['onProgress'],
      totalSteps: number,
    ): ExportProgressReporter => createExportProgressReporter(onProgress, totalSteps),
    [],
  );

  const throwForAssetPackagingFailures = useCallback(
    (failures: RobotAssetPackagingFailure[]): void => {
      if (failures.length === 0) {
        return;
      }

      const [firstFailure] = failures;
      throw new Error(firstFailure?.message || 'Failed to package export assets');
    },
    [],
  );

  const generateZipBlobWithProgress = useCallback(
    async (zip: JSZipInstance, reportProgress: ExportProgressReporter, currentStep: number) => {
      reportProgress(currentStep, t.exportProgressPackaging, t.exportProgressPackagingDetail, {
        stageProgress: 0.04,
        indeterminate: true,
      });

      return zip.generateAsync({ type: 'blob' }, (metadata) => {
        const currentFile = trimProgressFileLabel(metadata.currentFile);
        reportProgress(
          currentStep,
          t.exportProgressPackaging,
          currentFile
            ? replaceTemplate(t.exportProgressPackagingDetailFile, { file: currentFile })
            : t.exportProgressPackagingDetail,
          {
            stageProgress: metadata.percent / 100,
            indeterminate: false,
          },
        );
      });
    },
    [replaceTemplate, t, trimProgressFileLabel],
  );

  const isCurrentUsdHydrating =
    selectedFile?.format === 'usd' &&
    documentLoadLifecycleState.status === 'hydrating' &&
    documentLoadLifecycleState.fileName === selectedFile.name;
  const buildRobotForExport = useCallback((): RobotState => {
    // Assembly is always the primary view; use merged assembly data when available.
    if (assemblyState) {
      const mergedData = buildExportableAssemblyRobotData(assemblyState);
      return {
        ...mergedData,
        name: buildAssemblyExportName(assemblyState),
        selection: { type: null, id: null },
      };
    }

    return buildCurrentRobotExportState({
      robotName,
      robotLinks,
      robotJoints,
      rootLinkId,
      robotMaterials,
      closedLoopConstraints,
    });
  }, [
    assemblyState,
    closedLoopConstraints,
    getMergedRobotData,
    robotJoints,
    robotLinks,
    robotMaterials,
    robotName,
    rootLinkId,
  ]);

  const getRobotExportName = useCallback((robot: RobotState): string => {
    const trimmed = robot.name?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : 'robot';
  }, []);

  const boxFaceFallbackWarningLabels = useMemo(
    () => ({
      sdf: t.exportSdfBoxFaceTextureFallbackWarning,
      urdf: t.exportUrdfBoxFaceTextureFallbackWarning,
      xacro: t.exportXacroBoxFaceTextureFallbackWarning,
    }),
    [
      t.exportSdfBoxFaceTextureFallbackWarning,
      t.exportUrdfBoxFaceTextureFallbackWarning,
      t.exportXacroBoxFaceTextureFallbackWarning,
    ],
  );

  const bomLabels = useMemo(
    () => ({
      armature: t.armature,
      direction: t.direction,
      jointName: t.jointName,
      lower: t.lower,
      motorId: t.motorId,
      motorType: t.motorType,
      type: t.type,
      upper: t.upper,
    }),
    [t.armature, t.direction, t.jointName, t.lower, t.motorId, t.motorType, t.type, t.upper],
  );

  const buildBomCsv = useCallback(
    (robot: RobotState): string => generateRobotBomCsv(robot, bomLabels),
    [bomLabels],
  );

  const addMeshesToZip = useCallback(
    async (
      robot: RobotState,
      zip: JSZipInstance,
      compressOptions?: { compressSTL: boolean; stlQuality: number },
      extraMeshFiles?: Map<string, Blob>,
      skipMeshPaths?: ReadonlySet<string>,
      onProgress?: (progress: { completed: number; total: number; currentFile: string }) => void,
    ) => {
      return addRobotAssetsToZip({
        robot,
        zip,
        assets,
        compressOptions,
        extraMeshFiles,
        skipMeshPaths,
        onProgress,
      });
    },
    [assets],
  );

  const resolveLibraryRobotForExport = useCallback(
    async (file: RobotFile): Promise<RobotState> => {
      const isSupportedFormat =
        file.format === 'urdf' ||
        file.format === 'mjcf' ||
        file.format === 'xacro' ||
        file.format === 'sdf';

      if (!isSupportedFormat) {
        throw new Error(
          replaceTemplate(t.exportLibraryUnsupportedFormat, { format: file.format.toUpperCase() }),
        );
      }

      const importResult = await resolveRobotFileDataWithWorker(file, {
        availableFiles,
        assets,
        allFileContents,
        usdRobotData: getUsdPreparedExportCache(file.name)?.robotData ?? null,
      });

      if (importResult.status !== 'ready') {
        throw new Error(replaceTemplate(t.exportLibraryParseFailed, { file: file.name }));
      }

      return {
        ...importResult.robotData,
        selection: { type: null, id: null },
      };
    },
    [
      allFileContents,
      assets,
      availableFiles,
      getUsdPreparedExportCache,
      replaceTemplate,
      t.exportLibraryParseFailed,
      t.exportLibraryUnsupportedFormat,
    ],
  );

  const resolveSourcePreservingSourceFile = useCallback(
    (
      format: SourcePreservingExportFormat,
      target: ExportTarget,
    ): SourcePreservingExportFile | null => {
      if (target.type === 'library-file') {
        return target.file.format === format
          ? {
              name: target.file.name,
              format,
              content: target.file.content,
            }
          : null;
      }

      if (
        isCurrentUsdHydrating ||
        !selectedFile ||
        selectedFile.format !== format
      ) {
        return null;
      }

      const candidateContents = [
        allFileContents[selectedFile.name],
        selectedFile.content,
        originalFileFormat === format ? originalUrdfContent : null,
      ].filter((content, index, values): content is string => {
        const trimmed = content?.trim();
        return Boolean(trimmed) && values.indexOf(content) === index;
      });

      const content = candidateContents[0] ?? null;
      return content
        ? {
            name: selectedFile.name,
            format,
            content,
          }
        : null;
    },
    [
      allFileContents,
      isCurrentUsdHydrating,
      originalFileFormat,
      originalUrdfContent,
      selectedFile,
    ],
  );

  const buildSourcePreservingExportContent = useCallback(
    (
      format: SourcePreservingExportFormat,
      target: ExportTarget,
      currentRobot: RobotState,
      generatedContent: string,
      options: UrdfSourceExportPreference = {},
    ): string | null => {
      if (options.preferSourceVisualMeshes === false) {
        return null;
      }

      const sourceFile = resolveSourcePreservingSourceFile(format, target);
      if (!sourceFile) {
        return null;
      }

      return resolveSourcePreservingExportContent({
        format,
        currentRobot,
        sourceFile,
        generatedContent,
        availableFiles,
        allFileContents,
      }).content;
    },
    [allFileContents, availableFiles, resolveSourcePreservingSourceFile],
  );

  const buildCurrentUsdExportContext = useCallback(async (): Promise<ExportContext | null> => {
    if (selectedFile?.format !== 'usd' || isCurrentUsdHydrating) {
      return null;
    }

    const { resolveCurrentUsdExportBundle } = await import('../utils/usdExportContext');
    const bundle = resolveCurrentUsdExportBundle({
      stageSourcePath: selectedFile.name,
      currentRobot: buildRobotForExport(),
      cachedSnapshot: getUsdSceneSnapshot(selectedFile.name),
      preparedCache: getUsdPreparedExportCache(selectedFile.name),
    });
    if (!bundle) {
      return null;
    }

    return {
      robot: bundle.robot,
      exportName: getRobotExportName(bundle.robot),
      extraMeshFiles: bundle.meshFiles,
    };
  }, [
    buildRobotForExport,
    getRobotExportName,
    getUsdPreparedExportCache,
    getUsdSceneSnapshot,
    isCurrentUsdHydrating,
    selectedFile,
  ]);

  const resolveExportContext = useCallback(
    async (target: ExportTarget = DEFAULT_EXPORT_TARGET): Promise<ExportContext | null> => {
      if (target.type === 'library-file') {
        return null;
      }

      if (selectedFile?.format === 'usd') {
        return buildCurrentUsdExportContext();
      }

      const usdExportContext = await buildCurrentUsdExportContext();
      if (usdExportContext) {
        return usdExportContext;
      }

      const robot = buildRobotForExport();
      return {
        robot,
        exportName: getRobotExportName(robot),
      };
    },
    [
      buildCurrentUsdExportContext,
      buildRobotForExport,
      getRobotExportName,
      selectedFile,
    ],
  );

  const handleExportURDF = useCallback(async () => {
    flushPendingHistory();
    const target = DEFAULT_EXPORT_TARGET;
    const exportContext = await resolveExportContext(target);
    if (!exportContext) {
      throw new Error(t.exportFailedParse);
    }
    const { robot, exportName, extraMeshFiles } = exportContext;
    assertUrdfExportSupported(
      robot,
      exportName,
      replaceTemplate,
      t.exportClosedLoopUrdfUnsupported,
    );
    const zip = await createZip();
    const archiveRoot = createArchiveRoot(zip, exportName);
    const generatedUrdfOptions = await buildGeneratedUrdfOptions(extraMeshFiles);
    const generatedUrdfContent = generateURDF(robot, generatedUrdfOptions);

    archiveRoot.file(
      `${exportName}.urdf`,
      buildSourcePreservingExportContent('urdf', target, robot, generatedUrdfContent) ??
        generatedUrdfContent,
    );
    await addMeshesToZip(robot, archiveRoot, undefined, extraMeshFiles);

    const content = await zip.generateAsync({ type: 'blob' });
    downloadBlob(content, `${exportName}_urdf.zip`);
  }, [
    resolveExportContext,
    buildSourcePreservingExportContent,
    addMeshesToZip,
    downloadBlob,
    t.exportClosedLoopUrdfUnsupported,
    t.exportFailedParse,
  ]);

  const handleExportMJCF = useCallback(async () => {
    flushPendingHistory();
    const exportContext = await resolveExportContext();
    if (!exportContext) {
      throw new Error(t.exportFailedParse);
    }
    const { robot, exportName, extraMeshFiles } = exportContext;
    const mjcfMeshExport = await prepareMjcfMeshExportAssetsLazy({
      robot,
      assets,
      extraMeshFiles,
    });
    const zip = await createZip();
    const archiveRoot = createArchiveRoot(zip, exportName);
    const generatedMjcfContent = generateMujocoXML(robot, {
      meshdir: 'meshes/',
      meshPathOverrides: mjcfMeshExport.meshPathOverrides,
      visualMeshVariants: mjcfMeshExport.visualMeshVariants,
    });

    archiveRoot.file(
      `${exportName}.xml`,
      buildSourcePreservingExportContent('mjcf', DEFAULT_EXPORT_TARGET, robot, generatedMjcfContent) ??
        generatedMjcfContent,
    );
    await addMeshesToZip(
      robot,
      archiveRoot,
      undefined,
      extraMeshFiles,
      mjcfMeshExport.convertedSourceMeshPaths,
    );
    addArchiveFilesToZip(archiveRoot, 'meshes', mjcfMeshExport.archiveFiles);

    const content = await zip.generateAsync({ type: 'blob' });
    downloadBlob(content, `${exportName}_mjcf.zip`);
  }, [
    resolveExportContext,
    assets,
    buildSourcePreservingExportContent,
    addMeshesToZip,
    downloadBlob,
    t.exportFailedParse,
  ]);

  // Export handler
  const handleExport = useCallback(async () => {
    flushPendingHistory();
    const target = DEFAULT_EXPORT_TARGET;
    const exportContext = await resolveExportContext(target);
    if (!exportContext) {
      throw new Error(t.exportFailedParse);
    }
    const { robot, exportName, extraMeshFiles } = exportContext;
    assertUrdfExportSupported(
      robot,
      exportName,
      replaceTemplate,
      t.exportClosedLoopUrdfUnsupported,
    );
    const mjcfMeshExport = await prepareMjcfMeshExportAssetsLazy({
      robot,
      assets,
      extraMeshFiles,
    });
    const generatedUrdfOptions = await buildGeneratedUrdfOptions(extraMeshFiles);

    const zip = await createZip();
    const archiveRoot = createArchiveRoot(zip, exportName);
    const hardwareFolder = archiveRoot.folder('hardware');

    // 1. Generate Standard URDF
    const generatedStandardUrdf = generateURDF(robot, generatedUrdfOptions);
    archiveRoot.file(
      `${exportName}.urdf`,
      buildSourcePreservingExportContent('urdf', target, robot, generatedStandardUrdf) ??
        generatedStandardUrdf,
    );

    // 2. Generate Extended URDF (with hardware info)
    const extendedXml = generateURDF(
      robot,
      await buildGeneratedUrdfOptions(extraMeshFiles, { extended: true }),
    );
    archiveRoot.file(`${exportName}_extended.urdf`, extendedXml);

    // 3. Generate BOM
    const bomCsv = buildBomCsv(robot);
    hardwareFolder?.file('bom_list.csv', bomCsv);

    // 4. Generate MuJoCo XML
    const mujocoXml = generateMujocoXML(robot, {
      meshdir: 'meshes/',
      meshPathOverrides: mjcfMeshExport.meshPathOverrides,
      visualMeshVariants: mjcfMeshExport.visualMeshVariants,
    });
    archiveRoot.file(
      `${exportName}.xml`,
      buildSourcePreservingExportContent('mjcf', target, robot, mujocoXml) ?? mujocoXml,
    );

    // 5. Add Meshes
    await addMeshesToZip(robot, archiveRoot, undefined, extraMeshFiles);
    addArchiveFilesToZip(archiveRoot, 'meshes', mjcfMeshExport.archiveFiles);

    // Generate and download ZIP
    const content = await zip.generateAsync({ type: 'blob' });
    downloadBlob(content, `${exportName}_package.zip`);
  }, [
    resolveExportContext,
    assets,
    buildSourcePreservingExportContent,
    buildBomCsv,
    addMeshesToZip,
    downloadBlob,
    t.exportClosedLoopUrdfUnsupported,
    t.exportFailedParse,
  ]);

  const handleExportDisconnectedWorkspaceUrdfBundle = useCallback(
    async (config: ExportDialogConfig): Promise<ExportExecutionResult> => {
      flushPendingHistory();

      if (config.format !== 'urdf') {
        throw new Error(t.exportFailedParse);
      }

      if (!assemblyState || Object.keys(assemblyState.components).length === 0) {
        throw new Error(t.exportFailedParse);
      }

      assertAssemblyUrdfExportSupported(
        assemblyState,
        replaceTemplate,
        t.exportClosedLoopUrdfUnsupported,
      );

      const zip = await createZip();
      const assemblyExportName = assemblyState.name?.trim() || 'assembly';
      const archiveRoot = createArchiveRoot(zip, assemblyExportName);
      const componentsRoot = archiveRoot.folder('components') ?? archiveRoot;
      const assetPackagingFailures: RobotAssetPackagingFailure[] = [];
      let boxFaceFallbackCount = 0;

      const {
        includeExtended,
        includeBOM,
        useRelativePaths,
        includeMeshes,
        compressSTL,
        stlQuality,
        preferSourceVisualMeshes,
      } = config.urdf;

      for (const component of Object.values(assemblyState.components)) {
        const componentExportName = component.name?.trim() || component.id;
        const componentFolder = componentsRoot.folder(componentExportName) ?? componentsRoot;
        const componentRobot: RobotState = {
          ...component.robot,
          selection: { type: null, id: null },
        };
        const fallbackResult = applyBoxFaceMaterialExportFallback(componentRobot);
        const exportRobot = fallbackResult.robot;
        boxFaceFallbackCount += fallbackResult.records.length;
        const sourceFile = availableFiles.find((file) => file.name === component.sourceFile);
        const generatedUrdfOptions = await buildGeneratedUrdfOptions(undefined, {
          useRelativePaths,
        });
        const generatedUrdfContent = generateURDF(exportRobot, generatedUrdfOptions);
        const urdfContent = includeExtended
          ? generateURDF(
              exportRobot,
              await buildGeneratedUrdfOptions(undefined, { extended: true, useRelativePaths }),
            )
          : ((sourceFile && fallbackResult.records.length === 0
              ? buildSourcePreservingExportContent(
                  'urdf',
                  { type: 'library-file', file: sourceFile },
                  exportRobot,
                  generatedUrdfContent,
                  {
                    useRelativePaths,
                    preferSourceVisualMeshes,
                  },
                )
              : null) ?? generatedUrdfContent);

        componentFolder.file(`${componentExportName}.urdf`, urdfContent);

        if (config.includeSkeleton) {
          addSkeletonToZip(exportRobot, componentFolder, componentExportName, includeMeshes);
        }

        if (includeBOM) {
          const hardwareFolder = componentFolder.folder('hardware');
          hardwareFolder?.file('bom_list.csv', buildBomCsv(exportRobot));
        }

        if (!includeMeshes) {
          continue;
        }

        const meshPackagingResult = await addMeshesToZip(exportRobot, componentFolder, {
          compressSTL,
          stlQuality,
        });
        assetPackagingFailures.push(...meshPackagingResult.failedAssets);
      }

      throwForAssetPackagingFailures(assetPackagingFailures);

      const content = await zip.generateAsync({ type: 'blob' });
      downloadBlob(content, `${assemblyExportName}_components_urdf.zip`);

      const warnings = createBoxFaceTextureFallbackWarnings(
        'urdf',
        boxFaceFallbackCount,
        replaceTemplate,
        boxFaceFallbackWarningLabels,
      );

      return {
        partial: warnings.length > 0,
        warnings,
        issues: [],
      };
    },
    [
      addMeshesToZip,
      assemblyState,
      availableFiles,
      bomLabels,
      boxFaceFallbackWarningLabels,
      buildSourcePreservingExportContent,
      downloadBlob,
      replaceTemplate,
      t.exportClosedLoopUrdfUnsupported,
      t.exportFailedParse,
      throwForAssetPackagingFailures,
    ],
  );

  const handleExportWithConfig = useCallback(
    async (
      config: ExportDialogConfig,
      target: ExportTarget = DEFAULT_EXPORT_TARGET,
      options: HandleExportWithConfigOptions = {},
    ): Promise<ExportExecutionResult> => {
      flushPendingHistory();
      const markCurrentTargetSaved = () => {
        if (target.type === 'current') {
          markUnsavedChangesBaselineSaved('robot');
        }
      };
      const requiresResolvedUsdContext =
        target.type === 'current' && selectedFile?.format === 'usd';

      if (config.format === 'usd') {
        const { executeUsdExport } = await import('./file-export/usdExport');
        return executeUsdExport({
          config,
          target,
          options,
          assets,
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
        });
      }

      if (
        config.format === 'urdf' &&
        target.type === 'current' &&
        normalizedAssemblyState
      ) {
        assertAssemblyUrdfExportSupported(
          normalizedAssemblyState,
          replaceTemplate,
          t.exportClosedLoopUrdfUnsupported,
        );
      }

      const disconnectedWorkspaceUrdfAction = resolveDisconnectedWorkspaceUrdfAction(
        target,
        config,
        normalizedAssemblyState,
      );
      if (disconnectedWorkspaceUrdfAction) {
        return {
          partial: false,
          warnings: [],
          issues: [],
          actionRequired: disconnectedWorkspaceUrdfAction,
        };
      }

      const totalSteps =
        config.format === 'mjcf'
          ? config.mjcf.includeMeshes
            ? 5
            : 4
          : (
                config.format === 'urdf'
                  ? config.urdf.includeMeshes
                  : config.format === 'xacro'
                    ? config.xacro.includeMeshes
                    : config.sdf.includeMeshes
              )
            ? 4
            : 3;
      const reportProgress = createProgressReporter(options.onProgress, totalSteps);
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
          : await resolveExportContext(target);
      if (!exportContext) {
        if (requiresResolvedUsdContext) {
          throw new Error(t.usdExportUnavailable);
        }
        throw new Error(t.exportFailedParse);
      }

      const { robot, exportName, extraMeshFiles } = exportContext;
      const boxFaceFallback =
        config.format === 'urdf' || config.format === 'sdf' || config.format === 'xacro'
          ? applyBoxFaceMaterialExportFallback(robot)
          : null;
      const exportRobot = boxFaceFallback?.robot ?? robot;
      const boxFaceFallbackCount = boxFaceFallback?.records.length ?? 0;
      const assetPackagingFailures: RobotAssetPackagingFailure[] = [];
      const zip = await createZip();
      const archiveRoot = createArchiveRoot(zip, exportName);
      const skeletonUsesMeshes =
        config.format === 'mjcf'
          ? config.mjcf.includeMeshes
          : config.format === 'urdf'
            ? config.urdf.includeMeshes
            : config.format === 'xacro'
              ? config.xacro.includeMeshes
              : config.sdf.includeMeshes;

      if (config.format === 'urdf') {
        assertUrdfExportSupported(
          exportRobot,
          exportName,
          replaceTemplate,
          t.exportClosedLoopUrdfUnsupported,
        );
      }

      if (config.includeSkeleton) {
        addSkeletonToZip(exportRobot, archiveRoot, exportName, skeletonUsesMeshes);
      }

      if (config.format === 'mjcf') {
        const {
          meshdir,
          addFloatBase,
          preferSharedMeshReuse,
          includeActuators,
          actuatorType,
          includeMeshes,
          compressSTL,
          stlQuality,
        } = config.mjcf;
        reportProgress(
          2,
          t.exportProgressPreparingSimulationMeshes,
          t.exportProgressPreparingSimulationMeshesDetail,
          {
            stageProgress: 0.04,
            indeterminate: true,
          },
        );

        const mjcfMeshExport = await prepareMjcfMeshExportAssetsLazy({
          robot,
          assets,
          extraMeshFiles,
          preferSharedMeshReuse,
        });

        reportProgress(3, t.exportProgressGeneratingFiles, t.exportProgressGeneratingMjcfDetail, {
          stageProgress: 0.85,
          indeterminate: false,
        });

        const generatedMjcfContent = generateMujocoXML(robot, {
          meshdir,
          addFloatBase,
          includeActuators,
          actuatorType,
          meshPathOverrides: mjcfMeshExport.meshPathOverrides,
          visualMeshVariants: mjcfMeshExport.visualMeshVariants,
        });
        archiveRoot.file(
          `${exportName}.xml`,
          buildSourcePreservingExportContent('mjcf', target, robot, generatedMjcfContent) ??
            generatedMjcfContent,
        );
        if (includeMeshes) {
          reportProgress(
            4,
            t.exportProgressCollectingAssets,
            t.exportProgressCollectingAssetsPreparingDetail,
            {
              stageProgress: 0.04,
              indeterminate: true,
            },
          );

          const meshPackagingResult = await addMeshesToZip(
            robot,
            archiveRoot,
            { compressSTL, stlQuality },
            extraMeshFiles,
            mjcfMeshExport.convertedSourceMeshPaths,
            ({ completed, total, currentFile }) => {
              reportProgress(
                4,
                t.exportProgressCollectingAssets,
                replaceTemplate(t.exportProgressCollectingAssetsDetail, {
                  current: completed,
                  total,
                  file: trimProgressFileLabel(currentFile) || t.exportProgressArchiveFallbackFile,
                }),
                {
                  stageProgress: total > 0 ? completed / total : 1,
                  indeterminate: false,
                },
              );
            },
          );
          assetPackagingFailures.push(...meshPackagingResult.failedAssets);
          addArchiveFilesToZip(archiveRoot, 'meshes', mjcfMeshExport.archiveFiles);
        }
        throwForAssetPackagingFailures(assetPackagingFailures);
        const content = await generateZipBlobWithProgress(
          zip,
          reportProgress,
          includeMeshes ? 5 : 4,
        );
        downloadBlob(content, `${exportName}_mjcf.zip`);
        markCurrentTargetSaved();
        return {
          partial: false,
          warnings: [],
          issues: [],
        };
      }

      if (config.format === 'urdf') {
        const {
          includeExtended,
          includeBOM,
          useRelativePaths,
          includeMeshes,
          compressSTL,
          stlQuality,
        } = config.urdf;
        const preferSourceVisualMeshes = config.urdf.preferSourceVisualMeshes;
        const generatedUrdfOptions = await buildGeneratedUrdfOptions(extraMeshFiles, {
          useRelativePaths,
        });
        reportProgress(2, t.exportProgressGeneratingFiles, t.exportProgressGeneratingUrdfDetail, {
          stageProgress: 0.85,
          indeterminate: false,
        });

        const warnings = createBoxFaceTextureFallbackWarnings(
          'urdf',
          boxFaceFallbackCount,
          replaceTemplate,
          boxFaceFallbackWarningLabels,
        );
        const urdfContent = includeExtended
          ? generateURDF(
              exportRobot,
              await buildGeneratedUrdfOptions(extraMeshFiles, { extended: true, useRelativePaths }),
            )
          : (() => {
              const generatedUrdfContent = generateURDF(exportRobot, generatedUrdfOptions);
              return (
                (boxFaceFallbackCount === 0
                  ? buildSourcePreservingExportContent(
                      'urdf',
                      target,
                      exportRobot,
                      generatedUrdfContent,
                      {
                        useRelativePaths,
                        preferSourceVisualMeshes,
                      },
                    )
                  : null) ?? generatedUrdfContent
              );
            })();
        archiveRoot.file(`${exportName}.urdf`, urdfContent);
        if (includeBOM) {
          const hardwareFolder = archiveRoot.folder('hardware');
          hardwareFolder?.file('bom_list.csv', buildBomCsv(exportRobot));
        }
        if (includeMeshes) {
          reportProgress(
            3,
            t.exportProgressCollectingAssets,
            t.exportProgressCollectingAssetsPreparingDetail,
            {
              stageProgress: 0.04,
              indeterminate: true,
            },
          );

          const meshPackagingResult = await addMeshesToZip(
            exportRobot,
            archiveRoot,
            { compressSTL, stlQuality },
            extraMeshFiles,
            undefined,
            ({ completed, total, currentFile }) => {
              reportProgress(
                3,
                t.exportProgressCollectingAssets,
                replaceTemplate(t.exportProgressCollectingAssetsDetail, {
                  current: completed,
                  total,
                  file: trimProgressFileLabel(currentFile) || t.exportProgressArchiveFallbackFile,
                }),
                {
                  stageProgress: total > 0 ? completed / total : 1,
                  indeterminate: false,
                },
              );
            },
          );
          assetPackagingFailures.push(...meshPackagingResult.failedAssets);
        }
        throwForAssetPackagingFailures(assetPackagingFailures);
        const content = await generateZipBlobWithProgress(
          zip,
          reportProgress,
          includeMeshes ? 4 : 3,
        );
        downloadBlob(content, `${exportName}_urdf.zip`);
        markCurrentTargetSaved();
        return {
          partial: warnings.length > 0,
          warnings,
          issues: [],
        };
      } else if (config.format === 'sdf') {
        const { includeMeshes, compressSTL, stlQuality } = config.sdf;
        const warnings = createBoxFaceTextureFallbackWarnings(
          'sdf',
          boxFaceFallbackCount,
          replaceTemplate,
          boxFaceFallbackWarningLabels,
        );
        reportProgress(2, t.exportProgressGeneratingFiles, t.exportProgressGeneratingSdfDetail, {
          stageProgress: 0.85,
          indeterminate: false,
        });

        const generatedSdfContent = generateSDF(exportRobot, {
          packageName: exportName,
        });
        archiveRoot.file(
          'model.sdf',
          buildSourcePreservingExportContent('sdf', target, exportRobot, generatedSdfContent) ??
            generatedSdfContent,
        );
        archiveRoot.file(
          'model.config',
          generateSdfModelConfig(exportRobot.name?.trim() || exportName),
        );
        if (includeMeshes) {
          reportProgress(
            3,
            t.exportProgressCollectingAssets,
            t.exportProgressCollectingAssetsPreparingDetail,
            {
              stageProgress: 0.04,
              indeterminate: true,
            },
          );

          const meshPackagingResult = await addMeshesToZip(
            exportRobot,
            archiveRoot,
            { compressSTL, stlQuality },
            extraMeshFiles,
            undefined,
            ({ completed, total, currentFile }) => {
              reportProgress(
                3,
                t.exportProgressCollectingAssets,
                replaceTemplate(t.exportProgressCollectingAssetsDetail, {
                  current: completed,
                  total,
                  file: trimProgressFileLabel(currentFile) || t.exportProgressArchiveFallbackFile,
                }),
                {
                  stageProgress: total > 0 ? completed / total : 1,
                  indeterminate: false,
                },
              );
            },
          );
          assetPackagingFailures.push(...meshPackagingResult.failedAssets);
        }
        throwForAssetPackagingFailures(assetPackagingFailures);
        const content = await generateZipBlobWithProgress(
          zip,
          reportProgress,
          includeMeshes ? 4 : 3,
        );
        downloadBlob(content, `${exportName}_sdf.zip`);
        markCurrentTargetSaved();
        return {
          partial: warnings.length > 0,
          warnings,
          issues: [],
        };
      } else if (config.format === 'xacro') {
        const {
          rosVersion,
          rosHardwareInterface,
          useRelativePaths,
          includeMeshes,
          compressSTL,
          stlQuality,
        } = config.xacro;
        assertUrdfExportSupported(
          exportRobot,
          exportName,
          replaceTemplate,
          t.exportClosedLoopUrdfUnsupported,
        );
        const generatedUrdfOptions = await buildGeneratedUrdfOptions(extraMeshFiles, {
          useRelativePaths,
        });
        reportProgress(2, t.exportProgressGeneratingFiles, t.exportProgressGeneratingXacroDetail, {
          stageProgress: 0.85,
          indeterminate: false,
        });

        const warnings = createBoxFaceTextureFallbackWarnings(
          'xacro',
          boxFaceFallbackCount,
          replaceTemplate,
          boxFaceFallbackWarningLabels,
        );
        const generatedXacroBaseUrdf = generateURDF(exportRobot, generatedUrdfOptions);
        const generatedXacroContent = injectGazeboTags(
          generatedXacroBaseUrdf,
          exportRobot,
          rosVersion,
          rosHardwareInterface,
        );
        const xacroContent =
          (boxFaceFallbackCount === 0
            ? buildSourcePreservingExportContent(
                'xacro',
                target,
                exportRobot,
                generatedXacroContent,
                { useRelativePaths },
              )
            : null) ?? generatedXacroContent;
        archiveRoot.file(`${exportName}.urdf.xacro`, xacroContent);
        if (includeMeshes) {
          reportProgress(
            3,
            t.exportProgressCollectingAssets,
            t.exportProgressCollectingAssetsPreparingDetail,
            {
              stageProgress: 0.04,
              indeterminate: true,
            },
          );

          const meshPackagingResult = await addMeshesToZip(
            exportRobot,
            archiveRoot,
            { compressSTL, stlQuality },
            extraMeshFiles,
            undefined,
            ({ completed, total, currentFile }) => {
              reportProgress(
                3,
                t.exportProgressCollectingAssets,
                replaceTemplate(t.exportProgressCollectingAssetsDetail, {
                  current: completed,
                  total,
                  file: trimProgressFileLabel(currentFile) || t.exportProgressArchiveFallbackFile,
                }),
                {
                  stageProgress: total > 0 ? completed / total : 1,
                  indeterminate: false,
                },
              );
            },
          );
          assetPackagingFailures.push(...meshPackagingResult.failedAssets);
        }
        throwForAssetPackagingFailures(assetPackagingFailures);
        const content = await generateZipBlobWithProgress(
          zip,
          reportProgress,
          includeMeshes ? 4 : 3,
        );
        downloadBlob(content, `${exportName}_xacro.zip`);
        markCurrentTargetSaved();
        return {
          partial: warnings.length > 0,
          warnings,
          issues: [],
        };
      }

      return {
        partial: false,
        warnings: [],
        issues: [],
      };
    },
    [
      addMeshesToZip,
      createProgressReporter,
      bomLabels,
      boxFaceFallbackWarningLabels,
      downloadBlob,
      assets,
      generateZipBlobWithProgress,
      buildSourcePreservingExportContent,
      replaceTemplate,
      resolveLibraryRobotForExport,
      resolveExportContext,
      selectedFile,
      t.exportClosedLoopUrdfUnsupported,
      t.exportFailedParse,
      t,
      throwForAssetPackagingFailures,
      trimProgressFileLabel,
    ],
  );

  // Export project as .usp
  const handleExportProject = useCallback(
    async (options: HandleProjectExportOptions = {}): Promise<ProjectExportExecutionResult> => {
      const { executeProjectExport } = await import('./file-export/projectExport');
      return executeProjectExport({
        options,
        robotName,
        robotLinks,
        robotJoints,
        rootLinkId,
        robotMaterials,
        closedLoopConstraints,
        robotHistory,
        robotActivity,
        assemblyState: normalizedAssemblyState,
        assemblyHistory: assemblyHistory as AssemblyHistoryState,
        assemblyActivity,
        mergedAppMode,
        lang,
        availableFiles,
        assets,
        allFileContents,
        motorLibrary,
        selectedFileName: selectedFile?.name ?? null,
        originalUrdfContent,
        originalFileFormat,
        usdPreparedExportCaches,
        getMergedRobotData,
        createProgressReporter,
        downloadBlob,
        replaceTemplate,
        t,
        markAllSaved: () => markUnsavedChangesBaselineSaved('all'),
      });
    },
    [
      robotName,
      robotLinks,
      robotJoints,
      rootLinkId,
      robotMaterials,
      closedLoopConstraints,
      robotHistory,
      robotActivity,
      normalizedAssemblyState,
      assemblyHistory,
      assemblyActivity,
      mergedAppMode,
      lang,
      availableFiles,
      assets,
      allFileContents,
      motorLibrary,
      selectedFile?.name,
      originalUrdfContent,
      originalFileFormat,
      usdPreparedExportCaches,
      getMergedRobotData,
      createProgressReporter,
      downloadBlob,
      replaceTemplate,
      t,
    ],
  );

  return {
    handleExportURDF,
    handleExportMJCF,
    handleExport,
    handleExportDisconnectedWorkspaceUrdfBundle,
    handleExportProject,
    handleExportWithConfig,
    generateBOM: buildBomCsv,
  };
}

export default useFileExport;
