import { useCallback } from 'react';
import { clearPreparedUsdStageOpenCache } from '@/features/editor/usd_prewarm';
import type { TranslationKeys } from '@/shared/i18n';
import { isLibraryRobotExportableFormat } from '@/shared/utils';
import {
  resolveRobotFolderRenameTarget,
  type RenameRobotFolderResult,
  useAssetsStore,
} from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { AssemblyState, RobotFile } from '@/types';
import { beginCoordinatedWorkspaceTransaction } from '@/app/utils/pendingHistory';

interface UseLibraryFileActionsParams {
  availableFiles: RobotFile[];
  selectedFile: RobotFile | null;
  assemblyState: AssemblyState;
  removeRobotFile: (path: string) => void;
  removeRobotFolder: (path: string) => void;
  renameRobotFolder: (path: string, nextName: string) => RenameRobotFolderResult;
  clearRobotLibrary: () => void;
  clearSelection: () => void;
  uploadAsset: (file: File) => void;
  openLibraryExportDialog: (file: RobotFile) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
  t: TranslationKeys;
}

export function useLibraryFileActions({
  availableFiles,
  selectedFile,
  assemblyState,
  removeRobotFile,
  removeRobotFolder,
  renameRobotFolder,
  clearRobotLibrary,
  clearSelection,
  uploadAsset,
  openLibraryExportDialog,
  showToast,
  t,
}: UseLibraryFileActionsParams) {
  const handleUploadAsset = useCallback(
    (file: File) => {
      uploadAsset(file);
    },
    [uploadAsset],
  );

  const clearLoadedModel = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const removeComponentsWithDrafts = useCallback((componentIds: readonly string[]) => {
    const operationId = beginCoordinatedWorkspaceTransaction('Remove library components');
    try {
      componentIds.forEach((componentId) => {
        if (!useWorkspaceStore.getState().workspace.components[componentId]) return;
        const removed = useWorkspaceStore.getState().removeComponent(componentId, {
          operationId,
          label: 'Remove library components',
        });
        if (!removed) {
          throw new Error(`Failed to remove workspace component "${componentId}".`);
        }
      });
      if (!useWorkspaceStore.getState().commitWorkspaceTransaction(operationId)) {
        throw new Error('Failed to commit library component removal.');
      }
    } catch (error) {
      useWorkspaceStore.getState().cancelWorkspaceTransaction(operationId);
      throw error;
    }
    const assets = useAssetsStore.getState();
    componentIds.forEach((componentId) => assets.removeComponentSourceDraft(componentId));
  }, []);

  const isPathInFolder = useCallback((path: string, folderPath: string) => {
    const normalized = folderPath.replace(/\/+$/, '');
    return path === normalized || path.startsWith(`${normalized}/`);
  }, []);

  const handleDeleteLibraryFile = useCallback(
    (file: RobotFile) => {
      const isCurrentModel = selectedFile?.name === file.name;
      const relatedComponentIds = Object.values(assemblyState.components)
        .filter((component) => component.sourceFile === file.name)
        .map((component) => component.id);

      removeComponentsWithDrafts(relatedComponentIds);
      removeRobotFile(file.name);
      if (file.format === 'usd') {
        clearPreparedUsdStageOpenCache();
      }
      if (isCurrentModel) {
        clearLoadedModel();
      }

      const fileLabel = file.name.split('/').pop() ?? file.name;
      showToast(t.removedFromAssetLibrary.replace('{name}', fileLabel), 'success');
    },
    [
      assemblyState,
      clearLoadedModel,
      removeComponentsWithDrafts,
      removeRobotFile,
      selectedFile?.name,
      showToast,
      t,
    ],
  );

  const handleDeleteLibraryFolder = useCallback(
    (folderPath: string) => {
      const normalizedFolder = folderPath.replace(/\/+$/, '');
      if (!normalizedFolder) return;

      const isCurrentModel = selectedFile?.name
        ? isPathInFolder(selectedFile.name, normalizedFolder)
        : false;
      const relatedComponentIds = Object.values(assemblyState.components)
        .filter(
          (component) =>
            component.sourceFile !== null
            && isPathInFolder(component.sourceFile, normalizedFolder),
        )
        .map((component) => component.id);
      const removedFiles = availableFiles.filter((file) =>
        isPathInFolder(file.name, normalizedFolder),
      );

      removeComponentsWithDrafts(relatedComponentIds);
      removeRobotFolder(normalizedFolder);
      if (removedFiles.some((file) => file.format === 'usd')) {
        clearPreparedUsdStageOpenCache();
      }
      if (isCurrentModel) {
        clearLoadedModel();
      }

      showToast(t.removedFolder.replace('{path}', normalizedFolder), 'success');
    },
    [
      assemblyState,
      availableFiles,
      clearLoadedModel,
      isPathInFolder,
      removeComponentsWithDrafts,
      removeRobotFolder,
      selectedFile?.name,
      showToast,
      t,
    ],
  );

  const handleRenameLibraryFolder = useCallback(
    (folderPath: string, nextName: string) => {
      const {
        normalizedFolder,
        sanitizedName,
        parentPath,
        nextFolderPath: expectedNextPath,
      } = resolveRobotFolderRenameTarget(folderPath, nextName);
      const previousFolderName = normalizedFolder.split('/').pop() ?? normalizedFolder;
      const operationId = beginCoordinatedWorkspaceTransaction(
        'Rename library folder',
        { skipHistory: true },
      );
      let renamedAssetPath: string | null = null;
      let result: RenameRobotFolderResult;

      try {
        if (normalizedFolder !== expectedNextPath) {
          const workspace = useWorkspaceStore.getState().workspace;
          const affectedComponents = Object.values(workspace.components).filter(
            (component) => component.sourceFile !== null
              && isPathInFolder(component.sourceFile, normalizedFolder),
          );
          affectedComponents.forEach((component) => {
            const sourceFile = component.sourceFile!;
            const nextSourceFile = `${expectedNextPath}${sourceFile.slice(normalizedFolder.length)}`;
            const changed = useWorkspaceStore.getState().updateComponentSourceFile(
              component.id,
              nextSourceFile,
              { operationId, label: 'Rename library folder' },
            );
            if (!changed) {
              throw new Error(
                `Failed to rename source path for workspace component "${component.id}".`,
              );
            }
          });
        }

        result = renameRobotFolder(normalizedFolder, nextName);
        renamedAssetPath = result.ok && result.nextPath !== normalizedFolder
          ? result.nextPath
          : null;
        if (result.ok === false) {
          useWorkspaceStore.getState().cancelWorkspaceTransaction(operationId);
        } else {
          if (result.nextPath !== expectedNextPath) {
            throw new Error(
              `Asset folder rename resolved to unexpected path "${result.nextPath}".`,
            );
          }
          if (!useWorkspaceStore.getState().commitWorkspaceTransaction(operationId)) {
            throw new Error('Failed to commit library folder rename.');
          }
        }
      } catch (error) {
        useWorkspaceStore.getState().cancelWorkspaceTransaction(operationId);
        if (renamedAssetPath) {
          const rollback = renameRobotFolder(renamedAssetPath, previousFolderName);
          if (rollback.ok === false) {
            throw new AggregateError(
              [error, new Error(`Failed to roll back asset folder "${renamedAssetPath}".`)],
              'Library folder rename failed and could not be rolled back.',
            );
          }
        }
        throw error;
      }

      if (result.ok === false) {
        if (result.reason === 'conflict') {
          const targetPath = sanitizedName
            ? parentPath
              ? `${parentPath}/${sanitizedName}`
              : sanitizedName
            : normalizedFolder;
          showToast(t.assetLibraryRenameConflict.replace('{path}', targetPath), 'info');
          return result;
        }

        showToast(t.assetLibraryRenameInvalid, 'info');
        return result;
      }

      if (normalizedFolder !== result.nextPath) {
        showToast(
          t.renamedFolder.replace('{from}', normalizedFolder).replace('{to}', result.nextPath),
          'success',
        );
      }

      return result;
    },
    [isPathInFolder, renameRobotFolder, showToast, t],
  );

  const handleDeleteAllLibraryFiles = useCallback(() => {
    if (availableFiles.length === 0) return;

    const availableFileNames = new Set(availableFiles.map((file) => file.name));
    const shouldClearCurrentModel = selectedFile?.name
      ? availableFileNames.has(selectedFile.name)
      : false;
    const relatedComponentIds = Object.values(assemblyState.components)
      .filter(
        (component) =>
          component.sourceFile !== null
          && availableFileNames.has(component.sourceFile),
      )
      .map((component) => component.id);

    removeComponentsWithDrafts(relatedComponentIds);

    if (shouldClearCurrentModel) {
      clearLoadedModel();
    }

    clearRobotLibrary();
    if (availableFiles.some((file) => file.format === 'usd')) {
      clearPreparedUsdStageOpenCache();
    }

    showToast(
      t.deletedAllLibraryFiles.replace('{count}', String(availableFiles.length)),
      'success',
    );
  }, [
    assemblyState,
    availableFiles,
    clearLoadedModel,
    clearRobotLibrary,
    removeComponentsWithDrafts,
    selectedFile?.name,
    showToast,
    t,
  ]);

  const handleExportLibraryFile = useCallback(
    (file: RobotFile) => {
      if (!isLibraryRobotExportableFormat(file.format)) {
        showToast(t.onlyUrdfMjcfExport, 'info');
        return;
      }

      openLibraryExportDialog(file);
    },
    [openLibraryExportDialog, showToast, t],
  );

  return {
    handleUploadAsset,
    handleDeleteLibraryFile,
    handleDeleteLibraryFolder,
    handleRenameLibraryFolder,
    handleDeleteAllLibraryFiles,
    handleExportLibraryFile,
  };
}
