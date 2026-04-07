import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import * as THREE from 'three';
import { getCollisionGeometryEntries } from '@/core/robot';
import { setRegressionProjectedInteractionTargetsProvider } from '@/shared/debug/regressionBridge';
import { normalizeLoadingProgress } from '@/shared/components/3d/loadingHudState';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import type { RobotFile, UrdfLink } from '@/types';
import { disposeObject3D } from '@/shared/utils/three/dispose';
import { failFastInDev, scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import {
  UsdCollisionTransformControls,
  type UsdCollisionTransformTarget,
} from './UsdCollisionTransformControls';
import { ViewerLoadingHud } from './ViewerLoadingHud';
import { LinkAxesController } from '../runtime/viewer/link-axes.js';
import { LinkDynamicsController } from '../runtime/viewer/link-dynamics.js';
import { LinkRotationController } from '../runtime/viewer/link-rotation.js';
import type {
  MeasureTargetResolver,
  ToolMode,
  ViewerSceneMode,
  ViewerDocumentLoadEvent,
  ViewerHelperKind,
  ViewerInteractiveLayer,
  URDFViewerProps,
  ViewerRuntimeStageBridge,
  UsdLoadingPhaseLabels,
  UsdLoadingProgress,
} from '../types';
import {
  disposeUsdDriver,
  ensureUsdWasmRuntime,
  type UsdWasmRuntime,
} from '../utils/usdWasmRuntime';
import { createHighlightOverrideMaterial, disposeMaterial } from '../utils/materials';
import { UsdJointAxesController } from '../utils/usdJointAxesController';
import { createUsdJointAxesDisplayResolution } from '../utils/usdJointAxesDisplayResolution';
import {
  type CameraFrameResult,
  computeCameraFrame,
  computeVisibleBounds,
  createCameraFrameStabilityKey,
} from '../utils/cameraFrame';
import { toVirtualUsdPath } from '../utils/usdPreloadSources';
import { hydrateUsdViewerRobotResolutionFromRuntime } from '../utils/usdRuntimeRobotHydration';
import { scheduleUsdResolvedRobotRepublishAfterWarmup } from '../utils/usdResolvedRobotWarmup';
import { resolveUsdSceneRobotResolution } from '../utils/usdSceneRobotResolution';
import { resolveUsdRuntimeLinkPathForMesh } from '../utils/usdRuntimeMeshMapping';
import { createUsdViewerRuntimeRobot } from '../utils/usdViewerRuntimeRobot';
import {
  buildUsdLinkDynamicsRecordMap,
  composeUsdMeshOverrideWorldMatrixFromBaseLocal,
  deriveUsdMeshBaseLocalMatrix,
  isUsdRuntimeGeometryVisible,
  resolveUsdRuntimeGeometry,
  resolveUsdVisualColorOverride,
} from '../utils/usdRuntimeLinkOverrides';
import {
  clearUsdHoverPointerState,
  markUsdHoverRaycastDirty,
  setUsdHoverPointerButtons,
  setUsdHoverPointerState,
  shouldProcessUsdHoverRaycast,
} from '../utils/usdHoverPointerState';
import { updateUsdHoverCameraMotionState } from '../utils/usdHoverCameraMotion';
import {
  hasPickableMaterial,
  isInternalHelperObject,
  isVisibleInHierarchy,
} from '../utils/pickFilter';
import { collectGizmoRaycastTargets, isGizmoObject } from '../utils/raycast';
import { collectSelectableHelperTargets } from '../utils/pickTargets';
import { collectRegressionProjectedInteractionTargets } from '../utils/regressionProjectionTargets';
import { resolveUsdMeasureTargetFromSelection } from '../utils/measureTargetResolvers';
import { reconcileUsdCollisionMeshAssignments } from '../utils/usdCollisionMeshAssignments';
import {
  resolveUsdStageInteractionPolicy,
  resolveUsdStageJointRotationRuntime,
} from '../utils/usdInteractionPolicy';
import { prepareUsdVisualMesh } from '../utils/usdVisualRendering';
import { createEmbeddedUsdViewerLoadParams } from '../utils/usdViewerRenderParams';
import {
  resolveUsdStageJointPreview,
  type UsdStageJointInfoLike,
} from '../utils/usdStageJointPreview';
import { type PreparedUsdPreloadFile } from '../utils/usdStageOpenPreparation';
import {
  buildPreparedUsdStageOpenCacheKey,
  loadPreparedUsdStageOpenDataFromWorker,
  loadPreparedUsdStageOpenDataInline,
} from '../utils/preparedUsdStageOpenCache';
import { preloadUsdStageEntries } from '../utils/usdStagePreloadExecution';
import {
  armSelectionMissGuard,
  disarmSelectionMissGuard,
  clearSelectionMissGuardTimer,
  scheduleSelectionMissGuardReset,
  shouldDisarmSelectionMissGuardOnPointerMove,
} from '../utils/selectionMissGuard';
import { scheduleStabilizedAutoFrame } from '../utils/stabilizedAutoFrame';
import { buildViewerLoadingHudState } from '../utils/viewerLoadingHud';
import type { ViewerRobotDataResolution } from '../utils/viewerRobotData';
import { resolveUsdGroundAlignmentSettleDelaysMs } from '../utils/usdGroundAlignmentDelays';
import {
  alignUsdSceneRootToGround,
  resolveUsdGroundAlignmentBaseline,
} from '../utils/usdGroundAlignment';
import { shouldSettleUsdGroundAlignmentAfterInitialLoad } from '../utils/usdGroundAlignmentPolicy';
import {
  isUsdPickableHelperObject,
  resolvePreferredUsdGeometryRole,
  resolveUsdHelperHit,
  sortUsdInteractionCandidates,
  type ResolvedUsdHelperHit,
} from '../utils/usdInteractionPicking';
import { resolveUsdVisualMeshObjectOrder } from '../utils/usdRuntimeMeshObjectOrder';
import { hasBlobBackedLargeUsdaInStageScope } from '../utils/usdBlobBackedUsda.ts';

interface UsdWasmStageProps {
  active?: boolean;
  sourceFile: RobotFile;
  availableFiles: RobotFile[];
  assets: Record<string, string>;
  mode: ViewerSceneMode;
  justSelectedRef?: RefObject<boolean>;
  groundPlaneOffset?: number;
  selection?: URDFViewerProps['selection'];
  hoveredSelection?: URDFViewerProps['hoveredSelection'];
  hoverSelectionEnabled?: boolean;
  onHover?: URDFViewerProps['onHover'];
  onMeshSelect?: URDFViewerProps['onMeshSelect'];
  showOrigins: boolean;
  showOriginsOverlay: boolean;
  originSize: number;
  showJointAxes: boolean;
  showJointAxesOverlay: boolean;
  jointAxisSize: number;
  showCenterOfMass: boolean;
  showCoMOverlay: boolean;
  centerOfMassSize: number;
  showInertia: boolean;
  showInertiaOverlay: boolean;
  showVisual: boolean;
  showCollision: boolean;
  showCollisionAlwaysOnTop: boolean;
  interactionLayerPriority?: readonly ViewerInteractiveLayer[];
  toolMode: ToolMode;
  robotLinks?: Record<string, UrdfLink>;
  transformMode?: 'select' | 'translate' | 'rotate' | 'universal';
  onCollisionTransformPreview?: URDFViewerProps['onCollisionTransformPreview'];
  onCollisionTransformEnd?: URDFViewerProps['onCollisionTransform'];
  onTransformPending?: (pending: boolean) => void;
  setIsDragging?: (dragging: boolean) => void;
  loadingLabel: string;
  loadingDetailLabel: string;
  loadingPhaseLabels: UsdLoadingPhaseLabels;
  onRobotDataResolved?: (result: ViewerRobotDataResolution) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  runtimeBridge?: ViewerRuntimeStageBridge;
  registerAutoFitGroundHandler?: ((handler: (() => void) | null) => void) | null;
  measureTargetResolverRef?: MutableRefObject<MeasureTargetResolver | null>;
}

type ViewerControls = {
  update?: () => boolean;
  target?: THREE.Vector3;
  addEventListener?: (type: 'start', listener: () => void) => void;
  removeEventListener?: (type: 'start', listener: () => void) => void;
};

const RUNTIME_DECORATION_REFRESH_DEBOUNCE_MS = 96;
const USD_STAGE_LOAD_DEBUG_HISTORY_LIMIT = 24;

type UsdStageLoadDebugStatus = 'pending' | 'resolved' | 'rejected';

type UsdStageLoadDebugEntry = {
  sourceFileName: string;
  step: string;
  status: UsdStageLoadDebugStatus;
  timestamp: number;
  durationMs?: number;
  detail?: Record<string, unknown> | null;
};

type RuntimeWindow = Window & {
  USD?: unknown;
  usdRoot?: THREE.Group;
  usdStage?: unknown;
  renderInterface?: unknown;
  driver?: unknown;
  camera?: THREE.Camera;
  _controls?: ViewerControls;
  scene?: THREE.Scene;
  __usdStageLoadDebug?: UsdStageLoadDebugEntry;
  __usdStageLoadDebugHistory?: UsdStageLoadDebugEntry[];
};

type ViewerRuntimeInterface = {
  getCachedRobotSceneSnapshot?: (stageSourcePath?: string | null) => unknown;
  warmupRobotSceneSnapshotFromDriver?: (
    driver: unknown,
    options?: Record<string, unknown>,
  ) => unknown;
  getLastRobotSceneWarmupSummary?: () => unknown;
  getResolvedPrimPathForMeshId?: (meshId: string) => string | null;
  getResolvedVisualTransformPrimPathForMeshId?: (meshId: string) => string | null;
  getPreferredLinkWorldTransform?: (linkPath: string) => unknown;
  getWorldTransformForPrimPath?: (primPath: string) => unknown;
  ingestRobotMetadataSnapshotFromBootstrapPayload?: (
    snapshot: unknown,
    options?: Record<string, unknown>,
  ) => unknown;
};

type UsdMeshRole = 'visual' | 'collision';

type RuntimeMeshMeta = {
  linkPath: string;
  meshId: string;
  objectIndex?: number;
  authoredOrder?: number;
  role: UsdMeshRole;
};

type RuntimeMeshIndex = {
  meshMetaByObject: Map<THREE.Object3D, RuntimeMeshMeta>;
  meshesByLinkKey: Map<string, THREE.Mesh[]>;
  pickMeshes: THREE.Mesh[];
  pickMeshesByRole: Record<UsdMeshRole, THREE.Mesh[]>;
  helperTargets: THREE.Object3D[];
};

type RuntimeInteractionTarget =
  | {
      kind: 'geometry';
      meta: RuntimeMeshMeta;
    }
  | {
      kind: 'helper';
      selection: ResolvedUsdHelperHit;
    };

type RuntimePreviewCollisionTransform = {
  linkId: string;
  objectIndex: number;
  position: { x: number; y: number; z: number };
  rotation: { r: number; p: number; y: number };
};

type HighlightedMaterialState = {
  depthTest: boolean;
  depthWrite: boolean;
  opacity: number;
  transparent: boolean;
  colorHex?: number;
  emissiveHex?: number;
  emissiveIntensity?: number;
};

type HighlightedMeshSnapshot = {
  material: THREE.Material | THREE.Material[];
  materialStates: HighlightedMaterialState[];
  renderOrder: number;
  activeRole: UsdMeshRole | null;
};

const USD_VISUAL_SEGMENT_PATTERN = /(?:^|\/)visuals?(?:$|[/.])/i;
const USD_COLLISION_SEGMENT_PATTERN = /(?:^|\/)collisions?(?:$|[/.])/i;

function recordUsdStageLoadDebug(
  runtimeWindow: RuntimeWindow,
  entry: UsdStageLoadDebugEntry,
): void {
  runtimeWindow.__usdStageLoadDebug = entry;
  const history = Array.isArray(runtimeWindow.__usdStageLoadDebugHistory)
    ? runtimeWindow.__usdStageLoadDebugHistory.slice(-(USD_STAGE_LOAD_DEBUG_HISTORY_LIMIT - 1))
    : [];
  history.push(entry);
  runtimeWindow.__usdStageLoadDebugHistory = history;
}

async function trackUsdStageLoadStep<T>({
  runtimeWindow,
  sourceFileName,
  step,
  run,
  pendingDetail,
  resolveDetail,
}: {
  runtimeWindow: RuntimeWindow;
  sourceFileName: string;
  step: string;
  run: () => Promise<T>;
  pendingDetail?: Record<string, unknown> | null;
  resolveDetail?: (value: T) => Record<string, unknown> | null | undefined;
}): Promise<T> {
  const startedAt = Date.now();
  recordUsdStageLoadDebug(runtimeWindow, {
    sourceFileName,
    step,
    status: 'pending',
    timestamp: startedAt,
    detail: pendingDetail ?? null,
  });

  try {
    const result = await run();
    recordUsdStageLoadDebug(runtimeWindow, {
      sourceFileName,
      step,
      status: 'resolved',
      timestamp: Date.now(),
      durationMs: Date.now() - startedAt,
      detail: resolveDetail?.(result) ?? pendingDetail ?? null,
    });
    return result;
  } catch (error) {
    recordUsdStageLoadDebug(runtimeWindow, {
      sourceFileName,
      step,
      status: 'rejected',
      timestamp: Date.now(),
      durationMs: Date.now() - startedAt,
      detail: {
        ...(pendingDetail ?? {}),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

function getRuntimeWarmupDebugDetail(
  renderInterface: ViewerRuntimeInterface | null | undefined,
): Record<string, unknown> | null {
  const rawSummary = renderInterface?.getLastRobotSceneWarmupSummary?.();
  if (!rawSummary || typeof rawSummary !== 'object') {
    return null;
  }

  const summary = rawSummary as Record<string, unknown>;
  const subsetFailureCount = Math.max(0, Number(summary.snapshotMaterialSubsetFailureCount ?? 0));
  const inheritFailureCount = Math.max(0, Number(summary.snapshotMaterialInheritFailureCount ?? 0));
  const textureFailureCount = Math.max(0, Number(summary.snapshotTextureFailureCount ?? 0));
  const materialFailureCount = subsetFailureCount + inheritFailureCount + textureFailureCount;
  const driverStageResolveStatus = String(summary.driverStageResolveStatus || '').trim() || null;
  const driverStageResolveSource = String(summary.driverStageResolveSource || '').trim() || null;
  const driverStageResolveError = String(summary.driverStageResolveError || '').trim() || null;
  const runtimeWarmupSource = String(summary.source || '').trim() || null;
  const runtimeWarmupDriverSnapshotSource =
    String(summary.driverSnapshotSource || '').trim() || null;

  return {
    runtimeWarmupSource,
    runtimeWarmupDriverSnapshotSource,
    runtimeWarmupSceneSnapshotReady: summary.sceneSnapshotReady === true,
    driverStageResolveStatus,
    driverStageResolveSource,
    driverStageResolveError,
    driverStageResolvePending: summary.driverStageResolvePending === true,
    snapshotMaterialFailureCount: materialFailureCount,
    snapshotMaterialSubsetFailureCount: subsetFailureCount,
    snapshotMaterialInheritFailureCount: inheritFailureCount,
    snapshotTextureFailureCount: textureFailureCount,
    runtimeWarmupHasWarnings: driverStageResolveStatus === 'rejected' || materialFailureCount > 0,
  };
}

function getPathBasename(path: string | null | undefined): string {
  const normalized = String(path || '')
    .trim()
    .replace(/[<>]/g, '');
  if (!normalized) return '';

  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

function resolveUsdCollisionMeshAuthoredOrder({
  renderInterface,
  linkPath,
  meshId,
  fallbackOrder,
}: {
  renderInterface: any;
  linkPath: string;
  meshId: string;
  fallbackOrder: number;
}): number {
  const truth = renderInterface?.getUrdfTruthForCurrentStage?.();
  const runtimeEntry = renderInterface?.getUrdfCollisionEntryForMeshId?.(meshId);
  const linkName = getPathBasename(linkPath);
  const authoredEntries = linkName ? truth?.collisionsByLinkName?.get?.(linkName)?.all : null;

  if (runtimeEntry && Array.isArray(authoredEntries)) {
    const authoredIndex = authoredEntries.indexOf(runtimeEntry);
    if (authoredIndex >= 0) {
      return authoredIndex;
    }
  }

  return fallbackOrder;
}

function isUsdVisualMeshId(meshId: string, meshName = ''): boolean {
  return (
    USD_VISUAL_SEGMENT_PATTERN.test(String(meshId || '').toLowerCase()) ||
    USD_VISUAL_SEGMENT_PATTERN.test(String(meshName || '').toLowerCase())
  );
}

function isUsdCollisionMeshId(meshId: string, meshName = ''): boolean {
  return (
    USD_COLLISION_SEGMENT_PATTERN.test(String(meshId || '').toLowerCase()) ||
    USD_COLLISION_SEGMENT_PATTERN.test(String(meshName || '').toLowerCase())
  );
}

function getUsdMeshRole(meshId: string, meshName = ''): UsdMeshRole {
  if (isUsdCollisionMeshId(meshId, meshName)) {
    return 'collision';
  }

  return isUsdVisualMeshId(meshId, meshName) ? 'visual' : 'visual';
}

function areSelectionStatesEqual(
  left: URDFViewerProps['selection'] | URDFViewerProps['hoveredSelection'],
  right: URDFViewerProps['selection'] | URDFViewerProps['hoveredSelection'],
): boolean {
  return (
    (left?.type ?? null) === (right?.type ?? null) &&
    (left?.id ?? null) === (right?.id ?? null) &&
    left?.subType === right?.subType &&
    (left?.objectIndex ?? -1) === (right?.objectIndex ?? -1) &&
    left?.helperKind === right?.helperKind
  );
}

function captureHighlightedMeshSnapshot(mesh: THREE.Mesh): HighlightedMeshSnapshot {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  return {
    material: mesh.material,
    renderOrder: mesh.renderOrder,
    materialStates: materials.map((material) => ({
      transparent: material?.transparent ?? false,
      opacity: material?.opacity ?? 1,
      depthTest: material?.depthTest ?? true,
      depthWrite: material?.depthWrite ?? true,
      colorHex: (material as any)?.color?.isColor ? (material as any).color.getHex() : undefined,
      emissiveHex: (material as any)?.emissive?.isColor
        ? (material as any).emissive.getHex()
        : undefined,
      emissiveIntensity: Number.isFinite((material as any)?.emissiveIntensity)
        ? Number((material as any).emissiveIntensity)
        : undefined,
    })),
    activeRole: null,
  };
}

function disposeHighlightOverrideMaterials(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((entry) => {
    if (!entry) return;
    if ((entry as any).userData?.isHighlightOverrideMaterial !== true) return;
    disposeMaterial(entry, false);
  });
}

function restoreHighlightedMeshSnapshot(mesh: THREE.Mesh, snapshot: HighlightedMeshSnapshot): void {
  const currentMaterial = mesh.material;
  if (currentMaterial !== snapshot.material) {
    disposeHighlightOverrideMaterials(currentMaterial as THREE.Material | THREE.Material[]);
  }

  mesh.material = snapshot.material;
  mesh.renderOrder = snapshot.renderOrder;

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material, index) => {
    const materialState = snapshot.materialStates[index];
    if (!material || !materialState) return;

    material.transparent = materialState.transparent;
    material.opacity = materialState.opacity;
    material.depthTest = materialState.depthTest;
    material.depthWrite = materialState.depthWrite;
    if (materialState.colorHex !== undefined && (material as any).color?.isColor) {
      (material as any).color.setHex(materialState.colorHex);
    }
    if (materialState.emissiveHex !== undefined && (material as any).emissive?.isColor) {
      (material as any).emissive.setHex(materialState.emissiveHex);
    }
    if (materialState.emissiveIntensity !== undefined && 'emissiveIntensity' in (material as any)) {
      (material as any).emissiveIntensity = materialState.emissiveIntensity;
    }
    material.needsUpdate = true;
  });
  snapshot.activeRole = null;
}

function disposeUsdOverrideMaterial(material: THREE.Material | THREE.Material[] | undefined): void {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((entry) => {
    entry?.dispose?.();
  });
}

function createUsdVisualColorOverrideMaterial(
  material: THREE.Material,
  colorOverride: string,
): THREE.Material {
  const clonedMaterial = material.clone();
  const materialWithColor = clonedMaterial as THREE.Material & {
    color?: THREE.Color;
    map?: unknown;
  };
  if (materialWithColor.color && !materialWithColor.map) {
    materialWithColor.color = materialWithColor.color.clone();
    materialWithColor.color.set(colorOverride);
  }
  clonedMaterial.needsUpdate = true;
  return clonedMaterial;
}

function syncUsdVisualColorOverride(mesh: THREE.Mesh, colorOverride: string | null): void {
  const meshUserData = mesh.userData as THREE.Object3D['userData'] & {
    __usdOriginalVisualMaterial?: THREE.Material | THREE.Material[];
    __usdVisualColorOverride?: string | null;
    __usdVisualOverrideMaterial?: THREE.Material | THREE.Material[];
  };

  if (!colorOverride) {
    if (meshUserData.__usdOriginalVisualMaterial) {
      mesh.material = meshUserData.__usdOriginalVisualMaterial;
    }
    if (meshUserData.__usdVisualOverrideMaterial) {
      disposeUsdOverrideMaterial(meshUserData.__usdVisualOverrideMaterial);
    }
    delete meshUserData.__usdVisualOverrideMaterial;
    delete meshUserData.__usdVisualColorOverride;
    return;
  }

  if (!meshUserData.__usdOriginalVisualMaterial) {
    meshUserData.__usdOriginalVisualMaterial = mesh.material;
  }

  if (
    meshUserData.__usdVisualColorOverride === colorOverride &&
    meshUserData.__usdVisualOverrideMaterial
  ) {
    mesh.material = meshUserData.__usdVisualOverrideMaterial;
    return;
  }

  if (meshUserData.__usdVisualOverrideMaterial) {
    disposeUsdOverrideMaterial(meshUserData.__usdVisualOverrideMaterial);
  }

  const originalMaterial = meshUserData.__usdOriginalVisualMaterial;
  const overrideMaterial = Array.isArray(originalMaterial)
    ? originalMaterial.map((material) =>
        createUsdVisualColorOverrideMaterial(material, colorOverride),
      )
    : createUsdVisualColorOverrideMaterial(originalMaterial, colorOverride);

  meshUserData.__usdVisualOverrideMaterial = overrideMaterial;
  meshUserData.__usdVisualColorOverride = colorOverride;
  mesh.material = overrideMaterial;
}

function getSharedConfigurationVirtualPath(path: string): string | null {
  const normalizedPath = toVirtualUsdPath(path);
  if (!normalizedPath.toLowerCase().includes('/configuration/')) return null;

  const fileName = normalizedPath.split('/').pop();
  if (!fileName) return null;
  return `/configuration/${fileName}`;
}

function getRuntimeWindow(): RuntimeWindow {
  return window as RuntimeWindow;
}

function disposeUsdRootChildren(rootGroup: THREE.Group): void {
  const children = [...rootGroup.children];
  children.forEach((child) => {
    disposeObject3D(child, true);
  });
}

async function preloadUsdEntry(
  runtime: UsdWasmRuntime,
  entry: PreparedUsdPreloadFile,
  isActive: () => boolean,
): Promise<boolean> {
  if (!isActive()) return false;

  const resolvedBytes = await resolvePreparedUsdPreloadWriteBytes(entry, isActive);
  if (!resolvedBytes) {
    if (entry.error) {
      console.error(`Skipping USD dependency preload for ${entry.path}`, entry.error);
    }
    return false;
  }
  if (!isActive()) return false;

  const loaded = await writeUsdBytesToVirtualPath(runtime, entry.path, resolvedBytes, isActive);
  if (!loaded) return false;

  const sharedConfigurationPath = getSharedConfigurationVirtualPath(entry.path);
  if (
    sharedConfigurationPath &&
    sharedConfigurationPath !== entry.path &&
    !runtime.usdFsHelper.hasVirtualFilePath(sharedConfigurationPath)
  ) {
    await writeUsdBytesToVirtualPath(runtime, sharedConfigurationPath, resolvedBytes, isActive);
  }

  return runtime.usdFsHelper.hasVirtualFilePath(entry.path);
}

function normalizePreparedUsdPreloadBytes(
  bytes: PreparedUsdPreloadFile['bytes'],
): Uint8Array | null {
  if (!bytes) {
    return null;
  }

  if (bytes instanceof Uint8Array) {
    return bytes.byteLength > 0 ? bytes : null;
  }

  if (bytes instanceof ArrayBuffer) {
    return bytes.byteLength > 0 ? new Uint8Array(bytes) : null;
  }

  return null;
}

async function writeUsdBytesToVirtualPath(
  runtime: UsdWasmRuntime,
  virtualPath: string,
  bytes: Uint8Array,
  isActive: () => boolean,
): Promise<boolean> {
  if (!isActive() || !runtime.usdFsHelper.canOperateOnUsdFilesystem()) return false;

  const normalizedVirtualPath = toVirtualUsdPath(virtualPath);
  const fileName = normalizedVirtualPath.split('/').pop() || 'resource.usd';
  const lastSlashIndex = normalizedVirtualPath.lastIndexOf('/');
  const directory = lastSlashIndex >= 0 ? normalizedVirtualPath.slice(0, lastSlashIndex + 1) : '/';

  if (
    typeof runtime.USD.FS_createPath !== 'function' ||
    (typeof runtime.USD.FS_writeFile !== 'function' &&
      (typeof runtime.USD.FS_createDataFile !== 'function' ||
        typeof runtime.USD.FS_unlink !== 'function'))
  ) {
    return false;
  }

  runtime.USD.FS_createPath('', directory, true, true);
  if (typeof runtime.USD.FS_writeFile === 'function') {
    try {
      runtime.USD.FS_writeFile(normalizedVirtualPath, bytes);
      runtime.usdFsHelper.trackVirtualFilePath?.(normalizedVirtualPath);
      return runtime.usdFsHelper.hasVirtualFilePath(normalizedVirtualPath);
    } catch {
      // Fall back to the older unlink/createDataFile path if direct writes fail.
    }
  }

  try {
    runtime.USD.FS_unlink(normalizedVirtualPath);
  } catch {}
  runtime.usdFsHelper.untrackVirtualFilePath?.(normalizedVirtualPath);
  runtime.USD.FS_createDataFile(directory, fileName, bytes, true, true, true);
  runtime.usdFsHelper.trackVirtualFilePath?.(normalizedVirtualPath);

  return runtime.usdFsHelper.hasVirtualFilePath(normalizedVirtualPath);
}

async function readUsdBlobBytes(blob: Blob, isActive: () => boolean): Promise<Uint8Array | null> {
  if (!isActive()) {
    return null;
  }

  const arrayBuffer = await blob.arrayBuffer();
  if (!isActive() || arrayBuffer.byteLength <= 0) {
    return null;
  }

  return new Uint8Array(arrayBuffer);
}

async function resolvePreparedUsdPreloadWriteBytes(
  entry: PreparedUsdPreloadFile,
  isActive: () => boolean,
): Promise<Uint8Array | null> {
  const normalizedBytes = normalizePreparedUsdPreloadBytes(entry.bytes);
  if (normalizedBytes) {
    return normalizedBytes;
  }

  if (!entry.blob) {
    return null;
  }

  const blobBytes = await readUsdBlobBytes(entry.blob, isActive);
  if (!blobBytes) {
    return null;
  }

  const blobMimeType = entry.blob.type || null;
  entry.bytes = blobBytes;
  entry.blob = null;
  entry.mimeType = entry.mimeType ?? blobMimeType;
  return blobBytes;
}

async function preloadUsdDependencies(
  runtime: UsdWasmRuntime,
  stageSourcePath: string,
  entries: PreparedUsdPreloadFile[],
  isActive: () => boolean,
): Promise<void> {
  await preloadUsdStageEntries({
    stageSourcePath,
    entries,
    isActive,
    preloadEntry: async (entry, entryIsActive) => {
      await preloadUsdEntry(runtime, entry, entryIsActive);
    },
  });
}

async function ensureCriticalUsdDependenciesLoaded(
  runtime: UsdWasmRuntime,
  stagePath: string,
  requiredPaths: string[],
  entries: PreparedUsdPreloadFile[],
  isActive: () => boolean,
): Promise<void> {
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  if (requiredPaths.length === 0) return;

  const missingPaths: string[] = [];
  for (const requiredPath of requiredPaths) {
    if (!isActive()) return;

    if (runtime.usdFsHelper.hasVirtualFilePath(requiredPath)) continue;

    const exactEntry = entryByPath.get(requiredPath);

    let loaded = false;

    if (exactEntry) {
      loaded = await preloadUsdEntry(runtime, exactEntry, isActive);
    }

    if (!loaded) {
      const fileName = requiredPath.split('/').pop();
      const sharedConfigurationPath = fileName ? `/configuration/${fileName}` : null;

      if (sharedConfigurationPath) {
        try {
          const response = await fetch(sharedConfigurationPath);
          if (response.ok) {
            const sharedConfigurationBlob = await response.blob();
            const sharedConfigurationBytes = await readUsdBlobBytes(
              sharedConfigurationBlob,
              isActive,
            );
            if (sharedConfigurationBytes) {
              loaded = await writeUsdBytesToVirtualPath(
                runtime,
                sharedConfigurationPath,
                sharedConfigurationBytes,
                isActive,
              );
            }
            if (loaded) {
              loaded = await writeUsdBytesToVirtualPath(
                runtime,
                requiredPath,
                sharedConfigurationBytes!,
                isActive,
              );
            }
          }
        } catch (error) {
          console.error(`Skipping shared USD configuration preload for ${requiredPath}`, error);
        }
      }
    }

    if (!loaded) {
      missingPaths.push(requiredPath);
    }
  }

  if (missingPaths.length > 0) {
    throw failFastInDev(
      'UsdWasmStage:ensureCriticalUsdDependenciesLoaded',
      new Error(
        `Critical USD dependencies are missing for "${stagePath}": ${missingPaths.join(', ')}`,
      ),
    );
  }
}

export function UsdWasmStage({
  active = true,
  sourceFile,
  availableFiles,
  assets,
  mode,
  justSelectedRef,
  groundPlaneOffset = 0,
  selection,
  hoveredSelection,
  hoverSelectionEnabled = true,
  onHover,
  onMeshSelect,
  showOrigins,
  showOriginsOverlay,
  originSize,
  showJointAxes,
  showJointAxesOverlay,
  jointAxisSize,
  showCenterOfMass,
  showCoMOverlay,
  centerOfMassSize,
  showInertia,
  showInertiaOverlay,
  showVisual,
  showCollision,
  showCollisionAlwaysOnTop,
  interactionLayerPriority,
  toolMode,
  robotLinks,
  transformMode = 'select',
  onCollisionTransformPreview,
  onCollisionTransformEnd,
  onTransformPending,
  setIsDragging,
  loadingLabel,
  loadingDetailLabel,
  loadingPhaseLabels,
  onRobotDataResolved,
  onDocumentLoadEvent,
  runtimeBridge,
  registerAutoFitGroundHandler = null,
  measureTargetResolverRef,
}: UsdWasmStageProps) {
  const rootGroup = useMemo(() => {
    const group = new THREE.Group();
    group.name = 'usd-wasm-root';
    return group;
  }, []);
  const threeState = useThree();
  const { camera, scene, invalidate, gl } = threeState;
  const snapshotRenderActive = useSnapshotRenderActive();
  const effectiveShowOrigins = showOrigins && !snapshotRenderActive;
  const effectiveShowJointAxes = showJointAxes && !snapshotRenderActive;
  const effectiveShowCenterOfMass = showCenterOfMass && !snapshotRenderActive;
  const effectiveShowInertia = showInertia && !snapshotRenderActive;
  const effectiveSelection = snapshotRenderActive ? undefined : selection;
  const effectiveHoveredSelection = snapshotRenderActive ? undefined : hoveredSelection;
  const controls = (threeState as typeof threeState & { controls?: unknown }).controls;
  const onRuntimeRobotResolved = runtimeBridge?.onRobotResolved;
  const onRuntimeSelectionChange = runtimeBridge?.onSelectionChange;
  const onRuntimeActiveJointChange = runtimeBridge?.onActiveJointChange;
  const onRuntimeJointAnglesChange = runtimeBridge?.onJointAnglesChange;
  const driverRef = useRef<any>(null);
  const runtimeRef = useRef<UsdWasmRuntime | null>(null);
  const renderInterfaceRef = useRef<any>(null);
  const activeRef = useRef(active);
  const resolvedRobotDataRef = useRef<ViewerRobotDataResolution | null>(null);
  const jointAxesResolutionRef = useRef<ViewerRobotDataResolution | null>(null);
  const baselineRobotLinksRef = useRef<Record<string, UrdfLink> | null>(null);
  const collisionMeshObjectIndexByMeshIdRef = useRef(new Map<string, number | undefined>());
  const previousCollisionCountByLinkPathRef = useRef(new Map<string, number>());
  const previousSelectionRef = useRef<URDFViewerProps['selection']>(selection);
  const meshMetaByObjectRef = useRef(new Map<THREE.Object3D, RuntimeMeshMeta>());
  const meshesByLinkKeyRef = useRef(new Map<string, THREE.Mesh[]>());
  const pickMeshesRef = useRef<THREE.Object3D[]>([]);
  const pickMeshesByRoleRef = useRef<RuntimeMeshIndex['pickMeshesByRole']>({
    visual: [],
    collision: [],
  });
  const helperTargetsRef = useRef<THREE.Object3D[]>([]);
  const baseLocalMatrixByMeshRef = useRef<WeakMap<THREE.Object3D, THREE.Matrix4>>(new WeakMap());
  const highlightedMeshesRef = useRef(new Map<THREE.Mesh, HighlightedMeshSnapshot>());
  const groundAlignmentTimeoutsRef = useRef<Array<ReturnType<typeof window.setTimeout>>>([]);
  const shouldSettleUsdGroundAlignment = shouldSettleUsdGroundAlignmentAfterInitialLoad(sourceFile);
  const linkAxesControllerRef = useRef(new LinkAxesController());
  const linkDynamicsControllerRef = useRef(new LinkDynamicsController());
  const linkRotationControllerRef = useRef(new LinkRotationController());
  const jointAxesControllerRef = useRef(new UsdJointAxesController());
  const loadTokenRef = useRef(0);
  const lastRuntimeSelectionRef = useRef<URDFViewerProps['selection']>({
    type: null,
    id: null,
    subType: undefined,
    objectIndex: undefined,
    helperKind: undefined,
  });
  const lastPointerDownMeshMetaRef = useRef<RuntimeMeshMeta | null>(null);
  const lastRuntimeJointAnglesRef = useRef<Record<string, number>>({});
  const pendingRuntimeJointPreviewRef = useRef<{
    linkPath: string | null;
    jointInfo: UsdStageJointInfoLike | null;
  } | null>(null);
  const runtimeJointPreviewFrameRef = useRef<number | null>(null);
  const lastRuntimeHoverRef = useRef<URDFViewerProps['hoveredSelection']>({
    type: null,
    id: null,
    subType: undefined,
    objectIndex: undefined,
    helperKind: undefined,
  });
  const selectionResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibilityRef = useRef({ showVisual, showCollision, showCollisionAlwaysOnTop });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<UsdLoadingProgress | null>(null);
  const [visibleStagePath, setVisibleStagePath] = useState<string | null>(null);
  const [previewCollisionTransform, setPreviewCollisionTransform] =
    useState<RuntimePreviewCollisionTransform | null>(null);
  const runtimeDecorationRefreshTimerRef = useRef<number | null>(null);
  const pendingCameraFrameRef = useRef<CameraFrameResult | null>(null);
  const cameraFrameFocusTargetRef = useRef<THREE.Vector3 | null>(null);
  const cameraFramePositionTargetRef = useRef<THREE.Vector3 | null>(null);
  const isCameraFrameAnimatingRef = useRef(false);
  const isLoadingRef = useRef(isLoading);
  const visibleStagePathRef = useRef<string | null>(visibleStagePath);
  const interactionPolicy = useMemo(
    () => resolveUsdStageInteractionPolicy(mode, toolMode),
    [mode, toolMode],
  );
  const jointRotationRuntime = useMemo(
    () =>
      resolveUsdStageJointRotationRuntime({
        mode,
        showVisual,
        showCollision,
        showCollisionAlwaysOnTop,
        interactionLayerPriority,
        toolMode,
      }),
    [interactionLayerPriority, mode, showCollision, showCollisionAlwaysOnTop, showVisual, toolMode],
  );
  const jointRotationRuntimeRef = useRef(jointRotationRuntime);
  const gizmoTargetsRef = useRef<THREE.Object3D[]>([]);
  const gizmoTargetsCacheKeyRef = useRef('');
  const gizmoTargetsUpdatedAtRef = useRef(0);
  const hoverPointerLocalRef = useRef<{ x: number; y: number } | null>(null);
  const hoverPointerInsideRef = useRef(false);
  const hoverNeedsRaycastRef = useRef(false);
  const hoverCameraMotionPendingRef = useRef(false);
  const hoverPointerButtonsRef = useRef(0);
  const lastHoverCameraPositionRef = useRef(new THREE.Vector3());
  const lastHoverCameraQuaternionRef = useRef(new THREE.Quaternion());
  const runtimePointerRef = useRef(new THREE.Vector2());
  const runtimeRaycasterRef = useRef(new THREE.Raycaster());
  const loadingHudState = useMemo(
    () =>
      buildViewerLoadingHudState({
        phase: loadingProgress?.phase,
        progressMode: loadingProgress?.progressMode,
        loadedCount: loadingProgress?.loadedCount,
        totalCount: loadingProgress?.totalCount,
        progressPercent: loadingProgress?.progressPercent,
        fallbackDetail: loadingDetailLabel,
      }),
    [
      loadingDetailLabel,
      loadingProgress?.loadedCount,
      loadingProgress?.progressPercent,
      loadingProgress?.totalCount,
    ],
  );
  const loadingStageLabel =
    loadingProgress?.phase && loadingProgress.phase !== 'ready'
      ? loadingPhaseLabels[loadingProgress.phase]
      : null;
  const loadingDetail = loadingHudState.detail === loadingStageLabel ? '' : loadingHudState.detail;
  const regressionDebugEnabled =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('regressionDebug') === '1');
  const emitDocumentLoadEvent = useCallback(
    (event: ViewerDocumentLoadEvent) => {
      onDocumentLoadEvent?.(event);
    },
    [onDocumentLoadEvent],
  );

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    visibleStagePathRef.current = visibleStagePath;
  }, [visibleStagePath]);

  useEffect(() => {
    visibilityRef.current = { showVisual, showCollision, showCollisionAlwaysOnTop };
  }, [showCollision, showCollisionAlwaysOnTop, showVisual]);

  useEffect(() => {
    previousSelectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    markUsdHoverRaycastDirty(hoverNeedsRaycastRef, invalidate);
  }, [
    interactionPolicy.enableContinuousHover,
    invalidate,
    showCollision,
    showCollisionAlwaysOnTop,
    showVisual,
  ]);

  useEffect(() => {
    if (!regressionDebugEnabled) {
      return;
    }

    setRegressionProjectedInteractionTargetsProvider(() => {
      const canvasRect = gl.domElement.getBoundingClientRect();
      const resolvedRobotData = resolvedRobotDataRef.current;
      const candidates: Array<{
        object: THREE.Object3D;
        selection: {
          type: 'link' | 'joint';
          id: string;
          subType?: 'visual' | 'collision';
          objectIndex?: number;
          helperKind?: ViewerHelperKind;
        };
      }> = [];

      pickMeshesRef.current.forEach((object) => {
        const meta = meshMetaByObjectRef.current.get(object);
        if (!meta) {
          return;
        }

        const linkId = resolvedRobotData?.linkIdByPath[meta.linkPath] ?? null;
        if (!linkId) {
          return;
        }

        candidates.push({
          object,
          selection: {
            type: 'link',
            id: linkId,
            subType: meta.role,
            objectIndex: meta.objectIndex,
          },
        });
      });

      helperTargetsRef.current.forEach((object) => {
        const helperHit = resolveUsdHelperHit(object, resolvedRobotData);
        if (!helperHit) {
          return;
        }

        candidates.push({
          object,
          selection: {
            type: helperHit.type,
            id: helperHit.id,
            helperKind: helperHit.helperKind,
          },
        });
      });

      return collectRegressionProjectedInteractionTargets({
        camera,
        canvasRect,
        candidates,
      });
    });

    return () => {
      setRegressionProjectedInteractionTargetsProvider(null);
    };
  }, [camera, gl, regressionDebugEnabled]);

  useEffect(() => {
    jointRotationRuntimeRef.current = jointRotationRuntime;
  }, [jointRotationRuntime]);

  const stopUsdCameraFrameAnimation = useCallback(() => {
    isCameraFrameAnimatingRef.current = false;
    cameraFrameFocusTargetRef.current = null;
    cameraFramePositionTargetRef.current = null;
  }, []);

  const startUsdCameraFrameTransition = useCallback(
    (frame?: CameraFrameResult | null) => {
      const nextFrame = frame ?? pendingCameraFrameRef.current;
      if (!nextFrame) {
        return false;
      }

      const orbitControls = controls as ViewerControls | null;
      if (!orbitControls?.target) {
        return false;
      }

      pendingCameraFrameRef.current = null;
      cameraFrameFocusTargetRef.current = nextFrame.focusTarget.clone();
      cameraFramePositionTargetRef.current = nextFrame.cameraPosition.clone();
      isCameraFrameAnimatingRef.current = true;
      invalidate();
      return true;
    },
    [controls, invalidate],
  );

  useEffect(() => {
    const orbitControls = controls as ViewerControls | null;
    if (!orbitControls?.addEventListener) {
      return undefined;
    }

    const handleControlStart = () => {
      pendingCameraFrameRef.current = null;
      stopUsdCameraFrameAnimation();
    };

    orbitControls.addEventListener('start', handleControlStart);
    return () => {
      orbitControls.removeEventListener?.('start', handleControlStart);
    };
  }, [controls, stopUsdCameraFrameAnimation]);

  useEffect(() => {
    const linkRotationController = linkRotationControllerRef.current;
    linkRotationController.setPickSubType(jointRotationRuntime.pickSubType);
    linkRotationController.setEnabled(active && jointRotationRuntime.enabled);
    markUsdHoverRaycastDirty(hoverNeedsRaycastRef, invalidate);
  }, [active, invalidate, jointRotationRuntime.enabled, jointRotationRuntime.pickSubType]);

  useEffect(() => {
    if (!active || isLoading || visibleStagePath !== sourceFile.name) {
      return;
    }

    startUsdCameraFrameTransition();
  }, [active, isLoading, sourceFile.name, startUsdCameraFrameTransition, visibleStagePath]);

  useEffect(() => {
    if (
      transformMode === 'select' ||
      selection?.type !== 'link' ||
      selection.subType !== 'collision' ||
      !selection.id
    ) {
      setPreviewCollisionTransform(null);
    }
  }, [selection, transformMode]);

  const resolveUsdCollisionTransformTarget = useCallback(
    (
      currentSelection: NonNullable<URDFViewerProps['selection']>,
    ): UsdCollisionTransformTarget | null => {
      if (
        currentSelection.type !== 'link' ||
        currentSelection.subType !== 'collision' ||
        !currentSelection.id
      ) {
        return null;
      }

      if (!Number.isInteger(currentSelection.objectIndex)) {
        return null;
      }

      const resolvedRobotData = resolvedRobotDataRef.current;
      const renderInterface = renderInterfaceRef.current;
      if (!resolvedRobotData || !renderInterface) {
        return null;
      }

      const linkId = currentSelection.id;
      const objectIndex = currentSelection.objectIndex;
      const linkPath = resolvedRobotData.linkPathById[linkId];
      if (!linkPath) {
        return null;
      }

      return {
        linkId,
        objectIndex,
        getGeometry: () => {
          const activeResolution = resolvedRobotDataRef.current;
          if (!activeResolution) {
            return undefined;
          }

          const currentRobotLinks = robotLinks || activeResolution.robotData.links;
          return resolveUsdRuntimeGeometry(currentRobotLinks[linkId], 'collision', objectIndex);
        },
        getLinkWorldMatrix: () => {
          const activeRenderInterface = renderInterfaceRef.current;
          if (!activeRenderInterface) {
            return null;
          }

          return (
            linkRotationControllerRef.current.getCurrentLinkFrameMatrix(linkPath) ??
            activeRenderInterface.getPreferredLinkWorldTransform?.(linkPath) ??
            activeRenderInterface.getWorldTransformForPrimPath?.(linkPath) ??
            null
          );
        },
        getMeshWorldMatrix: () => {
          let fallbackMesh: THREE.Mesh | null = null;
          let visibleMesh: THREE.Mesh | null = null;

          meshMetaByObjectRef.current.forEach((meta, object) => {
            if (
              meta.role !== 'collision' ||
              meta.linkPath !== linkPath ||
              meta.objectIndex !== objectIndex ||
              !(object instanceof THREE.Mesh)
            ) {
              return;
            }

            fallbackMesh ||= object;
            if (object.visible) {
              visibleMesh ||= object;
            }
          });

          const selectedMesh = visibleMesh ?? fallbackMesh;
          if (!selectedMesh) {
            return null;
          }

          selectedMesh.updateMatrixWorld(true);
          return selectedMesh.matrixWorld.clone();
        },
      };
    },
    [robotLinks],
  );

  const handleUsdCollisionTransformPreview = useCallback(
    (
      linkId: string,
      position: { x: number; y: number; z: number },
      rotation: { r: number; p: number; y: number },
      objectIndex?: number,
    ) => {
      if (!Number.isInteger(objectIndex)) {
        setPreviewCollisionTransform(null);
        return;
      }

      setPreviewCollisionTransform({
        linkId,
        objectIndex,
        position,
        rotation,
      });
      onCollisionTransformPreview?.(linkId, position, rotation, objectIndex);
    },
    [onCollisionTransformPreview],
  );

  const handleUsdCollisionTransformEnd = useCallback(
    (
      linkId: string,
      position: { x: number; y: number; z: number },
      rotation: { r: number; p: number; y: number },
      objectIndex?: number,
    ) => {
      onCollisionTransformEnd?.(linkId, position, rotation, objectIndex);
    },
    [onCollisionTransformEnd],
  );

  const handleUsdCollisionTransformPending = useCallback(
    (pending: boolean) => {
      if (!pending) {
        setPreviewCollisionTransform(null);
      }
      onTransformPending?.(pending);
    },
    [onTransformPending],
  );

  const rebuildRuntimeMeshIndex = useCallback((): RuntimeMeshIndex => {
    const renderInterface = renderInterfaceRef.current;
    const resolvedRobotData = resolvedRobotDataRef.current;
    const currentRobotLinks = robotLinks || resolvedRobotData?.robotData.links || {};
    const nextMeshMetaByObject = new Map<THREE.Object3D, RuntimeMeshMeta>();
    const nextMeshesByLinkKey = new Map<string, THREE.Mesh[]>();
    const nextPickMeshes: THREE.Mesh[] = [];
    const nextPickMeshesByRole: RuntimeMeshIndex['pickMeshesByRole'] = {
      visual: [],
      collision: [],
    };
    const nextHelperTargets = collectSelectableHelperTargets(rootGroup);
    const nextCollisionMeshGroups = new Map<
      string,
      Array<{ mesh: THREE.Mesh; meta: RuntimeMeshMeta }>
    >();
    const nextCollisionAssignments = new Map<string, number | undefined>();
    const nextCollisionCountByLinkPath = new Map<string, number>();
    const collisionMeshFallbackOrderByLinkPath = new Map<string, number>();
    const visualMeshFallbackOrderByLinkPath = new Map<string, number>();
    const previousCollisionCounts = previousCollisionCountByLinkPathRef.current;
    const previousSelection = previousSelectionRef.current;

    for (const [meshId, hydraMesh] of Object.entries(renderInterface?.meshes || {})) {
      const meshRecord = hydraMesh as { _mesh?: THREE.Mesh } | null;
      const mesh = meshRecord?._mesh;
      if (!mesh) continue;

      const resolvedPrimPath =
        renderInterface?.getResolvedVisualTransformPrimPathForMeshId?.(meshId) ||
        renderInterface?.getResolvedPrimPathForMeshId?.(meshId) ||
        null;
      const linkPath = resolveUsdRuntimeLinkPathForMesh({
        meshId,
        resolution: resolvedRobotData,
        resolvedPrimPath,
      });
      if (!linkPath) continue;

      const role = getUsdMeshRole(meshId, mesh.name || '');
      const fallbackOrder = collisionMeshFallbackOrderByLinkPath.get(linkPath) ?? 0;
      if (role === 'collision') {
        collisionMeshFallbackOrderByLinkPath.set(linkPath, fallbackOrder + 1);
      }
      const visualFallbackOrder = visualMeshFallbackOrderByLinkPath.get(linkPath) ?? 0;
      const authoredOrder =
        role === 'collision'
          ? resolveUsdCollisionMeshAuthoredOrder({
              renderInterface,
              linkPath,
              meshId,
              fallbackOrder,
            })
          : resolveUsdVisualMeshObjectOrder({
              renderInterface,
              meshId,
              fallbackOrder: visualFallbackOrder,
            });
      if (role === 'visual') {
        visualMeshFallbackOrderByLinkPath.set(
          linkPath,
          Math.max(visualFallbackOrder, authoredOrder + 1),
        );
      }
      mesh.userData = mesh.userData || {};
      mesh.userData.geometryRole = role;
      mesh.userData.isCollisionMesh = role === 'collision';
      mesh.userData.isVisualMesh = role === 'visual';
      mesh.userData.usdObjectIndex = role === 'collision' ? undefined : authoredOrder;
      mesh.userData.usdLinkPath = linkPath;
      mesh.userData.usdMeshId = meshId;

      if (role === 'visual') {
        prepareUsdVisualMesh(mesh);
      }

      const meta: RuntimeMeshMeta = {
        linkPath,
        meshId,
        authoredOrder,
        objectIndex: role === 'collision' ? undefined : authoredOrder,
        role,
      };
      nextMeshMetaByObject.set(mesh, meta);
      nextPickMeshes.push(mesh);
      nextPickMeshesByRole[role].push(mesh);

      const key = `${linkPath}:${role}`;
      const meshes = nextMeshesByLinkKey.get(key) || [];
      meshes.push(mesh);
      nextMeshesByLinkKey.set(key, meshes);

      if (role === 'collision') {
        const collisionMeshes = nextCollisionMeshGroups.get(linkPath) || [];
        collisionMeshes.push({ mesh, meta });
        nextCollisionMeshGroups.set(linkPath, collisionMeshes);
      }
    }

    nextCollisionMeshGroups.forEach((collisionMeshes, linkPath) => {
      const linkId = resolvedRobotData?.linkIdByPath[linkPath];
      const linkData = linkId ? currentRobotLinks[linkId] : undefined;
      const currentCount = linkData ? getCollisionGeometryEntries(linkData).length : 0;
      nextCollisionCountByLinkPath.set(linkPath, currentCount);

      const previousCount = previousCollisionCounts.get(linkPath);
      const shouldApplyDeleteShift =
        previousCount !== undefined &&
        previousCount - currentCount === 1 &&
        previousSelection?.type === 'link' &&
        previousSelection.subType === 'collision' &&
        previousSelection.id &&
        typeof previousSelection.objectIndex === 'number' &&
        previousSelection.id === linkId;

      const previousAssignments = new Map<string, number>();
      collisionMeshes.forEach(({ meta }) => {
        const previousObjectIndex = collisionMeshObjectIndexByMeshIdRef.current.get(meta.meshId);
        if (Number.isInteger(previousObjectIndex)) {
          previousAssignments.set(meta.meshId, previousObjectIndex as number);
        }
      });

      const reconciledAssignments = reconcileUsdCollisionMeshAssignments({
        meshes: collisionMeshes.map(({ meta }) => ({
          meshId: meta.meshId,
          authoredOrder: meta.authoredOrder ?? 0,
        })),
        currentCount,
        previousAssignments,
        deletedObjectIndex: shouldApplyDeleteShift ? (previousSelection.objectIndex ?? null) : null,
      });

      collisionMeshes.forEach(({ mesh, meta }) => {
        const objectIndex = reconciledAssignments.get(meta.meshId);
        meta.objectIndex = objectIndex;
        mesh.userData.usdObjectIndex = objectIndex;
        nextCollisionAssignments.set(meta.meshId, objectIndex);
      });
    });

    collisionMeshObjectIndexByMeshIdRef.current = nextCollisionAssignments;
    previousCollisionCountByLinkPathRef.current = nextCollisionCountByLinkPath;
    meshMetaByObjectRef.current = nextMeshMetaByObject;
    meshesByLinkKeyRef.current = nextMeshesByLinkKey;
    pickMeshesRef.current = nextPickMeshes;
    pickMeshesByRoleRef.current = nextPickMeshesByRole;
    helperTargetsRef.current = nextHelperTargets;
    return {
      meshMetaByObject: nextMeshMetaByObject,
      meshesByLinkKey: nextMeshesByLinkKey,
      pickMeshes: nextPickMeshes,
      pickMeshesByRole: nextPickMeshesByRole,
      helperTargets: nextHelperTargets,
    };
  }, [robotLinks, rootGroup]);

  const getRuntimeMeshIndex = useCallback((): RuntimeMeshIndex => {
    const renderInterface = renderInterfaceRef.current;
    const hasCachedIndex = meshMetaByObjectRef.current.size > 0 || pickMeshesRef.current.length > 0;
    const hasRuntimeMeshes = Object.keys(renderInterface?.meshes || {}).length > 0;

    if (hasCachedIndex || !hasRuntimeMeshes) {
      return {
        meshMetaByObject: meshMetaByObjectRef.current,
        meshesByLinkKey: meshesByLinkKeyRef.current,
        pickMeshes: pickMeshesRef.current as THREE.Mesh[],
        pickMeshesByRole: pickMeshesByRoleRef.current,
        helperTargets: helperTargetsRef.current,
      };
    }

    return rebuildRuntimeMeshIndex();
  }, [rebuildRuntimeMeshIndex]);

  const getGizmoTargets = useCallback(() => {
    const nextCacheKey = [
      scene.children.length,
      mode,
      transformMode,
      selection?.type ?? 'none',
      selection?.id ?? '',
    ].join(':');
    const now = performance.now();

    if (
      gizmoTargetsCacheKeyRef.current !== nextCacheKey ||
      now - gizmoTargetsUpdatedAtRef.current > 120
    ) {
      gizmoTargetsRef.current = collectGizmoRaycastTargets(scene);
      gizmoTargetsCacheKeyRef.current = nextCacheKey;
      gizmoTargetsUpdatedAtRef.current = now;
    }

    return gizmoTargetsRef.current;
  }, [mode, scene, selection?.id, selection?.type, transformMode]);

  useEffect(() => {
    if (!measureTargetResolverRef) {
      return undefined;
    }

    const resolveMeasureTarget: MeasureTargetResolver = (
      selection,
      fallbackSelection,
      anchorMode,
    ) =>
      resolveUsdMeasureTargetFromSelection(
        {
          resolution: resolvedRobotDataRef.current,
          meshesByLinkKey: meshesByLinkKeyRef.current,
          linkWorldTransformResolver: (linkPath) =>
            linkRotationControllerRef.current.getCurrentLinkFrameMatrix(linkPath) ??
            renderInterfaceRef.current?.getPreferredLinkWorldTransform?.(linkPath) ??
            renderInterfaceRef.current?.getWorldTransformForPrimPath?.(linkPath) ??
            null,
        },
        selection,
        fallbackSelection,
        anchorMode,
      );

    measureTargetResolverRef.current = resolveMeasureTarget;

    return () => {
      if (measureTargetResolverRef.current === resolveMeasureTarget) {
        measureTargetResolverRef.current = null;
      }
    };
  }, [measureTargetResolverRef]);

  const revertUsdHighlights = useCallback(() => {
    highlightedMeshesRef.current.forEach((snapshot, mesh) => {
      restoreHighlightedMeshSnapshot(mesh, snapshot);
    });
    highlightedMeshesRef.current.clear();
  }, []);

  const applyUsdHighlight = useCallback(
    (candidate?: URDFViewerProps['selection']) => {
      const resolvedRobotData = resolvedRobotDataRef.current;
      if (!resolvedRobotData || !candidate?.type || !candidate.id) {
        return;
      }

      const targetLinkPath =
        candidate.type === 'joint'
          ? resolvedRobotData.childLinkPathByJointId[candidate.id]
          : resolvedRobotData.linkPathById[candidate.id];
      if (!targetLinkPath) {
        return;
      }

      const fallbackRole = resolvePreferredUsdGeometryRole({
        interactionLayerPriority,
        showVisual,
        showCollision,
        showCollisionAlwaysOnTop,
      });
      if (!candidate.subType && !fallbackRole) {
        return;
      }

      const targetRole: UsdMeshRole =
        (candidate.subType ?? fallbackRole) === 'collision' ? 'collision' : 'visual';
      if (
        (targetRole === 'visual' && !showVisual) ||
        (targetRole === 'collision' && !showCollision)
      ) {
        return;
      }

      const { meshesByLinkKey } = getRuntimeMeshIndex();
      const meshes = meshesByLinkKey.get(`${targetLinkPath}:${targetRole}`) || [];
      for (const mesh of meshes) {
        if (!mesh.visible || mesh.userData?.isGizmo) continue;
        if (
          typeof candidate.objectIndex === 'number' &&
          (mesh.userData?.usdObjectIndex ?? -1) !== candidate.objectIndex
        ) {
          continue;
        }

        let snapshot = highlightedMeshesRef.current.get(mesh);
        if (!snapshot) {
          snapshot = captureHighlightedMeshSnapshot(mesh);
          highlightedMeshesRef.current.set(mesh, snapshot);
        } else if (snapshot.activeRole === targetRole) {
          mesh.renderOrder = targetRole === 'collision' ? 1000 : 1001;
          continue;
        } else {
          restoreHighlightedMeshSnapshot(mesh, snapshot);
        }

        const sourceMaterials = Array.isArray(snapshot.material)
          ? snapshot.material
          : [snapshot.material];
        const overrideMaterials = sourceMaterials.map((sourceMaterial) =>
          createHighlightOverrideMaterial(sourceMaterial, targetRole),
        );
        mesh.material = Array.isArray(snapshot.material) ? overrideMaterials : overrideMaterials[0];
        mesh.renderOrder = targetRole === 'collision' ? 1000 : 1001;
        snapshot.activeRole = targetRole;
      }
    },
    [
      getRuntimeMeshIndex,
      interactionLayerPriority,
      showCollision,
      showCollisionAlwaysOnTop,
      showVisual,
    ],
  );

  const syncUsdHighlights = useCallback(() => {
    revertUsdHighlights();
    if (snapshotRenderActive) {
      invalidate();
      return;
    }

    applyUsdHighlight(effectiveSelection);
    applyUsdHighlight(hoverSelectionEnabled ? effectiveHoveredSelection : undefined);
    invalidate();
  }, [
    applyUsdHighlight,
    effectiveHoveredSelection,
    effectiveSelection,
    hoverSelectionEnabled,
    invalidate,
    revertUsdHighlights,
    snapshotRenderActive,
  ]);

  const captureUsdGroundBaseline = useCallback(() => {
    return resolveUsdGroundAlignmentBaseline(rootGroup);
  }, [rootGroup]);

  const alignUsdRootToGround = useCallback(
    (lowestVisualZ?: number | null) => {
      return alignUsdSceneRootToGround(rootGroup, groundPlaneOffset, {
        lowestVisualZ,
      });
    },
    [groundPlaneOffset, rootGroup],
  );

  const clearScheduledUsdGroundAlignmentPasses = useCallback(() => {
    if (groundAlignmentTimeoutsRef.current.length === 0) {
      return;
    }

    groundAlignmentTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
    groundAlignmentTimeoutsRef.current = [];
  }, []);

  const scheduleUsdGroundAlignmentSettlePasses = useCallback(
    (stageSourcePath?: string | null) => {
      clearScheduledUsdGroundAlignmentPasses();

      const settleDelays = resolveUsdGroundAlignmentSettleDelaysMs(
        stageSourcePath || sourceFile.name,
      );
      settleDelays.forEach((delayMs) => {
        const timeout = window.setTimeout(() => {
          if (!activeRef.current) {
            return;
          }

          alignUsdRootToGround(captureUsdGroundBaseline());
          invalidate();
        }, delayMs) as unknown as ReturnType<typeof window.setTimeout>;

        groundAlignmentTimeoutsRef.current.push(timeout);
      });
    },
    [
      alignUsdRootToGround,
      captureUsdGroundBaseline,
      clearScheduledUsdGroundAlignmentPasses,
      invalidate,
      sourceFile.name,
    ],
  );

  const sampleUsdAutoFrameBounds = useCallback(() => {
    const bounds = computeVisibleBounds(rootGroup);
    return {
      stabilityKey: createCameraFrameStabilityKey(bounds),
      state: bounds,
    };
  }, [rootGroup]);

  const applyUsdCameraFrame = useCallback(
    (bounds?: THREE.Box3 | null) => {
      const orbitControls = controls as ViewerControls | null;
      if (!orbitControls?.target) return false;

      const frameBounds = bounds ?? computeVisibleBounds(rootGroup);
      const frame = computeCameraFrame(rootGroup, camera, orbitControls.target, frameBounds);
      if (!frame) return false;

      pendingCameraFrameRef.current = frame;

      if (
        activeRef.current &&
        !isLoadingRef.current &&
        visibleStagePathRef.current === sourceFile.name
      ) {
        return startUsdCameraFrameTransition(frame);
      }

      return true;
    },
    [camera, controls, rootGroup, sourceFile.name, startUsdCameraFrameTransition],
  );

  const applyUsdRuntimeLinkOverrides = useCallback(() => {
    const resolvedRobotData = resolvedRobotDataRef.current;
    const renderInterface = renderInterfaceRef.current;
    if (
      !resolvedRobotData ||
      !renderInterface ||
      resolvedRobotData.runtimeLinkMappingMode === 'synthetic-root'
    ) {
      return;
    }

    const currentRobotLinks = robotLinks || resolvedRobotData.robotData.links;
    const baselineRobotLinks = baselineRobotLinksRef.current;

    meshMetaByObjectRef.current.forEach((meta, object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh?.isMesh) {
        return;
      }

      const linkId = resolvedRobotData.linkIdByPath[meta.linkPath];
      const linkData = linkId ? currentRobotLinks[linkId] : undefined;
      const baseGeometry =
        meta.role === 'collision' && !Number.isInteger(meta.objectIndex)
          ? undefined
          : resolveUsdRuntimeGeometry(linkData, meta.role, meta.objectIndex);
      const baselineLinkData = linkId ? baselineRobotLinks?.[linkId] : undefined;
      const baselineGeometry =
        meta.role === 'collision' && !Number.isInteger(meta.objectIndex)
          ? undefined
          : resolveUsdRuntimeGeometry(baselineLinkData, meta.role, meta.objectIndex);
      const geometry =
        meta.role === 'collision' &&
        previewCollisionTransform &&
        linkId === previewCollisionTransform.linkId &&
        meta.objectIndex === previewCollisionTransform.objectIndex &&
        baseGeometry
          ? {
              ...baseGeometry,
              origin: {
                xyz: previewCollisionTransform.position,
                rpy: previewCollisionTransform.rotation,
              },
            }
          : baseGeometry;
      mesh.visible =
        meta.role === 'collision' && !Number.isInteger(meta.objectIndex)
          ? false
          : isUsdRuntimeGeometryVisible({
              link: linkData,
              role: meta.role,
              objectIndex: meta.objectIndex,
              showVisual,
              showCollision,
            });

      if (meta.role === 'visual') {
        if (!highlightedMeshesRef.current.has(mesh)) {
          syncUsdVisualColorOverride(
            mesh,
            resolveUsdVisualColorOverride(geometry, baselineGeometry ?? geometry),
          );
        }
      }

      if (!mesh.visible) {
        return;
      }

      const linkWorldMatrix =
        linkRotationControllerRef.current.getCurrentLinkFrameMatrix(meta.linkPath) ??
        renderInterface.getPreferredLinkWorldTransform?.(meta.linkPath) ??
        renderInterface.getWorldTransformForPrimPath?.(meta.linkPath) ??
        null;
      if (!linkWorldMatrix) {
        return;
      }

      let baseLocalMatrix = baseLocalMatrixByMeshRef.current.get(mesh);
      if (!baseLocalMatrix) {
        baseLocalMatrix = deriveUsdMeshBaseLocalMatrix({
          authoredWorldMatrix: mesh.matrix,
          baselineGeometry,
          linkWorldMatrix,
        });
        baseLocalMatrixByMeshRef.current.set(mesh, baseLocalMatrix);
      }

      mesh.matrix.copy(
        composeUsdMeshOverrideWorldMatrixFromBaseLocal({
          baseLocalMatrix,
          geometry,
          linkWorldMatrix,
        }),
      );
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldNeedsUpdate = true;
    });

    linkDynamicsControllerRef.current.linkDynamicsByLinkPath = buildUsdLinkDynamicsRecordMap({
      resolution: resolvedRobotData,
      robotLinks: currentRobotLinks,
    });
  }, [previewCollisionTransform, robotLinks, showCollision, showVisual]);

  const refreshRuntimeDecorations = useCallback(() => {
    const runtime = runtimeRef.current;
    const renderInterface = renderInterfaceRef.current;
    if (!runtime || !renderInterface) return;

    runtime.applyMeshVisibilityFilters(
      renderInterface,
      showVisual,
      showCollision,
      showCollisionAlwaysOnTop,
    );
    rebuildRuntimeMeshIndex();

    const linkRotationController = linkRotationControllerRef.current;
    linkRotationController.apply(renderInterface, { force: true });
    applyUsdRuntimeLinkOverrides();

    linkAxesControllerRef.current.rebuild(rootGroup, renderInterface, {
      showLinkAxes: effectiveShowOrigins,
      axisSize: originSize,
      linkFrameResolver: (linkPath) => linkRotationController.getCurrentLinkFrameMatrix(linkPath),
      overlay: effectiveShowOrigins && showOriginsOverlay,
    });

    jointAxesControllerRef.current.rebuild({
      jointAxisSize,
      linkFrameResolver: (linkPath) => linkRotationController.getCurrentLinkFrameMatrix(linkPath),
      overlay: effectiveShowJointAxes && showJointAxesOverlay,
      renderInterface,
      resolution: jointAxesResolutionRef.current ?? resolvedRobotDataRef.current,
      showJointAxes: effectiveShowJointAxes,
      usdRoot: rootGroup,
    });

    const linkDynamicsController = linkDynamicsControllerRef.current;
    linkDynamicsController.setCurrentLinkFrameResolver((linkPath) =>
      linkRotationController.getCurrentLinkFrameMatrix(linkPath),
    );
    linkDynamicsController.clear(rootGroup, { invalidateRequestId: false });
    const linkDynamicsRebuild = linkDynamicsController.rebuild(rootGroup, renderInterface, {
      showCenterOfMass: effectiveShowCenterOfMass,
      showCoMOverlay: effectiveShowCenterOfMass && showCoMOverlay,
      centerOfMassSize,
      showInertia: effectiveShowInertia,
      showInertiaOverlay: effectiveShowInertia && showInertiaOverlay,
    });
    helperTargetsRef.current = collectSelectableHelperTargets(rootGroup);
    void linkDynamicsRebuild
      .then(() => {
        helperTargetsRef.current = collectSelectableHelperTargets(rootGroup);
        markUsdHoverRaycastDirty(hoverNeedsRaycastRef, invalidate);
        invalidate();
      })
      .catch(() => {
        // Keep hover refresh resilient; the runtime error path is handled elsewhere.
      });

    markUsdHoverRaycastDirty(hoverNeedsRaycastRef, invalidate);
    syncUsdHighlights();
    invalidate();
  }, [
    centerOfMassSize,
    invalidate,
    jointAxisSize,
    originSize,
    applyUsdRuntimeLinkOverrides,
    rebuildRuntimeMeshIndex,
    rootGroup,
    effectiveShowCenterOfMass,
    showCoMOverlay,
    showCollision,
    effectiveShowInertia,
    effectiveShowJointAxes,
    effectiveShowOrigins,
    showInertiaOverlay,
    showJointAxesOverlay,
    showOriginsOverlay,
    showVisual,
    showCollisionAlwaysOnTop,
    syncUsdHighlights,
  ]);

  const clearScheduledRuntimeDecorationRefresh = useCallback(() => {
    if (runtimeDecorationRefreshTimerRef.current === null) {
      return;
    }

    window.clearTimeout(runtimeDecorationRefreshTimerRef.current);
    runtimeDecorationRefreshTimerRef.current = null;
  }, []);

  const requestRuntimeRender = useCallback(() => {
    invalidate();
  }, [invalidate]);

  const clearScheduledRuntimeJointPreview = useCallback(() => {
    pendingRuntimeJointPreviewRef.current = null;
    if (runtimeJointPreviewFrameRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(runtimeJointPreviewFrameRef.current);
    runtimeJointPreviewFrameRef.current = null;
  }, []);

  const scheduleRuntimeDecorationRefresh = useCallback(() => {
    clearScheduledRuntimeDecorationRefresh();
    runtimeDecorationRefreshTimerRef.current = window.setTimeout(() => {
      runtimeDecorationRefreshTimerRef.current = null;
      refreshRuntimeDecorationsRef.current();
    }, RUNTIME_DECORATION_REFRESH_DEBOUNCE_MS);
  }, [clearScheduledRuntimeDecorationRefresh]);

  const flushRuntimeDecorationRefresh = useCallback(() => {
    clearScheduledRuntimeDecorationRefresh();
    refreshRuntimeDecorationsRef.current();
  }, [clearScheduledRuntimeDecorationRefresh]);

  const syncRuntimeJointPanelRobot = useCallback(() => {
    if (!onRuntimeRobotResolved) return;

    const resolvedRobotData = resolvedRobotDataRef.current;
    if (!resolvedRobotData) {
      onRuntimeRobotResolved(null);
      return;
    }

    onRuntimeRobotResolved(
      createUsdViewerRuntimeRobot({
        flushDecorationRefresh: flushRuntimeDecorationRefresh,
        requestRender: requestRuntimeRender,
        resolution: resolvedRobotData,
        linkRotationController: linkRotationControllerRef.current,
        scheduleDecorationRefresh: scheduleRuntimeDecorationRefresh,
      }),
    );
  }, [
    flushRuntimeDecorationRefresh,
    onRuntimeRobotResolved,
    requestRuntimeRender,
    scheduleRuntimeDecorationRefresh,
  ]);

  const emitRuntimeSelectionChange = useCallback(
    (linkPath: string | null) => {
      if (!linkPath) {
        lastRuntimeSelectionRef.current = {
          type: null,
          id: null,
          subType: undefined,
          objectIndex: undefined,
          helperKind: undefined,
        };
        return;
      }

      armSelectionMissGuard(justSelectedRef);

      const resolvedRobotData = resolvedRobotDataRef.current;
      const linkId = resolvedRobotData?.linkIdByPath[linkPath] ?? null;
      if (!linkId) {
        return;
      }

      const pickedMeshMeta =
        lastPointerDownMeshMetaRef.current?.linkPath === linkPath
          ? lastPointerDownMeshMetaRef.current
          : null;
      const effectivePickedMeshMeta =
        pickedMeshMeta?.role === 'collision' && !Number.isInteger(pickedMeshMeta.objectIndex)
          ? null
          : pickedMeshMeta;
      const nextSelection: URDFViewerProps['selection'] = {
        type: 'link',
        id: linkId,
        subType: effectivePickedMeshMeta?.role,
        objectIndex: effectivePickedMeshMeta?.objectIndex,
      };

      if (areSelectionStatesEqual(lastRuntimeSelectionRef.current, nextSelection)) {
        return;
      }

      lastRuntimeSelectionRef.current = nextSelection;
      onRuntimeSelectionChange?.('link', linkId, effectivePickedMeshMeta?.role);
      if (effectivePickedMeshMeta) {
        onMeshSelect?.(
          linkId,
          null,
          effectivePickedMeshMeta.objectIndex,
          effectivePickedMeshMeta.role,
        );
      }
    },
    [justSelectedRef, onMeshSelect, onRuntimeSelectionChange],
  );

  const emitRuntimeJointAnglesChange = useCallback(() => {
    if (!onRuntimeJointAnglesChange) return;

    const resolvedRobotData = resolvedRobotDataRef.current;
    if (!resolvedRobotData) return;

    const nextJointAngles: Record<string, number> = {};
    let changed = false;
    const previousJointAngles = lastRuntimeJointAnglesRef.current;

    Object.entries(resolvedRobotData.childLinkPathByJointId).forEach(([jointId, childLinkPath]) => {
      if (!childLinkPath) return;

      const jointInfo = linkRotationControllerRef.current.getJointInfoForLink?.(childLinkPath);
      if (!jointInfo || !Number.isFinite(Number(jointInfo.angleDeg))) return;

      const angle = (Number(jointInfo.angleDeg) * Math.PI) / 180;
      nextJointAngles[jointId] = angle;
      if (
        previousJointAngles[jointId] === undefined ||
        Math.abs(previousJointAngles[jointId] - angle) > 1e-6
      ) {
        changed = true;
      }
    });

    if (
      !changed &&
      Object.keys(previousJointAngles).length === Object.keys(nextJointAngles).length
    ) {
      return;
    }

    lastRuntimeJointAnglesRef.current = nextJointAngles;
    onRuntimeJointAnglesChange(nextJointAngles);
  }, [onRuntimeJointAnglesChange]);

  const emitRuntimeJointPreview = useCallback(
    (linkPath: string | null, jointInfo: UsdStageJointInfoLike | null | undefined) => {
      const preview = resolveUsdStageJointPreview(
        resolvedRobotDataRef.current,
        linkPath,
        jointInfo,
      );

      if (preview.activeJointId) {
        onRuntimeActiveJointChange?.(preview.activeJointId);
      }

      if (Object.keys(preview.jointAngles).length > 0) {
        onRuntimeJointAnglesChange?.(preview.jointAngles);
      }
    },
    [onRuntimeActiveJointChange, onRuntimeJointAnglesChange],
  );

  const flushRuntimeJointPreview = useCallback(() => {
    runtimeJointPreviewFrameRef.current = null;
    const pendingPreview = pendingRuntimeJointPreviewRef.current;
    pendingRuntimeJointPreviewRef.current = null;
    if (!pendingPreview) {
      return;
    }

    emitRuntimeJointPreviewRef.current(pendingPreview.linkPath, pendingPreview.jointInfo);
  }, []);

  const scheduleRuntimeJointPreview = useCallback(
    (linkPath: string | null, jointInfo: UsdStageJointInfoLike | null | undefined) => {
      pendingRuntimeJointPreviewRef.current = {
        linkPath,
        jointInfo: jointInfo ?? null,
      };

      if (runtimeJointPreviewFrameRef.current !== null) {
        return;
      }

      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        flushRuntimeJointPreview();
        return;
      }

      runtimeJointPreviewFrameRef.current = window.requestAnimationFrame(() => {
        flushRuntimeJointPreview();
      });
    },
    [flushRuntimeJointPreview],
  );

  const pickRuntimeInteractionTargetAtLocalPoint = useCallback(
    (localX: number, localY: number): RuntimeInteractionTarget | null => {
      if (!camera) return null;

      const width = gl.domElement.clientWidth;
      const height = gl.domElement.clientHeight;
      if (width <= 0 || height <= 0) return null;
      if (localX < 0 || localX > width || localY < 0 || localY > height) {
        return null;
      }

      const pointer = runtimePointerRef.current.set(
        (localX / width) * 2 - 1,
        -(localY / height) * 2 + 1,
      );
      const raycaster = runtimeRaycasterRef.current;
      raycaster.setFromCamera(pointer, camera);

      const gizmoTargets = getGizmoTargets();
      const nearestSceneHit =
        gizmoTargets.length > 0 ? raycaster.intersectObjects(gizmoTargets, false)[0] : undefined;
      if (nearestSceneHit && isGizmoObject(nearestSceneHit.object)) {
        return null;
      }

      const { meshMetaByObject, pickMeshes, helperTargets } = getRuntimeMeshIndex();
      const rawHits = raycaster.intersectObjects(pickMeshes, false);
      const geometryCandidates: Array<{
        kind: 'geometry';
        distance: number;
        layer: UsdMeshRole;
        meta: RuntimeMeshMeta;
        object: THREE.Object3D;
      }> = [];
      for (const hit of rawHits) {
        if (
          hit.object.visible === false ||
          isGizmoObject(hit.object) ||
          isInternalHelperObject(hit.object) ||
          !isVisibleInHierarchy(hit.object) ||
          ((hit.object as THREE.Mesh).isMesh &&
            !hasPickableMaterial((hit.object as THREE.Mesh).material))
        ) {
          continue;
        }

        const meta = meshMetaByObject.get(hit.object);
        if (!meta) {
          continue;
        }
        if (meta.role === 'collision' && !Number.isInteger(meta.objectIndex)) {
          continue;
        }

        geometryCandidates.push({
          kind: 'geometry',
          meta,
          layer: meta.role,
          object: hit.object,
          distance: hit.distance,
        });
      }

      const helperCandidates =
        helperTargets.length > 0
          ? raycaster.intersectObjects(helperTargets, false).flatMap((hit) => {
              if (!isUsdPickableHelperObject(hit.object)) {
                return [];
              }

              const resolvedHelperHit = resolveUsdHelperHit(
                hit.object,
                resolvedRobotDataRef.current,
              );
              if (!resolvedHelperHit) {
                return [];
              }

              return [
                {
                  kind: 'helper' as const,
                  distance: hit.distance,
                  layer: resolvedHelperHit.layer,
                  object: hit.object,
                  selection: resolvedHelperHit,
                },
              ];
            })
          : [];

      const exactCandidates = sortUsdInteractionCandidates(
        [...geometryCandidates, ...helperCandidates],
        interactionLayerPriority,
      );
      const exactCandidate = exactCandidates[0] ?? null;
      if (exactCandidate?.kind === 'helper') {
        return {
          kind: 'helper',
          selection: exactCandidate.selection,
        };
      }

      return exactCandidate?.kind === 'geometry'
        ? {
            kind: 'geometry',
            meta: exactCandidate.meta,
          }
        : null;
    },
    [camera, getGizmoTargets, getRuntimeMeshIndex, gl.domElement, interactionLayerPriority],
  );

  const pickRuntimeInteractionTargetAtPointer = useCallback(
    (event: PointerEvent | MouseEvent): RuntimeInteractionTarget | null =>
      pickRuntimeInteractionTargetAtLocalPoint(event.offsetX, event.offsetY),
    [pickRuntimeInteractionTargetAtLocalPoint],
  );

  const refreshRuntimeDecorationsRef = useRef(refreshRuntimeDecorations);
  const syncRuntimeJointPanelRobotRef = useRef(syncRuntimeJointPanelRobot);
  const emitRuntimeSelectionChangeRef = useRef(emitRuntimeSelectionChange);
  const emitRuntimeJointPreviewRef = useRef(emitRuntimeJointPreview);
  const emitRuntimeJointAnglesChangeRef = useRef(emitRuntimeJointAnglesChange);
  const applyUsdRuntimeLinkOverridesRef = useRef(applyUsdRuntimeLinkOverrides);
  const rebuildRuntimeMeshIndexRef = useRef(rebuildRuntimeMeshIndex);
  const onRobotDataResolvedRef = useRef(onRobotDataResolved);
  const onRuntimeActiveJointChangeRef = useRef(onRuntimeActiveJointChange);
  const onRuntimeRobotResolvedRef = useRef(onRuntimeRobotResolved);
  const currentStageSourcePath = useMemo(
    () => toVirtualUsdPath(sourceFile.name),
    [sourceFile.name],
  );
  const stageOpenLoadScopeKey = useMemo(
    () => buildPreparedUsdStageOpenCacheKey(sourceFile, availableFiles, assets),
    [assets, availableFiles, sourceFile],
  );
  const shouldPrepareStageOpenInline = useMemo(
    () => hasBlobBackedLargeUsdaInStageScope(sourceFile, availableFiles),
    [availableFiles, sourceFile],
  );

  useEffect(() => {
    refreshRuntimeDecorationsRef.current = refreshRuntimeDecorations;
  }, [refreshRuntimeDecorations]);

  useEffect(() => {
    return () => {
      clearScheduledRuntimeDecorationRefresh();
      clearScheduledRuntimeJointPreview();
    };
  }, [clearScheduledRuntimeDecorationRefresh, clearScheduledRuntimeJointPreview]);

  useEffect(() => {
    syncRuntimeJointPanelRobotRef.current = syncRuntimeJointPanelRobot;
  }, [syncRuntimeJointPanelRobot]);

  useEffect(() => {
    emitRuntimeSelectionChangeRef.current = emitRuntimeSelectionChange;
  }, [emitRuntimeSelectionChange]);

  useEffect(() => {
    emitRuntimeJointPreviewRef.current = emitRuntimeJointPreview;
  }, [emitRuntimeJointPreview]);

  useEffect(() => {
    emitRuntimeJointAnglesChangeRef.current = emitRuntimeJointAnglesChange;
  }, [emitRuntimeJointAnglesChange]);

  useEffect(() => {
    applyUsdRuntimeLinkOverridesRef.current = applyUsdRuntimeLinkOverrides;
  }, [applyUsdRuntimeLinkOverrides]);

  useEffect(() => {
    rebuildRuntimeMeshIndexRef.current = rebuildRuntimeMeshIndex;
  }, [rebuildRuntimeMeshIndex]);

  useEffect(() => {
    onRobotDataResolvedRef.current = onRobotDataResolved;
  }, [onRobotDataResolved]);

  useEffect(() => {
    onRuntimeActiveJointChangeRef.current = onRuntimeActiveJointChange;
  }, [onRuntimeActiveJointChange]);

  useEffect(() => {
    onRuntimeRobotResolvedRef.current = onRuntimeRobotResolved;
  }, [onRuntimeRobotResolved]);

  const applyResolvedRobotData = useCallback(
    (
      resolvedRobotData: ViewerRobotDataResolution,
      authoredRobotData: ViewerRobotDataResolution | null | undefined = resolvedRobotData,
    ) => {
      resolvedRobotDataRef.current = resolvedRobotData;
      jointAxesResolutionRef.current = createUsdJointAxesDisplayResolution(
        resolvedRobotData,
        authoredRobotData,
      );
      baselineRobotLinksRef.current = structuredClone(resolvedRobotData.robotData.links);
      rebuildRuntimeMeshIndexRef.current();
      markUsdHoverRaycastDirty(hoverNeedsRaycastRef, invalidate);

      onRobotDataResolvedRef.current?.({
        ...resolvedRobotData,
        usdSceneSnapshot: resolvedRobotData.usdSceneSnapshot ?? null,
      });

      syncRuntimeJointPanelRobotRef.current();
      emitRuntimeJointAnglesChangeRef.current();
      refreshRuntimeDecorationsRef.current();

      return resolvedRobotData;
    },
    [invalidate],
  );

  const publishResolvedRobotData = useCallback(
    (options: { allowWarmup?: boolean } = {}) => {
      const renderInterface = renderInterfaceRef.current;
      if (!renderInterface) {
        return null;
      }

      const { snapshot, resolution: initialRobotResolution } = resolveUsdSceneRobotResolution({
        renderInterface,
        driver: driverRef.current,
        stageSourcePath: currentStageSourcePath,
        fileName: sourceFile.name,
        allowWarmup: options.allowWarmup ?? false,
      });

      const usdSceneSnapshot = snapshot;
      const resolvedRobotData =
        hydrateUsdViewerRobotResolutionFromRuntime(
          initialRobotResolution,
          usdSceneSnapshot,
          renderInterface,
        ) || initialRobotResolution;

      return applyResolvedRobotData(
        {
          ...resolvedRobotData,
          usdSceneSnapshot,
        },
        initialRobotResolution,
      );
    },
    [applyResolvedRobotData, currentStageSourcePath, sourceFile.name],
  );

  const emitRuntimeHoverState = useCallback(
    (nextState: URDFViewerProps['hoveredSelection']) => {
      if (areSelectionStatesEqual(lastRuntimeHoverRef.current, nextState)) {
        return;
      }

      lastRuntimeHoverRef.current = {
        type: nextState?.type ?? null,
        id: nextState?.id ?? null,
        subType: nextState?.subType,
        objectIndex: nextState?.objectIndex,
        helperKind: nextState?.helperKind,
      };
      onHover?.(
        nextState?.type ?? null,
        nextState?.id ?? null,
        nextState?.subType,
        nextState?.objectIndex,
        nextState?.helperKind,
      );
    },
    [onHover],
  );

  const clearRuntimeHover = useCallback(() => {
    emitRuntimeHoverState({
      type: null,
      id: null,
      subType: undefined,
      objectIndex: undefined,
      helperKind: undefined,
    });
  }, [emitRuntimeHoverState]);

  const commitRuntimeHoverTarget = useCallback(
    (pickedTarget: RuntimeInteractionTarget | null) => {
      if (!pickedTarget) {
        clearRuntimeHover();
        return;
      }

      if (pickedTarget.kind === 'helper') {
        emitRuntimeHoverState({
          type: pickedTarget.selection.type,
          id: pickedTarget.selection.id,
          subType: undefined,
          objectIndex: undefined,
          helperKind: pickedTarget.selection.helperKind,
        });
        return;
      }

      const meta = pickedTarget.meta;
      const resolvedRobotData = resolvedRobotDataRef.current;
      const linkId = resolvedRobotData?.linkIdByPath[meta.linkPath] ?? null;
      if (!linkId) {
        clearRuntimeHover();
        return;
      }

      emitRuntimeHoverState({
        type: 'link',
        id: linkId,
        subType: meta.role,
        objectIndex: meta.objectIndex,
      });
    },
    [clearRuntimeHover, emitRuntimeHoverState],
  );

  const processRuntimeHoverAtLocalPoint = useCallback(
    (localX: number, localY: number, buttons = hoverPointerButtonsRef.current) => {
      if (
        !activeRef.current ||
        !interactionPolicy.enableContinuousHover ||
        !hoverSelectionEnabled ||
        !onHover
      ) {
        return;
      }

      const isDragging =
        (linkRotationControllerRef.current as { dragging?: boolean }).dragging === true;
      if (buttons !== 0) {
        clearRuntimeHover();
        return;
      }

      if (justSelectedRef?.current === true || isDragging) {
        return;
      }

      hoverNeedsRaycastRef.current = false;
      commitRuntimeHoverTarget(pickRuntimeInteractionTargetAtLocalPoint(localX, localY));
    },
    [
      clearRuntimeHover,
      commitRuntimeHoverTarget,
      hoverSelectionEnabled,
      interactionPolicy.enableContinuousHover,
      onHover,
      pickRuntimeInteractionTargetAtLocalPoint,
      justSelectedRef,
    ],
  );

  useEffect(() => {
    if (active) {
      return;
    }

    hoverCameraMotionPendingRef.current = false;
    setIsDragging?.(false);
    onTransformPending?.(false);
    clearRuntimeHover();
  }, [active, clearRuntimeHover, onTransformPending, setIsDragging]);

  const emitRuntimeInteractionSelection = useCallback(
    (pickedTarget: RuntimeInteractionTarget | null) => {
      if (!pickedTarget) {
        return;
      }

      armSelectionMissGuard(justSelectedRef);

      if (pickedTarget.kind === 'helper') {
        const nextSelection: URDFViewerProps['selection'] = {
          type: pickedTarget.selection.type,
          id: pickedTarget.selection.id,
          helperKind: pickedTarget.selection.helperKind,
        };

        lastRuntimeSelectionRef.current = nextSelection;
        onRuntimeSelectionChange?.(
          pickedTarget.selection.type,
          pickedTarget.selection.id,
          undefined,
          pickedTarget.selection.helperKind,
        );
        markUsdHoverRaycastDirty(hoverNeedsRaycastRef, invalidate);
        return;
      }

      const pickedMeshMeta = pickedTarget.meta;
      if (pickedMeshMeta.role === 'collision' && !Number.isInteger(pickedMeshMeta.objectIndex)) {
        return;
      }

      const resolvedRobotData = resolvedRobotDataRef.current;
      const linkId = resolvedRobotData?.linkIdByPath[pickedMeshMeta.linkPath] ?? null;
      if (!linkId) {
        return;
      }

      const nextSelection: URDFViewerProps['selection'] = {
        type: 'link',
        id: linkId,
        subType: pickedMeshMeta.role,
        objectIndex: pickedMeshMeta.objectIndex,
      };

      lastRuntimeSelectionRef.current = nextSelection;
      onRuntimeSelectionChange?.('link', linkId, pickedMeshMeta.role);
      onMeshSelect?.(linkId, null, pickedMeshMeta.objectIndex, pickedMeshMeta.role);
      markUsdHoverRaycastDirty(hoverNeedsRaycastRef, invalidate);
    },
    [invalidate, justSelectedRef, onMeshSelect, onRuntimeSelectionChange],
  );

  useEffect(() => {
    syncUsdHighlights();
    return () => {
      revertUsdHighlights();
    };
  }, [revertUsdHighlights, syncUsdHighlights]);

  useEffect(() => {
    const domElement = gl.domElement;
    if (!domElement) return;

    const handlePointerDownCapture = (event: PointerEvent) => {
      setUsdHoverPointerState(
        {
          hoverPointerLocalRef,
          hoverPointerInsideRef,
          hoverNeedsRaycastRef,
          hoverPointerButtonsRef,
        },
        { x: event.offsetX, y: event.offsetY },
        invalidate,
        event.buttons,
      );
      const pickedTarget = pickRuntimeInteractionTargetAtPointer(event);
      lastPointerDownMeshMetaRef.current =
        pickedTarget?.kind === 'geometry' ? pickedTarget.meta : null;
      if (pickedTarget?.kind === 'helper') {
        event.stopPropagation();
      }
      if (pickedTarget) {
        armSelectionMissGuard(justSelectedRef);
      } else {
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
      }
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (!interactionPolicy.enableMeshSelection || event.button !== 0) {
        return;
      }

      emitRuntimeInteractionSelection(pickRuntimeInteractionTargetAtPointer(event));
    };
    const clearPointerDownMeta = () => {
      lastPointerDownMeshMetaRef.current = null;
    };
    const handlePointerUp = (event: PointerEvent) => {
      setUsdHoverPointerButtons(hoverPointerButtonsRef, event.buttons, invalidate);
      scheduleSelectionMissGuardReset({
        justSelectedRef,
        timerRef: selectionResetTimerRef,
        onReset: () => {
          markUsdHoverRaycastDirty(hoverNeedsRaycastRef, invalidate);
        },
      });
      clearPointerDownMeta();
    };

    domElement.addEventListener('pointerdown', handlePointerDownCapture, true);
    domElement.addEventListener('mousedown', handleMouseDown);
    domElement.addEventListener('pointerleave', clearPointerDownMeta);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      domElement.removeEventListener('pointerdown', handlePointerDownCapture, true);
      domElement.removeEventListener('mousedown', handleMouseDown);
      domElement.removeEventListener('pointerleave', clearPointerDownMeta);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      clearSelectionMissGuardTimer(selectionResetTimerRef);
      clearPointerDownMeta();
    };
  }, [
    emitRuntimeInteractionSelection,
    gl.domElement,
    interactionPolicy.enableMeshSelection,
    invalidate,
    justSelectedRef,
    pickRuntimeInteractionTargetAtPointer,
  ]);

  useEffect(() => {
    const domElement = gl.domElement;
    if (!domElement) return;
    const updatePointer = (
      localX: number,
      localY: number,
      buttons = hoverPointerButtonsRef.current,
    ) => {
      setUsdHoverPointerState(
        {
          hoverPointerLocalRef,
          hoverPointerInsideRef,
          hoverNeedsRaycastRef,
          hoverPointerButtonsRef,
        },
        { x: localX, y: localY },
        invalidate,
        buttons,
      );
    };

    const handlePointerEnter = (event: PointerEvent) => {
      updatePointer(event.offsetX, event.offsetY, event.buttons);
      processRuntimeHoverAtLocalPoint(event.offsetX, event.offsetY, event.buttons);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (
        shouldDisarmSelectionMissGuardOnPointerMove({
          justSelected: justSelectedRef?.current === true,
          pointerButtons: event.buttons,
          dragging: (linkRotationControllerRef.current as { dragging?: boolean }).dragging === true,
          hasPendingSelection: false,
          hasResetTimer: selectionResetTimerRef.current !== null,
        })
      ) {
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
      }
      updatePointer(event.offsetX, event.offsetY, event.buttons);
      processRuntimeHoverAtLocalPoint(event.offsetX, event.offsetY, event.buttons);
    };
    const handlePointerLeave = () => {
      hoverCameraMotionPendingRef.current = false;
      clearUsdHoverPointerState(
        {
          hoverPointerLocalRef,
          hoverPointerInsideRef,
          hoverNeedsRaycastRef,
          hoverPointerButtonsRef,
        },
        invalidate,
      );
      clearRuntimeHover();
    };

    domElement.addEventListener('pointerenter', handlePointerEnter);
    domElement.addEventListener('pointermove', handlePointerMove);
    domElement.addEventListener('pointerleave', handlePointerLeave);

    if (!hoverSelectionEnabled) {
      handlePointerLeave();
    }

    return () => {
      domElement.removeEventListener('pointerenter', handlePointerEnter);
      domElement.removeEventListener('pointermove', handlePointerMove);
      domElement.removeEventListener('pointerleave', handlePointerLeave);
      handlePointerLeave();
    };
  }, [
    clearRuntimeHover,
    gl.domElement,
    hoverSelectionEnabled,
    invalidate,
    processRuntimeHoverAtLocalPoint,
  ]);

  useEffect(() => {
    if (!controls) return;

    const runtimeWindow = getRuntimeWindow();
    const currentLoadToken = loadTokenRef.current + 1;
    loadTokenRef.current = currentLoadToken;
    let disposeAutoFrame = () => {};

    let disposed = false;
    const isCurrentLoadActive = () => !disposed && loadTokenRef.current === currentLoadToken;

    pendingCameraFrameRef.current = null;
    stopUsdCameraFrameAnimation();
    setIsLoading(true);
    setErrorMessage(null);
    setLoadingProgress({
      phase: 'checking-path',
      progressMode: 'indeterminate',
      progressPercent: null,
      message: null,
      loadedCount: null,
      totalCount: null,
    });
    emitDocumentLoadEvent(
      normalizeLoadingProgress<ViewerDocumentLoadEvent>({
        status: 'loading',
        phase: 'checking-path',
        progressPercent: null,
        message: null,
        loadedCount: null,
        totalCount: null,
      }),
    );
    setVisibleStagePath(null);

    const clearCurrentStage = () => {
      resolvedRobotDataRef.current = null;
      jointAxesResolutionRef.current = null;
      baselineRobotLinksRef.current = null;
      clearScheduledUsdGroundAlignmentPasses();
      collisionMeshObjectIndexByMeshIdRef.current.clear();
      previousCollisionCountByLinkPathRef.current.clear();
      meshMetaByObjectRef.current.clear();
      meshesByLinkKeyRef.current.clear();
      pickMeshesRef.current = [];
      pickMeshesByRoleRef.current = { visual: [], collision: [] };
      helperTargetsRef.current = [];
      baseLocalMatrixByMeshRef.current = new WeakMap();
      gizmoTargetsRef.current = [];
      gizmoTargetsCacheKeyRef.current = '';
      gizmoTargetsUpdatedAtRef.current = 0;
      clearScheduledRuntimeJointPreview();
      revertUsdHighlights();
      lastRuntimeSelectionRef.current = {
        type: null,
        id: null,
        subType: undefined,
        objectIndex: undefined,
        helperKind: undefined,
      };
      lastPointerDownMeshMetaRef.current = null;
      lastRuntimeJointAnglesRef.current = {};
      lastRuntimeHoverRef.current = {
        type: null,
        id: null,
        subType: undefined,
        objectIndex: undefined,
        helperKind: undefined,
      };
      hoverCameraMotionPendingRef.current = false;
      onRuntimeActiveJointChangeRef.current?.(null);
      clearUsdHoverPointerState({
        hoverPointerLocalRef,
        hoverPointerInsideRef,
        hoverNeedsRaycastRef,
        hoverPointerButtonsRef,
      });
      onHover?.(null, null);
      onRuntimeRobotResolvedRef.current?.(null);
      linkAxesControllerRef.current.clear(rootGroup);
      jointAxesControllerRef.current.clear(rootGroup);
      linkDynamicsControllerRef.current.clear(rootGroup);
      linkRotationControllerRef.current.setOnSelectionChanged(null);
      linkRotationControllerRef.current.attach(null, null, null);
      linkRotationControllerRef.current.setPickSubType(null);
      linkRotationControllerRef.current.clear();
      linkRotationControllerRef.current.setEnabled(false);

      const runtime = runtimeRef.current;
      if (runtime) {
        disposeUsdDriver(runtime, driverRef.current);
        driverRef.current = null;
        const activeRenderInterface = renderInterfaceRef.current ?? runtimeWindow.renderInterface;
        activeRenderInterface?.dispose?.();
        renderInterfaceRef.current = null;
        disposeUsdRootChildren(rootGroup);
        runtime.usdFsHelper.clearStageFiles(rootGroup);
      } else {
        const activeRenderInterface = renderInterfaceRef.current ?? runtimeWindow.renderInterface;
        activeRenderInterface?.dispose?.();
        disposeUsdRootChildren(rootGroup);
        rootGroup.clear();
      }

      rootGroup.position.set(0, 0, 0);
      rootGroup.rotation.set(0, 0, 0);
      rootGroup.scale.set(1, 1, 1);
      rootGroup.updateMatrixWorld(true);

      if (runtimeWindow.usdRoot === rootGroup) {
        runtimeWindow.usdStage = undefined;
        runtimeWindow.driver = undefined;
        runtimeWindow.renderInterface = undefined;
        runtimeWindow.exportLoadedStageSnapshot = undefined;
        runtimeWindow.usdRoot = undefined;
      }

      pendingCameraFrameRef.current = null;
      stopUsdCameraFrameAnimation();
    };

    const loadUsdStageIntoScene = async () => {
      const isActive = isCurrentLoadActive;
      const stagePreparationMode = shouldPrepareStageOpenInline ? 'main-thread' : 'worker';
      const preparedStageOpenDataPromise = (
        shouldPrepareStageOpenInline
          ? loadPreparedUsdStageOpenDataInline(sourceFile, availableFiles, assets)
          : loadPreparedUsdStageOpenDataFromWorker(sourceFile, availableFiles, assets)
      ).catch((error) => {
        throw failFastInDev(
          `UsdWasmStage:prepareUsdStageOpen:${stagePreparationMode}`,
          new Error(`USD stage preparation failed for "${sourceFile.name}".`, { cause: error }),
        );
      });
      const runtimePromise = ensureUsdWasmRuntime();
      void runtimePromise.catch((error) => {
        scheduleFailFastInDev(
          'UsdWasmStage:ensureUsdWasmRuntime',
          new Error(`Failed to initialize USD runtime for "${sourceFile.name}".`, { cause: error }),
        );
      });

      // Let React commit the loading HUD before the next USD parse blocks the main thread.
      await new Promise<void>((resolve) => {
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
          resolve();
          return;
        }
        window.requestAnimationFrame(() => resolve());
      });
      if (!isActive()) return;

      clearCurrentStage();
      runtimeWindow.camera = camera;
      runtimeWindow._controls = controls as ViewerControls;
      runtimeWindow.scene = scene;
      runtimeWindow.usdRoot = rootGroup;

      try {
        const runtime = await trackUsdStageLoadStep({
          runtimeWindow,
          sourceFileName: sourceFile.name,
          step: 'ensure-runtime',
          pendingDetail: null,
          run: async () => await runtimePromise,
        });
        if (!isActive()) return;

        runtimeRef.current = runtime;
        runtimeWindow.USD = runtime.USD;

        let preparedStageOpenData = await trackUsdStageLoadStep({
          runtimeWindow,
          sourceFileName: sourceFile.name,
          step: 'prepare-stage-open-data',
          pendingDetail: {
            stagePreparationMode,
            availableFileCount: availableFiles.length,
          },
          run: async () => await preparedStageOpenDataPromise,
          resolveDetail: (result) => ({
            stagePreparationMode,
            availableFileCount: availableFiles.length,
            preloadFileCount: result.preloadFiles.length,
            criticalDependencyCount: result.criticalDependencyPaths.length,
            stageSourcePath: result.stageSourcePath,
          }),
        });
        if (!isActive()) return;

        const stageSourcePath = preparedStageOpenData.stageSourcePath;
        const preparedRootStageFile = preparedStageOpenData.preloadFiles.find(
          (entry) => entry.path === stageSourcePath,
        );
        if (
          !preparedRootStageFile ||
          (!preparedRootStageFile.blob &&
            !normalizePreparedUsdPreloadBytes(preparedRootStageFile.bytes))
        ) {
          throw failFastInDev(
            `UsdWasmStage:prepareUsdStageOpen:${stagePreparationMode}`,
            new Error(
              `USD stage preparation returned no root stage payload for "${sourceFile.name}".`,
            ),
          );
        }

        await trackUsdStageLoadStep({
          runtimeWindow,
          sourceFileName: sourceFile.name,
          step: 'preload-stage-dependencies',
          pendingDetail: {
            stageSourcePath,
            preloadFileCount: preparedStageOpenData.preloadFiles.length,
          },
          run: async () => {
            await preloadUsdDependencies(
              runtime,
              stageSourcePath,
              preparedStageOpenData.preloadFiles,
              isActive,
            );
          },
        });
        await trackUsdStageLoadStep({
          runtimeWindow,
          sourceFileName: sourceFile.name,
          step: 'ensure-critical-dependencies',
          pendingDetail: {
            stageSourcePath,
            criticalDependencyCount: preparedStageOpenData.criticalDependencyPaths.length,
          },
          run: async () => {
            await ensureCriticalUsdDependenciesLoaded(
              runtime,
              stageSourcePath,
              preparedStageOpenData.criticalDependencyPaths,
              preparedStageOpenData.preloadFiles,
              isActive,
            );
          },
        });
        if (!isActive()) return;

        const params = createEmbeddedUsdViewerLoadParams(runtime.threadCount, {
          dependenciesPreloadedToVirtualFs: true,
        });

        const loadState = await trackUsdStageLoadStep({
          runtimeWindow,
          sourceFileName: sourceFile.name,
          step: 'load-usd-stage',
          pendingDetail: {
            stageSourcePath,
            displayName: sourceFile.name.split('/').pop() || sourceFile.name,
          },
          run: async () =>
            await runtime.loadUsdStage({
              USD: runtime.USD,
              usdFsHelper: runtime.usdFsHelper,
              messageLog: null,
              progressBar: null,
              progressLabel: null,
              showLoadUi: false,
              readStageMetadata: true,
              loadCollisionPrims: true,
              loadVisualPrims: true,
              loadPassLabel: 'workspace',
              params,
              displayName: sourceFile.name.split('/').pop() || sourceFile.name,
              pathToLoad: stageSourcePath,
              isLoadActive: isActive,
              debugFileHandling: false,
              onResolvedFilename: () => {},
              applyMeshFilters: () => {
                const activeRenderInterface = runtimeWindow.renderInterface;
                if (!activeRenderInterface) return;
                runtime.applyMeshVisibilityFilters(
                  activeRenderInterface,
                  visibilityRef.current.showVisual,
                  visibilityRef.current.showCollision,
                  visibilityRef.current.showCollisionAlwaysOnTop,
                );
              },
              rebuildLinkAxes: () => {},
              renderFrame: () => invalidate(),
              onProgress: (nextProgress) => {
                if (!isActive()) return;
                const normalizedProgress =
                  nextProgress.phase === 'ready'
                    ? normalizeLoadingProgress<UsdLoadingProgress>({
                        phase: 'finalizing-scene',
                        progressMode: 'indeterminate',
                        progressPercent: null,
                        message: nextProgress.message ?? null,
                        loadedCount: null,
                        totalCount: null,
                      })
                    : normalizeLoadingProgress<UsdLoadingProgress>({
                        phase: nextProgress.phase,
                        progressMode: nextProgress.progressMode ?? null,
                        progressPercent:
                          nextProgress.progressPercent !== undefined
                            ? (nextProgress.progressPercent ?? null)
                            : null,
                        message:
                          nextProgress.message !== undefined
                            ? (nextProgress.message ?? null)
                            : null,
                        loadedCount:
                          nextProgress.loadedCount !== undefined
                            ? (nextProgress.loadedCount ?? null)
                            : null,
                        totalCount:
                          nextProgress.totalCount !== undefined
                            ? (nextProgress.totalCount ?? null)
                            : null,
                      });
                setLoadingProgress(normalizedProgress);
                emitDocumentLoadEvent(
                  normalizeLoadingProgress<ViewerDocumentLoadEvent>({
                    status: 'loading',
                    ...normalizedProgress,
                  }),
                );
              },
            }),
          resolveDetail: (result) => ({
            stageSourcePath,
            drawFailed: Boolean(result?.drawFailed),
            hasDriver: Boolean(result?.driver),
            drawFailureReason: result?.drawFailureReason ?? null,
          }),
        });
        driverRef.current = loadState?.driver ?? null;
        renderInterfaceRef.current = runtimeWindow.renderInterface;
        if (!isActive()) {
          clearCurrentStage();
          return;
        }
        if (!loadState?.driver) {
          throw failFastInDev(
            'UsdWasmStage:loadUsdStageDriver',
            new Error(
              `USD stage loader did not produce a render driver for "${sourceFile.name}" (${stageSourcePath}).`,
            ),
          );
        }
        if (loadState.drawFailed) {
          const reason = String(loadState.drawFailureReason || '').trim();
          throw failFastInDev(
            'UsdWasmStage:loadUsdStageInitialDraw',
            new Error(
              reason
                ? `USD stage initial draw failed for "${sourceFile.name}" (${stageSourcePath}): ${reason}`
                : `USD stage initial draw failed for "${sourceFile.name}" (${stageSourcePath}).`,
            ),
          );
        }
        runtimeWindow.exportLoadedStageSnapshot = (options = {}) => {
          const activeRenderInterface = renderInterfaceRef.current ?? runtimeWindow.renderInterface;
          if (
            !activeRenderInterface ||
            typeof activeRenderInterface.exportLoadedStageSnapshot !== 'function'
          ) {
            return Promise.resolve({ ok: false, error: 'export-unavailable' });
          }

          return activeRenderInterface.exportLoadedStageSnapshot({
            stageSourcePath,
            ...options,
          });
        };
        runtime.applyMeshVisibilityFilters(
          runtimeWindow.renderInterface,
          visibilityRef.current.showVisual,
          visibilityRef.current.showCollision,
          visibilityRef.current.showCollisionAlwaysOnTop,
        );
        rebuildRuntimeMeshIndexRef.current();
        markUsdHoverRaycastDirty(hoverNeedsRaycastRef, invalidate);
        alignUsdRootToGround(captureUsdGroundBaseline());
        if (shouldSettleUsdGroundAlignment) {
          scheduleUsdGroundAlignmentSettlePasses(stageSourcePath);
        }

        const renderInterface = runtimeWindow.renderInterface as
          | (ViewerRuntimeInterface & Record<string, unknown>)
          | undefined;
        const linkRotationController = linkRotationControllerRef.current;
        const linkDynamicsController = linkDynamicsControllerRef.current;
        const activeJointRotationRuntime = jointRotationRuntimeRef.current;

        if (renderInterface) {
          linkRotationController.attach(gl.domElement, camera, controls as ViewerControls);
          linkRotationController.setOnSelectionChanged(
            (linkPath: string | null, jointInfo?: UsdStageJointInfoLike | null) => {
              emitRuntimeSelectionChangeRef.current(linkPath);

              if (linkRotationController.dragging) {
                scheduleRuntimeJointPreview(linkPath, jointInfo);
                setIsDragging?.(true);
                clearRuntimeHover();
                return;
              }

              clearScheduledRuntimeJointPreview();
              emitRuntimeJointPreviewRef.current(linkPath, jointInfo);
              setIsDragging?.(false);
              markUsdHoverRaycastDirty(hoverNeedsRaycastRef, invalidate);
              if (!linkRotationController.dragging) {
                emitRuntimeJointAnglesChangeRef.current();
              }
            },
          );
          linkRotationController.setPickSubType(activeJointRotationRuntime.pickSubType);
          linkRotationController.setEnabled(
            activeRef.current && activeJointRotationRuntime.enabled,
          );
          linkRotationController.setStageSourcePath(stageSourcePath);
          linkRotationController.setRenderInterface(renderInterface);
          linkRotationController.prewarmInteractivePoseCaches();

          linkDynamicsController.setStageSourcePath(stageSourcePath);
          linkDynamicsController.setCurrentLinkFrameResolver((linkPath) =>
            linkRotationController.getCurrentLinkFrameMatrix(linkPath),
          );

          // Some large USD robots expose complete runtime link transforms a beat later than
          // the first scene snapshot. Republish once the warmups settle so exports use the
          // stabilized RobotData instead of the speculative initial adaptation.
          scheduleUsdResolvedRobotRepublishAfterWarmup({
            isActive,
            requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
            startWarmups: () => [
              // Keep each warmup isolated so one synchronous failure does not skip
              // the rest of the warmup pipeline and force a stale fallback publish.
              Promise.resolve().then(() => linkRotationController.prewarmJointCatalog()),
              Promise.resolve().then(() =>
                linkDynamicsController.prewarmCatalogForInteractive(renderInterface),
              ),
            ],
            onSettled: () => {
              publishResolvedRobotData({ allowWarmup: true });
              syncRuntimeJointPanelRobotRef.current();
              emitRuntimeJointAnglesChangeRef.current();
              refreshRuntimeDecorationsRef.current();
            },
          });
        }

        if (renderInterface) {
          // Publish the first interactive RobotData from the warmed runtime path
          // immediately after the stage opens so a background bootstrap worker
          // does not block the first visible frame.
          await trackUsdStageLoadStep({
            runtimeWindow,
            sourceFileName: sourceFile.name,
            step: 'resolve-runtime-robot-data',
            pendingDetail: {
              resolutionSource: 'interactive-runtime',
            },
            run: async () => publishResolvedRobotData({ allowWarmup: true }),
            resolveDetail: (result) => ({
              resolutionSource: 'interactive-runtime',
              stageSourcePath: result?.stageSourcePath ?? stageSourcePath,
              linkCount: Object.keys(result?.robotData.links || {}).length,
              jointCount: Object.keys(result?.robotData.joints || {}).length,
              metadataSource: result?.usdSceneSnapshot?.robotMetadataSnapshot?.source ?? null,
              ...(getRuntimeWarmupDebugDetail(renderInterface) ?? {}),
            }),
          });
        }

        syncRuntimeJointPanelRobotRef.current();
        emitRuntimeJointAnglesChangeRef.current();
        refreshRuntimeDecorationsRef.current();

        // Release the retained placeholder once the stage, runtime meshes,
        // and first RobotData publish are ready. Camera auto-frame can settle
        // afterwards, but it must not block the initial stage reveal.
        setLoadingProgress(
          normalizeLoadingProgress<UsdLoadingProgress>({
            phase: 'ready',
            progressMode: 'percent',
            progressPercent: 100,
            message: null,
            loadedCount: null,
            totalCount: null,
          }),
        );
        setVisibleStagePath(sourceFile.name);
        setIsLoading(false);
        emitDocumentLoadEvent(
          normalizeLoadingProgress<ViewerDocumentLoadEvent>({
            status: 'ready',
            phase: 'ready',
            progressMode: 'percent',
            progressPercent: 100,
            message: null,
            loadedCount: null,
            totalCount: null,
          }),
        );
        recordUsdStageLoadDebug(runtimeWindow, {
          sourceFileName: sourceFile.name,
          step: 'ready',
          status: 'resolved',
          timestamp: Date.now(),
          detail: {
            visibleStagePath: sourceFile.name,
            rootChildrenCount: rootGroup.children.length,
            ...(getRuntimeWarmupDebugDetail(renderInterface) ?? {}),
          },
        });
        invalidate();

        disposeAutoFrame = scheduleStabilizedAutoFrame({
          sample: sampleUsdAutoFrameBounds,
          applyFrame: ({ state }) => applyUsdCameraFrame(state),
          // Hidden handoff loads still need to settle so the parent viewer can
          // refine the first camera frame after the stage becomes visible.
          isActive: () => isActive(),
          delays: [0, 96, 224],
          onSettled: () => {
            if (!isActive()) return;
            invalidate();
          },
        });
      } catch (error) {
        clearCurrentStage();
        if (!isActive()) return;
        console.error('Failed to load USD stage', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to load USD stage';
        recordUsdStageLoadDebug(runtimeWindow, {
          sourceFileName: sourceFile.name,
          step: 'load-failed',
          status: 'rejected',
          timestamp: Date.now(),
          detail: {
            error: errorMessage,
          },
        });
        setErrorMessage(errorMessage);
        setVisibleStagePath(null);
        setIsLoading(false);
        setLoadingProgress(null);
        emitDocumentLoadEvent({
          status: 'error',
          phase: null,
          progressPercent: null,
          message: null,
          loadedCount: null,
          totalCount: null,
          error: errorMessage,
        });
      }
    };

    void loadUsdStageIntoScene();

    return () => {
      disposed = true;
      disposeAutoFrame();
      clearCurrentStage();
    };
    // Intentionally exclude `active`: the handoff flips it after the first
    // stage is already loaded, and re-subscribing here would tear down the
    // ready USD runtime and start a second full parse.
  }, [camera, controls, gl, invalidate, rootGroup, scene, stageOpenLoadScopeKey]);

  useEffect(() => {
    if (
      !shouldSettleUsdGroundAlignment ||
      !activeRef.current ||
      isLoadingRef.current ||
      !visibleStagePathRef.current
    ) {
      return;
    }

    scheduleUsdGroundAlignmentSettlePasses(sourceFile.name);
  }, [
    groundPlaneOffset,
    scheduleUsdGroundAlignmentSettlePasses,
    shouldSettleUsdGroundAlignment,
    sourceFile.name,
  ]);

  useEffect(() => {
    if (!registerAutoFitGroundHandler) {
      return;
    }

    if (!active) {
      return;
    }

    registerAutoFitGroundHandler(() => {
      if (alignUsdRootToGround()) {
        invalidate();
      }
    });

    return () => {
      registerAutoFitGroundHandler(null);
    };
  }, [active, alignUsdRootToGround, invalidate, registerAutoFitGroundHandler]);

  useEffect(() => {
    refreshRuntimeDecorations();
  }, [refreshRuntimeDecorations]);

  useFrame((state, delta) => {
    void state;

    const orbitControls = controls as ViewerControls | null;
    if (
      activeRef.current &&
      isCameraFrameAnimatingRef.current &&
      cameraFrameFocusTargetRef.current &&
      cameraFramePositionTargetRef.current &&
      orbitControls?.target
    ) {
      const step = Math.min(1, 5 * delta);
      orbitControls.target.lerp(cameraFrameFocusTargetRef.current, step);
      camera.position.lerp(cameraFramePositionTargetRef.current, step);
      if (
        'updateProjectionMatrix' in camera &&
        typeof camera.updateProjectionMatrix === 'function'
      ) {
        camera.updateProjectionMatrix();
      }
      orbitControls.update?.();
      invalidate();

      if (
        camera.position.distanceTo(cameraFramePositionTargetRef.current) < 0.01 &&
        orbitControls.target.distanceTo(cameraFrameFocusTargetRef.current) < 0.01
      ) {
        stopUsdCameraFrameAnimation();
      }
    }

    if (
      activeRef.current &&
      interactionPolicy.enableContinuousHover &&
      hoverSelectionEnabled &&
      onHover
    ) {
      const pointer = hoverPointerLocalRef.current;
      const isDragging =
        (linkRotationControllerRef.current as { dragging?: boolean }).dragging === true;
      const cameraMoved =
        !camera.position.equals(lastHoverCameraPositionRef.current) ||
        !camera.quaternion.equals(lastHoverCameraQuaternionRef.current);

      if (cameraMoved) {
        lastHoverCameraPositionRef.current.copy(camera.position);
        lastHoverCameraQuaternionRef.current.copy(camera.quaternion);
      }

      const hoverCameraMotionState = updateUsdHoverCameraMotionState(hoverCameraMotionPendingRef, {
        cameraMoved,
        hoverPointerButtons: hoverPointerButtonsRef.current,
        dragging: isDragging,
      });
      if (hoverCameraMotionState.shouldMarkDirty) {
        markUsdHoverRaycastDirty(hoverNeedsRaycastRef);
      }

      const shouldProcessHover =
        !hoverCameraMotionState.shouldSuppressProcessing &&
        shouldProcessUsdHoverRaycast({
          hoverPointerInside: hoverPointerInsideRef.current,
          pointer,
          hoverNeedsRaycast: hoverNeedsRaycastRef.current,
          hoverPointerButtons: hoverPointerButtonsRef.current,
          justSelected: justSelectedRef?.current === true,
          dragging: isDragging,
        });

      if (!shouldProcessHover && hoverPointerButtonsRef.current !== 0) {
        clearRuntimeHover();
      }

      if (shouldProcessHover) {
        hoverNeedsRaycastRef.current = false;
        commitRuntimeHoverTarget(pickRuntimeInteractionTargetAtLocalPoint(pointer.x, pointer.y));
      }
    }

    const renderInterface = renderInterfaceRef.current;
    if (!renderInterface) return;

    let changed = false;
    const poseChanged = linkRotationControllerRef.current.apply(renderInterface) === true;
    if (poseChanged) {
      applyUsdRuntimeLinkOverridesRef.current();
      markUsdHoverRaycastDirty(hoverNeedsRaycastRef);
      changed = true;
    }

    if (showCenterOfMass || showInertia) {
      changed =
        linkDynamicsControllerRef.current.syncLinkDynamicsTransforms(renderInterface) === true ||
        changed;
    }

    if (changed) {
      if ((linkRotationControllerRef.current as { dragging?: boolean }).dragging !== true) {
        emitRuntimeJointAnglesChangeRef.current();
      }
      invalidate();
    }
  });

  return (
    <>
      {visibleStagePath === sourceFile.name ? <primitive object={rootGroup} /> : null}
      {!snapshotRenderActive && (
        <UsdCollisionTransformControls
          selection={selection}
          transformMode={transformMode}
          resolveTarget={resolveUsdCollisionTransformTarget}
          onTransformChange={handleUsdCollisionTransformPreview}
          onTransformEnd={handleUsdCollisionTransformEnd}
          onTransformPending={handleUsdCollisionTransformPending}
          setIsDragging={setIsDragging ?? (() => {})}
        />
      )}
      {isLoading && !onDocumentLoadEvent && (
        <Html fullscreen>
          <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-4">
            <ViewerLoadingHud
              title={loadingLabel}
              detail={loadingDetail}
              progress={loadingHudState.progress}
              progressMode={loadingHudState.progressMode}
              statusLabel={loadingHudState.statusLabel}
              stageLabel={loadingStageLabel}
              delayMs={0}
            />
          </div>
        </Html>
      )}
      {errorMessage && !isLoading && (
        <Html center>
          <div className="rounded bg-red-900/80 px-4 py-2 text-sm text-red-200">{errorMessage}</div>
        </Html>
      )}
    </>
  );
}
