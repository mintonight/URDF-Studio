/**
 * Shared 3D Components
 * Components for 3D rendering shared between Visualizer and URDFViewer
 */

// Mesh Renderers
export {
  STLRenderer,
  OBJRenderer,
  DAERenderer,
  GLTFRenderer,
  useLoadingManager,
} from './MeshRenderers';
export { MeshAssetNode } from './MeshAssetNode';
export { preloadManagedMeshAsset } from './meshAssetPreload';

// Scene Utilities
export {
  HoverInvalidator,
  CanvasResizeSync,
  SnapshotManager,
  DEFAULT_SNAPSHOT_CAPTURE_OPTIONS,
  SNAPSHOT_BACKGROUND_STYLES,
  SNAPSHOT_DOF_MODES,
  SNAPSHOT_DETAIL_LEVELS,
  SNAPSHOT_ENVIRONMENT_PRESETS,
  SNAPSHOT_GROUND_STYLES,
  SNAPSHOT_IMAGE_FORMATS,
  SNAPSHOT_IMAGE_QUALITY_MAX,
  SNAPSHOT_IMAGE_QUALITY_MIN,
  SNAPSHOT_IMAGE_QUALITY_STEP,
  SNAPSHOT_LONG_EDGE_INPUT_STEP,
  SNAPSHOT_MAX_LONG_EDGE_INPUT,
  SNAPSHOT_SHADOW_STYLES,
  normalizeSnapshotCaptureOptions,
  normalizeSnapshotImageQuality,
  normalizeSnapshotLongEdgePx,
  type SnapshotBackgroundStyle,
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
  type SnapshotDofMode,
  type SnapshotDetailLevel,
  type SnapshotEnvironmentPreset,
  type SnapshotGroundStyle,
  type SnapshotImageFormat,
  type SnapshotShadowStyle,
  NeutralStudioEnvironment,
  SceneLighting,
  GroundShadowPlane,
  ReferenceGrid,
  AdaptiveGroundPlane,
  SnapshotContactShadows,
  SnapshotExportLook,
  SceneCompileWarmup,
  INTERACTION_DPR_CAP,
  INTERACTION_RECOVERY_DELAY_MS,
  RESTING_DPR_CAP,
  resolveCanvasDpr,
  useAdaptiveInteractionQuality,
  useWorkspaceCanvasInteractionState,
  WorkspaceCanvasInteractionStateProvider,
  WorkspaceOrbitControls,
  LIGHTING_CONFIG,
  STUDIO_ENVIRONMENT_INTENSITY,
  WORKSPACE_CANVAS_BACKGROUND,
  WORKSPACE_DEFAULT_CAMERA_FOV,
  WORKSPACE_DEFAULT_CAMERA_POSITION,
  WORKSPACE_DEFAULT_CAMERA_UP,
} from './SceneUtilities';
export {
  UnifiedTransformControls,
  VISUALIZER_UNIFIED_GIZMO_SIZE,
} from './UnifiedTransformControls';
export { LinkIkTransformControls } from './LinkIkTransformControls';
export { LoadingHud } from './LoadingHud';
export {
  buildLoadingHudState,
  hasDeterminateLoadingCounts,
  normalizeLoadingProgress,
  resolveLoadingProgressMode,
  shouldUseIndeterminateStreamingMeshProgress,
} from './loadingHudState';

// Visualization Helpers
export * from './helpers';

export { WorkspaceCanvas } from './workspace';
export { resolveWorkspaceCanvasEnvironmentIntensity, useWorkspaceCanvasTheme } from './workspace';
export type { WorkspaceCanvasEnvironmentIntensityByTheme } from './workspace';

export { UsageGuide } from './UsageGuide';
export { ViewModeBadge } from './ViewModeBadge';
export { TransformConfirmOverlay } from './TransformConfirmOverlay';
export { TransformConfirmHtmlOverlay } from './TransformConfirmHtmlOverlay';
