import { Quaternion, Vector3 } from 'three';
import type {
  InteractionHelperKind,
  InteractionSelection,
  RobotFile,
  RobotState,
  UrdfJoint,
  UrdfLink,
} from '@/types';
import { getLatestUsdStageLoadDebugEntry } from './usdStageLoadDebug';

type HighlightMode = 'link' | 'collision';

export interface RegressionViewerFlags {
  showCollision?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  showVisual?: boolean;
  showCenterOfMass?: boolean;
  showCoMOverlay?: boolean;
  centerOfMassSize?: number;
  showInertia?: boolean;
  showInertiaOverlay?: boolean;
  showOrigins?: boolean;
  showOriginsOverlay?: boolean;
  originSize?: number;
  showJointAxes?: boolean;
  showJointAxesOverlay?: boolean;
  jointAxisSize?: number;
  highlightMode?: HighlightMode;
  modelOpacity?: number;
}

interface AppRegressionHandlers {
  getAvailableFiles: () => RobotFile[];
  getSelectedFile: () => RobotFile | null;
  getRobotState: () => RobotState;
  getAssetDebugState: () => {
    appAssetKeys: string[];
    preparedUsdCacheKeysByFile: Record<string, string[]>;
  };
  getInteractionState: () => {
    selection: InteractionSelection;
    hoveredSelection: InteractionSelection;
  };
  loadRobotByName: (fileName: string) => Promise<{ loaded: boolean; selectedFile: string | null }>;
}

interface ViewerControllerSnapshot {
  jointAngles: Record<string, number>;
  activeJoint: string | null;
  toolMode: string | null;
  highlightMode: HighlightMode;
  flags: Required<RegressionViewerFlags>;
}

interface ViewerRegressionHandlers {
  getSnapshot: () => ViewerControllerSnapshot;
  setFlags: (flags: RegressionViewerFlags) => void;
  setToolMode: (toolMode: string) => { changed: boolean; activeMode: string | null };
  setJointAngles: (jointAngles: Record<string, number>) => { changed: boolean };
}

export interface RegressionProjectedInteractionTarget {
  type: 'link' | 'joint';
  id: string;
  subType?: 'visual' | 'collision';
  objectIndex?: number;
  helperKind?: InteractionHelperKind;
  targetKind: 'geometry' | 'helper';
  sourceName: string | null;
  clientX: number;
  clientY: number;
  projectedWidth: number;
  projectedHeight: number;
  projectedArea: number;
  averageDepth: number;
}

interface RuntimeJointSummary {
  name: string;
  type: string | null;
  angle: number | null;
  axis: [number, number, number] | null;
  limit: {
    lower: number | null;
    upper: number | null;
  } | null;
}

interface RuntimeLinkSummary {
  name: string;
  visualGroupCount: number;
  collisionGroupCount: number;
  visualMeshCount: number;
  collisionMeshCount: number;
  placeholderMeshCount: number;
  visiblePlaceholderMeshCount: number;
  hiddenPlaceholderMeshCount: number;
  visualPlaceholderMeshCount: number;
  visibleVisualPlaceholderMeshCount: number;
  collisionPlaceholderMeshCount: number;
  texturedVisualMeshCount: number;
}

interface RuntimeMaterialSummary {
  type: string;
  name: string | null;
  hasTexture: boolean;
  color: string | null;
  transparent: boolean;
  opacity: number | null;
}

interface RuntimeVisualMeshSummary {
  link: string;
  name: string;
  visible: boolean;
  effectiveVisible: boolean;
  isPlaceholder: boolean;
  missingMeshPath: string | null;
  materials: RuntimeMaterialSummary[];
}

interface RegressionSnapshot {
  timestamp: number;
  runtimeRevision: number;
  availableFiles: Array<{ name: string; format: string }>;
  selectedFile: { name: string; format: string } | null;
  store: ReturnType<typeof summarizeRobotState> | null;
  interaction: {
    selection: ReturnType<typeof summarizeInteractionSelection>;
    hoveredSelection: ReturnType<typeof summarizeInteractionSelection>;
  } | null;
  viewer: ViewerControllerSnapshot | null;
  runtime: ReturnType<typeof summarizeRuntimeRobot> | null;
}

interface RegressionViewerResourceScopeState {
  sourceFileName: string | null;
  sourceFilePath: string | null;
  assetKeys: string[];
  availableFileNames: string[];
  signature: string | null;
}

interface RegressionAssetDebugState {
  appAssetKeys: string[];
  preparedUsdCacheKeysByFile: Record<string, string[]>;
  viewerScopedAssetKeys: string[];
  viewerScopedAvailableFileNames: string[];
  viewerScopedSourceFileName: string | null;
  viewerScopedSourceFilePath: string | null;
  viewerScopedSignature: string | null;
}

export interface RegressionDebugApi {
  getAvailableFiles: () => Array<{ name: string; format: string }>;
  getRegressionSnapshot: () => RegressionSnapshot;
  getProjectedInteractionTargets: () => RegressionProjectedInteractionTarget[];
  getAssetDebugState: () => RegressionAssetDebugState;
  getRuntimeSceneTransforms: () => ReturnType<typeof summarizeRuntimeSceneTransforms> | null;
  setBeforeUnloadPromptEnabled: (enabled: boolean) => { ok: boolean; enabled: boolean };
  loadRobotByName: (fileName: string) => Promise<{ loaded: boolean; snapshot: RegressionSnapshot }>;
  setViewerFlags: (flags: RegressionViewerFlags) => { ok: boolean };
  setViewerToolMode: (toolMode: string) => {
    ok: boolean;
    changed: boolean;
    activeMode: string | null;
  };
  setViewerJointAngles: (jointAngles: Record<string, number>) => { ok: boolean; changed: boolean };
}

declare global {
  interface Window {
    __URDF_STUDIO_DEBUG__?: RegressionDebugApi;
  }
}

const DEFAULT_FLAGS: Required<RegressionViewerFlags> = {
  showCollision: false,
  showCollisionAlwaysOnTop: true,
  showVisual: true,
  showCenterOfMass: false,
  showCoMOverlay: true,
  centerOfMassSize: 0.01,
  showInertia: false,
  showInertiaOverlay: true,
  showOrigins: false,
  showOriginsOverlay: true,
  originSize: 1,
  showJointAxes: false,
  showJointAxesOverlay: true,
  jointAxisSize: 1,
  highlightMode: 'link',
  modelOpacity: 1,
};

let appHandlers: AppRegressionHandlers | null = null;
let viewerHandlers: ViewerRegressionHandlers | null = null;
let viewerResourceScopeState: RegressionViewerResourceScopeState | null = null;
let runtimeRobot: any | null = null;
let runtimeRevision = 0;
let projectedInteractionTargetsProvider: (() => RegressionProjectedInteractionTarget[]) | null =
  null;
let regressionBeforeUnloadPromptSuppressed = false;
const regressionBeforeUnloadPromptListeners = new Set<(suppressed: boolean) => void>();

export function isRegressionBeforeUnloadPromptSuppressed(): boolean {
  return regressionBeforeUnloadPromptSuppressed;
}

export function subscribeRegressionBeforeUnloadPromptSuppression(
  listener: (suppressed: boolean) => void,
): () => void {
  regressionBeforeUnloadPromptListeners.add(listener);
  return () => {
    regressionBeforeUnloadPromptListeners.delete(listener);
  };
}

export function setRegressionBeforeUnloadPromptSuppressed(suppressed: boolean): void {
  if (regressionBeforeUnloadPromptSuppressed === suppressed) {
    return;
  }

  regressionBeforeUnloadPromptSuppressed = suppressed;
  regressionBeforeUnloadPromptListeners.forEach((listener) => {
    listener(suppressed);
  });
}

function toFixedArray(
  value: { x?: number; y?: number; z?: number } | [number, number, number] | undefined | null,
): [number, number, number] | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return [Number(value[0] ?? 0), Number(value[1] ?? 0), Number(value[2] ?? 0)];
  }

  return [Number(value.x ?? 0), Number(value.y ?? 0), Number(value.z ?? 0)];
}

function summarizeGeometry(geometry: UrdfLink['visual'] | UrdfLink['collision']) {
  return {
    type: geometry.type,
    meshPath: geometry.meshPath || null,
    dimensions: geometry.dimensions
      ? {
          x: Number(geometry.dimensions.x ?? 0),
          y: Number(geometry.dimensions.y ?? 0),
          z: Number(geometry.dimensions.z ?? 0),
        }
      : null,
    origin: geometry.origin
      ? {
          xyz: {
            x: Number(geometry.origin.xyz.x ?? 0),
            y: Number(geometry.origin.xyz.y ?? 0),
            z: Number(geometry.origin.xyz.z ?? 0),
          },
          rpy: {
            r: Number(geometry.origin.rpy.r ?? 0),
            p: Number(geometry.origin.rpy.p ?? 0),
            y: Number(geometry.origin.rpy.y ?? 0),
          },
        }
      : null,
    visible: geometry.visible ?? true,
  };
}

function summarizeLink(link: UrdfLink) {
  return {
    id: link.id,
    name: link.name,
    mass: Number(link.inertial?.mass ?? 0),
    centerOfMass: link.inertial?.origin
      ? {
          xyz: {
            x: Number(link.inertial.origin.xyz.x ?? 0),
            y: Number(link.inertial.origin.xyz.y ?? 0),
            z: Number(link.inertial.origin.xyz.z ?? 0),
          },
          rpy: {
            r: Number(link.inertial.origin.rpy.r ?? 0),
            p: Number(link.inertial.origin.rpy.p ?? 0),
            y: Number(link.inertial.origin.rpy.y ?? 0),
          },
        }
      : null,
    inertia: link.inertial?.inertia
      ? {
          ixx: Number(link.inertial.inertia.ixx ?? 0),
          ixy: Number(link.inertial.inertia.ixy ?? 0),
          ixz: Number(link.inertial.inertia.ixz ?? 0),
          iyy: Number(link.inertial.inertia.iyy ?? 0),
          iyz: Number(link.inertial.inertia.iyz ?? 0),
          izz: Number(link.inertial.inertia.izz ?? 0),
        }
      : null,
    visual: summarizeGeometry(link.visual),
    collision: summarizeGeometry(link.collision),
    collisionBodies: (link.collisionBodies || []).map((body, index) => ({
      index,
      geometry: summarizeGeometry(body),
    })),
  };
}

function summarizeJoint(joint: UrdfJoint) {
  return {
    id: joint.id,
    name: joint.name,
    type: joint.type,
    parentLinkId: joint.parentLinkId,
    childLinkId: joint.childLinkId,
    axis: joint.axis
      ? {
          x: Number(joint.axis.x ?? 0),
          y: Number(joint.axis.y ?? 0),
          z: Number(joint.axis.z ?? 0),
        }
      : null,
    origin: {
      xyz: {
        x: Number(joint.origin.xyz.x ?? 0),
        y: Number(joint.origin.xyz.y ?? 0),
        z: Number(joint.origin.xyz.z ?? 0),
      },
      rpy: {
        r: Number(joint.origin.rpy.r ?? 0),
        p: Number(joint.origin.rpy.p ?? 0),
        y: Number(joint.origin.rpy.y ?? 0),
      },
    },
    limit: joint.limit
      ? {
          lower: Number(joint.limit.lower ?? 0),
          upper: Number(joint.limit.upper ?? 0),
          effort: Number(joint.limit.effort ?? 0),
          velocity: Number(joint.limit.velocity ?? 0),
        }
      : null,
  };
}

function summarizeRobotState(robotState: RobotState) {
  const links = Object.values(robotState.links || {});
  const joints = Object.values(robotState.joints || {});
  return {
    name: robotState.name,
    rootLinkId: robotState.rootLinkId,
    linkCount: links.length,
    jointCount: joints.length,
    totalMass: links.reduce((sum, link) => sum + Number(link.inertial?.mass ?? 0), 0),
    links: links.map(summarizeLink),
    joints: joints.map(summarizeJoint),
  };
}

function summarizeInteractionSelection(selection: InteractionSelection | null | undefined) {
  return {
    type: selection?.type ?? null,
    id: selection?.id ?? null,
    subType: selection?.subType ?? null,
    objectIndex: selection?.objectIndex ?? null,
    helperKind: selection?.helperKind ?? null,
  };
}

function resolveRuntimeLinkName(object: any): string | null {
  if (!object) {
    return null;
  }

  if (typeof object.userData?.parentLinkName === 'string' && object.userData.parentLinkName) {
    return object.userData.parentLinkName;
  }

  let current = object;
  while (current) {
    if (current.isURDFLink && typeof current.name === 'string' && current.name) {
      return current.name;
    }
    current = current.parent;
  }

  return null;
}

function isEffectivelyVisible(object: any): boolean {
  let current = object;
  while (current) {
    if (current.visible === false) {
      return false;
    }
    current = current.parent;
  }

  return true;
}

function summarizeRuntimeRobot(robot: any) {
  if (!robot) {
    return null;
  }

  const linkMap = new Map<string, RuntimeLinkSummary>();
  const placeholderMeshes: Array<{
    link: string;
    name: string;
    missingMeshPath: string | null;
    visible: boolean;
    effectiveVisible: boolean;
  }> = [];
  const visualMeshes: RuntimeVisualMeshSummary[] = [];
  const helperCounts = {
    centerOfMass: 0,
    inertiaBox: 0,
    originAxes: 0,
    jointAxis: 0,
  };
  const runtimeJoints: RuntimeJointSummary[] = [];

  const getOrCreateLinkSummary = (linkName: string): RuntimeLinkSummary => {
    const existing = linkMap.get(linkName);
    if (existing) {
      return existing;
    }

    const created: RuntimeLinkSummary = {
      name: linkName,
      visualGroupCount: 0,
      collisionGroupCount: 0,
      visualMeshCount: 0,
      collisionMeshCount: 0,
      placeholderMeshCount: 0,
      visiblePlaceholderMeshCount: 0,
      hiddenPlaceholderMeshCount: 0,
      visualPlaceholderMeshCount: 0,
      visibleVisualPlaceholderMeshCount: 0,
      collisionPlaceholderMeshCount: 0,
      texturedVisualMeshCount: 0,
    };
    linkMap.set(linkName, created);
    return created;
  };

  const summarizeRuntimeMaterial = (material: any): RuntimeMaterialSummary => {
    const hasTexture = Boolean(material?.map);
    const color = material?.color?.isColor ? `#${material.color.getHexString()}` : null;

    return {
      type: typeof material?.type === 'string' ? material.type : 'UnknownMaterial',
      name: typeof material?.name === 'string' && material.name.trim() ? material.name : null,
      hasTexture,
      color,
      transparent: material?.transparent === true,
      opacity: typeof material?.opacity === 'number' ? material.opacity : null,
    };
  };

  robot.traverse((child: any) => {
    if (child.name === '__com_visual__') helperCounts.centerOfMass += 1;
    if (child.name === '__inertia_box__') helperCounts.inertiaBox += 1;
    if (child.name === '__origin_axes__') helperCounts.originAxes += 1;
    if (child.name === '__joint_axis__' || child.name === '__joint_axis_helper__')
      helperCounts.jointAxis += 1;

    const linkName = resolveRuntimeLinkName(child);
    if (linkName) {
      const entry = getOrCreateLinkSummary(linkName);
      const isMesh = child.isMesh === true;
      const isVisualMesh = isMesh && child.userData?.isVisualMesh === true;
      const isCollisionMesh = isMesh && child.userData?.isCollisionMesh === true;
      const isPlaceholder = isMesh && child.userData?.isPlaceholder === true;
      const effectiveVisible = isMesh ? isEffectivelyVisible(child) : false;

      if (child.userData?.isVisualGroup) entry.visualGroupCount += 1;
      if (child.userData?.isCollisionGroup || child.isURDFCollider) entry.collisionGroupCount += 1;
      if (isVisualMesh) entry.visualMeshCount += 1;
      if (isCollisionMesh) entry.collisionMeshCount += 1;

      if (isPlaceholder) {
        entry.placeholderMeshCount += 1;
        if (effectiveVisible) {
          entry.visiblePlaceholderMeshCount += 1;
        } else {
          entry.hiddenPlaceholderMeshCount += 1;
        }
        if (isVisualMesh) {
          entry.visualPlaceholderMeshCount += 1;
          if (effectiveVisible) {
            entry.visibleVisualPlaceholderMeshCount += 1;
          }
        }
        if (isCollisionMesh) {
          entry.collisionPlaceholderMeshCount += 1;
        }
      }

      if (isVisualMesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        const summarizedMaterials = materials.map(summarizeRuntimeMaterial);
        if (summarizedMaterials.some((material) => material.hasTexture)) {
          entry.texturedVisualMeshCount += 1;
        }

        const visualMeshSummary: RuntimeVisualMeshSummary = {
          link: linkName,
          name: typeof child.name === 'string' ? child.name : '',
          visible: child.visible !== false,
          effectiveVisible,
          isPlaceholder,
          missingMeshPath:
            typeof child.userData?.missingMeshPath === 'string'
              ? child.userData.missingMeshPath
              : null,
          materials: summarizedMaterials,
        };
        visualMeshes.push(visualMeshSummary);

        if (visualMeshSummary.isPlaceholder) {
          placeholderMeshes.push({
            link: linkName,
            name: visualMeshSummary.name,
            missingMeshPath: visualMeshSummary.missingMeshPath,
            visible: visualMeshSummary.visible,
            effectiveVisible: visualMeshSummary.effectiveVisible,
          });
        }
      }
    }
  });

  const joints = robot.joints ? Object.values(robot.joints as Record<string, any>) : [];
  joints.forEach((joint: any) => {
    runtimeJoints.push({
      name: typeof joint?.name === 'string' ? joint.name : '',
      type:
        typeof joint?.jointType === 'string'
          ? joint.jointType
          : typeof joint?.type === 'string'
            ? joint.type
            : null,
      angle:
        typeof joint?.angle === 'number'
          ? joint.angle
          : typeof joint?.jointValue === 'number'
            ? joint.jointValue
            : null,
      axis: toFixedArray(joint?.axis),
      limit: joint?.limit
        ? {
            lower: typeof joint.limit.lower === 'number' ? joint.limit.lower : null,
            upper: typeof joint.limit.upper === 'number' ? joint.limit.upper : null,
          }
        : null,
    });
  });

  return {
    name: typeof robot?.name === 'string' ? robot.name : null,
    linkCount: Array.from(linkMap.values()).length,
    jointCount: runtimeJoints.length,
    visualGroupCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.visualGroupCount,
      0,
    ),
    collisionGroupCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.collisionGroupCount,
      0,
    ),
    visualMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.visualMeshCount,
      0,
    ),
    collisionMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.collisionMeshCount,
      0,
    ),
    placeholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.placeholderMeshCount,
      0,
    ),
    visiblePlaceholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.visiblePlaceholderMeshCount,
      0,
    ),
    hiddenPlaceholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.hiddenPlaceholderMeshCount,
      0,
    ),
    visualPlaceholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.visualPlaceholderMeshCount,
      0,
    ),
    visibleVisualPlaceholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.visibleVisualPlaceholderMeshCount,
      0,
    ),
    collisionPlaceholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.collisionPlaceholderMeshCount,
      0,
    ),
    texturedVisualMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.texturedVisualMeshCount,
      0,
    ),
    helpers: helperCounts,
    links: Array.from(linkMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    placeholderMeshes: placeholderMeshes.sort((a, b) =>
      `${a.link}:${a.name}`.localeCompare(`${b.link}:${b.name}`),
    ),
    visualMeshes: visualMeshes.sort((a, b) =>
      `${a.link}:${a.name}`.localeCompare(`${b.link}:${b.name}`),
    ),
    joints: runtimeJoints.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function summarizeRuntimeSceneTransforms(robot: any) {
  if (!robot) {
    return null;
  }

  robot.updateMatrixWorld?.(true);

  const links: Array<{
    name: string;
    position: [number, number, number] | null;
    quaternion: [number, number, number, number] | null;
  }> = [];
  const joints: Array<{
    name: string;
    type: string | null;
    position: [number, number, number] | null;
    quaternion: [number, number, number, number] | null;
    axis: [number, number, number] | null;
  }> = [];
  const visualMeshes: Array<{
    link: string;
    name: string;
    position: [number, number, number] | null;
    quaternion: [number, number, number, number] | null;
  }> = [];

  robot.traverse((child: any) => {
    if (child?.isURDFLink) {
      links.push({
        name: typeof child.name === 'string' ? child.name : '',
        position: toFixedArray(child.getWorldPosition?.(new Vector3())),
        quaternion: child.getWorldQuaternion
          ? (child
              .getWorldQuaternion(new Quaternion())
              .toArray()
              .map((value: number) => Number(value.toFixed(6))) as [number, number, number, number])
          : null,
      });
      return;
    }

    if (child?.isURDFJoint) {
      joints.push({
        name: typeof child.name === 'string' ? child.name : '',
        type: typeof child?.jointType === 'string' ? child.jointType : null,
        position: toFixedArray(child.getWorldPosition?.(new Vector3())),
        quaternion: child.getWorldQuaternion
          ? (child
              .getWorldQuaternion(new Quaternion())
              .toArray()
              .map((value: number) => Number(value.toFixed(6))) as [number, number, number, number])
          : null,
        axis: toFixedArray(child.axis),
      });
      return;
    }

    if (child?.isMesh && child?.userData?.isVisualMesh) {
      const linkName = resolveRuntimeLinkName(child);
      if (!linkName) {
        return;
      }

      visualMeshes.push({
        link: linkName,
        name: typeof child.name === 'string' ? child.name : '',
        position: toFixedArray(child.getWorldPosition?.(new Vector3())),
        quaternion: child.getWorldQuaternion
          ? (child
              .getWorldQuaternion(new Quaternion())
              .toArray()
              .map((value: number) => Number(value.toFixed(6))) as [number, number, number, number])
          : null,
      });
    }
  });

  return {
    links: links.sort((a, b) => a.name.localeCompare(b.name)),
    joints: joints.sort((a, b) => a.name.localeCompare(b.name)),
    visualMeshes: visualMeshes.sort((a, b) =>
      `${a.link}:${a.name}`.localeCompare(`${b.link}:${b.name}`),
    ),
  };
}

function getAvailableFilesSummary() {
  if (!appHandlers) {
    return [];
  }

  return appHandlers.getAvailableFiles().map((file) => ({
    name: file.name,
    format: file.format,
  }));
}

export function setRegressionAppHandlers(handlers: AppRegressionHandlers | null): void {
  appHandlers = handlers;
}

export function setRegressionViewerHandlers(handlers: ViewerRegressionHandlers | null): void {
  viewerHandlers = handlers;
}

export function setRegressionViewerResourceScope(
  scope: RegressionViewerResourceScopeState | null,
): void {
  viewerResourceScopeState = scope;
}

export function setRegressionRuntimeRobot(robot: any | null): void {
  runtimeRobot = robot;
  runtimeRevision += 1;
}

export function setRegressionProjectedInteractionTargetsProvider(
  provider: (() => RegressionProjectedInteractionTarget[]) | null,
): void {
  projectedInteractionTargetsProvider = provider;
}

export function getRegressionSnapshot(): RegressionSnapshot {
  const selectedFile = appHandlers?.getSelectedFile() ?? null;
  const robotState = appHandlers?.getRobotState();
  const interactionState = appHandlers?.getInteractionState() ?? null;
  return {
    timestamp: Date.now(),
    runtimeRevision,
    availableFiles: getAvailableFilesSummary(),
    selectedFile: selectedFile ? { name: selectedFile.name, format: selectedFile.format } : null,
    store: robotState ? summarizeRobotState(robotState) : null,
    interaction: interactionState
      ? {
          selection: summarizeInteractionSelection(interactionState.selection),
          hoveredSelection: summarizeInteractionSelection(interactionState.hoveredSelection),
        }
      : null,
    viewer: viewerHandlers?.getSnapshot() ?? null,
    runtime: summarizeRuntimeRobot(runtimeRobot),
  };
}

export function installRegressionDebugApi(targetWindow: Window): void {
  const resolveAvailableFile = (fileName: string): RobotFile | null =>
    appHandlers?.getAvailableFiles().find((entry) => entry.name === fileName) ?? null;

  const hasCommittedUsdSnapshot = (fileName: string, snapshot: RegressionSnapshot): boolean => {
    const committedEntry = getLatestUsdStageLoadDebugEntry(
      targetWindow,
      fileName,
      'commit-worker-robot-data',
      'resolved',
    );
    if (!committedEntry) {
      return false;
    }

    if (snapshot.selectedFile?.name !== fileName || !snapshot.store) {
      return false;
    }

    const expectedLinkCount = Number(committedEntry.detail?.linkCount ?? Number.NaN);
    const expectedJointCount = Number(committedEntry.detail?.jointCount ?? Number.NaN);
    if (!Number.isFinite(expectedLinkCount) || !Number.isFinite(expectedJointCount)) {
      return false;
    }

    return (
      snapshot.store.linkCount === expectedLinkCount &&
      snapshot.store.jointCount === expectedJointCount
    );
  };

  const waitForStableSnapshot = async (
    fileName: string,
    timeoutMs = 20_000,
  ): Promise<RegressionSnapshot> => {
    const startedAt = Date.now();
    const isUsd = resolveAvailableFile(fileName)?.format === 'usd';

    while (Date.now() - startedAt < timeoutMs) {
      const snapshot = getRegressionSnapshot();
      if (
        isUsd
          ? getLatestUsdStageLoadDebugEntry(targetWindow, fileName, 'ready', 'resolved') &&
            hasCommittedUsdSnapshot(fileName, snapshot)
          : snapshot.selectedFile?.name === fileName && snapshot.runtime
      ) {
        return snapshot;
      }

      if (isUsd) {
        const loadFailedEntry = getLatestUsdStageLoadDebugEntry(
          targetWindow,
          fileName,
          'load-failed',
        );
        const commitRejectedEntry = getLatestUsdStageLoadDebugEntry(
          targetWindow,
          fileName,
          'commit-worker-robot-data',
          'rejected',
        );
        if (loadFailedEntry || commitRejectedEntry) {
          return snapshot;
        }
      }

      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    }

    return getRegressionSnapshot();
  };

  targetWindow.__URDF_STUDIO_DEBUG__ = {
    getAvailableFiles: () => getAvailableFilesSummary(),
    getRegressionSnapshot: () => getRegressionSnapshot(),
    getProjectedInteractionTargets: () => projectedInteractionTargetsProvider?.() ?? [],
    getAssetDebugState: () => {
      const appAssetDebugState = appHandlers?.getAssetDebugState() ?? {
        appAssetKeys: [],
        preparedUsdCacheKeysByFile: {},
      };

      return {
        appAssetKeys: appAssetDebugState.appAssetKeys,
        preparedUsdCacheKeysByFile: appAssetDebugState.preparedUsdCacheKeysByFile,
        viewerScopedAssetKeys: viewerResourceScopeState?.assetKeys ?? [],
        viewerScopedAvailableFileNames: viewerResourceScopeState?.availableFileNames ?? [],
        viewerScopedSourceFileName: viewerResourceScopeState?.sourceFileName ?? null,
        viewerScopedSourceFilePath: viewerResourceScopeState?.sourceFilePath ?? null,
        viewerScopedSignature: viewerResourceScopeState?.signature ?? null,
      };
    },
    getRuntimeSceneTransforms: () => summarizeRuntimeSceneTransforms(runtimeRobot),
    setBeforeUnloadPromptEnabled: (enabled: boolean) => {
      setRegressionBeforeUnloadPromptSuppressed(!enabled);
      return { ok: true, enabled };
    },
    loadRobotByName: async (fileName: string) => {
      if (!appHandlers) {
        throw new Error('Regression app handlers are not registered.');
      }

      setRegressionRuntimeRobot(null);
      const result = await appHandlers.loadRobotByName(fileName);
      const snapshot = result.loaded
        ? await waitForStableSnapshot(fileName)
        : getRegressionSnapshot();
      return {
        loaded: result.loaded,
        snapshot,
      };
    },
    setViewerFlags: (flags: RegressionViewerFlags) => {
      if (!viewerHandlers) {
        return { ok: false };
      }

      viewerHandlers.setFlags(flags);
      return { ok: true };
    },
    setViewerToolMode: (toolMode: string) => {
      if (!viewerHandlers) {
        return { ok: false, changed: false, activeMode: null };
      }

      const result = viewerHandlers.setToolMode(toolMode);
      return {
        ok: true,
        changed: result.changed,
        activeMode: result.activeMode,
      };
    },
    setViewerJointAngles: (jointAngles: Record<string, number>) => {
      if (!viewerHandlers) {
        return { ok: false, changed: false };
      }

      const result = viewerHandlers.setJointAngles(jointAngles);
      runtimeRobot?.updateMatrixWorld?.(true);
      runtimeRevision += 1;
      return { ok: true, changed: result.changed };
    },
  };
}
