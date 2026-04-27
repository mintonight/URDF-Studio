import React from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { TranslationKeys } from '@/shared/i18n';
import {
  classifyLibraryFileKind,
  isLibraryComponentAddableFile,
  isLibraryPreviewableFile,
} from '@/shared/utils/robotFileSupport';
import type { RobotFile } from '@/types';
import { getFileIcon, type FileTreeNode } from '../utils';

export type LibraryDeleteTarget =
  | { type: 'file'; file: RobotFile }
  | { type: 'folder'; path: string };

export interface FileTreeNodeComponentProps {
  node: FileTreeNode;
  depth: number;
  editingFolderPath?: string | null;
  folderRenameDraft: string;
  folderRenameInputRef: React.RefObject<HTMLInputElement | null>;
  onLoadRobot?: (file: RobotFile) => void;
  onAddAsComponent?: (file: RobotFile) => void;
  onCancelFolderRename: () => void;
  onCommitFolderRename: () => void;
  onDeleteFromLibrary?: (target: LibraryDeleteTarget) => void;
  onFileContextMenu?: (event: React.MouseEvent, file: RobotFile) => void;
  onFolderRenameDraftChange: (value: string) => void;
  onFolderContextMenu?: (event: React.MouseEvent, folderPath: string) => void;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  showAddAsComponent?: boolean;
  selectedFileName?: string;
  t: TranslationKeys;
}

const FileTreeNodeComponentBase: React.FC<FileTreeNodeComponentProps> = ({
  node,
  depth,
  editingFolderPath,
  folderRenameDraft,
  folderRenameInputRef,
  onLoadRobot,
  onAddAsComponent,
  onCancelFolderRename,
  onCommitFolderRename,
  onDeleteFromLibrary,
  onFileContextMenu,
  onFolderRenameDraftChange,
  onFolderContextMenu,
  expandedFolders,
  toggleFolder,
  showAddAsComponent,
  selectedFileName,
  t,
}) => {
  const fileKind = node.file ? classifyLibraryFileKind(node.file) : null;
  const isExpanded = expandedFolders.has(node.path);
  const isSelectedFile = Boolean(node.file && selectedFileName === node.file.name);
  const isEditingFolder = Boolean(node.isFolder && editingFolderPath === node.path);
  const paddingLeft = depth * 12 + 8;
  const canDeleteFolder = Boolean(onDeleteFromLibrary && node.isFolder);
  const canDeleteFile = Boolean(onDeleteFromLibrary && node.file);
  const canAddFileAsComponent = Boolean(
    node.file && showAddAsComponent && onAddAsComponent && isLibraryComponentAddableFile(node.file),
  );
  const canPreviewFile = Boolean(node.file && onLoadRobot && isLibraryPreviewableFile(node.file));
  const showAddButton = canAddFileAsComponent;
  const showDeleteButton = canDeleteFolder || canDeleteFile;

  const handleClick = () => {
    if (isEditingFolder) return;

    if (node.isFolder) {
      toggleFolder(node.path);
      return;
    }

    if (node.file && canPreviewFile && onLoadRobot) {
      onLoadRobot(node.file);
      return;
    }

    if (node.file && canAddFileAsComponent && onAddAsComponent) {
      onAddAsComponent(node.file);
    }
  };

  const handleAddAsComponent = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.file && onAddAsComponent && isLibraryComponentAddableFile(node.file)) {
      onAddAsComponent(node.file);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (node.isFolder) {
      if (onFolderContextMenu) {
        onFolderContextMenu(e, node.path);
      }
      return;
    }

    if (node.file && onFileContextMenu) {
      onFileContextMenu(e, node.file);
    }
  };

  const handleDeleteFromLibrary = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDeleteFromLibrary) return;
    if (node.file) {
      onDeleteFromLibrary({ type: 'file', file: node.file });
      return;
    }
    if (canDeleteFolder) {
      onDeleteFromLibrary({ type: 'folder', path: node.path });
    }
  };

  return (
    <div>
      <div
        className={`group flex cursor-pointer select-none items-center gap-1.5 rounded-sm py-1 pr-2 transition-colors
          ${
            isSelectedFile
              ? 'bg-element-bg dark:bg-element-hover shadow-sm ring-1 ring-inset ring-border-strong'
              : 'hover:bg-element-bg dark:hover:bg-element-hover'
          }`}
        style={{ paddingLeft: `${paddingLeft}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {node.isFolder ? (
          <span className="w-3 h-3 flex items-center justify-center">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-text-tertiary" />
            ) : (
              <ChevronRight className="w-3 h-3 text-text-tertiary" />
            )}
          </span>
        ) : (
          <span className="w-3 h-3" />
        )}

        {getFileIcon(node.name, node.isFolder, isExpanded)}

        <div className="min-w-0 flex-1">
          {isEditingFolder ? (
            <input
              ref={folderRenameInputRef}
              type="text"
              value={folderRenameDraft}
              onChange={(event) => onFolderRenameDraftChange(event.target.value)}
              onBlur={onCommitFolderRename}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onCommitFolderRename();
                } else if (event.key === 'Escape') {
                  onCancelFolderRename();
                }
              }}
              className="h-6 w-full min-w-0 select-text rounded-md border border-system-blue bg-panel-bg px-2 text-xs font-medium text-text-primary outline-none ring-2 ring-system-blue/20"
            />
          ) : (
            <span
              className={`block truncate text-xs ${
                node.isFolder
                  ? 'font-medium text-text-primary'
                  : 'text-text-secondary dark:text-text-secondary'
              }`}
            >
              {node.name}
            </span>
          )}
        </div>

        {node.file && (
          <span
            className={`text-[9px] px-1 rounded font-medium ${
              node.file.format === 'urdf'
                ? 'bg-system-blue/10 dark:bg-system-blue/20 text-system-blue'
                : node.file.format === 'sdf'
                  ? 'bg-teal-100 dark:bg-teal-900/25 text-teal-700 dark:text-teal-300'
                  : node.file.format === 'xacro'
                    ? 'bg-element-bg dark:bg-element-hover text-text-secondary'
                    : node.file.format === 'mjcf'
                      ? 'bg-orange-100 dark:bg-orange-900/25 text-orange-600 dark:text-orange-300'
                      : node.file.format === 'usd'
                        ? 'bg-violet-100 dark:bg-violet-900/25 text-violet-700 dark:text-violet-300'
                        : fileKind === 'image'
                          ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300'
                          : fileKind === 'mesh'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {fileKind === 'robot'
              ? node.file.format.toUpperCase()
              : (node.file.name.split('.').pop()?.toUpperCase() ??
                (fileKind === 'image' ? 'IMAGE' : 'ASSET'))}
          </span>
        )}

        {(showAddButton || showDeleteButton) && !isEditingFolder && (
          <div
            className={`flex items-center gap-1 transition-opacity ${
              isSelectedFile
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            }`}
          >
            {showAddButton && (
              <button
                onClick={handleAddAsComponent}
                className="px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800/50 flex items-center gap-1 transition-colors group/btn"
                title={t.addComponent}
              >
                <Plus
                  size={10}
                  strokeWidth={3}
                  className="group-hover/btn:scale-110 transition-transform"
                />
                <span className="text-[9px] font-semibold tracking-[0.01em]">{t.add}</span>
              </button>
            )}

            {showDeleteButton && (
              <button
                onClick={handleDeleteFromLibrary}
                className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 flex items-center transition-colors group/btn"
                title={t.removeFromLibrary}
              >
                <Trash2
                  size={10}
                  strokeWidth={2.5}
                  className="group-hover/btn:scale-110 transition-transform"
                />
              </button>
            )}
          </div>
        )}
      </div>

      {node.isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNodeComponent
              key={child.path}
              node={child}
              depth={depth + 1}
              editingFolderPath={editingFolderPath}
              folderRenameDraft={folderRenameDraft}
              folderRenameInputRef={folderRenameInputRef}
              onLoadRobot={onLoadRobot}
              onAddAsComponent={onAddAsComponent}
              onCancelFolderRename={onCancelFolderRename}
              onCommitFolderRename={onCommitFolderRename}
              onDeleteFromLibrary={onDeleteFromLibrary}
              onFileContextMenu={onFileContextMenu}
              onFolderRenameDraftChange={onFolderRenameDraftChange}
              onFolderContextMenu={onFolderContextMenu}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              showAddAsComponent={showAddAsComponent}
              selectedFileName={selectedFileName}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileTreeNodeComponent = React.memo(FileTreeNodeComponentBase);
FileTreeNodeComponent.displayName = 'FileTreeNodeComponent';
