/**
 * TreeEditor - Robot tree structure editor with file browser
 * Features: File tree, robot structure tree, link/joint management
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { getPrimaryTreeRenderRootLinkId, getTreeRenderRootLinkIds } from '@/core/robot';
import type { AppMode, AssemblyState, RobotFile, RobotState, Theme } from '@/types';
import { translations } from '@/shared/i18n';
import { Button, Dialog } from '@/shared/components/ui';
import { isLibraryRobotExportableFormat } from '@/shared/utils';
import { useAssemblyStore, useSelectionStore, useUIStore, type Language } from '@/store';
import { buildFileTree } from '../utils';
import { buildChildJointsByParent, buildParentLinkByChild } from '../utils/treeSelectionScope';
import { FileTreeContextMenu } from './FileTreeContextMenu';
import type { LibraryDeleteTarget } from './FileTreeNode';
import { TreeEditorFileBrowserPanel } from './tree-editor/TreeEditorFileBrowserPanel';
import { TreeEditorSidebarHeader } from './tree-editor/TreeEditorSidebarHeader';
import { useTreeEditorLayout } from './tree-editor/useTreeEditorLayout';
import { TreeEditorStructureSection } from './tree-editor/TreeEditorStructureSection';

export interface TreeEditorProps {
  robot: RobotState;
  onSelect: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onSelectGeometry?: (
    linkId: string,
    subType: 'visual' | 'collision',
    objectIndex?: number,
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
  currentFileName?: string;
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
  currentFileName,
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
  onSwitchToProMode,
  onRequestSwitchToStructure,
  isReadOnly = false,
}) => {
  const t = translations[lang];
  const {
    sidebarTab,
    setSidebarTab,
    structureTreeShowGeometryDetails,
    setStructureTreeShowGeometryDetails,
  } = useUIStore(
    useShallow((state) => ({
      sidebarTab: state.sidebarTab,
      setSidebarTab: state.setSidebarTab,
      structureTreeShowGeometryDetails: state.structureTreeShowGeometryDetails,
      setStructureTreeShowGeometryDetails: state.setStructureTreeShowGeometryDetails,
    })),
  );
  const { toggleComponentVisibility, initAssembly } = useAssemblyStore(
    useShallow((state) => ({
      toggleComponentVisibility: state.toggleComponentVisibility,
      initAssembly: state.initAssembly,
    })),
  );

  const {
    width,
    fileBrowserHeight,
    isDragging,
    isFileBrowserOpen,
    isStructureOpen,
    setIsFileBrowserOpen,
    setIsStructureOpen,
    handleHorizontalResizeStart,
    handleVerticalResizeStart,
  } = useTreeEditorLayout();

  const isProMode = sidebarTab === 'workspace';
  const isAssemblyView = !isReadOnly && sidebarTab === 'workspace' && Boolean(assemblyState);

  const handleSwitchToProMode = useCallback(() => {
    unstable_batchedUpdates(() => {
      onSwitchToProMode?.();
      if (!onSwitchToProMode && !assemblyState) {
        initAssembly(robot.name || 'assembly');
      }
      setSidebarTab('workspace');
    });
  }, [assemblyState, initAssembly, onSwitchToProMode, robot.name, setSidebarTab]);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [editingFolderPath, setEditingFolderPath] = useState<string | null>(null);
  const [folderRenameDraft, setFolderRenameDraft] = useState('');
  const folderRenameInputRef = useRef<HTMLInputElement>(null);
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number;
    y: number;
    target: LibraryDeleteTarget;
  } | null>(null);
  const [isDeleteAllLibraryDialogOpen, setIsDeleteAllLibraryDialogOpen] = useState(false);
  const [isGenerateSwitchDialogOpen, setIsGenerateSwitchDialogOpen] = useState(false);
  const [isStructureSwitchPending, setIsStructureSwitchPending] = useState(false);

  const nameLabel = sidebarTab === 'workspace' && assemblyState ? t.projectName : t.robotName;
  const currentName = sidebarTab === 'workspace' && assemblyState ? assemblyState.name : robot.name;
  const namePlaceholder =
    sidebarTab === 'workspace' && assemblyState ? t.enterProjectName : t.enterRobotName;
  const showStructureFilePath = Boolean(
    currentFileName && (sidebarTab === 'structure' || isReadOnly),
  );
  const robotSelection = useSelectionStore((state) => state.selection);

  const browserAvailableFiles = availableFiles;
  const fileTree = useMemo(() => buildFileTree(browserAvailableFiles), [browserAvailableFiles]);
  const treeRobot = useMemo<RobotState>(() => {
    if (isAssemblyView) {
      return {
        name: '',
        links: {},
        joints: {},
        rootLinkId: '',
        selection: { type: null, id: null },
      };
    }

    return robot;
  }, [isAssemblyView, robot]);
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
    () => (isAssemblyView ? {} : buildChildJointsByParent(robot.joints)),
    [isAssemblyView, robot.joints],
  );
  const parentLinkByChild = useMemo(
    () => (isAssemblyView ? {} : buildParentLinkByChild(robot.joints)),
    [isAssemblyView, robot.joints],
  );
  const selectionBranchLinkIds = useMemo(() => {
    if (isAssemblyView) {
      return new Set<string>();
    }

    const branch = new Set<string>();
    let currentLinkId: string | null = null;

    if (robotSelection.type === 'link' && robotSelection.id) {
      currentLinkId = robotSelection.id;
    } else if (robotSelection.type === 'joint' && robotSelection.id) {
      currentLinkId = robot.joints[robotSelection.id]?.parentLinkId ?? null;
    }

    while (currentLinkId) {
      branch.add(currentLinkId);
      currentLinkId = parentLinkByChild[currentLinkId] ?? null;
    }

    return branch;
  }, [isAssemblyView, parentLinkByChild, robot.joints, robotSelection.id, robotSelection.type]);
  const treeRootLinkIds = useMemo(
    () => (isAssemblyView ? [] : getTreeRenderRootLinkIds(robot)),
    [isAssemblyView, robot.joints, robot.links, robot.rootLinkId],
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
    if (!isProMode) {
      setFileContextMenu(null);
    }
  }, [isProMode]);

  useEffect(() => {
    if (availableFiles.length === 0) {
      setIsDeleteAllLibraryDialogOpen(false);
    }
  }, [availableFiles.length]);

  useEffect(() => {
    if (!isEditingName) return;

    const id = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(id);
  }, [isEditingName]);

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

  const startNameEditing = useCallback(() => {
    setNameDraft(currentName || '');
    setIsEditingName(true);
  }, [currentName]);

  const cancelNameEditing = useCallback(() => {
    setNameDraft('');
    setIsEditingName(false);
  }, []);

  const commitNameEditing = useCallback(() => {
    const nextName = nameDraft.trim();
    if (nextName && nextName !== currentName) {
      onNameChange(nextName);
    }
    setNameDraft('');
    setIsEditingName(false);
  }, [currentName, nameDraft, onNameChange]);

  const handleFileContextMenu = useCallback(
    (event: React.MouseEvent, file: RobotFile) => {
      event.preventDefault();
      event.stopPropagation();

      const supportsExport = isLibraryRobotExportableFormat(file.format);
      const actionCount =
        (isProMode ? 1 : 0) + (supportsExport ? 1 : 0) + (onDeleteLibraryFile ? 1 : 0);
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
    [isProMode, onDeleteLibraryFile],
  );

  const handleFolderContextMenu = useCallback(
    (event: React.MouseEvent, folderPath: string) => {
      event.preventDefault();
      event.stopPropagation();

      if (!onDeleteLibraryFolder && !onRenameLibraryFolder) {
        return;
      }

      const menuWidth = 180;
      const menuHeight = 76;
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

  const handleAddFileToAssembly = useCallback(() => {
    if (!fileContextMenu || fileContextMenu.target.type !== 'file' || !onAddComponent) return;
    onAddComponent(fileContextMenu.target.file);
    setFileContextMenu(null);
  }, [fileContextMenu, onAddComponent]);

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
        if (!onDeleteLibraryFile) return;
        onDeleteLibraryFile(target.file);
      } else {
        if (!onDeleteLibraryFolder) return;
        onDeleteLibraryFolder(target.path);
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

  const handleRequestStructureSwitch = useCallback(
    async (intent: 'direct' | 'generate' | 'skip-generate') => {
      if (!onRequestSwitchToStructure) {
        if (intent !== 'direct') {
          setIsGenerateSwitchDialogOpen(false);
        }
        setSidebarTab('structure');
        return;
      }

      setIsStructureSwitchPending(true);
      try {
        const result = await onRequestSwitchToStructure(intent);
        if (result === 'needs-generate-confirm') {
          setIsGenerateSwitchDialogOpen(true);
          return;
        }

        if (result === 'switched') {
          setIsGenerateSwitchDialogOpen(false);
        }
      } finally {
        setIsStructureSwitchPending(false);
      }
    },
    [onRequestSwitchToStructure, setSidebarTab],
  );

  const actualWidth = collapsed ? 0 : width;
  const shouldFileBrowserFillSpace = isFileBrowserOpen && !isStructureOpen;
  const canDeleteAllLibraryFiles = Boolean(onDeleteAllLibraryFiles && availableFiles.length > 0);

  return (
    <div
      className={`bg-element-bg dark:bg-panel-bg border-r border-border-black flex flex-col h-full shrink-0 relative ${isDragging ? '' : 'transition-[width,min-width,flex] duration-200 ease-out'}`}
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
        isProMode={isProMode}
        simpleModeLabel={t.simpleMode}
        proModeLabel={t.proMode}
        collapseTitle={t.collapseSidebar}
        expandTitle={t.structure}
        nameLabel={nameLabel}
        currentName={currentName}
        namePlaceholder={namePlaceholder}
        isEditingName={isEditingName}
        nameDraft={nameDraft}
        nameInputRef={nameInputRef}
        onSwitchToStructure={() => {
          void handleRequestStructureSwitch('direct');
        }}
        onSwitchToWorkspace={handleSwitchToProMode}
        onNameDraftChange={setNameDraft}
        onStartNameEditing={startNameEditing}
        onCommitNameEditing={commitNameEditing}
        onCancelNameEditing={cancelNameEditing}
      />

      {!collapsed && (
        <div className="flex flex-col h-full overflow-hidden w-full relative">
          <TreeEditorFileBrowserPanel
            isOpen={isFileBrowserOpen}
            isDragging={isDragging}
            isProMode={isProMode}
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
            onToggleOpen={() => setIsFileBrowserOpen(!isFileBrowserOpen)}
            onDeleteAll={() => {
              setFileContextMenu(null);
              setIsDeleteAllLibraryDialogOpen(true);
            }}
            onFolderRenameDraftChange={setFolderRenameDraft}
            onCommitFolderRename={handleCommitFolderRename}
            onCancelFolderRename={handleCancelFolderRename}
            onLoadRobot={onLoadRobot}
            onAddComponent={onAddComponent}
            onDeleteFromLibrary={
              onDeleteLibraryFile || onDeleteLibraryFolder ? handleDeleteFromLibrary : undefined
            }
            onFileContextMenu={handleFileContextMenu}
            onFolderContextMenu={handleFolderContextMenu}
            toggleFolder={toggleFolder}
          />

          {isFileBrowserOpen && isStructureOpen && (
            <div
              className="h-1 bg-border-black/80 cursor-row-resize hover:bg-system-blue/40 transition-colors shrink-0 z-10"
              onMouseDown={handleVerticalResizeStart}
            />
          )}

          <TreeEditorStructureSection
            isOpen={isStructureOpen}
            isAssemblyView={isAssemblyView}
            structureTreeShowGeometryDetails={structureTreeShowGeometryDetails}
            showVisual={showVisual}
            showStructureFilePath={showStructureFilePath}
            currentFileName={currentFileName}
            mode={mode}
            assemblyState={assemblyState}
            robot={treeRobot}
            treeRootLinkIds={treeRootLinkIds}
            childJointsByParent={childJointsByParent}
            selectionBranchLinkIds={selectionBranchLinkIds}
            t={t}
            onToggleOpen={() => setIsStructureOpen(!isStructureOpen)}
            onToggleGeometryDetails={() =>
              setStructureTreeShowGeometryDetails(!structureTreeShowGeometryDetails)
            }
            onAddChildFromSelection={() => {
              let targetId = getPrimaryTreeRenderRootLinkId(robot) ?? robot.rootLinkId;
              if (robotSelection.type === 'link' && robotSelection.id) {
                targetId = robotSelection.id;
              } else if (robotSelection.type === 'joint' && robotSelection.id) {
                const selectedJoint = robot.joints[robotSelection.id];
                if (selectedJoint) {
                  targetId = selectedJoint.childLinkId;
                }
              }
              onAddChild(targetId);
            }}
            onToggleVisuals={() => setShowVisual(!showVisual)}
            onSelect={onSelect}
            onSelectGeometry={onSelectGeometry}
            onFocus={onFocus}
            onAddChild={onAddChild}
            onAddCollisionBody={onAddCollisionBody}
            onDelete={onDelete}
            onUpdate={onUpdate}
            onRenameAssembly={onRenameAssembly ?? onNameChange}
            onRemoveComponent={onRemoveComponent}
            onRemoveBridge={onRemoveBridge}
            onRenameComponent={onRenameComponent}
            onCreateBridge={onCreateBridge}
            onToggleComponentVisibility={toggleComponentVisibility}
            isReadOnly={isReadOnly}
          />

          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-system-blue/40 transition-colors z-20"
            onMouseDown={handleHorizontalResizeStart}
          />
        </div>
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
        showAddAction={isProMode && fileContextMenu?.target.type === 'file'}
        showRenameAction={Boolean(
          fileContextMenu?.target.type === 'folder' && onRenameLibraryFolder,
        )}
        showExportAction={
          fileContextMenu?.target.type === 'file' &&
          isLibraryRobotExportableFormat(fileContextMenu.target.file.format)
        }
        showDeleteAction={Boolean(
          (fileContextMenu?.target.type === 'folder' && onDeleteLibraryFolder) ||
          (fileContextMenu?.target.type === 'file' && onDeleteLibraryFile),
        )}
        onDelete={() => {
          if (fileContextMenu?.target) {
            handleDeleteFromLibrary(fileContextMenu.target);
          }
        }}
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
        isOpen={isGenerateSwitchDialogOpen}
        onClose={() => {
          if (!isStructureSwitchPending) {
            setIsGenerateSwitchDialogOpen(false);
          }
        }}
        title={t.generateWorkspaceUrdfConfirmTitle}
        width="w-[460px]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsGenerateSwitchDialogOpen(false)}
              disabled={isStructureSwitchPending}
            >
              {t.cancel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void handleRequestStructureSwitch('skip-generate');
              }}
              disabled={isStructureSwitchPending}
            >
              {t.switchToSimpleWithoutGenerate}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleRequestStructureSwitch('generate');
              }}
              isLoading={isStructureSwitchPending}
            >
              {t.generateAndSwitchToSimpleMode}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-text-secondary">
          {t.generateWorkspaceUrdfConfirmMessage}
        </p>
      </Dialog>
    </div>
  );
};
