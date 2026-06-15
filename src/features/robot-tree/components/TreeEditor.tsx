/**
 * TreeEditor - Robot tree structure editor with file browser
 * Features: File tree, robot structure tree, link/joint management
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getPrimaryTreeRenderRootLinkId, getTreeRenderRootLinkIds } from '@/core/robot';
import type { AppMode, AssemblyState, RobotFile, RobotState, Theme } from '@/types';
import { translations } from '@/shared/i18n';
import { Button, Dialog } from '@/shared/components/ui';
import {
  classifyLibraryFileKind,
  isLibraryComponentAddableFile,
  isLibraryRobotExportableFormat,
  isVisibleLibraryEntry,
} from '@/shared/utils';
import { useRobotStore, useSelectionStore, useUIStore, type Language } from '@/store';
import { buildFileTree } from '../utils';
import {
  buildChildJointsByParent,
  buildParentLinkByChild,
  resolveTreeSelectionIdentity,
} from '../utils/treeSelectionScope';
import { FileTreeContextMenu } from './FileTreeContextMenu';
import type { LibraryDeleteTarget } from './FileTreeNode';
import { TreeEditorFileBrowserPanel } from './tree-editor/TreeEditorFileBrowserPanel';
import { TreeEditorJointSection } from './tree-editor/TreeEditorJointSection';
import { TreeEditorSidebarHeader } from './tree-editor/TreeEditorSidebarHeader';
import { useTreeEditorLayout } from './tree-editor/useTreeEditorLayout';
import { TreeEditorStructureSection } from './tree-editor/TreeEditorStructureSection';

export type LibraryRobotLoadIntent = 'direct' | 'preview' | 'discard';
export type LibraryRobotLoadResult =
  | 'loaded'
  | 'needs-preview-or-discard-confirm'
  | 'blocked';

export interface TreeEditorProps {
  robot: RobotState;
  onSelect: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onSelectGeometry?: (
    linkId: string,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onFocus?: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onAddCollisionBody: (parentId: string) => void;
  onDelete: (id: string) => void;
  onNameChange: (name: string) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  showVisual: boolean;
  setShowVisual: (show: boolean) => void;
  mode: AppMode;
  lang: Language;
  collapsed?: boolean;
  onToggle?: () => void;
  theme: Theme;
  availableFiles?: RobotFile[];
  onLoadRobot?: (file: RobotFile) => void;
  onRequestLoadRobot?: (
    file: RobotFile,
    intent: LibraryRobotLoadIntent,
  ) => Promise<LibraryRobotLoadResult> | LibraryRobotLoadResult;
  currentFileName?: string;
  sourceFilePath?: string;
  assemblyState?: AssemblyState | null;
  onAddComponent?: (file: RobotFile) => void;
  onDeleteLibraryFile?: (file: RobotFile) => void;
  onDeleteLibraryFolder?: (folderPath: string) => void;
  onRenameLibraryFolder?: (
    folderPath: string,
    nextName: string,
  ) => { ok: true; nextPath: string } | { ok: false; reason: 'missing' | 'invalid' | 'conflict' };
  onDeleteAllLibraryFiles?: () => void;
  onExportLibraryFile?: (file: RobotFile) => void | Promise<void>;
  onCreateBridge?: () => void;
  onRenameAssembly?: (name: string) => void;
  onRemoveComponent?: (id: string) => void;
  onRemoveBridge?: (id: string) => void;
  onRenameComponent?: (id: string, name: string) => void;
  onSwitchToProMode?: () => void;
  onRequestSwitchToStructure?: (
    intent: 'direct' | 'generate' | 'skip-generate',
  ) =>
    | Promise<'switched' | 'needs-generate-confirm' | 'blocked'>
    | 'switched'
    | 'needs-generate-confirm'
    | 'blocked';
  isReadOnly?: boolean;
  showJointPanel?: boolean;
  onJointAnglePreview?: (jointName: string, angle: number) => void;
  onJointAngleChange?: (jointName: string, angle: number) => void;
}

export const TreeEditor: React.FC<TreeEditorProps> = ({
  robot,
  onSelect,
  onSelectGeometry,
  onFocus,
  onAddChild,
  onAddCollisionBody,
  onDelete,
  onNameChange,
  onUpdate,
  showVisual,
  setShowVisual,
  mode,
  lang,
  collapsed,
  onToggle,
  theme: _theme,
  availableFiles = [],
  onLoadRobot,
  onRequestLoadRobot,
  currentFileName,
  sourceFilePath,
  assemblyState,
  onAddComponent,
  onDeleteLibraryFile,
  onDeleteLibraryFolder,
  onRenameLibraryFolder,
  onDeleteAllLibraryFiles,
  onExportLibraryFile,
  onCreateBridge,
  onRenameAssembly,
  onRemoveComponent,
  onRemoveBridge,
  onRenameComponent,
  isReadOnly = false,
  showJointPanel = false,
  onJointAnglePreview,
  onJointAngleChange,
}) => {
  const t = translations[lang];
  const {
    structureTreeShowGeometryDetails,
    setStructureTreeShowGeometryDetails,
  } = useUIStore(
    useShallow((state) => ({
      structureTreeShowGeometryDetails: state.structureTreeShowGeometryDetails,
      setStructureTreeShowGeometryDetails: state.setStructureTreeShowGeometryDetails,
    })),
  );
  const { toggleComponentVisibility } = useRobotStore(
    useShallow((state) => ({
      toggleComponentVisibility: state.toggleComponentVisibility,
    })),
  );

  const {
    contentRef,
    sidebarRef,
    width,
    fileBrowserHeight,
    jointPanelHeight,
    isDragging,
    isFileBrowserOpen,
    isStructureOpen,
    setIsFileBrowserOpen,
    setIsStructureOpen,
    handleHorizontalResizeStart,
    handleVerticalResizeStart,
    handleJointPanelResizeStart,
  } = useTreeEditorLayout({ hasJointPanel: showJointPanel });

  const showAssemblyTools = !isReadOnly && Boolean(assemblyState);
  const showAddAsComponent = !isReadOnly && Boolean(onAddComponent);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [editingFolderPath, setEditingFolderPath] = useState<string | null>(null);
  const [folderRenameDraft, setFolderRenameDraft] = useState('');
  const folderRenameInputRef = useRef<HTMLInputElement>(null);
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number;
    y: number;
    target: LibraryDeleteTarget;
  } | null>(null);
  const [isDeleteAllLibraryDialogOpen, setIsDeleteAllLibraryDialogOpen] = useState(false);
  const [pendingLoadRobotFile, setPendingLoadRobotFile] = useState<RobotFile | null>(null);
  const [isLoadRobotDialogOpen, setIsLoadRobotDialogOpen] = useState(false);
  const [isLoadRobotPending, setIsLoadRobotPending] = useState(false);
  const showStructureFilePath = Boolean(currentFileName);
  const robotSelection = useSelectionStore((state) => state.selection);

  const browserAvailableFiles = useMemo(
    () => availableFiles.filter(isVisibleLibraryEntry),
    [availableFiles],
  );
  const hasVisibleJointPanel = showJointPanel;
  const fileTree = useMemo(() => buildFileTree(browserAvailableFiles), [browserAvailableFiles]);
  const treeRobot = robot;
  const topLevelLibraryFoldersKey = useMemo(() => {
    const firstLevel = new Set<string>();

    browserAvailableFiles.forEach((file) => {
      const firstPart = file.name.split('/')[0];
      if (firstPart) {
        firstLevel.add(firstPart);
      }
    });

    return Array.from(firstLevel).sort().join('\u0000');
  }, [browserAvailableFiles]);

  const childJointsByParent = useMemo<Record<string, RobotState['joints'][string][]>>(
    () => buildChildJointsByParent(robot.joints),
    [robot.joints],
  );
  const parentLinkByChild = useMemo(() => buildParentLinkByChild(robot.joints), [robot.joints]);
  const resolvedRobotSelection = useMemo(
    () =>
      resolveTreeSelectionIdentity(robotSelection, {
        links: robot.links,
        joints: robot.joints,
      }),
    [robot.joints, robot.links, robotSelection],
  );
  const selectionBranchLinkIds = useMemo(() => {
    const branch = new Set<string>();
    let currentLinkId: string | null = null;

    if (resolvedRobotSelection.type === 'link' && resolvedRobotSelection.id) {
      currentLinkId = resolvedRobotSelection.id;
    } else if (resolvedRobotSelection.type === 'joint' && resolvedRobotSelection.id) {
      currentLinkId = robot.joints[resolvedRobotSelection.id]?.parentLinkId ?? null;
    }

    while (currentLinkId) {
      branch.add(currentLinkId);
      currentLinkId = parentLinkByChild[currentLinkId] ?? null;
    }

    return branch;
  }, [parentLinkByChild, resolvedRobotSelection.id, resolvedRobotSelection.type, robot.joints]);
  const treeRootLinkIds = useMemo(
    () => getTreeRenderRootLinkIds(robot),
    [robot.joints, robot.links, robot.rootLinkId],
  );

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!topLevelLibraryFoldersKey) {
      return;
    }

    const topLevelLibraryFolders = topLevelLibraryFoldersKey.split('\u0000');
    const topLevelLibraryFolderSet = new Set(topLevelLibraryFolders);

    setExpandedFolders((prev) => {
      const next = new Set<string>();

      prev.forEach((path) => {
        const topLevelPath = path.split('/')[0];
        if (topLevelLibraryFolderSet.has(topLevelPath)) {
          next.add(path);
        }
      });

      topLevelLibraryFolders.forEach((folder) => {
        next.add(folder);
      });

      if (next.size === prev.size && Array.from(next).every((path) => prev.has(path))) {
        return prev;
      }

      return next;
    });
  }, [topLevelLibraryFoldersKey]);

  useEffect(() => {
    if (availableFiles.length === 0) {
      setIsDeleteAllLibraryDialogOpen(false);
    }
  }, [availableFiles.length]);

  useEffect(() => {
    if (!editingFolderPath) return;

    const id = window.requestAnimationFrame(() => {
      folderRenameInputRef.current?.focus();
      folderRenameInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(id);
  }, [editingFolderPath]);

  useEffect(() => {
    if (!fileContextMenu) return;

    const closeMenu = () => setFileContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [fileContextMenu]);

  const remapExpandedFolderPaths = useCallback((fromPath: string, toPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set<string>();
      prev.forEach((path) => {
        if (path === fromPath) {
          next.add(toPath);
          return;
        }

        if (path.startsWith(`${fromPath}/`)) {
          next.add(`${toPath}/${path.slice(fromPath.length + 1)}`);
          return;
        }

        next.add(path);
      });
      return next;
    });
  }, []);

  const handleFileContextMenu = useCallback(
    (event: React.MouseEvent, file: RobotFile) => {
      event.preventDefault();
      event.stopPropagation();

      const canAddToAssembly = Boolean(onAddComponent && isLibraryComponentAddableFile(file));
      const supportsExport = Boolean(
        onExportLibraryFile && isLibraryRobotExportableFormat(file.format),
      );
      const actionCount =
        (canAddToAssembly ? 1 : 0) +
        (supportsExport ? 1 : 0) +
        (onDeleteLibraryFile ? 1 : 0);
      if (actionCount === 0) return;

      const menuWidth = 180;
      const menuHeight = actionCount * 32 + 8;
      const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
      const maxY = Math.max(8, window.innerHeight - menuHeight - 8);

      setFileContextMenu({
        target: { type: 'file', file },
        x: Math.min(event.clientX, maxX),
        y: Math.min(event.clientY, maxY),
      });
    },
    [onAddComponent, onDeleteLibraryFile, onExportLibraryFile],
  );

  const handleFolderContextMenu = useCallback(
    (event: React.MouseEvent, folderPath: string) => {
      event.preventDefault();
      event.stopPropagation();

      const actionCount = (onRenameLibraryFolder ? 1 : 0) + (onDeleteLibraryFolder ? 1 : 0);
      if (actionCount === 0) {
        return;
      }

      const menuWidth = 180;
      const menuHeight = actionCount * 32 + 8;
      const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
      const maxY = Math.max(8, window.innerHeight - menuHeight - 8);

      setFileContextMenu({
        target: { type: 'folder', path: folderPath },
        x: Math.min(event.clientX, maxX),
        y: Math.min(event.clientY, maxY),
      });
    },
    [onDeleteLibraryFolder, onRenameLibraryFolder],
  );

  const handleStartFolderRename = useCallback((folderPath: string) => {
    const folderName = folderPath.split('/').pop() ?? folderPath;
    setFolderRenameDraft(folderName);
    setEditingFolderPath(folderPath);
    setFileContextMenu(null);
  }, []);

  const handleCancelFolderRename = useCallback(() => {
    setEditingFolderPath(null);
    setFolderRenameDraft('');
  }, []);

  const handleCommitFolderRename = useCallback(() => {
    if (!editingFolderPath || !onRenameLibraryFolder) {
      handleCancelFolderRename();
      return;
    }

    const result = onRenameLibraryFolder(editingFolderPath, folderRenameDraft);
    if (result.ok) {
      if (result.nextPath !== editingFolderPath) {
        remapExpandedFolderPaths(editingFolderPath, result.nextPath);
      }
      handleCancelFolderRename();
      return;
    }

    window.requestAnimationFrame(() => {
      folderRenameInputRef.current?.focus();
      folderRenameInputRef.current?.select();
    });
  }, [
    editingFolderPath,
    folderRenameDraft,
    handleCancelFolderRename,
    onRenameLibraryFolder,
    remapExpandedFolderPaths,
  ]);

  const handleAddComponentFromLibrary = useCallback(
    (file: RobotFile) => {
      if (!onAddComponent || !isLibraryComponentAddableFile(file)) {
        return;
      }

      onAddComponent(file);
    },
    [onAddComponent],
  );

  const handleAddFileToAssembly = useCallback(() => {
    if (!fileContextMenu || fileContextMenu.target.type !== 'file') return;
    handleAddComponentFromLibrary(fileContextMenu.target.file);
    setFileContextMenu(null);
  }, [fileContextMenu, handleAddComponentFromLibrary]);

  const handleExportLibraryFile = useCallback(() => {
    if (!fileContextMenu || fileContextMenu.target.type !== 'file' || !onExportLibraryFile) return;
    void onExportLibraryFile(fileContextMenu.target.file);
    setFileContextMenu(null);
  }, [fileContextMenu, onExportLibraryFile]);

  const handleRenameFolderFromMenu = useCallback(() => {
    if (!fileContextMenu || fileContextMenu.target.type !== 'folder') return;
    handleStartFolderRename(fileContextMenu.target.path);
  }, [fileContextMenu, handleStartFolderRename]);

  const handleDeleteFromLibrary = useCallback(
    (target: LibraryDeleteTarget) => {
      if (target.type === 'file') {
        onDeleteLibraryFile?.(target.file);
      } else {
        onDeleteLibraryFolder?.(target.path);
      }

      setFileContextMenu(null);
    },
    [onDeleteLibraryFile, onDeleteLibraryFolder],
  );

  const handleConfirmDeleteAllLibraryFiles = useCallback(() => {
    if (!onDeleteAllLibraryFiles || availableFiles.length === 0) return;

    onDeleteAllLibraryFiles();
    setIsDeleteAllLibraryDialogOpen(false);
  }, [availableFiles.length, onDeleteAllLibraryFiles]);

  const handleRequestLibraryRobotLoad = useCallback(
    async (file: RobotFile, intent: LibraryRobotLoadIntent = 'direct') => {
      if (!onRequestLoadRobot) {
        if (intent === 'direct') {
          onLoadRobot?.(file);
        }
        return;
      }

      setIsLoadRobotPending(true);
      try {
        const result = await onRequestLoadRobot(file, intent);
        if (result === 'needs-preview-or-discard-confirm') {
          setPendingLoadRobotFile(file);
          setIsLoadRobotDialogOpen(true);
          return;
        }

        if (result === 'loaded') {
          setPendingLoadRobotFile(null);
          setIsLoadRobotDialogOpen(false);
        }
      } finally {
        setIsLoadRobotPending(false);
      }
    },
    [onLoadRobot, onRequestLoadRobot],
  );

  const handleFileBrowserPrimaryAction = useCallback(
    (file: RobotFile) => {
      if (classifyLibraryFileKind(file) === 'robot') {
        if (onRequestLoadRobot) {
          void handleRequestLibraryRobotLoad(file);
          return;
        }

        onLoadRobot?.(file);
        return;
      }

      onLoadRobot?.(file);
    },
    [handleRequestLibraryRobotLoad, onLoadRobot, onRequestLoadRobot],
  );

  const handleToggleFileBrowserOpen = useCallback(
    () => setIsFileBrowserOpen(!isFileBrowserOpen),
    [isFileBrowserOpen, setIsFileBrowserOpen],
  );
  const handleToggleStructureOpen = useCallback(
    () => setIsStructureOpen(!isStructureOpen),
    [isStructureOpen, setIsStructureOpen],
  );
  const handleToggleGeometryDetails = useCallback(
    () => setStructureTreeShowGeometryDetails(!structureTreeShowGeometryDetails),
    [setStructureTreeShowGeometryDetails, structureTreeShowGeometryDetails],
  );
  const handleToggleVisuals = useCallback(
    () => setShowVisual(!showVisual),
    [setShowVisual, showVisual],
  );
  const handleAddChildFromSelection = useCallback(() => {
    let targetId = getPrimaryTreeRenderRootLinkId(robot) ?? robot.rootLinkId;
    if (resolvedRobotSelection.type === 'link' && resolvedRobotSelection.id) {
      targetId = resolvedRobotSelection.id;
    } else if (resolvedRobotSelection.type === 'joint' && resolvedRobotSelection.id) {
      const selectedJoint = robot.joints[resolvedRobotSelection.id];
      if (selectedJoint) {
        targetId = selectedJoint.childLinkId;
      }
    }
    onAddChild(targetId);
  }, [onAddChild, resolvedRobotSelection.id, resolvedRobotSelection.type, robot]);

  const actualWidth = collapsed ? 0 : width;
  const shouldFileBrowserFillSpace = false;
  const canDeleteAllLibraryFiles = Boolean(onDeleteAllLibraryFiles && availableFiles.length > 0);

  return (
    <div
      ref={sidebarRef}
      className={`@container bg-element-bg dark:bg-panel-bg border-r border-border-black flex flex-col h-full shrink-0 z-20 relative ${isDragging ? '' : 'transition-[width,min-width,flex] duration-200 ease-out'}`}
      style={{
        width: `${actualWidth}px`,
        minWidth: `${actualWidth}px`,
        flex: `0 0 ${actualWidth}px`,
        overflow: 'visible',
      }}
    >
      <TreeEditorSidebarHeader
        collapsed={collapsed}
        onToggle={onToggle}
        collapseTitle={t.collapseSidebar}
        expandTitle={t.structure}
      />

      {!collapsed && (
        <div ref={contentRef} className="flex flex-col h-full overflow-hidden w-full relative">
          <TreeEditorFileBrowserPanel
            isOpen={isFileBrowserOpen}
            isDragging={isDragging}
            showAddAsComponent={showAddAsComponent}
            height={fileBrowserHeight}
            shouldFillSpace={shouldFileBrowserFillSpace}
            availableFiles={browserAvailableFiles}
            fileTree={fileTree}
            expandedFolders={expandedFolders}
            editingFolderPath={editingFolderPath}
            folderRenameDraft={folderRenameDraft}
            folderRenameInputRef={folderRenameInputRef}
            canDeleteAllLibraryFiles={canDeleteAllLibraryFiles}
            t={t}
            onToggleOpen={handleToggleFileBrowserOpen}
            onDeleteAll={() => {
              setFileContextMenu(null);
              setIsDeleteAllLibraryDialogOpen(true);
            }}
            onFolderRenameDraftChange={setFolderRenameDraft}
            onCommitFolderRename={handleCommitFolderRename}
            onCancelFolderRename={handleCancelFolderRename}
            onLoadRobot={handleFileBrowserPrimaryAction}
            onAddComponent={handleAddComponentFromLibrary}
            onDeleteFromLibrary={
              onDeleteLibraryFile || onDeleteLibraryFolder ? handleDeleteFromLibrary : undefined
            }
            onFileContextMenu={handleFileContextMenu}
            onFolderContextMenu={handleFolderContextMenu}
            toggleFolder={toggleFolder}
          />

          {isFileBrowserOpen && (
            <button
              type="button"
              data-testid="tree-editor-file-browser-resize-handle"
              aria-label={t.resize}
              className="relative -my-1 h-2 shrink-0 cursor-row-resize border-0 bg-transparent p-0 z-10"
              onMouseDown={handleVerticalResizeStart}
            />
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <TreeEditorJointSection
              robot={robot}
              lang={lang}
              onSelect={onSelect}
              onUpdate={onUpdate}
              onJointAnglePreview={onJointAnglePreview}
              onJointAngleChange={onJointAngleChange}
              show={showJointPanel}
              sourceFilePath={sourceFilePath ?? currentFileName}
              height={jointPanelHeight}
              isDragging={isDragging}
            />
            {hasVisibleJointPanel && (
              <button
                type="button"
                data-testid="tree-editor-joint-section-resize-handle"
                aria-label={t.resize}
                className="relative -my-1 h-2 shrink-0 cursor-row-resize border-0 bg-transparent p-0 z-10"
                onMouseDown={handleJointPanelResizeStart}
              />
            )}
            <TreeEditorStructureSection
              isOpen={isStructureOpen}
              isAssemblyView={showAssemblyTools}
              structureTreeShowGeometryDetails={structureTreeShowGeometryDetails}
              showVisual={showVisual}
              showStructureFilePath={!showAssemblyTools && showStructureFilePath}
              currentFileName={currentFileName}
              mode={mode}
              assemblyState={assemblyState}
              robot={treeRobot}
              treeRootLinkIds={showAssemblyTools ? [] : treeRootLinkIds}
              childJointsByParent={showAssemblyTools ? {} : childJointsByParent}
              selectionBranchLinkIds={showAssemblyTools ? new Set<string>() : selectionBranchLinkIds}
              t={t}
              onToggleOpen={handleToggleStructureOpen}
              onToggleGeometryDetails={handleToggleGeometryDetails}
              onAddChildFromSelection={handleAddChildFromSelection}
              onToggleVisuals={handleToggleVisuals}
              onSelect={onSelect}
              onSelectGeometry={onSelectGeometry}
              onFocus={onFocus}
              onAddChild={onAddChild}
              onAddCollisionBody={onAddCollisionBody}
              onDelete={onDelete}
              onUpdate={onUpdate}
              onRenameAssembly={onRenameAssembly ?? onNameChange}
              onRenameRobot={onNameChange}
              onRemoveComponent={onRemoveComponent}
              onRemoveBridge={onRemoveBridge}
              onRenameComponent={onRenameComponent}
              onCreateBridge={onCreateBridge}
              onToggleComponentVisibility={toggleComponentVisibility}
              isReadOnly={isReadOnly}
            />
          </div>
        </div>
      )}

      {!collapsed && (
        <button
          type="button"
          data-testid="tree-editor-sidebar-resize-handle"
          aria-label={t.resize}
          className="group absolute right-0 top-0 bottom-0 z-30 w-2 cursor-col-resize border-0 bg-transparent p-0"
          onMouseDown={handleHorizontalResizeStart}
        >
          <div
            data-testid="tree-editor-sidebar-resize-rail"
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-px bg-transparent transition-colors group-hover:bg-system-blue/50 group-active:bg-system-blue/60"
          />
        </button>
      )}

      <FileTreeContextMenu
        position={fileContextMenu ? { x: fileContextMenu.x, y: fileContextMenu.y } : null}
        addLabel={t.addComponent}
        renameLabel={t.rename}
        exportLabel={t.export}
        deleteLabel={t.removeFromLibrary}
        onAdd={handleAddFileToAssembly}
        onRename={handleRenameFolderFromMenu}
        onExport={handleExportLibraryFile}
        onDelete={() => {
          if (fileContextMenu?.target) {
            handleDeleteFromLibrary(fileContextMenu.target);
          }
        }}
        showAddAction={Boolean(
          onAddComponent &&
          fileContextMenu?.target.type === 'file' &&
          isLibraryComponentAddableFile(fileContextMenu.target.file),
        )}
        showRenameAction={Boolean(
          fileContextMenu?.target.type === 'folder' && onRenameLibraryFolder,
        )}
        showExportAction={
          fileContextMenu?.target.type === 'file' &&
          Boolean(onExportLibraryFile) &&
          isLibraryRobotExportableFormat(fileContextMenu.target.file.format)
        }
        showDeleteAction={Boolean(
          (fileContextMenu?.target.type === 'folder' && onDeleteLibraryFolder) ||
          (fileContextMenu?.target.type === 'file' && onDeleteLibraryFile),
        )}
      />

      <Dialog
        isOpen={isDeleteAllLibraryDialogOpen}
        onClose={() => setIsDeleteAllLibraryDialogOpen(false)}
        title={t.deleteAllLibraryFilesConfirmTitle}
        width="w-[420px]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsDeleteAllLibraryDialogOpen(false)}
            >
              {t.cancel}
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmDeleteAllLibraryFiles}>
              {t.confirm}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-text-secondary">
          {t.deleteAllLibraryFilesConfirmMessage}
        </p>
      </Dialog>

      <Dialog
        isOpen={isLoadRobotDialogOpen}
        onClose={() => {
          if (!isLoadRobotPending) {
            setIsLoadRobotDialogOpen(false);
          }
        }}
        title={t.simpleModeSwitchDraftConfirmTitle}
        width="w-[460px]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsLoadRobotDialogOpen(false)}
              disabled={isLoadRobotPending}
            >
              {t.cancel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (pendingLoadRobotFile) {
                  void handleRequestLibraryRobotLoad(pendingLoadRobotFile, 'discard');
                }
              }}
              disabled={isLoadRobotPending || !pendingLoadRobotFile}
            >
              {t.discardAndOpen}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (pendingLoadRobotFile) {
                  void handleRequestLibraryRobotLoad(pendingLoadRobotFile, 'preview');
                }
              }}
              isLoading={isLoadRobotPending}
              disabled={!pendingLoadRobotFile}
            >
              {t.previewTargetModel}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-text-secondary">
          {t.simpleModeSwitchDraftConfirmMessage}
        </p>
      </Dialog>
    </div>
  );
};
