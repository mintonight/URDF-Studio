import { useCallback } from 'react';
import type { RobotFile } from '@/types';

interface UseWorkspaceTextFileSyncParams {
  selectedFile: RobotFile | null;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  originalUrdfContent: string | null;
  setSelectedFile: (file: RobotFile | null) => void;
  setAvailableFiles: (files: RobotFile[]) => void;
  setAllFileContents: (contents: Record<string, string>) => void;
  setOriginalUrdfContent: (content: string) => void;
}

interface SyncTextFileContentOptions {
  syncOriginalContent?: boolean;
}

export function useWorkspaceTextFileSync({
  selectedFile,
  availableFiles,
  allFileContents,
  originalUrdfContent,
  setSelectedFile,
  setAvailableFiles,
  setAllFileContents,
  setOriginalUrdfContent,
}: UseWorkspaceTextFileSyncParams) {
  return useCallback(
    (fileName: string, content: string, options: SyncTextFileContentOptions = {}) => {
      const { syncOriginalContent = false } = options;

      if (selectedFile?.name === fileName && selectedFile.content !== content) {
        setSelectedFile({
          ...selectedFile,
          content,
        });
      }

      const needsAvailableFileSync = availableFiles.some(
        (file) => file.name === fileName && file.content !== content,
      );

      if (needsAvailableFileSync) {
        setAvailableFiles(
          availableFiles.map((file) => (file.name === fileName ? { ...file, content } : file)),
        );
      }

      if (allFileContents[fileName] !== content) {
        setAllFileContents({
          ...allFileContents,
          [fileName]: content,
        });
      }

      if (syncOriginalContent && originalUrdfContent !== content) {
        setOriginalUrdfContent(content);
      }
    },
    [
      allFileContents,
      availableFiles,
      originalUrdfContent,
      selectedFile,
      setAllFileContents,
      setAvailableFiles,
      setOriginalUrdfContent,
      setSelectedFile,
    ],
  );
}
