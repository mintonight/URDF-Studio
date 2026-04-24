import React, { useRef, useState, useEffect, useCallback } from 'react';
import { resolveJointKey } from '@/core/robot';
import { useAssemblyStore, useUIStore } from '@/store';
import { useRobotStore } from '@/store/robotStore';
import { JointType } from '@/types';
import type { JointPanelActiveJointOptions } from '@/shared/utils/jointPanelStore';
import { createJointDragStoreSync } from '@/shared/utils/jointDragStoreSync';
import { getJointType } from '@/shared/utils/jointTypes';
import {
  fromJointDisplayValue,
  getDefaultJointLimit,
  getJointSliderStep,
  getJointValueUnitLabel,
  hasEffectivelyFiniteJointLimits,
  isAngularJointType,
  normalizeJointTypeValue,
  supportsFiniteJointLimits,
  toJointDisplayValue,
} from '@/shared/utils/jointUnits';

const JOINT_PANEL_STORE_SYNC_INTERVAL_MS = 16;

export interface JointControlItemProps {
  name: string;
  joint: any;
  displayName?: string;
  value: number;
  angleUnit: 'rad' | 'deg';
  isActive: boolean;
  shouldAutoScroll?: boolean;
  setActiveJoint: (name: string | null, options?: JointPanelActiveJointOptions) => void;
  handleJointAngleChange: (name: string, val: number) => void;
  handleJointChangeCommit: (name: string, val: number) => void;
  onSelect?: (type: 'link' | 'joint', id: string) => void;
  isAdvanced?: boolean;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
}

type SliderDragSource = 'native-input' | 'slider-shell';

const JointControlItemComponent: React.FC<JointControlItemProps> = ({
  name,
  joint,
  displayName,
  value,
  angleUnit,
  isActive,
  shouldAutoScroll = false,
  setActiveJoint,
  handleJointAngleChange,
  handleJointChangeCommit,
  onSelect,
  isAdvanced = false,
  onUpdate,
}) => {
  const resolvedDisplayName = displayName?.trim() || joint?.name?.trim() || name;
  const jointType = getJointType(joint);
  const limit = joint.limit || { ...getDefaultJointLimit(jointType), effort: 0, velocity: 0 };
  const usesAngularUnits = isAngularJointType(jointType);
  const supportsAdjustableLimits = supportsFiniteJointLimits(jointType);
  const isContinuousJoint = normalizeJointTypeValue(jointType) === JointType.CONTINUOUS;
  const itemRef = useRef<HTMLDivElement>(null);
  const continuousPreviewValueRef = useRef(value);
  const isSliderDraggingRef = useRef(false);
  const sliderDragSourceRef = useRef<SliderDragSource | null>(null);
  const sidebarTab = useUIStore((state) => state.sidebarTab);
  const updateComponentRobot = useAssemblyStore((state) => state.updateComponentRobot);
  const updateBridge = useAssemblyStore((state) => state.updateBridge);
  const sliderStoreSync = React.useMemo(
    () =>
      createJointDragStoreSync({
        onDragChange: handleJointAngleChange,
        onDragCommit: handleJointChangeCommit,
        // Keep slider motion immediate in Three.js and cap React/store sync to once per frame.
        throttleChanges: true,
        intervalMs: JOINT_PANEL_STORE_SYNC_INTERVAL_MS,
      }),
    [handleJointAngleChange, handleJointChangeCommit],
  );

  const updateJoint = useRobotStore((state) => state.updateJoint);

  const [localLimits, setLocalLimits] = useState({
    lower: limit.lower,
    upper: limit.upper,
    effort: limit.effort || 0,
    velocity: limit.velocity || 0,
  });

  useEffect(() => {
    setLocalLimits({
      lower: limit.lower,
      upper: limit.upper,
      effort: limit.effort || 0,
      velocity: limit.velocity || 0,
    });
  }, [joint.id, limit.lower, limit.upper, limit.effort, limit.velocity]);

  const hasFiniteLimits = supportsAdjustableLimits && hasEffectivelyFiniteJointLimits(localLimits);

  const formatLimitInputValue = (limitValue: number | undefined) =>
    Number.isFinite(limitValue) ? Number(limitValue).toFixed(2) : '';

  const updateLimit = useCallback(
    (key: 'lower' | 'upper' | 'effort' | 'velocity', val: number) => {
      const newLimits = { ...localLimits, [key]: val };
      setLocalLimits(newLimits);

      if (key === 'lower' && value < val) {
        handleJointAngleChange(name, val);
        handleJointChangeCommit(name, val);
      } else if (key === 'upper' && value > val) {
        handleJointAngleChange(name, val);
        handleJointChangeCommit(name, val);
      }

      const jointId = name || joint.id;
      if (jointId) {
        if (sidebarTab === 'workspace') {
          const assemblyState = useAssemblyStore.getState().assemblyState;
          if (assemblyState) {
            for (const component of Object.values(assemblyState.components)) {
              const resolvedJointId = resolveJointKey(component.robot.joints, jointId);
              if (!resolvedJointId) continue;

              const currentJoint = component.robot.joints[resolvedJointId];
              updateComponentRobot(
                component.id,
                {
                  joints: {
                    ...component.robot.joints,
                    [resolvedJointId]: {
                      ...currentJoint,
                      limit: {
                        ...currentJoint.limit,
                        ...newLimits,
                      },
                    },
                  },
                },
                {
                  label: 'Update assembly joint limits',
                },
              );
              return;
            }

            const bridge =
              assemblyState.bridges[jointId] ??
              Object.values(assemblyState.bridges).find(
                (candidate) =>
                  candidate.joint.id === jointId ||
                  candidate.name === jointId ||
                  candidate.joint.name === jointId,
              );
            if (bridge) {
              updateBridge(
                bridge.id,
                {
                  joint: {
                    ...bridge.joint,
                    limit: {
                      ...bridge.joint.limit,
                      ...newLimits,
                    },
                  },
                },
                {
                  label: 'Update bridge joint',
                },
              );
              return;
            }
          }
        }

        if (onUpdate) {
          onUpdate('joint', jointId, {
            limit: newLimits,
          });
        } else {
          updateJoint(jointId, {
            limit: newLimits,
          });
        }
      }
    },
    [
      handleJointAngleChange,
      handleJointChangeCommit,
      joint,
      localLimits,
      name,
      onUpdate,
      sidebarTab,
      updateBridge,
      updateComponentRobot,
      updateJoint,
      value,
    ],
  );

  useEffect(() => {
    if (shouldAutoScroll && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [resolvedDisplayName, shouldAutoScroll]);

  const [continuousSliderAnchor, setContinuousSliderAnchor] = useState(value);
  const continuousSliderAnchorRef = useRef(value);
  const [sliderPreviewValue, setSliderPreviewValue] = useState(value);
  const [isSliderDragging, setIsSliderDragging] = useState(false);
  const [isSliderThumbHovered, setIsSliderThumbHovered] = useState(false);
  const [isPanelHovered, setIsPanelHovered] = useState(false);
  const sliderShellRef = useRef<HTMLDivElement>(null);
  const sliderThumbDiameter = 14;
  const sliderThumbHalf = sliderThumbDiameter / 2;

  const syncContinuousSliderAnchor = useCallback((nextAnchor: number) => {
    continuousSliderAnchorRef.current = nextAnchor;
    setContinuousSliderAnchor(nextAnchor);
  }, []);

  const displayValue = toJointDisplayValue(sliderPreviewValue, jointType, angleUnit);
  const displayMin = hasFiniteLimits
    ? toJointDisplayValue(localLimits.lower, jointType, angleUnit)
    : Number.NEGATIVE_INFINITY;
  const displayMax = hasFiniteLimits
    ? toJointDisplayValue(localLimits.upper, jointType, angleUnit)
    : Number.POSITIVE_INFINITY;
  const displayUnit = getJointValueUnitLabel(jointType, angleUnit);
  const step = getJointSliderStep(jointType, angleUnit);
  const continuousSliderWindow = angleUnit === 'deg' ? 180 : Math.PI;
  const sliderValue = isContinuousJoint
    ? toJointDisplayValue(sliderPreviewValue - continuousSliderAnchor, jointType, angleUnit)
    : displayValue;
  const sliderMin = isContinuousJoint
    ? -continuousSliderWindow
    : hasFiniteLimits
      ? Math.min(displayMin, displayValue)
      : displayValue - (angleUnit === 'deg' && usesAngularUnits ? 180 : Math.PI);
  const sliderMax = isContinuousJoint
    ? continuousSliderWindow
    : hasFiniteLimits
      ? Math.max(displayMax, displayValue)
      : displayValue + (angleUnit === 'deg' && usesAngularUnits ? 180 : Math.PI);

  const latestValuesRef = useRef({
    sliderMin,
    sliderMax,
    step,
    isContinuousJoint,
    jointType,
    angleUnit,
    name,
    isSliderDragging,
  });

  useEffect(() => {
    latestValuesRef.current = {
      sliderMin,
      sliderMax,
      step,
      isContinuousJoint,
      jointType,
      angleUnit,
      name,
      isSliderDragging,
    };
  });

  const sliderRange = sliderMax - sliderMin;
  const sliderPercentage = sliderRange > 0 ? ((sliderValue - sliderMin) / sliderRange) * 100 : 0;
  const clampedSliderPercentage = Math.min(Math.max(sliderPercentage, 0), 100);

  const clampSliderValue = useCallback((nextValue: number, min: number, max: number) => {
    if (!Number.isFinite(nextValue)) {
      return min;
    }
    return Math.min(Math.max(nextValue, min), max);
  }, []);

  const snapSliderValue = useCallback(
    (nextValue: number, min: number, max: number, currentStep: number) => {
      const clampedValue = clampSliderValue(nextValue, min, max);

      if (!Number.isFinite(currentStep) || currentStep <= 0) {
        return clampedValue;
      }

      const steppedValue = min + Math.round((clampedValue - min) / currentStep) * currentStep;
      const stepDecimals = `${currentStep}`.split('.')[1]?.length ?? 0;
      const precision = Math.min(stepDecimals + 2, 10);

      return clampSliderValue(Number(steppedValue.toFixed(precision)), min, max);
    },
    [clampSliderValue],
  );

  const [inputValue, setInputValue] = useState(displayValue.toFixed(2));
  const [isEditingValue, setIsEditingValue] = useState(false);
  const valueInputRef = useRef<HTMLInputElement>(null);

  const [isEditingLower, setIsEditingLower] = useState(false);
  const [isEditingUpper, setIsEditingUpper] = useState(false);
  const [isEditingEffort, setIsEditingEffort] = useState(false);
  const [isEditingVelocity, setIsEditingVelocity] = useState(false);
  const lowerInputRef = useRef<HTMLInputElement>(null);
  const upperInputRef = useRef<HTMLInputElement>(null);
  const effortInputRef = useRef<HTMLInputElement>(null);
  const velocityInputRef = useRef<HTMLInputElement>(null);

  const [lowerInput, setLowerInput] = useState(formatLimitInputValue(localLimits.lower));
  const [upperInput, setUpperInput] = useState(formatLimitInputValue(localLimits.upper));

  const [effortInput, setEffortInput] = useState(localLimits.effort.toFixed(2));
  const [velocityInput, setVelocityInput] = useState(localLimits.velocity.toFixed(2));

  useEffect(() => {
    if (!isEditingLower) setLowerInput(formatLimitInputValue(localLimits.lower));
  }, [localLimits.lower, isEditingLower]);

  useEffect(() => {
    if (!isEditingUpper) setUpperInput(formatLimitInputValue(localLimits.upper));
  }, [localLimits.upper, isEditingUpper]);

  useEffect(() => {
    if (!isEditingEffort) setEffortInput(localLimits.effort.toFixed(2));
  }, [localLimits.effort, isEditingEffort]);

  useEffect(() => {
    if (!isEditingVelocity) setVelocityInput(localLimits.velocity.toFixed(2));
  }, [localLimits.velocity, isEditingVelocity]);

  useEffect(() => {
    if (isSliderDraggingRef.current) {
      return;
    }

    setSliderPreviewValue(value);
    continuousPreviewValueRef.current = value;

    if (isContinuousJoint) {
      syncContinuousSliderAnchor(value);
    }
  }, [isContinuousJoint, syncContinuousSliderAnchor, value]);

  useEffect(
    () => () => {
      sliderStoreSync.dispose();
    },
    [sliderStoreSync],
  );

  const handleSliderChangeStart = useCallback(
    (source: SliderDragSource) => {
      if (isSliderDraggingRef.current) {
        return;
      }

      isSliderDraggingRef.current = true;
      sliderDragSourceRef.current = source;
      setIsSliderDragging(true);
      setActiveJoint(name, { autoScroll: false });
      onSelect?.('joint', name);
      setSliderPreviewValue(value);
      continuousPreviewValueRef.current = value;

      if (isContinuousJoint) {
        syncContinuousSliderAnchor(value);
      }
    },
    [
      isActive,
      isContinuousJoint,
      name,
      onSelect,
      setActiveJoint,
      syncContinuousSliderAnchor,
      value,
    ],
  );

  const handleSliderChangeEnd = useCallback(() => {
    if (!isSliderDraggingRef.current) {
      return;
    }

    const committedValue = continuousPreviewValueRef.current;

    isSliderDraggingRef.current = false;
    sliderDragSourceRef.current = null;
    setIsSliderDragging(false);

    if (isContinuousJoint) {
      syncContinuousSliderAnchor(committedValue);
    }

    sliderStoreSync.commit(name, committedValue);
  }, [isContinuousJoint, name, sliderStoreSync, syncContinuousSliderAnchor]);

  const handleSliderInput = useCallback(
    (nextSliderValue: number) => {
      const {
        isContinuousJoint: currentIsContinuousJoint,
        jointType: currentJointType,
        angleUnit: currentAngleUnit,
        name: currentName,
      } = latestValuesRef.current;

      const nextValue = currentIsContinuousJoint
        ? continuousSliderAnchorRef.current +
          fromJointDisplayValue(nextSliderValue, currentJointType, currentAngleUnit)
        : fromJointDisplayValue(nextSliderValue, currentJointType, currentAngleUnit);

      if (Math.abs(nextValue - continuousPreviewValueRef.current) <= 1e-6) {
        return;
      }

      setSliderPreviewValue(nextValue);
      continuousPreviewValueRef.current = nextValue;
      sliderStoreSync.emit(currentName, nextValue);
    },
    [sliderStoreSync],
  );

  const updateSliderValueFromClientX = useCallback(
    (clientX: number) => {
      const sliderShell = sliderShellRef.current;
      if (!sliderShell) {
        return;
      }

      const rect = sliderShell.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const {
        sliderMin: currentMin,
        sliderMax: currentMax,
        step: currentStep,
      } = latestValuesRef.current;

      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      const rawSliderValue = currentMin + ratio * (currentMax - currentMin);
      handleSliderInput(snapSliderValue(rawSliderValue, currentMin, currentMax, currentStep));
    },
    [handleSliderInput, snapSliderValue],
  );

  const handleSliderShellDragStart = useCallback(
    (clientX: number, pointerId?: number) => {
      handleSliderChangeStart('slider-shell');
      updateSliderValueFromClientX(clientX);

      if (pointerId !== undefined && sliderShellRef.current?.setPointerCapture) {
        try {
          sliderShellRef.current.setPointerCapture(pointerId);
        } catch {
          // Ignore if pointer capture fails
        }
      }
    },
    [handleSliderChangeStart, updateSliderValueFromClientX],
  );

  const updateSliderThumbHover = useCallback(
    (clientX: number, clientY: number) => {
      const sliderShell = sliderShellRef.current;
      if (!sliderShell) {
        setIsSliderThumbHovered(false);
        return;
      }

      const rect = sliderShell.getBoundingClientRect();
      const thumbCenterX = rect.left + (clampedSliderPercentage / 100) * rect.width;
      const thumbCenterY = rect.top + rect.height / 2;
      const withinX = Math.abs(clientX - thumbCenterX) <= sliderThumbHalf + 7;
      const withinY = Math.abs(clientY - thumbCenterY) <= 14;

      setIsSliderThumbHovered(withinX && withinY);
    },
    [clampedSliderPercentage, sliderThumbHalf],
  );

  useEffect(() => {
    if (!isSliderDragging) {
      return;
    }

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (sliderDragSourceRef.current !== 'slider-shell') {
        return;
      }

      updateSliderValueFromClientX(event.clientX);
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      handleSliderChangeEnd();
    };

    window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    window.addEventListener('blur', handleWindowPointerUp);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
      window.removeEventListener('blur', handleWindowPointerUp);
    };
  }, [handleSliderChangeEnd, isSliderDragging, updateSliderValueFromClientX]);

  useEffect(() => {
    const currentParsed = parseFloat(inputValue);
    const isDifferent = isNaN(currentParsed) || Math.abs(currentParsed - displayValue) > 0.0001;

    if (!isEditingValue && isDifferent) {
      setInputValue(displayValue.toFixed(2));
    }
  }, [displayValue, isEditingValue]);

  const commitChange = useCallback(
    (valStr: string) => {
      const val = parseFloat(valStr);
      if (!isNaN(val)) {
        handleJointChangeCommit(name, fromJointDisplayValue(val, jointType, angleUnit));
      }
      setIsEditingValue(false);
    },
    [angleUnit, handleJointChangeCommit, jointType, name],
  );

  const handleLimitCommit = useCallback(
    (type: 'lower' | 'upper', valStr: string) => {
      if (!hasFiniteLimits) {
        if (type === 'lower') setIsEditingLower(false);
        if (type === 'upper') setIsEditingUpper(false);
        return;
      }

      const val = parseFloat(valStr);
      if (!isNaN(val)) {
        updateLimit(type, fromJointDisplayValue(val, jointType, angleUnit));
      }
      if (type === 'lower') setIsEditingLower(false);
      if (type === 'upper') setIsEditingUpper(false);
    },
    [angleUnit, hasFiniteLimits, jointType, updateLimit],
  );

  const handleAdvancedCommit = useCallback(
    (type: 'effort' | 'velocity', valStr: string) => {
      const val = parseFloat(valStr);
      if (!isNaN(val)) {
        updateLimit(type, val);
      }
      if (type === 'effort') setIsEditingEffort(false);
      if (type === 'velocity') setIsEditingVelocity(false);
    },
    [updateLimit],
  );

  const commitOpenEditors = useCallback(() => {
    if (isEditingValue) commitChange(valueInputRef.current?.value ?? inputValue);
    if (isEditingLower) handleLimitCommit('lower', lowerInputRef.current?.value ?? lowerInput);
    if (isEditingUpper) handleLimitCommit('upper', upperInputRef.current?.value ?? upperInput);
    if (isEditingEffort) {
      handleAdvancedCommit('effort', effortInputRef.current?.value ?? effortInput);
    }
    if (isEditingVelocity) {
      handleAdvancedCommit('velocity', velocityInputRef.current?.value ?? velocityInput);
    }
  }, [
    commitChange,
    effortInput,
    handleAdvancedCommit,
    handleLimitCommit,
    inputValue,
    isEditingEffort,
    isEditingLower,
    isEditingUpper,
    isEditingValue,
    isEditingVelocity,
    lowerInput,
    upperInput,
    velocityInput,
  ]);

  useEffect(() => {
    if (
      !isEditingValue &&
      !isEditingLower &&
      !isEditingUpper &&
      !isEditingEffort &&
      !isEditingVelocity
    ) {
      return;
    }

    const handlePointerDownCapture = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const activeInputs = [
        isEditingValue ? valueInputRef.current : null,
        isEditingLower ? lowerInputRef.current : null,
        isEditingUpper ? upperInputRef.current : null,
        isEditingEffort ? effortInputRef.current : null,
        isEditingVelocity ? velocityInputRef.current : null,
      ].filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);

      if (activeInputs.some((input) => input.contains(target))) {
        return;
      }

      commitOpenEditors();
    };

    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownCapture, true);
    };
  }, [
    commitOpenEditors,
    isEditingEffort,
    isEditingLower,
    isEditingUpper,
    isEditingValue,
    isEditingVelocity,
  ]);

  const mainValueFieldWidthClassName = 'w-[2.35rem]';
  const limitFieldBaseClassName =
    'flex h-4 items-center rounded border px-0.5 py-0 font-mono tabular-nums text-[9px] leading-none transition-colors';
  const limitFieldColumnWidthClassName = 'min-w-[2.35rem]';
  const limitInputWidthClassName = 'w-[2.35rem]';

  const renderValueDisplay = () => (
    <div className="flex h-full shrink-0 items-center justify-end gap-0.5 whitespace-nowrap">
      <div
        onClick={(e) => {
          e.stopPropagation();
          setIsEditingValue(true);
        }}
        className={`${mainValueFieldWidthClassName} text-right`}
      >
        {isEditingValue ? (
          <input
            ref={valueInputRef}
            autoFocus
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={(e) => commitChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitChange(e.currentTarget.value);
                e.currentTarget.blur();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-full rounded border border-border-strong bg-input-bg px-0.5 py-0 text-right text-[9px] leading-none font-mono tabular-nums text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20"
          />
        ) : (
          <div className="flex h-3.5 w-full items-center justify-end whitespace-nowrap rounded border border-transparent px-0.5 py-0 text-right font-mono tabular-nums text-[9px] leading-none text-text-primary transition-colors hover:border-border-strong/70 hover:text-system-blue">
            {displayValue.toFixed(2)}
          </div>
        )}
      </div>
      <span className="min-w-[1.1rem] text-left text-[9px] leading-none text-text-tertiary">
        {displayUnit}
      </span>
    </div>
  );

  const renderAdvancedInputs = () => (
    <div className="flex items-center gap-2 shrink-0">
      <div
        className="flex items-center gap-1.5 cursor-text group"
        onClick={(e) => {
          e.stopPropagation();
          setIsEditingEffort(true);
        }}
      >
        <span className="inline-flex h-4 w-3 items-center justify-center font-serif text-[10px] italic leading-none text-text-tertiary">
          τ
        </span>
        {isEditingEffort ? (
          <input
            ref={effortInputRef}
            autoFocus
            type="text"
            value={effortInput}
            onChange={(e) => setEffortInput(e.target.value)}
            onBlur={(e) => handleAdvancedCommit('effort', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleAdvancedCommit('effort', e.currentTarget.value);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-10 rounded border border-border-strong bg-input-bg px-0.5 py-0 text-center text-[10px] leading-none font-mono text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20"
          />
        ) : (
          <span className="flex h-4 w-10 items-center justify-center border-b border-transparent text-center text-[10px] leading-none text-text-secondary transition-colors group-hover:border-border-strong/80 group-hover:text-text-primary">
            {localLimits.effort.toFixed(2)}
          </span>
        )}
      </div>
      <div
        className="flex items-center gap-1.5 cursor-text group"
        onClick={(e) => {
          e.stopPropagation();
          setIsEditingVelocity(true);
        }}
      >
        <span className="inline-flex h-4 w-3 items-center justify-center font-serif text-[10px] italic leading-none text-text-tertiary">
          v
        </span>
        {isEditingVelocity ? (
          <input
            ref={velocityInputRef}
            autoFocus
            type="text"
            value={velocityInput}
            onChange={(e) => setVelocityInput(e.target.value)}
            onBlur={(e) => handleAdvancedCommit('velocity', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleAdvancedCommit('velocity', e.currentTarget.value);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-10 rounded border border-border-strong bg-input-bg px-0.5 py-0 text-center text-[10px] leading-none font-mono text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20"
          />
        ) : (
          <span className="flex h-4 w-10 items-center justify-center border-b border-transparent text-center text-[10px] text-text-secondary transition-colors group-hover:border-border-strong/80 group-hover:text-text-primary">
            {localLimits.velocity.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={itemRef}
      data-panel-hovered={isPanelHovered ? 'true' : 'false'}
      onClick={() => {
        setActiveJoint(name, { autoScroll: false });
        onSelect?.('joint', name);
      }}
      onMouseEnter={() => setIsPanelHovered(true)}
      onMouseLeave={() => setIsPanelHovered(false)}
      className={`cursor-pointer space-y-1 rounded-lg border px-1 py-1.5 transition-colors ${
        isActive
          ? 'border-system-blue/20 bg-system-blue/10 dark:border-system-blue/30 dark:bg-system-blue/18'
          : isPanelHovered
            ? 'border-border-black/60 bg-element-hover/80'
            : 'border-transparent bg-transparent'
      }`}
    >
      <div className="flex h-6 items-center justify-between gap-1">
        <span
          className={`text-[11px] font-medium truncate min-w-0 ${
            isActive
              ? 'text-system-blue'
              : isPanelHovered
                ? 'text-text-primary'
                : 'text-text-secondary'
          } flex-1`}
          title={resolvedDisplayName}
        >
          {resolvedDisplayName}
        </span>

        {!isAdvanced && renderValueDisplay()}
      </div>

      {isAdvanced && (
        <div className="flex h-6 items-center justify-between gap-1">
          {renderAdvancedInputs()}
          {renderValueDisplay()}
        </div>
      )}

      <div className="grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-1">
        <div
          className={`relative h-4 ${limitFieldColumnWidthClassName}`}
          onClick={(e) => {
            if (!hasFiniteLimits) return;
            e.stopPropagation();
            setIsEditingLower(true);
          }}
        >
          {hasFiniteLimits && isEditingLower ? (
            <input
              ref={lowerInputRef}
              autoFocus
              type="text"
              value={lowerInput}
              onChange={(e) => setLowerInput(e.target.value)}
              onBlur={(e) => handleLimitCommit('lower', e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLimitCommit('lower', e.currentTarget.value);
              }}
              className={`absolute left-0 top-0 z-20 ${limitFieldBaseClassName} ${limitInputWidthClassName} border-border-strong bg-input-bg text-right text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20`}
            />
          ) : (
            <div
              className={`${limitFieldBaseClassName} w-fit cursor-text justify-end border-transparent text-right text-text-tertiary hover:border-border-strong/70 hover:text-system-blue`}
            >
              {hasFiniteLimits ? displayMin.toFixed(2) : '−∞'}
            </div>
          )}
        </div>

        <div
          ref={sliderShellRef}
          className="relative flex min-w-0 items-center"
          data-testid="joint-slider-shell"
          onPointerEnter={(event) => updateSliderThumbHover(event.clientX, event.clientY)}
          onPointerMove={(event) => updateSliderThumbHover(event.clientX, event.clientY)}
          onPointerLeave={() => setIsSliderThumbHovered(false)}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleSliderShellDragStart(event.clientX, event.pointerId);
          }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-slider-track">
            <div
              data-testid="joint-slider-fill"
              className="h-full bg-slider-accent"
              style={{ width: `${clampedSliderPercentage}%` }}
            />
          </div>
          <div
            data-testid="joint-slider-thumb"
            data-hovered={isSliderThumbHovered ? 'true' : 'false'}
            className={`absolute top-1/2 z-20 h-[14px] w-[14px] -translate-y-1/2 rounded-full border transition-[transform,box-shadow] duration-150 ease-out ${
              isSliderDragging
                ? 'scale-110 ring-4 ring-system-blue/15'
                : isSliderThumbHovered
                  ? 'scale-[1.08] ring-2 ring-system-blue/10'
                  : 'scale-100'
            }`}
            style={{
              left: `calc(${clampedSliderPercentage}% - ${sliderThumbHalf}px)`,
              backgroundColor: 'var(--ui-slider-thumb-bg)',
              borderColor: 'var(--ui-slider-thumb-border)',
              boxShadow: isSliderDragging
                ? 'var(--ui-slider-thumb-shadow-active)'
                : isSliderThumbHovered
                  ? 'var(--ui-slider-thumb-shadow-hover)'
                  : 'var(--ui-slider-thumb-shadow)',
            }}
            onPointerEnter={(event) => updateSliderThumbHover(event.clientX, event.clientY)}
            onPointerMove={(event) => updateSliderThumbHover(event.clientX, event.clientY)}
            onPointerLeave={() => setIsSliderThumbHovered(false)}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleSliderShellDragStart(event.clientX, event.pointerId);
            }}
          />
          <input
            type="range"
            min={sliderMin}
            max={sliderMax}
            step={step}
            value={sliderValue}
            onInput={(e) => {
              handleSliderInput(parseFloat((e.target as HTMLInputElement).value));
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              handleSliderChangeStart('native-input');
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              handleSliderChangeEnd();
            }}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 block h-5 w-full cursor-pointer appearance-none bg-transparent opacity-0"
            style={{ accentColor: 'var(--ui-slider-accent)' }}
          />
        </div>

        <div
          className={`relative h-4 ${limitFieldColumnWidthClassName}`}
          onClick={(e) => {
            if (!hasFiniteLimits) return;
            e.stopPropagation();
            setIsEditingUpper(true);
          }}
        >
          {hasFiniteLimits && isEditingUpper ? (
            <input
              ref={upperInputRef}
              autoFocus
              type="text"
              value={upperInput}
              onChange={(e) => setUpperInput(e.target.value)}
              onBlur={(e) => handleLimitCommit('upper', e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLimitCommit('upper', e.currentTarget.value);
              }}
              className={`absolute right-0 top-0 z-20 ${limitFieldBaseClassName} ${limitInputWidthClassName} border-border-strong bg-input-bg text-left text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20`}
            />
          ) : (
            <div
              className={`${limitFieldBaseClassName} ml-auto w-fit cursor-text justify-start border-transparent text-left text-text-tertiary hover:border-border-strong/70 hover:text-system-blue`}
            >
              {hasFiniteLimits ? displayMax.toFixed(2) : '∞'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const JointControlItem = React.memo(JointControlItemComponent);
