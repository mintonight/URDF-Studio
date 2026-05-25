import React from 'react';
import { Download, Edit3, Plus } from 'lucide-react';
import { ContextMenuFrame, ContextMenuItem } from '@/shared/components/ui';

export interface FileTreeContextMenuProps {
  position: { x: number; y: number } | null;
  addLabel?: string;
  renameLabel?: string;
  exportLabel?: string;
  onAdd?: () => void;
  onRename?: () => void;
  onExport?: () => void;
  showAddAction?: boolean;
  showRenameAction?: boolean;
  showExportAction?: boolean;
}

export const FileTreeContextMenu: React.FC<FileTreeContextMenuProps> = ({
  position,
  addLabel,
  renameLabel,
  exportLabel,
  onAdd,
  onRename,
  onExport,
  showAddAction = true,
  showRenameAction = false,
  showExportAction = false,
}) => {
  if (!position) return null;
  if (!showAddAction && !showRenameAction && !showExportAction) return null;

  return (
    <ContextMenuFrame position={position} widthClassName="w-44">
      {showAddAction && addLabel && onAdd && (
        <ContextMenuItem onClick={onAdd} icon={<Plus size={12} />}>
          {addLabel}
        </ContextMenuItem>
      )}
      {showRenameAction && renameLabel && onRename && (
        <ContextMenuItem onClick={onRename} icon={<Edit3 size={12} />}>
          {renameLabel}
        </ContextMenuItem>
      )}
      {showExportAction && exportLabel && onExport && (
        <ContextMenuItem onClick={onExport} icon={<Download size={12} />}>
          {exportLabel}
        </ContextMenuItem>
      )}
    </ContextMenuFrame>
  );
};
