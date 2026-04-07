import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { TransformControls as DreiTransformControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  DEFAULT_DISPLAY_THICKNESS_SCALE,
  forceReleaseTransformControl,
  hasEnabledFlag,
  hasHoveredHandle,
  markGizmoObjects,
  patchDisplayBehavior,
  patchHoverBehavior,
  patchVisibleHoverHitFallback,
  patchVisiblePointerDownFallback,
  resolvePreferredUniversalOwner,
  resolveAttachedTransformControlObject,
  resolveUniversalOwner,
  resolveVisibleRotateHit,
  resolveVisibleTranslateHit,
  type UnifiedTransformControlsProps,
  type UniversalOwner,
} from './unified-transform-controls/helpers';
import { clearControlPointerState } from './unified-transform-controls/pointerState';

export {
  VISUALIZER_UNIFIED_GIZMO_SIZE,
  type UnifiedTransformDisplayStyle,
  type UnifiedTransformHoverStyle,
  type UnifiedTransformMode,
} from './unified-transform-controls/helpers';

export const UnifiedTransformControls = forwardRef<any, UnifiedTransformControlsProps>(
  function UnifiedTransformControls(
    {
      mode,
      object,
      translateObject,
      translateSpace,
      rotateRef,
      rotateObject,
      rotateSize,
      rotateSpace,
      rotateEnabled,
      onChange,
      onRotateChange,
      onMouseDown,
      onMouseUp,
      onDraggingChanged,
      enableUniversalPriority = true,
      hoverStyle = 'stock',
      displayStyle = 'stock',
      displayThicknessScale = DEFAULT_DISPLAY_THICKNESS_SCALE,
      enabled = true,
      space = 'local',
      size,
      ...restProps
    },
    ref,
  ) {
    const defaultControls = useThree((state) => state.controls);
    const pointer = useThree((state) => state.pointer);
    const scene = useThree((state) => state.scene);
    const translateRef = useRef<any>(null);
    const localRotateRef = useRef<any>(null);
    const effectiveRotateRef = rotateRef ?? localRotateRef;
    const universalOwnerRef = useRef<UniversalOwner>(null);
    const defaultControlsSuppressedRef = useRef(false);
    const defaultControlsEnabledBeforeSuppressRef = useRef(true);
    const orbitPassthroughRef = useRef(false);
    const resolvedTranslateObject = translateObject ?? object;
    const resolvedRotateObject = rotateObject ?? object;
    const attachedTranslateObject =
      resolveAttachedTransformControlObject(scene, resolvedTranslateObject) ?? undefined;
    const attachedRotateObject =
      resolveAttachedTransformControlObject(scene, resolvedRotateObject) ?? undefined;
    const primaryMode = mode === 'universal' ? 'translate' : mode;
    const primaryObject = primaryMode === 'rotate' ? attachedRotateObject : attachedTranslateObject;
    const primarySpace =
      primaryMode === 'rotate' ? (rotateSpace ?? space) : (translateSpace ?? space);

    useImperativeHandle(ref, () => translateRef.current);

    const releaseDragLock = useCallback(() => {
      const releasedTranslate = forceReleaseTransformControl(translateRef.current);
      const releasedRotate = forceReleaseTransformControl(effectiveRotateRef.current);

      if (releasedTranslate || releasedRotate) {
        clearControlPointerState(translateRef.current);
        clearControlPointerState(effectiveRotateRef.current);
        universalOwnerRef.current = null;
      }

      if (hasEnabledFlag(defaultControls) && defaultControlsSuppressedRef.current) {
        defaultControls.enabled = defaultControlsEnabledBeforeSuppressRef.current;
        defaultControlsSuppressedRef.current = false;
      }
    }, [defaultControls, effectiveRotateRef]);

    const restoreDefaultControls = useCallback(() => {
      if (hasEnabledFlag(defaultControls) && defaultControlsSuppressedRef.current) {
        defaultControls.enabled = defaultControlsEnabledBeforeSuppressRef.current;
        defaultControlsSuppressedRef.current = false;
      }
    }, [defaultControls]);

    const suppressDefaultControls = useCallback(() => {
      if (!hasEnabledFlag(defaultControls)) return;

      if (!defaultControlsSuppressedRef.current) {
        defaultControlsEnabledBeforeSuppressRef.current = defaultControls.enabled;
        defaultControlsSuppressedRef.current = true;
      }

      defaultControls.enabled = false;
    }, [defaultControls]);

    const clearHoveredAxes = useCallback(() => {
      clearControlPointerState(translateRef.current);
      if (effectiveRotateRef.current !== translateRef.current) {
        clearControlPointerState(effectiveRotateRef.current);
      }
      universalOwnerRef.current = null;
    }, [effectiveRotateRef]);

    const syncControlEnabledState = useCallback(() => {
      if (orbitPassthroughRef.current) {
        if (translateRef.current) {
          translateRef.current.enabled = false;
        }

        if (effectiveRotateRef.current) {
          effectiveRotateRef.current.enabled = false;
        }
        return;
      }

      if (translateRef.current) {
        translateRef.current.enabled = mode === 'universal' ? false : enabled;
      }

      if (effectiveRotateRef.current) {
        effectiveRotateRef.current.enabled =
          mode === 'universal' ? false : (rotateEnabled ?? enabled);
      }
    }, [effectiveRotateRef, enabled, mode, rotateEnabled]);

    const handleControlMouseDown = useCallback(
      (event: any) => {
        suppressDefaultControls();
        onMouseDown?.(event);
      },
      [onMouseDown, suppressDefaultControls],
    );

    const handleControlMouseUp = useCallback(
      (event: any) => {
        clearHoveredAxes();
        restoreDefaultControls();
        onMouseUp?.(event);
      },
      [clearHoveredAxes, onMouseUp, restoreDefaultControls],
    );

    const handleControlDraggingChanged = useCallback(
      (event: any) => {
        if (event?.value) {
          suppressDefaultControls();
        } else {
          clearHoveredAxes();
          restoreDefaultControls();
        }

        onDraggingChanged?.(event);
      },
      [clearHoveredAxes, onDraggingChanged, restoreDefaultControls, suppressDefaultControls],
    );

    useEffect(() => {
      const translateControls = translateRef.current;
      const rotateControls = effectiveRotateRef.current;

      const cleanupCallbacks: Array<() => void> = [];

      const bindDraggingChanged = (controls: any) => {
        if (!controls?.addEventListener || !controls?.removeEventListener) {
          return;
        }

        controls.addEventListener('dragging-changed', handleControlDraggingChanged);
        cleanupCallbacks.push(() => {
          controls.removeEventListener('dragging-changed', handleControlDraggingChanged);
        });
      };

      bindDraggingChanged(translateControls);

      if (rotateControls && rotateControls !== translateControls) {
        bindDraggingChanged(rotateControls);
      }

      return () => {
        cleanupCallbacks.forEach((cleanup) => cleanup());
      };
    }, [effectiveRotateRef, handleControlDraggingChanged, mode]);

    useEffect(() => {
      markGizmoObjects(translateRef.current);
      markGizmoObjects(effectiveRotateRef.current);
      patchDisplayBehavior(translateRef.current, displayStyle, displayThicknessScale, {
        leaveTranslateRingGap: mode === 'universal',
      });
      patchDisplayBehavior(effectiveRotateRef.current, displayStyle, displayThicknessScale);
      patchVisibleHoverHitFallback(translateRef.current);
      patchVisibleHoverHitFallback(effectiveRotateRef.current);
      patchVisiblePointerDownFallback(translateRef.current);
      patchVisiblePointerDownFallback(effectiveRotateRef.current);
      patchHoverBehavior(translateRef.current, hoverStyle);
      patchHoverBehavior(effectiveRotateRef.current, hoverStyle);
    }, [displayStyle, displayThicknessScale, effectiveRotateRef, hoverStyle, mode]);

    useEffect(() => {
      return () => {
        if (!hasEnabledFlag(defaultControls) || !defaultControlsSuppressedRef.current) return;
        defaultControls.enabled = defaultControlsEnabledBeforeSuppressRef.current;
        defaultControlsSuppressedRef.current = false;
      };
    }, [defaultControls]);

    useEffect(() => {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          releaseDragLock();
        }
      };

      window.addEventListener('mouseup', releaseDragLock);
      window.addEventListener('pointerup', releaseDragLock);
      window.addEventListener('pointercancel', releaseDragLock);
      window.addEventListener('blur', releaseDragLock);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        window.removeEventListener('mouseup', releaseDragLock);
        window.removeEventListener('pointerup', releaseDragLock);
        window.removeEventListener('pointercancel', releaseDragLock);
        window.removeEventListener('blur', releaseDragLock);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }, [releaseDragLock]);

    useEffect(() => {
      syncControlEnabledState();

      // When the gizmo becomes disabled (e.g. pendingEdit confirmation is
      // showing), no drag can be active, so proactively restore orbit controls
      // that our useFrame(1100) suppression may still be holding disabled.
      if (!enabled && defaultControlsSuppressedRef.current && hasEnabledFlag(defaultControls)) {
        defaultControls.enabled = defaultControlsEnabledBeforeSuppressRef.current;
        defaultControlsSuppressedRef.current = false;
      }
    }, [defaultControls, enabled, syncControlEnabledState]);

    useEffect(() => {
      if (!defaultControls) return;
      if (
        defaultControls === translateRef.current ||
        defaultControls === effectiveRotateRef.current
      ) {
        return;
      }

      const controlsWithEvents = defaultControls as THREE.EventDispatcher & {
        addEventListener?: (type: string, listener: (...args: any[]) => void) => void;
        removeEventListener?: (type: string, listener: (...args: any[]) => void) => void;
      };

      if (
        typeof controlsWithEvents.addEventListener !== 'function' ||
        typeof controlsWithEvents.removeEventListener !== 'function'
      ) {
        return;
      }

      const handleViewDragStart = () => {
        if (translateRef.current?.dragging || effectiveRotateRef.current?.dragging) return;
        orbitPassthroughRef.current = true;
        clearHoveredAxes();
        syncControlEnabledState();
      };

      const handleViewDragEnd = () => {
        orbitPassthroughRef.current = false;
        clearHoveredAxes();
        syncControlEnabledState();
      };

      controlsWithEvents.addEventListener('start', handleViewDragStart);
      controlsWithEvents.addEventListener('end', handleViewDragEnd);
      window.addEventListener('pointerup', handleViewDragEnd);
      window.addEventListener('pointercancel', handleViewDragEnd);
      window.addEventListener('blur', handleViewDragEnd);

      return () => {
        controlsWithEvents.removeEventListener?.('start', handleViewDragStart);
        controlsWithEvents.removeEventListener?.('end', handleViewDragEnd);
        window.removeEventListener('pointerup', handleViewDragEnd);
        window.removeEventListener('pointercancel', handleViewDragEnd);
        window.removeEventListener('blur', handleViewDragEnd);
      };
    }, [clearHoveredAxes, defaultControls, effectiveRotateRef, syncControlEnabledState]);

    useFrame(() => {
      if (!defaultControls) return;
      if (
        defaultControls === translateRef.current ||
        defaultControls === effectiveRotateRef.current
      ) {
        return;
      }
      if (!hasEnabledFlag(defaultControls)) return;

      const shouldSuppressDefaultControls =
        hasHoveredHandle(translateRef.current) ||
        hasHoveredHandle(effectiveRotateRef.current) ||
        Boolean(translateRef.current?.dragging) ||
        Boolean(effectiveRotateRef.current?.dragging);

      if (!shouldSuppressDefaultControls) {
        if (defaultControlsSuppressedRef.current) {
          defaultControls.enabled = defaultControlsEnabledBeforeSuppressRef.current;
          defaultControlsSuppressedRef.current = false;
        } else {
          defaultControlsEnabledBeforeSuppressRef.current = defaultControls.enabled;
        }
        return;
      }

      if (!defaultControlsSuppressedRef.current) {
        // Do NOT re-capture defaultControls.enabled here.
        // The idle-tracking branch above already holds the correct pre-drag
        // value. React-driven props (e.g. OrbitControls enabled={!isDragging})
        // may have already toggled defaultControls.enabled to false by this
        // point, so re-capturing would save the wrong value and permanently
        // break orbit on restoration.
        defaultControlsSuppressedRef.current = true;
      }

      defaultControls.enabled = false;
    }, 1100);

    useEffect(() => {
      if (mode !== 'universal' || !enableUniversalPriority) {
        universalOwnerRef.current = null;
        return;
      }

      const translateControls = translateRef.current;
      const rotateControls = effectiveRotateRef.current;
      if (!translateControls || !rotateControls) return;

      const clearOwnerIfIdle = () => {
        if (
          !translateControls.dragging &&
          !rotateControls.dragging &&
          !hasHoveredHandle(translateControls) &&
          !hasHoveredHandle(rotateControls)
        ) {
          universalOwnerRef.current = null;
        }
      };

      const handleTranslateAxisChange = (event: { value: string | null }) => {
        if (event.value) {
          universalOwnerRef.current = 'translate';
          return;
        }

        clearOwnerIfIdle();
      };

      const handleRotateAxisChange = (event: { value: string | null }) => {
        if (event.value) {
          universalOwnerRef.current = 'rotate';
          return;
        }

        clearOwnerIfIdle();
      };

      const handleTranslateDragChange = (event: { value: boolean }) => {
        if (event.value) {
          universalOwnerRef.current = 'translate';
          return;
        }

        clearOwnerIfIdle();
      };

      const handleRotateDragChange = (event: { value: boolean }) => {
        if (event.value) {
          universalOwnerRef.current = 'rotate';
          return;
        }

        clearOwnerIfIdle();
      };

      translateControls.addEventListener('axis-changed', handleTranslateAxisChange);
      rotateControls.addEventListener('axis-changed', handleRotateAxisChange);
      translateControls.addEventListener('dragging-changed', handleTranslateDragChange);
      rotateControls.addEventListener('dragging-changed', handleRotateDragChange);

      return () => {
        translateControls.removeEventListener('axis-changed', handleTranslateAxisChange);
        rotateControls.removeEventListener('axis-changed', handleRotateAxisChange);
        translateControls.removeEventListener('dragging-changed', handleTranslateDragChange);
        rotateControls.removeEventListener('dragging-changed', handleRotateDragChange);
      };
    }, [mode, enableUniversalPriority, effectiveRotateRef]);

    useFrame(() => {
      if (mode !== 'universal' || !enableUniversalPriority) return;

      const translateControls = translateRef.current;
      const rotateControls = effectiveRotateRef.current;
      if (!translateControls || !rotateControls) return;

      if (orbitPassthroughRef.current) {
        translateControls.enabled = false;
        rotateControls.enabled = false;
        return;
      }

      // Once a drag is active, the owner is already known. Skip the expensive
      // visible-hit traversal until the pointer is released.
      if (translateControls.dragging) {
        universalOwnerRef.current = 'translate';

        if (!rotateControls.dragging && rotateControls.axis !== null) {
          rotateControls.axis = null;
        }

        translateControls.enabled = enabled;
        rotateControls.enabled = false;
        return;
      }

      if (rotateControls.dragging) {
        universalOwnerRef.current = 'rotate';

        if (!translateControls.dragging && translateControls.axis !== null) {
          translateControls.axis = null;
        }

        rotateControls.enabled = rotateEnabled ?? enabled;
        translateControls.enabled = false;
        return;
      }

      const translateHovered = hasHoveredHandle(translateControls);
      const rotateHovered = hasHoveredHandle(rotateControls);

      const translateVisibleHit = resolveVisibleTranslateHit(translateControls, pointer);
      const rotateVisibleHit = resolveVisibleRotateHit(rotateControls, pointer);

      const pointerOwner = resolvePreferredUniversalOwner({
        translateHovered,
        rotateHovered,
        translateHit: translateVisibleHit,
        rotateHit: rotateVisibleHit,
        previousOwner: universalOwnerRef.current,
      });

      const activeOwner = resolveUniversalOwner(translateControls, rotateControls, pointerOwner);
      universalOwnerRef.current = activeOwner;

      if (activeOwner === 'rotate') {
        if (!translateControls.dragging && translateControls.axis !== null) {
          translateControls.axis = null;
        }
        if (!rotateControls.dragging) {
          rotateControls.axis = rotateVisibleHit?.axis ?? null;
        }

        rotateControls.enabled = rotateEnabled ?? enabled;
        translateControls.enabled = false;
        return;
      }

      if (activeOwner === 'translate') {
        if (!rotateControls.dragging && rotateControls.axis !== null) {
          rotateControls.axis = null;
        }
        if (!translateControls.dragging) {
          translateControls.axis = translateVisibleHit?.axis ?? null;
        }

        translateControls.enabled = enabled;
        rotateControls.enabled = false;
        return;
      }

      if (!translateControls.dragging && translateControls.axis !== null) {
        translateControls.axis = null;
      }
      if (!rotateControls.dragging && rotateControls.axis !== null) {
        rotateControls.axis = null;
      }

      translateControls.enabled = false;
      rotateControls.enabled = false;
    }, 1000);

    if (!primaryObject || (mode === 'universal' && !attachedRotateObject)) {
      return null;
    }

    return (
      <>
        <DreiTransformControls
          ref={translateRef}
          object={primaryObject}
          mode={primaryMode}
          enabled={enabled}
          space={primarySpace}
          size={mode === 'rotate' ? (rotateSize ?? size) : size}
          onChange={onChange}
          onMouseDown={handleControlMouseDown}
          onMouseUp={handleControlMouseUp}
          {...restProps}
        />

        {mode === 'universal' && (
          <DreiTransformControls
            ref={effectiveRotateRef}
            object={attachedRotateObject}
            mode="rotate"
            enabled={rotateEnabled ?? enabled}
            space={rotateSpace ?? space}
            size={rotateSize ?? size}
            onChange={onRotateChange ?? onChange}
            onMouseDown={handleControlMouseDown}
            onMouseUp={handleControlMouseUp}
            {...restProps}
          />
        )}
      </>
    );
  },
);
