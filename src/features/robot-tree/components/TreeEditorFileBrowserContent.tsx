import { ChevronDown, ChevronRight } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import type { RobotFile } from '@/types';
import type { FileTreeNode } from '../utils';
import { FileTreeNodeComponent } from './FileTreeNode';
import type { TreeEditorTranslations } from './treeEditorTypes';

interface TreeEditorFileBrowserContentProps {
  availableFiles: RobotFile[];
  editingFolderPath?: string | null;
  expandedFolders: Set<string>;
  fileTree: FileTreeNode[];
  folderRenameDraft: string;
  folderRenameInputRef: RefObject<HTMLInputElement | null>;
  height: number;
  isDragging: boolean;
  isOpen: boolean;
  showAddAsComponent: boolean;
  onAddComponent?: (file: RobotFile) => void;
  onCancelFolderRename: () => void;
  onCommitFolderRename: () => void;
  onLoadRobot?: (file: RobotFile) => void;
  onFileContextMenu: (event: ReactMouseEvent, file: RobotFile) => void;
  onFolderRenameDraftChange: (value: string) => void;
  onFolderContextMenu: (event: ReactMouseEvent, folderPath: string) => void;
  onToggleOpen: () => void;
  shouldFillSpace: boolean;
  t: TreeEditorTranslations;
  toggleFolder: (path: string) => void;
}

export function TreeEditorFileBrowserContent({
  availableFiles,
  editingFolderPath,
  expandedFolders,
  fileTree,
  folderRenameDraft,
  folderRenameInputRef,
  height,
  isDragging,
  isOpen,
  showAddAsComponent,
  onAddComponent,
  onCancelFolderRename,
  onCommitFolderRename,
  onLoadRobot,
  onFileContextMenu,
  onFolderRenameDraftChange,
  onFolderContextMenu,
  onToggleOpen,
  shouldFillSpace,
  t,
  toggleFolder,
}: TreeEditorFileBrowserContentProps) {
  return (
    <div
      className={`@container flex flex-col bg-white dark:bg-panel-bg border-b border-border-black dark:border-border-black ${shouldFillSpace ? 'flex-1 min-h-0' : 'shrink-0'} ${isDragging ? '' : 'transition-all duration-200'}`}
      style={shouldFillSpace ? undefined : { height: isOpen ? `${height}px` : 'auto' }}
    >
      <div
        className="flex items-center justify-between px-2.5 py-1.5 bg-element-bg dark:bg-element-bg cursor-pointer select-none"
        onClick={onToggleOpen}
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
          )}
          <span className="text-[11px] leading-none font-semibold text-text-secondary tracking-[0.02em]">
            {t.fileBrowser}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] leading-none text-text-tertiary">
            {availableFiles.length}
          </span>
        </div>
      </div>

      {isOpen && (
        <div
          className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar py-1"
          onContextMenu={(event) => {
            event.preventDefault();
          }}
        >
          {availableFiles.length === 0 ? (
            <div className="ui-static-copy-guard py-4 text-center text-xs italic whitespace-pre-line text-text-tertiary">
              {t.dropOrImport}
            </div>
          ) : (
            <div className="min-w-max">
              {fileTree.map((node) => (
                <div
                  key={node.path}
                  style={{ containIntrinsicSize: 'auto 40px', contentVisibility: 'auto' }}
                >
                  <FileTreeNodeComponent
                    node={node}
                    depth={0}
                    editingFolderPath={editingFolderPath}
                    folderRenameDraft={folderRenameDraft}
                    folderRenameInputRef={folderRenameInputRef}
                    onLoadRobot={onLoadRobot}
                    onAddAsComponent={showAddAsComponent ? onAddComponent : undefined}
                    onCancelFolderRename={onCancelFolderRename}
                    onCommitFolderRename={onCommitFolderRename}
                    onFileContextMenu={onFileContextMenu}
                    onFolderRenameDraftChange={onFolderRenameDraftChange}
                    onFolderContextMenu={onFolderContextMenu}
                    expandedFolders={expandedFolders}
                    toggleFolder={toggleFolder}
                    showAddAsComponent={showAddAsComponent}
                    t={t}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
