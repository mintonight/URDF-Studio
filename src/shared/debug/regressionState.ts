import type {
  InteractionHelperKind,
  InteractionSelection,
  RobotFile,
  RobotState,
  UsdSceneSnapshot,
} from '@/types';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';

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

export interface AppRegressionHandlers {
  getAvailableFiles: () => RobotFile[];
  getSelectedFile: () => RobotFile | null;
  getUsdSceneSnapshot: (fileName: string) => UsdSceneSnapshot | null;
  getDocumentLoadState: () => {
    status: string;
    fileName?: string | null;
    format?: string | null;
    error?: string | null;
  } | null;
  getRobotState: () =>
    | (Pick<RobotState, 'name' | 'links' | 'joints' | 'rootLinkId'> & {
        selection?: InteractionSelection;
      })
    | null;
  getInteractionState?: () => {
    selection: InteractionSelection;
    hoveredSelection: InteractionSelection;
  } | null;
  getAssetDebugState?: () => {
    appAssetKeys: string[];
    preparedUsdCacheKeysByFile: Record<string, string[]>;
  };
  resetFixtureFiles?: () => void;
  seedFixtureFile?: (file: {
    name: string;
    content: string;
    format: RobotFile['format'];
    blobUrl?: string;
    addFileContent?: boolean;
  }) => { availableFileCount: number };
  loadRobotByName: (fileName: string) => Promise<{ loaded: boolean; selectedFile?: string | null }>;
}

interface ViewerControllerSnapshot {
  jointAngles: Record<string, number>;
  activeJoint: string | null;
  toolMode: string | null;
  highlightMode: HighlightMode;
  flags: Required<RegressionViewerFlags>;
}

export interface ViewerRegressionHandlers {
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

export interface RegressionViewerResourceScopeState {
  sourceFileName: string | null;
  sourceFilePath: string | null;
  assetKeys: string[];
  availableFileNames: string[];
  signature: string | null;
}

export const regressionDebugState: {
  appHandlers: AppRegressionHandlers | null;
  viewerHandlers: ViewerRegressionHandlers | null;
  viewerResourceScopeState: RegressionViewerResourceScopeState | null;
  runtimeRobot: RuntimeRobotObject | null;
  runtimeRevision: number;
  projectedInteractionTargetsProvider: (() => RegressionProjectedInteractionTarget[]) | null;
} = {
  appHandlers: null,
  viewerHandlers: null,
  viewerResourceScopeState: null,
  runtimeRobot: null,
  runtimeRevision: 0,
  projectedInteractionTargetsProvider: null,
};

export function setRegressionAppHandlers(handlers: AppRegressionHandlers | null): void {
  regressionDebugState.appHandlers = handlers;
}

export function setRegressionViewerHandlers(handlers: ViewerRegressionHandlers | null): void {
  regressionDebugState.viewerHandlers = handlers;
}

export function setRegressionViewerResourceScope(
  scope: RegressionViewerResourceScopeState | null,
): void {
  regressionDebugState.viewerResourceScopeState = scope;
}

export function setRegressionRuntimeRobot(robot: RuntimeRobotObject | null): void {
  regressionDebugState.runtimeRobot = robot;
  regressionDebugState.runtimeRevision += 1;
}

export function bumpRegressionRuntimeRevision(): void {
  regressionDebugState.runtimeRevision += 1;
}

export function setRegressionProjectedInteractionTargetsProvider(
  provider: (() => RegressionProjectedInteractionTarget[]) | null,
): void {
  regressionDebugState.projectedInteractionTargetsProvider = provider;
}
