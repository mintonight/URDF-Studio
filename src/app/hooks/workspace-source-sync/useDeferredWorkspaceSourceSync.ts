import { startTransition, useCallback, useEffect, useRef } from 'react';

import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import type {
  GenerateEditableRobotSourceFormat,
  GenerateEditableRobotSourceOptions,
} from '@/app/utils/generateEditableRobotSource';
import type { AssemblyState, RobotFile, RobotState } from '@/types';

import { generateEditableRobotSourceWithWorker } from '../robotImportWorkerBridge';
import { createRobotSourceSnapshot } from '../workspaceSourceSyncUtils';
import { getGeneratedSourceFromCache, storeGeneratedSourceInCache } from './sourceGenerationCache';

interface DeferredWorkspaceSourceSyncTask {
  cacheKey: string;
  fileName: string;
  options: GenerateEditableRobotSourceOptions;
}

interface UseDeferredWorkspaceSourceSyncParams {
  shouldRenderAssembly: boolean;
  assemblyState: AssemblyState | null;
  isCodeViewerOpen: boolean;
  selectedFile: RobotFile | null;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  generatedSourceCache: Map<string, string>;
  syncTextFileContent: (fileName: string, content: string) => void;
  setSelectedFile: (file: RobotFile | null) => void;
  setAvailableFiles: (files: RobotFile[]) => void;
  setAllFileContents: (contents: Record<string, string>) => void;
}

function toDeferredEditableSourceFormat(
  format: RobotFile['format'],
): GenerateEditableRobotSourceFormat | null {
  switch (format) {
    case 'urdf':
    case 'mjcf':
    case 'sdf':
      return format;
    default:
      return null;
  }
}

function buildDeferredWorkspaceSourceSyncTask(
  sourceFile: RobotFile,
  sourceRobotState: RobotState,
): DeferredWorkspaceSourceSyncTask | null {
  const format = toDeferredEditableSourceFormat(sourceFile.format);
  if (!format) {
    return null;
  }

  const sourceSnapshot = createRobotSourceSnapshot(sourceRobotState);

  return {
    fileName: sourceFile.name,
    cacheKey: `component-source:${format}:${sourceFile.name}:${sourceSnapshot}`,
    options: {
      format,
      robotState: sourceRobotState,
      includeHardware: 'auto',
      preserveMeshPaths: format === 'xacro',
    },
  };
}

export function useDeferredWorkspaceSourceSync({
  shouldRenderAssembly,
  assemblyState,
  isCodeViewerOpen,
  selectedFile,
  availableFiles,
  allFileContents,
  generatedSourceCache,
  syncTextFileContent,
  setSelectedFile,
  setAvailableFiles,
  setAllFileContents,
}: UseDeferredWorkspaceSourceSyncParams): void {
  const deferredWorkspaceSourceSyncIdleRef = useRef<number | null>(null);
  const deferredWorkspaceSourceSyncTimeoutRef = useRef<number | null>(null);
  const deferredWorkspaceSourceSyncRequestRef = useRef(0);

  const cancelDeferredWorkspaceSourceSync = useCallback(() => {
    deferredWorkspaceSourceSyncRequestRef.current += 1;
    if (
      deferredWorkspaceSourceSyncIdleRef.current !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelIdleCallback === 'function'
    ) {
      window.cancelIdleCallback(deferredWorkspaceSourceSyncIdleRef.current);
    }
    if (deferredWorkspaceSourceSyncTimeoutRef.current !== null) {
      window.clearTimeout(deferredWorkspaceSourceSyncTimeoutRef.current);
    }
    deferredWorkspaceSourceSyncIdleRef.current = null;
    deferredWorkspaceSourceSyncTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    if (!shouldRenderAssembly || !assemblyState) {
      cancelDeferredWorkspaceSourceSync();
      return;
    }

    cancelDeferredWorkspaceSourceSync();
    const immediateSourceFileName =
      isCodeViewerOpen &&
      selectedFile &&
      toDeferredEditableSourceFormat(selectedFile.format) !== null
        ? selectedFile.name
        : null;
    const deferredSourceSyncTasks: DeferredWorkspaceSourceSyncTask[] = [];
    let immediateSourceSyncTask: DeferredWorkspaceSourceSyncTask | null = null;

    Object.values(assemblyState.components).forEach((component) => {
      const sourceFile = availableFiles.find((file) => file.name === component.sourceFile);
      if (!sourceFile) {
        return;
      }

      const sourceSyncTask = buildDeferredWorkspaceSourceSyncTask(sourceFile, {
        ...component.robot,
        selection: { type: null, id: null },
      });
      if (!sourceSyncTask) {
        return;
      }

      if (sourceFile.name === immediateSourceFileName) {
        immediateSourceSyncTask = sourceSyncTask;
        return;
      }

      deferredSourceSyncTasks.push(sourceSyncTask);
    });

    if (!immediateSourceSyncTask && deferredSourceSyncTasks.length === 0) {
      return;
    }

    const requestId = ++deferredWorkspaceSourceSyncRequestRef.current;
    const resolveGeneratedSource = async (
      task: DeferredWorkspaceSourceSyncTask,
    ): Promise<[string, string]> => {
      const cachedContent = getGeneratedSourceFromCache(generatedSourceCache, task.cacheKey);
      if (cachedContent !== null) {
        return [task.fileName, cachedContent];
      }

      const generatedContent = await generateEditableRobotSourceWithWorker(task.options);
      storeGeneratedSourceInCache(generatedSourceCache, task.cacheKey, generatedContent);
      return [task.fileName, generatedContent];
    };

    if (immediateSourceSyncTask) {
      void resolveGeneratedSource(immediateSourceSyncTask)
        .then(([fileName, content]) => {
          if (deferredWorkspaceSourceSyncRequestRef.current !== requestId) {
            return;
          }

          syncTextFileContent(fileName, content);
        })
        .catch((error) => {
          if (deferredWorkspaceSourceSyncRequestRef.current !== requestId) {
            return;
          }

          scheduleFailFastInDev(
            'useDeferredWorkspaceSourceSync:immediateSourceSync',
            new Error(
              `Failed to generate editable source for workspace component "${immediateSourceSyncTask?.fileName}".`,
              { cause: error },
            ),
          );
        });
    }

    if (deferredSourceSyncTasks.length === 0) {
      return cancelDeferredWorkspaceSourceSync;
    }

    const flushDeferredWorkspaceSourceSync = () => {
      deferredWorkspaceSourceSyncIdleRef.current = null;
      deferredWorkspaceSourceSyncTimeoutRef.current = null;

      if (deferredWorkspaceSourceSyncRequestRef.current !== requestId) {
        return;
      }

      void Promise.all(deferredSourceSyncTasks.map(resolveGeneratedSource))
        .then((generatedComponentSources) => {
          if (deferredWorkspaceSourceSyncRequestRef.current !== requestId) {
            return;
          }

          startTransition(() => {
            if (deferredWorkspaceSourceSyncRequestRef.current !== requestId) {
              return;
            }

            let nextAvailableFiles: RobotFile[] | null = null;
            let nextAllFileContents: Record<string, string> | null = null;
            let nextSelectedFile: RobotFile | null = null;

            for (const [fileName, content] of generatedComponentSources) {
              if (selectedFile?.name === fileName && selectedFile.content !== content) {
                nextSelectedFile = {
                  ...selectedFile,
                  content,
                };
              }

              if (
                availableFiles.some((file) => file.name === fileName && file.content !== content)
              ) {
                const baseFiles = nextAvailableFiles ?? availableFiles;
                nextAvailableFiles = baseFiles.map((file) =>
                  file.name === fileName ? { ...file, content } : file,
                );
              }

              if (allFileContents[fileName] !== content) {
                nextAllFileContents = {
                  ...(nextAllFileContents ?? allFileContents),
                  [fileName]: content,
                };
              }
            }

            if (nextSelectedFile) {
              setSelectedFile(nextSelectedFile);
            }

            if (nextAvailableFiles) {
              setAvailableFiles(nextAvailableFiles);
            }

            if (nextAllFileContents) {
              setAllFileContents(nextAllFileContents);
            }
          });
        })
        .catch((error) => {
          if (deferredWorkspaceSourceSyncRequestRef.current !== requestId) {
            return;
          }

          scheduleFailFastInDev(
            'useDeferredWorkspaceSourceSync:deferredSourceSync',
            new Error('Failed to generate deferred workspace editable source.', {
              cause: error,
            }),
          );
        });
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      deferredWorkspaceSourceSyncIdleRef.current = window.requestIdleCallback(
        flushDeferredWorkspaceSourceSync,
        { timeout: 250 },
      );
      return cancelDeferredWorkspaceSourceSync;
    }

    deferredWorkspaceSourceSyncTimeoutRef.current = window.setTimeout(
      flushDeferredWorkspaceSourceSync,
      16,
    );
    return cancelDeferredWorkspaceSourceSync;
  }, [
    allFileContents,
    assemblyState,
    availableFiles,
    cancelDeferredWorkspaceSourceSync,
    generatedSourceCache,
    isCodeViewerOpen,
    selectedFile,
    setAllFileContents,
    setAvailableFiles,
    setSelectedFile,
    shouldRenderAssembly,
    syncTextFileContent,
  ]);

  useEffect(
    () => () => {
      cancelDeferredWorkspaceSourceSync();
    },
    [cancelDeferredWorkspaceSourceSync],
  );
}
