import { useEffect, useMemo, useRef } from 'react';
import type { RobotFile } from '@/types';
import type { SourceSnapshotStatus } from './useSelectedSourceSnapshots';

interface UseSourceEditBaselineParams {
  shouldRenderAssembly: boolean;
  selectedFile: RobotFile | null;
  currentRobotSourceSnapshot: string;
  selectedFilePreviewSourceSnapshot: string | null;
  selectedXacroBaselineSourceSnapshot: string | null;
  selectedFilePreviewSourceSnapshotStatus: SourceSnapshotStatus;
  selectedXacroBaselineSourceSnapshotStatus: SourceSnapshotStatus;
}

export interface SourceEditBaselineState {
  hasSourceStoreEdits: boolean;
  isSelectedUrdfSource: boolean;
  isSelectedXacroSource: boolean;
  isSelectedSdfSource: boolean;
}

export function useSourceEditBaseline({
  shouldRenderAssembly,
  selectedFile,
  currentRobotSourceSnapshot,
  selectedFilePreviewSourceSnapshot,
  selectedXacroBaselineSourceSnapshot,
  selectedFilePreviewSourceSnapshotStatus,
  selectedXacroBaselineSourceSnapshotStatus,
}: UseSourceEditBaselineParams): SourceEditBaselineState {
  const sourceBaselineRef = useRef<{ fileName: string | null; snapshot: string | null }>({
    fileName: null,
    snapshot: null,
  });

  const usesPreviewSnapshotBaseline = Boolean(selectedFile && selectedFile.format !== 'xacro');
  const isSelectedUrdfSource = selectedFile?.format === 'urdf';
  const isSelectedXacroSource = selectedFile?.format === 'xacro';
  const isSelectedSdfSource = selectedFile?.format === 'sdf';

  useEffect(() => {
    if (shouldRenderAssembly || !selectedFile) {
      sourceBaselineRef.current = { fileName: null, snapshot: null };
      return;
    }
  }, [selectedFile, shouldRenderAssembly]);

  useEffect(() => {
    if (shouldRenderAssembly || !selectedFile || !usesPreviewSnapshotBaseline) {
      return;
    }

    if (selectedFilePreviewSourceSnapshot !== currentRobotSourceSnapshot) {
      return;
    }

    if (
      sourceBaselineRef.current.fileName === selectedFile.name &&
      sourceBaselineRef.current.snapshot === currentRobotSourceSnapshot
    ) {
      return;
    }

    sourceBaselineRef.current = {
      fileName: selectedFile.name,
      snapshot: currentRobotSourceSnapshot,
    };
  }, [
    currentRobotSourceSnapshot,
    selectedFile,
    selectedFilePreviewSourceSnapshot,
    shouldRenderAssembly,
    usesPreviewSnapshotBaseline,
  ]);

  const hasSourceStoreEdits = useMemo(() => {
    if (shouldRenderAssembly || !selectedFile) {
      return false;
    }

    if (isSelectedXacroSource && selectedXacroBaselineSourceSnapshotStatus === 'failed') {
      return true;
    }

    if (usesPreviewSnapshotBaseline && selectedFilePreviewSourceSnapshotStatus === 'failed') {
      return true;
    }

    const baseline = sourceBaselineRef.current;
    if (!baseline.fileName || baseline.fileName !== selectedFile.name) {
      return false;
    }

    return baseline.snapshot !== currentRobotSourceSnapshot;
  }, [
    currentRobotSourceSnapshot,
    isSelectedXacroSource,
    selectedFile,
    selectedFilePreviewSourceSnapshotStatus,
    selectedXacroBaselineSourceSnapshotStatus,
    shouldRenderAssembly,
    usesPreviewSnapshotBaseline,
  ]);

  return {
    hasSourceStoreEdits,
    isSelectedUrdfSource,
    isSelectedXacroSource,
    isSelectedSdfSource,
  };
}
