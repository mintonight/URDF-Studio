import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useUIStore } from '@/store';
import { usePointerResize } from '@/shared/hooks/usePointerResize';

const TREE_SIDEBAR_MIN_WIDTH = 220;
const TREE_SIDEBAR_MAX_WIDTH = 520;
const TREE_FILE_BROWSER_MIN_HEIGHT = 40;
const TREE_FILE_BROWSER_MAX_HEIGHT = 420;
const TREE_JOINT_PANEL_MIN_HEIGHT = 40;
const TREE_JOINT_PANEL_MAX_HEIGHT = 420;
const TREE_EDITOR_FILE_BROWSER_SECTION_KEY = 'tree_editor_file_browser';
const TREE_EDITOR_STRUCTURE_SECTION_KEY = 'tree_editor_structure';

interface UseTreeEditorLayoutResult {
  width: number;
  fileBrowserHeight: number;
  jointPanelHeight: number;
  isDragging: boolean;
  isFileBrowserOpen: boolean;
  isStructureOpen: boolean;
  setIsFileBrowserOpen: (isOpen: boolean) => void;
  setIsStructureOpen: (isOpen: boolean) => void;
  handleHorizontalResizeStart: (event: ReactMouseEvent) => void;
  handleVerticalResizeStart: (event: ReactMouseEvent) => void;
  handleJointPanelResizeStart: (event: ReactMouseEvent) => void;
}

export function useTreeEditorLayout(): UseTreeEditorLayoutResult {
  const width = useUIStore((state) => state.panelLayout.treeSidebarWidth);
  const fileBrowserHeight = useUIStore((state) => state.panelLayout.treeFileBrowserHeight);
  const jointPanelHeight = useUIStore((state) => state.panelLayout.treeJointPanelHeight);
  const panelSections = useUIStore((state) => state.panelSections);
  const setPanelLayout = useUIStore((state) => state.setPanelLayout);
  const setPanelSection = useUIStore((state) => state.setPanelSection);
  const isFileBrowserOpen = !(panelSections[TREE_EDITOR_FILE_BROWSER_SECTION_KEY] ?? false);
  const isStructureOpen = !(panelSections[TREE_EDITOR_STRUCTURE_SECTION_KEY] ?? false);

  const setIsFileBrowserOpen = useCallback(
    (isOpen: boolean) => {
      setPanelSection(TREE_EDITOR_FILE_BROWSER_SECTION_KEY, !isOpen);
    },
    [setPanelSection],
  );

  const setIsStructureOpen = useCallback(
    (isOpen: boolean) => {
      setPanelSection(TREE_EDITOR_STRUCTURE_SECTION_KEY, !isOpen);
    },
    [setPanelSection],
  );

  const horizontalResize = usePointerResize({
    axis: 'x',
    cursor: 'col-resize',
    min: TREE_SIDEBAR_MIN_WIDTH,
    max: TREE_SIDEBAR_MAX_WIDTH,
    value: width,
    onChange: (nextWidth) => setPanelLayout('treeSidebarWidth', nextWidth),
  });

  const verticalResize = usePointerResize({
    axis: 'y',
    cursor: 'row-resize',
    min: TREE_FILE_BROWSER_MIN_HEIGHT,
    max: TREE_FILE_BROWSER_MAX_HEIGHT,
    value: fileBrowserHeight,
    onChange: (nextHeight) => setPanelLayout('treeFileBrowserHeight', nextHeight),
  });

  const jointPanelResize = usePointerResize({
    axis: 'y',
    cursor: 'row-resize',
    min: TREE_JOINT_PANEL_MIN_HEIGHT,
    max: TREE_JOINT_PANEL_MAX_HEIGHT,
    value: jointPanelHeight,
    onChange: (nextHeight) => setPanelLayout('treeJointPanelHeight', nextHeight),
  });

  return {
    width,
    fileBrowserHeight,
    jointPanelHeight,
    isDragging:
      horizontalResize.isDragging || verticalResize.isDragging || jointPanelResize.isDragging,
    isFileBrowserOpen,
    isStructureOpen,
    setIsFileBrowserOpen,
    setIsStructureOpen,
    handleHorizontalResizeStart: horizontalResize.handleResizeStart,
    handleVerticalResizeStart: verticalResize.handleResizeStart,
    handleJointPanelResizeStart: jointPanelResize.handleResizeStart,
  };
}
