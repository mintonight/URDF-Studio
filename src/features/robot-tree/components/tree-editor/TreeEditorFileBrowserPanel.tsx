import type { MouseEvent, RefObject } from 'react';
import type { RobotFile } from '@/types';
import type { FileTreeNode } from '../../utils';
import { TreeEditorFileBrowserContent } from '../TreeEditorFileBrowserContent';
import type { TreeEditorTranslations } from '../treeEditorTypes';

interface TreeEditorFileBrowserPanelProps {
  isOpen: boolean;
  isDragging: boolean;
  showAddAsComponent: boolean;
  height: number;
  shouldFillSpace: boolean;
  availableFiles: RobotFile[];
  fileTree: FileTreeNode[];
  expandedFolders: Set<string>;
  editingFolderPath?: string | null;
  folderRenameDraft: string;
  folderRenameInputRef: RefObject<HTMLInputElement | null>;
  t: TreeEditorTranslations;
  onToggleOpen: () => void;
  onFolderRenameDraftChange: (value: string) => void;
  onCommitFolderRename: () => void;
  onCancelFolderRename: () => void;
  onLoadRobot?: (file: RobotFile) => void;
  onAddComponent?: (file: RobotFile) => void;
  onFileContextMenu: (event: MouseEvent, file: RobotFile) => void;
  onFolderContextMenu: (event: MouseEvent, folderPath: string) => void;
  toggleFolder: (path: string) => void;
}

export function TreeEditorFileBrowserPanel({
  isOpen,
  isDragging,
  showAddAsComponent,
  height,
  shouldFillSpace,
  availableFiles,
  fileTree,
  expandedFolders,
  editingFolderPath,
  folderRenameDraft,
  folderRenameInputRef,
  t,
  onToggleOpen,
  onFolderRenameDraftChange,
  onCommitFolderRename,
  onCancelFolderRename,
  onLoadRobot,
  onAddComponent,
  onFileContextMenu,
  onFolderContextMenu,
  toggleFolder,
}: TreeEditorFileBrowserPanelProps) {
  return (
    <TreeEditorFileBrowserContent
      availableFiles={availableFiles}
      expandedFolders={expandedFolders}
      fileTree={fileTree}
      height={height}
      isDragging={isDragging}
      isOpen={isOpen}
      showAddAsComponent={showAddAsComponent}
      editingFolderPath={editingFolderPath}
      folderRenameDraft={folderRenameDraft}
      folderRenameInputRef={folderRenameInputRef}
      onAddComponent={onAddComponent}
      onFolderRenameDraftChange={onFolderRenameDraftChange}
      onCommitFolderRename={onCommitFolderRename}
      onCancelFolderRename={onCancelFolderRename}
      onLoadRobot={onLoadRobot}
      onFileContextMenu={onFileContextMenu}
      onFolderContextMenu={onFolderContextMenu}
      onToggleOpen={onToggleOpen}
      shouldFillSpace={shouldFillSpace}
      t={t}
      toggleFolder={toggleFolder}
    />
  );
}
