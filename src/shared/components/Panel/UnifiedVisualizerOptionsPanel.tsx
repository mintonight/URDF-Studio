import React, { forwardRef } from 'react';
import { Shapes, Shield } from 'lucide-react';
import { Language, translations } from '@/shared/i18n';
import {
  CheckboxOption,
  OptionsPanelContainer,
  OptionsPanelContent,
  OptionsPanelHeader,
  ToggleSliderOption,
} from './OptionsPanel';

interface UnifiedVisualizerOptionsPanelProps {
  lang: Language;
  showVisual: boolean;
  setShowVisual: (show: boolean) => void;
  showOrigin: boolean;
  setShowOrigin: (show: boolean) => void;
  frameSize: number;
  setFrameSize: (size: number) => void;
  showLabels: boolean;
  setShowLabels: (show: boolean) => void;
  labelScale: number;
  setLabelScale: (scale: number) => void;
  showJointAxes: boolean;
  setShowJointAxes: (show: boolean) => void;
  jointAxisSize: number;
  setJointAxisSize: (size: number) => void;
  showCollision: boolean;
  setShowCollision: (show: boolean) => void;
  showCollisionAlwaysOnTop: boolean;
  setShowCollisionAlwaysOnTop: (show: boolean) => void;
  showInertia: boolean;
  setShowInertia: (show: boolean) => void;
  showCenterOfMass: boolean;
  setShowCenterOfMass: (show: boolean) => void;
  modelOpacity: number;
  setModelOpacity: (opacity: number) => void;
  isCollapsed: boolean;
  toggleCollapsed: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onResetPosition: () => void;
  onClose?: () => void;
  optionsPanelPos: { x: number; y: number } | null;
  onAutoFitGround?: () => void;
  groundPlaneOffset: number;
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

export const UnifiedVisualizerOptionsPanel = forwardRef<
  HTMLDivElement,
  UnifiedVisualizerOptionsPanelProps
>(
  (
    {
      lang,
      showVisual,
      setShowVisual,
      showOrigin,
      setShowOrigin,
      frameSize,
      setFrameSize,
      showLabels,
      setShowLabels,
      labelScale,
      setLabelScale,
      showJointAxes,
      setShowJointAxes,
      jointAxisSize,
      setJointAxisSize,
      showCollision,
      setShowCollision,
      showCollisionAlwaysOnTop,
      setShowCollisionAlwaysOnTop,
      showInertia,
      setShowInertia,
      showCenterOfMass,
      setShowCenterOfMass,
      isCollapsed,
      toggleCollapsed,
      onMouseDown,
      onResetPosition,
      onClose,
      optionsPanelPos,
    },
    ref,
  ) => {
    const t = translations[lang];
    const isEnglish = lang === 'en';
    const englishCheckboxLabelClassName = isEnglish ? 'text-[10px]' : '';
    const englishSliderLabelClassName = isEnglish ? 'text-[9px]' : '';
    const detailOptionIconClassName = 'w-3 h-3 text-slate-500';

    return (
      <div
        ref={ref}
        className="absolute z-40 pointer-events-auto"
        style={
          optionsPanelPos
            ? { left: optionsPanelPos.x, top: optionsPanelPos.y, right: 'auto' }
            : { top: '16px', right: '16px' }
        }
      >
        <OptionsPanelContainer
          width="10rem"
          minWidth={156}
          resizable={true}
          isCollapsed={isCollapsed}
          resizeTitle={t.resize}
        >
          <OptionsPanelHeader
            title={t.viewOptions}
            isCollapsed={isCollapsed}
            onToggleCollapse={() => {
              onResetPosition();
              toggleCollapsed();
            }}
            onClose={onClose}
            showDragGrip={false}
            onMouseDown={onMouseDown}
            className="gap-1.5 px-2 py-1.5"
          />

          <OptionsPanelContent isCollapsed={isCollapsed}>
            <div className="px-2 py-2 space-y-2">
              <CheckboxOption
                checked={showVisual}
                onChange={setShowVisual}
                icon={<Shapes className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />}
                label={t.showVisual}
                labelClassName={englishCheckboxLabelClassName}
              />

              <ToggleSliderOption
                checked={showCollision}
                onChange={setShowCollision}
                icon={<Shield className="w-3 h-3 text-amber-500 dark:text-amber-400" />}
                label={t.showCollision}
                labelClassName={englishCheckboxLabelClassName}
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
                checked={showOrigin}
                onChange={setShowOrigin}
                label={t.showOrigin}
                className="mt-1"
                labelClassName={englishCheckboxLabelClassName}
                sliderConfig={{
                  label: t.frameSize,
                  value: frameSize,
                  onChange: setFrameSize,
                  min: 0.01,
                  max: 0.5,
                  step: 0.01,
                  compact: true,
                  indent: false,
                  labelClassName: englishSliderLabelClassName,
                }}
              />

              <ToggleSliderOption
                checked={showLabels}
                onChange={setShowLabels}
                label={t.showLabels}
                className="mt-1"
                labelClassName={englishCheckboxLabelClassName}
                sliderConfig={{
                  label: t.labelScale,
                  value: labelScale,
                  onChange: setLabelScale,
                  min: 0.1,
                  max: 2.0,
                  step: 0.1,
                  decimals: 1,
                  compact: true,
                  indent: false,
                  labelClassName: englishSliderLabelClassName,
                }}
              />

              <ToggleSliderOption
                checked={showJointAxes}
                onChange={setShowJointAxes}
                label={t.showJointAxes}
                className="mt-1"
                labelClassName={englishCheckboxLabelClassName}
                sliderConfig={{
                  label: t.jointAxisSize,
                  value: jointAxisSize,
                  onChange: setJointAxisSize,
                  min: 0.01,
                  max: 2.0,
                  step: 0.01,
                  compact: true,
                  indent: false,
                  labelClassName: englishSliderLabelClassName,
                }}
              />

              <CheckboxOption
                checked={showInertia}
                onChange={setShowInertia}
                label={t.showInertia}
                labelClassName={englishCheckboxLabelClassName}
              />

              <CheckboxOption
                checked={showCenterOfMass}
                onChange={setShowCenterOfMass}
                label={t.showCenterOfMass}
                labelClassName={englishCheckboxLabelClassName}
              />
            </div>
          </OptionsPanelContent>
        </OptionsPanelContainer>
      </div>
    );
  },
);

UnifiedVisualizerOptionsPanel.displayName = 'UnifiedVisualizerOptionsPanel';
