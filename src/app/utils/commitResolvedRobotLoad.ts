import { unstable_batchedUpdates } from 'react-dom';
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { isAssetLibraryOnlyFormat } from '@/shared/utils/robotFileSupport';
import { resolveAppModeAfterRobotContentChange } from './contentChangeAppMode';
import type { AppMode, RobotData, RobotFile } from '@/types';

type CommitResolvedRobotLoadResult = Extract<
  RobotImportResult,
  { status: 'ready' | 'needs_hydration' }
>;

interface CommitResolvedRobotLoadArgs {
  currentAppMode: AppMode;
  file: RobotFile;
  importResult: CommitResolvedRobotLoadResult;
  markRobotBaselineSaved: () => void;
  onViewerReload?: () => void;
  reloadViewer?: boolean;
  setAppMode: (mode: AppMode) => void;
  setOriginalFileFormat: (
    format: Extract<RobotFile['format'], 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf'> | null,
  ) => void;
  setOriginalUrdfContent: (content: string | null) => void;
  setRobot: (robot: RobotData, options?: { resetHistory?: boolean; label?: string }) => void;
  setSelectedFile: (file: RobotFile) => void;
  setSelection: (selection: { type: null; id: null }) => void;
  setSidebarTab?: (tab: 'structure' | 'workspace') => void;
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

export function commitResolvedRobotLoad({
  currentAppMode,
  file,
  importResult,
  markRobotBaselineSaved,
  onViewerReload,
  reloadViewer = true,
  setAppMode,
  setOriginalFileFormat,
  setOriginalUrdfContent,
  setRobot,
  setSelectedFile,
  setSelection,
  setSidebarTab,
}: CommitResolvedRobotLoadArgs): void {
  const nextAppMode = resolveAppModeAfterRobotContentChange(currentAppMode);
  const nextOriginalFileFormat = resolveCommittedOriginalFileFormat(file);
  const nextOriginalSourceContent = resolveCommittedOriginalSourceContent(file, importResult);

  unstable_batchedUpdates(() => {
    if (importResult.status === 'ready') {
      setRobot(importResult.robotData, {
        resetHistory: true,
        label: file.format === 'usd' ? 'Load USD stage' : 'Load imported robot',
      });
      markRobotBaselineSaved();
    }

    setSelectedFile(file);
    setOriginalUrdfContent(nextOriginalSourceContent);
    setOriginalFileFormat(nextOriginalFileFormat);
    setSidebarTab?.('structure');
    setSelection({ type: null, id: null });

    if (reloadViewer) {
      onViewerReload?.();
    }

    if (nextAppMode !== currentAppMode) {
      setAppMode(nextAppMode);
    }
  });
}
