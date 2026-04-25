import { useCallback, type MutableRefObject } from 'react';

import { analyzeAssemblyConnectivity } from '@/core/robot';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import { createRobotSemanticSnapshot } from '@/shared/utils/robot/semanticSnapshot';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import { markUnsavedChangesBaselineSaved } from '@/app/utils/unsavedChangesBaseline';
import {
  getCurrentUsdViewerSceneSnapshot,
  prepareUsdExportCacheFromSnapshot,
} from '@/features/editor';
import {
  createGeneratedWorkspaceUrdfFile,
  isGeneratedWorkspaceUrdfFileName,
  resolveWorkspaceGeneratedUrdfRobotData,
  shouldPromptGenerateWorkspaceUrdfOnStructureSwitch,
  shouldReseedSingleComponentAssemblyFromActiveFile,
} from './workspaceSourceSyncUtils';
import { buildGeneratedWorkspaceFileState } from './workspaceGeneratedSourceState';
import { useAssemblyStore, useAssetsStore, useUIStore } from '@/store';
import type { RobotData, RobotFile, UrdfJoint, UrdfLink, UsdPreparedExportCache } from '@/types';

export interface ProModeRoundtripSession {
  baselineSnapshot: string;
  generatedFileName: string | null;
}

interface ResolveUsdAssemblySeedRobotDataOptions {
  activeFile: RobotFile | null;
  selectedFile: RobotFile | null;
  currentRobotData: RobotData | null;
  getUsdPreparedExportCache: (
    fileName: string,
  ) => { robotData?: RobotData | null } | null | undefined;
  getCurrentSceneSnapshot?: typeof getCurrentUsdViewerSceneSnapshot;
  prepareExportCacheFromSnapshot?: typeof prepareUsdExportCacheFromSnapshot;
}

interface ResolveUsdAssemblySeedRobotDataResult {
  preResolvedRobotData: RobotData | null;
  preparedCache: UsdPreparedExportCache | null;
  requiresRobotReload: boolean;
}

function hasUsableRobotData(robotData: RobotData | null | undefined): robotData is RobotData {
  return Boolean(
    robotData?.rootLinkId &&
    robotData.links &&
    typeof robotData.links === 'object' &&
    Object.keys(robotData.links).length > 0,
  );
}

export function resolveUsdAssemblySeedRobotData({
  activeFile,
  selectedFile,
  currentRobotData,
  getUsdPreparedExportCache,
  getCurrentSceneSnapshot = getCurrentUsdViewerSceneSnapshot,
  prepareExportCacheFromSnapshot = prepareUsdExportCacheFromSnapshot,
}: ResolveUsdAssemblySeedRobotDataOptions): ResolveUsdAssemblySeedRobotDataResult {
  if (activeFile?.format !== 'usd') {
    return {
      preResolvedRobotData: null,
      preparedCache: null,
      requiresRobotReload: false,
    };
  }

  const cachedRobotData = getUsdPreparedExportCache(activeFile.name)?.robotData ?? null;
  if (hasUsableRobotData(cachedRobotData)) {
    return {
      preResolvedRobotData: cachedRobotData,
      preparedCache: null,
      requiresRobotReload: false,
    };
  }

  if (
    selectedFile?.format === 'usd' &&
    selectedFile.name === activeFile.name &&
    hasUsableRobotData(currentRobotData)
  ) {
    return {
      preResolvedRobotData: currentRobotData,
      preparedCache: null,
      requiresRobotReload: false,
    };
  }

  const fallbackSceneSnapshot = getCurrentSceneSnapshot({
    stageSourcePath: activeFile.name,
  });
  const preparedCache = fallbackSceneSnapshot
    ? prepareExportCacheFromSnapshot(fallbackSceneSnapshot, { fileName: activeFile.name })
    : null;

  if (hasUsableRobotData(preparedCache?.robotData ?? null)) {
    return {
      preResolvedRobotData: preparedCache?.robotData ?? null,
      preparedCache,
      requiresRobotReload: false,
    };
  }

  return {
    preResolvedRobotData: null,
    preparedCache: null,
    requiresRobotReload: true,
  };
}

interface UseWorkspaceModeTransitionsTranslations {
  generateWorkspaceUrdfDisconnected: string;
  generateWorkspaceUrdfUnavailable: string;
  generateWorkspaceUrdfSuccess: string;
  addedComponent: string;
}

interface UseWorkspaceModeTransitionsParams {
  previewFile: RobotFile | null;
  selectedFile: RobotFile | null;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  assets: Record<string, string>;
  getUsdPreparedExportCache: (
    fileName: string,
  ) => { robotData?: RobotData | null } | null | undefined;
  robotName: string;
  robotLinks: Record<string, UrdfLink>;
  robotJoints: Record<string, UrdfJoint>;
  rootLinkId: string;
  robotMaterials: RobotData['materials'];
  closedLoopConstraints: RobotData['closedLoopConstraints'];
  setRobot: (
    data: RobotData,
    options?: { resetHistory?: boolean; skipHistory?: boolean; label?: string },
  ) => void;
  setSelection: (selection: { type: null; id: null }) => void;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  t: UseWorkspaceModeTransitionsTranslations;
  handleClosePreview: () => void;
  prepareAssemblyComponentForInsert: (
    file: RobotFile,
    options?: {
      existingComponentIds?: Iterable<string>;
      existingComponentNames?: Iterable<string>;
      preResolvedRobotData?: RobotData | null;
    },
  ) => Promise<unknown>;
  activateInsertedAssemblyComponent: (component: {
    id: string;
    robot: { rootLinkId: string };
  }) => void;
  addComponent: (
    file: RobotFile,
    context?: {
      availableFiles?: RobotFile[];
      assets?: Record<string, string>;
      allFileContents?: Record<string, string>;
      preResolvedRobotData?: RobotData | null;
      queueAutoGround?: boolean;
      preparedComponent?: unknown;
    },
  ) => { id: string; name: string; robot: { rootLinkId: string } } | null;
  initAssembly: (name: string) => void;
  onLoadRobot: (file: RobotFile) => void;
  pendingUsdAssemblyFileRef: MutableRefObject<RobotFile | null>;
  proModeRoundtripSessionRef: MutableRefObject<ProModeRoundtripSession | null>;
}

export function useWorkspaceModeTransitions({
  previewFile,
  selectedFile,
  availableFiles,
  allFileContents,
  assets,
  getUsdPreparedExportCache,
  robotName,
  robotLinks,
  robotJoints,
  rootLinkId,
  robotMaterials,
  closedLoopConstraints,
  setRobot,
  setSelection,
  showToast,
  t,
  handleClosePreview,
  prepareAssemblyComponentForInsert,
  activateInsertedAssemblyComponent,
  addComponent,
  initAssembly,
  onLoadRobot,
  pendingUsdAssemblyFileRef,
  proModeRoundtripSessionRef,
}: UseWorkspaceModeTransitionsParams) {
  const updateProModeRoundtripBaseline = useCallback(
    (generatedFileName: string | null) => {
      const nextAssemblyState = useAssemblyStore.getState().assemblyState;
      const mergedRobotData = nextAssemblyState
        ? buildExportableAssemblyRobotData(nextAssemblyState)
        : null;
      if (!mergedRobotData) {
        proModeRoundtripSessionRef.current = null;
        return false;
      }

      proModeRoundtripSessionRef.current = {
        baselineSnapshot: createRobotSemanticSnapshot({
          ...mergedRobotData,
          selection: { type: null, id: null },
        }),
        generatedFileName,
      };

      return true;
    },
    [proModeRoundtripSessionRef],
  );

  const switchTreeEditorToStructure = useCallback(() => {
    handleClosePreview();
    useUIStore.getState().setSidebarTab('structure');
    proModeRoundtripSessionRef.current = null;
    return 'switched' as const;
  }, [handleClosePreview, proModeRoundtripSessionRef]);

  const generateWorkspaceUrdfFromProMode = useCallback(
    (options: { switchToStructure?: boolean } = {}) => {
      const { switchToStructure = false } = options;
      const assemblyStoreState = useAssemblyStore.getState();
      const connectivity = analyzeAssemblyConnectivity(assemblyStoreState.assemblyState);
      const activeFile = previewFile ?? selectedFile;

      if (connectivity.hasDisconnectedComponents) {
        showToast(t.generateWorkspaceUrdfDisconnected, 'info');
        return false;
      }

      const mergedRobotData = resolveWorkspaceGeneratedUrdfRobotData({
        assemblyState: assemblyStoreState.assemblyState,
        activeFile,
        availableFiles,
        assets,
        allFileContents,
        usdRobotData:
          activeFile?.format === 'usd'
            ? (getUsdPreparedExportCache(activeFile.name)?.robotData ?? null)
            : null,
      });

      if (!mergedRobotData) {
        showToast(t.generateWorkspaceUrdfUnavailable, 'info');
        return false;
      }

      const assetsState = useAssetsStore.getState();
      const session = proModeRoundtripSessionRef.current;
      const { file, robot, snapshot } = createGeneratedWorkspaceUrdfFile({
        assemblyName:
          assemblyStoreState.assemblyState?.name ||
          mergedRobotData.name ||
          robotName ||
          'workspace',
        mergedRobotData,
        availableFiles: assetsState.availableFiles,
        preferredFileName: session?.generatedFileName,
      });

      const generatedState = buildGeneratedWorkspaceFileState({
        availableFiles: assetsState.availableFiles,
        allFileContents: assetsState.allFileContents,
        file,
      });

      assetsState.setAvailableFiles(generatedState.nextAvailableFiles);
      assetsState.setAllFileContents(generatedState.nextAllFileContents);
      assetsState.setSelectedFile(generatedState.nextSelectedFile);
      assetsState.setOriginalUrdfContent(file.content);
      assetsState.setOriginalFileFormat('urdf');
      assetsState.setDocumentLoadState({
        status: 'ready',
        fileName: file.name,
        format: 'urdf',
        error: null,
        phase: null,
        message: null,
        progressPercent: 100,
        loadedCount: null,
        totalCount: null,
      });

      setRobot(robot, {
        resetHistory: true,
        label: 'Generate workspace URDF',
      });
      setSelection({ type: null, id: null });
      handleClosePreview();

      if (switchToStructure) {
        useUIStore.getState().setSidebarTab('structure');
        proModeRoundtripSessionRef.current = null;
      } else {
        proModeRoundtripSessionRef.current = {
          baselineSnapshot: snapshot,
          generatedFileName: file.name,
        };
      }

      showToast(
        t.generateWorkspaceUrdfSuccess.replace('{name}', file.name.split('/').pop() || file.name),
        'success',
      );
      return true;
    },
    [
      allFileContents,
      assets,
      availableFiles,
      getUsdPreparedExportCache,
      handleClosePreview,
      previewFile,
      proModeRoundtripSessionRef,
      robotName,
      selectedFile,
      setRobot,
      setSelection,
      showToast,
      t.generateWorkspaceUrdfDisconnected,
      t.generateWorkspaceUrdfSuccess,
      t.generateWorkspaceUrdfUnavailable,
    ],
  );

  const handleRequestSwitchTreeEditorToStructure = useCallback(
    (intent: 'direct' | 'generate' | 'skip-generate') => {
      if (useUIStore.getState().sidebarTab !== 'workspace') {
        return switchTreeEditorToStructure();
      }

      if (intent === 'generate') {
        return generateWorkspaceUrdfFromProMode({ switchToStructure: true })
          ? 'switched'
          : 'blocked';
      }

      const session = proModeRoundtripSessionRef.current;
      if (!session) {
        return switchTreeEditorToStructure();
      }

      const activeWorkspaceSourceFile = previewFile ?? selectedFile;
      const currentWorkspaceSourceSnapshot = createRobotSemanticSnapshot({
        name: robotName,
        links: robotLinks,
        joints: robotJoints,
        rootLinkId,
        materials: robotMaterials,
        closedLoopConstraints,
      });
      const latestAssemblyState = useAssemblyStore.getState().assemblyState;
      if (intent === 'skip-generate') {
        return switchTreeEditorToStructure();
      }

      return shouldPromptGenerateWorkspaceUrdfOnStructureSwitch({
        assemblyState: latestAssemblyState,
        activeFile: activeWorkspaceSourceFile,
        sourceSnapshot: currentWorkspaceSourceSnapshot,
        sourceRobotData:
          activeWorkspaceSourceFile?.format === 'usd'
            ? (getUsdPreparedExportCache(activeWorkspaceSourceFile.name)?.robotData ?? null)
            : null,
        baselineSnapshot: session.baselineSnapshot,
      })
        ? ('needs-generate-confirm' as const)
        : switchTreeEditorToStructure();
    },
    [
      closedLoopConstraints,
      generateWorkspaceUrdfFromProMode,
      getUsdPreparedExportCache,
      previewFile,
      proModeRoundtripSessionRef,
      robotJoints,
      robotLinks,
      robotMaterials,
      robotName,
      rootLinkId,
      selectedFile,
      switchTreeEditorToStructure,
    ],
  );

  const handleSwitchTreeEditorToProMode = useCallback(() => {
    const activeFile = previewFile ?? selectedFile;
    const currentAssemblyState = useAssemblyStore.getState().assemblyState;
    const activeGeneratedFileName = isGeneratedWorkspaceUrdfFileName(activeFile?.name)
      ? (activeFile?.name ?? null)
      : null;

    const shouldReseedAssembly = shouldReseedSingleComponentAssemblyFromActiveFile({
      assemblyState: currentAssemblyState,
      activeFile,
    });

    if (!shouldReseedAssembly) {
      updateProModeRoundtripBaseline(activeGeneratedFileName);
      return;
    }

    proModeRoundtripSessionRef.current = null;

    if (!activeFile) {
      return;
    }

    if (!currentAssemblyState || Object.keys(currentAssemblyState.components).length === 0) {
      initAssembly(currentAssemblyState?.name || robotName || 'assembly');
    }

    const immediateComponent = addComponent(activeFile, {
      availableFiles,
      assets,
      allFileContents,
      preResolvedRobotData:
        activeFile.format === 'usd'
          ? (getUsdPreparedExportCache(activeFile.name)?.robotData ?? null)
          : null,
      queueAutoGround: false,
    });

    if (!immediateComponent) {
      scheduleFailFastInDev(
        'AppLayout:handleSwitchTreeEditorToProMode',
        new Error(`Failed to immediately seed Professional mode with "${activeFile.name}".`),
      );
      return;
    }

    activateInsertedAssemblyComponent(immediateComponent);
    updateProModeRoundtripBaseline(activeGeneratedFileName);
    markUnsavedChangesBaselineSaved('assembly');
  }, [
    activateInsertedAssemblyComponent,
    addComponent,
    allFileContents,
    assets,
    availableFiles,
    getUsdPreparedExportCache,
    initAssembly,
    previewFile,
    proModeRoundtripSessionRef,
    robotName,
    selectedFile,
    updateProModeRoundtripBaseline,
  ]);

  return {
    updateProModeRoundtripBaseline,
    handleRequestSwitchTreeEditorToStructure,
    handleSwitchTreeEditorToProMode,
  };
}
