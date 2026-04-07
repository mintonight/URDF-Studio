import React, { forwardRef, useCallback } from 'react';
import { Crosshair } from 'lucide-react';
import { Language, translations } from '@/shared/i18n';
import {
  CheckboxOption,
  GroundPlaneControls,
  OptionsPanelContainer,
  OptionsPanelContent,
  OptionsPanelHeader,
  SliderOption,
  ToggleSliderOption,
} from './OptionsPanel';

interface UnifiedVisualizerOptionsPanelProps {
  lang: Language;
  showGeometry: boolean;
  setShowGeometry: (show: boolean) => void;
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
  showIkHandles: boolean;
  setShowIkHandles: (show: boolean) => void;
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

export const UnifiedVisualizerOptionsPanel = forwardRef<
  HTMLDivElement,
  UnifiedVisualizerOptionsPanelProps
>(
  (
    {
      lang,
      showGeometry,
      setShowGeometry,
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
      showIkHandles,
      setShowIkHandles,
      showInertia,
      setShowInertia,
      showCenterOfMass,
      setShowCenterOfMass,
      modelOpacity,
      setModelOpacity,
      isCollapsed,
      toggleCollapsed,
      onMouseDown,
      onResetPosition,
      onClose,
      optionsPanelPos,
      onAutoFitGround,
      groundPlaneOffset,
      setGroundPlaneOffset,
    },
    ref,
  ) => {
    const t = translations[lang];
    const isEnglish = lang === 'en';
    const englishCheckboxLabelClassName = isEnglish ? 'text-[10px]' : '';
    const englishSliderLabelClassName = isEnglish ? 'text-[9px]' : '';

    const handleResetGround = useCallback(() => {
      setGroundPlaneOffset(0);
    }, [setGroundPlaneOffset]);

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
          width="11rem"
          minWidth={168}
          resizable={true}
          isCollapsed={isCollapsed}
          resizeTitle={t.resize}
          showRightResizeHandle={false}
        >
          <OptionsPanelHeader
            title={t.viewOptions}
            isCollapsed={isCollapsed}
            onToggleCollapse={() => {
              onResetPosition();
              toggleCollapsed();
            }}
            onClose={onClose}
            onMouseDown={onMouseDown}
          />

          <OptionsPanelContent isCollapsed={isCollapsed}>
            <div className="px-2 py-2 space-y-2">
              <CheckboxOption
                checked={showGeometry}
                onChange={setShowGeometry}
                label={t.showGeometry}
                labelClassName={englishCheckboxLabelClassName}
              />

              <CheckboxOption
                checked={showCollision}
                onChange={setShowCollision}
                label={t.showCollision}
                labelClassName={englishCheckboxLabelClassName}
              />

              <CheckboxOption
                checked={showIkHandles}
                onChange={setShowIkHandles}
                label={t.showIkHandles}
                labelClassName={englishCheckboxLabelClassName}
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

              <div className="pt-1">
                <SliderOption
                  label={t.modelOpacity}
                  value={modelOpacity}
                  onChange={setModelOpacity}
                  min={0.1}
                  max={1}
                  step={0.01}
                  showPercentage
                  compact
                  indent={false}
                  labelClassName={englishSliderLabelClassName}
                />
              </div>

              <GroundPlaneControls
                autoFitIcon={<Crosshair size={11} />}
                autoFitLabel={t.autoFitGround}
                offsetLabel={t.groundPlaneOffset}
                offsetValue={groundPlaneOffset}
                onAutoFit={onAutoFitGround}
                onOffsetChange={setGroundPlaneOffset}
                onReset={handleResetGround}
                resetLabel={t.reset}
                sliderIndent={false}
                sliderLabelClassName={englishSliderLabelClassName}
              />
            </div>
          </OptionsPanelContent>
        </OptionsPanelContainer>
      </div>
    );
  },
);

UnifiedVisualizerOptionsPanel.displayName = 'UnifiedVisualizerOptionsPanel';
