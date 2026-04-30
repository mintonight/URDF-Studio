/**
 * Unified Renderer Backend Hook
 *
 * Manages the lifecycle of a RobotRendererBackend instance and provides
 * a consistent interface for loading and rendering robots across all formats.
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import {
  createRendererBackend,
  type RobotRendererBackend,
  type RendererSceneProps,
} from '@/shared/components/3d/renderers';
import type { UrdfJoint, UrdfLink } from '@/types';
import type { ViewerDocumentLoadEvent, ViewerRuntimeStageBridge } from '../types';
import { createRendererBackendLoadScopeKey } from '../utils/rendererBackendLoadScope';

export interface UseRendererBackendOptions extends RendererSceneProps {
  /** Reload token to force re-loading */
  reloadToken?: number;
  /** Initial robot object (for hot reloading) */
  initialRobot?: THREE.Object3D | null;
  /** Callback when robot is loaded */
  onRobotLoaded?: (robot: THREE.Object3D) => void;
}

export interface UseRendererBackendResult {
  /** The robot scene object */
  robot: THREE.Object3D | null;
  /** Map of link ID to meshes */
  linkMeshMapRef: React.RefObject<Map<string, THREE.Mesh[]>>;
  /** Robot links data */
  robotLinks: Record<string, UrdfLink>;
  /** Robot joints data */
  robotJoints: Record<string, UrdfJoint>;
  /** Root link ID */
  rootLinkId: string | null;
  /** Backend instance */
  backend: RobotRendererBackend | null;
  /** Whether currently loading */
  isLoading: boolean;
  /** Loading progress */
  loadingProgress: ViewerDocumentLoadEvent | null;
  /** Runtime version for change tracking */
  robotVersion: number;
  /** Robot reference */
  robotRef: React.RefObject<THREE.Object3D | null>;
  /** Error message if loading failed */
  error: string | null;
}

export function useRendererBackend(
  options: UseRendererBackendOptions,
): UseRendererBackendResult {
  const threeState = useThree();
  const { invalidate, camera, scene } = threeState;
  const controls = (threeState as typeof threeState & { controls?: unknown }).controls;
  const {
    sourceFile,
    availableFiles,
    assets,
    groundPlaneOffset,
    showVisual,
    showCollision,
    showCollisionAlwaysOnTop,
    robotLinks: providedRobotLinks,
    robotJoints: providedRobotJoints,
    robotData,
    initialJointAngles,
    onRuntimeRobotLoaded,
    runtimeBridge,
    reloadToken = 0,
    initialRobot = null,
    onRobotLoaded,
    onDocumentLoadEvent,
  } = options;

  // State
  const [robot, setRobot] = useState<THREE.Object3D | null>(() => initialRobot);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<ViewerDocumentLoadEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [robotVersion, setRobotVersion] = useState(0);
  const [resolvedRobotLinks, setResolvedRobotLinks] = useState<Record<string, UrdfLink>>(
    () => robotData?.links ?? providedRobotLinks ?? {},
  );
  const [resolvedRobotJoints, setResolvedRobotJoints] = useState<Record<string, UrdfJoint>>(
    () => robotData?.joints ?? providedRobotJoints ?? {},
  );
  const [resolvedRootLinkId, setResolvedRootLinkId] = useState<string | null>(
    () => robotData?.rootLinkId ?? null,
  );

  // Refs
  const robotRef = useRef<THREE.Object3D | null>(initialRobot);
  const backendRef = useRef<RobotRendererBackend | null>(null);
  const inFlightBackendRef = useRef<RobotRendererBackend | null>(null);
  const pendingDisposeBackendRef = useRef<RobotRendererBackend | null>(null);
  const pendingDisposeFrameARef = useRef<number | null>(null);
  const pendingDisposeFrameBRef = useRef<number | null>(null);
  const linkMeshMapRef = useRef<Map<string, THREE.Mesh[]>>(new Map());
  const isMountedRef = useRef(true);
  const loadIdRef = useRef(0);
  const onRobotLoadedRef = useRef(onRobotLoaded);
  const onDocumentLoadEventRef = useRef(onDocumentLoadEvent);
  const onRuntimeRobotLoadedRef = useRef(onRuntimeRobotLoaded);
  const runtimeBridgeRef = useRef(runtimeBridge);
  const runtimeBridgeProxyRef = useRef<ViewerRuntimeStageBridge>({
    onRobotResolved: (robot) => runtimeBridgeRef.current?.onRobotResolved?.(robot),
    onSelectionChange: (type, id, subType, helperKind) =>
      runtimeBridgeRef.current?.onSelectionChange?.(type, id, subType, helperKind),
    onActiveJointChange: (jointName) =>
      runtimeBridgeRef.current?.onActiveJointChange?.(jointName),
    onJointAnglesChange: (jointAngles) =>
      runtimeBridgeRef.current?.onJointAnglesChange?.(jointAngles),
  });

  const loadScopeKey = useMemo(
    () =>
      createRendererBackendLoadScopeKey({
        sourceFile,
        availableFiles,
        assets,
        reloadToken,
        robotLinks: providedRobotLinks,
        robotJoints: providedRobotJoints,
        robotData,
      }),
    [
      assets,
      availableFiles,
      providedRobotJoints,
      providedRobotLinks,
      reloadToken,
      robotData,
      sourceFile,
    ],
  );

  const emitDocumentLoadEvent = useCallback((event: ViewerDocumentLoadEvent) => {
    if (!isMountedRef.current) return;
    setLoadingProgress(event);
    onDocumentLoadEventRef.current?.(event);
  }, []);

  const latestScenePropsRef = useRef<RendererSceneProps | null>(null);
  latestScenePropsRef.current = {
    sourceFile,
    availableFiles,
    assets,
    groundPlaneOffset,
    showVisual,
    showCollision,
    showCollisionAlwaysOnTop,
    robotLinks: providedRobotLinks,
    robotJoints: providedRobotJoints,
    robotData,
    initialJointAngles,
    onRuntimeRobotLoaded: (runtimeRobot) => onRuntimeRobotLoadedRef.current?.(runtimeRobot),
    runtimeBridge: runtimeBridge ? runtimeBridgeProxyRef.current : undefined,
    runtimeHost: { camera, scene, controls },
    invalidate,
    onDocumentLoadEvent: emitDocumentLoadEvent,
  };

  // Keep refs in sync
  useEffect(() => {
    onRobotLoadedRef.current = onRobotLoaded;
  }, [onRobotLoaded]);

  useEffect(() => {
    onDocumentLoadEventRef.current = onDocumentLoadEvent;
  }, [onDocumentLoadEvent]);

  useEffect(() => {
    onRuntimeRobotLoadedRef.current = onRuntimeRobotLoaded;
  }, [onRuntimeRobotLoaded]);

  useEffect(() => {
    runtimeBridgeRef.current = runtimeBridge;
  }, [runtimeBridge]);

  // Sync robot state with ref
  useEffect(() => {
    robotRef.current = robot;
  }, [robot]);

  // Track component mount state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const flushPendingBackendDispose = useCallback(() => {
    if (pendingDisposeFrameARef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(pendingDisposeFrameARef.current);
      pendingDisposeFrameARef.current = null;
    }
    if (pendingDisposeFrameBRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(pendingDisposeFrameBRef.current);
      pendingDisposeFrameBRef.current = null;
    }

    const backend = pendingDisposeBackendRef.current;
    pendingDisposeBackendRef.current = null;
    if (backend && backend !== backendRef.current && backend !== inFlightBackendRef.current) {
      backend.dispose();
    }
  }, []);

  const scheduleBackendDispose = useCallback(
    (backend: RobotRendererBackend | null) => {
      if (!backend || backend === backendRef.current || backend === inFlightBackendRef.current) {
        return;
      }

      flushPendingBackendDispose();
      pendingDisposeBackendRef.current = backend;

      const disposePendingBackend = () => {
        pendingDisposeFrameARef.current = null;
        pendingDisposeFrameBRef.current = null;
        const pendingBackend = pendingDisposeBackendRef.current;
        pendingDisposeBackendRef.current = null;
        if (
          pendingBackend &&
          pendingBackend !== backendRef.current &&
          pendingBackend !== inFlightBackendRef.current
        ) {
          pendingBackend.dispose();
        }
      };

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        pendingDisposeFrameARef.current = window.requestAnimationFrame(() => {
          pendingDisposeFrameARef.current = null;
          pendingDisposeFrameBRef.current = window.requestAnimationFrame(disposePendingBackend);
        });
        return;
      }

      queueMicrotask(disposePendingBackend);
    },
    [flushPendingBackendDispose],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      flushPendingBackendDispose();
      if (inFlightBackendRef.current && inFlightBackendRef.current !== backendRef.current) {
        inFlightBackendRef.current.dispose();
        inFlightBackendRef.current = null;
      }
      if (backendRef.current) {
        backendRef.current.dispose();
        backendRef.current = null;
      }
    };
  }, [flushPendingBackendDispose]);

  // Load robot
  useEffect(() => {
    const sceneProps = latestScenePropsRef.current;
    if (!sceneProps?.sourceFile) return;

    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;

    if (inFlightBackendRef.current && inFlightBackendRef.current !== backendRef.current) {
      inFlightBackendRef.current.dispose();
      inFlightBackendRef.current = null;
    }

    const backend = createRendererBackend(sceneProps);
    inFlightBackendRef.current = backend;

    const loadRobot = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load robot
        const sceneGraph = await backend.load(sceneProps);

        if (!isMountedRef.current || loadIdRef.current !== loadId) {
          if (inFlightBackendRef.current === backend) {
            inFlightBackendRef.current = null;
          }
          backend.dispose();
          return;
        }

        const previousBackend = backendRef.current;
        backendRef.current = backend;
        if (inFlightBackendRef.current === backend) {
          inFlightBackendRef.current = null;
        }

        // Update state
        robotRef.current = sceneGraph.root;
        setRobot(sceneGraph.root);
        linkMeshMapRef.current = sceneGraph.linkMeshMap;
        setResolvedRobotLinks(sceneGraph.robotLinks);
        setResolvedRobotJoints(sceneGraph.robotJoints);
        setResolvedRootLinkId(sceneGraph.rootLinkId);
        setRobotVersion((v) => v + 1);
        setIsLoading(false);
        setLoadingProgress(null);

        // Notify callbacks
        if (sceneGraph.root) {
          onRobotLoadedRef.current?.(sceneGraph.root);
        }
        if (previousBackend && previousBackend !== backend) {
          scheduleBackendDispose(previousBackend);
        }
        invalidate?.();
      } catch (err) {
        if (!isMountedRef.current || loadIdRef.current !== loadId) return;
        if (inFlightBackendRef.current === backend) {
          inFlightBackendRef.current = null;
        }
        backend.dispose();

        console.error('[useRendererBackend] Failed to load robot:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        setIsLoading(false);
        setLoadingProgress({
          status: 'error',
          phase: null,
          progressMode: null,
          progressPercent: null,
          loadedCount: null,
          totalCount: null,
          message: null,
          error: errorMessage,
        });
        onDocumentLoadEventRef.current?.({
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
    };

    loadRobot();

    return () => {
      if (loadIdRef.current === loadId) {
        loadIdRef.current += 1;
      }
      if (inFlightBackendRef.current === backend) {
        inFlightBackendRef.current = null;
        backend.dispose();
      }
    };
  }, [invalidate, loadScopeKey, scheduleBackendDispose]);

  return {
    robot,
    linkMeshMapRef,
    robotLinks: resolvedRobotLinks,
    robotJoints: resolvedRobotJoints,
    rootLinkId: resolvedRootLinkId,
    backend: backendRef.current,
    isLoading,
    loadingProgress,
    robotVersion,
    robotRef,
    error,
  };
}
