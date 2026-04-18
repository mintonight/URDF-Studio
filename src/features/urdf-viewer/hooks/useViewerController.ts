import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelectionStore } from '@/store/selectionStore';
import { useJointInteractionPreviewStore } from '@/store';
import { alignObjectLowestPointToZ } from '@/shared/utils';
import { createJointPanelStore } from '@/shared/utils/jointPanelStore';
import type { JointPanelActiveJointOptions } from '@/shared/utils/jointPanelStore';
import {
  normalizeViewerJointAngleState,
  resolveViewerJointKey,
} from '@/shared/utils/jointPanelState';
import {
  setRegressionViewerHandlers,
  type RegressionViewerFlags,
} from '@/shared/debug/regressionBridge';
import { getJointType, isSingleDofJoint } from '../utils/jointTypes';
import { resolveActiveViewerJointKeyFromSelection } from '../utils/activeJointSelection';
import type {
  MeasureAnchorMode,
  MeasurePoseRepresentation,
  MeasureState,
  ToolMode,
  ViewerPaintOperation,
  ViewerPaintSelectionScope,
  ViewerPaintStatus,
  ViewerProps,
  ViewerHelperKind,
  ViewerJointMotionStateValue,
} from '../types';
import { resolveInitialJointControlState } from '../utils/jointControlState';
import { createEmptyMeasureState } from '../utils/measurements';
import { beginInitialGroundAlignment } from '../utils/robotPositioning';
import { createScopedToolModeState, resolveScopedToolModeState } from '../utils/scopedToolMode';
import { usePanelDrag } from './usePanelDrag';
import { useViewerSettings } from './useViewerSettings';
import {
  JointType,
  type InteractionSelection,
  type JointQuaternion,
  type RobotState,
} from '@/types';
import { resolveMimicJointAngleTargets } from '@/core/robot';
import { createClosedLoopMotionPreviewSession } from '@/shared/utils/robot/closedLoopMotionPreview';
import { unwrapContinuousJointAngle } from '@/shared/utils/continuousJointAngle';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';

type Selection = ViewerProps['selection'];
const JOINT_SYNC_EPSILON = 1e-6;
// App-wide preview consumers were removed from the layout path. Keep runtime
// previews local to the active viewer to avoid cross-app state churn while dragging.
const APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED = false;

function isSameJointAngle(left: number | undefined, right: number | undefined) {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return left === right;
  }

  return Math.abs(left - right) <= JOINT_SYNC_EPSILON;
}

function isSameJointQuaternion(
  left: ViewerJointMotionStateValue['quaternion'] | undefined,
  right: ViewerJointMotionStateValue['quaternion'] | undefined,
) {
  if (!left || !right) {
    return left === right;
  }

  return (
    isSameJointAngle(left.x, right.x) &&
    isSameJointAngle(left.y, right.y) &&
    isSameJointAngle(left.z, right.z) &&
    isSameJointAngle(left.w, right.w)
  );
}

function isSameJointMotion(
  left: ViewerJointMotionStateValue | undefined,
  right: ViewerJointMotionStateValue | undefined,
) {
  if (!left || !right) {
    return left === right;
  }

  return (
    isSameJointAngle(left.angle, right.angle) &&
    isSameJointQuaternion(left.quaternion, right.quaternion)
  );
}

type RuntimePoseJointQuaternionLike =
  | ViewerJointMotionStateValue['quaternion']
  | { x?: unknown; y?: unknown; z?: unknown; w?: unknown };

type RuntimePoseJointLike = {
  name?: string;
  angle?: number;
  jointValue?: number;
  quaternion?: RuntimePoseJointQuaternionLike;
};

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// Runtime joints may expose live THREE.Quaternion instances; keep solver state plain-data and cloneable.
function toJointQuaternionValue(
  quaternion: RuntimePoseJointQuaternionLike | null | undefined,
): JointQuaternion | null {
  if (!quaternion) {
    return null;
  }

  const x = toFiniteNumber(quaternion.x);
  const y = toFiniteNumber(quaternion.y);
  const z = toFiniteNumber(quaternion.z);
  const w = toFiniteNumber(quaternion.w);
  if (x === null || y === null || z === null || w === null) {
    return null;
  }

  return { x, y, z, w };
}

function toClosedLoopPreviewJoint(
  joint: RobotState['joints'][string],
): RobotState['joints'][string] {
  const normalizedQuaternion = toJointQuaternionValue(joint.quaternion);

  return {
    id: joint.id,
    name: joint.name,
    type: joint.type,
    parentLinkId: joint.parentLinkId,
    childLinkId: joint.childLinkId,
    origin: {
      xyz: { ...joint.origin.xyz },
      rpy: { ...joint.origin.rpy },
    },
    dynamics: { ...joint.dynamics },
    hardware: { ...joint.hardware },
    ...(joint.axis ? { axis: { ...joint.axis } } : {}),
    ...(joint.limit ? { limit: { ...joint.limit } } : {}),
    ...(joint.mimic ? { mimic: { ...joint.mimic } } : {}),
    ...(joint.calibration ? { calibration: { ...joint.calibration } } : {}),
    ...(joint.safetyController ? { safetyController: { ...joint.safetyController } } : {}),
    ...(typeof joint.referencePosition === 'number'
      ? { referencePosition: joint.referencePosition }
      : {}),
    ...(typeof joint.angle === 'number' ? { angle: joint.angle } : {}),
    ...(normalizedQuaternion ? { quaternion: normalizedQuaternion } : {}),
  };
}

function mergeClosedLoopRobotStateWithRuntimeJointPose(
  closedLoopRobotState: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null,
  runtimeJoints: Record<string, RuntimePoseJointLike> | null | undefined,
): Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'> | null {
  if (!closedLoopRobotState) {
    return null;
  }

  const nextClosedLoopRobotState: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > = {
    ...closedLoopRobotState,
    joints: Object.fromEntries(
      Object.entries(closedLoopRobotState.joints).map(([jointId, joint]) => [
        jointId,
        toClosedLoopPreviewJoint(joint),
      ]),
    ),
  };

  if (!runtimeJoints) {
    return nextClosedLoopRobotState;
  }

  Object.entries(runtimeJoints).forEach(([runtimeJointId, runtimeJoint]) => {
    const resolvedJointKey =
      resolveViewerJointKey(
        nextClosedLoopRobotState.joints,
        runtimeJoint?.name || runtimeJointId,
      ) ?? (runtimeJointId in nextClosedLoopRobotState.joints ? runtimeJointId : null);
    if (!resolvedJointKey) {
      return;
    }

    const baseJoint = nextClosedLoopRobotState.joints[resolvedJointKey];
    if (!baseJoint) {
      return;
    }

    const nextAngle = toFiniteNumber(runtimeJoint?.angle ?? runtimeJoint?.jointValue);
    const nextQuaternion = toJointQuaternionValue(runtimeJoint?.quaternion);
    const shouldUpdateAngle = nextAngle !== null && !isSameJointAngle(baseJoint.angle, nextAngle);
    const shouldUpdateQuaternion =
      Boolean(nextQuaternion) && !isSameJointQuaternion(baseJoint.quaternion, nextQuaternion);
    if (!shouldUpdateAngle && !shouldUpdateQuaternion) {
      return;
    }

    nextClosedLoopRobotState.joints[resolvedJointKey] = {
      ...baseJoint,
      ...(shouldUpdateAngle && nextAngle !== null ? { angle: nextAngle } : {}),
      ...(shouldUpdateQuaternion && nextQuaternion ? { quaternion: nextQuaternion } : {}),
    };
  });

  return nextClosedLoopRobotState;
}

function resolveRuntimeReportedJointAngle(joint: unknown, runtimeAngle: number): number {
  if (getJointType(joint) !== JointType.CONTINUOUS) {
    return runtimeAngle;
  }

  const referenceAngle = Number(
    (joint as { angle?: number; jointValue?: number } | null)?.angle ??
      (joint as { angle?: number; jointValue?: number } | null)?.jointValue,
  );

  if (!Number.isFinite(referenceAngle)) {
    return runtimeAngle;
  }

  return unwrapContinuousJointAngle(runtimeAngle, referenceAngle);
}

interface UseViewerControllerProps {
  onJointChange?: ViewerProps['onJointChange'];
  syncJointChangesToApp?: boolean;
  showJointPanel?: boolean;
  jointAngleState?: ViewerProps['jointAngleState'];
  jointMotionState?: Record<string, ViewerJointMotionStateValue>;
  onSelect?: ViewerProps['onSelect'];
  onMeshSelect?: ViewerProps['onMeshSelect'];
  onHover?: ViewerProps['onHover'];
  selection?: Selection;
  showVisual?: ViewerProps['showVisual'];
  setShowVisual?: ViewerProps['setShowVisual'];
  onTransformPendingChange?: ViewerProps['onTransformPendingChange'];
  groundPlaneOffset?: number;
  setGroundPlaneOffset?: (offset: number) => void;
  groundPlaneOffsetReadOnly?: boolean;
  active?: boolean;
  jointStateScopeKey?: string | null;
  defaultToolMode?: ToolMode;
  toolModeScopeKey?: string | null;
  closedLoopRobotState?: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
}

export const useViewerController = ({
  onJointChange,
  syncJointChangesToApp = false,
  showJointPanel = true,
  jointAngleState,
  jointMotionState,
  onSelect,
  onHover,
  selection,
  showVisual: propShowVisual,
  setShowVisual: propSetShowVisual,
  onTransformPendingChange,
  groundPlaneOffset = 0,
  setGroundPlaneOffset,
  groundPlaneOffsetReadOnly = false,
  active = true,
  jointStateScopeKey = null,
  defaultToolMode = 'select',
  toolModeScopeKey = null,
  closedLoopRobotState = null,
}: UseViewerControllerProps) => {
  const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
  const setHoveredSelection = useSelectionStore((state) => state.setHoveredSelection);
  const isOrbitDragging = useRef(false);
  const [robot, setRobot] = useState<any>(null);
  const [jointPanelRobot, setJointPanelRobot] = useState<any>(null);
  const {
    showCollision,
    setShowCollision,
    showCollisionAlwaysOnTop,
    setShowCollisionAlwaysOnTop,
    localShowVisual,
    setLocalShowVisual,
    showIkHandles,
    setShowIkHandles,
    showIkHandlesAlwaysOnTop,
    setShowIkHandlesAlwaysOnTop,
    showCenterOfMass,
    setShowCenterOfMass,
    showCoMOverlay,
    setShowCoMOverlay,
    centerOfMassSize,
    setCenterOfMassSize,
    showInertia,
    setShowInertia,
    showInertiaOverlay,
    setShowInertiaOverlay,
    showOrigins,
    setShowOrigins,
    showOriginsOverlay,
    setShowOriginsOverlay,
    originSize,
    setOriginSize,
    showMjcfSites,
    setShowMjcfSites,
    showJointAxes,
    setShowJointAxes,
    showJointAxesOverlay,
    setShowJointAxesOverlay,
    jointAxisSize,
    setJointAxisSize,
    interactionLayerPriority,
    recordInteractionLayerActivation,
    modelOpacity,
    setModelOpacity,
    highlightMode,
    setHighlightMode,
    isOptionsCollapsed,
    toggleOptionsCollapsed,
    isJointsCollapsed,
    toggleJointsCollapsed,
  } = useViewerSettings();

  const showVisual = propShowVisual !== undefined ? propShowVisual : localShowVisual;
  const setShowVisual = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (nextValue) => {
      const resolvedValue = typeof nextValue === 'function' ? nextValue(showVisual) : nextValue;
      (propSetShowVisual || setLocalShowVisual)(resolvedValue);
      if (resolvedValue) {
        recordInteractionLayerActivation('visual');
      }
    },
    [propSetShowVisual, recordInteractionLayerActivation, setLocalShowVisual, showVisual],
  );

  const normalizedToolModeScopeKey = toolModeScopeKey ?? null;
  const [toolModeState, setToolModeState] = useState(() =>
    createScopedToolModeState(normalizedToolModeScopeKey, defaultToolMode),
  );
  const resolvedToolModeState = useMemo(
    () => resolveScopedToolModeState(toolModeState, normalizedToolModeScopeKey, defaultToolMode),
    [defaultToolMode, normalizedToolModeScopeKey, toolModeState],
  );
  const toolMode = resolvedToolModeState.mode;
  const [measureState, setMeasureState] = useState<MeasureState>(createEmptyMeasureState);
  const [measureAnchorMode, setMeasureAnchorMode] = useState<MeasureAnchorMode>('frame');
  const [showMeasureDecomposition, setShowMeasureDecomposition] = useState(false);
  const [measurePoseRepresentation, setMeasurePoseRepresentation] =
    useState<MeasurePoseRepresentation>('matrix');
  const [paintColor, setPaintColor] = useState('#ff6c0a');
  const [paintSelectionScope, setPaintSelectionScope] =
    useState<ViewerPaintSelectionScope>('island');
  const [paintOperation, setPaintOperation] = useState<ViewerPaintOperation>('paint');
  const [paintStatus, setPaintStatus] = useState<ViewerPaintStatus | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsPanelRef = useRef<HTMLDivElement>(null);
  const jointPanelRef = useRef<HTMLDivElement>(null);
  const measurePanelRef = useRef<HTMLDivElement>(null);
  const {
    optionsPanelPos,
    jointPanelPos,
    measurePanelPos,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  } = usePanelDrag(containerRef, optionsPanelRef, jointPanelRef, measurePanelRef);

  const transformMode = (
    ['translate', 'rotate', 'universal'].includes(toolMode) ? toolMode : 'select'
  ) as 'select' | 'translate' | 'rotate' | 'universal';
  const updateGroundPlaneOffset = useCallback(
    (nextOffset: number) => {
      setGroundPlaneOffset?.(nextOffset);
    },
    [setGroundPlaneOffset],
  );

  useEffect(() => {
    if (resolvedToolModeState === toolModeState) {
      return;
    }

    setToolModeState(resolvedToolModeState);
  }, [resolvedToolModeState, toolModeState]);

  useEffect(() => {
    if (selection?.subType === 'collision') {
      setHighlightMode('collision');
    } else if (selection?.subType === 'visual') {
      setHighlightMode('link');
    }
  }, [selection?.subType, setHighlightMode]);

  const jointPanelStoreRef = useRef(createJointPanelStore());
  const jointAnglesRef = useRef<Record<string, number>>(
    jointPanelStoreRef.current.getSnapshot().jointAngles,
  );
  const initialJointAnglesRef = useRef<Record<string, number>>({});
  const jointStateScopeRef = useRef<string | null>(null);
  const [angleUnit, setAngleUnit] = useState<'rad' | 'deg'>('rad');
  const activeJointRef = useRef<string | null>(
    jointPanelStoreRef.current.getSnapshot().activeJoint,
  );
  const suppressNextPanelAutoScrollRef = useRef(false);
  const [isDragging, setIsDraggingState] = useState(false);
  const isDraggingRef = useRef(false);
  const setIsDragging = useCallback(
    (nextDragging: boolean | ((previousDragging: boolean) => boolean)) => {
      const resolvedDragging =
        typeof nextDragging === 'function' ? nextDragging(isDraggingRef.current) : nextDragging;
      isDraggingRef.current = resolvedDragging;
      if (active) {
        setHoverFrozen(resolvedDragging || transformPendingRef.current);
      }
      setIsDraggingState(resolvedDragging);
    },
    [active, setHoverFrozen],
  );
  const sceneRefreshRef = useRef<(() => void) | null>(null);
  const pendingSceneRefreshFrameRef = useRef<number | null>(null);
  const previousGroundPlaneOffsetRef = useRef(groundPlaneOffset);
  const previousAppliedJointAngleStateRef = useRef<Record<string, number>>({});
  const runtimeAutoFitGroundHandlerRef = useRef<(() => void) | null>(null);
  const previousAppliedJointMotionStateRef = useRef<Record<string, ViewerJointMotionStateValue>>(
    {},
  );
  const previewMotionAnglesRef = useRef<Record<string, number>>({});
  const previewMotionQuaternionsRef = useRef<
    Record<string, ViewerJointMotionStateValue['quaternion']>
  >({});
  const closedLoopMotionPreviewSessionRef = useRef(createClosedLoopMotionPreviewSession());
  const pendingClosedLoopPreviewRef = useRef<{
    selectedJointId: string;
    resolvedAngle: number;
  } | null>(null);
  const closedLoopPreviewFrameRef = useRef<number | null>(null);
  const jointInteractionPreviewSessionCounterRef = useRef(0);
  const activeJointInteractionPreviewSessionRef = useRef<string | null>(null);

  const justSelectedRef = useRef(false);
  const transformPendingRef = useRef(false);
  const jointControlRobot = jointPanelRobot || robot;
  const jointControlJoints = jointControlRobot?.joints;
  const effectiveClosedLoopRobotState = useMemo(
    () =>
      mergeClosedLoopRobotStateWithRuntimeJointPose(
        closedLoopRobotState,
        jointControlRobot?.joints as Record<string, RuntimePoseJointLike> | undefined,
      ),
    [closedLoopRobotState, jointControlRobot],
  );
  const resolveDrivenMotion = useCallback(
    (jointId: string, angle: number) => {
      if (!effectiveClosedLoopRobotState?.joints?.[jointId]) {
        return {
          angles: { [jointId]: angle },
          lockedJointIds: [jointId],
        };
      }

      return resolveMimicJointAngleTargets(effectiveClosedLoopRobotState, jointId, angle);
    },
    [effectiveClosedLoopRobotState],
  );

  const ensureJointInteractionPreviewSessionId = useCallback(() => {
    if (activeJointInteractionPreviewSessionRef.current !== null) {
      return activeJointInteractionPreviewSessionRef.current;
    }

    jointInteractionPreviewSessionCounterRef.current += 1;
    activeJointInteractionPreviewSessionRef.current = String(
      jointInteractionPreviewSessionCounterRef.current,
    );
    return activeJointInteractionPreviewSessionRef.current;
  }, []);

  const publishJointInteractionPreview = useCallback(
    (preview: {
      activeJointId: string | null;
      jointAngles?: Record<string, number>;
      jointQuaternions?: Record<string, ViewerJointMotionStateValue['quaternion']>;
    }) => {
      if (!APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED) {
        return;
      }

      useJointInteractionPreviewStore.getState().publishPreview({
        source: 'viewer',
        dragSessionId: ensureJointInteractionPreviewSessionId(),
        activeJointId: preview.activeJointId,
        jointAngles: { ...(preview.jointAngles ?? {}) },
        jointQuaternions: Object.fromEntries(
          Object.entries(preview.jointQuaternions ?? {}).filter(([, quaternion]) =>
            Boolean(quaternion),
          ),
        ) as Record<string, NonNullable<ViewerJointMotionStateValue['quaternion']>>,
        jointOrigins: {},
      });
    },
    [ensureJointInteractionPreviewSessionId],
  );

  const clearJointInteractionPreview = useCallback(() => {
    if (!APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED) {
      activeJointInteractionPreviewSessionRef.current = null;
      return;
    }

    const activeSessionId = activeJointInteractionPreviewSessionRef.current;
    activeJointInteractionPreviewSessionRef.current = null;

    if (activeSessionId === null) {
      return;
    }

    useJointInteractionPreviewStore.getState().clearPreview({
      source: 'viewer',
      dragSessionId: activeSessionId,
    });
  }, []);

  const emitJointChangeToApp = useCallback(
    (jointName: string, angle: number) => {
      if (!syncJointChangesToApp) {
        return;
      }

      onJointChange?.(jointName, angle);
    },
    [onJointChange, syncJointChangesToApp],
  );

  const syncJointAngleSnapshot = useCallback(() => {
    jointAnglesRef.current = jointPanelStoreRef.current.getSnapshot().jointAngles;
  }, []);

  const syncActiveJointSnapshot = useCallback(() => {
    activeJointRef.current = jointPanelStoreRef.current.getSnapshot().activeJoint;
  }, []);

  const patchJointPanelAngles = useCallback(
    (nextJointAngles: Record<string, number>) => {
      const changed = jointPanelStoreRef.current.patchJointAngles(nextJointAngles);
      if (changed) {
        syncJointAngleSnapshot();
      }
      return changed;
    },
    [syncJointAngleSnapshot],
  );

  const replaceJointPanelAngles = useCallback(
    (nextJointAngles: Record<string, number>) => {
      const changed = jointPanelStoreRef.current.replaceJointAngles(nextJointAngles);
      syncJointAngleSnapshot();
      return changed;
    },
    [syncJointAngleSnapshot],
  );

  const setPanelActiveJoint = useCallback(
    (jointName: string | null, options?: JointPanelActiveJointOptions) => {
      if (options?.suppressNextAutoScroll) {
        suppressNextPanelAutoScrollRef.current = true;
      }

      const shouldSuppressAutoScroll =
        jointName !== null &&
        options?.autoScroll === undefined &&
        suppressNextPanelAutoScrollRef.current;
      const changed = jointPanelStoreRef.current.setActiveJoint(
        jointName,
        shouldSuppressAutoScroll ? { ...options, autoScroll: false } : options,
      );

      if (shouldSuppressAutoScroll) {
        suppressNextPanelAutoScrollRef.current = false;
      }

      syncActiveJointSnapshot();
      return changed;
    },
    [syncActiveJointSnapshot],
  );

  const flushSceneRefresh = useCallback(() => {
    pendingSceneRefreshFrameRef.current = null;
    sceneRefreshRef.current?.();
  }, []);

  const requestSceneRefresh = useCallback(() => {
    if (pendingSceneRefreshFrameRef.current !== null) {
      return;
    }

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      flushSceneRefresh();
      return;
    }

    pendingSceneRefreshFrameRef.current = window.requestAnimationFrame(() => {
      flushSceneRefresh();
    });
  }, [flushSceneRefresh]);

  useEffect(() => {
    if (!active) {
      return;
    }

    // Keep collision/visual visibility toggles responsive even when a loader
    // branch did not mutate scene graph state in the same commit.
    requestSceneRefresh();
  }, [active, requestSceneRefresh, showCollision, showCollisionAlwaysOnTop, showVisual]);

  const applyRuntimeJointMotionPreview = useCallback(
    (
      nextJointAngles: Record<string, number>,
      nextJointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
      activeJointId: string | null = activeJointRef.current,
      options?: { syncJointPanel?: boolean },
    ) => {
      if (!jointControlRobot?.joints) {
        return;
      }

      let shouldRefresh = false;

      Object.entries(nextJointAngles).forEach(([jointNameOrId, angle]) => {
        const jointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
        const joint = jointKey ? jointControlRobot.joints?.[jointKey] : undefined;
        if (!joint || !isSingleDofJoint(joint)) {
          return;
        }

        const currentAngle = Number(joint.angle ?? joint.jointValue);
        if (!isSameJointAngle(currentAngle, angle)) {
          joint.setJointValue?.(angle);
          shouldRefresh = true;
        }
      });

      Object.entries(nextJointQuaternions).forEach(([jointNameOrId, quaternion]) => {
        const jointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
        const joint = jointKey ? jointControlRobot.joints?.[jointKey] : undefined;
        if (
          !joint ||
          !quaternion ||
          typeof (joint as any).setJointQuaternion !== 'function' ||
          isSameJointQuaternion((joint as any).quaternion, quaternion)
        ) {
          return;
        }

        (joint as any).setJointQuaternion(quaternion);
        shouldRefresh = true;
      });

      if ((options?.syncJointPanel ?? true) && Object.keys(nextJointAngles).length > 0) {
        patchJointPanelAngles(nextJointAngles);
      }

      previewMotionAnglesRef.current = nextJointAngles;
      previewMotionQuaternionsRef.current = nextJointQuaternions;
      publishJointInteractionPreview({
        activeJointId,
        jointAngles: nextJointAngles,
        jointQuaternions: nextJointQuaternions,
      });

      if (shouldRefresh) {
        requestSceneRefresh();
      }
    },
    [
      jointControlJoints,
      jointControlRobot,
      patchJointPanelAngles,
      publishJointInteractionPreview,
      requestSceneRefresh,
    ],
  );

  const registerSceneRefresh = useCallback((refreshScene: (() => void) | null) => {
    sceneRefreshRef.current = refreshScene;
  }, []);

  const getJointAnglesSnapshot = useCallback(() => ({ ...jointAnglesRef.current }), []);

  const getInitialJointAnglesForNextLoad = useCallback(() => {
    if (!jointStateScopeKey) {
      return {};
    }

    if (jointStateScopeRef.current !== jointStateScopeKey) {
      return {};
    }

    return { ...jointAnglesRef.current };
  }, [jointStateScopeKey]);

  const previewIkJointKinematics = useCallback(
    (
      jointAngles: Record<string, number>,
      jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
    ) => {
      applyRuntimeJointMotionPreview(jointAngles, jointQuaternions, activeJointRef.current, {
        syncJointPanel: false,
      });
    },
    [applyRuntimeJointMotionPreview],
  );

  const storeAppliedJointMotionState = useCallback(
    (
      nextJointAngles: Record<string, number>,
      nextJointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']> = {},
    ) => {
      previousAppliedJointAngleStateRef.current = {
        ...previousAppliedJointAngleStateRef.current,
        ...nextJointAngles,
      };

      const nextMotionState = { ...previousAppliedJointMotionStateRef.current };

      Object.keys(nextJointAngles).forEach((jointNameOrId) => {
        if (!nextJointQuaternions[jointNameOrId]) {
          delete nextMotionState[jointNameOrId];
        }
      });

      Object.entries(nextJointQuaternions).forEach(([jointNameOrId, quaternion]) => {
        if (!quaternion) {
          delete nextMotionState[jointNameOrId];
          return;
        }

        const nextMotion: ViewerJointMotionStateValue = { quaternion };
        const angle = nextJointAngles[jointNameOrId];
        if (typeof angle === 'number') {
          nextMotion.angle = angle;
        }
        nextMotionState[jointNameOrId] = nextMotion;
      });

      previousAppliedJointMotionStateRef.current = nextMotionState;
    },
    [],
  );

  const restoreAppliedJointMotionState = useCallback(() => {
    clearJointInteractionPreview();
    pendingClosedLoopPreviewRef.current = null;
    if (closedLoopPreviewFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(closedLoopPreviewFrameRef.current);
      closedLoopPreviewFrameRef.current = null;
    }
    closedLoopMotionPreviewSessionRef.current.setBaseRobot(effectiveClosedLoopRobotState);
    closedLoopMotionPreviewSessionRef.current.reset();
    previewMotionAnglesRef.current = { ...previousAppliedJointAngleStateRef.current };
    previewMotionQuaternionsRef.current = Object.fromEntries(
      Object.entries(previousAppliedJointMotionStateRef.current)
        .filter(([, motion]) => Boolean(motion?.quaternion))
        .map(([name, motion]) => [name, motion?.quaternion]),
    );

    if (jointControlRobot?.joints) {
      let shouldRefresh = false;

      Object.entries(previousAppliedJointAngleStateRef.current).forEach(
        ([jointNameOrId, angle]) => {
          const jointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
          const joint = jointKey ? jointControlRobot.joints?.[jointKey] : undefined;
          if (!joint || !isSingleDofJoint(joint)) {
            return;
          }

          const currentAngle = Number(joint.angle ?? joint.jointValue);
          if (!isSameJointAngle(currentAngle, angle)) {
            joint.setJointValue?.(angle);
            shouldRefresh = true;
          }
        },
      );

      Object.entries(previousAppliedJointMotionStateRef.current).forEach(
        ([jointNameOrId, motion]) => {
          const jointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
          const joint = jointKey ? jointControlRobot.joints?.[jointKey] : undefined;
          if (
            !joint ||
            !motion?.quaternion ||
            typeof (joint as any).setJointQuaternion !== 'function' ||
            isSameJointQuaternion((joint as any).quaternion, motion.quaternion)
          ) {
            return;
          }

          (joint as any).setJointQuaternion(motion.quaternion);
          shouldRefresh = true;
        },
      );

      if (Object.keys(previousAppliedJointAngleStateRef.current).length > 0) {
        replaceJointPanelAngles(previousAppliedJointAngleStateRef.current);
      }

      if (shouldRefresh) {
        requestSceneRefresh();
      }
    }
  }, [
    clearJointInteractionPreview,
    effectiveClosedLoopRobotState,
    jointControlJoints,
    jointControlRobot,
    replaceJointPanelAngles,
    requestSceneRefresh,
  ]);

  const clearIkJointKinematicsPreview = useCallback(() => {
    restoreAppliedJointMotionState();
  }, [restoreAppliedJointMotionState]);

  useEffect(() => {
    if (!active) return;
    setHoverFrozen(isDragging || transformPendingRef.current);
  }, [active, isDragging, setHoverFrozen]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    if (!active) {
      setHoverFrozen(false);
    }
  }, [active, setHoverFrozen]);

  useEffect(() => {
    const releaseDragLock = () => setIsDragging(false);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setIsDragging(false);
      }
    };

    window.addEventListener('mouseup', releaseDragLock);
    window.addEventListener('pointerup', releaseDragLock);
    window.addEventListener('blur', releaseDragLock);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('mouseup', releaseDragLock);
      window.removeEventListener('pointerup', releaseDragLock);
      window.removeEventListener('blur', releaseDragLock);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearJointInteractionPreview();
      if (pendingSceneRefreshFrameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(pendingSceneRefreshFrameRef.current);
        pendingSceneRefreshFrameRef.current = null;
      }
      if (closedLoopPreviewFrameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(closedLoopPreviewFrameRef.current);
        closedLoopPreviewFrameRef.current = null;
      }
    };
  }, [clearJointInteractionPreview]);

  useEffect(() => {
    const regressionDebugEnabled =
      import.meta.env?.DEV ||
      (typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('regressionDebug') === '1');
    if (!regressionDebugEnabled) {
      return;
    }

    if (!active) {
      setRegressionViewerHandlers(null);
      return () => {
        setRegressionViewerHandlers(null);
      };
    }

    const applyFlags = (flags: RegressionViewerFlags) => {
      if (flags.showCollision !== undefined) setShowCollision(flags.showCollision);
      if (flags.showCollisionAlwaysOnTop !== undefined)
        setShowCollisionAlwaysOnTop(flags.showCollisionAlwaysOnTop);
      if (flags.showVisual !== undefined) setShowVisual(flags.showVisual);
      if (flags.showCenterOfMass !== undefined) setShowCenterOfMass(flags.showCenterOfMass);
      if (flags.showCoMOverlay !== undefined) setShowCoMOverlay(flags.showCoMOverlay);
      if (flags.centerOfMassSize !== undefined) setCenterOfMassSize(flags.centerOfMassSize);
      if (flags.showInertia !== undefined) setShowInertia(flags.showInertia);
      if (flags.showInertiaOverlay !== undefined) setShowInertiaOverlay(flags.showInertiaOverlay);
      if (flags.showOrigins !== undefined) setShowOrigins(flags.showOrigins);
      if (flags.showOriginsOverlay !== undefined) setShowOriginsOverlay(flags.showOriginsOverlay);
      if (flags.originSize !== undefined) setOriginSize(flags.originSize);
      if (flags.showJointAxes !== undefined) setShowJointAxes(flags.showJointAxes);
      if (flags.showJointAxesOverlay !== undefined)
        setShowJointAxesOverlay(flags.showJointAxesOverlay);
      if (flags.jointAxisSize !== undefined) setJointAxisSize(flags.jointAxisSize);
      if (flags.highlightMode !== undefined) setHighlightMode(flags.highlightMode);
      if (flags.modelOpacity !== undefined) setModelOpacity(flags.modelOpacity);
    };

    setRegressionViewerHandlers({
      getSnapshot: () => ({
        jointAngles: { ...jointAnglesRef.current },
        activeJoint: activeJointRef.current,
        toolMode,
        highlightMode,
        flags: {
          showCollision,
          showCollisionAlwaysOnTop,
          showVisual,
          showCenterOfMass,
          showCoMOverlay,
          centerOfMassSize,
          showInertia,
          showInertiaOverlay,
          showOrigins,
          showOriginsOverlay,
          originSize,
          showJointAxes,
          showJointAxesOverlay,
          jointAxisSize,
          highlightMode,
          modelOpacity,
        },
      }),
      setFlags: applyFlags,
      setToolMode: (nextMode) => {
        const normalizedMode = String(nextMode || '').trim();
        const allowedModes: ToolMode[] = [
          'select',
          'translate',
          'rotate',
          'universal',
          'view',
          'face',
          'measure',
          'paint',
        ];
        const resolvedMode = allowedModes.includes(normalizedMode as ToolMode)
          ? (normalizedMode as ToolMode)
          : toolMode;
        const changed = resolvedMode !== toolMode;

        if (changed) {
          setToolModeState({
            scopeKey: normalizedToolModeScopeKey,
            explicit: true,
            mode: resolvedMode,
          });
          if (resolvedMode !== 'measure') {
            setMeasureState((prev) => (!prev.hoverTarget ? prev : { ...prev, hoverTarget: null }));
          }
          if (resolvedMode !== 'paint') {
            setPaintStatus(null);
          }
        }

        return {
          changed,
          activeMode: resolvedMode,
        };
      },
      setJointAngles: (nextJointAngles) => {
        if (!nextJointAngles || typeof nextJointAngles !== 'object') {
          return { changed: false };
        }

        let changed = false;

        Object.entries(nextJointAngles).forEach(([jointName, angle]) => {
          if (!Number.isFinite(Number(angle))) {
            return;
          }

          const numericAngle = Number(angle);
          const joint = robot?.joints?.[jointName];
          if (joint && isSingleDofJoint(joint)) {
            joint.setJointValue?.(numericAngle);
          }

          if (jointAnglesRef.current[jointName] !== numericAngle) {
            changed = true;
          }
        });

        if (changed) {
          patchJointPanelAngles(nextJointAngles);
        }

        robot?.updateMatrixWorld?.(true);
        requestSceneRefresh();
        return { changed };
      },
    });

    return () => {
      setRegressionViewerHandlers(null);
    };
  }, [
    active,
    centerOfMassSize,
    highlightMode,
    jointAxisSize,
    modelOpacity,
    originSize,
    patchJointPanelAngles,
    requestSceneRefresh,
    robot,
    setCenterOfMassSize,
    setHighlightMode,
    setJointAxisSize,
    setModelOpacity,
    normalizedToolModeScopeKey,
    setOriginSize,
    setShowCoMOverlay,
    setShowCenterOfMass,
    setShowCollision,
    setShowCollisionAlwaysOnTop,
    setShowInertia,
    setShowInertiaOverlay,
    setShowJointAxes,
    setShowJointAxesOverlay,
    setShowOrigins,
    setShowOriginsOverlay,
    setShowVisual,
    showCenterOfMass,
    showCoMOverlay,
    showCollision,
    showCollisionAlwaysOnTop,
    showInertia,
    showInertiaOverlay,
    showJointAxes,
    showJointAxesOverlay,
    showOrigins,
    showOriginsOverlay,
    showVisual,
    setMeasureState,
    toolMode,
  ]);

  const initializeJointControlState = useCallback(
    (loadedRobot: any) => {
      const preservePreviousAngles =
        jointStateScopeRef.current !== null && jointStateScopeRef.current === jointStateScopeKey;
      const { currentAngles, defaultAngles } = resolveInitialJointControlState({
        joints: loadedRobot?.joints,
        previousAngles: jointAnglesRef.current,
        preservePreviousAngles,
        isControllableJoint: isSingleDofJoint,
      });

      replaceJointPanelAngles(currentAngles);
      storeAppliedJointMotionState(currentAngles);
      initialJointAnglesRef.current = defaultAngles;
      setPanelActiveJoint(null);
      jointStateScopeRef.current = jointStateScopeKey;
    },
    [
      jointStateScopeKey,
      replaceJointPanelAngles,
      setPanelActiveJoint,
      storeAppliedJointMotionState,
    ],
  );

  const handleRobotLoaded = useCallback(
    (loadedRobot: any) => {
      clearJointInteractionPreview();
      setJointPanelRobot(null);
      setRobot(loadedRobot);
      initializeJointControlState(loadedRobot);
    },
    [clearJointInteractionPreview, initializeJointControlState],
  );

  const handleJointPanelRobotLoaded = useCallback(
    (loadedRobot: any | null) => {
      clearJointInteractionPreview();
      setJointPanelRobot(loadedRobot);
      if (!loadedRobot) {
        return;
      }
      initializeJointControlState(loadedRobot);
    },
    [clearJointInteractionPreview, initializeJointControlState],
  );

  const handleRuntimeJointAnglesChange = useCallback(
    (nextAngles: Record<string, number>) => {
      if (!nextAngles || typeof nextAngles !== 'object') return;
      const shouldCommitToApp = !isDraggingRef.current;
      const normalizedAngles = normalizeViewerJointAngleState(jointControlJoints, nextAngles);
      const resolvedAngles = { ...normalizedAngles };

      if (jointControlRobot?.joints) {
        Object.entries(normalizedAngles).forEach(([jointKey, angle]) => {
          const joint = jointControlRobot.joints?.[jointKey];
          if (joint && isSingleDofJoint(joint)) {
            const resolvedAngle = resolveRuntimeReportedJointAngle(joint, angle);
            resolvedAngles[jointKey] = resolvedAngle;
            joint.angle = resolvedAngle;
          }
        });
      }

      const activeRuntimeJointKey = resolveViewerJointKey(
        effectiveClosedLoopRobotState?.joints,
        activeJointRef.current ?? Object.keys(resolvedAngles)[0] ?? null,
      );
      const activeRuntimeAngle =
        activeRuntimeJointKey && Object.hasOwn(resolvedAngles, activeRuntimeJointKey)
          ? resolvedAngles[activeRuntimeJointKey]
          : undefined;
      const drivenMotion =
        activeRuntimeJointKey && typeof activeRuntimeAngle === 'number'
          ? resolveDrivenMotion(activeRuntimeJointKey, activeRuntimeAngle)
          : null;
      const hasClosedLoopConstraints = Boolean(
        effectiveClosedLoopRobotState?.closedLoopConstraints?.length,
      );

      if (
        activeRuntimeJointKey &&
        typeof activeRuntimeAngle === 'number' &&
        hasClosedLoopConstraints
      ) {
        closedLoopMotionPreviewSessionRef.current.setBaseRobot(effectiveClosedLoopRobotState);

        try {
          const compensation = closedLoopMotionPreviewSessionRef.current.solve(
            activeRuntimeJointKey,
            activeRuntimeAngle,
          );

          if (shouldCommitToApp) {
            Object.entries(resolvedAngles).forEach(([jointKey, resolvedAngle]) => {
              const joint = jointControlRobot?.joints?.[jointKey];
              emitJointChangeToApp(joint?.name || jointKey, resolvedAngle);
            });
            storeAppliedJointMotionState(compensation.angles, compensation.quaternions);
          }

          applyRuntimeJointMotionPreview(
            compensation.angles,
            compensation.quaternions,
            activeRuntimeJointKey,
          );
          return;
        } catch (error) {
          scheduleFailFastInDev(
            'useViewerController:handleRuntimeJointAnglesChange',
            new Error('Closed-loop runtime preview solve failed.', { cause: error }),
            'warn',
          );
          restoreAppliedJointMotionState();
          return;
        }
      }

      const nextPreviewAngles = drivenMotion
        ? { ...resolvedAngles, ...drivenMotion.angles }
        : resolvedAngles;
      if (shouldCommitToApp) {
        Object.entries(resolvedAngles).forEach(([jointKey, resolvedAngle]) => {
          const joint = jointControlRobot?.joints?.[jointKey];
          emitJointChangeToApp(joint?.name || jointKey, resolvedAngle);
        });
        storeAppliedJointMotionState(nextPreviewAngles);
      }
      patchJointPanelAngles(nextPreviewAngles);
      previewMotionAnglesRef.current = nextPreviewAngles;
      previewMotionQuaternionsRef.current = {};
      publishJointInteractionPreview({
        activeJointId: activeRuntimeJointKey,
        jointAngles: nextPreviewAngles,
      });
    },
    [
      applyRuntimeJointMotionPreview,
      effectiveClosedLoopRobotState,
      emitJointChangeToApp,
      jointControlJoints,
      jointControlRobot,
      patchJointPanelAngles,
      publishJointInteractionPreview,
      resolveDrivenMotion,
      restoreAppliedJointMotionState,
      storeAppliedJointMotionState,
    ],
  );

  const handleTransformPending = useCallback(
    (pending: boolean) => {
      transformPendingRef.current = pending;
      if (active) {
        setHoverFrozen(pending || isDraggingRef.current);
      }
      onTransformPendingChange?.(pending);
    },
    [active, onTransformPendingChange, setHoverFrozen],
  );

  useEffect(() => {
    return () => {
      transformPendingRef.current = false;
      setHoverFrozen(false);
      onTransformPendingChange?.(false);
    };
  }, [onTransformPendingChange, setHoverFrozen]);

  useEffect(() => {
    previousAppliedJointAngleStateRef.current = jointControlRobot?.joints
      ? { ...jointAnglesRef.current }
      : {};
    previousAppliedJointMotionStateRef.current = {};
    previewMotionAnglesRef.current = {};
    previewMotionQuaternionsRef.current = {};
    pendingClosedLoopPreviewRef.current = null;
    if (closedLoopPreviewFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(closedLoopPreviewFrameRef.current);
      closedLoopPreviewFrameRef.current = null;
    }
    closedLoopMotionPreviewSessionRef.current.setBaseRobot(effectiveClosedLoopRobotState);
    closedLoopMotionPreviewSessionRef.current.reset();
    clearJointInteractionPreview();
  }, [
    clearJointInteractionPreview,
    effectiveClosedLoopRobotState,
    jointControlRobot,
    jointStateScopeKey,
  ]);

  useEffect(() => {
    if (!jointControlRobot || (!jointAngleState && !jointMotionState)) return;

    const nextAngleState = jointMotionState
      ? Object.fromEntries(
          Object.entries(jointMotionState)
            .filter(([, motion]) => typeof motion?.angle === 'number')
            .map(([name, motion]) => [name, motion.angle as number]),
        )
      : (jointAngleState ?? {});
    const normalizedAngleState = normalizeViewerJointAngleState(jointControlJoints, nextAngleState);
    const meaningfulJointMotionEntries = Object.entries(jointMotionState ?? {}).filter(
      ([, motion]) =>
        Boolean(motion) && (typeof motion?.angle === 'number' || Boolean(motion?.quaternion)),
    );
    if (
      Object.keys(normalizedAngleState).length === 0 &&
      meaningfulJointMotionEntries.length === 0
    ) {
      return;
    }

    const changedPanelAngles = Object.fromEntries(
      Object.entries(normalizedAngleState).filter(
        ([name, angle]) =>
          !isSameJointAngle(previousAppliedJointAngleStateRef.current[name], angle),
      ),
    );
    let shouldRefresh = false;

    if (Object.keys(changedPanelAngles).length > 0) {
      patchJointPanelAngles(changedPanelAngles);
    }

    meaningfulJointMotionEntries.forEach(([name, motion]) => {
      if (!motion || isSameJointMotion(previousAppliedJointMotionStateRef.current[name], motion)) {
        return;
      }

      const jointKey = resolveViewerJointKey(jointControlJoints, name);
      const joint = jointKey ? jointControlRobot.joints?.[jointKey] : undefined;
      if (!joint || !motion) {
        return;
      }

      if (typeof motion.angle === 'number' && isSingleDofJoint(joint)) {
        const currentAngle = Number(joint.angle ?? joint.jointValue);
        if (!isSameJointAngle(currentAngle, motion.angle)) {
          joint.setJointValue?.(motion.angle);
          shouldRefresh = true;
        }
      }

      if (
        motion.quaternion &&
        typeof (joint as any).setJointQuaternion === 'function' &&
        !isSameJointQuaternion((joint as any).quaternion, motion.quaternion)
      ) {
        (joint as any).setJointQuaternion(motion.quaternion);
        shouldRefresh = true;
      }
    });

    if (!jointMotionState) {
      Object.entries(changedPanelAngles).forEach(([name, angle]) => {
        const joint = jointControlRobot.joints?.[name];
        if (isSingleDofJoint(joint)) {
          const currentAngle = Number(joint.angle ?? joint.jointValue);
          if (!isSameJointAngle(currentAngle, angle)) {
            joint.setJointValue?.(angle);
            shouldRefresh = true;
          }
        }
      });
    }

    previousAppliedJointAngleStateRef.current = normalizedAngleState;
    previousAppliedJointMotionStateRef.current = jointMotionState
      ? Object.fromEntries(meaningfulJointMotionEntries)
      : {};
    previewMotionAnglesRef.current = normalizedAngleState;
    previewMotionQuaternionsRef.current = Object.fromEntries(
      meaningfulJointMotionEntries
        .filter(([, motion]) => Boolean(motion?.quaternion))
        .map(([name, motion]) => [name, motion?.quaternion]),
    );

    if (shouldRefresh) {
      requestSceneRefresh();
    }
  }, [
    jointAngleState,
    jointControlJoints,
    jointControlRobot,
    jointMotionState,
    patchJointPanelAngles,
    requestSceneRefresh,
  ]);

  const handleJointAngleChange = useCallback(
    (jointName: string, angle: number) => {
      const jointKey = resolveViewerJointKey(jointControlJoints, jointName);
      if (!jointKey || !jointControlRobot?.joints?.[jointKey]) return;

      const joint = jointControlRobot.joints[jointKey];
      if (!isSingleDofJoint(joint)) return;

      const selectedClosedLoopJointId =
        resolveViewerJointKey(
          effectiveClosedLoopRobotState?.joints,
          joint.name || jointKey || jointName,
        ) ?? jointKey;
      const hasClosedLoopConstraints = Boolean(
        effectiveClosedLoopRobotState?.closedLoopConstraints?.length,
      );

      if (selectedClosedLoopJointId && hasClosedLoopConstraints) {
        closedLoopMotionPreviewSessionRef.current.setBaseRobot(effectiveClosedLoopRobotState);
        pendingClosedLoopPreviewRef.current = {
          selectedJointId: selectedClosedLoopJointId,
          resolvedAngle: angle,
        };

        if (closedLoopPreviewFrameRef.current === null) {
          const runPreviewSolve = () => {
            closedLoopPreviewFrameRef.current = null;
            const pendingPreview = pendingClosedLoopPreviewRef.current;
            pendingClosedLoopPreviewRef.current = null;
            if (!pendingPreview) {
              return;
            }

            try {
              const compensation = closedLoopMotionPreviewSessionRef.current.solve(
                pendingPreview.selectedJointId,
                pendingPreview.resolvedAngle,
              );

              applyRuntimeJointMotionPreview(
                compensation.angles,
                compensation.quaternions,
                pendingPreview.selectedJointId,
              );
            } catch (error) {
              scheduleFailFastInDev(
                'useViewerController:handleJointAngleChange',
                new Error('Closed-loop slider preview solve failed.', { cause: error }),
                'warn',
              );
              restoreAppliedJointMotionState();
            }

            if (pendingClosedLoopPreviewRef.current) {
              if (
                typeof window === 'undefined' ||
                typeof window.requestAnimationFrame !== 'function'
              ) {
                runPreviewSolve();
                return;
              }

              closedLoopPreviewFrameRef.current = window.requestAnimationFrame(runPreviewSolve);
            }
          };

          if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            runPreviewSolve();
          } else {
            closedLoopPreviewFrameRef.current = window.requestAnimationFrame(runPreviewSolve);
          }
        }

        return;
      }

      let shouldRefresh = false;
      if ((joint.angle ?? joint.jointValue) !== angle) {
        joint.setJointValue?.(angle);
        shouldRefresh = true;
      }

      const resolvedAngle = Number.isFinite(Number(joint.angle ?? joint.jointValue))
        ? Number(joint.angle ?? joint.jointValue)
        : angle;
      const drivenMotion = resolveDrivenMotion(selectedClosedLoopJointId, resolvedAngle);

      applyRuntimeJointMotionPreview(drivenMotion.angles, {}, jointKey);

      if (shouldRefresh) {
        requestSceneRefresh();
      }
    },
    [
      applyRuntimeJointMotionPreview,
      effectiveClosedLoopRobotState?.closedLoopConstraints,
      effectiveClosedLoopRobotState,
      jointControlJoints,
      jointControlRobot,
      requestSceneRefresh,
      resolveDrivenMotion,
      restoreAppliedJointMotionState,
    ],
  );

  const handleRuntimeJointAngleChange = useCallback(
    (jointName: string, angle: number) => {
      handleJointAngleChange(jointName, angle);
    },
    [handleJointAngleChange],
  );

  const handleActiveJointChange = useCallback(
    (jointName: string | null) => {
      if (!jointName) {
        setPanelActiveJoint(null);
        return;
      }

      const jointKey = resolveViewerJointKey(jointControlJoints, jointName);
      const joint = jointKey ? jointControlRobot?.joints?.[jointKey] : undefined;
      setPanelActiveJoint(isSingleDofJoint(joint) ? jointKey : null);
    },
    [jointControlJoints, jointControlRobot, setPanelActiveJoint],
  );

  const handleJointChangeCommit = useCallback(
    (jointName: string, angle: number) => {
      clearJointInteractionPreview();
      pendingClosedLoopPreviewRef.current = null;
      if (closedLoopPreviewFrameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(closedLoopPreviewFrameRef.current);
        closedLoopPreviewFrameRef.current = null;
      }
      closedLoopMotionPreviewSessionRef.current.setBaseRobot(effectiveClosedLoopRobotState);
      closedLoopMotionPreviewSessionRef.current.reset();
      previewMotionAnglesRef.current = {};
      previewMotionQuaternionsRef.current = {};
      const jointKey = resolveViewerJointKey(jointControlJoints, jointName);
      const joint = jointKey ? jointControlRobot?.joints?.[jointKey] : undefined;
      let shouldRefresh = false;
      if (joint && isSingleDofJoint(joint) && (joint.angle ?? joint.jointValue) !== angle) {
        joint.setJointValue?.(angle);
        shouldRefresh = true;
      }

      const resolvedAngle = Number.isFinite(Number(joint?.angle ?? joint?.jointValue))
        ? Number(joint?.angle ?? joint?.jointValue)
        : angle;
      const selectedClosedLoopJointId =
        resolveViewerJointKey(
          effectiveClosedLoopRobotState?.joints,
          joint?.name || jointKey || jointName,
        ) ?? jointKey;
      const drivenMotion = selectedClosedLoopJointId
        ? resolveDrivenMotion(selectedClosedLoopJointId, resolvedAngle)
        : { angles: {}, lockedJointIds: [] };

      Object.entries(drivenMotion.angles).forEach(([jointNameOrId, drivenAngle]) => {
        const drivenJointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
        const drivenJoint = drivenJointKey
          ? jointControlRobot?.joints?.[drivenJointKey]
          : undefined;
        if (!drivenJoint || !isSingleDofJoint(drivenJoint)) {
          return;
        }

        if ((drivenJoint.angle ?? drivenJoint.jointValue) !== drivenAngle) {
          drivenJoint.setJointValue?.(drivenAngle);
          shouldRefresh = true;
        }
      });

      if (Object.keys(drivenMotion.angles).length > 0) {
        patchJointPanelAngles(drivenMotion.angles);
      } else if (jointKey) {
        patchJointPanelAngles({ [jointKey]: resolvedAngle });
      }
      storeAppliedJointMotionState(
        Object.keys(drivenMotion.angles).length > 0
          ? drivenMotion.angles
          : jointKey
            ? { [jointKey]: resolvedAngle }
            : {},
      );
      (joint as { finalizeJointValue?: () => void } | undefined)?.finalizeJointValue?.();

      if (shouldRefresh) {
        requestSceneRefresh();
      }

      const resolvedJointName = joint?.name || jointKey || jointName;
      emitJointChangeToApp(resolvedJointName, resolvedAngle);
    },
    [
      clearJointInteractionPreview,
      effectiveClosedLoopRobotState,
      emitJointChangeToApp,
      jointControlJoints,
      jointControlRobot,
      patchJointPanelAngles,
      requestSceneRefresh,
      resolveDrivenMotion,
      storeAppliedJointMotionState,
    ],
  );

  const handleResetJoints = useCallback(() => {
    if (!jointControlRobot?.joints) return;

    Object.keys(jointAnglesRef.current).forEach((name) => {
      const initialAngle = initialJointAnglesRef.current[name] || 0;
      const joint = jointControlRobot.joints[name];

      if (joint) {
        const originalIgnoreLimits = joint.ignoreLimits;
        joint.ignoreLimits = true;
        handleJointAngleChange(name, initialAngle);
        joint.ignoreLimits = originalIgnoreLimits;
      } else {
        handleJointAngleChange(name, initialAngle);
      }

      handleJointChangeCommit(name, initialAngle);
    });
  }, [handleJointAngleChange, handleJointChangeCommit, jointControlRobot]);

  const handleSelectWrapper = useCallback(
    (
      type: Exclude<InteractionSelection['type'], null>,
      id: string,
      subType?: 'visual' | 'collision',
      helperKind?: ViewerHelperKind,
    ) => {
      if (transformPendingRef.current) return;

      onSelect?.(type, id, subType, helperKind);
      const activeJointKey = resolveActiveViewerJointKeyFromSelection(
        jointControlJoints,
        type && id ? { type, id } : null,
      );
      setPanelActiveJoint(activeJointKey);
    },
    [jointControlJoints, jointControlRobot, onSelect, setPanelActiveJoint],
  );

  const handleHoverWrapper = useCallback(
    (
      type: InteractionSelection['type'],
      id: string | null,
      subType?: 'visual' | 'collision',
      objectIndex?: number,
      helperKind?: ViewerHelperKind,
      highlightObjectId?: number,
    ) => {
      setHoveredSelection({ type, id, subType, objectIndex, helperKind, highlightObjectId });
      onHover?.(type, id, subType, objectIndex, helperKind, highlightObjectId);
    },
    [onHover, setHoveredSelection],
  );

  const registerRuntimeAutoFitGroundHandler = useCallback((handler: (() => void) | null) => {
    runtimeAutoFitGroundHandlerRef.current = handler;
  }, []);

  const handleAutoFitGround = useCallback(() => {
    if (runtimeAutoFitGroundHandlerRef.current) {
      runtimeAutoFitGroundHandlerRef.current();
      return;
    }

    const currentRobot = robot ?? jointPanelRobot;
    if (!currentRobot) return;

    const aligned = alignObjectLowestPointToZ(currentRobot, groundPlaneOffset, {
      includeInvisible: false,
      includeVisual: true,
      includeCollision: false,
    });

    if (aligned === null) {
      alignObjectLowestPointToZ(currentRobot, groundPlaneOffset, {
        includeInvisible: true,
        includeVisual: true,
        includeCollision: false,
      });
    }
    requestSceneRefresh();
  }, [groundPlaneOffset, jointPanelRobot, requestSceneRefresh, robot]);

  const handleToolModeChange = useCallback(
    (nextMode: ToolMode) => {
      setToolModeState({
        scopeKey: normalizedToolModeScopeKey,
        explicit: true,
        mode: nextMode,
      });

      if (nextMode !== 'measure') {
        setMeasureState((prev) => (!prev.hoverTarget ? prev : { ...prev, hoverTarget: null }));
      }
      if (nextMode !== 'paint') {
        setPaintStatus(null);
      }
    },
    [normalizedToolModeScopeKey],
  );

  const handleCloseMeasureTool = useCallback(() => {
    setMeasureState(createEmptyMeasureState());
    setToolModeState({
      scopeKey: normalizedToolModeScopeKey,
      explicit: true,
      mode: 'select',
    });
    onHover?.(null, null);
  }, [normalizedToolModeScopeKey, onHover]);

  const handleClosePaintTool = useCallback(() => {
    setPaintStatus(null);
    setToolModeState({
      scopeKey: normalizedToolModeScopeKey,
      explicit: true,
      mode: 'select',
    });
  }, [normalizedToolModeScopeKey]);

  const handlePointerMissed = useCallback(() => {
    if (justSelectedRef.current) return;
    if (transformPendingRef.current) return;
    onSelect?.('link', '');
    setPanelActiveJoint(null);
  }, [onSelect, setPanelActiveJoint]);

  useEffect(() => {
    if (!active || !robot) return;
    if (!beginInitialGroundAlignment(robot)) return;

    const timers = [0, 80, 220].map((delay) => window.setTimeout(handleAutoFitGround, delay));

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [active, groundPlaneOffset, handleAutoFitGround, robot]);

  useEffect(() => {
    const previousGroundPlaneOffset = previousGroundPlaneOffsetRef.current;
    previousGroundPlaneOffsetRef.current = groundPlaneOffset;

    if (!active || !robot) {
      return;
    }

    if (Object.is(previousGroundPlaneOffset, groundPlaneOffset)) {
      return;
    }

    handleAutoFitGround();
  }, [active, groundPlaneOffset, handleAutoFitGround, robot]);

  useEffect(() => {
    if (!jointControlRobot) return;
    const activeJointKey = resolveActiveViewerJointKeyFromSelection(jointControlJoints, selection);
    setPanelActiveJoint(activeJointKey);
  }, [jointControlJoints, jointControlRobot, selection, setPanelActiveJoint]);

  return {
    robot,
    setRobot,
    jointPanelRobot,
    setJointPanelRobot,
    showCollision,
    showCollisionAlwaysOnTop,
    setShowCollisionAlwaysOnTop,
    setShowCollision,
    showVisual,
    setShowVisual,
    showIkHandles,
    setShowIkHandles,
    showIkHandlesAlwaysOnTop,
    setShowIkHandlesAlwaysOnTop,
    showCenterOfMass,
    setShowCenterOfMass,
    showCoMOverlay,
    setShowCoMOverlay,
    centerOfMassSize,
    setCenterOfMassSize,
    showInertia,
    setShowInertia,
    showInertiaOverlay,
    setShowInertiaOverlay,
    showOrigins,
    setShowOrigins,
    showOriginsOverlay,
    setShowOriginsOverlay,
    originSize,
    setOriginSize,
    showMjcfSites,
    setShowMjcfSites,
    showJointAxes,
    setShowJointAxes,
    showJointAxesOverlay,
    setShowJointAxesOverlay,
    jointAxisSize,
    setJointAxisSize,
    interactionLayerPriority,
    modelOpacity,
    setModelOpacity,
    highlightMode,
    setHighlightMode,
    isOptionsCollapsed,
    toggleOptionsCollapsed,
    isJointsCollapsed,
    toggleJointsCollapsed,
    closedLoopRobotState: effectiveClosedLoopRobotState,
    toolMode,
    measureState,
    setMeasureState,
    measureAnchorMode,
    setMeasureAnchorMode,
    showMeasureDecomposition,
    setShowMeasureDecomposition,
    measurePoseRepresentation,
    setMeasurePoseRepresentation,
    paintColor,
    setPaintColor,
    paintSelectionScope,
    setPaintSelectionScope,
    paintOperation,
    setPaintOperation,
    paintStatus,
    setPaintStatus,
    containerRef,
    optionsPanelRef,
    jointPanelRef,
    measurePanelRef,
    optionsPanelPos,
    jointPanelPos,
    measurePanelPos,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    transformMode,
    jointPanelStore: jointPanelStoreRef.current,
    getJointAnglesSnapshot,
    getInitialJointAnglesForNextLoad,
    registerSceneRefresh,
    previewIkJointKinematics,
    clearIkJointKinematicsPreview,
    angleUnit,
    setAngleUnit,
    registerRuntimeAutoFitGroundHandler,
    setActiveJoint: setPanelActiveJoint,
    handleActiveJointChange,
    isDragging,
    setIsDragging,
    isOrbitDragging,
    justSelectedRef,
    transformPendingRef,
    handleRobotLoaded,
    handleJointPanelRobotLoaded,
    handleRuntimeJointAnglesChange,
    handleRuntimeJointAngleChange,
    handleTransformPending,
    handleJointAngleChange,
    handleJointChangeCommit,
    handleResetJoints,
    handleSelectWrapper,
    handleHoverWrapper,
    handleAutoFitGround,
    groundPlaneOffset,
    setGroundPlaneOffset: updateGroundPlaneOffset,
    groundPlaneOffsetReadOnly,
    handleToolModeChange,
    handleCloseMeasureTool,
    handleClosePaintTool,
    handlePointerMissed,
  };
};

export type ViewerController = ReturnType<typeof useViewerController>;
