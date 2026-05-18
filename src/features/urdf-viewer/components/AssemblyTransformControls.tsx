import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { UnifiedTransformControls, VISUALIZER_UNIFIED_GIZMO_SIZE } from '@/shared/components/3d';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransforms';
import type { AssemblyState, AssemblyTransform, RobotState, UrdfOrigin } from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';
import type { AssemblySelection } from '@/store/assemblySelectionStore';
import { useSelectionStore } from '@/store/selectionStore';
import {
  decomposeJointPivotMatrixToOrigin,
  resolveAssemblyComponentTransformTarget,
} from '../utils/assemblyTransformControlsShared';
import { AssemblySelectionBounds } from './AssemblySelectionBounds';

interface AssemblyTransformControlsProps {
  robot: RobotState;
  runtimeRobot: THREE.Object3D | null;
  assemblyState?: AssemblyState | null;
  assemblySelection?: AssemblySelection;
  transformMode: 'translate' | 'rotate' | 'universal';
  assemblyRoot: THREE.Group | null;
  sourceSceneComponentRoot?: THREE.Group | null;
  sourceSceneComponentId?: string | null;
  onAssemblyTransform?: (transform: AssemblyTransform) => void;
  onComponentTransform?: (
    componentId: string,
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  onBridgeTransform?: (
    bridgeId: string,
    origin: UrdfOrigin,
    options?: UpdateCommitOptions,
  ) => void;
  onSourceSceneComponentTransform?: (
    componentId: string,
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  onTransformPendingChange?: (pending: boolean) => void;
}

interface DragBaseline {
  type: 'assembly' | 'component';
  componentId?: string;
  baseMatrix?: THREE.Matrix4;
  bridgeId?: string;
  sourceSceneComponent?: boolean;
  object?: THREE.Object3D;
}

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

function composeTransformMatrix(transform?: AssemblyTransform | null): THREE.Matrix4 {
  const normalized = cloneAssemblyTransform(transform);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(normalized.position.x, normalized.position.y, normalized.position.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(normalized.rotation.r, normalized.rotation.p, normalized.rotation.y, 'ZYX'),
    ),
    UNIT_SCALE,
  );
}

function decomposeTransformMatrix(matrix: THREE.Matrix4): AssemblyTransform {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'ZYX');

  matrix.decompose(position, quaternion, scale);
  euler.setFromQuaternion(quaternion, 'ZYX');

  return cloneAssemblyTransform({
    position: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    rotation: {
      r: euler.x,
      p: euler.y,
      y: euler.z,
    },
  });
}

export const AssemblyTransformControls = memo(function AssemblyTransformControls({
  robot,
  runtimeRobot,
  assemblyState = null,
  assemblySelection,
  transformMode,
  assemblyRoot,
  sourceSceneComponentRoot = null,
  sourceSceneComponentId = null,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  onSourceSceneComponentTransform,
  onTransformPendingChange,
}: AssemblyTransformControlsProps) {
  const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
  const dragBaselineRef = useRef<DragBaseline | null>(null);
  const targetComponentId = assemblySelection?.type === 'component' ? assemblySelection.id : null;
  const runtimeJointObjects = useMemo(() => {
    const joints =
      (runtimeRobot as (THREE.Object3D & { joints?: Record<string, THREE.Object3D> }) | null)
        ?.joints ?? {};
    return Object.fromEntries(
      Object.entries(joints).map(([jointId, jointObject]) => [jointId, jointObject ?? null]),
    ) as Record<string, THREE.Object3D | null>;
  }, [runtimeRobot]);
  const componentTransformTarget = useMemo(
    () =>
      resolveAssemblyComponentTransformTarget({
        robot,
        assemblyState,
        componentId: targetComponentId,
        jointObjects: runtimeJointObjects,
      }),
    [assemblyState, robot, runtimeJointObjects, targetComponentId],
  );
  const hasSourceSceneComponentFallback = Boolean(
    targetComponentId &&
    sourceSceneComponentRoot &&
    sourceSceneComponentId &&
    targetComponentId === sourceSceneComponentId,
  );
  const componentMoveBlocked = Boolean(
    targetComponentId &&
    assemblyState &&
    !componentTransformTarget &&
    !hasSourceSceneComponentFallback,
  );

  const activeObject =
    assemblySelection?.type === 'assembly'
      ? assemblyRoot
      : (componentTransformTarget?.object ?? sourceSceneComponentRoot ?? null);

  const prepareDragBaseline = useCallback(() => {
    if (assemblySelection?.type === 'assembly') {
      dragBaselineRef.current = assemblyRoot
        ? { type: 'assembly', object: assemblyRoot }
        : { type: 'assembly' };
      return;
    }

    if (assemblySelection?.type !== 'component' || !assemblySelection.id || !assemblyState) {
      dragBaselineRef.current = null;
      return;
    }

    if (hasSourceSceneComponentFallback) {
      dragBaselineRef.current = {
        type: 'component',
        componentId: assemblySelection.id,
        sourceSceneComponent: true,
        object: sourceSceneComponentRoot ?? undefined,
      };
      return;
    }

    if (!componentTransformTarget?.object) {
      dragBaselineRef.current = null;
      return;
    }

    if (componentTransformTarget.kind === 'bridge') {
      dragBaselineRef.current = {
        type: 'component',
        componentId: assemblySelection.id,
        bridgeId: componentTransformTarget.bridgeId,
        object: componentTransformTarget.object ?? undefined,
      };
      return;
    }

    componentTransformTarget.object.updateMatrix();
    const currentLocalMatrix = componentTransformTarget.object.matrix.clone();
    const currentTransformMatrix = composeTransformMatrix(
      assemblyState.components[assemblySelection.id]?.transform,
    );
    const baseMatrix = currentLocalMatrix.clone().multiply(currentTransformMatrix.clone().invert());

    dragBaselineRef.current = {
      type: 'component',
      componentId: assemblySelection.id,
      baseMatrix,
      object: componentTransformTarget.object ?? undefined,
    };
  }, [
    assemblyRoot,
    assemblySelection,
    assemblyState,
    componentTransformTarget,
    hasSourceSceneComponentFallback,
    sourceSceneComponentRoot,
  ]);

  const commitTransform = useCallback(() => {
    const dragBaseline = dragBaselineRef.current;
    if (!dragBaseline) {
      return;
    }

    if (dragBaseline.type === 'assembly') {
      if (!dragBaseline.object || !onAssemblyTransform) {
        return;
      }

      dragBaseline.object.updateMatrix();
      onAssemblyTransform(decomposeTransformMatrix(dragBaseline.object.matrix));
      return;
    }

    if (dragBaseline.bridgeId) {
      if (!dragBaseline.object || !onBridgeTransform) {
        return;
      }

      dragBaseline.object.updateMatrix();
      onBridgeTransform(
        dragBaseline.bridgeId,
        decomposeJointPivotMatrixToOrigin(dragBaseline.object.matrix),
        { commitMode: 'immediate' },
      );
      return;
    }

    if (dragBaseline.sourceSceneComponent) {
      if (
        !dragBaseline.componentId ||
        !dragBaseline.object ||
        !onSourceSceneComponentTransform
      ) {
        return;
      }

      dragBaseline.object.updateMatrix();
      onSourceSceneComponentTransform(
        dragBaseline.componentId,
        decomposeTransformMatrix(dragBaseline.object.matrix),
        { commitMode: 'immediate' },
      );
      return;
    }

    if (
      !dragBaseline.componentId ||
      !dragBaseline.baseMatrix ||
      !dragBaseline.object ||
      !onComponentTransform
    ) {
      return;
    }

    dragBaseline.object.updateMatrix();
    const currentLocalMatrix = dragBaseline.object.matrix.clone();
    const nextTransformMatrix = dragBaseline.baseMatrix
      .clone()
      .invert()
      .multiply(currentLocalMatrix);

    onComponentTransform(
      dragBaseline.componentId,
      decomposeTransformMatrix(nextTransformMatrix),
      {
        commitMode: 'immediate',
      },
    );
  }, [
    onAssemblyTransform,
    onBridgeTransform,
    onComponentTransform,
    onSourceSceneComponentTransform,
  ]);

  const handleDraggingChanged = useCallback(
    (event?: { value?: boolean }) => {
      const dragging = Boolean(event?.value);
      setHoverFrozen(dragging);
      onTransformPendingChange?.(dragging);

      if (dragging) {
        prepareDragBaseline();
        return;
      }

      commitTransform();
      dragBaselineRef.current = null;
    },
    [commitTransform, onTransformPendingChange, prepareDragBaseline, setHoverFrozen],
  );

  useEffect(
    () => () => {
      setHoverFrozen(false);
      onTransformPendingChange?.(false);
      dragBaselineRef.current = null;
    },
    [onTransformPendingChange, setHoverFrozen],
  );

  if (componentMoveBlocked) {
    return (
      <Html fullscreen>
        <div className="pointer-events-none absolute right-4 top-4 rounded-lg border border-amber-400/30 bg-panel-bg/95 px-3 py-2 text-xs text-text-primary shadow-lg">
          This bridged component has no direct root-bridge transform target.
        </div>
      </Html>
    );
  }

  if (!activeObject) {
    return null;
  }

  return (
    <>
      <AssemblySelectionBounds object={activeObject} />
      <UnifiedTransformControls
        object={activeObject}
        mode={transformMode}
        size={VISUALIZER_UNIFIED_GIZMO_SIZE}
        translateSpace="world"
        rotateSpace="local"
        hoverStyle="single-axis"
        displayStyle="thick-primary"
        onDraggingChanged={handleDraggingChanged}
      />
    </>
  );
});
