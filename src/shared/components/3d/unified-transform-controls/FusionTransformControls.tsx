import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import {
  GIZMO_ARC_RENDER_ORDER,
  THICK_ROTATE_ARC_RADIUS,
  THICK_TRANSLATE_PICKER_RADIUS,
  THICK_TRANSLATE_SHAFT_RADIUS,
  TRANSLATE_ARROW_BASE_RADIUS,
  TRANSLATE_ARROW_HANDLE_OFFSET,
  TRANSLATE_ARROW_LENGTH,
  TRANSLATE_CENTER_GAP,
  resolveAttachedTransformControlObject,
  type SharedControlRef,
  type TransformControlObjectTarget,
  type UnifiedTransformControlsProps,
} from './gizmoCore';

type AxisName = 'X' | 'Y' | 'Z';
type FusionOwner = 'translate' | 'rotate';

type ActiveHandle = {
  owner: FusionOwner;
  axis: AxisName;
};

type FusionControlState = THREE.EventDispatcher & {
  axis: AxisName | null;
  camera: THREE.Camera | null;
  domElement: HTMLElement | null;
  dragging: boolean;
  enabled: boolean;
  mode: FusionOwner;
  object: THREE.Object3D | undefined;
  pointerUp: (pointer?: { button?: number }) => void;
  userData: Record<string, unknown>;
};

type FusionTransformControlsProps = Omit<UnifiedTransformControlsProps, 'onObjectChange'> & {
  maxX?: number;
  maxY?: number;
  maxZ?: number;
  minX?: number;
  minY?: number;
  minZ?: number;
  onObjectChange?: UnifiedTransformControlsProps['onObjectChange'];
  rotationSnap?: number | null;
  showX?: boolean;
  showY?: boolean;
  showZ?: boolean;
  translationSnap?: number | null;
};

type DragState = {
  axis: AxisName;
  axisLocal: THREE.Vector3;
  axisWorld: THREE.Vector3;
  control: FusionControlState;
  object: THREE.Object3D;
  owner: FusionOwner;
  parentWorldQuaternionInv: THREE.Quaternion;
  plane: THREE.Plane;
  pointerId: number;
  space: 'local' | 'world';
  startDirection: THREE.Vector3;
  startIntersection: THREE.Vector3;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  startWorldPosition: THREE.Vector3;
};

const AXES = ['X', 'Y', 'Z'] as const;
const AXIS_COLORS: Record<AxisName, string> = {
  X: '#ff4d5d',
  Y: '#45c95a',
  Z: '#2d8cff',
};
const ACTIVE_AXIS_COLOR = '#0a84ff';
const TRANSLATE_SHAFT_END = TRANSLATE_ARROW_HANDLE_OFFSET;
const ROTATE_ARC_RADIUS = 0.74;
const ROTATE_ARC_START = THREE.MathUtils.degToRad(18);
const ROTATE_ARC_END = THREE.MathUtils.degToRad(112);
const ROTATE_KNOB_ANGLE = THREE.MathUtils.lerp(ROTATE_ARC_START, ROTATE_ARC_END, 0.58);
const ROTATE_PICKER_RADIUS_SCALE = 2.35;
const GUIDE_DASH_SEGMENTS = 26;
const GUIDE_DASH_DUTY = 0.46;
const GUIDE_MIN_HALF_LENGTH = 2.5;

const AXIS_UNIT: Record<AxisName, THREE.Vector3> = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
};

const createFusionControlState = (mode: FusionOwner): FusionControlState => {
  const state = new THREE.EventDispatcher() as FusionControlState;
  state.axis = null;
  state.camera = null;
  state.domElement = null;
  state.dragging = false;
  state.enabled = true;
  state.mode = mode;
  state.object = undefined;
  state.pointerUp = () => {};
  state.userData = {};
  return state;
};

const dispatchControlEvent = (
  control: FusionControlState,
  type: string,
  value?: unknown,
) => {
  (control.dispatchEvent as (event: { target: FusionControlState; type: string; value?: unknown }) => void)({
    type,
    target: control,
    value,
  });
};

const createAxisAlignedCylinderGeometry = (
  axis: AxisName,
  startOffset: number,
  endOffset: number,
  radius: number,
) => {
  const segmentLength = endOffset - startOffset;
  const geometry = new THREE.CylinderGeometry(radius, radius, segmentLength, 16);
  const segmentCenter = startOffset + segmentLength * 0.5;

  if (axis === 'X') {
    geometry.rotateZ(-Math.PI / 2);
    geometry.translate(segmentCenter, 0, 0);
  } else if (axis === 'Y') {
    geometry.translate(0, segmentCenter, 0);
  } else {
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, segmentCenter);
  }

  return geometry;
};

const createAxisAlignedConeGeometry = (
  axis: AxisName,
  startOffset: number,
  length: number,
  radius: number,
) => {
  const geometry = new THREE.CylinderGeometry(0, radius, length, 24);
  const segmentCenter = startOffset + length * 0.5;

  if (axis === 'X') {
    geometry.rotateZ(-Math.PI / 2);
    geometry.translate(segmentCenter, 0, 0);
  } else if (axis === 'Y') {
    geometry.translate(0, segmentCenter, 0);
  } else {
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, segmentCenter);
  }

  return geometry;
};

const getRotateArcPoint = (axis: AxisName, angle: number, radius = ROTATE_ARC_RADIUS) => {
  const cos = Math.cos(angle) * radius;
  const sin = Math.sin(angle) * radius;

  if (axis === 'X') return new THREE.Vector3(0, cos, sin);
  if (axis === 'Y') return new THREE.Vector3(cos, 0, sin);
  return new THREE.Vector3(cos, sin, 0);
};

const createRotateArcGeometry = (axis: AxisName, tubeRadius: number) => {
  const points: THREE.Vector3[] = [];
  const samples = 32;
  for (let index = 0; index < samples; index += 1) {
    const alpha = index / (samples - 1);
    points.push(
      getRotateArcPoint(
        axis,
        THREE.MathUtils.lerp(ROTATE_ARC_START, ROTATE_ARC_END, alpha),
      ),
    );
  }

  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points, false),
    72,
    tubeRadius,
    12,
    false,
  );
};

const createGuideLineGeometry = (axis: AxisName) => {
  const positions: number[] = [];
  for (let index = 0; index < GUIDE_DASH_SEGMENTS; index += 1) {
    const segmentStart = -1 + (index / GUIDE_DASH_SEGMENTS) * 2;
    const segmentEnd = -1 + ((index + GUIDE_DASH_DUTY) / GUIDE_DASH_SEGMENTS) * 2;
    const start = AXIS_UNIT[axis].clone().multiplyScalar(segmentStart);
    const end = AXIS_UNIT[axis].clone().multiplyScalar(segmentEnd);
    positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
};

const createScreenRay = (
  event: PointerEvent,
  domElement: HTMLElement,
  camera: THREE.Camera,
  raycaster: THREE.Raycaster,
) => {
  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );

  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.clone();
};

const intersectRayWithPlane = (ray: THREE.Ray, plane: THREE.Plane) => {
  const target = new THREE.Vector3();
  return ray.intersectPlane(plane, target) ? target : null;
};

const getParentWorldQuaternionInv = (object: THREE.Object3D) => {
  const quaternion = new THREE.Quaternion();
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    object.parent.getWorldQuaternion(quaternion);
    quaternion.invert();
  }
  return quaternion;
};

const getWorldQuaternion = (object: THREE.Object3D) => {
  const quaternion = new THREE.Quaternion();
  object.updateMatrixWorld(true);
  object.getWorldQuaternion(quaternion);
  return quaternion;
};

const setObjectWorldPosition = (object: THREE.Object3D, worldPosition: THREE.Vector3) => {
  const nextPosition = worldPosition.clone();
  if (object.parent) {
    object.parent.worldToLocal(nextPosition);
  }
  object.position.copy(nextPosition);
};

const getTranslateDragPlane = (
  axisWorld: THREE.Vector3,
  origin: THREE.Vector3,
  camera: THREE.Camera,
) => {
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection).normalize();

  const normal = cameraDirection
    .clone()
    .addScaledVector(axisWorld, -cameraDirection.dot(axisWorld));

  if (normal.lengthSq() < 1e-6) {
    const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    normal.copy(cameraUp).addScaledVector(axisWorld, -cameraUp.dot(axisWorld));
  }

  if (normal.lengthSq() < 1e-6) {
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    normal.copy(cameraRight).addScaledVector(axisWorld, -cameraRight.dot(axisWorld));
  }

  normal.normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
};

const getRotationDragPlane = (axisWorld: THREE.Vector3, origin: THREE.Vector3) =>
  new THREE.Plane().setFromNormalAndCoplanarPoint(axisWorld.clone().normalize(), origin);

const getSignedAngleAroundAxis = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  axisWorld: THREE.Vector3,
) => {
  const cross = new THREE.Vector3().crossVectors(from, to);
  return Math.atan2(axisWorld.dot(cross), THREE.MathUtils.clamp(from.dot(to), -1, 1));
};

const applyTranslationSnap = (
  distance: number,
  snap: number | null | undefined,
) => {
  if (!snap || snap <= 0) return distance;
  return Math.round(distance / snap) * snap;
};

const applyRotationSnap = (angle: number, snap: number | null | undefined) => {
  if (!snap || snap <= 0) return angle;
  return Math.round(angle / snap) * snap;
};

const getVisualThicknessScale = (thicknessScale: number) =>
  1 + Math.max(0, thicknessScale - 1) * 0.35;

const getPickerThicknessScale = (thicknessScale: number) =>
  1 + Math.max(0, thicknessScale - 1) * 0.55;

const clampObjectPosition = (
  object: THREE.Object3D,
  limits: Pick<
    FusionTransformControlsProps,
    'maxX' | 'maxY' | 'maxZ' | 'minX' | 'minY' | 'minZ'
  >,
) => {
  object.position.x = THREE.MathUtils.clamp(
    object.position.x,
    limits.minX ?? -Infinity,
    limits.maxX ?? Infinity,
  );
  object.position.y = THREE.MathUtils.clamp(
    object.position.y,
    limits.minY ?? -Infinity,
    limits.maxY ?? Infinity,
  );
  object.position.z = THREE.MathUtils.clamp(
    object.position.z,
    limits.minZ ?? -Infinity,
    limits.maxZ ?? Infinity,
  );
};

const getGizmoScale = (camera: THREE.Camera, worldPosition: THREE.Vector3, size = 1) => {
  const maybeOrtho = camera as THREE.OrthographicCamera;
  if (maybeOrtho.isOrthographicCamera) {
    return ((maybeOrtho.top - maybeOrtho.bottom) / maybeOrtho.zoom) * (size / 4);
  }

  const maybePerspective = camera as THREE.PerspectiveCamera;
  const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const distance = worldPosition.distanceTo(cameraPosition);
  const fov = Number.isFinite(maybePerspective.fov) ? maybePerspective.fov : 50;
  const zoom = Number.isFinite(maybePerspective.zoom) ? maybePerspective.zoom : 1;
  const factor = distance * Math.min((1.9 * Math.tan((Math.PI * fov) / 360)) / zoom, 7);
  return (factor * size) / 4;
};

const getAxisVisible = (
  axis: AxisName,
  props: Pick<FusionTransformControlsProps, 'showX' | 'showY' | 'showZ'>,
) => {
  if (axis === 'X') return props.showX !== false;
  if (axis === 'Y') return props.showY !== false;
  return props.showZ !== false;
};

function GizmoMaterial({
  active,
  axis,
  opacity = 1,
}: {
  active?: boolean;
  axis: AxisName;
  opacity?: number;
}) {
  return (
    <meshBasicMaterial
      color={active ? ACTIVE_AXIS_COLOR : AXIS_COLORS[axis]}
      depthTest={false}
      depthWrite={false}
      opacity={opacity}
      toneMapped={false}
      transparent
    />
  );
}

function TranslateAxisHandle({
  active,
  axis,
  onPointerDown,
  onPointerOut,
  onPointerOver,
  thicknessScale,
}: {
  active: boolean;
  axis: AxisName;
  onPointerDown: (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: AxisName) => void;
  onPointerOut: (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: AxisName) => void;
  onPointerOver: (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: AxisName) => void;
  thicknessScale: number;
}) {
  const visualThicknessScale = getVisualThicknessScale(thicknessScale);
  const pickerThicknessScale = getPickerThicknessScale(thicknessScale);
  const shaftGeometry = useMemo(
    () =>
      createAxisAlignedCylinderGeometry(
        axis,
        TRANSLATE_CENTER_GAP,
        TRANSLATE_SHAFT_END,
        THICK_TRANSLATE_SHAFT_RADIUS * visualThicknessScale,
      ),
    [axis, visualThicknessScale],
  );
  const arrowGeometry = useMemo(
    () =>
      createAxisAlignedConeGeometry(
        axis,
        TRANSLATE_ARROW_HANDLE_OFFSET,
        TRANSLATE_ARROW_LENGTH,
        TRANSLATE_ARROW_BASE_RADIUS * visualThicknessScale,
      ),
    [axis, visualThicknessScale],
  );
  const pickerGeometry = useMemo(
    () =>
      createAxisAlignedCylinderGeometry(
        axis,
        TRANSLATE_CENTER_GAP * 0.78,
        TRANSLATE_ARROW_HANDLE_OFFSET + TRANSLATE_ARROW_LENGTH,
        THICK_TRANSLATE_PICKER_RADIUS * pickerThicknessScale,
      ),
    [axis, pickerThicknessScale],
  );

  const handleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'translate', axis),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'translate', axis),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'translate', axis),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 2,
    userData: { isGizmo: true, urdfAxis: axis },
  };

  return (
    <group name={`fusion-translate-${axis.toLowerCase()}`}>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={shaftGeometry}
        name={`translate-shaft-${axis.toLowerCase()}`}
      >
        <GizmoMaterial active={active} axis={axis} opacity={active ? 1 : 0.94} />
      </mesh>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={arrowGeometry}
        name={`translate-arrow-${axis.toLowerCase()}`}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 3}
      >
        <GizmoMaterial active={active} axis={axis} />
      </mesh>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={pickerGeometry}
        name={`translate-picker-${axis.toLowerCase()}`}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 4}
      >
        <meshBasicMaterial
          color={AXIS_COLORS[axis]}
          depthTest={false}
          depthWrite={false}
          opacity={0}
          toneMapped={false}
          transparent
        />
      </mesh>
    </group>
  );
}

function RotateAxisHandle({
  active,
  axis,
  onPointerDown,
  onPointerOut,
  onPointerOver,
  thicknessScale,
}: {
  active: boolean;
  axis: AxisName;
  onPointerDown: (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: AxisName) => void;
  onPointerOut: (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: AxisName) => void;
  onPointerOver: (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: AxisName) => void;
  thicknessScale: number;
}) {
  const visualThicknessScale = getVisualThicknessScale(thicknessScale);
  const pickerThicknessScale = getPickerThicknessScale(thicknessScale);
  const arcGeometry = useMemo(
    () => createRotateArcGeometry(axis, THICK_ROTATE_ARC_RADIUS * visualThicknessScale),
    [axis, visualThicknessScale],
  );
  const pickerGeometry = useMemo(
    () =>
      createRotateArcGeometry(
        axis,
        THICK_ROTATE_ARC_RADIUS * Math.max(ROTATE_PICKER_RADIUS_SCALE, pickerThicknessScale * 1.45),
      ),
    [axis, pickerThicknessScale],
  );
  const knobPosition = useMemo(() => getRotateArcPoint(axis, ROTATE_KNOB_ANGLE), [axis]);
  const knobRadius = 0.082 * visualThicknessScale;

  const handleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'rotate', axis),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'rotate', axis),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'rotate', axis),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 5,
    userData: { isGizmo: true, urdfAxis: axis },
  };

  return (
    <group name={`fusion-rotate-${axis.toLowerCase()}`}>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={arcGeometry}
        name={`rotate-arc-${axis.toLowerCase()}`}
      >
        <GizmoMaterial active={active} axis={axis} opacity={active ? 1 : 0.9} />
      </mesh>
      <mesh
        {...handleProps}
        frustumCulled={false}
        name={`rotate-knob-${axis.toLowerCase()}`}
        position={knobPosition}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 6}
      >
        <sphereGeometry args={[knobRadius, 24, 16]} />
        <GizmoMaterial active={active} axis={axis} />
      </mesh>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={pickerGeometry}
        name={`rotate-picker-${axis.toLowerCase()}`}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 7}
      >
        <meshBasicMaterial
          color={AXIS_COLORS[axis]}
          depthTest={false}
          depthWrite={false}
          opacity={0}
          toneMapped={false}
          transparent
        />
      </mesh>
    </group>
  );
}

function GuideLine({ axis }: { axis: AxisName }) {
  const geometry = useMemo(() => createGuideLineGeometry(axis), [axis]);

  return (
    <lineSegments frustumCulled={false} geometry={geometry} raycast={() => null}>
      <lineBasicMaterial
        color={ACTIVE_AXIS_COLOR}
        depthTest={false}
        depthWrite={false}
        opacity={0.48}
        toneMapped={false}
        transparent
      />
    </lineSegments>
  );
}

export const FusionTransformControls = forwardRef<unknown, FusionTransformControlsProps>(
  function FusionTransformControls(
    {
      displayThicknessScale = 1,
      enableUniversalPriority: _enableUniversalPriority,
      enabled = true,
      hoverStyle: _hoverStyle,
      maxX,
      maxY,
      maxZ,
      minX,
      minY,
      minZ,
      mode,
      object,
      onChange,
      onDraggingChanged,
      onMouseDown,
      onMouseUp,
      onObjectChange,
      onRotateChange,
      rotateEnabled,
      rotateObject,
      rotateRef,
      rotateSize,
      rotateSpace,
      rotationSnap,
      showX,
      showY,
      showZ,
      size,
      space = 'local',
      translateObject,
      translateSpace,
      translationSnap,
    },
    ref,
  ) {
    const camera = useThree((state) => state.camera);
    const defaultControls = useThree((state) => state.controls);
    const gl = useThree((state) => state.gl);
    const invalidate = useThree((state) => state.invalidate);
    const raycaster = useThree((state) => state.raycaster);
    const scene = useThree((state) => state.scene);

    const rootRef = useRef<THREE.Group>(null);
    const translateGroupRef = useRef<THREE.Group>(null);
    const rotateGroupRef = useRef<THREE.Group>(null);
    const guideGroupRef = useRef<THREE.Group>(null);
    const activeHandleRef = useRef<ActiveHandle | null>(null);
    const activeDragRef = useRef<DragState | null>(null);
    const defaultControlsSuppressedRef = useRef(false);
    const defaultControlsEnabledBeforeSuppressRef = useRef(true);
    const translateControlRef = useRef<FusionControlState | null>(null);
    const rotateControlRef = useRef<FusionControlState | null>(null);
    const [activeHandle, setActiveHandleState] = useState<ActiveHandle | null>(null);

    if (!translateControlRef.current) {
      translateControlRef.current = createFusionControlState('translate');
    }
    if (!rotateControlRef.current) {
      rotateControlRef.current = createFusionControlState('rotate');
    }

    const translateControl = translateControlRef.current;
    const rotateControl = rotateControlRef.current;
    const resolvedTranslateObject = translateObject ?? object;
    const resolvedRotateObject = rotateObject ?? object;
    const attachedTranslateObject =
      resolveAttachedTransformControlObject(
        scene,
        resolvedTranslateObject as TransformControlObjectTarget | undefined,
      ) ?? undefined;
    const attachedRotateObject =
      resolveAttachedTransformControlObject(
        scene,
        resolvedRotateObject as TransformControlObjectTarget | undefined,
      ) ?? undefined;
    const primaryObject = mode === 'rotate' ? attachedRotateObject : attachedTranslateObject;
    const canRender = Boolean(primaryObject) && (mode !== 'universal' || attachedRotateObject);

    const setActiveHandle = useCallback(
      (next: ActiveHandle | null) => {
        activeHandleRef.current = next;
        setActiveHandleState(next);

        translateControl.axis = next?.owner === 'translate' ? next.axis : null;
        rotateControl.axis = next?.owner === 'rotate' ? next.axis : null;

        dispatchControlEvent(translateControl, 'axis-changed', translateControl.axis);
        dispatchControlEvent(rotateControl, 'axis-changed', rotateControl.axis);

        const root = rootRef.current as (THREE.Group & {
          axis?: AxisName | null;
          dragging?: boolean;
        }) | null;
        if (root) {
          root.axis = next?.axis ?? null;
          root.dragging = Boolean(activeDragRef.current);
        }
      },
      [rotateControl, translateControl],
    );

    const primaryControl = mode === 'rotate' ? rotateControl : translateControl;
    useImperativeHandle(ref, () => primaryControl, [primaryControl]);

    useEffect(() => {
      if (!rotateRef) return undefined;

      const mutableRef = rotateRef as SharedControlRef & {
        current: FusionControlState | null;
      };
      mutableRef.current = mode === 'universal' ? rotateControl : null;

      return () => {
        mutableRef.current = null;
      };
    }, [mode, rotateControl, rotateRef]);

    useEffect(() => {
      translateControl.camera = camera;
      translateControl.domElement = gl.domElement;
      translateControl.enabled = enabled && (mode === 'translate' || mode === 'universal');
      translateControl.mode = 'translate';
      translateControl.object = attachedTranslateObject;

      rotateControl.camera = camera;
      rotateControl.domElement = gl.domElement;
      rotateControl.enabled =
        (rotateEnabled ?? enabled) && (mode === 'rotate' || mode === 'universal');
      rotateControl.mode = 'rotate';
      rotateControl.object = attachedRotateObject;
    }, [
      attachedRotateObject,
      attachedTranslateObject,
      camera,
      enabled,
      gl.domElement,
      mode,
      rotateControl,
      rotateEnabled,
      translateControl,
    ]);

    const restoreDefaultControls = useCallback(() => {
      if (
        defaultControls &&
        'enabled' in defaultControls &&
        typeof defaultControls.enabled === 'boolean' &&
        defaultControlsSuppressedRef.current
      ) {
        defaultControls.enabled = defaultControlsEnabledBeforeSuppressRef.current;
        defaultControlsSuppressedRef.current = false;
      }
    }, [defaultControls]);

    const suppressDefaultControls = useCallback(() => {
      if (
        !defaultControls ||
        !('enabled' in defaultControls) ||
        typeof defaultControls.enabled !== 'boolean'
      ) {
        return;
      }

      if (!defaultControlsSuppressedRef.current) {
        if (defaultControls.enabled) {
          defaultControlsEnabledBeforeSuppressRef.current = true;
        }
        defaultControlsSuppressedRef.current = true;
      }

      defaultControls.enabled = false;
    }, [defaultControls]);

    const clearActiveHandle = useCallback(() => {
      if (activeDragRef.current) return;
      setActiveHandle(null);
      restoreDefaultControls();
    }, [restoreDefaultControls, setActiveHandle]);

    const finishDrag = useCallback(
      (owner?: FusionOwner, pointer?: { button?: number }) => {
        const drag = activeDragRef.current;
        if (!drag || (owner && drag.owner !== owner)) return;
        if (pointer?.button !== undefined && pointer.button !== 0) return;

        drag.control.dragging = false;
        drag.control.axis = null;
        activeDragRef.current = null;
        setActiveHandle(null);
        restoreDefaultControls();
        dispatchControlEvent(drag.control, 'dragging-changed', false);
        dispatchControlEvent(drag.control, 'mouseUp');
        onDraggingChanged?.({ value: false });
        (onMouseUp as ((event?: unknown) => void) | undefined)?.({
          mode: drag.control.mode,
          target: drag.control,
          type: 'mouseUp',
        });
        invalidate();
      },
      [invalidate, onDraggingChanged, onMouseUp, restoreDefaultControls, setActiveHandle],
    );

    useEffect(() => {
      translateControl.pointerUp = (pointer) => finishDrag('translate', pointer);
      rotateControl.pointerUp = (pointer) => finishDrag('rotate', pointer);
    }, [finishDrag, rotateControl, translateControl]);

    const emitObjectChange = useCallback(
      (control: FusionControlState) => {
        const event = { mode: control.mode, target: control, type: 'objectChange' };
        if (control.mode === 'rotate' && mode === 'universal') {
          (onRotateChange ?? onChange)?.(event as never);
        } else {
          onChange?.(event as never);
        }
        onObjectChange?.(event as never);
        invalidate();
      },
      [invalidate, mode, onChange, onObjectChange, onRotateChange],
    );

    const updateDragFromRay = useCallback(
      (ray: THREE.Ray) => {
        const drag = activeDragRef.current;
        if (!drag) return;

        const intersection = intersectRayWithPlane(ray, drag.plane);
        if (!intersection) return;

        if (drag.owner === 'translate') {
          const rawDistance = intersection.clone().sub(drag.startIntersection).dot(drag.axisWorld);
          const distance = applyTranslationSnap(rawDistance, translationSnap);
          const nextWorldPosition = drag.startWorldPosition
            .clone()
            .addScaledVector(drag.axisWorld, distance);

          setObjectWorldPosition(drag.object, nextWorldPosition);
          clampObjectPosition(drag.object, { maxX, maxY, maxZ, minX, minY, minZ });
          drag.object.updateMatrixWorld(true);
          emitObjectChange(drag.control);
          return;
        }

        const nextDirection = intersection.clone().sub(drag.startWorldPosition);
        if (nextDirection.lengthSq() < 1e-8) return;
        nextDirection.normalize();

        const rawAngle = getSignedAngleAroundAxis(
          drag.startDirection,
          nextDirection,
          drag.axisWorld,
        );
        const angle = applyRotationSnap(rawAngle, rotationSnap);

        if (drag.space === 'local') {
          drag.object.quaternion
            .copy(drag.startQuaternion)
            .multiply(new THREE.Quaternion().setFromAxisAngle(drag.axisLocal, angle))
            .normalize();
        } else {
          const parentAxis = drag.axisWorld
            .clone()
            .applyQuaternion(drag.parentWorldQuaternionInv)
            .normalize();
          drag.object.quaternion
            .copy(new THREE.Quaternion().setFromAxisAngle(parentAxis, angle))
            .multiply(drag.startQuaternion)
            .normalize();
        }

        drag.object.updateMatrixWorld(true);
        emitObjectChange(drag.control);
      },
      [
        emitObjectChange,
        maxX,
        maxY,
        maxZ,
        minX,
        minY,
        minZ,
        rotationSnap,
        translationSnap,
      ],
    );

    const getOwnerObject = useCallback(
      (owner: FusionOwner) =>
        owner === 'translate' ? attachedTranslateObject : attachedRotateObject,
      [attachedRotateObject, attachedTranslateObject],
    );

    const getOwnerSpace = useCallback(
      (owner: FusionOwner): 'local' | 'world' => {
        const resolvedSpace =
          owner === 'translate' ? (translateSpace ?? space) : (rotateSpace ?? space);
        return resolvedSpace === 'world' ? 'world' : 'local';
      },
      [rotateSpace, space, translateSpace],
    );

    const isOwnerEnabled = useCallback(
      (owner: FusionOwner) => {
        if (!enabled) return false;
        if (owner === 'translate') return mode === 'translate' || mode === 'universal';
        if (mode !== 'rotate' && mode !== 'universal') return false;
        return rotateEnabled ?? enabled;
      },
      [enabled, mode, rotateEnabled],
    );

    const beginDrag = useCallback(
      (
        owner: FusionOwner,
        axis: AxisName,
        ray: THREE.Ray,
        pointerId: number,
      ) => {
        if (!isOwnerEnabled(owner)) return;

        const objectToTransform = getOwnerObject(owner);
        if (!objectToTransform) return;

        objectToTransform.updateMatrixWorld(true);
        const startWorldPosition = new THREE.Vector3();
        objectToTransform.getWorldPosition(startWorldPosition);

        const ownerSpace = getOwnerSpace(owner);
        const startWorldQuaternion = getWorldQuaternion(objectToTransform);
        const axisLocal = AXIS_UNIT[axis].clone();
        const axisWorld =
          ownerSpace === 'local'
            ? axisLocal.clone().applyQuaternion(startWorldQuaternion).normalize()
            : axisLocal.clone();

        const plane =
          owner === 'translate'
            ? getTranslateDragPlane(axisWorld, startWorldPosition, camera)
            : getRotationDragPlane(axisWorld, startWorldPosition);
        const startIntersection = intersectRayWithPlane(ray, plane);
        if (!startIntersection) return;

        const startDirection = startIntersection.clone().sub(startWorldPosition);
        if (owner === 'rotate') {
          if (startDirection.lengthSq() < 1e-8) return;
          startDirection.normalize();
        }

        const control = owner === 'translate' ? translateControl : rotateControl;
        const otherControl = owner === 'translate' ? rotateControl : translateControl;
        otherControl.dragging = false;
        otherControl.axis = null;
        control.dragging = true;
        control.axis = axis;

        const nextDrag: DragState = {
          axis,
          axisLocal,
          axisWorld,
          control,
          object: objectToTransform,
          owner,
          parentWorldQuaternionInv: getParentWorldQuaternionInv(objectToTransform),
          plane,
          pointerId,
          space: ownerSpace,
          startDirection,
          startIntersection,
          startPosition: objectToTransform.position.clone(),
          startQuaternion: objectToTransform.quaternion.clone(),
          startWorldPosition,
        };

        activeDragRef.current = nextDrag;
        setActiveHandle({ owner, axis });
        suppressDefaultControls();
        dispatchControlEvent(control, 'mouseDown');
        dispatchControlEvent(control, 'dragging-changed', true);
        (onMouseDown as ((event?: unknown) => void) | undefined)?.({
          mode: control.mode,
          target: control,
          type: 'mouseDown',
        });
        onDraggingChanged?.({ value: true });
        invalidate();
      },
      [
        camera,
        getOwnerObject,
        getOwnerSpace,
        invalidate,
        isOwnerEnabled,
        onDraggingChanged,
        onMouseDown,
        rotateControl,
        setActiveHandle,
        suppressDefaultControls,
        translateControl,
      ],
    );

    const handlePointerOver = useCallback(
      (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: AxisName) => {
        if (activeDragRef.current || !isOwnerEnabled(owner)) return;

        event.stopPropagation();
        setActiveHandle({ owner, axis });
        suppressDefaultControls();
      },
      [isOwnerEnabled, setActiveHandle, suppressDefaultControls],
    );

    const handlePointerOut = useCallback(
      (_event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: AxisName) => {
        const active = activeHandleRef.current;
        if (!active || active.owner !== owner || active.axis !== axis) return;
        clearActiveHandle();
      },
      [clearActiveHandle],
    );

    const handlePointerDown = useCallback(
      (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: AxisName) => {
        if (event.button !== 0) {
          clearActiveHandle();
          return;
        }

        if (!isOwnerEnabled(owner)) return;

        event.stopPropagation();
        (event.target as Element).setPointerCapture?.(event.pointerId);
        beginDrag(owner, axis, event.ray.clone(), event.pointerId);
      },
      [beginDrag, clearActiveHandle, isOwnerEnabled],
    );

    useEffect(() => {
      const handlePointerMove = (event: PointerEvent) => {
        const drag = activeDragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;

        const ray = createScreenRay(event, gl.domElement, camera, raycaster);
        if (!ray) return;

        updateDragFromRay(ray);
      };

      const handlePointerUp = (event: PointerEvent) => {
        const drag = activeDragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        finishDrag(drag.owner, { button: event.button });
      };

      const handleBlur = () => finishDrag();

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
      window.addEventListener('blur', handleBlur);

      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
        window.removeEventListener('blur', handleBlur);
      };
    }, [camera, finishDrag, gl.domElement, raycaster, updateDragFromRay]);

    useEffect(() => {
      const domElement = (
        defaultControls as
          | {
              domElement?: HTMLElement;
            }
          | null
          | undefined
      )?.domElement;
      if (!domElement) return undefined;

      const handleOrbitIntentCapture = (event: PointerEvent) => {
        if (event.button === 0) return;
        clearActiveHandle();
        restoreDefaultControls();
      };

      domElement.addEventListener('pointerdown', handleOrbitIntentCapture, true);
      return () => {
        domElement.removeEventListener('pointerdown', handleOrbitIntentCapture, true);
      };
    }, [clearActiveHandle, defaultControls, restoreDefaultControls]);

    useEffect(() => {
      if (enabled) return;
      finishDrag();
      clearActiveHandle();
    }, [clearActiveHandle, enabled, finishDrag]);

    useEffect(() => {
      return () => {
        finishDrag();
        restoreDefaultControls();
      };
    }, [finishDrag, restoreDefaultControls]);

    useFrame(() => {
      if (!canRender || !primaryObject) return;

      primaryObject.updateMatrixWorld(true);
      const root = rootRef.current as (THREE.Group & {
        axis?: AxisName | null;
        dragging?: boolean;
      }) | null;
      if (!root) return;

      const origin = new THREE.Vector3();
      primaryObject.getWorldPosition(origin);
      root.position.copy(origin);
      root.quaternion.identity();
      root.scale.setScalar(1);
      root.visible = true;
      root.axis = activeHandleRef.current?.axis ?? null;
      root.dragging = Boolean(activeDragRef.current);

      const translateQuaternion =
        (translateSpace ?? space) === 'world'
          ? new THREE.Quaternion()
          : getWorldQuaternion(attachedTranslateObject ?? primaryObject);
      const rotateQuaternion =
        (rotateSpace ?? space) === 'world'
          ? new THREE.Quaternion()
          : getWorldQuaternion(attachedRotateObject ?? primaryObject);

      const translateScale = getGizmoScale(camera, origin, size ?? 1);
      const rotateScale = getGizmoScale(camera, origin, rotateSize ?? size ?? 1);

      if (translateGroupRef.current) {
        translateGroupRef.current.quaternion.copy(translateQuaternion);
        translateGroupRef.current.scale.setScalar(translateScale);
        translateGroupRef.current.visible = mode === 'translate' || mode === 'universal';
      }

      if (rotateGroupRef.current) {
        rotateGroupRef.current.quaternion.copy(rotateQuaternion);
        rotateGroupRef.current.scale.setScalar(rotateScale);
        rotateGroupRef.current.visible = mode === 'rotate' || mode === 'universal';
      }

      if (guideGroupRef.current) {
        const active = activeHandleRef.current;
        guideGroupRef.current.visible = Boolean(active);
        if (active) {
          guideGroupRef.current.quaternion.copy(
            active.owner === 'translate' ? translateQuaternion : rotateQuaternion,
          );
          const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
          guideGroupRef.current.scale.setScalar(
            Math.max(GUIDE_MIN_HALF_LENGTH, origin.distanceTo(cameraPosition) * 1.35),
          );
        }
      }

      if (activeDragRef.current || activeHandleRef.current) {
        suppressDefaultControls();
      } else {
        restoreDefaultControls();
      }
    }, 1100);

    if (!canRender || mode === 'scale') {
      return null;
    }

    const visibleAxes = AXES.filter((axis) => getAxisVisible(axis, { showX, showY, showZ }));
    const activeAxis = activeHandle?.axis ?? 'X';

    return (
      <group ref={rootRef} name="fusion-transform-controls" userData={{ isGizmo: true }}>
        <group ref={guideGroupRef} name="fusion-transform-guide" visible={false}>
          <GuideLine axis={activeAxis} />
        </group>

        <group ref={translateGroupRef} name="fusion-transform-translate">
          {visibleAxes.map((axis) => (
            <TranslateAxisHandle
              key={`translate-${axis}`}
              active={activeHandle?.owner === 'translate' && activeHandle.axis === axis}
              axis={axis}
              onPointerDown={handlePointerDown}
              onPointerOut={handlePointerOut}
              onPointerOver={handlePointerOver}
              thicknessScale={displayThicknessScale}
            />
          ))}
        </group>

        <group ref={rotateGroupRef} name="fusion-transform-rotate">
          {visibleAxes.map((axis) => (
            <RotateAxisHandle
              key={`rotate-${axis}`}
              active={activeHandle?.owner === 'rotate' && activeHandle.axis === axis}
              axis={axis}
              onPointerDown={handlePointerDown}
              onPointerOut={handlePointerOut}
              onPointerOver={handlePointerOver}
              thicknessScale={displayThicknessScale}
            />
          ))}
        </group>
      </group>
    );
  },
);
