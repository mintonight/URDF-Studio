import { useEffect, useRef } from 'react';
import type { AssemblyState, RobotFile } from '@/types';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';

interface UseWorkspaceAssemblyRenderFailureNoticeLabels {
  workspaceAssemblyRenderFailedMergedData: string;
  workspaceAssemblyRenderFailedViewerData: string;
}

interface UseWorkspaceAssemblyRenderFailureNoticeOptions {
  assemblyRevision: number;
  assemblyState: AssemblyState | null;
  labels: UseWorkspaceAssemblyRenderFailureNoticeLabels;
  selectedFile: RobotFile | null;
  shouldRenderAssembly: boolean;
  workspaceAssemblyRenderFailureReason: string | null;
}

export function useWorkspaceAssemblyRenderFailureNotice({
  assemblyRevision,
  assemblyState,
  labels,
  selectedFile,
  shouldRenderAssembly,
  workspaceAssemblyRenderFailureReason,
}: UseWorkspaceAssemblyRenderFailureNoticeOptions) {
  const workspaceAssemblyRenderFailureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldRenderAssembly || !workspaceAssemblyRenderFailureReason) {
      workspaceAssemblyRenderFailureRef.current = null;
      return;
    }

    if (workspaceAssemblyRenderFailureRef.current === workspaceAssemblyRenderFailureReason) {
      return;
    }

    workspaceAssemblyRenderFailureRef.current = workspaceAssemblyRenderFailureReason;

    const message =
      workspaceAssemblyRenderFailureReason === 'missing-viewer-merged-robot-data'
        ? labels.workspaceAssemblyRenderFailedViewerData
        : labels.workspaceAssemblyRenderFailedMergedData;

    scheduleFailFastInDev(
      '[Workspace] Failed to build renderable assembly robot data',
      new Error(
        `${message} reason=${workspaceAssemblyRenderFailureReason}; assemblyRevision=${assemblyRevision}; componentCount=${assemblyState ? Object.keys(assemblyState.components).length : 0}; selectedFile=${selectedFile?.name ?? '<none>'}`,
      ),
    );
  }, [
    assemblyRevision,
    assemblyState,
    labels.workspaceAssemblyRenderFailedMergedData,
    labels.workspaceAssemblyRenderFailedViewerData,
    selectedFile,
    shouldRenderAssembly,
    workspaceAssemblyRenderFailureReason,
  ]);
}
