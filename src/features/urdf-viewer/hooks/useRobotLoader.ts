import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { buildRuntimeRobotFromState, URDFLoader } from '@/core/parsers/urdf/loader';
import { normalizeLoadingProgress } from '@/shared/components/3d/loadingHudState';
import { disposeObject3D } from '../utils/dispose';
import {
  alignRobotToGroundBeforeFirstMount,
  beginInitialGroundAlignment,
  copyRobotRootTransform,
  offsetRobotToGround,
  setInitialGroundAlignment,
  setPreserveAuthoredRootTransform,
} from '../utils/robotPositioning';
import { SHARED_MATERIALS } from '../constants';
import { buildColladaRootNormalizationHints, createLoadingManager } from '@/core/loaders';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import { loadMJCFToThreeJS } from '@/core/parsers/mjcf';
import { getSourceFileDirectory } from '@/core/parsers/meshPathUtils';
import type { UrdfJoint, UrdfLink } from '@/types';
import { setRegressionRuntimeRobot } from '@/shared/debug/regressionBridge';
import { isSingleDofJoint } from '../utils/jointTypes';
import { detectJointPatches, detectSingleGeometryPatch } from '../utils/robotLoaderDiff';
import { applyGeometryPatchInPlace } from '../utils/robotLoaderGeometryPatch';
import { patchJointsInPlace } from '../utils/robotLoaderJointPatch';
import { resolveURDFMaterialsForScene } from '../utils/urdfMaterials';
import { syncLoadedRobotScene } from '../utils/loadedRobotSceneSync';
import { shouldMountRobotBeforeAssetsComplete } from '../utils/loadStrategy';
import { resolveRobotLoaderSourceMetadata } from '../utils/robotLoaderSourceMetadata';
import { createViewerRobotLoadInputSignature } from '../utils/robotLoadScope';
import { resolveViewerRobotSourceFormat } from '../utils/sourceFormat';
import { shouldWaitForStructuredUrdfRobotState } from '../utils/urdfXmlFallbackPolicy';
import { createViewerMeshLoader } from '../utils/createViewerMeshLoader';
import type { RobotLoadingPhase, ViewerDocumentLoadEvent, ViewerRobotSourceFormat } from '../types';

const VIEWER_LOAD_YIELD_BUDGET_MS = 4;

function preprocessURDFForLoader(content: string): string {
  // Remove <transmission> blocks to prevent urdf-loader from finding duplicate joints
  // which can overwrite valid joints with empty origins
  return content.replace(/<transmission[\s\S]*?<\/transmission>/g, '');
}

function waitForLoadingHudPaint(invalidate?: () => void): Promise<void> {
  invalidate?.();

  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function createAssetScopeKey(assets: Record<string, string>): string {
  const assetEntries = Object.entries(assets).sort(([leftPath], [rightPath]) =>
    leftPath.localeCompare(rightPath),
  );
  let hash = 0x811c9dc5;

  for (const [assetPath, assetUrl] of assetEntries) {
    const signature = `${assetPath}\u0000${assetUrl}`;
    for (let index = 0; index < signature.length; index += 1) {
      hash ^= signature.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }

  return `${assetEntries.length}:${(hash >>> 0).toString(36)}`;
}

interface RobotLoadingProgress {
  phase: RobotLoadingPhase;
  progressMode?: ViewerDocumentLoadEvent['progressMode'];
  loadedCount?: number | null;
  totalCount?: number | null;
  progressPercent?: number | null;
}

export interface UseRobotLoaderOptions {
  urdfContent: string;
  assets: Record<string, string>;
  sourceFormat?: ViewerRobotSourceFormat;
  allowUrdfXmlFallback?: boolean;
  reloadToken?: number;
  initialRobot?: THREE.Object3D | null;
  showCollision: boolean;
  showVisual: boolean;
  showCollisionAlwaysOnTop?: boolean;
  isMeshPreview?: boolean;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  initialJointAngles?: Record<string, number>;
  sourceFilePath?: string;
  onRobotLoaded?: (robot: THREE.Object3D) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  groundPlaneOffset?: number;
  showMjcfWorldLink?: boolean;
}

export interface UseRobotLoaderResult {
  robot: THREE.Object3D | null;
  error: string | null;
  isLoading: boolean;
  loadingProgress: RobotLoadingProgress | null;
  robotVersion: number;
  robotRef: RefObject<THREE.Object3D | null>;
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>;
}

interface PendingLoadingDispatch {
  event: ViewerDocumentLoadEvent;
  progress: RobotLoadingProgress | null;
}

function normalizeExternalDocumentLoadEvent(
  event: ViewerDocumentLoadEvent,
): ViewerDocumentLoadEvent {
  if (event.status !== 'loading') {
    return event;
  }

  return normalizeLoadingProgress<ViewerDocumentLoadEvent>(event);
}

function createLoadingDispatchKey(
  progress: RobotLoadingProgress | null,
  event: ViewerDocumentLoadEvent | null,
): string {
  return JSON.stringify({ progress, event });
}

export function useRobotLoader({
  urdfContent,
  assets,
  sourceFormat = 'auto',
  allowUrdfXmlFallback = true,
  reloadToken = 0,
  initialRobot = null,
  showCollision,
  showVisual,
  showCollisionAlwaysOnTop = true,
  isMeshPreview = false,
  robotLinks,
  robotJoints,
  initialJointAngles,
  sourceFilePath,
  onRobotLoaded,
  onDocumentLoadEvent,
  groundPlaneOffset = 0,
  showMjcfWorldLink = false,
}: UseRobotLoaderOptions): UseRobotLoaderResult {
  const sourceFileDir = getSourceFileDirectory(sourceFilePath);
  const resolvedSourceFormat = resolveViewerRobotSourceFormat(urdfContent, sourceFormat);
  const [robot, setRobot] = useState<THREE.Object3D | null>(() => initialRobot);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<RobotLoadingProgress | null>(null);
  const [robotVersion, setRobotVersion] = useState(0);
  const { invalidate } = useThree();

  // Ref to track current robot for proper cleanup (avoids stale closure issues)
  const robotRef = useRef<THREE.Object3D | null>(initialRobot);
  // Track component mount state for preventing state updates after unmount
  const isMountedRef = useRef(true);
  // Track loading abort controller to cancel duplicate loads
  const loadAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
  // Dispose the previously rendered robot only after the new one has had a chance to mount,
  // otherwise the canvas can flash a blank frame during file switching.
  const pendingDisposeRobotRef = useRef<THREE.Object3D | null>(null);
  const pendingDisposeFrameRef = useRef<number | null>(null);
  const groundAlignTimerRef = useRef<number[]>([]);
  const mountedRobotSourceScopeKeyRef = useRef<string | null>(null);
  const mountedRobotReloadTokenRef = useRef<number | null>(null);
  const progressDispatchFrameRef = useRef<number | null>(null);
  const pendingLoadingDispatchRef = useRef<PendingLoadingDispatch | null>(null);
  const lastPublishedLoadingDispatchKeyRef = useRef('');
  const lastPublishedProgressRef = useRef<RobotLoadingProgress | null>(null);
  const onRobotLoadedRef = useRef(onRobotLoaded);
  const onDocumentLoadEventRef = useRef(onDocumentLoadEvent);
  // Ground offset is a presentation-only adjustment; changing it must not
  // restart the robot load pipeline or re-emit loading HUD phases.
  const groundPlaneOffsetRef = useRef(groundPlaneOffset);
  const inFlightLoadScopeKeyRef = useRef<string | null>(null);
  const completedLoadScopeKeyRef = useRef<string | null>(null);

  // Refs for visibility state (used in loading callback)
  const showVisualRef = useRef(showVisual);
  const showCollisionRef = useRef(showCollision);
  const showMjcfWorldLinkRef = useRef(showMjcfWorldLink);
  const showCollisionAlwaysOnTopRef = useRef(showCollisionAlwaysOnTop);
  const initialJointAnglesRef = useRef(initialJointAngles);

  // PERFORMANCE: Pre-built map of linkName -> meshes for O(1) highlight lookup
  const linkMeshMapRef = useRef<Map<string, THREE.Mesh[]>>(new Map());
  // Track previous link snapshot to detect one-link geometry patches
  const prevRobotLinksRef = useRef<Record<string, UrdfLink> | null>(robotLinks || null);
  // Track previous joint snapshot to detect one-joint metadata/origin patches
  const prevRobotJointsRef = useRef<Record<string, UrdfJoint> | null>(robotJoints || null);
  // Skip exactly one upcoming urdfContent-driven full reload per successful
  // incremental patch. A counter is more robust than strict content matching
  // when robotLinks/robotJoints and urdfContent updates are not perfectly in sync.
  const skipReloadCountRef = useRef(0);
  // Force-parse collision meshes for all viewer loads. This removes the
  // deferred URDF collision stream split and keeps the visibility chain single-path.
  const shouldParseCollisionMeshes = true;
  const hasStructuredRobotState =
    resolvedSourceFormat === 'urdf' &&
    Boolean(robotLinks && robotJoints) &&
    (Object.keys(robotLinks ?? {}).length > 0 || Object.keys(robotJoints ?? {}).length > 0);
  const shouldWaitForStructuredRobotState = shouldWaitForStructuredUrdfRobotState({
    resolvedSourceFormat,
    hasStructuredRobotState,
    allowUrdfXmlFallback,
  });
  const currentSourceScopeKey = `${resolvedSourceFormat}:${sourceFilePath ?? '__inline__'}`;
  const loadInputSignature = useMemo(
    () =>
      createViewerRobotLoadInputSignature({
        urdfContent,
        hasStructuredRobotState,
        robotLinks,
        robotJoints,
      }),
    [hasStructuredRobotState, robotJoints, robotLinks, urdfContent],
  );
  const assetScopeKey = useMemo(() => createAssetScopeKey(assets), [assets]);
  const loadScopeKey = useMemo(
    () =>
      [
        currentSourceScopeKey,
        `reload:${reloadToken}`,
        `dir:${sourceFileDir ?? '__root__'}`,
        `input:${loadInputSignature}`,
        `assets:${assetScopeKey}`,
        `structured:${hasStructuredRobotState ? '1' : '0'}`,
        `xml-fallback:${allowUrdfXmlFallback ? '1' : '0'}`,
      ].join('|'),
    [
      allowUrdfXmlFallback,
      assetScopeKey,
      currentSourceScopeKey,
      hasStructuredRobotState,
      loadInputSignature,
      reloadToken,
      sourceFileDir,
    ],
  );

  // Keep refs in sync
  useEffect(() => {
    showVisualRef.current = showVisual;
  }, [showVisual]);
  useEffect(() => {
    showCollisionRef.current = showCollision;
  }, [showCollision]);
  useEffect(() => {
    showMjcfWorldLinkRef.current = showMjcfWorldLink;
  }, [showMjcfWorldLink]);
  useEffect(() => {
    showCollisionAlwaysOnTopRef.current = showCollisionAlwaysOnTop;
  }, [showCollisionAlwaysOnTop]);
  useEffect(() => {
    initialJointAnglesRef.current = initialJointAngles;
  }, [initialJointAngles]);
  useEffect(() => {
    onRobotLoadedRef.current = onRobotLoaded;
  }, [onRobotLoaded]);
  useEffect(() => {
    onDocumentLoadEventRef.current = onDocumentLoadEvent;
  }, [onDocumentLoadEvent]);
  useEffect(() => {
    groundPlaneOffsetRef.current = groundPlaneOffset;
  }, [groundPlaneOffset]);

  const disposeRobotObject = useCallback((robotObject: THREE.Object3D | null) => {
    if (!robotObject) return;
    if (robotObject.parent) {
      robotObject.parent.remove(robotObject);
    }
    disposeObject3D(robotObject, true, SHARED_MATERIALS);
  }, []);

  const flushPendingRobotDispose = useCallback(() => {
    if (pendingDisposeFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(pendingDisposeFrameRef.current);
      pendingDisposeFrameRef.current = null;
    }

    if (pendingDisposeRobotRef.current) {
      const robotToDispose = pendingDisposeRobotRef.current;
      pendingDisposeRobotRef.current = null;
      disposeRobotObject(robotToDispose);
    }
  }, [disposeRobotObject]);

  const clearGroundAlignTimers = useCallback(() => {
    groundAlignTimerRef.current.forEach((timer) => window.clearTimeout(timer));
    groundAlignTimerRef.current = [];
  }, []);

  const emitDocumentLoadEvent = useCallback((event: ViewerDocumentLoadEvent) => {
    const nextEvent = onDocumentLoadEventRef.current
      ? normalizeExternalDocumentLoadEvent(event)
      : event;
    onDocumentLoadEventRef.current?.(nextEvent);
  }, []);

  const applyLoadingDispatch = useCallback(
    (dispatch: PendingLoadingDispatch) => {
      const normalizedExternalEvent = onDocumentLoadEventRef.current
        ? normalizeExternalDocumentLoadEvent(dispatch.event)
        : dispatch.event;
      const dispatchKey = createLoadingDispatchKey(
        onDocumentLoadEventRef.current ? null : dispatch.progress,
        normalizedExternalEvent,
      );
      if (dispatchKey === lastPublishedLoadingDispatchKeyRef.current) {
        return;
      }

      lastPublishedLoadingDispatchKeyRef.current = dispatchKey;
      lastPublishedProgressRef.current = dispatch.progress;
      // AppLayout owns the global loading overlay state for the main viewer.
      // Updating both the local hook state and the external document-load
      // state on every MJCF progress tick can create a render feedback loop
      // during large scene imports such as flybody.
      if (!onDocumentLoadEventRef.current) {
        setLoadingProgress(dispatch.progress);
      }
      emitDocumentLoadEvent(dispatch.event);
    },
    [emitDocumentLoadEvent],
  );

  const flushPendingLoadingDispatch = useCallback(() => {
    if (progressDispatchFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(progressDispatchFrameRef.current);
      progressDispatchFrameRef.current = null;
    }

    const pendingDispatch = pendingLoadingDispatchRef.current;
    pendingLoadingDispatchRef.current = null;
    if (!pendingDispatch) {
      return;
    }

    applyLoadingDispatch(pendingDispatch);
  }, [applyLoadingDispatch]);

  const publishLoadingDispatch = useCallback(
    (
      progress: RobotLoadingProgress | null,
      event: ViewerDocumentLoadEvent,
      options: { defer?: boolean } = {},
    ) => {
      const nextDispatch: PendingLoadingDispatch = { progress, event };

      if (!options.defer) {
        pendingLoadingDispatchRef.current = null;
        flushPendingLoadingDispatch();
        applyLoadingDispatch(nextDispatch);
        return;
      }

      pendingLoadingDispatchRef.current = nextDispatch;

      if (progressDispatchFrameRef.current !== null) {
        return;
      }

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        progressDispatchFrameRef.current = window.requestAnimationFrame(() => {
          progressDispatchFrameRef.current = null;
          flushPendingLoadingDispatch();
        });
        return;
      }

      queueMicrotask(flushPendingLoadingDispatch);
    },
    [applyLoadingDispatch, flushPendingLoadingDispatch],
  );

  const schedulePreviousRobotDispose = useCallback(
    (previousRobot: THREE.Object3D | null) => {
      if (!previousRobot) return;

      flushPendingRobotDispose();
      pendingDisposeRobotRef.current = previousRobot;

      const disposePreviousRobot = () => {
        pendingDisposeFrameRef.current = null;
        const robotToDispose = pendingDisposeRobotRef.current;
        pendingDisposeRobotRef.current = null;

        if (!robotToDispose || robotToDispose === robotRef.current) {
          return;
        }

        disposeRobotObject(robotToDispose);
      };

      if (typeof window !== 'undefined') {
        pendingDisposeFrameRef.current = window.requestAnimationFrame(() => {
          pendingDisposeFrameRef.current = window.requestAnimationFrame(disposePreviousRobot);
        });
        return;
      }

      queueMicrotask(disposePreviousRobot);
    },
    [disposeRobotObject, flushPendingRobotDispose],
  );

  const scheduleGroundAlignment = useCallback(
    (loadedRobot: THREE.Object3D) => {
      if (!beginInitialGroundAlignment(loadedRobot)) {
        return;
      }

      if (typeof window === 'undefined') {
        offsetRobotToGround(loadedRobot, groundPlaneOffsetRef.current);
        return;
      }

      clearGroundAlignTimers();

      groundAlignTimerRef.current = [0, 80, 220, 500].map((delay) =>
        window.setTimeout(() => {
          if (!isMountedRef.current) return;
          if (robotRef.current !== loadedRobot) return;

          offsetRobotToGround(loadedRobot, groundPlaneOffsetRef.current);
          invalidate();
        }, delay),
      );
    },
    [clearGroundAlignTimers, invalidate],
  );

  // Incremental path: update exactly one changed link geometry in-place and skip
  // the next full robot reload. MJCF runtime roots expose the same link/group
  // structure here, so link-local visual edits can stay incremental too.
  useEffect(() => {
    if (isMeshPreview) return;
    if (!robotLinks) return;

    const previousLinks = prevRobotLinksRef.current;
    const currentRobot = robotRef.current;
    prevRobotLinksRef.current = robotLinks;

    if (!previousLinks || !currentRobot) return;
    if (
      mountedRobotSourceScopeKeyRef.current !== currentSourceScopeKey ||
      mountedRobotReloadTokenRef.current !== reloadToken
    ) {
      return;
    }

    const patch = detectSingleGeometryPatch(previousLinks, robotLinks);
    if (!patch) return;

    const colladaRootNormalizationHints = buildColladaRootNormalizationHints(robotLinks);

    const applied = applyGeometryPatchInPlace({
      robotModel: currentRobot,
      patch,
      assets,
      sourceFileDir,
      colladaRootNormalizationHints,
      showVisual: showVisualRef.current,
      showCollision: showCollisionRef.current,
      linkMeshMapRef,
      invalidate,
      isPatchTargetValid: () => isMountedRef.current && robotRef.current === currentRobot,
    });

    if (!applied) return;
    skipReloadCountRef.current += 1;
    setRobotVersion((v) => v + 1);
    setError(null);
  }, [
    robotLinks,
    resolvedSourceFormat,
    urdfContent,
    assets,
    invalidate,
    isMeshPreview,
    sourceFileDir,
  ]);

  // Incremental path: update changed joint metadata/origins in-place and skip
  // the next full robot reload. MJCF runtime joints expose the same mutators,
  // so joint-local edits can stay incremental there as well.
  useEffect(() => {
    if (isMeshPreview) return;
    if (!robotJoints) return;

    const previousJoints = prevRobotJointsRef.current;
    const currentRobot = robotRef.current;
    prevRobotJointsRef.current = robotJoints;

    if (!previousJoints || !currentRobot) return;
    if (
      mountedRobotSourceScopeKeyRef.current !== currentSourceScopeKey ||
      mountedRobotReloadTokenRef.current !== reloadToken
    ) {
      return;
    }

    const patches = detectJointPatches(previousJoints, robotJoints);
    if (!patches || patches.length === 0) return;

    const applied = patchJointsInPlace(currentRobot, patches, invalidate);
    if (!applied) return;
    skipReloadCountRef.current += 1;
    setRobotVersion((v) => v + 1);
    setError(null);
  }, [robotJoints, resolvedSourceFormat, urdfContent, invalidate, isMeshPreview]);

  // Track component mount state for preventing state updates after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Cleanup on unmount ONLY
  useEffect(() => {
    return () => {
      clearGroundAlignTimers();
      flushPendingRobotDispose();
      flushPendingLoadingDispatch();

      // Deep cleanup of robot resources on unmount
      if (robotRef.current) {
        disposeRobotObject(robotRef.current);
        robotRef.current = null;
      }
      mountedRobotSourceScopeKeyRef.current = null;
      mountedRobotReloadTokenRef.current = null;
      inFlightLoadScopeKeyRef.current = null;
      completedLoadScopeKeyRef.current = null;
    };
  }, [
    clearGroundAlignTimers,
    disposeRobotObject,
    flushPendingLoadingDispatch,
    flushPendingRobotDispose,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV || isMeshPreview) {
      return;
    }

    setRegressionRuntimeRobot(robot);

    return () => {
      setRegressionRuntimeRobot(null);
    };
  }, [isMeshPreview, robot]);

  useEffect(() => {
    return () => {
      clearGroundAlignTimers();
    };
  }, [clearGroundAlignTimers]);

  // Load robot with proper cleanup and abort handling
  useEffect(() => {
    if (!urdfContent) return;
    const isMountedForCurrentLoadScope =
      Boolean(robotRef.current) &&
      mountedRobotSourceScopeKeyRef.current === currentSourceScopeKey &&
      mountedRobotReloadTokenRef.current === reloadToken;
    if (
      isMountedForCurrentLoadScope &&
      completedLoadScopeKeyRef.current === loadScopeKey &&
      !error
    ) {
      return;
    }
    if (inFlightLoadScopeKeyRef.current === loadScopeKey && !loadAbortRef.current.aborted) {
      return;
    }
    if (skipReloadCountRef.current > 0) {
      skipReloadCountRef.current -= 1;
      return;
    }

    // Create abort controller for this load
    const abortController = { aborted: false };
    loadAbortRef.current = abortController;
    inFlightLoadScopeKeyRef.current = loadScopeKey;

    const loadRobot = async () => {
      try {
        setIsLoading(true);
        publishLoadingDispatch(
          normalizeLoadingProgress<RobotLoadingProgress>({
            phase: 'preparing-scene',
            progressPercent: null,
          }),
          normalizeLoadingProgress<ViewerDocumentLoadEvent>({
            status: 'loading',
            phase: 'preparing-scene',
            progressPercent: null,
            loadedCount: null,
            totalCount: null,
            message: null,
          }),
        );
        setError(null);
        invalidate?.();

        if (abortController.aborted || !isMountedRef.current) {
          return;
        }

        // NOTE: We do NOT cleanup the previous robot here immediately.
        // We wait until the new robot is ready to avoid flickering/rendering disposed objects.

        let robotModel: THREE.Object3D | null = null;
        let hasMountedRobot = false;
        let preservedRootTransformFromPreviousRobot = false;
        const isMJCFAsset = resolvedSourceFormat === 'mjcf';
        const preserveAuthoredRootTransform = false;
        const urdfMaterials = isMJCFAsset
          ? null
          : resolveURDFMaterialsForScene(urdfContent, robotLinks);

        const syncLoadedRobot = (loadedRobot: THREE.Object3D) => {
          const { changed, linkMeshMap } = syncLoadedRobotScene({
            robot: loadedRobot,
            sourceFormat: resolvedSourceFormat,
            showCollision: showCollisionRef.current,
            showVisual: showVisualRef.current,
            showMjcfWorldLink: showMjcfWorldLinkRef.current,
            showCollisionAlwaysOnTop: showCollisionAlwaysOnTopRef.current,
            urdfMaterials,
            robotLinks,
          });

          linkMeshMapRef.current = linkMeshMap;
          return changed;
        };

        const mountLoadedRobot = (loadedRobot: THREE.Object3D) => {
          if (hasMountedRobot) {
            return;
          }

          if (abortController.aborted || !isMountedRef.current) {
            if (robotRef.current !== loadedRobot) {
              disposeObject3D(loadedRobot, true, SHARED_MATERIALS);
            }
            return;
          }

          hasMountedRobot = true;
          const previousRobot = robotRef.current;
          const shouldPreservePreviousRootTransform =
            Boolean(previousRobot) &&
            mountedRobotSourceScopeKeyRef.current === currentSourceScopeKey;

          setPreserveAuthoredRootTransform(loadedRobot, preserveAuthoredRootTransform);
          syncLoadedRobot(loadedRobot);

          const nextJointAngles = initialJointAnglesRef.current;
          if (nextJointAngles && (loadedRobot as any).joints) {
            Object.entries(nextJointAngles).forEach(([jointName, angle]) => {
              const joint = (loadedRobot as any).joints?.[jointName];
              if (!isSingleDofJoint(joint) || typeof angle !== 'number') {
                return;
              }

              joint.setJointValue?.(angle);
            });
            loadedRobot.updateMatrixWorld(true);
          }

          if (shouldPreservePreviousRootTransform) {
            preservedRootTransformFromPreviousRobot = copyRobotRootTransform(
              previousRobot,
              loadedRobot,
            );
          }

          if (!preservedRootTransformFromPreviousRobot) {
            // Place the robot on the ground before the first visible mount so
            // the scene never shows it popping up from below the grid.
            alignRobotToGroundBeforeFirstMount(loadedRobot, groundPlaneOffsetRef.current);
          }

          robotRef.current = loadedRobot;
          mountedRobotSourceScopeKeyRef.current = currentSourceScopeKey;
          mountedRobotReloadTokenRef.current = reloadToken;
          setRobot(loadedRobot);
          setRobotVersion((v) => v + 1);
          setError(null);
          invalidate();
          if (!preservedRootTransformFromPreviousRobot) {
            scheduleGroundAlignment(loadedRobot);
          }

          if (previousRobot && previousRobot !== loadedRobot) {
            schedulePreviousRobotDispose(previousRobot);
          }
        };

        const finalizeLoadedRobot = async (loadedRobot: THREE.Object3D) => {
          const wasMountedBeforeFinalize = hasMountedRobot;
          mountLoadedRobot(loadedRobot);
          if (abortController.aborted || !isMountedRef.current) {
            return;
          }

          if (wasMountedBeforeFinalize) {
            const changed = syncLoadedRobot(loadedRobot);
            if (changed) {
              setRobotVersion((value) => value + 1);
            }
          }

          setIsLoading(false);
          publishLoadingDispatch(
            null,
            normalizeLoadingProgress({
              status: 'ready',
              phase: 'ready',
              progressPercent: 100,
              loadedCount: null,
              totalCount: null,
              message: null,
            }),
          );
          setError(null);
          completedLoadScopeKeyRef.current = loadScopeKey;
          inFlightLoadScopeKeyRef.current = null;
          invalidate();
          if (wasMountedBeforeFinalize && !preservedRootTransformFromPreviousRobot) {
            setInitialGroundAlignment(loadedRobot, false);
          }
          if (!preservedRootTransformFromPreviousRobot) {
            scheduleGroundAlignment(loadedRobot);
          }
          onRobotLoadedRef.current?.(loadedRobot);
        };

        // Check if content is MJCF (MuJoCo XML)
        if (isMJCFAsset) {
          robotModel = await loadMJCFToThreeJS(
            urdfContent,
            assets,
            sourceFileDir,
            (nextProgress) => {
              if (abortController.aborted || !isMountedRef.current) {
                return;
              }

              const normalizedProgress =
                nextProgress.phase === 'ready'
                  ? null
                  : normalizeLoadingProgress<RobotLoadingProgress>({
                      phase: nextProgress.phase,
                      loadedCount: nextProgress.loadedCount ?? null,
                      totalCount: nextProgress.totalCount ?? null,
                      progressPercent: nextProgress.progressPercent ?? null,
                    });
              if (nextProgress.phase !== 'ready') {
                publishLoadingDispatch(
                  normalizedProgress,
                  normalizeLoadingProgress<ViewerDocumentLoadEvent>({
                    status: 'loading',
                    phase: nextProgress.phase,
                    progressPercent: nextProgress.progressPercent ?? null,
                    loadedCount: nextProgress.loadedCount ?? null,
                    totalCount: nextProgress.totalCount ?? null,
                    message: null,
                  }),
                  { defer: true },
                );
              }
            },
            {
              abortSignal: abortController,
              onAsyncSceneMutation: () => invalidate(),
            },
          );

          if (abortController.aborted) {
            if (robotModel) {
              disposeObject3D(robotModel, true, SHARED_MATERIALS);
            }
            return;
          }

          if (!robotModel) {
            throw new Error('Failed to build MJCF runtime scene.');
          }
        } else {
          // Standard URDF loading
          const urdfDir = sourceFileDir;
          const {
            robotJoints: sourceRobotJoints,
            explicitlyScaledMeshPaths,
            colladaRootNormalizationHints,
          } = resolveRobotLoaderSourceMetadata({
            urdfContent,
            robotLinks,
            robotJoints,
          });
          const manager = createLoadingManager(assets, urdfDir);
          manager.onProgress = (_url, itemsLoaded, itemsTotal) => {
            if (abortController.aborted || !isMountedRef.current) {
              return;
            }

            const adjustedTotalCount = Math.max(0, itemsTotal - 1);
            if (adjustedTotalCount <= 0) {
              return;
            }

            publishLoadingDispatch(
              normalizeLoadingProgress<RobotLoadingProgress>({
                phase: 'streaming-meshes',
                loadedCount: Math.min(itemsLoaded, adjustedTotalCount),
                totalCount: adjustedTotalCount,
                progressPercent: null,
              }),
              normalizeLoadingProgress<ViewerDocumentLoadEvent>({
                status: 'loading',
                phase: 'streaming-meshes',
                progressPercent: null,
                loadedCount: Math.min(itemsLoaded, adjustedTotalCount),
                totalCount: adjustedTotalCount,
                message: null,
              }),
              { defer: true },
            );
          };
          manager.onLoad = () => {
            if (!robotModel) return;
            if (!abortController.aborted && isMountedRef.current) {
              const currentProgress =
                pendingLoadingDispatchRef.current?.progress ?? lastPublishedProgressRef.current;
              const nextProgress: RobotLoadingProgress =
                normalizeLoadingProgress<RobotLoadingProgress>({
                  phase: 'finalizing-scene',
                  loadedCount: currentProgress?.loadedCount ?? null,
                  totalCount: currentProgress?.totalCount ?? null,
                  progressPercent: currentProgress?.progressPercent ?? null,
                });
              publishLoadingDispatch(
                nextProgress,
                normalizeLoadingProgress<ViewerDocumentLoadEvent>({
                  status: 'loading',
                  phase: nextProgress.phase,
                  progressPercent: nextProgress.progressPercent ?? null,
                  loadedCount: nextProgress.loadedCount ?? null,
                  totalCount: nextProgress.totalCount ?? null,
                  message: null,
                }),
              );
            }
            void finalizeLoadedRobot(robotModel);
          };
          // Use new local URDFLoader
          const loader = new URDFLoader(manager);
          const yieldIfNeeded = createMainThreadYieldController(VIEWER_LOAD_YIELD_BUDGET_MS);
          loader.parseCollision = shouldParseCollisionMeshes;
          loader.parseVisual = true;
          loader.loadMeshCb = createViewerMeshLoader(assets, manager, urdfDir, {
            colladaRootNormalizationHints,
            explicitScaleMeshPaths: explicitlyScaledMeshPaths,
            yieldIfNeeded,
          });
          loader.packages = '';

          const loadCompletionKey = '__urdf_studio_robot_finalize__';
          manager.itemStart(loadCompletionKey);
          try {
            // The editor already has canonical link/joint state in the hot path.
            // Rebuilding the runtime scene from that state avoids a second URDF XML parse.
            // Initial imports can surface urdfContent one render before the
            // structured robot store is populated. When that happens, the first
            // load can be aborted during view orchestration and must re-run once
            // the canonical link/joint state is available.
            if (hasStructuredRobotState) {
              robotModel = await buildRuntimeRobotFromState({
                links: robotLinks!,
                joints: robotJoints!,
                manager,
                loadMeshCb: loader.loadMeshCb,
                parseVisual: true,
                parseCollision: shouldParseCollisionMeshes,
                yieldIfNeeded,
              });
            } else {
              if (shouldWaitForStructuredRobotState) {
                return;
              }

              const cleanContent = preprocessURDFForLoader(urdfContent);
              robotModel = await loader.parseAsync(cleanContent, loader.workingPath, {
                yieldIfNeeded,
              });
              if (sourceRobotJoints && (robotModel as any).joints) {
                Object.entries((robotModel as any).joints).forEach(
                  ([name, joint]: [string, any]) => {
                    const parsedJoint = sourceRobotJoints[name];
                    if (parsedJoint && parsedJoint.limit) {
                      if (!joint.limit) joint.limit = {};
                      joint.limit.effort = parsedJoint.limit.effort;
                      joint.limit.velocity = parsedJoint.limit.velocity;
                      if (joint.limit.lower === undefined)
                        joint.limit.lower = parsedJoint.limit.lower;
                      if (joint.limit.upper === undefined)
                        joint.limit.upper = parsedJoint.limit.upper;
                    }
                  },
                );
              }
            }

            if (abortController.aborted) {
              if (robotModel) {
                disposeObject3D(robotModel, true, SHARED_MATERIALS);
              }
              return;
            }

            if (shouldMountRobotBeforeAssetsComplete(resolvedSourceFormat)) {
              mountLoadedRobot(robotModel);
            }
          } finally {
            manager.itemEnd(loadCompletionKey);
          }

          return;
        }

        if (robotModel && isMountedRef.current) {
          const currentProgress =
            pendingLoadingDispatchRef.current?.progress ?? lastPublishedProgressRef.current;
          const nextProgress =
            currentProgress ??
            normalizeLoadingProgress<RobotLoadingProgress>({
              phase: 'finalizing-scene',
              loadedCount: null,
              totalCount: null,
              progressPercent: null,
            });
          publishLoadingDispatch(
            nextProgress,
            normalizeLoadingProgress<ViewerDocumentLoadEvent>({
              status: 'loading',
              phase: 'finalizing-scene',
              progressPercent: nextProgress.progressPercent ?? null,
              loadedCount: nextProgress.loadedCount ?? null,
              totalCount: nextProgress.totalCount ?? null,
              message: null,
            }),
          );
          void finalizeLoadedRobot(robotModel);
        } else if (robotModel) {
          // Aborted or unmounted after load but before we could use it
          disposeObject3D(robotModel, true, SHARED_MATERIALS);
        }
      } catch (err) {
        if (!abortController.aborted && isMountedRef.current) {
          console.error('[EditorViewer] Failed to load URDF:', err);
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          setError(errorMessage);
          setIsLoading(false);
          completedLoadScopeKeyRef.current = null;
          inFlightLoadScopeKeyRef.current = null;
          publishLoadingDispatch(null, {
            status: 'error',
            phase: null,
            progressMode: null,
            progressPercent: null,
            loadedCount: null,
            totalCount: null,
            message: null,
            error: errorMessage,
          });
        }
      }
    };

    loadRobot();

    // Cleanup function - runs when dependencies change
    return () => {
      // Mark this load as aborted to prevent state updates
      abortController.aborted = true;
      if (inFlightLoadScopeKeyRef.current === loadScopeKey) {
        inFlightLoadScopeKeyRef.current = null;
      }
      clearGroundAlignTimers();

      // NOTE: We do NOT dispose robotRef.current here.
      // We allow the old robot to persist until the new one is ready,
      // or until the component unmounts (handled by the separate useEffect).
    };
  }, [
    assets,
    clearGroundAlignTimers,
    currentSourceScopeKey,
    error,
    allowUrdfXmlFallback,
    hasStructuredRobotState,
    invalidate,
    loadScopeKey,
    publishLoadingDispatch,
    reloadToken,
    resolvedSourceFormat,
    scheduleGroundAlignment,
    shouldParseCollisionMeshes,
    sourceFileDir,
    urdfContent,
  ]);

  return {
    robot,
    error,
    isLoading,
    loadingProgress,
    robotVersion,
    robotRef,
    linkMeshMapRef,
  };
}
