import { useCallback } from 'react';
import { clearPreparedUsdStageOpenCache } from '@/features/editor/usd_prewarm';
import type { TranslationKeys } from '@/shared/i18n';
import { isLibraryRobotExportableFormat } from '@/shared/utils';
import type { RenameRobotFolderResult } from '@/store/assetsStore';
import type { AssemblyState, RobotData, RobotFile } from '@/types';

type EmptyRobotState = Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>;

interface UseLibraryFileActionsParams {
  availableFiles: RobotFile[];
  selectedFile: RobotFile | null;
  assemblyState: AssemblyState | null;
  emptyRobot: EmptyRobotState;
  removeComponent: (id: string) => void;
  removeRobotFile: (path: string) => void;
  removeRobotFolder: (path: string) => void;
  renameRobotFolder: (path: string, nextName: string) => RenameRobotFolderResult;
  renameComponentSourceFolder: (
    fromPath: string,
    toPath: string,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  clearRobotLibrary: () => void;
  resetRobot: (data: { name: string } & EmptyRobotState) => void;
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
  emptyRobot,
  removeComponent,
  removeRobotFile,
  removeRobotFolder,
  renameRobotFolder,
  renameComponentSourceFolder,
  clearRobotLibrary,
  resetRobot,
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
    resetRobot({
      name: '',
      links: emptyRobot.links,
      joints: emptyRobot.joints,
      rootLinkId: emptyRobot.rootLinkId,
    });
    clearSelection();
  }, [clearSelection, emptyRobot, resetRobot]);

  const isPathInFolder = useCallback((path: string, folderPath: string) => {
    const normalized = folderPath.replace(/\/+$/, '');
    return path === normalized || path.startsWith(`${normalized}/`);
  }, []);

  const handleDeleteLibraryFile = useCallback(
    (file: RobotFile) => {
      const isCurrentModel = selectedFile?.name === file.name;
      const relatedComponentIds = assemblyState
        ? Object.values(assemblyState.components)
            .filter((component) => component.sourceFile === file.name)
            .map((component) => component.id)
        : [];

      removeRobotFile(file.name);
      if (file.format === 'usd') {
        clearPreparedUsdStageOpenCache();
      }
      relatedComponentIds.forEach((componentId) => removeComponent(componentId));
      if (isCurrentModel) {
        clearLoadedModel();
      }

      const fileLabel = file.name.split('/').pop() ?? file.name;
      showToast(t.removedFromAssetLibrary.replace('{name}', fileLabel), 'success');
    },
    [
      assemblyState,
      clearLoadedModel,
      removeComponent,
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
      const relatedComponentIds = assemblyState
        ? Object.values(assemblyState.components)
            .filter((component) => isPathInFolder(component.sourceFile, normalizedFolder))
            .map((component) => component.id)
        : [];
      const removedFiles = availableFiles.filter((file) =>
        isPathInFolder(file.name, normalizedFolder),
      );

      removeRobotFolder(normalizedFolder);
      if (removedFiles.some((file) => file.format === 'usd')) {
        clearPreparedUsdStageOpenCache();
      }
      relatedComponentIds.forEach((componentId) => removeComponent(componentId));
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
      removeComponent,
      removeRobotFolder,
      selectedFile?.name,
      showToast,
      t,
    ],
  );

  const handleRenameLibraryFolder = useCallback(
    (folderPath: string, nextName: string) => {
      const result = renameRobotFolder(folderPath, nextName);
      if (result.ok === false) {
        if (result.reason === 'conflict') {
          const normalizedFolder = folderPath.replace(/\/+$/, '');
          const sanitizedName = nextName.trim().replace(/[\\/]+/g, '');
          const parentPath = normalizedFolder.includes('/')
            ? normalizedFolder.split('/').slice(0, -1).join('/')
            : '';
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

      const normalizedFolder = folderPath.replace(/\/+$/, '');
      if (normalizedFolder !== result.nextPath) {
        renameComponentSourceFolder(normalizedFolder, result.nextPath, { skipHistory: true });
        showToast(
          t.renamedFolder.replace('{from}', normalizedFolder).replace('{to}', result.nextPath),
          'success',
        );
      }

      return result;
    },
    [renameComponentSourceFolder, renameRobotFolder, showToast, t],
  );

  const handleDeleteAllLibraryFiles = useCallback(() => {
    if (availableFiles.length === 0) return;

    const availableFileNames = new Set(availableFiles.map((file) => file.name));
    const shouldClearCurrentModel = selectedFile?.name
      ? availableFileNames.has(selectedFile.name)
      : false;
    const relatedComponentIds = assemblyState
      ? Object.values(assemblyState.components)
          .filter((component) => availableFileNames.has(component.sourceFile))
          .map((component) => component.id)
      : [];

    relatedComponentIds.forEach((componentId) => removeComponent(componentId));

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
    removeComponent,
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
