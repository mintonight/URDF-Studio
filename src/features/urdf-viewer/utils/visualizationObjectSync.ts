import * as THREE from 'three';

import { parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import {
  getVisualGeometryEntries,
  resolveDirectManipulableLinkIkDescriptor,
  resolveLinkIkHandleDescriptor,
  resolveLinkKey,
} from '@/core/robot';
import { GIZMO_BASE_RENDER_ORDER } from '@/shared/components/3d/unified-transform-controls/gizmoCore.ts';
import { MathUtils as SharedMathUtils } from '@/shared/utils';
import { GeometryType, type UrdfJoint, type UrdfLink } from '@/types';
import type { ViewerHelperKind } from '../types';

import { getRobotSceneNodeIndex } from './robotSceneNodeIndex';
import {
  createLinkIkHandle,
  createCoMVisual,
  createInertiaBox,
  createJointAxisViz,
  createMjcfSiteVisualization,
  createMjcfTendonVisualization,
  MJCF_TENDON_RENDER_ORDER,
  createOriginAxes,
  type MjcfSiteVisualizationData,
  type MjcfTendonVisualizationData,
} from './visualizationFactories.ts';

interface SyncOriginAxesVisualizationOptions {
  links: THREE.Object3D[];
  showOrigins: boolean;
  showOriginsOverlay: boolean;
  originSize: number;
}

interface SyncJointAxesVisualizationOptions {
  joints: THREE.Object3D[];
  showJointAxes: boolean;
  showJointAxesOverlay: boolean;
  jointAxisSize: number;
}

interface SyncInertiaVisualizationOptions {
  links: THREE.Object3D[];
  robotLinks?: Record<string, UrdfLink>;
  showInertia: boolean;
  showInertiaOverlay: boolean;
  showCenterOfMass: boolean;
  showCoMOverlay: boolean;
  centerOfMassSize: number;
  pooledLinkBox?: THREE.Box3;
  pooledLinkSize?: THREE.Vector3;
}

interface SyncIkHandleVisualizationOptions {
  links: THREE.Object3D[];
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  showIkHandles: boolean;
  showIkHandlesAlwaysOnTop: boolean;
  ikDragActive?: boolean;
}

interface SyncMjcfSiteVisualizationOptions {
  links: THREE.Object3D[];
  sourceFormat: 'urdf' | 'mjcf';
  showMjcfSites: boolean;
  showMjcfWorldLink: boolean;
}

interface SyncMjcfTendonVisualizationOptions {
  robot: THREE.Object3D;
  sourceFormat: 'urdf' | 'mjcf';
  showMjcfTendons: boolean;
}

const ORIGIN_OVERLAY_BASE_RENDER_ORDER = GIZMO_BASE_RENDER_ORDER - 60;

interface SyncLinkHelperInteractionStateOptions {
  links: THREE.Object3D[];
  hoveredLinkId?: string | null;
  hoveredHelperKind?: ViewerHelperKind | null;
  selectedLinkId?: string | null;
  selectedHelperKind?: ViewerHelperKind | null;
}

interface SyncJointHelperInteractionStateOptions {
  joints: THREE.Object3D[];
  hoveredJointId?: string | null;
  hoveredHelperKind?: ViewerHelperKind | null;
  selectedJointId?: string | null;
  selectedHelperKind?: ViewerHelperKind | null;
}

const scratchLinkBox = new THREE.Box3();
const scratchLinkSize = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const scratchQuaternion = new THREE.Quaternion();
const scratchHelperObjects = new Set<THREE.Object3D>();
const scratchMjcfSiteWorldPosition = new THREE.Vector3();
const scratchMjcfTendonLocalStart = new THREE.Vector3();
const scratchMjcfTendonLocalEnd = new THREE.Vector3();
const scratchMjcfTendonSegmentVector = new THREE.Vector3();
const scratchMjcfTendonSegmentMidpoint = new THREE.Vector3();
const scratchMjcfTendonSegmentDirection = new THREE.Vector3();
const scratchMjcfTendonProjectionVector = new THREE.Vector3();
const scratchMjcfTendonProjectionOffset = new THREE.Vector3();
const scratchMjcfTendonProjectionPoint = new THREE.Vector3();
const scratchMjcfTendonBasisU = new THREE.Vector3();
const scratchMjcfTendonBasisV = new THREE.Vector3();
const scratchMjcfTendonBasisCandidate = new THREE.Vector3();
const scratchMjcfTendonWorldScale = new THREE.Vector3();
const mjcfTendonYAxis = new THREE.Vector3(0, 1, 0);
const MJCF_TENDON_MIN_VISIBLE_RADIUS = 0.003;
const MJCF_INVERSE_CYLINDER_SIDE_INSIDE_RATIO = 0.75;
const IK_HANDLE_STYLE_VERSION = 3;
const IK_HANDLE_IDLE_COLOR = 0x16a34a;
const IK_HANDLE_HOVER_COLOR = 0x22c55e;
const IK_HANDLE_SELECTED_COLOR = 0x15803d;
const ORIGIN_AXES_HOVER_LIFT = 0.32;
const ORIGIN_AXES_SELECTED_LIFT = 0.18;

interface MjcfSiteAnchorData {
  worldPosition: THREE.Vector3;
  radius: number | null;
  linkName: string | null;
  wrapRadius?: number | null;
  wrapAxis?: THREE.Vector3 | null;
  wrapGeometryType?: GeometryType | null;
}

type HelperInteractionState = 'idle' | 'selected' | 'hovered';

function updateVisible(object: THREE.Object3D, visible: boolean): boolean {
  if (object.visible === visible) return false;
  object.visible = visible;
  return true;
}

function updateParentLinkName(object: THREE.Object3D, linkName: string | null): boolean {
  const nextLinkName =
    typeof linkName === 'string' && linkName.trim().length > 0 ? linkName.trim() : null;
  const currentLinkName =
    typeof object.userData?.parentLinkName === 'string' ? object.userData.parentLinkName : null;

  if (currentLinkName === nextLinkName) {
    return false;
  }

  if (!object.userData) {
    object.userData = {};
  }

  if (nextLinkName) {
    object.userData.parentLinkName = nextLinkName;
  } else {
    delete object.userData.parentLinkName;
  }

  return true;
}

function updateUserDataValue(object: THREE.Object3D, key: string, value: unknown): boolean {
  const currentValue = object.userData?.[key];
  if (currentValue === value) {
    return false;
  }

  if (!object.userData) {
    object.userData = {};
  }

  if (value === undefined) {
    delete object.userData[key];
  } else {
    object.userData[key] = value;
  }

  return true;
}

function updateVisualMeshMetadata(object: THREE.Object3D, linkName: string | null): boolean {
  let changed = false;

  changed = updateParentLinkName(object, linkName) || changed;
  changed = updateUserDataValue(object, 'isVisual', true) || changed;
  changed = updateUserDataValue(object, 'isCollision', false) || changed;
  changed = updateUserDataValue(object, 'geometryRole', 'visual') || changed;

  if ((object as THREE.Mesh).isMesh) {
    changed = updateUserDataValue(object, 'isVisualMesh', true) || changed;
    changed = updateUserDataValue(object, 'isCollisionMesh', false) || changed;
  }

  return changed;
}

function updateScale(object: THREE.Object3D, scale: number): boolean {
  if (object.scale.x === scale && object.scale.y === scale && object.scale.z === scale) {
    return false;
  }

  object.scale.set(scale, scale, scale);
  return true;
}

function updateScale3(object: THREE.Object3D, x: number, y: number, z: number): boolean {
  if (object.scale.x === x && object.scale.y === y && object.scale.z === z) {
    return false;
  }

  object.scale.set(x, y, z);
  return true;
}

function updatePosition(object: THREE.Object3D, x: number, y: number, z: number): boolean {
  if (object.position.x === x && object.position.y === y && object.position.z === z) {
    return false;
  }

  object.position.set(x, y, z);
  return true;
}

function updateQuaternion(object: THREE.Object3D, quaternion: THREE.Quaternion): boolean {
  if (
    object.quaternion.x === quaternion.x &&
    object.quaternion.y === quaternion.y &&
    object.quaternion.z === quaternion.z &&
    object.quaternion.w === quaternion.w
  ) {
    return false;
  }

  object.quaternion.copy(quaternion);
  return true;
}

function updateMaterialState(
  material: THREE.Material & {
    opacity?: number;
    transparent?: boolean;
    depthTest?: boolean;
    depthWrite?: boolean;
    needsUpdate?: boolean;
  },
  nextState: {
    opacity?: number;
    transparent?: boolean;
    depthTest?: boolean;
    depthWrite?: boolean;
  },
): boolean {
  let changed = false;

  if (nextState.opacity !== undefined && material.opacity !== nextState.opacity) {
    material.opacity = nextState.opacity;
    changed = true;
  }

  if (nextState.transparent !== undefined && material.transparent !== nextState.transparent) {
    material.transparent = nextState.transparent;
    changed = true;
  }

  if (nextState.depthTest !== undefined && material.depthTest !== nextState.depthTest) {
    material.depthTest = nextState.depthTest;
    changed = true;
  }

  if (nextState.depthWrite !== undefined && material.depthWrite !== nextState.depthWrite) {
    material.depthWrite = nextState.depthWrite;
    changed = true;
  }

  if (changed) {
    material.needsUpdate = true;
  }

  return changed;
}

function updateRenderOrder(
  object: THREE.Object3D & { renderOrder?: number },
  renderOrder: number,
): boolean {
  if (object.renderOrder === renderOrder) return false;
  object.renderOrder = renderOrder;
  return true;
}

function disposeObject3DResources(object: THREE.Object3D): void {
  object.traverse((child: any) => {
    if (child.geometry?.dispose) {
      child.geometry.dispose();
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material: THREE.Material | undefined) => {
      material?.dispose?.();
    });
  });
}

function resolveHelperInteractionState(
  isHovered: boolean,
  isSelected: boolean,
): HelperInteractionState {
  if (isHovered) return 'hovered';
  if (isSelected) return 'selected';
  return 'idle';
}

function updateInteractionScale(object: THREE.Object3D, multiplier: number): boolean {
  const previousMultiplier =
    typeof object.userData.__interactionScaleMultiplier === 'number'
      ? object.userData.__interactionScaleMultiplier
      : 1;
  const baseScaleX = object.scale.x / previousMultiplier;
  const baseScaleY = object.scale.y / previousMultiplier;
  const baseScaleZ = object.scale.z / previousMultiplier;
  const nextScaleX = baseScaleX * multiplier;
  const nextScaleY = baseScaleY * multiplier;
  const nextScaleZ = baseScaleZ * multiplier;

  if (
    object.scale.x === nextScaleX &&
    object.scale.y === nextScaleY &&
    object.scale.z === nextScaleZ
  ) {
    object.userData.__interactionScaleMultiplier = multiplier;
    return false;
  }

  object.scale.set(nextScaleX, nextScaleY, nextScaleZ);
  object.userData.__interactionScaleMultiplier = multiplier;
  return true;
}

function updateInteractionRenderOrder(
  object: THREE.Object3D & { renderOrder?: number },
  offset: number,
): boolean {
  const previousOffset =
    typeof object.userData.__interactionRenderOrderOffset === 'number'
      ? object.userData.__interactionRenderOrderOffset
      : 0;
  const baseRenderOrder =
    typeof object.userData.__interactionBaseRenderOrder === 'number'
      ? object.userData.__interactionBaseRenderOrder
      : object.renderOrder - previousOffset;
  const nextRenderOrder = baseRenderOrder + offset;

  if (object.renderOrder === nextRenderOrder) {
    object.userData.__interactionBaseRenderOrder = baseRenderOrder;
    object.userData.__interactionRenderOrderOffset = offset;
    return false;
  }

  object.renderOrder = nextRenderOrder;
  object.userData.__interactionBaseRenderOrder = baseRenderOrder;
  object.userData.__interactionRenderOrderOffset = offset;
  return true;
}

function updateBaseRenderOrder(
  object: THREE.Object3D & { renderOrder?: number },
  baseRenderOrder: number,
): boolean {
  const interactionOffset =
    typeof object.userData.__interactionRenderOrderOffset === 'number'
      ? object.userData.__interactionRenderOrderOffset
      : 0;
  const nextRenderOrder = baseRenderOrder + interactionOffset;

  object.userData.__interactionBaseRenderOrder = baseRenderOrder;

  if (object.renderOrder === nextRenderOrder) {
    return false;
  }

  object.renderOrder = nextRenderOrder;
  return true;
}

function updateInteractionOpacity(
  material: THREE.Material & {
    opacity?: number;
    transparent?: boolean;
    needsUpdate?: boolean;
  },
  multiplier: number,
): boolean {
  if (typeof material.opacity !== 'number') {
    return false;
  }

  const previousMultiplier =
    typeof material.userData.__interactionOpacityMultiplier === 'number'
      ? material.userData.__interactionOpacityMultiplier
      : 1;
  const baseOpacity = material.opacity / previousMultiplier;
  const nextOpacity = THREE.MathUtils.clamp(baseOpacity * multiplier, 0, 1);
  const nextTransparent = material.transparent || nextOpacity < 1;
  let changed = false;

  if (material.opacity !== nextOpacity) {
    material.opacity = nextOpacity;
    changed = true;
  }

  if (material.transparent !== nextTransparent) {
    material.transparent = nextTransparent;
    changed = true;
  }

  if (changed) {
    material.needsUpdate = true;
  }

  material.userData.__interactionOpacityMultiplier = multiplier;
  return changed;
}

function resolveHelperKindFromObject(object: THREE.Object3D): ViewerHelperKind | null {
  if (object.userData?.viewerHelperKind === 'ik-handle') {
    return 'ik-handle';
  }

  switch (object.name) {
    case '__ik_handle__':
      return 'ik-handle';
    case '__com_visual__':
      return 'center-of-mass';
    case '__inertia_box__':
      return 'inertia';
    case '__origin_axes__':
      return 'origin-axes';
    case '__joint_axis__':
    case '__joint_axis_helper__':
      return 'joint-axis';
    default:
      return null;
  }
}

function updateInteractionColor(
  material: THREE.Material & {
    color?: THREE.Color;
    needsUpdate?: boolean;
  },
  activeColorHex?: number,
): boolean {
  if (!material.color?.isColor) {
    return false;
  }

  const previousOverride =
    typeof material.userData.__interactionColorOverride === 'number'
      ? material.userData.__interactionColorOverride
      : null;
  const baseColorHex =
    previousOverride !== null
      ? Number(material.userData.__interactionBaseColorHex ?? material.color.getHex())
      : material.color.getHex();
  const nextColorHex = activeColorHex ?? baseColorHex;

  material.userData.__interactionBaseColorHex = baseColorHex;
  material.userData.__interactionColorOverride = activeColorHex ?? null;

  if (material.color.getHex() === nextColorHex) {
    return false;
  }

  material.color.setHex(nextColorHex);
  material.needsUpdate = true;
  return true;
}

function updateInteractionColorLift(
  material: THREE.Material & {
    color?: THREE.Color;
    needsUpdate?: boolean;
  },
  liftAmount: number,
): boolean {
  if (!material.color?.isColor) {
    return false;
  }

  const storedBaseColorHex = material.userData.__interactionLiftBaseColorHex;
  const baseColorHex =
    typeof storedBaseColorHex === 'number' ? storedBaseColorHex : material.color.getHex();
  const nextColor = new THREE.Color(baseColorHex).lerp(new THREE.Color(0xffffff), liftAmount);

  material.userData.__interactionLiftBaseColorHex = baseColorHex;
  material.userData.__interactionColorLift = liftAmount;

  if (material.color.equals(nextColor)) {
    return false;
  }

  material.color.copy(nextColor);
  material.needsUpdate = true;
  return true;
}

function collectUniqueHelperObjects(
  ...objects: Array<THREE.Object3D | null | undefined>
): THREE.Object3D[] {
  scratchHelperObjects.clear();

  objects.forEach((object) => {
    if (object) {
      scratchHelperObjects.add(object);
    }
  });

  return Array.from(scratchHelperObjects);
}

function getLinkHelperObjects(link: any): THREE.Object3D[] {
  return collectUniqueHelperObjects(
    link.userData.__ikHandle as THREE.Object3D | undefined,
    link.userData.__originAxes as THREE.Object3D | undefined,
    link.children.find((child: any) => child.name === '__link_axes_helper__'),
    link.userData.__comVisual as THREE.Object3D | undefined,
    link.userData.__inertiaBox as THREE.Object3D | undefined,
  );
}

function getJointHelperObjects(joint: any): THREE.Object3D[] {
  return collectUniqueHelperObjects(
    joint.userData.__jointAxisViz as THREE.Object3D | undefined,
    joint.children.find((child: any) => child.name === '__joint_axis_helper__'),
  );
}

function shouldHideMjcfWorldRuntimeLink(
  sourceFormat: 'urdf' | 'mjcf',
  showMjcfWorldLink: boolean,
  runtimeLinkName: string | undefined,
): boolean {
  return sourceFormat === 'mjcf' && !showMjcfWorldLink && runtimeLinkName === 'world';
}

function getHelperScaleMultiplier(
  state: HelperInteractionState,
  hoveredScale: number,
  selectedScale: number,
): number {
  if (state === 'hovered') return hoveredScale;
  if (state === 'selected') return selectedScale;
  return 1;
}

function getHelperRenderOrderOffset(state: HelperInteractionState): number {
  if (state === 'hovered') return 40;
  if (state === 'selected') return 20;
  return 0;
}

function getHelperOpacityMultiplier(
  state: HelperInteractionState,
  hoveredOpacity: number,
  selectedOpacity: number,
): number {
  if (state === 'hovered') return hoveredOpacity;
  if (state === 'selected') return selectedOpacity;
  return 1;
}

function resolveRobotRootLinkId(
  robotLinks?: Record<string, UrdfLink>,
  robotJoints?: Record<string, UrdfJoint>,
): string | null {
  if (!robotLinks || !robotJoints) {
    return null;
  }

  const linkIds = Object.keys(robotLinks);
  if (linkIds.length === 0) {
    return null;
  }

  const childLinkIds = new Set(Object.values(robotJoints).map((joint) => joint.childLinkId));
  return linkIds.find((linkId) => !childLinkIds.has(linkId)) ?? linkIds[0] ?? null;
}

export function syncIkHandleVisualizationForLinks({
  links,
  robotLinks,
  robotJoints,
  showIkHandles,
  showIkHandlesAlwaysOnTop,
  ikDragActive = false,
}: SyncIkHandleVisualizationOptions): boolean {
  let changed = false;
  const rootLinkId = resolveRobotRootLinkId(robotLinks, robotJoints);
  const robotData =
    robotLinks && robotJoints && rootLinkId
      ? { links: robotLinks, joints: robotJoints, rootLinkId }
      : null;

  links.forEach((link: any) => {
    if (!link.isURDFLink) return;

    let ikHandle = link.userData.__ikHandle as THREE.Group | undefined;
    if (ikHandle && ikHandle.parent !== link) {
      ikHandle = undefined;
      link.userData.__ikHandle = undefined;
    }

    const linkId = robotData ? resolveLinkKey(robotData.links, link.name) : null;
    const descriptor = linkId
      ? ikDragActive
        ? (resolveDirectManipulableLinkIkDescriptor(robotData, linkId) ??
          resolveLinkIkHandleDescriptor(robotData, linkId))
        : resolveLinkIkHandleDescriptor(robotData, linkId)
      : null;

    if (!descriptor) {
      if (ikHandle) {
        link.remove(ikHandle);
        disposeObject3DResources(ikHandle);
        link.userData.__ikHandle = undefined;
        changed = true;
      }
      return;
    }

    const currentRadius = Number(ikHandle?.userData?.radius ?? NaN);
    const currentStyleVersion = Number(ikHandle?.userData?.ikHandleStyleVersion ?? NaN);
    const needsReplacement =
      !ikHandle ||
      !Number.isFinite(currentRadius) ||
      Math.abs(currentRadius - descriptor.radius) > 1e-6 ||
      currentStyleVersion !== IK_HANDLE_STYLE_VERSION;

    if (needsReplacement) {
      if (ikHandle) {
        link.remove(ikHandle);
        disposeObject3DResources(ikHandle);
      }

      ikHandle = createLinkIkHandle(descriptor.radius);
      link.add(ikHandle);
      link.userData.__ikHandle = ikHandle;
      changed = true;
    }

    if (!ikHandle) {
      return;
    }

    ikHandle.userData.radius = descriptor.radius;
    ikHandle.userData.ikHandleStyleVersion = IK_HANDLE_STYLE_VERSION;
    ikHandle.userData.parentLinkName = link.name;
    ikHandle.userData.viewerHelperKind = 'ik-handle';
    changed = updateVisible(ikHandle, showIkHandles) || changed;
    changed =
      updatePosition(
        ikHandle,
        descriptor.anchorLocal.x,
        descriptor.anchorLocal.y,
        descriptor.anchorLocal.z,
      ) || changed;

    ikHandle.traverse((child: any) => {
      if (child === ikHandle) {
        return;
      }

      child.userData = {
        ...child.userData,
        ikHandleStyleVersion: IK_HANDLE_STYLE_VERSION,
        parentLinkName: link.name,
        viewerHelperKind: 'ik-handle',
      };
      if (child.material) {
        changed =
          updateMaterialState(child.material, {
            transparent: true,
            opacity: 0.68,
            depthTest: !showIkHandlesAlwaysOnTop,
            depthWrite: false,
          }) || changed;
        changed = updateInteractionColor(child.material, undefined) || changed;
      }

      if (child.isMesh || child.type === 'LineSegments') {
        changed = updateBaseRenderOrder(child, showIkHandlesAlwaysOnTop ? 10030 : 0) || changed;
      }
    });
  });

  return changed;
}

export function syncOriginAxesVisualizationForLinks({
  links,
  showOrigins,
  showOriginsOverlay,
  originSize,
}: SyncOriginAxesVisualizationOptions): boolean {
  let changed = false;

  links.forEach((link: any) => {
    if (!link.isURDFLink) return;

    let originAxes = link.userData.__originAxes as THREE.Group | undefined;
    if (originAxes && originAxes.parent !== link) {
      originAxes = undefined;
      link.userData.__originAxes = undefined;
    }

    if (!originAxes && showOrigins) {
      originAxes = createOriginAxes(originSize);
      link.add(originAxes);
      originAxes.userData.size = originSize;
      link.userData.__originAxes = originAxes;
      changed = true;
    }

    if (!originAxes) return;

    changed = updateVisible(originAxes, showOrigins) || changed;
    if (!showOrigins) return;

    changed = updateScale(originAxes, 1) || changed;

    const previousSize = originAxes.userData.size;
    if (typeof previousSize !== 'number' || Math.abs(previousSize - originSize) > 0.001) {
      while (originAxes.children.length > 0) {
        const child = originAxes.children[0];
        originAxes.remove(child);
        if ((child as any).geometry) (child as any).geometry.dispose();
        if ((child as any).material) (child as any).material.dispose();
      }

      const replacementAxes = createOriginAxes(originSize);
      while (replacementAxes.children.length > 0) {
        originAxes.add(replacementAxes.children[0]);
      }
      originAxes.userData.size = originSize;
      changed = true;
    }

    originAxes.traverse((child: any) => {
      if (child.material) {
        changed =
          updateMaterialState(child.material, {
            depthTest: !showOriginsOverlay,
            depthWrite: !showOriginsOverlay,
            transparent: showOriginsOverlay,
          }) || changed;
      }

      if (child.isMesh) {
        const nextRenderOrder = showOriginsOverlay ? ORIGIN_OVERLAY_BASE_RENDER_ORDER : 0;
        const didChange = updateRenderOrder(child, nextRenderOrder);
        changed = didChange || changed;
        if (didChange || child.renderOrder === nextRenderOrder) {
          child.userData.__interactionBaseRenderOrder = nextRenderOrder;
        }
      }
    });
  });

  return changed;
}

export function syncJointAxesVisualizationForJoints({
  joints,
  showJointAxes,
  showJointAxesOverlay,
  jointAxisSize,
}: SyncJointAxesVisualizationOptions): boolean {
  let changed = false;

  joints.forEach((joint: any) => {
    if (!joint.isURDFJoint || joint.jointType === 'fixed') return;

    let jointAxisViz = joint.userData.__jointAxisViz as THREE.Object3D | undefined;
    if (jointAxisViz && jointAxisViz.parent !== joint) {
      jointAxisViz = undefined;
      joint.userData.__jointAxisViz = undefined;
    }

    if (!jointAxisViz && showJointAxes) {
      const axis = joint.axis || new THREE.Vector3(0, 0, 1);
      jointAxisViz = createJointAxisViz(joint.jointType, axis, jointAxisSize);
      joint.add(jointAxisViz);
      jointAxisViz.userData.size = jointAxisSize;
      jointAxisViz.userData.axisX = axis.x;
      jointAxisViz.userData.axisY = axis.y;
      jointAxisViz.userData.axisZ = axis.z;
      jointAxisViz.userData.jointType = joint.jointType;
      joint.userData.__jointAxisViz = jointAxisViz;
      changed = true;
    }

    if (!jointAxisViz) return;

    changed = updateVisible(jointAxisViz, showJointAxes) || changed;
    if (!showJointAxes) return;

    const originalScale = jointAxisViz.userData.size;
    const origAxisX = jointAxisViz.userData.axisX;
    const origAxisY = jointAxisViz.userData.axisY;
    const origAxisZ = jointAxisViz.userData.axisZ;
    const origJointType = jointAxisViz.userData.jointType;
    const currentAxis = joint.axis || new THREE.Vector3(0, 0, 1);

    if (
      typeof originalScale !== 'number' ||
      Math.abs(jointAxisSize - originalScale) > 0.01 ||
      origAxisX !== currentAxis.x ||
      origAxisY !== currentAxis.y ||
      origAxisZ !== currentAxis.z ||
      origJointType !== joint.jointType
    ) {
      joint.remove(jointAxisViz);
      jointAxisViz.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });

      const replacement = createJointAxisViz(joint.jointType, currentAxis, jointAxisSize);
      joint.add(replacement);
      replacement.userData.size = jointAxisSize;
      replacement.userData.axisX = currentAxis.x;
      replacement.userData.axisY = currentAxis.y;
      replacement.userData.axisZ = currentAxis.z;
      replacement.userData.jointType = joint.jointType;
      joint.userData.__jointAxisViz = replacement;
      jointAxisViz = replacement;
      changed = true;
    }

    jointAxisViz.traverse((child: any) => {
      if (child.material) {
        changed =
          updateMaterialState(child.material, {
            depthTest: !showJointAxesOverlay,
            depthWrite: !showJointAxesOverlay,
            transparent: showJointAxesOverlay,
          }) || changed;
      }

      if (child.isMesh) {
        const nextRenderOrder = showJointAxesOverlay ? 10001 : 0;
        const didChange = updateRenderOrder(child, nextRenderOrder);
        changed = didChange || changed;
        if (didChange || child.renderOrder === nextRenderOrder) {
          child.userData.__interactionBaseRenderOrder = nextRenderOrder;
        }
      }
    });
  });

  return changed;
}

export function syncInertiaVisualizationForLinks({
  links,
  robotLinks,
  showInertia,
  showInertiaOverlay,
  showCenterOfMass,
  showCoMOverlay,
  centerOfMassSize,
  pooledLinkBox,
  pooledLinkSize,
}: SyncInertiaVisualizationOptions): boolean {
  let changed = false;
  const linkBox = pooledLinkBox ?? scratchLinkBox;
  const linkSize = pooledLinkSize ?? scratchLinkSize;

  links.forEach((link: any) => {
    if (!link.isURDFLink) return;

    const linkData = robotLinks?.[link.name];
    const inertialData = linkData?.inertial;
    if (!inertialData || inertialData.mass <= 0) return;

    let vizGroup = link.userData.__inertiaVisualGroup as THREE.Group | undefined;
    if (vizGroup && vizGroup.parent !== link) {
      vizGroup = undefined;
      link.userData.__inertiaVisualGroup = undefined;
      link.userData.__comVisual = undefined;
      link.userData.__inertiaBox = undefined;
    }

    if (!vizGroup) {
      vizGroup = new THREE.Group();
      vizGroup.name = '__inertia_visual__';
      vizGroup.userData = { isGizmo: true, isSelectableHelper: true };
      link.add(vizGroup);
      link.userData.__inertiaVisualGroup = vizGroup;
      changed = true;
    }

    let comVisual = link.userData.__comVisual as THREE.Object3D | undefined;
    if (comVisual && comVisual.parent !== vizGroup) {
      comVisual = undefined;
      link.userData.__comVisual = undefined;
    }
    if (!comVisual) {
      comVisual = createCoMVisual();
      vizGroup.add(comVisual);
      link.userData.__comVisual = comVisual;
      changed = true;
    }

    const sizeScale = centerOfMassSize / 0.01;
    changed = updateScale(comVisual, sizeScale) || changed;
    changed = updateVisible(comVisual, showCenterOfMass) || changed;

    if (showCenterOfMass) {
      comVisual.traverse((child: any) => {
        if (child.material) {
          changed =
            updateMaterialState(child.material, {
              opacity: 0.95,
              transparent: true,
              depthTest: !showCoMOverlay,
              depthWrite: !showCoMOverlay,
            }) || changed;
        }

        if (child.isMesh) {
          const nextRenderOrder = showCoMOverlay ? 10001 : 0;
          const didChange = updateRenderOrder(child, nextRenderOrder);
          changed = didChange || changed;
          if (didChange || child.renderOrder === nextRenderOrder) {
            child.userData.__interactionBaseRenderOrder = nextRenderOrder;
          }
        }
      });
    }

    let inertiaBox = link.userData.__inertiaBox as THREE.Object3D | undefined;
    if (inertiaBox && inertiaBox.parent !== vizGroup) {
      inertiaBox = undefined;
      link.userData.__inertiaBox = undefined;
    }

    // Detect inertial data changes and re-create box
    const inertia = inertialData.inertia;
    const inertiaKey = `${inertialData.mass}:${inertia.ixx}:${inertia.ixy}:${inertia.ixz}:${inertia.iyy}:${inertia.iyz}:${inertia.izz}`;
    const prevInertiaKey = link.userData.__inertiaBoxKey as string | undefined;
    if (inertiaBox && prevInertiaKey !== undefined && prevInertiaKey !== inertiaKey) {
      inertiaBox.parent?.remove(inertiaBox);
      disposeObject3DResources(inertiaBox);
      link.userData.__inertiaBox = undefined;
      link.userData.__inertiaBoxKey = undefined;
      link.userData.__cachedMaxLinkSize = undefined;
      inertiaBox = undefined;
      changed = true;
    }

    if (!inertiaBox) {
      let maxLinkSize: number | undefined;
      try {
        const cachedMaxLinkSize = link.userData.__cachedMaxLinkSize;
        if (
          typeof cachedMaxLinkSize === 'number' &&
          isFinite(cachedMaxLinkSize) &&
          cachedMaxLinkSize > 0
        ) {
          maxLinkSize = cachedMaxLinkSize;
        } else {
          const sizeVector = linkBox.setFromObject(link).getSize(linkSize);
          maxLinkSize = Math.max(sizeVector.x, sizeVector.y, sizeVector.z);
          if (isFinite(maxLinkSize) && maxLinkSize > 0) {
            link.userData.__cachedMaxLinkSize = maxLinkSize;
          }
        }

        if (!isFinite(maxLinkSize) || maxLinkSize <= 0) {
          maxLinkSize = undefined;
        }
      } catch {
        maxLinkSize = undefined;
      }

      const boxData = SharedMathUtils.computeInertiaBox(inertialData, maxLinkSize);
      if (boxData) {
        const { width, height, depth, rotation } = boxData;
        inertiaBox = createInertiaBox(width, height, depth, rotation);
        vizGroup.add(inertiaBox);
        link.userData.__inertiaBox = inertiaBox;
        link.userData.__inertiaBoxKey = inertiaKey;
        changed = true;
      }
    }

    if (inertiaBox) {
      changed = updateVisible(inertiaBox, showInertia) || changed;

      if (showInertia) {
        inertiaBox.traverse((child: any) => {
          if (child.material) {
            changed =
              updateMaterialState(child.material, {
                opacity:
                  child.type === 'Mesh' ? 0.25 : child.type === 'LineSegments' ? 0.6 : undefined,
                transparent: true,
                depthTest: !showInertiaOverlay,
                depthWrite: !showInertiaOverlay,
              }) || changed;
          }

          if (child.isMesh || child.type === 'LineSegments') {
            const nextRenderOrder = showInertiaOverlay ? 10001 : 0;
            const didChange = updateRenderOrder(child, nextRenderOrder);
            changed = didChange || changed;
            if (didChange || child.renderOrder === nextRenderOrder) {
              child.userData.__interactionBaseRenderOrder = nextRenderOrder;
            }
          }
        });
      }
    }

    const origin = inertialData.origin;
    if (origin) {
      const xyz = origin.xyz || { x: 0, y: 0, z: 0 };
      const rpy = origin.rpy || { r: 0, p: 0, y: 0 };

      changed = updatePosition(vizGroup, xyz.x, xyz.y, xyz.z) || changed;
      scratchEuler.set(rpy.r, rpy.p, rpy.y, 'ZYX');
      scratchQuaternion.setFromEuler(scratchEuler);
      changed = updateQuaternion(vizGroup, scratchQuaternion) || changed;
    }

    changed = updateVisible(vizGroup, showInertia || showCenterOfMass) || changed;
  });

  return changed;
}

export function syncMjcfSiteVisualizationForLinks({
  links,
  sourceFormat,
  showMjcfSites,
  showMjcfWorldLink,
}: SyncMjcfSiteVisualizationOptions): boolean {
  let changed = false;

  links.forEach((link: any) => {
    if (!link.isURDFLink) {
      return;
    }

    const siteData = Array.isArray(link.userData.__mjcfSitesData)
      ? (link.userData.__mjcfSitesData as MjcfSiteVisualizationData[])
      : [];

    let sitesGroup = link.userData.__mjcfSites as THREE.Group | undefined;
    if (sitesGroup && sitesGroup.parent !== link) {
      sitesGroup = undefined;
      link.userData.__mjcfSites = undefined;
    }

    if (!sitesGroup && siteData.length > 0) {
      sitesGroup = new THREE.Group();
      sitesGroup.name = '__mjcf_sites__';
      sitesGroup.userData = {
        isGizmo: true,
        isSelectableHelper: false,
        isMjcfSitesGroup: true,
      };
      siteData.forEach((site) => {
        sitesGroup?.add(createMjcfSiteVisualization(site));
      });
      link.add(sitesGroup);
      link.userData.__mjcfSites = sitesGroup;
      changed = true;
    }

    if (!sitesGroup) {
      return;
    }

    const nextVisible =
      sourceFormat === 'mjcf' &&
      showMjcfSites &&
      siteData.length > 0 &&
      !shouldHideMjcfWorldRuntimeLink(sourceFormat, showMjcfWorldLink, link.name);
    changed = updateVisible(sitesGroup, nextVisible) || changed;
  });

  return changed;
}

function resolveFiniteUserDataNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveMjcfWrapRadiusFromGeometryObject(object: THREE.Object3D): number | null {
  const geometryType = object.userData?.geometryType;
  if (
    geometryType !== GeometryType.SPHERE &&
    geometryType !== GeometryType.CYLINDER &&
    geometryType !== GeometryType.CAPSULE &&
    geometryType !== GeometryType.ELLIPSOID
  ) {
    return null;
  }

  const dimensions = object.userData?.geometryDimensions as
    | { x?: unknown; y?: unknown; z?: unknown }
    | undefined;
  const radius = resolveFiniteUserDataNumber(dimensions?.x);
  if (!radius || radius <= 0) {
    return null;
  }

  object.getWorldScale(scratchMjcfTendonWorldScale);
  const worldScale = Math.max(
    Math.abs(scratchMjcfTendonWorldScale.x),
    Math.abs(scratchMjcfTendonWorldScale.y),
    Math.abs(scratchMjcfTendonWorldScale.z),
  );
  return radius * (Number.isFinite(worldScale) && worldScale > 0 ? worldScale : 1);
}

function resolveMjcfWrapAxisFromGeometryObject(object: THREE.Object3D): THREE.Vector3 | null {
  const geometryType = object.userData?.geometryType;
  if (geometryType !== GeometryType.CYLINDER && geometryType !== GeometryType.CAPSULE) {
    return null;
  }

  object.getWorldQuaternion(scratchQuaternion);
  return new THREE.Vector3(0, 0, 1).applyQuaternion(scratchQuaternion).normalize();
}

function resolveMjcfWrapGeometryTypeFromObject(object: THREE.Object3D): GeometryType | null {
  const geometryType = object.userData?.geometryType;
  return Object.values(GeometryType).includes(geometryType as GeometryType)
    ? (geometryType as GeometryType)
    : null;
}

function collectMjcfTendonAnchorsByName(robot: THREE.Object3D): Map<string, MjcfSiteAnchorData> {
  const siteAnchors = new Map<string, MjcfSiteAnchorData>();

  robot.traverse((object) => {
    if (!(object as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink) {
      return;
    }

    const sitesData = Array.isArray(object.userData.__mjcfSitesData)
      ? (object.userData.__mjcfSitesData as MjcfSiteVisualizationData[])
      : [];
    if (sitesData.length === 0) {
      return;
    }

    sitesData.forEach((site) => {
      const linkName =
        typeof object.name === 'string' && object.name.trim().length > 0
          ? object.name.trim()
          : null;
      const localPosition = site.pos ?? [0, 0, 0];
      scratchMjcfSiteWorldPosition.set(localPosition[0], localPosition[1], localPosition[2]);
      object.localToWorld(scratchMjcfSiteWorldPosition);

      const anchor: MjcfSiteAnchorData = {
        worldPosition: scratchMjcfSiteWorldPosition.clone(),
        radius:
          typeof site.size?.[0] === 'number' && Number.isFinite(site.size[0]) ? site.size[0] : null,
        linkName,
      };

      if (!siteAnchors.has(site.name)) {
        siteAnchors.set(site.name, anchor);
      }

      if (
        typeof site.sourceName === 'string' &&
        site.sourceName.length > 0 &&
        !siteAnchors.has(site.sourceName)
      ) {
        siteAnchors.set(site.sourceName, anchor);
      }
    });

    object.children.forEach((child) => {
      const geometryName =
        typeof child.userData?.geometryName === 'string' ? child.userData.geometryName.trim() : '';
      if (!geometryName || siteAnchors.has(geometryName)) {
        return;
      }

      const linkName =
        typeof object.name === 'string' && object.name.trim().length > 0
          ? object.name.trim()
          : null;
      child.getWorldPosition(scratchMjcfSiteWorldPosition);
      siteAnchors.set(geometryName, {
        worldPosition: scratchMjcfSiteWorldPosition.clone(),
        radius: null,
        linkName,
        wrapRadius: resolveMjcfWrapRadiusFromGeometryObject(child),
        wrapAxis: resolveMjcfWrapAxisFromGeometryObject(child),
        wrapGeometryType: resolveMjcfWrapGeometryTypeFromObject(child),
      });
    });
  });

  return siteAnchors;
}

function resolveMjcfTendonRadius(
  tendon: MjcfTendonVisualizationData,
  siteAnchorsByName: Map<string, MjcfSiteAnchorData>,
): number {
  if (typeof tendon.width === 'number' && Number.isFinite(tendon.width) && tendon.width > 0) {
    return Math.max(tendon.width * 0.5, MJCF_TENDON_MIN_VISIBLE_RADIUS);
  }

  const siteRadii = tendon.attachmentRefs
    .map((attachmentRef) => siteAnchorsByName.get(attachmentRef)?.radius ?? null)
    .filter(
      (radius): radius is number =>
        typeof radius === 'number' && Number.isFinite(radius) && radius > 0,
    );
  if (siteRadii.length > 0) {
    return Math.max(Math.min(...siteRadii) * 0.5, MJCF_TENDON_MIN_VISIBLE_RADIUS);
  }

  return MJCF_TENDON_MIN_VISIBLE_RADIUS;
}

function cloneMjcfTendonAnchor(anchor: MjcfSiteAnchorData): MjcfSiteAnchorData {
  return {
    worldPosition: anchor.worldPosition.clone(),
    radius: anchor.radius,
    linkName: anchor.linkName,
    wrapRadius: anchor.wrapRadius,
    wrapAxis: anchor.wrapAxis?.clone() ?? null,
    wrapGeometryType: anchor.wrapGeometryType ?? null,
  };
}

function projectMjcfWrapAnchorOntoSitePath(
  wrapAnchor: MjcfSiteAnchorData,
  previousSiteAnchor: MjcfSiteAnchorData | undefined,
  nextSiteAnchor: MjcfSiteAnchorData | undefined,
): MjcfSiteAnchorData {
  if (!previousSiteAnchor || !nextSiteAnchor) {
    return cloneMjcfTendonAnchor(wrapAnchor);
  }

  scratchMjcfTendonProjectionVector.subVectors(
    nextSiteAnchor.worldPosition,
    previousSiteAnchor.worldPosition,
  );
  const lengthSq = scratchMjcfTendonProjectionVector.lengthSq();
  if (lengthSq <= 1e-12) {
    return cloneMjcfTendonAnchor(wrapAnchor);
  }

  scratchMjcfTendonProjectionOffset.subVectors(
    wrapAnchor.worldPosition,
    previousSiteAnchor.worldPosition,
  );
  const t = THREE.MathUtils.clamp(
    scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonProjectionVector) / lengthSq,
    0,
    1,
  );

  return {
    worldPosition: previousSiteAnchor.worldPosition
      .clone()
      .addScaledVector(scratchMjcfTendonProjectionVector, t),
    radius: wrapAnchor.radius,
    linkName: wrapAnchor.linkName ?? previousSiteAnchor.linkName ?? nextSiteAnchor.linkName,
  };
}

function createMjcfTendonContactAnchor(
  wrapAnchor: MjcfSiteAnchorData,
  worldPosition: THREE.Vector3,
  previousSiteAnchor: MjcfSiteAnchorData | undefined,
  nextSiteAnchor: MjcfSiteAnchorData | undefined,
): MjcfSiteAnchorData {
  return {
    worldPosition,
    radius: wrapAnchor.radius,
    linkName: wrapAnchor.linkName ?? previousSiteAnchor?.linkName ?? nextSiteAnchor?.linkName ?? null,
    wrapRadius: wrapAnchor.wrapRadius,
    wrapAxis: wrapAnchor.wrapAxis?.clone() ?? null,
    wrapGeometryType: wrapAnchor.wrapGeometryType ?? null,
  };
}

function computeMjcfLineSphereSurfacePoint(
  fromWorld: THREE.Vector3,
  toWorld: THREE.Vector3,
  sphereCenterWorld: THREE.Vector3,
  radius: number,
): THREE.Vector3 | null {
  const direction = toWorld.clone().sub(fromWorld);
  const a = direction.lengthSq();
  if (a <= 1e-12) {
    return null;
  }

  const fromOffset = fromWorld.clone().sub(sphereCenterWorld);
  const b = 2 * fromOffset.dot(direction);
  const c = fromOffset.lengthSq() - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const sqrtDiscriminant = Math.sqrt(discriminant);
  const roots = [
    (-b - sqrtDiscriminant) / (2 * a),
    (-b + sqrtDiscriminant) / (2 * a),
  ]
    .filter((root) => root >= 0 && root <= 1)
    .sort((left, right) => left - right);
  const t = roots[0];
  if (t === undefined) {
    return null;
  }

  return fromWorld.clone().addScaledVector(direction, t);
}

function computeMjcfLineCylinderSurfacePoint(
  fromWorld: THREE.Vector3,
  toWorld: THREE.Vector3,
  cylinderCenterWorld: THREE.Vector3,
  cylinderAxisWorld: THREE.Vector3,
  radius: number,
): THREE.Vector3 | null {
  const direction = toWorld.clone().sub(fromWorld);
  const radialDirection = direction
    .clone()
    .addScaledVector(cylinderAxisWorld, -direction.dot(cylinderAxisWorld));
  const a = radialDirection.lengthSq();
  if (a <= 1e-12) {
    return null;
  }

  const fromOffset = fromWorld.clone().sub(cylinderCenterWorld);
  const radialOffset = fromOffset.addScaledVector(
    cylinderAxisWorld,
    -fromOffset.dot(cylinderAxisWorld),
  );
  const b = 2 * radialOffset.dot(radialDirection);
  const c = radialOffset.lengthSq() - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const sqrtDiscriminant = Math.sqrt(discriminant);
  const roots = [
    (-b - sqrtDiscriminant) / (2 * a),
    (-b + sqrtDiscriminant) / (2 * a),
  ]
    .filter((root) => root >= 0 && root <= 1)
    .sort((left, right) => left - right);
  const t = roots[0];
  if (t === undefined) {
    return null;
  }

  return fromWorld.clone().addScaledVector(direction, t);
}

function resolveMjcfInverseSphereWrapContactAnchors(
  wrapAnchor: MjcfSiteAnchorData,
  previousSiteAnchor: MjcfSiteAnchorData,
  nextSiteAnchor: MjcfSiteAnchorData,
  sideAnchor: MjcfSiteAnchorData,
  radius: number,
): MjcfSiteAnchorData[] {
  const firstContact = computeMjcfLineSphereSurfacePoint(
    previousSiteAnchor.worldPosition,
    sideAnchor.worldPosition,
    wrapAnchor.worldPosition,
    radius,
  );
  const secondContact = computeMjcfLineSphereSurfacePoint(
    sideAnchor.worldPosition,
    nextSiteAnchor.worldPosition,
    wrapAnchor.worldPosition,
    radius,
  );

  if (!firstContact || !secondContact) {
    return [];
  }

  return [
    createMjcfTendonContactAnchor(
      wrapAnchor,
      firstContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
    createMjcfTendonContactAnchor(
      wrapAnchor,
      secondContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
  ];
}

function resolveMjcfInverseCylinderWrapContactAnchors(
  wrapAnchor: MjcfSiteAnchorData,
  previousSiteAnchor: MjcfSiteAnchorData,
  nextSiteAnchor: MjcfSiteAnchorData,
  sideAnchor: MjcfSiteAnchorData,
  wrapAxis: THREE.Vector3,
  radius: number,
): MjcfSiteAnchorData[] {
  const firstContact = computeMjcfLineCylinderSurfacePoint(
    previousSiteAnchor.worldPosition,
    sideAnchor.worldPosition,
    wrapAnchor.worldPosition,
    wrapAxis,
    radius,
  );
  const secondContact = computeMjcfLineCylinderSurfacePoint(
    sideAnchor.worldPosition,
    nextSiteAnchor.worldPosition,
    wrapAnchor.worldPosition,
    wrapAxis,
    radius,
  );

  if (!firstContact || !secondContact) {
    return [];
  }

  return [
    createMjcfTendonContactAnchor(
      wrapAnchor,
      firstContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
    createMjcfTendonContactAnchor(
      wrapAnchor,
      secondContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
  ];
}

function computeMjcfCircleTangentPoints2D(
  pointX: number,
  pointY: number,
  radius: number,
): THREE.Vector2[] {
  const distance = Math.hypot(pointX, pointY);
  if (!Number.isFinite(distance) || distance <= radius) {
    return [];
  }

  const baseAngle = Math.atan2(pointY, pointX);
  const tangentAngle = Math.acos(THREE.MathUtils.clamp(radius / distance, -1, 1));
  return [
    new THREE.Vector2(
      radius * Math.cos(baseAngle + tangentAngle),
      radius * Math.sin(baseAngle + tangentAngle),
    ),
    new THREE.Vector2(
      radius * Math.cos(baseAngle - tangentAngle),
      radius * Math.sin(baseAngle - tangentAngle),
    ),
  ];
}

function resolveStableMjcfTendonWrapPlaneBasis(
  previousWorld: THREE.Vector3,
  nextWorld: THREE.Vector3,
  wrapWorld: THREE.Vector3,
  sideWorld?: THREE.Vector3,
): boolean {
  scratchMjcfTendonBasisU.subVectors(nextWorld, previousWorld);
  const segmentLength = scratchMjcfTendonBasisU.length();
  if (segmentLength <= 1e-12) {
    return false;
  }
  scratchMjcfTendonBasisU.divideScalar(segmentLength);

  scratchMjcfTendonProjectionOffset.subVectors(wrapWorld, previousWorld);
  const projectionDistance = scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonBasisU);
  scratchMjcfTendonProjectionPoint
    .copy(previousWorld)
    .addScaledVector(scratchMjcfTendonBasisU, projectionDistance);
  scratchMjcfTendonBasisV.subVectors(wrapWorld, scratchMjcfTendonProjectionPoint);
  if (scratchMjcfTendonBasisV.lengthSq() > 1e-12) {
    scratchMjcfTendonBasisV.normalize();
    return true;
  }

  if (sideWorld) {
    scratchMjcfTendonBasisV.subVectors(sideWorld, scratchMjcfTendonProjectionPoint);
    scratchMjcfTendonBasisV.addScaledVector(
      scratchMjcfTendonBasisU,
      -scratchMjcfTendonBasisV.dot(scratchMjcfTendonBasisU),
    );
    if (scratchMjcfTendonBasisV.lengthSq() > 1e-12) {
      scratchMjcfTendonBasisV.normalize();
      return true;
    }
  }

  scratchMjcfTendonBasisCandidate.set(0, 0, 1);
  if (Math.abs(scratchMjcfTendonBasisCandidate.dot(scratchMjcfTendonBasisU)) > 0.95) {
    scratchMjcfTendonBasisCandidate.set(0, 1, 0);
  }
  scratchMjcfTendonBasisV
    .crossVectors(scratchMjcfTendonBasisU, scratchMjcfTendonBasisCandidate)
    .normalize();
  return scratchMjcfTendonBasisV.lengthSq() > 0;
}

function resolveMjcfWrapContactAnchors(
  wrapAnchor: MjcfSiteAnchorData,
  previousSiteAnchor: MjcfSiteAnchorData | undefined,
  nextSiteAnchor: MjcfSiteAnchorData | undefined,
  sideAnchor: MjcfSiteAnchorData | undefined,
): MjcfSiteAnchorData[] {
  if (!previousSiteAnchor || !nextSiteAnchor) {
    return [cloneMjcfTendonAnchor(wrapAnchor)];
  }

  const radius = wrapAnchor.wrapRadius;
  if (!radius || !Number.isFinite(radius) || radius <= 0) {
    return [
      projectMjcfWrapAnchorOntoSitePath(wrapAnchor, previousSiteAnchor, nextSiteAnchor),
    ];
  }

  const isCylindricalWrap =
    (wrapAnchor.wrapGeometryType === GeometryType.CYLINDER ||
      wrapAnchor.wrapGeometryType === GeometryType.CAPSULE) &&
    wrapAnchor.wrapAxis;
  const wrapAxis = isCylindricalWrap ? wrapAnchor.wrapAxis! : null;
  const previousPlanePoint = previousSiteAnchor.worldPosition.clone();
  const nextPlanePoint = nextSiteAnchor.worldPosition.clone();
  const sidePlanePoint = sideAnchor?.worldPosition.clone();

  if (wrapAxis) {
    previousPlanePoint.addScaledVector(
      wrapAxis,
      -scratchMjcfTendonProjectionOffset
        .subVectors(previousPlanePoint, wrapAnchor.worldPosition)
        .dot(wrapAxis),
    );
    nextPlanePoint.addScaledVector(
      wrapAxis,
      -scratchMjcfTendonProjectionOffset
        .subVectors(nextPlanePoint, wrapAnchor.worldPosition)
        .dot(wrapAxis),
    );
    if (sidePlanePoint) {
      sidePlanePoint.addScaledVector(
        wrapAxis,
        -scratchMjcfTendonProjectionOffset
          .subVectors(sidePlanePoint, wrapAnchor.worldPosition)
          .dot(wrapAxis),
      );
    }
  }

  if (
    !resolveStableMjcfTendonWrapPlaneBasis(
      previousPlanePoint,
      nextPlanePoint,
      wrapAnchor.worldPosition,
      sidePlanePoint,
    )
  ) {
    return [];
  }

  scratchMjcfTendonProjectionVector.subVectors(
    nextPlanePoint,
    previousPlanePoint,
  );
  const segmentLengthSq = scratchMjcfTendonProjectionVector.lengthSq();
  if (segmentLengthSq <= 1e-12) {
    return [];
  }

  scratchMjcfTendonProjectionOffset.subVectors(
    wrapAnchor.worldPosition,
    previousPlanePoint,
  );
  const projectionT =
    scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonProjectionVector) / segmentLengthSq;
  scratchMjcfTendonProjectionPoint
    .copy(previousPlanePoint)
    .addScaledVector(scratchMjcfTendonProjectionVector, projectionT);
  const lineDistance = scratchMjcfTendonProjectionPoint.distanceTo(wrapAnchor.worldPosition);
  const sideDistanceFromWrapCenter = sidePlanePoint
    ? sidePlanePoint.distanceTo(wrapAnchor.worldPosition)
    : Infinity;

  // MuJoCo uses an inside sidesite as inverse wrapping instead of outside tangency.
  if (sideAnchor && sideDistanceFromWrapCenter < radius) {
    if (wrapAxis) {
      return sideDistanceFromWrapCenter <= radius * MJCF_INVERSE_CYLINDER_SIDE_INSIDE_RATIO
        ? resolveMjcfInverseCylinderWrapContactAnchors(
            wrapAnchor,
            previousSiteAnchor,
            nextSiteAnchor,
            sideAnchor,
            wrapAxis,
            radius,
          )
        : [];
    }

    if (lineDistance >= radius) {
      return resolveMjcfInverseSphereWrapContactAnchors(
        wrapAnchor,
        previousSiteAnchor,
        nextSiteAnchor,
        sideAnchor,
        radius,
      );
    }

    return [];
  }

  if (
    projectionT <= 0 ||
    projectionT >= 1 ||
    (wrapAxis && (projectionT < 0.15 || projectionT > 0.85)) ||
    lineDistance >= radius
  ) {
    return [];
  }

  const previousLocalX = scratchMjcfTendonProjectionOffset
    .subVectors(previousPlanePoint, wrapAnchor.worldPosition)
    .dot(scratchMjcfTendonBasisU);
  const previousLocalY = scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonBasisV);
  const nextLocalX = scratchMjcfTendonProjectionOffset
    .subVectors(nextPlanePoint, wrapAnchor.worldPosition)
    .dot(scratchMjcfTendonBasisU);
  const nextLocalY = scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonBasisV);
  const sideLocal =
    sidePlanePoint &&
    new THREE.Vector2(
      scratchMjcfTendonProjectionOffset
        .subVectors(sidePlanePoint, wrapAnchor.worldPosition)
        .dot(scratchMjcfTendonBasisU),
      scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonBasisV),
    );

  const previousTangents = computeMjcfCircleTangentPoints2D(
    previousLocalX,
    previousLocalY,
    radius,
  );
  const nextTangents = computeMjcfCircleTangentPoints2D(nextLocalX, nextLocalY, radius);
  if (!previousTangents.length || !nextTangents.length) {
    return [
      projectMjcfWrapAnchorOntoSitePath(wrapAnchor, previousSiteAnchor, nextSiteAnchor),
    ];
  }

  let bestPrevious = previousTangents[0]!;
  let bestNext = nextTangents[0]!;
  let bestScore = Infinity;
  let bestDistanceSq = Infinity;
  previousTangents.forEach((previousTangent) => {
    nextTangents.forEach((nextTangent) => {
      const distanceSq = previousTangent.distanceToSquared(nextTangent);
      const score = sideLocal
        ? previousTangent.clone().add(nextTangent).multiplyScalar(0.5).distanceToSquared(sideLocal)
        : distanceSq;
      if (score < bestScore || (score === bestScore && distanceSq < bestDistanceSq)) {
        bestScore = score;
        bestDistanceSq = distanceSq;
        bestPrevious = previousTangent;
        bestNext = nextTangent;
      }
    });
  });

  const buildContactPoint = (tangent: THREE.Vector2): THREE.Vector3 => {
    const point = wrapAnchor.worldPosition
      .clone()
      .addScaledVector(scratchMjcfTendonBasisU, tangent.x)
      .addScaledVector(scratchMjcfTendonBasisV, tangent.y);
    if (wrapAxis) {
      const denominator = nextLocalX - previousLocalX;
      const tangentT = Math.abs(denominator) > 1e-12 ? (tangent.x - previousLocalX) / denominator : 0;
      const previousAxisOffset = scratchMjcfTendonProjectionOffset
        .subVectors(previousSiteAnchor.worldPosition, wrapAnchor.worldPosition)
        .dot(wrapAxis);
      const nextAxisOffset = scratchMjcfTendonProjectionOffset
        .subVectors(nextSiteAnchor.worldPosition, wrapAnchor.worldPosition)
        .dot(wrapAxis);
      point.addScaledVector(
        wrapAxis,
        previousAxisOffset + (nextAxisOffset - previousAxisOffset) * tangentT,
      );
    }
    return point;
  };

  const firstContact = buildContactPoint(bestPrevious);
  const secondContact = buildContactPoint(bestNext);

  return [
    createMjcfTendonContactAnchor(
      wrapAnchor,
      firstContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
    createMjcfTendonContactAnchor(
      wrapAnchor,
      secondContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
  ];
}

function resolveMjcfTendonAttachmentAnchor(
  attachmentRef: string | undefined,
  siteAnchorsByName: Map<string, MjcfSiteAnchorData>,
): MjcfSiteAnchorData | undefined {
  if (!attachmentRef) {
    return undefined;
  }
  return siteAnchorsByName.get(attachmentRef);
}

function resolveMjcfTendonAttachmentRef(
  attachment: NonNullable<MjcfTendonVisualizationData['attachments']>[number],
): string | undefined {
  const attachmentRef = attachment.ref ?? attachment.sidesite;
  return typeof attachmentRef === 'string' && attachmentRef.length > 0 ? attachmentRef : undefined;
}

function findNeighborMjcfSiteAnchor(
  attachments: NonNullable<MjcfTendonVisualizationData['attachments']>,
  attachmentIndex: number,
  direction: -1 | 1,
  siteAnchorsByName: Map<string, MjcfSiteAnchorData>,
): MjcfSiteAnchorData | undefined {
  for (
    let index = attachmentIndex + direction;
    index >= 0 && index < attachments.length;
    index += direction
  ) {
    const attachment = attachments[index];
    if (attachment?.type !== 'site') {
      continue;
    }
    const anchor = resolveMjcfTendonAttachmentAnchor(attachment.ref, siteAnchorsByName);
    if (anchor) {
      return anchor;
    }
  }
  return undefined;
}

function resolveMjcfTendonAnchorPath(
  tendon: MjcfTendonVisualizationData,
  siteAnchorsByName: Map<string, MjcfSiteAnchorData>,
): Array<MjcfSiteAnchorData | undefined> {
  const attachments = tendon.attachments
    ?.filter((attachment) => resolveMjcfTendonAttachmentRef(attachment))
    .slice();

  if (!attachments?.length || attachments.length !== tendon.attachmentRefs.length) {
    return tendon.attachmentRefs.map((attachmentRef) =>
      resolveMjcfTendonAttachmentAnchor(attachmentRef, siteAnchorsByName),
    );
  }

  return attachments.map((attachment, attachmentIndex) => {
    const anchor = resolveMjcfTendonAttachmentAnchor(
      resolveMjcfTendonAttachmentRef(attachment),
      siteAnchorsByName,
    );
    if (!anchor) {
      return anchor;
    }

    if (attachment.type !== 'geom') {
      return anchor;
    }

    return resolveMjcfWrapContactAnchors(
      anchor,
      findNeighborMjcfSiteAnchor(attachments, attachmentIndex, -1, siteAnchorsByName),
      findNeighborMjcfSiteAnchor(attachments, attachmentIndex, 1, siteAnchorsByName),
      resolveMjcfTendonAttachmentAnchor(attachment.sidesite, siteAnchorsByName),
    );
  }).flat();
}

function updateMjcfTendonSegmentTransform(
  segment: THREE.Group,
  robot: THREE.Object3D,
  startWorld: THREE.Vector3,
  endWorld: THREE.Vector3,
  radius: number,
): boolean {
  scratchMjcfTendonLocalStart.copy(startWorld);
  robot.worldToLocal(scratchMjcfTendonLocalStart);
  scratchMjcfTendonLocalEnd.copy(endWorld);
  robot.worldToLocal(scratchMjcfTendonLocalEnd);

  scratchMjcfTendonSegmentVector.subVectors(scratchMjcfTendonLocalEnd, scratchMjcfTendonLocalStart);
  const segmentLength = scratchMjcfTendonSegmentVector.length();
  if (segmentLength <= 1e-9) {
    return updateVisible(segment, false);
  }

  scratchMjcfTendonSegmentMidpoint
    .copy(scratchMjcfTendonLocalStart)
    .add(scratchMjcfTendonLocalEnd)
    .multiplyScalar(0.5);
  scratchMjcfTendonSegmentDirection
    .copy(scratchMjcfTendonSegmentVector)
    .divideScalar(segmentLength);
  scratchQuaternion.setFromUnitVectors(mjcfTendonYAxis, scratchMjcfTendonSegmentDirection);

  let changed = false;
  changed = updateVisible(segment, true) || changed;
  changed =
    updatePosition(
      segment,
      scratchMjcfTendonSegmentMidpoint.x,
      scratchMjcfTendonSegmentMidpoint.y,
      scratchMjcfTendonSegmentMidpoint.z,
    ) || changed;
  changed = updateQuaternion(segment, scratchQuaternion) || changed;

  const shaft = segment.getObjectByName('__mjcf_tendon_shaft__');

  if (shaft) {
    changed = updateVisible(shaft, true) || changed;
    changed = updateScale3(shaft, radius, Math.max(segmentLength, 1e-6), radius) || changed;
  }

  return changed;
}

function updateMjcfTendonAnchorTransform(
  anchor: THREE.Object3D,
  robot: THREE.Object3D,
  anchorWorld: THREE.Vector3,
  radius: number,
): boolean {
  scratchMjcfTendonLocalStart.copy(anchorWorld);
  robot.worldToLocal(scratchMjcfTendonLocalStart);

  const anchorRadius = Math.max(radius * 1.18, radius + 0.0005);
  let changed = false;
  changed = updateVisible(anchor, true) || changed;
  changed =
    updatePosition(
      anchor,
      scratchMjcfTendonLocalStart.x,
      scratchMjcfTendonLocalStart.y,
      scratchMjcfTendonLocalStart.z,
    ) || changed;
  changed = updateScale3(anchor, anchorRadius, anchorRadius, anchorRadius) || changed;
  return changed;
}

function countSequentialMjcfTendonChildren(tendonObject: THREE.Object3D, namePrefix: string): number {
  let count = 0;
  while (tendonObject.getObjectByName(`${namePrefix}${count}`)) {
    count += 1;
  }
  return count;
}

function updateMjcfTendonMeshGeometry(
  tendonObject: THREE.Group,
  robot: THREE.Object3D,
  tendon: MjcfTendonVisualizationData,
  siteAnchorsByName: Map<string, MjcfSiteAnchorData>,
): boolean {
  const radius = resolveMjcfTendonRadius(tendon, siteAnchorsByName);
  const fallbackLinkName =
    tendon.attachmentRefs
      .map((attachmentRef) => siteAnchorsByName.get(attachmentRef)?.linkName ?? null)
      .find(
        (linkName): linkName is string => typeof linkName === 'string' && linkName.length > 0,
      ) ?? null;
  const anchorPath = resolveMjcfTendonAnchorPath(tendon, siteAnchorsByName);
  let changed = false;

  changed = updateVisualMeshMetadata(tendonObject, fallbackLinkName) || changed;

  const segmentCount = countSequentialMjcfTendonChildren(
    tendonObject,
    '__mjcf_tendon_segment__:',
  );
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const startAnchor = anchorPath[segmentIndex];
    const endAnchor = anchorPath[segmentIndex + 1];
    const segment = tendonObject.getObjectByName(`__mjcf_tendon_segment__:${segmentIndex}`) as
      | THREE.Group
      | undefined;
    if (!segment) {
      continue;
    }

    if (!startAnchor || !endAnchor) {
      changed = updateVisible(segment, false) || changed;
      continue;
    }

    const segmentLinkName = startAnchor.linkName ?? endAnchor.linkName ?? fallbackLinkName;
    changed = updateVisualMeshMetadata(segment, segmentLinkName) || changed;
    changed = updateRenderOrder(segment, MJCF_TENDON_RENDER_ORDER) || changed;

    const shaft = segment.getObjectByName('__mjcf_tendon_shaft__');
    if (shaft) {
      changed = updateVisualMeshMetadata(shaft, segmentLinkName) || changed;
      changed = updateRenderOrder(shaft, MJCF_TENDON_RENDER_ORDER) || changed;
    }

    changed =
      updateMjcfTendonSegmentTransform(
        segment,
        robot,
        startAnchor.worldPosition,
        endAnchor.worldPosition,
        radius,
      ) || changed;
  }

  const anchorCount = countSequentialMjcfTendonChildren(
    tendonObject,
    '__mjcf_tendon_anchor__:',
  );
  for (let anchorIndex = 0; anchorIndex < anchorCount; anchorIndex += 1) {
    const anchor = tendonObject.getObjectByName(`__mjcf_tendon_anchor__:${anchorIndex}`);
    const anchorData = anchorPath[anchorIndex];
    if (!anchor) {
      continue;
    }

    if (!anchorData) {
      changed = updateVisible(anchor, false) || changed;
      continue;
    }

    changed = updateVisualMeshMetadata(anchor, anchorData.linkName ?? fallbackLinkName) || changed;
    changed = updateRenderOrder(anchor, MJCF_TENDON_RENDER_ORDER) || changed;
    changed =
      updateMjcfTendonAnchorTransform(anchor, robot, anchorData.worldPosition, radius) || changed;
  }

  return changed;
}

export function syncMjcfTendonVisualizationForRobot({
  robot,
  sourceFormat,
  showMjcfTendons,
}: SyncMjcfTendonVisualizationOptions): boolean {
  const tendonData = Array.isArray(robot.userData.__mjcfTendonsData)
    ? (robot.userData.__mjcfTendonsData as MjcfTendonVisualizationData[])
    : [];
  let tendonsGroup = robot.userData.__mjcfTendons as THREE.Group | undefined;
  let changed = false;

  if (tendonsGroup && tendonsGroup.parent !== robot) {
    tendonsGroup = undefined;
    robot.userData.__mjcfTendons = undefined;
  }

  if (!tendonsGroup && tendonData.some((tendon) => tendon.attachmentRefs.length >= 2)) {
    tendonsGroup = new THREE.Group();
    tendonsGroup.name = '__mjcf_tendons__';
    tendonsGroup.raycast = () => undefined;
    tendonsGroup.userData = {
      isMjcfTendonsGroup: true,
    };
    robot.add(tendonsGroup);
    robot.userData.__mjcfTendons = tendonsGroup;
    changed = true;
  }

  if (!tendonsGroup) {
    return changed;
  }

  tendonData.forEach((tendon) => {
    if (tendon.attachmentRefs.length < 2) {
      return;
    }

    let tendonObject = tendonsGroup!.getObjectByName(`__mjcf_tendon__:${tendon.name}`) as
      | THREE.Group
      | undefined;
    if (!tendonObject) {
      tendonObject = createMjcfTendonVisualization(tendon);
      tendonsGroup!.add(tendonObject);
      changed = true;
    }
  });

  const nextVisible =
    sourceFormat === 'mjcf' &&
    showMjcfTendons &&
    tendonData.some((tendon) => tendon.attachmentRefs.length >= 2);
  changed = updateVisible(tendonsGroup, nextVisible) || changed;

  if (!nextVisible) {
    return changed;
  }

  const siteAnchorsByName = collectMjcfTendonAnchorsByName(robot);
  tendonData.forEach((tendon) => {
    if (tendon.attachmentRefs.length < 2) {
      return;
    }

    const tendonObject = tendonsGroup!.getObjectByName(`__mjcf_tendon__:${tendon.name}`) as
      | THREE.Group
      | undefined;
    if (!tendonObject) {
      return;
    }

    changed =
      updateMjcfTendonMeshGeometry(tendonObject, robot, tendon, siteAnchorsByName) || changed;
  });

  return changed;
}

export function syncLinkHelperInteractionStateForLinks({
  links,
  hoveredLinkId = null,
  hoveredHelperKind = null,
  selectedLinkId = null,
  selectedHelperKind = null,
}: SyncLinkHelperInteractionStateOptions): boolean {
  let changed = false;

  links.forEach((link: any) => {
    if (!link.isURDFLink) return;
    const helperObjects = getLinkHelperObjects(link);

    helperObjects.forEach((helperObject) => {
      const helperKind = resolveHelperKindFromObject(helperObject);
      const state = resolveHelperInteractionState(
        hoveredLinkId === link.name && (!hoveredHelperKind || hoveredHelperKind === helperKind),
        selectedLinkId === link.name && (!selectedHelperKind || selectedHelperKind === helperKind),
      );
      const helperName = helperObject.name;
      const scaleMultiplier =
        helperName === '__com_visual__'
          ? getHelperScaleMultiplier(state, 1.16, 1.08)
          : helperName === '__inertia_box__'
            ? getHelperScaleMultiplier(state, 1.02, 1.01)
            : helperName === '__ik_handle__'
              ? getHelperScaleMultiplier(state, 1.12, 1.06)
              : // Thin axis helpers should not change their hit footprint on hover,
                // otherwise the cursor can oscillate between hit/miss on dense scenes.
                helperName === '__origin_axes__'
                ? 1
                : getHelperScaleMultiplier(state, 1.14, 1.05);
      const renderOrderOffset = getHelperRenderOrderOffset(state);
      const activeColorHex =
        helperName === '__ik_handle__'
          ? state === 'hovered'
            ? IK_HANDLE_HOVER_COLOR
            : state === 'selected'
              ? IK_HANDLE_SELECTED_COLOR
              : IK_HANDLE_IDLE_COLOR
          : undefined;
      const originAxesColorLift =
        helperName === '__origin_axes__'
          ? state === 'hovered'
            ? ORIGIN_AXES_HOVER_LIFT
            : state === 'selected'
              ? ORIGIN_AXES_SELECTED_LIFT
              : 0
          : 0;

      changed = updateInteractionScale(helperObject, scaleMultiplier) || changed;

      helperObject.traverse((child: any) => {
        if (child.isMesh || child.type === 'LineSegments') {
          changed = updateInteractionRenderOrder(child, renderOrderOffset) || changed;
        }

        if (!child.material) {
          return;
        }

        const opacityMultiplier =
          helperName === '__inertia_box__'
            ? child.type === 'LineSegments'
              ? getHelperOpacityMultiplier(state, 1.45, 1.2)
              : getHelperOpacityMultiplier(state, 1.8, 1.45)
            : helperName === '__ik_handle__'
              ? getHelperOpacityMultiplier(state, 1.45, 1.2)
              : helperName === '__com_visual__'
                ? getHelperOpacityMultiplier(state, 1.08, 1.03)
                : getHelperOpacityMultiplier(state, 1, 1);

        changed = updateInteractionOpacity(child.material, opacityMultiplier) || changed;
        changed = updateInteractionColor(child.material, activeColorHex) || changed;
        if (helperName === '__origin_axes__') {
          changed = updateInteractionColorLift(child.material, originAxesColorLift) || changed;
        }
      });
    });
  });

  return changed;
}

export function syncJointHelperInteractionStateForJoints({
  joints,
  hoveredJointId = null,
  hoveredHelperKind = null,
  selectedJointId = null,
  selectedHelperKind = null,
}: SyncJointHelperInteractionStateOptions): boolean {
  let changed = false;

  joints.forEach((joint: any) => {
    if (!joint.isURDFJoint || joint.jointType === 'fixed') return;

    const state = resolveHelperInteractionState(
      hoveredJointId === joint.name && (!hoveredHelperKind || hoveredHelperKind === 'joint-axis'),
      selectedJointId === joint.name &&
        (!selectedHelperKind || selectedHelperKind === 'joint-axis'),
    );
    const helperObjects = getJointHelperObjects(joint);
    const activeColorHex =
      state === 'hovered' ? 0xfbbf24 : state === 'selected' ? 0xf472b6 : undefined;

    helperObjects.forEach((helperObject) => {
      changed = updateInteractionScale(helperObject, 1) || changed;

      helperObject.traverse((child: any) => {
        if (child.isMesh || child.type === 'LineSegments') {
          changed =
            updateInteractionRenderOrder(child, getHelperRenderOrderOffset(state)) || changed;
        }

        if (!child.material) {
          return;
        }

        changed = updateInteractionColor(child.material, activeColorHex) || changed;
      });
    });
  });

  return changed;
}

/**
 * Sync visual mesh colors from robotLinks data to Three.js materials.
 * Detects when the stored color differs from the material color and updates in place.
 */
export function syncLinkVisualColors({
  robot,
  robotLinks,
}: {
  robot: THREE.Object3D;
  robotLinks?: Record<string, UrdfLink>;
}): boolean {
  if (!robotLinks) return false;
  let changed = false;
  const { links } = getRobotSceneNodeIndex(robot);

  const syncVisualRootColor = (visualRoot: THREE.Object3D, targetColor: string): void => {
    const parsedTargetColor = parseThreeColorWithOpacity(targetColor);
    if (!parsedTargetColor) return;

    visualRoot.traverse((child: any) => {
      if (!child.isMesh || !child.userData.isVisualMesh) return;
      if (child.userData.hasVertexColors) return;

      const mat = child.material as THREE.MeshStandardMaterial | undefined;
      if (!mat?.color) return;

      const lastSynced = child.userData.__syncedColor as string | undefined;
      if (lastSynced === targetColor) return;

      const nextOpacity = parsedTargetColor.opacity;
      const colorMatches = mat.color.equals(parsedTargetColor.color);
      const opacityMatches =
        nextOpacity == null || Math.abs((mat.opacity ?? 1) - nextOpacity) <= 1e-6;

      if (colorMatches && opacityMatches) {
        child.userData.__syncedColor = targetColor;
        return;
      }

      if (!colorMatches) {
        mat.color.copy(parsedTargetColor.color);
      }
      if (nextOpacity != null && !opacityMatches) {
        mat.opacity = nextOpacity;
        if (nextOpacity < 1) {
          mat.transparent = true;
        }
      }
      mat.needsUpdate = true;
      child.userData.__syncedColor = targetColor;
      changed = true;
    });
  };

  links.forEach((link: any) => {
    if (!link.isURDFLink) return;
    const linkData = robotLinks[link.name];
    if (!linkData) return;

    const visualEntries = getVisualGeometryEntries(linkData);
    const visualGroups = link.children.filter((child: any) => child.isURDFVisual);
    if (visualGroups.length > 0) {
      visualEntries.forEach((entry, index) => {
        const targetColor = entry.geometry.color;
        const visualGroup = visualGroups[index];
        if (!targetColor || !visualGroup) return;
        syncVisualRootColor(visualGroup, targetColor);
      });
      return;
    }

    const primaryTargetColor = visualEntries[0]?.geometry.color;
    if (!primaryTargetColor) return;
    syncVisualRootColor(link, primaryTargetColor);
  });

  return changed;
}
