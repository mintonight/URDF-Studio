import React, { useCallback } from 'react';
import { Move, ArrowUpRight, Crosshair } from 'lucide-react';
import {
  CheckboxOption,
  GroundPlaneControls,
  SliderOption,
  OptionsPanelContainer,
  OptionsPanelHeader,
  OptionsPanelContent,
  ToggleSliderOption,
} from '@/shared/components/Panel/OptionsPanel';

interface ViewerOptionsPanelProps {
  showOptionsPanel: boolean;
  optionsPanelRef: React.RefObject<HTMLDivElement>;
  optionsPanelPos: { x: number; y: number } | null;
  defaultPosition?: {
    top?: string;
    right?: string;
    left?: string;
    bottom?: string;
    transform?: string;
  };
  onMouseDown: (e: React.MouseEvent) => void;
  t: any;
  isOptionsCollapsed: boolean;
  toggleOptionsCollapsed: () => void;
  setShowOptionsPanel?: (show: boolean) => void;
  showVisual: boolean;
  setShowVisual: (show: boolean) => void;
  showCollision: boolean;
  setShowCollision: (show: boolean) => void;
  showIkHandles: boolean;
  setShowIkHandles: (show: boolean) => void;
  showIkHandlesAlwaysOnTop: boolean;
  setShowIkHandlesAlwaysOnTop: (show: boolean) => void;
  showCollisionAlwaysOnTop: boolean;
  setShowCollisionAlwaysOnTop: (show: boolean) => void;
  modelOpacity: number;
  setModelOpacity: (opacity: number) => void;
  showOrigins: boolean;
  setShowOrigins: (show: boolean) => void;
  showOriginsOverlay: boolean;
  setShowOriginsOverlay: (show: boolean) => void;
  originSize: number;
  setOriginSize: (size: number) => void;
  showMjcfSiteToggle?: boolean;
  showMjcfSites: boolean;
  setShowMjcfSites: (show: boolean) => void;
  showJointAxes: boolean;
  setShowJointAxes: (show: boolean) => void;
  showJointAxesOverlay: boolean;
  setShowJointAxesOverlay: (show: boolean) => void;
  jointAxisSize: number;
  setJointAxisSize: (size: number) => void;
  showCenterOfMass: boolean;
  setShowCenterOfMass: (show: boolean) => void;
  showCoMOverlay: boolean;
  setShowCoMOverlay: (show: boolean) => void;
  centerOfMassSize: number;
  setCenterOfMassSize: (size: number) => void;
  showInertia: boolean;
  setShowInertia: (show: boolean) => void;
  showInertiaOverlay: boolean;
  setShowInertiaOverlay: (show: boolean) => void;
  onAutoFitGround?: () => void;
  groundPlaneOffset: number;
  groundPlaneOffsetReadOnly?: boolean;
  setGroundPlaneOffset: (value: number) => void;
}

interface OverlayToggleButtonProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

function OverlayToggleButton({ active, label, onClick }: OverlayToggleButtonProps) {
  return (
    <button
      type="button"
      className={`rounded p-0.5 transition-colors ${active ? 'bg-system-blue/10 text-system-blue dark:bg-system-blue/20' : 'text-text-tertiary hover:text-text-secondary'}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
        />
      </svg>
    </button>
  );
}

interface OverlayToggleOptionProps {
  checked: boolean;
  className?: string;
  icon: React.ReactNode;
  label: string;
  onChange: (checked: boolean) => void;
  onToggleOverlay: () => void;
  overlayActive: boolean;
  overlayLabel: string;
  sliderConfig?: {
    decimals?: number;
    label: string;
    max: number;
    min: number;
    onChange: (value: number) => void;
    step: number;
    value: number;
  };
}

function OverlayToggleOption({
  checked,
  className,
  icon,
  label,
  onChange,
  onToggleOverlay,
  overlayActive,
  overlayLabel,
  sliderConfig,
}: OverlayToggleOptionProps) {
  return (
    <ToggleSliderOption
      checked={checked}
      onChange={onChange}
      label={label}
      icon={icon}
      className={className}
      rowClassName="pr-1"
      trailingControl={
        checked ? (
          <OverlayToggleButton
            active={overlayActive}
            label={overlayLabel}
            onClick={onToggleOverlay}
          />
        ) : undefined
      }
      sliderConfig={
        sliderConfig
          ? {
              label: sliderConfig.label,
              value: sliderConfig.value,
              onChange: sliderConfig.onChange,
              min: sliderConfig.min,
              max: sliderConfig.max,
              step: sliderConfig.step,
              decimals: sliderConfig.decimals,
              compact: true,
              indent: false,
            }
          : undefined
      }
    />
  );
}

export const ViewerOptionsPanel: React.FC<ViewerOptionsPanelProps> = ({
  showOptionsPanel,
  optionsPanelRef,
  optionsPanelPos,
  defaultPosition,
  onMouseDown,
  t,
  isOptionsCollapsed,
  toggleOptionsCollapsed,
  setShowOptionsPanel,
  showVisual,
  setShowVisual,
  showCollision,
  setShowCollision,
  showIkHandles,
  setShowIkHandles,
  showIkHandlesAlwaysOnTop,
  setShowIkHandlesAlwaysOnTop,
  showCollisionAlwaysOnTop,
  setShowCollisionAlwaysOnTop,
  modelOpacity,
  setModelOpacity,
  showOrigins,
  setShowOrigins,
  showOriginsOverlay,
  setShowOriginsOverlay,
  originSize,
  setOriginSize,
  showMjcfSiteToggle = false,
  showMjcfSites,
  setShowMjcfSites,
  showJointAxes,
  setShowJointAxes,
  showJointAxesOverlay,
  setShowJointAxesOverlay,
  jointAxisSize,
  setJointAxisSize,
  showCenterOfMass,
  setShowCenterOfMass,
  showCoMOverlay,
  setShowCoMOverlay,
  centerOfMassSize,
  setCenterOfMassSize,
  showInertia,
  setShowInertia,
  showInertiaOverlay,
  setShowInertiaOverlay,
  onAutoFitGround,
  groundPlaneOffset,
  groundPlaneOffsetReadOnly = false,
  setGroundPlaneOffset,
}) => {
  const handleResetGround = useCallback(() => {
    setGroundPlaneOffset(0);
  }, [setGroundPlaneOffset]);

  if (!showOptionsPanel) return null;

  const stopPanelEventPropagation = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      ref={optionsPanelRef}
      className="urdf-options-panel absolute z-40 pointer-events-auto"
      style={
        optionsPanelPos
          ? {
              left: optionsPanelPos.x,
              top: optionsPanelPos.y,
              right: 'auto',
              bottom: 'auto',
              transform: 'none',
            }
          : (defaultPosition ?? { top: '16px', right: '16px' })
      }
      onClick={stopPanelEventPropagation}
      onContextMenu={stopPanelEventPropagation}
      onDoubleClick={stopPanelEventPropagation}
      onPointerDown={stopPanelEventPropagation}
      onWheel={stopPanelEventPropagation}
    >
      <OptionsPanelContainer
        width="11rem"
        minWidth={168}
        resizable={true}
        isCollapsed={isOptionsCollapsed}
        resizeTitle={t.resize}
        showRightResizeHandle={false}
      >
        <OptionsPanelHeader
          title={t.viewOptions}
          isCollapsed={isOptionsCollapsed}
          onToggleCollapse={toggleOptionsCollapsed}
          onClose={() => setShowOptionsPanel && setShowOptionsPanel(false)}
          onMouseDown={onMouseDown}
        />

        <OptionsPanelContent isCollapsed={isOptionsCollapsed}>
          <div className="px-2 py-2 space-y-2">
            <CheckboxOption checked={showVisual} onChange={setShowVisual} label={t.showVisual} />
            <ToggleSliderOption
              checked={showCollision}
              onChange={setShowCollision}
              label={t.showCollision}
              rowClassName="pr-1"
              trailingControl={
                showCollision ? (
                  <OverlayToggleButton
                    active={showCollisionAlwaysOnTop}
                    label={t.alwaysOnTop}
                    onClick={() => setShowCollisionAlwaysOnTop(!showCollisionAlwaysOnTop)}
                  />
                ) : undefined
              }
            />

            <ToggleSliderOption
              checked={showIkHandles}
              onChange={setShowIkHandles}
              label={t.showIkHandles}
              rowClassName="pr-1"
              trailingControl={
                showIkHandles ? (
                  <OverlayToggleButton
                    active={showIkHandlesAlwaysOnTop}
                    label={t.alwaysOnTop}
                    onClick={() => setShowIkHandlesAlwaysOnTop(!showIkHandlesAlwaysOnTop)}
                  />
                ) : undefined
              }
            />

            {showMjcfSiteToggle ? (
              <CheckboxOption
                checked={showMjcfSites}
                onChange={setShowMjcfSites}
                label={t.showMjcfSites}
              />
            ) : null}

            <OverlayToggleOption
              checked={showOrigins}
              icon={<Move className="w-3 h-3 text-slate-500" />}
              label={t.showOrigin}
              onChange={setShowOrigins}
              onToggleOverlay={() => setShowOriginsOverlay(!showOriginsOverlay)}
              overlayActive={showOriginsOverlay}
              overlayLabel={t.alwaysOnTop}
              sliderConfig={{
                label: t.size,
                value: originSize,
                onChange: setOriginSize,
                min: 0.01,
                max: 0.5,
                step: 0.01,
              }}
            />

            <OverlayToggleOption
              checked={showJointAxes}
              className="mt-1"
              icon={<ArrowUpRight className="w-3 h-3 text-red-500" />}
              label={t.showJointAxes}
              onChange={setShowJointAxes}
              onToggleOverlay={() => setShowJointAxesOverlay(!showJointAxesOverlay)}
              overlayActive={showJointAxesOverlay}
              overlayLabel={t.alwaysOnTop}
              sliderConfig={{
                label: t.size,
                value: jointAxisSize,
                onChange: setJointAxisSize,
                min: 0.01,
                max: 2.0,
                step: 0.01,
              }}
            />

            <OverlayToggleOption
              checked={showCenterOfMass}
              icon={
                <div className="flex h-3 w-3 items-center justify-center rounded-full border border-slate-500">
                  <div className="h-1 w-1 rounded-full bg-slate-500"></div>
                </div>
              }
              label={t.showCenterOfMass}
              onChange={setShowCenterOfMass}
              onToggleOverlay={() => setShowCoMOverlay(!showCoMOverlay)}
              overlayActive={showCoMOverlay}
              overlayLabel={t.alwaysOnTop}
              sliderConfig={{
                label: t.size,
                value: centerOfMassSize,
                onChange: setCenterOfMassSize,
                min: 0.005,
                max: 0.1,
                step: 0.005,
                decimals: 3,
              }}
            />

            <OverlayToggleOption
              checked={showInertia}
              className="mt-1"
              icon={<div className="h-3 w-3 border border-dashed border-slate-500"></div>}
              label={t.showInertia}
              onChange={setShowInertia}
              onToggleOverlay={() => setShowInertiaOverlay(!showInertiaOverlay)}
              overlayActive={showInertiaOverlay}
              overlayLabel={t.alwaysOnTop}
            />

            <div className="pt-1">
              <SliderOption
                label={t.modelOpacity}
                value={modelOpacity}
                onChange={setModelOpacity}
                min={0.1}
                max={1.0}
                step={0.01}
                showPercentage
                compact
                indent={false}
              />
            </div>

            <GroundPlaneControls
              autoFitIcon={<Crosshair size={11} />}
              autoFitLabel={t.autoFitGround}
              disabled={groundPlaneOffsetReadOnly}
              offsetLabel={t.groundPlaneOffset}
              offsetValue={groundPlaneOffset}
              onAutoFit={onAutoFitGround}
              onOffsetChange={setGroundPlaneOffset}
              onReset={handleResetGround}
              resetLabel={t.reset}
              sliderIndent={false}
            />
          </div>
        </OptionsPanelContent>
      </OptionsPanelContainer>
    </div>
  );
};
