import { useCallback, useRef } from 'react';
import { generateURDF } from '@/core/parsers';
import { rewriteRobotMeshPathsForSource } from '@/core/parsers/meshPathUtils';
import { canGenerateUrdf } from '@/core/parsers/urdf/urdfExportSupport';
import type { RobotData, RobotFile, RobotState } from '@/types';
import type { SourceCodeEditorApplyRequest } from '@/features/code-editor/utils/sourceCodeEditorSession';
import { useAssetsStore, useRobotStore } from '@/store';
import { tryPatchRobotStateFromEditableSourceChange } from '@/app/utils/editableSourceIncrementalPatch';
import { parseEditableRobotSourceWithWorker } from './robotImportWorkerBridge';
import type { SourceCodeDocumentChangeTarget } from '@/app/utils/sourceCodeDocuments';

interface UseEditableSourceCodeApplyOptions {
  allFileContents: Record<string, string>;
  availableFiles: RobotFile[];
  selectedFile: RobotFile | null;
  setAllFileContents: (contents: Record<string, string>) => void;
  setAvailableFiles: (files: RobotFile[]) => void;
  setOriginalUrdfContent: (content: string | null) => void;
  setRobot: (
    data: RobotData,
    options?: { label?: string; resetHistory?: boolean; skipHistory?: boolean },
  ) => void;
  setSelectedFile: (file: RobotFile | null) => void;
}

interface CommitEditableSourceApplyOptions {
  newCode: string;
  sourceFile: Pick<RobotFile, 'format' | 'name'>;
  targetFileName: string;
  nextState: RobotState;
  syncSelectedEditableFileContent: (targetFileName: string, content: string) => void;
  setOriginalUrdfContent: (content: string | null) => void;
  setRobot: (
    data: RobotData,
    options?: { label?: string; resetHistory?: boolean; skipHistory?: boolean },
  ) => void;
}

export function commitEditableSourceApply({
  newCode,
  sourceFile,
  targetFileName,
  nextState,
  syncSelectedEditableFileContent,
  setOriginalUrdfContent,
  setRobot,
}: CommitEditableSourceApplyOptions): void {
  syncSelectedEditableFileContent(targetFileName, newCode);

  if (sourceFile.format === 'xacro') {
    setOriginalUrdfContent(
      canGenerateUrdf(nextState) ? generateURDF(nextState, { preserveMeshPaths: true }) : null,
    );
  }

  // Let the viewer react to the canonical robot store diff so in-place geometry/joint
  // patches stay incremental, while structural edits still fall back to a full reload.
  setRobot({
    name: nextState.name,
    version: nextState.version,
    links: nextState.links,
    joints: nextState.joints,
    rootLinkId: nextState.rootLinkId,
    materials: nextState.materials,
    closedLoopConstraints: nextState.closedLoopConstraints,
    inspectionContext: nextState.inspectionContext,
  });
}

export function useEditableSourceCodeApply({
  allFileContents,
  availableFiles,
  selectedFile,
  setAllFileContents,
  setAvailableFiles,
  setOriginalUrdfContent,
  setRobot,
  setSelectedFile,
}: UseEditableSourceCodeApplyOptions) {
  const editableSourceParseRequestRef = useRef(0);

  const syncSelectedEditableFileContent = useCallback(
    (targetFileName: string, content: string) => {
      if (selectedFile?.name === targetFileName && selectedFile.content !== content) {
        setSelectedFile({
          ...selectedFile,
          content,
        });
      }

      if (
        availableFiles.some((entry) => entry.name === targetFileName && entry.content !== content)
      ) {
        setAvailableFiles(
          availableFiles.map((entry) =>
            entry.name === targetFileName ? { ...entry, content } : entry,
          ),
        );
      }

      if (allFileContents[targetFileName] !== content) {
        setAllFileContents({
          ...allFileContents,
          [targetFileName]: content,
        });
      }
    },
    [
      allFileContents,
      availableFiles,
      selectedFile,
      setAllFileContents,
      setAvailableFiles,
      setSelectedFile,
    ],
  );

  const handleCodeChange = useCallback(
    async (
      newCode: string,
      target: SourceCodeDocumentChangeTarget | undefined = undefined,
      applyRequest: SourceCodeEditorApplyRequest | undefined = undefined,
    ): Promise<boolean> => {
      const syntheticSourceFile =
        !selectedFile && target?.format
          ? {
              name: target.name,
              format: target.format,
              content: target.content ?? '',
            }
          : null;
      const sourceFile = selectedFile ?? syntheticSourceFile;

      if (!sourceFile || sourceFile.format === 'usd') {
        return false;
      }

      const targetFileName = target?.name ?? sourceFile.name;
      const shouldPersistEditableContent = target?.persistContent !== false;
      const requestId = ++editableSourceParseRequestRef.current;
      const nextAllFileContents =
        !shouldPersistEditableContent || allFileContents[targetFileName] === newCode
          ? allFileContents
          : {
              ...allFileContents,
              [targetFileName]: newCode,
            };
      const nextAvailableFiles = shouldPersistEditableContent
        ? availableFiles.map((entry) =>
            entry.name === targetFileName ? { ...entry, content: newCode } : entry,
          )
        : availableFiles;
      const nextSourceContent =
        targetFileName === sourceFile.name
          ? newCode
          : (nextAllFileContents[sourceFile.name] ??
            nextAvailableFiles.find((entry) => entry.name === sourceFile.name)?.content ??
            sourceFile.content);
      const currentRobotState = useRobotStore.getState();
      const fastPatchedState =
        targetFileName === sourceFile.name
          ? tryPatchRobotStateFromEditableSourceChange({
              file: sourceFile,
              previousContent: sourceFile.content,
              nextContent: nextSourceContent,
              dirtyRanges: applyRequest?.dirtyRanges ?? [],
              currentState: {
                name: currentRobotState.name,
                version: currentRobotState.version,
                links: currentRobotState.links,
                joints: currentRobotState.joints,
                rootLinkId: currentRobotState.rootLinkId,
                materials: currentRobotState.materials,
                closedLoopConstraints: currentRobotState.closedLoopConstraints,
                inspectionContext: currentRobotState.inspectionContext,
              },
            })
          : null;

      try {
        if (fastPatchedState) {
          if (requestId !== editableSourceParseRequestRef.current) {
            return false;
          }

          const currentSelectedFileName = useAssetsStore.getState().selectedFile?.name ?? null;
          if (selectedFile && currentSelectedFileName !== sourceFile.name) {
            return false;
          }

          commitEditableSourceApply({
            newCode,
            sourceFile,
            targetFileName,
            nextState: fastPatchedState,
            syncSelectedEditableFileContent: shouldPersistEditableContent
              ? syncSelectedEditableFileContent
              : () => undefined,
            setOriginalUrdfContent,
            setRobot,
          });
          return true;
        }

        const parsedState = await parseEditableRobotSourceWithWorker({
          file: sourceFile,
          content: nextSourceContent,
          availableFiles: nextAvailableFiles,
          allFileContents: nextAllFileContents,
        });

        if (requestId !== editableSourceParseRequestRef.current) {
          return false;
        }

        const currentSelectedFileName = useAssetsStore.getState().selectedFile?.name ?? null;
        if (selectedFile && currentSelectedFileName !== sourceFile.name) {
          return false;
        }

        const nextState = parsedState
          ? rewriteRobotMeshPathsForSource(parsedState, sourceFile.name)
          : null;
        if (!nextState) {
          return false;
        }

        commitEditableSourceApply({
          newCode,
          sourceFile,
          targetFileName,
          nextState,
          syncSelectedEditableFileContent: shouldPersistEditableContent
            ? syncSelectedEditableFileContent
            : () => undefined,
          setOriginalUrdfContent,
          setRobot,
        });
        return true;
      } catch (error) {
        if (requestId !== editableSourceParseRequestRef.current) {
          return false;
        }

        console.error('Failed to parse editable source:', error);
        return false;
      }
    },
    [
      allFileContents,
      availableFiles,
      selectedFile,
      setOriginalUrdfContent,
      setRobot,
      syncSelectedEditableFileContent,
    ],
  );

  return {
    handleCodeChange,
  };
}
