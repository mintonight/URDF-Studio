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
  preserveAssemblyState?: boolean;
  reloadViewer?: boolean;
  setAppMode: (mode: AppMode) => void;
  setAssembly?: (state: AssemblyState | null) => void;
  setOriginalFileFormat: (
    format: Extract<RobotFile['format'], 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf'> | null,
  ) => void;
  setOriginalUrdfContent: (content: string) => void;
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
): string {
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
  preserveAssemblyState = false,
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
  const shouldSeedAssembly =
    importResult.status === 'ready' && Boolean(setAssembly) && !preserveAssemblyState;
  const seededAssembly = shouldSeedAssembly
    ? autoSeedAssembly(importResult.robotData, file.name, {
        sourceFile: file,
        availableFiles,
        assets,
        allFileContents,
      })
    : null;
  const shouldClearAssembly =
    importResult.status !== 'ready' &&
    Boolean(setAssembly && currentAssemblyState && !preserveAssemblyState);

  unstable_batchedUpdates(() => {
    if (importResult.status === 'ready') {
      setRobot(importResult.robotData, {
        resetHistory: true,
        label: file.format === 'usd' ? 'Load USD stage' : 'Load imported robot',
      });
      markRobotBaselineSaved();
    }

    if (seededAssembly || shouldClearAssembly) {
      setAssembly?.(seededAssembly);
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
