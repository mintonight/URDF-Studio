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
  // 上次建立基线时的 preview snapshot，用于判断 source 是否发生变化。
  const lastPreviewSnapshotRef = useRef<string | null>(null);

  const usesPreviewSnapshotBaseline = Boolean(selectedFile && selectedFile.format !== 'xacro');
  const isSelectedUrdfSource = selectedFile?.format === 'urdf';
  const isSelectedXacroSource = selectedFile?.format === 'xacro';
  const isSelectedSdfSource = selectedFile?.format === 'sdf';

  useEffect(() => {
    if (shouldRenderAssembly || !selectedFile) {
      sourceBaselineRef.current = { fileName: null, snapshot: null };
      lastPreviewSnapshotRef.current = null;
      return;
    }
  }, [selectedFile, shouldRenderAssembly]);

  useEffect(() => {
    if (shouldRenderAssembly || !selectedFile || !usesPreviewSnapshotBaseline) {
      return;
    }

    // 只在 source 解析 snapshot 首次 ready（或 source 发生变化）时建立一次基线，
    // 把「当时的 model snapshot」记为参照点。之后 model 因属性面板编辑而变化时，
    // 不再覆盖基线，hasSourceStoreEdits 才能检测到改动。
    //
    // 不再要求 selectedFilePreviewSourceSnapshot === currentRobotSourceSnapshot：
    // source 解析结果与 store model 之间始终存在细微解析差异（数值精度、默认值补全等），
    // 严格相等几乎永不成立，会导致基线从不记录、hasSourceStoreEdits 永远为 false，
    // 进而属性面板对质量/惯量等字段的编辑无法反映到源码视图。
    if (selectedFilePreviewSourceSnapshotStatus !== 'ready') {
      return;
    }

    if (lastPreviewSnapshotRef.current === selectedFilePreviewSourceSnapshot) {
      return;
    }

    lastPreviewSnapshotRef.current = selectedFilePreviewSourceSnapshot;
    sourceBaselineRef.current = {
      fileName: selectedFile.name,
      snapshot: currentRobotSourceSnapshot,
    };
  }, [
    currentRobotSourceSnapshot,
    selectedFile,
    selectedFilePreviewSourceSnapshot,
    selectedFilePreviewSourceSnapshotStatus,
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
