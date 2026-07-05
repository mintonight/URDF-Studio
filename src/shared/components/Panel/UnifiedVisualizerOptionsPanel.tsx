import React, { forwardRef } from 'react';
import { Shapes, Shield } from 'lucide-react';
import { Language, translations } from '@/shared/i18n';
import { WORKSPACE_OVERLAY_RIGHT_EDGE_GAP } from '@/shared/components/3d/scene';
import {
  ORIGIN_AXES_SIZE_FALLBACK_MAX,
  ORIGIN_AXES_SIZE_MIN,
  ORIGIN_AXES_SIZE_STEP,
} from '@/shared/components/3d/helpers/coordinateAxesSizing';
import {
  CheckboxOption,
  OptionsPanelContainer,
  OptionsPanelContent,
  OptionsPanelHeader,
  PanelOverlayToggleButton,
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
  frameSizeMax?: number;
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
  zIndex?: number;
  onActivate?: () => void;
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
      frameSizeMax = ORIGIN_AXES_SIZE_FALLBACK_MAX,
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
      zIndex = 40,
      onActivate,
    },
    ref,
  ) => {
    const t = translations[lang];
    const isEnglish = lang === 'en';
    const englishCheckboxLabelClassName = isEnglish ? 'text-[10px]' : '';
    const englishSliderLabelClassName = isEnglish ? 'text-[9px]' : '';
    const detailOptionIconClassName = 'w-3 h-3 text-text-tertiary';

    return (
      <div
        ref={ref}
        className="absolute pointer-events-auto"
        style={
          optionsPanelPos
            ? { left: optionsPanelPos.x, top: optionsPanelPos.y, right: 'auto', zIndex }
            : { top: '16px', right: WORKSPACE_OVERLAY_RIGHT_EDGE_GAP, zIndex }
        }
        onPointerDownCapture={onActivate}
        onFocusCapture={onActivate}
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
            expandText={t.expand}
            collapseText={t.collapse}
            closeText={t.close}
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
                    <PanelOverlayToggleButton
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
                  min: ORIGIN_AXES_SIZE_MIN,
                  max: frameSizeMax,
                  step: ORIGIN_AXES_SIZE_STEP,
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
