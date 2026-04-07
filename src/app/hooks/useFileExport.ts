/**
 * File Export Hook
 * Handles exporting robot as URDF, extended URDF, BOM, and MuJoCo XML
 */
import { useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { useShallow } from 'zustand/react/shallow';
import type { AssemblyState, RobotFile, RobotState } from '@/types';
import {
  generateSDF,
  generateSdfModelConfig,
  generateURDF,
  generateMujocoXML,
  generateSkeletonXML,
  injectGazeboTags,
} from '@/core/parsers';
import { analyzeAssemblyConnectivity } from '@/core/robot';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import { rewriteUrdfAssetPathsForExport } from '@/core/parsers/meshPathUtils';
import { useAssemblyStore, useAssetsStore, useRobotStore, useUIStore } from '@/store';
import { toDocumentLoadLifecycleState } from '@/store/assetsStore';
import { prepareMjcfMeshExportAssets, type ExportDialogConfig } from '@/features/file-io';
import { getUsdStageExportHandler } from '@/features/urdf-viewer';
import { translations } from '@/shared/i18n';
import { normalizeMergedAppMode } from '@/shared/utils/appMode';
import type { RobotAssetPackagingFailure } from '../utils/exportArchiveAssets';
import { addRobotAssetsToZip } from '../utils/exportArchiveAssets';
import { resolveCurrentUsdExportMode } from '../utils/currentUsdExportMode';
import { flushPendingHistory } from '../utils/pendingHistory';
import { buildCurrentRobotExportState } from './projectRobotStateUtils';
import { resolveCurrentUsdExportBundle } from '../utils/usdExportContext';
import { resolveUrdfSourceExportContent } from './urdfSourceExportUtils';
import { buildGeneratedUrdfOptions } from '../utils/generatedUrdfOptions';
import { resolveRobotFileDataWithWorker } from './robotImportWorkerBridge';
import { markUnsavedChangesBaselineSaved } from '../utils/unsavedChangesBaseline';
import {
  createExportProgressReporter,
  replaceTemplate,
  trimProgressFileLabel,
  type ExportProgressReporter,
} from './file-export/progress';
import {
  DEFAULT_EXPORT_TARGET,
  type ExportActionRequired,
  type AssemblyHistoryState,
  type ExportContext,
  type ExportExecutionResult,
  type HandleExportWithConfigOptions,
  type HandleProjectExportOptions,
  type ProjectExportExecutionResult,
  type UrdfSourceExportPreference,
  type ExportTarget,
} from './file-export/types';
import { executeProjectExport } from './file-export/projectExport';
import { executeUsdExport } from './file-export/usdExport';

export type {
  ExportActionRequired,
  ExportExecutionResult,
  ProjectExportExecutionResult,
} from './file-export/types';

export function useFileExport() {
  const { lang, appMode, sidebarTab } = useUIStore(
    useShallow((state) => ({
      lang: state.lang,
      appMode: state.appMode,
      sidebarTab: state.sidebarTab,
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
  const { assemblyState, assemblyHistory, assemblyActivity, getMergedRobotData } = useAssemblyStore(
    useShallow((state) => ({
      assemblyState: state.assemblyState,
      assemblyHistory: state._history,
      assemblyActivity: state._activity,
      getMergedRobotData: state.getMergedRobotData,
    })),
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
    async (zip: JSZip, reportProgress: ExportProgressReporter, currentStep: number) => {
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
  const currentUsdExportMode =
    selectedFile?.format === 'usd' && sidebarTab !== 'workspace'
      ? resolveCurrentUsdExportMode({
          isHydrating: isCurrentUsdHydrating,
          hasLiveStageExportHandler: Boolean(getUsdStageExportHandler()),
          hasPreparedExportCache: Boolean(getUsdPreparedExportCache(selectedFile.name)),
          hasSceneSnapshot: Boolean(getUsdSceneSnapshot(selectedFile.name)),
        })
      : 'unavailable';

  const buildRobotForExport = useCallback((): RobotState => {
    // Keep export source aligned with current viewer:
    // workspace tab -> merged assembly; structure tab -> current robot store.
    if (assemblyState && sidebarTab === 'workspace') {
      const mergedData = buildExportableAssemblyRobotData(assemblyState);
      return { ...mergedData, selection: { type: null, id: null } };
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
    sidebarTab,
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

  const assertUrdfExportSupported = useCallback(
    (robot: Pick<RobotState, 'name' | 'closedLoopConstraints'>, exportName?: string): void => {
      const closedLoopConstraintCount = robot.closedLoopConstraints?.length ?? 0;
      if (closedLoopConstraintCount === 0) {
        return;
      }

      const resolvedExportName = exportName?.trim() || robot.name?.trim() || 'robot';
      throw new Error(
        replaceTemplate(t.exportClosedLoopUrdfUnsupported, {
          name: resolvedExportName,
          count: closedLoopConstraintCount,
        }),
      );
    },
    [replaceTemplate, t.exportClosedLoopUrdfUnsupported],
  );

  const assertAssemblyUrdfExportSupported = useCallback(
    (assembly: AssemblyState): void => {
      Object.values(assembly.components).forEach((component) => {
        assertUrdfExportSupported(component.robot, component.name?.trim() || component.id);
      });
    },
    [assertUrdfExportSupported],
  );

  const resolveDisconnectedWorkspaceUrdfAction = useCallback(
    (target: ExportTarget, config: ExportDialogConfig): ExportActionRequired | null => {
      if (
        target.type !== 'current' ||
        config.format !== 'urdf' ||
        sidebarTab !== 'workspace' ||
        !assemblyState
      ) {
        return null;
      }

      const analysis = analyzeAssemblyConnectivity(assemblyState);
      if (!analysis.hasDisconnectedComponents) {
        return null;
      }

      return {
        type: 'disconnected-workspace-urdf',
        componentCount: analysis.componentCount,
        connectedGroupCount: analysis.connectedGroupCount,
        exportName: assemblyState.name?.trim() || 'assembly',
      };
    },
    [assemblyState, sidebarTab],
  );

  const createArchiveRoot = useCallback((zip: JSZip, exportName: string): JSZip => {
    return zip.folder(exportName) ?? zip;
  }, []);

  const getFileBaseName = useCallback((path: string): string => {
    const fileName = path.split('/').pop() ?? path;
    const withoutExt = fileName.replace(/\.[^/.]+$/, '');
    const trimmed = withoutExt.trim();
    return trimmed.length > 0 ? trimmed : 'robot';
  }, []);

  const addSkeletonToZip = useCallback(
    (robot: RobotState, zip: JSZip, exportName: string, includeMeshes: boolean) => {
      zip.file(
        `${exportName}_skeleton.xml`,
        generateSkeletonXML(robot, {
          meshdir: 'meshes/',
          includeMeshes,
          includeActuators: true,
        }),
      );
    },
    [],
  );

  const addMeshesToZip = useCallback(
    async (
      robot: RobotState,
      zip: JSZip,
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

  const addArchiveFilesToZip = useCallback(
    (zip: JSZip, folderName: string, archiveFiles?: Map<string, Blob>) => {
      if (!archiveFiles || archiveFiles.size === 0) {
        return;
      }

      const targetFolder = zip.folder(folderName);
      archiveFiles.forEach((blob, relativePath) => {
        targetFolder?.file(relativePath, blob);
      });
    },
    [],
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

  const buildUrdfSourceExportContent = useCallback(
    async (
      target: ExportTarget,
      exportName: string,
      options: UrdfSourceExportPreference = {},
    ): Promise<string | null> => {
      const { useRelativePaths = false, preferSourceVisualMeshes = true } = options;

      if (!preferSourceVisualMeshes) {
        return null;
      }

      if (target.type === 'library-file') {
        if (target.file.format !== 'urdf') {
          return null;
        }

        return rewriteUrdfAssetPathsForExport(target.file.content, {
          exportRobotName: exportName,
          useRelativePaths,
        });
      }

      if (sidebarTab === 'workspace' || selectedFile?.format !== 'urdf' || isCurrentUsdHydrating) {
        return null;
      }

      return resolveUrdfSourceExportContent({
        currentRobot: buildRobotForExport(),
        exportRobotName: exportName,
        selectedFileName: selectedFile.name,
        selectedFileContent: selectedFile.content,
        originalUrdfContent,
        useRelativePaths,
        preferSourceVisualMeshes,
      });
    },
    [buildRobotForExport, isCurrentUsdHydrating, originalUrdfContent, selectedFile, sidebarTab],
  );

  const buildCurrentUsdExportContext = useCallback((): ExportContext | null => {
    if (selectedFile?.format !== 'usd' || sidebarTab === 'workspace' || isCurrentUsdHydrating) {
      return null;
    }

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
    sidebarTab,
  ]);

  const resolveExportContext = useCallback(
    (target: ExportTarget = DEFAULT_EXPORT_TARGET): ExportContext | null => {
      if (target.type === 'library-file') {
        return null;
      }

      if (selectedFile?.format === 'usd' && sidebarTab !== 'workspace') {
        return buildCurrentUsdExportContext();
      }

      const usdExportContext = buildCurrentUsdExportContext();
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
      sidebarTab,
    ],
  );

  // Generate BOM (Bill of Materials) CSV
  const generateBOM = useCallback(
    (robot: RobotState): string => {
      const headers = [
        t.jointName,
        t.type,
        t.motorType,
        t.motorId,
        t.direction,
        t.armature,
        t.lower,
        t.upper,
      ];

      const rows = Object.values(robot.joints)
        .map((j) => {
          if (j.type === 'fixed') return null;
          if (!j.hardware?.motorType || j.hardware.motorType === 'None') return null;

          return [
            j.name,
            j.type,
            j.hardware?.motorType,
            j.hardware?.motorId || '',
            j.hardware?.motorDirection || 1,
            j.hardware?.armature || 0,
            j.limit?.lower ?? '',
            j.limit?.upper ?? '',
          ].join(',');
        })
        .filter((row) => row !== null);

      return [headers.join(','), ...rows].join('\n');
    },
    [t],
  );

  const handleExportURDF = useCallback(async () => {
    flushPendingHistory();
    const target = DEFAULT_EXPORT_TARGET;
    const exportContext = resolveExportContext(target);
    if (!exportContext) {
      throw new Error(t.exportFailedParse);
    }
    const { robot, exportName, extraMeshFiles } = exportContext;
    const zip = new JSZip();
    const archiveRoot = createArchiveRoot(zip, exportName);
    const generatedUrdfOptions = await buildGeneratedUrdfOptions(extraMeshFiles);

    archiveRoot.file(
      `${exportName}.urdf`,
      (await buildUrdfSourceExportContent(target, exportName)) ??
        generateURDF(robot, generatedUrdfOptions),
    );
    await addMeshesToZip(robot, archiveRoot, undefined, extraMeshFiles);

    const content = await zip.generateAsync({ type: 'blob' });
    downloadBlob(content, `${exportName}_urdf.zip`);
  }, [
    resolveExportContext,
    createArchiveRoot,
    buildUrdfSourceExportContent,
    addMeshesToZip,
    downloadBlob,
    t.exportFailedParse,
  ]);

  const handleExportMJCF = useCallback(async () => {
    flushPendingHistory();
    const exportContext = resolveExportContext();
    if (!exportContext) {
      throw new Error(t.exportFailedParse);
    }
    const { robot, exportName, extraMeshFiles } = exportContext;
    const mjcfMeshExport = await prepareMjcfMeshExportAssets({
      robot,
      assets,
      extraMeshFiles,
    });
    const zip = new JSZip();
    const archiveRoot = createArchiveRoot(zip, exportName);

    archiveRoot.file(
      `${exportName}.xml`,
      generateMujocoXML(robot, {
        meshdir: 'meshes/',
        meshPathOverrides: mjcfMeshExport.meshPathOverrides,
        visualMeshVariants: mjcfMeshExport.visualMeshVariants,
      }),
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
    createArchiveRoot,
    addMeshesToZip,
    addArchiveFilesToZip,
    downloadBlob,
    t.exportFailedParse,
  ]);

  // Export handler
  const handleExport = useCallback(async () => {
    flushPendingHistory();
    const target = DEFAULT_EXPORT_TARGET;
    const exportContext = resolveExportContext(target);
    if (!exportContext) {
      throw new Error(t.exportFailedParse);
    }
    const { robot, exportName, extraMeshFiles } = exportContext;
    const mjcfMeshExport = await prepareMjcfMeshExportAssets({
      robot,
      assets,
      extraMeshFiles,
    });
    const generatedUrdfOptions = await buildGeneratedUrdfOptions(extraMeshFiles);

    const zip = new JSZip();
    const archiveRoot = createArchiveRoot(zip, exportName);
    const hardwareFolder = archiveRoot.folder('hardware');

    // 1. Generate Standard URDF
    archiveRoot.file(
      `${exportName}.urdf`,
      (await buildUrdfSourceExportContent(target, exportName)) ??
        generateURDF(robot, generatedUrdfOptions),
    );

    // 2. Generate Extended URDF (with hardware info)
    const extendedXml = generateURDF(
      robot,
      await buildGeneratedUrdfOptions(extraMeshFiles, { extended: true }),
    );
    archiveRoot.file(`${exportName}_extended.urdf`, extendedXml);

    // 3. Generate BOM
    const bomCsv = generateBOM(robot);
    hardwareFolder?.file('bom_list.csv', bomCsv);

    // 4. Generate MuJoCo XML
    const mujocoXml = generateMujocoXML(robot, {
      meshdir: 'meshes/',
      meshPathOverrides: mjcfMeshExport.meshPathOverrides,
      visualMeshVariants: mjcfMeshExport.visualMeshVariants,
    });
    archiveRoot.file(`${exportName}.xml`, mujocoXml);

    // 5. Add Meshes
    await addMeshesToZip(robot, archiveRoot, undefined, extraMeshFiles);
    addArchiveFilesToZip(archiveRoot, 'meshes', mjcfMeshExport.archiveFiles);

    // Generate and download ZIP
    const content = await zip.generateAsync({ type: 'blob' });
    downloadBlob(content, `${exportName}_package.zip`);
  }, [
    resolveExportContext,
    assets,
    createArchiveRoot,
    buildUrdfSourceExportContent,
    generateBOM,
    addMeshesToZip,
    addArchiveFilesToZip,
    downloadBlob,
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

      assertAssemblyUrdfExportSupported(assemblyState);

      const zip = new JSZip();
      const assemblyExportName = assemblyState.name?.trim() || 'assembly';
      const archiveRoot = createArchiveRoot(zip, assemblyExportName);
      const componentsRoot = archiveRoot.folder('components') ?? archiveRoot;
      const assetPackagingFailures: RobotAssetPackagingFailure[] = [];

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
        const sourceFile = availableFiles.find((file) => file.name === component.sourceFile);
        const generatedUrdfOptions = await buildGeneratedUrdfOptions(undefined, {
          useRelativePaths,
        });
        const urdfContent = includeExtended
          ? generateURDF(
              componentRobot,
              await buildGeneratedUrdfOptions(undefined, { extended: true, useRelativePaths }),
            )
          : ((sourceFile
              ? await buildUrdfSourceExportContent(
                  { type: 'library-file', file: sourceFile },
                  componentExportName,
                  {
                    useRelativePaths,
                    preferSourceVisualMeshes,
                  },
                )
              : null) ?? generateURDF(componentRobot, generatedUrdfOptions));

        componentFolder.file(`${componentExportName}.urdf`, urdfContent);

        if (config.includeSkeleton) {
          addSkeletonToZip(componentRobot, componentFolder, componentExportName, includeMeshes);
        }

        if (includeBOM) {
          const hardwareFolder = componentFolder.folder('hardware');
          hardwareFolder?.file('bom_list.csv', generateBOM(componentRobot));
        }

        if (!includeMeshes) {
          continue;
        }

        const meshPackagingResult = await addMeshesToZip(componentRobot, componentFolder, {
          compressSTL,
          stlQuality,
        });
        assetPackagingFailures.push(...meshPackagingResult.failedAssets);
      }

      throwForAssetPackagingFailures(assetPackagingFailures);

      const content = await zip.generateAsync({ type: 'blob' });
      downloadBlob(content, `${assemblyExportName}_components_urdf.zip`);

      return {
        partial: false,
        warnings: [],
        issues: [],
      };
    },
    [
      addMeshesToZip,
      addSkeletonToZip,
      assertAssemblyUrdfExportSupported,
      assemblyState,
      availableFiles,
      buildUrdfSourceExportContent,
      createArchiveRoot,
      downloadBlob,
      generateBOM,
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
        target.type === 'current' && selectedFile?.format === 'usd' && sidebarTab !== 'workspace';

      if (config.format === 'usd') {
        return executeUsdExport({
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
        });
      }

      if (
        config.format === 'urdf' &&
        target.type === 'current' &&
        sidebarTab === 'workspace' &&
        assemblyState
      ) {
        assertAssemblyUrdfExportSupported(assemblyState);
      }

      const disconnectedWorkspaceUrdfAction = resolveDisconnectedWorkspaceUrdfAction(
        target,
        config,
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
          : resolveExportContext(target);
      if (!exportContext) {
        if (requiresResolvedUsdContext) {
          throw new Error(t.usdExportUnavailable);
        }
        throw new Error(t.exportFailedParse);
      }

      const { robot, exportName, extraMeshFiles } = exportContext;
      const assetPackagingFailures: RobotAssetPackagingFailure[] = [];
      const zip = new JSZip();
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
        assertUrdfExportSupported(robot, exportName);
      }

      if (config.includeSkeleton) {
        addSkeletonToZip(robot, archiveRoot, exportName, skeletonUsesMeshes);
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

        const mjcfMeshExport = await prepareMjcfMeshExportAssets({
          robot,
          assets,
          extraMeshFiles,
          preferSharedMeshReuse,
        });

        reportProgress(3, t.exportProgressGeneratingFiles, t.exportProgressGeneratingMjcfDetail, {
          stageProgress: 0.85,
          indeterminate: false,
        });

        archiveRoot.file(
          `${exportName}.xml`,
          generateMujocoXML(robot, {
            meshdir,
            addFloatBase,
            includeActuators,
            actuatorType,
            meshPathOverrides: mjcfMeshExport.meshPathOverrides,
            visualMeshVariants: mjcfMeshExport.visualMeshVariants,
          }),
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

        const urdfContent = includeExtended
          ? generateURDF(
              robot,
              await buildGeneratedUrdfOptions(extraMeshFiles, { extended: true, useRelativePaths }),
            )
          : ((await buildUrdfSourceExportContent(target, exportName, {
              useRelativePaths,
              preferSourceVisualMeshes,
            })) ?? generateURDF(robot, generatedUrdfOptions));
        archiveRoot.file(`${exportName}.urdf`, urdfContent);
        if (includeBOM) {
          const hardwareFolder = archiveRoot.folder('hardware');
          hardwareFolder?.file('bom_list.csv', generateBOM(robot));
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
            robot,
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
          partial: false,
          warnings: [],
          issues: [],
        };
      } else if (config.format === 'sdf') {
        const { includeMeshes, compressSTL, stlQuality } = config.sdf;
        reportProgress(2, t.exportProgressGeneratingFiles, t.exportProgressGeneratingSdfDetail, {
          stageProgress: 0.85,
          indeterminate: false,
        });

        archiveRoot.file(
          'model.sdf',
          generateSDF(robot, {
            packageName: exportName,
          }),
        );
        archiveRoot.file('model.config', generateSdfModelConfig(robot.name?.trim() || exportName));
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
            robot,
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
          partial: false,
          warnings: [],
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
        const generatedUrdfOptions = await buildGeneratedUrdfOptions(extraMeshFiles, {
          useRelativePaths,
        });
        reportProgress(2, t.exportProgressGeneratingFiles, t.exportProgressGeneratingXacroDetail, {
          stageProgress: 0.85,
          indeterminate: false,
        });

        const xacroBaseUrdf =
          (await buildUrdfSourceExportContent(target, exportName, { useRelativePaths })) ??
          generateURDF(robot, generatedUrdfOptions);
        const xacroContent = injectGazeboTags(
          xacroBaseUrdf,
          robot,
          rosVersion,
          rosHardwareInterface,
        );
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
            robot,
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
          partial: false,
          warnings: [],
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
      addArchiveFilesToZip,
      addSkeletonToZip,
      currentUsdExportMode,
      createProgressReporter,
      createArchiveRoot,
      downloadBlob,
      availableFiles,
      assets,
      allFileContents,
      assertAssemblyUrdfExportSupported,
      assertUrdfExportSupported,
      getFileBaseName,
      generateZipBlobWithProgress,
      generateBOM,
      buildUrdfSourceExportContent,
      replaceTemplate,
      resolveLibraryRobotForExport,
      resolveDisconnectedWorkspaceUrdfAction,
      resolveExportContext,
      selectedFile,
      sidebarTab,
      t.exportFailedParse,
      t,
      throwForAssetPackagingFailures,
      trimProgressFileLabel,
    ],
  );

  // Export project as .usp
  const handleExportProject = useCallback(
    async (options: HandleProjectExportOptions = {}): Promise<ProjectExportExecutionResult> =>
      executeProjectExport({
        options,
        robotName,
        robotLinks,
        robotJoints,
        rootLinkId,
        robotMaterials,
        closedLoopConstraints,
        robotHistory,
        robotActivity,
        assemblyState,
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
      }),
    [
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
    generateBOM,
  };
}

export default useFileExport;
