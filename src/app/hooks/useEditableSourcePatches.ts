import { useCallback } from 'react';

import type { RobotFile, UrdfJoint, UrdfLink } from '@/types';

import {
  buildEditableSourcePatchState,
  resolveEditablePatchTarget,
  type EditableSourcePatchStateResult,
} from './editableSourcePatchState';
import {
  appendMJCFBodyCollisionGeomToSource,
  appendMJCFChildBodyToSource,
  canPatchMJCFEditableSource,
  removeMJCFBodyCollisionGeomFromSource,
  removeMJCFBodyFromSource,
  renameMJCFEntitiesInSource,
  updateMJCFBodyCollisionGeomInSource,
  type MJCFRenameOperation,
} from '../utils/mjcfEditableSourcePatch';

interface EditableSourceState {
  selectedFile: RobotFile | null;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
}

interface EditableSourceSetters {
  setSelectedFile: (file: RobotFile) => void;
  setAvailableFiles: (files: RobotFile[]) => void;
  setAllFileContents: (contents: Record<string, string>) => void;
}

interface UseEditableSourcePatchesParams extends EditableSourceState, EditableSourceSetters {
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

function applyEditableSourcePatchState(
  result: EditableSourcePatchStateResult<RobotFile>,
  currentState: EditableSourceState,
  setters: EditableSourceSetters,
) {
  if (result.nextSelectedFile !== currentState.selectedFile && result.nextSelectedFile) {
    setters.setSelectedFile(result.nextSelectedFile);
  }

  if (result.nextAvailableFiles !== currentState.availableFiles) {
    setters.setAvailableFiles(result.nextAvailableFiles);
  }

  if (result.nextAllFileContents !== currentState.allFileContents) {
    setters.setAllFileContents(result.nextAllFileContents);
  }
}

export function useEditableSourcePatches({
  selectedFile,
  availableFiles,
  allFileContents,
  setSelectedFile,
  setAvailableFiles,
  setAllFileContents,
  showToast,
}: UseEditableSourcePatchesParams) {
  const commitNextContent = useCallback(
    ({ sourceFileName, nextContent }: { sourceFileName?: string | null; nextContent: string }) => {
      const { targetFileName, targetFile } = resolveEditablePatchTarget({
        selectedFile,
        availableFiles,
        sourceFileName,
      });

      if (!targetFileName || !targetFile || !canPatchMJCFEditableSource(targetFile)) {
        return false;
      }

      const patchState = buildEditableSourcePatchState({
        selectedFile,
        availableFiles,
        allFileContents,
        targetFile,
        nextContent,
      });

      applyEditableSourcePatchState(
        patchState,
        { selectedFile, availableFiles, allFileContents },
        { setSelectedFile, setAvailableFiles, setAllFileContents },
      );
      return true;
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

  const patchEditableSourceAddChild = useCallback(
    ({
      sourceFileName,
      parentLinkName,
      linkName,
      joint,
    }: {
      sourceFileName?: string | null;
      parentLinkName: string;
      linkName: string;
      joint: UrdfJoint;
    }) => {
      const { targetFileName, targetFile } = resolveEditablePatchTarget({
        selectedFile,
        availableFiles,
        sourceFileName,
      });
      if (!targetFileName || !targetFile || !canPatchMJCFEditableSource(targetFile)) {
        return;
      }

      try {
        const nextContent = appendMJCFChildBodyToSource({
          sourceContent: targetFile.content,
          parentBodyName: parentLinkName,
          childBodyName: linkName,
          joint,
        });
        commitNextContent({ sourceFileName: targetFileName, nextContent });
      } catch (error) {
        console.error(
          `Failed to patch MJCF source after adding child body to "${targetFileName}".`,
          error,
        );
        showToast(`Failed to patch MJCF source for ${targetFileName}`, 'info');
      }
    },
    [availableFiles, commitNextContent, selectedFile, showToast],
  );

  const patchEditableSourceDeleteSubtree = useCallback(
    ({ sourceFileName, linkName }: { sourceFileName?: string | null; linkName: string }) => {
      const { targetFileName, targetFile } = resolveEditablePatchTarget({
        selectedFile,
        availableFiles,
        sourceFileName,
      });
      if (!targetFileName || !targetFile || !canPatchMJCFEditableSource(targetFile)) {
        return;
      }

      try {
        const nextContent = removeMJCFBodyFromSource(targetFile.content, linkName);
        commitNextContent({ sourceFileName: targetFileName, nextContent });
      } catch (error) {
        console.error(
          `Failed to patch MJCF source after deleting subtree "${linkName}" from "${targetFileName}".`,
          error,
        );
        showToast(`Failed to patch MJCF source for ${targetFileName}`, 'info');
      }
    },
    [availableFiles, commitNextContent, selectedFile, showToast],
  );

  const patchEditableSourceAddCollisionBody = useCallback(
    ({
      sourceFileName,
      linkName,
      geometry,
    }: {
      sourceFileName?: string | null;
      linkName: string;
      geometry: UrdfLink['collision'];
    }) => {
      const { targetFileName, targetFile } = resolveEditablePatchTarget({
        selectedFile,
        availableFiles,
        sourceFileName,
      });
      if (!targetFileName || !targetFile || !canPatchMJCFEditableSource(targetFile)) {
        return;
      }

      try {
        const nextContent = appendMJCFBodyCollisionGeomToSource({
          sourceContent: targetFile.content,
          bodyName: linkName,
          geometry,
        });
        commitNextContent({ sourceFileName: targetFileName, nextContent });
      } catch (error) {
        console.error(
          `Failed to patch MJCF source after adding collision geom to "${targetFileName}".`,
          error,
        );
        showToast(`Failed to patch MJCF source for ${targetFileName}`, 'info');
      }
    },
    [availableFiles, commitNextContent, selectedFile, showToast],
  );

  const patchEditableSourceDeleteCollisionBody = useCallback(
    ({
      sourceFileName,
      linkName,
      objectIndex,
    }: {
      sourceFileName?: string | null;
      linkName: string;
      objectIndex: number;
    }) => {
      const { targetFileName, targetFile } = resolveEditablePatchTarget({
        selectedFile,
        availableFiles,
        sourceFileName,
      });
      if (!targetFileName || !targetFile || !canPatchMJCFEditableSource(targetFile)) {
        return;
      }

      try {
        const nextContent = removeMJCFBodyCollisionGeomFromSource(
          targetFile.content,
          linkName,
          objectIndex,
        );
        commitNextContent({ sourceFileName: targetFileName, nextContent });
      } catch (error) {
        console.error(
          `Failed to patch MJCF source after deleting collision geom from "${targetFileName}".`,
          error,
        );
        showToast(`Failed to patch MJCF source for ${targetFileName}`, 'info');
      }
    },
    [availableFiles, commitNextContent, selectedFile, showToast],
  );

  const patchEditableSourceUpdateCollisionBody = useCallback(
    ({
      sourceFileName,
      linkName,
      objectIndex,
      geometry,
    }: {
      sourceFileName?: string | null;
      linkName: string;
      objectIndex: number;
      geometry: UrdfLink['collision'];
    }) => {
      const { targetFileName, targetFile } = resolveEditablePatchTarget({
        selectedFile,
        availableFiles,
        sourceFileName,
      });
      if (!targetFileName || !targetFile || !canPatchMJCFEditableSource(targetFile)) {
        return;
      }

      try {
        const nextContent = updateMJCFBodyCollisionGeomInSource(
          targetFile.content,
          linkName,
          objectIndex,
          geometry,
        );
        commitNextContent({ sourceFileName: targetFileName, nextContent });
      } catch (error) {
        console.error(
          `Failed to patch MJCF source after updating collision geom in "${targetFileName}".`,
          error,
        );
        showToast(`Failed to patch MJCF source for ${targetFileName}`, 'info');
      }
    },
    [availableFiles, commitNextContent, selectedFile, showToast],
  );

  const patchEditableSourceRenameEntities = useCallback(
    ({
      sourceFileName,
      operations,
    }: {
      sourceFileName?: string | null;
      operations: MJCFRenameOperation[];
    }) => {
      const { targetFileName, targetFile } = resolveEditablePatchTarget({
        selectedFile,
        availableFiles,
        sourceFileName,
      });
      if (
        !targetFileName ||
        !operations.length ||
        !targetFile ||
        !canPatchMJCFEditableSource(targetFile)
      ) {
        return;
      }

      try {
        const nextContent = renameMJCFEntitiesInSource(targetFile.content, operations);
        commitNextContent({ sourceFileName: targetFileName, nextContent });
      } catch (error) {
        console.error(
          `Failed to patch MJCF source after renaming entities in "${targetFileName}".`,
          error,
        );
        showToast(`Failed to patch MJCF source for ${targetFileName}`, 'info');
      }
    },
    [availableFiles, commitNextContent, selectedFile, showToast],
  );

  return {
    patchEditableSourceAddChild,
    patchEditableSourceDeleteSubtree,
    patchEditableSourceAddCollisionBody,
    patchEditableSourceDeleteCollisionBody,
    patchEditableSourceUpdateCollisionBody,
    patchEditableSourceRenameEntities,
  };
}
