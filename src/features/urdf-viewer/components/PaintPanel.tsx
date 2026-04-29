import React, { useMemo, useState } from 'react';
import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { WORKSPACE_OVERLAY_RIGHT_EDGE_GAP } from '@/shared/components/3d/scene';
import { OptionsPanel } from '@/shared/components/Panel/OptionsPanel';
import type {
  ToolMode,
  ViewerPaintOperation,
  ViewerPaintSelectionScope,
  ViewerPaintStatus,
} from '../types';

interface PaintPanelProps {
  lang: Language;
  toolMode: ToolMode;
  paintColor: string;
  onPaintColorChange: (color: string) => void;
  paintSelectionScope: ViewerPaintSelectionScope;
  onPaintSelectionScopeChange: (scope: ViewerPaintSelectionScope) => void;
  paintOperation: ViewerPaintOperation;
  onPaintOperationChange: (operation: ViewerPaintOperation) => void;
  paintStatus: ViewerPaintStatus | null;
  supported: boolean;
  onClose: () => void;
}

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(normalized)) {
    return null;
  }

  return `#${normalized}`;
}

function getStatusClassName(tone: ViewerPaintStatus['tone']) {
  switch (tone) {
    case 'success':
      return 'border-green-500/30 bg-green-500/10 text-green-100';
    case 'error':
      return 'border-danger-border bg-danger-soft text-danger-hover';
    case 'info':
    default:
      return 'border-system-blue/20 bg-system-blue/10 text-text-primary';
  }
}

export const PaintPanel: React.FC<PaintPanelProps> = ({
  lang,
  toolMode,
  paintColor,
  onPaintColorChange,
  paintSelectionScope,
  onPaintSelectionScopeChange,
  paintOperation,
  onPaintOperationChange,
  paintStatus,
  supported,
  onClose,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hexInputValue, setHexInputValue] = useState(paintColor);
  const t = translations[lang];
  const status = useMemo<ViewerPaintStatus>(
    () =>
      paintStatus ??
      (supported
        ? { tone: 'info', message: t.paintStatusReady }
        : { tone: 'error', message: t.paintUnsupportedRobotOnly }),
    [paintStatus, supported, t.paintStatusReady, t.paintUnsupportedRobotOnly],
  );

  React.useEffect(() => {
    setHexInputValue(paintColor);
  }, [paintColor]);

  if (toolMode !== 'paint') {
    return null;
  }

  return (
    <OptionsPanel
      title={t.paintTool}
      show={true}
      isCollapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed((previous) => !previous)}
      onClose={onClose}
      defaultPosition={{ right: WORKSPACE_OVERLAY_RIGHT_EDGE_GAP, bottom: '16px' }}
      width="14rem"
      maxHeight={320}
      zIndex={50}
      panelClassName="paint-panel"
      expandText={t.expand}
      collapseText={t.collapse}
      closeText={t.close}
    >
      <div className="space-y-3 p-[10px]">
        <p className="text-[10px] leading-4 text-text-secondary">{t.paintToolHint}</p>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary">
            {t.paintColor}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={paintColor}
              disabled={!supported}
              onChange={(event) => {
                const nextColor = normalizeHexColor(event.target.value);
                if (!nextColor) {
                  return;
                }

                setHexInputValue(nextColor);
                onPaintColorChange(nextColor);
              }}
              className="h-9 w-9 rounded border border-border-black/60 bg-panel-bg p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <input
              type="text"
              value={hexInputValue}
              disabled={!supported}
              onChange={(event) => {
                const nextValue = event.target.value;
                setHexInputValue(nextValue);

                const normalized = normalizeHexColor(nextValue);
                if (normalized) {
                  onPaintColorChange(normalized);
                }
              }}
              className="min-w-0 flex-1 rounded border border-border-black/60 bg-element-bg px-2 py-1.5 font-mono text-[11px] text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              spellCheck={false}
              placeholder="#ff6c0a"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary">
            {t.paintSelectionScope}
          </label>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                { id: 'face', label: t.paintSelectionFace },
                { id: 'island', label: t.paintSelectionIsland },
              ] as const
            ).map((option) => {
              const active = paintSelectionScope === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={!supported}
                  onClick={() => onPaintSelectionScopeChange(option.id)}
                  className={`rounded border px-2 py-1 text-[10px] font-medium transition ${
                    active
                      ? 'border-system-blue bg-system-blue/15 text-text-primary'
                      : 'border-border-black/60 bg-element-bg text-text-secondary'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary">
            {t.paintOperation}
          </label>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                { id: 'paint', label: t.paintOperationPaint },
                { id: 'erase', label: t.paintOperationErase },
              ] as const
            ).map((option) => {
              const active = paintOperation === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={!supported}
                  onClick={() => onPaintOperationChange(option.id)}
                  className={`rounded border px-2 py-1 text-[10px] font-medium transition ${
                    active
                      ? option.id === 'erase'
                        ? 'border-danger-border bg-danger-soft text-danger-hover'
                        : 'border-system-blue bg-system-blue/15 text-text-primary'
                      : 'border-border-black/60 bg-element-bg text-text-secondary'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={`rounded-md border px-2 py-1.5 text-[10px] leading-4 ${getStatusClassName(
            status.tone,
          )}`}
        >
          {status.message}
        </div>
      </div>
    </OptionsPanel>
  );
};
