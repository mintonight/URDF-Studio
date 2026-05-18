import { unstable_batchedUpdates } from 'react-dom';
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { isAssetLibraryOnlyFormat } from '@/shared/utils/robotFileSupport';
import { resolveAppModeAfterRobotContentChange } from './contentChangeAppMode';
import { autoSeedAssembly } from './autoSeedAssembly';
import type { AppMode, AssemblyState, RobotData, RobotFile } from '@/types';

type CommitResolvedRobotLoadResult = Extract<
  RobotImportResult,
  { status: 'ready' | 'needs_hydration' }
>;

interface CommitResolvedRobotLoadArgs {
  assets?: Record<string, string>;
  allFileContents?: Record<string, string>;
  availableFiles?: RobotFile[];
  currentAssemblyState?: AssemblyState | null;
  currentAppMode: AppMode;
  file: RobotFile;
  importResult: CommitResolvedRobotLoadResult;
  markRobotBaselineSaved: () => void;
  onViewerReload?: () => void;
  reloadViewer?: boolean;
  setAppMode: (mode: AppMode) => void;
  setAssembly?: (state: AssemblyState | null) => void;
  setOriginalFileFormat: (
    format: Extract<RobotFile['format'], 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf'> | null,
  ) => void;
  setOriginalUrdfContent: (content: string | null) => void;
  setRobot: (robot: RobotData, options?: { resetHistory?: boolean; label?: string }) => void;
  setSelectedFile: (file: RobotFile) => void;
  setSelection: (selection: { type: null; id: null }) => void;
}

function resolveCommittedOriginalFileFormat(
  file: RobotFile,
): Extract<RobotFile['format'], 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf'> | null {
  return file.format === 'urdf' ||
    file.format === 'mjcf' ||
    file.format === 'usd' ||
    file.format === 'xacro' ||
    file.format === 'sdf'
    ? file.format
    : null;
}

function resolveCommittedOriginalSourceContent(
  file: RobotFile,
  importResult: CommitResolvedRobotLoadResult,
): string | null {
  if (isAssetLibraryOnlyFormat(file.format)) {
    return '';
  }

  if (
    file.format === 'xacro' &&
    importResult.status === 'ready' &&
    importResult.resolvedUrdfContent
  ) {
    return importResult.resolvedUrdfContent;
  }

  return file.content;
}

function shouldPreserveExistingAssembly(assemblyState: AssemblyState | null | undefined): boolean {
  if (!assemblyState) {
    return false;
  }

  return (
    Object.keys(assemblyState.components).length > 1 ||
    Object.keys(assemblyState.bridges).length > 0
  );
}

export function commitResolvedRobotLoad({
  assets,
  allFileContents,
  availableFiles,
  currentAssemblyState,
  currentAppMode,
  file,
  importResult,
  markRobotBaselineSaved,
  onViewerReload,
  reloadViewer = true,
  setAppMode,
  setAssembly,
  setOriginalFileFormat,
  setOriginalUrdfContent,
  setRobot,
  setSelectedFile,
  setSelection,
}: CommitResolvedRobotLoadArgs): void {
  const nextAppMode = resolveAppModeAfterRobotContentChange(currentAppMode);
  const nextOriginalFileFormat = resolveCommittedOriginalFileFormat(file);
  const nextOriginalSourceContent = resolveCommittedOriginalSourceContent(file, importResult);
  const canSeedAssembly =
    importResult.status === 'ready' &&
    Boolean(setAssembly) &&
    !shouldPreserveExistingAssembly(currentAssemblyState);
  const seededAssembly = canSeedAssembly
    ? autoSeedAssembly(importResult.robotData, file.name, {
        sourceFile: file,
        availableFiles,
        assets,
        allFileContents,
      })
    : null;

  unstable_batchedUpdates(() => {
    if (importResult.status === 'ready') {
      const committedRobotData =
        seededAssembly && seededAssembly.name !== importResult.robotData.name
          ? { ...importResult.robotData, name: seededAssembly.name }
          : importResult.robotData;

      setRobot(committedRobotData, {
        resetHistory: true,
        label: file.format === 'usd' ? 'Load USD stage' : 'Load imported robot',
      });
      markRobotBaselineSaved();

      if (seededAssembly) {
        setAssembly?.(seededAssembly);
      }
    }

    setSelectedFile(file);
    setOriginalUrdfContent(nextOriginalSourceContent);
    setOriginalFileFormat(nextOriginalFileFormat);
    setSelection({ type: null, id: null });

    if (reloadViewer) {
      onViewerReload?.();
    }

    if (nextAppMode !== currentAppMode) {
      setAppMode(nextAppMode);
    }
  });
}
