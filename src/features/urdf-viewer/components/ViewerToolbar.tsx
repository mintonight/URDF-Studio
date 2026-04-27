import React from 'react';
import { createPortal } from 'react-dom';
import { Move, MousePointer2, View as ViewIcon, Scan, Ruler, Palette } from 'lucide-react';
import { translations } from '@/shared/i18n';
import { IconButton } from '@/shared/components/ui';
import { useOverlayHoverBlock } from '@/shared/hooks';
import type { ViewerToolbarProps, ToolMode } from '../types';

const HEADER_DOCK_SLOT_ID = 'viewer-toolbar-dock-slot';

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  activeMode,
  setMode,
  lang = 'en',
}) => {
  const { activateHoverBlock, deactivateHoverBlock } = useOverlayHoverBlock();
  const t = translations[lang];

  const tools = [
    { id: 'view', icon: ViewIcon, label: t.viewMode },
    { id: 'select', icon: MousePointer2, label: t.selectMode },
    { id: 'universal', icon: Move, label: t.transformMode },
    { id: 'paint', icon: Palette, label: t.paintMode },
    { id: 'face', icon: Scan, label: t.faceMode },
    { id: 'measure', icon: Ruler, label: t.measureMode },
  ];

  const toolbarContent = (
    <>
      {tools.map((tool) => {
        const isActive = activeMode === tool.id;
        const Icon = tool.icon;
        return (
          <IconButton
            key={tool.id}
            onClick={() => setMode(tool.id as ToolMode)}
            variant="toolbar"
            size="sm"
            isActive={isActive}
            aria-label={tool.label}
            title={tool.label}
            className="h-7 w-7 rounded-md"
          >
            <Icon className="h-4 w-4" />
          </IconButton>
        );
      })}
    </>
  );

  const toolbarClassName =
    'urdf-toolbar pointer-events-auto flex max-w-full items-center gap-0.5 border-x border-border-black/35 px-1.5 dark:border-border-black';

  const dockSlot =
    typeof document !== 'undefined' ? document.getElementById(HEADER_DOCK_SLOT_ID) : null;

  const toolbar = (
    <div
      className={toolbarClassName}
      onMouseEnter={activateHoverBlock}
      onMouseLeave={deactivateHoverBlock}
    >
      {toolbarContent}
    </div>
  );

  if (dockSlot) {
    return createPortal(toolbar, dockSlot);
  }

  return toolbar;
};
