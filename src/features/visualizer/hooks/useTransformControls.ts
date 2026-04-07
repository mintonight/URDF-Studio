import { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import {
  extractJointActualAngleFromQuaternion,
  getJointMotionPose,
  resolveJointKey,
} from '@/core/robot';
import { type AppMode, RobotState } from '@/types';
import { useRobotStore } from '@/store/robotStore';
import { useSelectionStore } from '@/store/selectionStore';
import { shouldEnableMergedVisualizerJointTransformControls } from '../utils/mergedVisualizerSceneMode';

const PREVIEW_POSITION_EPSILON_SQ = 1e-12;
const PREVIEW_ROTATION_EPSILON = 1e-10;
const PREVIEW_ANGLE_EPSILON = 1e-6;

interface PendingEdit {
  axis: string;
  value: number;
  startValue: number;
  isRotate: boolean;
}

interface RotatePreviewFeedback {
  appliedAngle: number | null;
  constrained: boolean;
}

export interface TransformControlsState {
  transformControlRef: React.RefObject<any>;
  rotateTransformControlRef: React.RefObject<any>;
  pendingEdit: PendingEdit | null;
  setPendingEdit: (edit: PendingEdit | null) => void;
  setRotateInputObject: (object: THREE.Object3D | null) => void;
  getDisplayValue: () => string;
  getDeltaDisplay: () => string;
  handleValueChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleConfirm: () => void;
  handleCancel: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleObjectChange: () => void;
  handleRotateObjectChange: () => void;
}

interface TransformControlsOptions {
  onPreviewObjectChange?: (
    selectedObject: THREE.Group,
    selectionId: string | null | undefined,
  ) => void;
  onPreviewRotateChange?: (
    selectionId: string | null | undefined,
    angle: number,
  ) => RotatePreviewFeedback | void;
  onResetPreview?: () => void;
  selectedRotateObject?: THREE.Group | null;
}

/**
 * Custom hook to manage TransformControls state and interactions
 * Handles dragging and persisting joint transforms while preserving
 * the stock Three.js TransformControls appearance.
 */
export function useTransformControls(
  selectedObject: THREE.Group | null,
  transformMode: 'translate' | 'rotate' | 'universal',
  robot: RobotState,
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void,
  mode: AppMode,
  options: TransformControlsOptions = {},
): TransformControlsState {
  const setJointAngle = useRobotStore((state) => state.setJointAngle);
  const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
  const tempEulerRef = useRef(new THREE.Euler(0, 0, 0, 'ZYX'));
  const transformControlRef = useRef<any>(null);
  const rotateTransformControlRef = useRef<any>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);

  const originalPositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const originalQuaternionRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const rotateInputObjectRef = useRef<THREE.Object3D | null>(null);
  const isDraggingControlRef = useRef(false);
  const currentAxisRef = useRef<string | null>(null);
  const startValueRef = useRef<number>(0);
  const lastPreviewPositionRef = useRef<THREE.Vector3 | null>(null);
  const lastPreviewQuaternionRef = useRef<THREE.Quaternion | null>(null);
  const lastPreviewAngleRef = useRef<number | null>(null);
  const { onPreviewObjectChange, onPreviewRotateChange, onResetPreview, selectedRotateObject } =
    options;
  const jointTransformControlsEnabled = shouldEnableMergedVisualizerJointTransformControls(mode);
  const rotateEditsJointMotion = Boolean(
    selectedRotateObject && selectedRotateObject !== selectedObject,
  );

  const getObjectRPY = useCallback((object: THREE.Object3D) => {
    const rotation = tempEulerRef.current.setFromQuaternion(object.quaternion, 'ZYX');
    return { r: rotation.x, p: rotation.y, y: rotation.z };
  }, []);

  const applyAxisRotationValue = useCallback(
    (object: THREE.Object3D, axis: string, value: number) => {
      const rotation = tempEulerRef.current.setFromQuaternion(object.quaternion, 'ZYX');
      if (axis === 'X') rotation.x = value;
      else if (axis === 'Y') rotation.y = value;
      else if (axis === 'Z') rotation.z = value;

      object.quaternion.setFromEuler(rotation);
    },
    [],
  );

  const resetPreviewCache = useCallback(() => {
    lastPreviewPositionRef.current = null;
    lastPreviewQuaternionRef.current = null;
    lastPreviewAngleRef.current = null;
  }, []);

  const setRotateInputObject = useCallback((object: THREE.Object3D | null) => {
    rotateInputObjectRef.current = object;
  }, []);

  const persistSelectedObject = useCallback(() => {
    if (!selectedObject || !robot.selection.id) return;

    const isJoint = robot.selection.type === 'joint';
    if (!isJoint) return;

    const id = resolveJointKey(robot.joints, robot.selection.id);
    if (!id) return;

    const entity = robot.joints[id];
    if (!entity) return;

    const pos = selectedObject.position;
    const rot = getObjectRPY(selectedObject);

    onUpdate('joint', id, {
      ...entity,
      origin: {
        xyz: { x: pos.x, y: pos.y, z: pos.z },
        rpy: { r: rot.r, p: rot.p, y: rot.y },
      },
    });

    originalPositionRef.current.copy(pos);
    originalQuaternionRef.current.copy(selectedObject.quaternion);
  }, [
    getObjectRPY,
    onUpdate,
    robot.joints,
    robot.selection.id,
    robot.selection.type,
    selectedObject,
  ]);

  const getSelectedJoint = useCallback(() => {
    if (robot.selection.type !== 'joint' || !robot.selection.id) {
      return null;
    }

    const resolvedJointId = resolveJointKey(robot.joints, robot.selection.id);
    if (!resolvedJointId) {
      return null;
    }

    const joint = robot.joints[resolvedJointId];
    return joint ? { id: resolvedJointId, joint } : null;
  }, [robot.joints, robot.selection.id, robot.selection.type]);

  const getEffectiveRotateObject = useCallback(
    () => rotateInputObjectRef.current ?? selectedRotateObject,
    [selectedRotateObject],
  );

  const extractSelectedJointAngle = useCallback(() => {
    const selectedJointEntry = getSelectedJoint();
    const rotateObject = getEffectiveRotateObject();
    if (!selectedJointEntry || !rotateObject) {
      return null;
    }
    return extractJointActualAngleFromQuaternion(selectedJointEntry.joint, rotateObject.quaternion);
  }, [getEffectiveRotateObject, getSelectedJoint]);

  const clampRotatePreviewObject = useCallback(
    (jointId: string, angle: number) => {
      const selectedJointEntry = getSelectedJoint();
      const rotateObject = getEffectiveRotateObject();
      if (!selectedJointEntry || selectedJointEntry.id !== jointId || !rotateObject) {
        return;
      }

      const pose = getJointMotionPose(selectedJointEntry.joint, {
        angles: { [jointId]: angle },
      });
      rotateObject.position.copy(pose.position);
      rotateObject.quaternion.copy(pose.quaternion);
      rotateObject.updateMatrixWorld(true);
    },
    [getEffectiveRotateObject, getSelectedJoint],
  );

  // Clear pending edit when selection changes
  useEffect(() => {
    if (pendingEdit && selectedObject) {
      selectedObject.position.copy(originalPositionRef.current);
      selectedObject.quaternion.copy(originalQuaternionRef.current);
    }
    resetPreviewCache();
    onResetPreview?.();
    setPendingEdit(null);
  }, [
    onResetPreview,
    pendingEdit,
    resetPreviewCache,
    robot.selection.id,
    robot.selection.type,
    selectedObject,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setHoverFrozen(false);
      if (pendingEdit && selectedObject) {
        selectedObject.position.copy(originalPositionRef.current);
        selectedObject.quaternion.copy(originalQuaternionRef.current);
      }
      resetPreviewCache();
      onResetPreview?.();
    };
  }, [onResetPreview, pendingEdit, resetPreviewCache, selectedObject, setHoverFrozen]);

  // Update original refs when target object changes
  useEffect(() => {
    if (selectedObject) {
      originalPositionRef.current.copy(selectedObject.position);
      originalQuaternionRef.current.copy(selectedObject.quaternion);
    }
    resetPreviewCache();
  }, [resetPreviewCache, selectedObject]);

  // Helper functions
  const radToDeg = (rad: number) => rad * (180 / Math.PI);
  const degToRad = (deg: number) => deg * (Math.PI / 180);

  const getDisplayValue = useCallback(() => {
    if (!pendingEdit) return '0';
    if (pendingEdit.isRotate) {
      return radToDeg(pendingEdit.value).toFixed(2);
    }
    return pendingEdit.value.toFixed(4);
  }, [pendingEdit]);

  const getDeltaDisplay = useCallback(() => {
    if (!pendingEdit) return '0';
    const delta = pendingEdit.value - pendingEdit.startValue;
    if (pendingEdit.isRotate) {
      const degDelta = radToDeg(delta);
      return (degDelta >= 0 ? '+' : '') + degDelta.toFixed(2);
    }
    return (delta >= 0 ? '+' : '') + delta.toFixed(4);
  }, [pendingEdit]);

  const handleValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputVal = parseFloat(e.target.value);
      if (!isNaN(inputVal) && pendingEdit && selectedObject) {
        const val = pendingEdit.isRotate ? degToRad(inputVal) : inputVal;
        setPendingEdit({ ...pendingEdit, value: val });

        // Live preview
        const axis = pendingEdit.axis;
        if (pendingEdit.isRotate) {
          applyAxisRotationValue(selectedObject, axis, val);
        } else {
          if (axis === 'X') selectedObject.position.x = val;
          else if (axis === 'Y') selectedObject.position.y = val;
          else if (axis === 'Z') selectedObject.position.z = val;
        }

        if (
          jointTransformControlsEnabled &&
          robot.selection.type === 'joint' &&
          onPreviewObjectChange
        ) {
          onPreviewObjectChange(selectedObject, robot.selection.id);
        }
      }
    },
    [
      jointTransformControlsEnabled,
      onPreviewObjectChange,
      pendingEdit,
      robot.selection.id,
      robot.selection.type,
      selectedObject,
    ],
  );

  const handleConfirm = useCallback(() => {
    if (!selectedObject || !robot.selection.id || !pendingEdit) return;

    // Apply the edited value
    const axis = pendingEdit.axis;
    if (pendingEdit.isRotate) {
      applyAxisRotationValue(selectedObject, axis, pendingEdit.value);
    } else {
      if (axis === 'X') selectedObject.position.x = pendingEdit.value;
      else if (axis === 'Y') selectedObject.position.y = pendingEdit.value;
      else if (axis === 'Z') selectedObject.position.z = pendingEdit.value;
    }

    persistSelectedObject();

    resetPreviewCache();
    setPendingEdit(null);
  }, [
    applyAxisRotationValue,
    pendingEdit,
    persistSelectedObject,
    resetPreviewCache,
    robot.selection.id,
    selectedObject,
  ]);

  const handleCancel = useCallback(() => {
    if (selectedObject) {
      selectedObject.position.copy(originalPositionRef.current);
      selectedObject.quaternion.copy(originalQuaternionRef.current);
    }
    resetPreviewCache();
    onResetPreview?.();
    setPendingEdit(null);
  }, [onResetPreview, resetPreviewCache, selectedObject]);

  const handleObjectChange = useCallback(() => {
    if (
      !jointTransformControlsEnabled ||
      !selectedObject ||
      robot.selection.type !== 'joint' ||
      !onPreviewObjectChange
    ) {
      return;
    }

    const previousPosition = lastPreviewPositionRef.current;
    const previousQuaternion = lastPreviewQuaternionRef.current;
    const positionChanged =
      !previousPosition ||
      previousPosition.distanceToSquared(selectedObject.position) > PREVIEW_POSITION_EPSILON_SQ;
    const quaternionChanged =
      !previousQuaternion ||
      Math.abs(1 - Math.abs(previousQuaternion.dot(selectedObject.quaternion))) >
        PREVIEW_ROTATION_EPSILON;

    if (!positionChanged && !quaternionChanged) {
      return;
    }

    if (!lastPreviewPositionRef.current) {
      lastPreviewPositionRef.current = new THREE.Vector3();
    }
    if (!lastPreviewQuaternionRef.current) {
      lastPreviewQuaternionRef.current = new THREE.Quaternion();
    }

    lastPreviewPositionRef.current.copy(selectedObject.position);
    lastPreviewQuaternionRef.current.copy(selectedObject.quaternion);
    onPreviewObjectChange(selectedObject, robot.selection.id);
  }, [
    jointTransformControlsEnabled,
    onPreviewObjectChange,
    robot.selection.id,
    robot.selection.type,
    selectedObject,
  ]);

  const handleRotateObjectChange = useCallback(() => {
    if (!rotateEditsJointMotion) {
      handleObjectChange();
      return;
    }

    const selectedJointEntry = getSelectedJoint();
    const nextAngle = extractSelectedJointAngle();
    if (!selectedJointEntry || nextAngle === null) {
      return;
    }

    if (
      lastPreviewAngleRef.current !== null &&
      Math.abs(lastPreviewAngleRef.current - nextAngle) <= PREVIEW_ANGLE_EPSILON
    ) {
      return;
    }

    const previewFeedback = onPreviewRotateChange?.(selectedJointEntry.id, nextAngle);
    const appliedAngle =
      previewFeedback && typeof previewFeedback === 'object' ? previewFeedback.appliedAngle : null;
    if (
      typeof appliedAngle === 'number' &&
      Math.abs(appliedAngle - nextAngle) > PREVIEW_ANGLE_EPSILON
    ) {
      clampRotatePreviewObject(selectedJointEntry.id, appliedAngle);
      lastPreviewAngleRef.current = appliedAngle;
      return;
    }

    lastPreviewAngleRef.current = nextAngle;
  }, [
    clampRotatePreviewObject,
    extractSelectedJointAngle,
    getSelectedJoint,
    handleObjectChange,
    onPreviewRotateChange,
    rotateEditsJointMotion,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleConfirm, handleCancel],
  );

  // Setup event listeners for TransformControls
  useEffect(() => {
    if (!selectedObject || !jointTransformControlsEnabled) return;

    const getAxisValue = (axis: string | null, isRotate: boolean) => {
      if (!axis) return 0;

      if (isRotate) {
        const rotation = getObjectRPY(selectedObject);
        return axis === 'X'
          ? rotation.r
          : axis === 'Y'
            ? rotation.p
            : axis === 'Z'
              ? rotation.y
              : 0;
      }

      return axis === 'X'
        ? selectedObject.position.x
        : axis === 'Y'
          ? selectedObject.position.y
          : axis === 'Z'
            ? selectedObject.position.z
            : 0;
    };

    const bindTranslateListener = (controls: any) => {
      if (!controls) return () => {};

      const handleDraggingChange = (event: any) => {
        const dragging = event.value;
        setHoverFrozen(dragging);

        if (dragging) {
          isDraggingControlRef.current = true;
          originalPositionRef.current.copy(selectedObject.position);
          originalQuaternionRef.current.copy(selectedObject.quaternion);

          const axis = controls.axis;
          currentAxisRef.current = axis;
          startValueRef.current = getAxisValue(axis, false);
          return;
        }

        if (!isDraggingControlRef.current) return;

        isDraggingControlRef.current = false;

        const axis = currentAxisRef.current;
        const currentVal = getAxisValue(axis, false);
        const delta = currentVal - startValueRef.current;

        if (Math.abs(delta) > 0.0001 && axis) {
          persistSelectedObject();
        }
      };

      controls.addEventListener('dragging-changed', handleDraggingChange);

      return () => {
        controls.removeEventListener('dragging-changed', handleDraggingChange);
      };
    };

    const bindRotateListener = (controls: any) => {
      if (!controls) return () => {};

      const handleDraggingChange = (event: any) => {
        setHoverFrozen(Boolean(event.value));
        if (event.value) {
          if (!rotateEditsJointMotion && selectedObject) {
            originalPositionRef.current.copy(selectedObject.position);
            originalQuaternionRef.current.copy(selectedObject.quaternion);
          }
          return;
        }

        if (!rotateEditsJointMotion) {
          persistSelectedObject();
          return;
        }

        const selectedJointEntry = getSelectedJoint();
        const nextAngle = extractSelectedJointAngle();
        if (selectedJointEntry && nextAngle !== null) {
          setJointAngle(selectedJointEntry.joint.name, nextAngle);
        }
      };

      controls.addEventListener('dragging-changed', handleDraggingChange);

      return () => {
        controls.removeEventListener('dragging-changed', handleDraggingChange);
      };
    };

    const cleanupTranslate = bindTranslateListener(transformControlRef.current);
    const cleanupRotate = bindRotateListener(rotateTransformControlRef.current);

    return () => {
      cleanupTranslate();
      cleanupRotate();
    };
  }, [
    extractSelectedJointAngle,
    getObjectRPY,
    getSelectedJoint,
    jointTransformControlsEnabled,
    persistSelectedObject,
    rotateEditsJointMotion,
    selectedObject,
    selectedRotateObject,
    setJointAngle,
    setHoverFrozen,
  ]);

  return {
    transformControlRef,
    rotateTransformControlRef,
    pendingEdit,
    setPendingEdit,
    setRotateInputObject,
    getDisplayValue,
    getDeltaDisplay,
    handleValueChange,
    handleConfirm,
    handleCancel,
    handleKeyDown,
    handleObjectChange,
    handleRotateObjectChange,
  };
}
