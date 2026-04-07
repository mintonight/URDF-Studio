import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { MeasureAnchorMode, MeasureState, ToolMode } from '../types';
import {
  addMeasureGroup,
  clearMeasureState,
  clearMeasureSlot,
  getActiveMeasureGroup,
  getActiveMeasureMeasurement,
  getMeasureStateMeasurements,
  removeMeasureGroup,
  setActiveMeasureGroup,
  setActiveMeasureSlot,
} from '../utils/measurements';
import { Language, translations } from '@/shared/i18n';
import { OptionsPanel } from '@/shared/components/Panel/OptionsPanel';
import { SegmentedControl, Switch } from '@/shared/components/ui';
import { useSelectionStore } from '@/store/selectionStore';

interface MeasurePanelProps {
  toolMode: ToolMode;
  measurePanelRef: React.RefObject<HTMLDivElement>;
  measurePanelPos: { x: number; y: number } | null;
  onMouseDown: (e: React.MouseEvent) => void;
  onClose: () => void;
  measureState: MeasureState;
  setMeasureState: React.Dispatch<React.SetStateAction<MeasureState>>;
  measureAnchorMode: MeasureAnchorMode;
  setMeasureAnchorMode: React.Dispatch<React.SetStateAction<MeasureAnchorMode>>;
  showMeasureDecomposition: boolean;
  setShowMeasureDecomposition: React.Dispatch<React.SetStateAction<boolean>>;
  lang: Language;
}

function formatMeasureTarget(
  target: ReturnType<typeof getActiveMeasureGroup>['first'],
  t: (typeof translations)['en'],
): string {
  if (!target) {
    return t.measureSlotEmpty;
  }

  return target.linkName;
}

function formatMeasureDistance(value: number, signed = false): string {
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(4)}m`;
}

function MeasureSlotChip({
  indexLabel,
  title,
  target,
  isActive,
  onActivate,
  onClear,
  clearLabel,
}: {
  indexLabel: '1' | '2';
  title: string;
  target: ReturnType<typeof getActiveMeasureGroup>['first'];
  isActive: boolean;
  onActivate: () => void;
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
      className={`flex w-full items-center gap-1.5 rounded-[8px] border px-1.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
        isActive
          ? 'border-system-blue/75 bg-system-blue/10 shadow-[inset_0_0_0_1px_rgba(0,122,255,0.06)]'
          : target
            ? 'border-system-blue/25 bg-system-blue/5 hover:border-system-blue/40 hover:bg-system-blue/8'
            : 'border-border-black/60 bg-panel-bg hover:bg-element-hover'
      }`}
    >
      <span
        className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border text-[9px] font-semibold ${
          isActive
            ? 'border-system-blue bg-system-blue-solid text-white'
            : 'border-border-black/60 bg-element-bg text-text-secondary'
        }`}
      >
        {indexLabel}
      </span>

      <span
        className={`min-w-0 flex-1 truncate text-[10px] leading-[1.2] ${
          target
            ? 'font-medium text-text-primary'
            : isActive
              ? 'text-system-blue'
              : 'text-text-secondary'
        }`}
      >
        {target ? target.linkName : title}
      </span>

      {target && (
        <button
          type="button"
          className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] text-text-tertiary transition-colors hover:bg-element-hover hover:text-text-primary"
          aria-label={clearLabel}
          onClick={(event) => {
            event.stopPropagation();
            onClear();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onClear();
            }
          }}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

export const MeasurePanel: React.FC<MeasurePanelProps> = ({
  toolMode,
  measurePanelRef,
  measurePanelPos,
  onMouseDown,
  onClose,
  measureState,
  setMeasureState,
  measureAnchorMode,
  setMeasureAnchorMode,
  showMeasureDecomposition,
  setShowMeasureDecomposition,
  lang,
}) => {
  const t = translations[lang];
  const [isCollapsed, setIsCollapsed] = useState(false);
  const setSelection = useSelectionStore((state) => state.setSelection);
  const setHoveredSelection = useSelectionStore((state) => state.setHoveredSelection);

  const activeGroup = useMemo(() => getActiveMeasureGroup(measureState), [measureState]);
  const activeMeasurement = useMemo(
    () => getActiveMeasureMeasurement(measureState),
    [measureState],
  );
  const completedMeasurements = useMemo(
    () => getMeasureStateMeasurements(measureState),
    [measureState],
  );
  const canClearAll = useMemo(
    () =>
      measureState.groups.length > 1 ||
      measureState.groups.some((group) => group.first || group.second),
    [measureState],
  );
  const measureAnchorOptions = useMemo(
    () =>
      [
        { label: t.measureAnchorFrame, value: 'frame' },
        { label: t.measureAnchorCenterOfMass, value: 'centerOfMass' },
        { label: t.measureAnchorGeometry, value: 'geometry' },
      ] as const,
    [t.measureAnchorCenterOfMass, t.measureAnchorFrame, t.measureAnchorGeometry],
  );

  const resetViewportSelection = () => {
    setSelection({ type: null, id: null });
    setHoveredSelection({ type: null, id: null });
  };

  if (toolMode !== 'measure') return null;

  return (
    <OptionsPanel
      title={t.measureTool}
      show={true}
      panelRef={measurePanelRef}
      position={measurePanelPos}
      defaultPosition={{ right: '16px', bottom: '16px' }}
      isCollapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
      onClose={onClose}
      onMouseDown={onMouseDown}
      width="12.5rem"
      maxHeight={420}
      zIndex={50}
      panelClassName="measure-panel"
    >
      <div className="space-y-[5px] p-[5px]">
        <div className="rounded-md border border-border-black/60 bg-panel-bg p-1">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-[0.02em] text-text-tertiary">
              {t.measureGroups}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-md border border-border-black/60 bg-element-bg px-1.5 py-px text-[9px] font-medium text-text-secondary transition-colors hover:border-danger-border hover:bg-danger-soft hover:text-danger-hover disabled:border-transparent disabled:bg-transparent disabled:text-text-tertiary disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setMeasureState(clearMeasureState);
                  resetViewportSelection();
                }}
                disabled={!canClearAll}
              >
                {t.clearAll}
              </button>
              <button
                type="button"
                className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-md border border-border-black/60 bg-element-bg text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary"
                title={t.measureAddGroup}
                aria-label={t.measureAddGroup}
                onClick={() => setMeasureState((prev) => addMeasureGroup(prev))}
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {measureState.groups.map((group, index) => {
              const isActive = group.id === measureState.activeGroupId;
              const isComplete = Boolean(group.first && group.second);

              return (
                <div
                  key={group.id}
                  className={`group inline-flex items-stretch overflow-hidden rounded-md border transition-colors ${
                    isActive
                      ? 'border-system-blue bg-system-blue/10'
                      : isComplete
                        ? 'border-danger-border bg-danger-soft/70'
                        : 'border-border-black/60 bg-element-bg'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setMeasureState((prev) => setActiveMeasureGroup(prev, group.id))}
                    className={`px-1.5 py-px text-[9px] font-medium transition-colors ${
                      isActive
                        ? 'text-system-blue'
                        : isComplete
                          ? 'text-text-primary hover:bg-danger-soft'
                          : 'text-text-secondary hover:bg-element-hover hover:text-text-primary'
                    }`}
                  >
                    {t.measureGroupLabel.replace('{index}', String(index + 1))}
                  </button>
                  <button
                    type="button"
                    className={`inline-flex h-[18px] w-[18px] items-center justify-center border-l text-text-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                      isActive
                        ? 'border-system-blue/20 hover:bg-danger-soft hover:text-danger-hover'
                        : isComplete
                          ? 'border-danger-border hover:bg-danger-soft hover:text-danger-hover'
                          : 'border-border-black/60 hover:bg-danger-soft hover:text-danger-hover'
                    }`}
                    title={t.measureRemoveGroup}
                    aria-label={t.measureRemoveGroup}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMeasureState((prev) => removeMeasureGroup(prev, group.id));
                      resetViewportSelection();
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-1">
          <MeasureSlotChip
            indexLabel="1"
            title={formatMeasureTarget(activeGroup.first, t)}
            target={activeGroup.first}
            isActive={activeGroup.activeSlot === 'first'}
            onActivate={() => setMeasureState((prev) => setActiveMeasureSlot(prev, 'first'))}
            onClear={() => {
              setMeasureState((prev) => clearMeasureSlot(prev, 'first'));
              resetViewportSelection();
            }}
            clearLabel={t.measureClearSelection}
          />
          <MeasureSlotChip
            indexLabel="2"
            title={formatMeasureTarget(activeGroup.second, t)}
            target={activeGroup.second}
            isActive={activeGroup.activeSlot === 'second'}
            onActivate={() => setMeasureState((prev) => setActiveMeasureSlot(prev, 'second'))}
            onClear={() => {
              setMeasureState((prev) => clearMeasureSlot(prev, 'second'));
              resetViewportSelection();
            }}
            clearLabel={t.measureClearSelection}
          />
        </div>

        <div className="flex items-center justify-between rounded-md bg-element-bg px-1.5 py-[3px] text-[9px] text-text-secondary">
          <span>{t.measuredCount.replace('{count}', String(completedMeasurements.length))}</span>
          <span className="font-mono text-text-tertiary">Esc / Del</span>
        </div>

        <div className="flex items-center gap-1.5 rounded-md border border-border-black/60 bg-element-bg px-1.5 py-1">
          <span className="shrink-0 text-[10px] font-semibold tracking-[0.02em] text-text-tertiary">
            {t.measureAnchorMode}
          </span>
          <div className="min-w-0 flex-1 flex justify-end">
            <SegmentedControl
              size="xs"
              stretch={false}
              className="max-w-full [&>button]:!gap-0.5 [&>button]:!px-1.5 [&>button]:!py-0.5 [&>button]:min-h-5 [&>button]:whitespace-nowrap"
              options={measureAnchorOptions}
              value={measureAnchorMode}
              onChange={(value) => setMeasureAnchorMode(value)}
            />
          </div>
        </div>

        <div className="rounded-md border border-border-black/60 bg-panel-bg p-1">
          <Switch
            checked={showMeasureDecomposition}
            onChange={setShowMeasureDecomposition}
            label={t.measureShowDecomposition}
            size="sm"
          />

          <div className="mt-1 rounded-md bg-element-bg px-1.5 py-[5px]">
            <div className="mb-1 text-[10px] font-semibold tracking-[0.02em] text-text-tertiary">
              {t.measureResult}
            </div>

            {activeMeasurement ? (
              <div className="space-y-1 text-[10px]">
                <div className="mb-1 text-[10px] text-text-tertiary">
                  {t.measureGroupLabel.replace('{index}', String(activeMeasurement.groupIndex))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-secondary">{t.measureTotalDistance}</span>
                  <span className="font-mono text-text-primary">
                    {formatMeasureDistance(activeMeasurement.distance)}
                  </span>
                </div>

                {showMeasureDecomposition && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-orange-400">{t.measureDeltaX}</span>
                      <span className="font-mono text-orange-300">
                        {formatMeasureDistance(activeMeasurement.delta.x, true)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-green-400">{t.measureDeltaY}</span>
                      <span className="font-mono text-green-300">
                        {formatMeasureDistance(activeMeasurement.delta.y, true)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-blue-400">{t.measureDeltaZ}</span>
                      <span className="font-mono text-blue-300">
                        {formatMeasureDistance(activeMeasurement.delta.z, true)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="text-[10px] text-text-secondary">{t.measureNoMeasurement}</div>
            )}
          </div>
        </div>
      </div>
    </OptionsPanel>
  );
};
