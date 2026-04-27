import { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { findStandaloneXacroTruthFile } from '@/core/parsers/importRobotFile';
import { resolveMJCFSource } from '@/core/parsers/mjcf/mjcfSourceResolver';
import { mergeAssembly } from '@/core/robot';
import {
  DEFAULT_LINK,
  GeometryType,
  type AssemblyState,
  type BridgeJoint,
  type JointQuaternion,
  type RobotClosedLoopConstraint,
  type RobotData,
  type RobotFile,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';
import { stripTransientJointMotionFromJoints } from '@/shared/utils/robot/semanticSnapshot';
import {
  getSourceCodeDocumentFlavor,
  type SourceCodeDocumentFlavor,
} from '@/app/utils/sourceCodeDisplay';
import {
  buildSourceCodeDocuments,
  type SourceCodeDocumentDescriptor,
} from '@/app/utils/sourceCodeDocuments';
import {
  areJointSourceCompatible,
  buildVisibleAssemblyState,
} from './workspace-source-sync/compatibility';
import { useDeferredWorkspaceSourceSync } from './workspace-source-sync/useDeferredWorkspaceSourceSync';
import { useGeneratedRobotSource } from './workspace-source-sync/useGeneratedRobotSource';
import {
  resolveStandaloneViewerContent,
  resolveStandaloneViewerSourceFormat,
} from './workspace-source-sync/mjcfViewerRuntimePolicy';
import { useMjcfViewerEditState } from './workspace-source-sync/useMjcfViewerEditState';
import { useSelectedSourceSnapshots } from './workspace-source-sync/useSelectedSourceSnapshots';
import { useSourceEditBaseline } from './workspace-source-sync/useSourceEditBaseline';
import { useWorkspaceFilePreview } from './workspace-source-sync/useWorkspaceFilePreview';
import { useWorkspaceTextFileSync } from './workspace-source-sync/useWorkspaceTextFileSync';
import {
  buildSingleComponentWorkspaceMjcfViewerContent,
  buildLightweightWorkspaceViewerReloadContent,
  buildWorkspaceAssemblyViewerState,
  buildWorkspaceAssemblyViewerDisplayRobotData,
  buildWorkspaceViewerRobotData,
  createRobotSourceSnapshot,
  getWorkspaceAssemblyRenderFailureReason,
  getPreferredMjcfContent,
  getPreferredSdfContent,
  getPreferredUrdfContent,
  getWorkspaceAssemblyViewerRobotData,
  getSingleComponentWorkspaceMjcfViewerSource,
  isActiveWorkspaceTransformSession,
  normalizeWorkspaceAssemblyViewerDisplayRobotDataForSource,
  shouldKeepPristineSingleComponentWorkspaceOnSourceViewer,
  shouldUseGeneratedWorkspaceViewerReloadContent,
} from './workspaceSourceSyncUtils';
import { useAnimatedWorkspaceViewerRobotData } from './useAnimatedWorkspaceViewerRobotData';
import {
  readStoredWorkspaceViewerShowVisualPreference,
  resolveWorkspaceViewerShowVisual,
} from './workspaceViewerDetailPreferences';
import {
  resolveWorkspaceViewerFallbackRobot,
  resolveWorkspaceViewerRobot,
  shouldPersistStableWorkspaceViewerRobot,
  shouldAnimateWorkspaceViewerRobot,
} from './workspaceViewerPresentation';

export interface JointMotionStateValue {
  angle?: number;
  quaternion?: JointQuaternion;
}

interface UseWorkspaceSourceSyncOptions {
  assemblyState: AssemblyState | null;
  assemblyRevision: number;
  assemblyBridgePreview?: BridgeJoint | null;
  assemblySelection?: { type: 'assembly' | 'component' | null; id: string | null };
  workspaceTransformPending: boolean;
  sidebarTab: string;
  selection: RobotState['selection'];
  robotName: string;
  robotLinks: Record<string, UrdfLink>;
  robotJoints: Record<string, UrdfJoint>;
  rootLinkId: string;
  robotMaterials?: RobotState['materials'];
  closedLoopConstraints?: RobotClosedLoopConstraint[];
  isCodeViewerOpen: boolean;
  selectedFile: RobotFile | null;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  originalUrdfContent: string | null;
  isSelectedUsdHydrating: boolean;
  assets: Record<string, string>;
  getUsdPreparedExportCache: (path: string) => { robotData?: RobotData } | null;
  setSelectedFile: (file: RobotFile | null) => void;
  setAvailableFiles: (files: RobotFile[]) => void;
  setAllFileContents: (contents: Record<string, string>) => void;
  setOriginalUrdfContent: (content: string | null) => void;
}

export function useWorkspaceSourceSync({
  assemblyState,
  assemblyRevision,
  assemblyBridgePreview = null,
  assemblySelection,
  workspaceTransformPending,
  sidebarTab,
  selection,
  robotName,
  robotLinks,
  robotJoints,
  rootLinkId,
  robotMaterials,
  closedLoopConstraints,
  isCodeViewerOpen,
  selectedFile,
  availableFiles,
  allFileContents,
  originalUrdfContent,
  isSelectedUsdHydrating,
  assets,
  getUsdPreparedExportCache,
  setSelectedFile,
  setAvailableFiles,
  setAllFileContents,
  setOriginalUrdfContent,
}: UseWorkspaceSourceSyncOptions) {
  const generatedSourceCacheRef = useRef(new Map<string, string>());
  const lastStableWorkspaceViewerGeneratedUrdfContentRef = useRef<string | null>(null);
  const isWorkspaceAssembly = Boolean(assemblyState && sidebarTab === 'workspace');
  const hasWorkspaceComponents = Boolean(
    assemblyState && Object.keys(assemblyState.components).length > 0,
  );
  const sourceJointsRef = useRef<Record<string, UrdfJoint>>({});
  const { filePreview, previewRobot, previewFileName, handlePreviewFile, handleClosePreview } =
    useWorkspaceFilePreview({
      availableFiles,
      assets,
      allFileContents,
      getUsdPreparedExportCache,
    });
  const activeSourceFile = useMemo(() => selectedFile, [selectedFile]);
  const sourceCodeDocumentFlavor = useMemo<SourceCodeDocumentFlavor>(
    () => getSourceCodeDocumentFlavor(activeSourceFile),
    [activeSourceFile],
  );
  const sourceRobotJoints = useMemo(() => {
    if (areJointSourceCompatible(sourceJointsRef.current, robotJoints)) {
      return sourceJointsRef.current;
    }

    const nextSourceJoints = stripTransientJointMotionFromJoints(robotJoints);
    sourceJointsRef.current = nextSourceJoints;
    return nextSourceJoints;
  }, [robotJoints]);
  const currentRobotSourceState = useMemo<RobotState>(
    () => ({
      name: robotName,
      links: robotLinks,
      joints: sourceRobotJoints,
      rootLinkId,
      materials: robotMaterials,
      closedLoopConstraints,
      selection: { type: null, id: null },
    }),
    [closedLoopConstraints, robotLinks, robotMaterials, robotName, rootLinkId, sourceRobotJoints],
  );
  const currentRobotSourceSnapshot = useMemo(
    () => createRobotSourceSnapshot(currentRobotSourceState),
    [currentRobotSourceState],
  );
  const selectedFileReuseBaselineRobotData = useMemo(() => {
    if (selectedFile?.format !== 'usd') {
      return null;
    }

    return getUsdPreparedExportCache(selectedFile.name)?.robotData ?? null;
  }, [getUsdPreparedExportCache, selectedFile]);
  const shouldReuseSelectedFileViewerForWorkspace = useMemo(
    () =>
      isWorkspaceAssembly &&
      hasWorkspaceComponents &&
      shouldKeepPristineSingleComponentWorkspaceOnSourceViewer({
        assemblyState,
        activeFile: selectedFile,
        sourceSnapshot: currentRobotSourceSnapshot,
        sourceRobotData: selectedFileReuseBaselineRobotData,
        assemblySelectionType: assemblySelection?.type ?? null,
      }),
    [
      assemblySelection?.type,
      assemblyState,
      currentRobotSourceSnapshot,
      selectedFileReuseBaselineRobotData,
      hasWorkspaceComponents,
      isWorkspaceAssembly,
      selectedFile,
    ],
  );
  const sourceSceneAssemblyComponentId = useMemo(() => {
    if (!shouldReuseSelectedFileViewerForWorkspace || !assemblyState) {
      return null;
    }

    const visibleComponents = Object.values(assemblyState.components).filter(
      (component) => component.visible !== false,
    );
    if (visibleComponents.length !== 1 || Object.keys(assemblyState.bridges).length > 0) {
      return null;
    }

    return visibleComponents[0]?.id ?? null;
  }, [assemblyState, shouldReuseSelectedFileViewerForWorkspace]);
  // Keep the current robot rendered while the workspace is empty or still a
  // pristine single-component seed so switching to workspace does not trigger
  // a redundant viewer reload before the assembly actually diverges.
  const shouldRenderAssembly =
    isWorkspaceAssembly && hasWorkspaceComponents && !shouldReuseSelectedFileViewerForWorkspace;
  const hasActiveWorkspaceTransformTarget = useMemo(
    () =>
      isActiveWorkspaceTransformSession({
        shouldRenderAssembly,
        shouldReuseSelectedFileViewerForWorkspace,
        workspaceTransformPending,
      }),
    [shouldRenderAssembly, shouldReuseSelectedFileViewerForWorkspace, workspaceTransformPending],
  );
  const previousShouldRenderAssemblyRef = useRef(shouldRenderAssembly);
  const lastStableViewerRobotRef = useRef<RobotState | null>(null);
  const deferredAssemblyState = useDeferredValue(assemblyState);
  const isPreviewingAssemblyBridge = shouldRenderAssembly && Boolean(assemblyBridgePreview);
  const assemblyStateForViewerDisplay = isPreviewingAssemblyBridge
    ? assemblyState
    : deferredAssemblyState;
  const visibleAssemblyStateForViewerDisplay = useMemo(
    () => (shouldRenderAssembly ? buildVisibleAssemblyState(assemblyStateForViewerDisplay) : null),
    [assemblyStateForViewerDisplay, shouldRenderAssembly],
  );
  const mergedRobotData = useMemo(() => {
    if (!shouldRenderAssembly || !visibleAssemblyStateForViewerDisplay) {
      return null;
    }

    return mergeAssembly(visibleAssemblyStateForViewerDisplay);
  }, [shouldRenderAssembly, visibleAssemblyStateForViewerDisplay]);
  const viewerAssemblyState = useMemo(() => {
    if (!shouldRenderAssembly || !visibleAssemblyStateForViewerDisplay) {
      return null;
    }

    return buildWorkspaceAssemblyViewerState({
      assemblyState: visibleAssemblyStateForViewerDisplay,
      bridgePreview: assemblyBridgePreview,
    });
  }, [assemblyBridgePreview, shouldRenderAssembly, visibleAssemblyStateForViewerDisplay]);
  const viewerMergedRobotData = useMemo(() => {
    if (!shouldRenderAssembly || !visibleAssemblyStateForViewerDisplay) {
      return null;
    }

    return getWorkspaceAssemblyViewerRobotData({
      assemblyState: visibleAssemblyStateForViewerDisplay,
      fallbackMergedRobotData: mergedRobotData,
      bridgePreview: assemblyBridgePreview,
    });
  }, [
    assemblyBridgePreview,
    mergedRobotData,
    shouldRenderAssembly,
    visibleAssemblyStateForViewerDisplay,
  ]);
  const workspaceAssemblyRenderFailureReason = useMemo(
    () =>
      getWorkspaceAssemblyRenderFailureReason({
        shouldRenderAssembly,
        hasDisplayAssemblyState: Boolean(visibleAssemblyStateForViewerDisplay),
        mergedRobotData,
        viewerMergedRobotData,
      }),
    [
      mergedRobotData,
      shouldRenderAssembly,
      viewerMergedRobotData,
      visibleAssemblyStateForViewerDisplay,
    ],
  );
  const deferredShouldRenderAssembly = useDeferredValue(shouldRenderAssembly);
  const deferredViewerAssemblyState = useDeferredValue(viewerAssemblyState);
  const deferredViewerMergedRobotData = useDeferredValue(viewerMergedRobotData);
  const deferredWorkspaceAssemblyRenderFailureReason = useDeferredValue(
    workspaceAssemblyRenderFailureReason,
  );
  const workspaceViewerAssemblyStateForDisplay = isPreviewingAssemblyBridge
    ? viewerAssemblyState
    : deferredViewerAssemblyState;
  const workspaceViewerMergedRobotDataForDisplay = isPreviewingAssemblyBridge
    ? viewerMergedRobotData
    : deferredViewerMergedRobotData;
  const workspaceAssemblyRenderFailureReasonForDisplay = isPreviewingAssemblyBridge
    ? workspaceAssemblyRenderFailureReason
    : deferredWorkspaceAssemblyRenderFailureReason;
  const animateWorkspaceViewerRobot = shouldAnimateWorkspaceViewerRobot({
    shouldRenderAssembly,
    previouslyRenderedAssembly: previousShouldRenderAssemblyRef.current,
    isPreviewingAssemblyBridge,
  });

  const emptyRobot = useMemo<RobotState>(
    () => ({
      name: '',
      links: {
        empty_root: {
          ...DEFAULT_LINK,
          id: 'empty_root',
          name: 'base_link',
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
          },
          inertial: {
            ...DEFAULT_LINK.inertial,
            mass: 0,
          },
        },
      },
      joints: {},
      rootLinkId: 'empty_root',
      selection: { type: null, id: null },
    }),
    [],
  );
  const workspaceViewerRobotData = useMemo(() => {
    if (!deferredShouldRenderAssembly) {
      return null;
    }

    if (
      workspaceAssemblyRenderFailureReasonForDisplay ||
      !workspaceViewerMergedRobotDataForDisplay
    ) {
      return null;
    }

    return (
      buildWorkspaceAssemblyViewerDisplayRobotData({
        assemblyState: workspaceViewerAssemblyStateForDisplay,
        mergedRobotData: workspaceViewerMergedRobotDataForDisplay,
      }) ?? buildWorkspaceViewerRobotData(workspaceViewerMergedRobotDataForDisplay)
    );
  }, [
    deferredShouldRenderAssembly,
    workspaceAssemblyRenderFailureReasonForDisplay,
    workspaceViewerAssemblyStateForDisplay,
    workspaceViewerMergedRobotDataForDisplay,
  ]);
  const animatedWorkspaceViewerRobotData = useAnimatedWorkspaceViewerRobotData(
    workspaceViewerRobotData,
    animateWorkspaceViewerRobot,
  );

  const sourceViewerRobot = useMemo<RobotState>(() => {
    if (isSelectedUsdHydrating) {
      return emptyRobot;
    }

    return {
      name: robotName,
      links: robotLinks,
      joints: robotJoints,
      rootLinkId,
      materials: robotMaterials,
      closedLoopConstraints,
      selection,
    };
  }, [
    closedLoopConstraints,
    emptyRobot,
    isSelectedUsdHydrating,
    robotJoints,
    robotLinks,
    robotMaterials,
    robotName,
    rootLinkId,
    selection,
  ]);
  const robot = useMemo<RobotState>(() => {
    if (shouldRenderAssembly) {
      if (mergedRobotData) {
        return { ...mergedRobotData, selection };
      }

      return emptyRobot;
    }

    return sourceViewerRobot;
  }, [emptyRobot, mergedRobotData, selection, shouldRenderAssembly, sourceViewerRobot]);
  const hasWorkspaceDisplayRobot = Boolean(
    animatedWorkspaceViewerRobotData ?? workspaceViewerRobotData,
  );
  // Preserve the last painted scene until the workspace viewer has a real
  // display robot, so switching into Professional mode does not flash empty.
  const viewerFallbackRobot = useMemo(
    () =>
      resolveWorkspaceViewerFallbackRobot({
        shouldRenderAssembly,
        hasWorkspaceDisplayRobot,
        hasWorkspaceRenderFailure: Boolean(workspaceAssemblyRenderFailureReasonForDisplay),
        liveRobot: workspaceAssemblyRenderFailureReasonForDisplay ? emptyRobot : sourceViewerRobot,
        lastStableViewerRobot: lastStableViewerRobotRef.current,
        selection,
      }),
    [
      emptyRobot,
      hasWorkspaceDisplayRobot,
      selection,
      shouldRenderAssembly,
      sourceViewerRobot,
      workspaceAssemblyRenderFailureReasonForDisplay,
    ],
  );
  const viewerRobot = useMemo<RobotState>(
    () =>
      resolveWorkspaceViewerRobot({
        shouldRenderAssembly,
        liveRobot: viewerFallbackRobot,
        workspaceViewerRobotData,
        animatedWorkspaceViewerRobotData,
        selection,
      }),
    [
      animatedWorkspaceViewerRobotData,
      viewerFallbackRobot,
      selection,
      shouldRenderAssembly,
      workspaceViewerRobotData,
    ],
  );

  useEffect(() => {
    previousShouldRenderAssemblyRef.current = shouldRenderAssembly;
  }, [shouldRenderAssembly]);

  useEffect(() => {
    if (
      !shouldPersistStableWorkspaceViewerRobot({
        shouldRenderAssembly,
        hasWorkspaceDisplayRobot,
      })
    ) {
      return;
    }

    lastStableViewerRobotRef.current = viewerRobot;
  }, [hasWorkspaceDisplayRobot, shouldRenderAssembly, viewerRobot]);

  const jointAngleState = useMemo(() => {
    const angles: Record<string, number> = {};
    Object.values(robot.joints).forEach((joint) => {
      const angle = (joint as UrdfJoint & { angle?: number }).angle;
      if (angle !== undefined) {
        angles[joint.name] = angle;
      }
    });

    return angles;
  }, [robot.joints]);

  const jointMotionState = useMemo<Record<string, JointMotionStateValue>>(() => {
    const motions: Record<string, JointMotionStateValue> = {};
    Object.values(robot.joints).forEach((joint) => {
      const nextState: JointMotionStateValue = {};
      if (joint.angle !== undefined) {
        nextState.angle = joint.angle;
      }
      if (joint.quaternion) {
        nextState.quaternion = joint.quaternion;
      }
      if (nextState.angle !== undefined || nextState.quaternion) {
        motions[joint.name] = nextState;
      }
    });

    return motions;
  }, [robot.joints]);

  const showVisual = useMemo(() => {
    return resolveWorkspaceViewerShowVisual({
      robotLinks: robot.links,
      storedPreference: readStoredWorkspaceViewerShowVisualPreference(),
    });
  }, [robot.links]);

  const workspaceViewerMjcfSourceFile = useMemo(
    () =>
      getSingleComponentWorkspaceMjcfViewerSource({
        assemblyState,
        availableFiles,
      }),
    [assemblyState, availableFiles],
  );
  const workspaceResolvedMjcfSource = useMemo(() => {
    if (!workspaceViewerMjcfSourceFile) {
      return null;
    }

    return resolveMJCFSource(workspaceViewerMjcfSourceFile, availableFiles);
  }, [availableFiles, workspaceViewerMjcfSourceFile]);

  const selectedXacroTruthFile = useMemo(() => {
    if (shouldRenderAssembly || selectedFile?.format !== 'xacro') {
      return null;
    }

    return findStandaloneXacroTruthFile(selectedFile, availableFiles);
  }, [availableFiles, selectedFile, shouldRenderAssembly]);

  const selectedXacroResolvedSourceFilePath = useMemo(
    () => selectedXacroTruthFile?.name ?? selectedFile?.name ?? null,
    [selectedFile?.name, selectedXacroTruthFile],
  );
  const {
    selectedFilePreviewSourceSnapshot,
    selectedFilePreviewSourceSnapshotStatus,
    selectedXacroBaselineSourceSnapshot,
    selectedXacroBaselineSourceSnapshotStatus,
  } = useSelectedSourceSnapshots({
    selectedFile,
    availableFiles,
    assets,
    allFileContents,
    shouldRenderAssembly,
    originalUrdfContent,
    selectedXacroResolvedSourceFilePath,
    getUsdPreparedExportCache,
  });

  const { hasSourceStoreEdits, isSelectedUrdfSource } = useSourceEditBaseline({
    shouldRenderAssembly,
    selectedFile,
    currentRobotSourceSnapshot,
    selectedFilePreviewSourceSnapshot,
    selectedXacroBaselineSourceSnapshot,
    selectedFilePreviewSourceSnapshotStatus,
    selectedXacroBaselineSourceSnapshotStatus,
  });

  const generatedUrdfRequest = useMemo(
    () =>
      !shouldRenderAssembly && !isSelectedUsdHydrating && selectedFile?.format === 'urdf'
        ? {
            format: 'urdf' as const,
            robotState: currentRobotSourceState,
            includeHardware: 'auto' as const,
          }
        : null,
    [currentRobotSourceState, isSelectedUsdHydrating, selectedFile?.format, shouldRenderAssembly],
  );
  const generatedUrdfContent = useGeneratedRobotSource({
    cache: generatedSourceCacheRef,
    cacheKey: generatedUrdfRequest ? `urdf:${currentRobotSourceSnapshot}` : null,
    options: generatedUrdfRequest,
    scope: 'useWorkspaceSourceSync:generatedUrdfContent',
  });

  const viewerGeneratedUrdfRequest = useMemo(
    () =>
      !shouldRenderAssembly && !isSelectedUsdHydrating
        ? {
            format: 'urdf' as const,
            robotState: currentRobotSourceState,
            preserveMeshPaths: true,
          }
        : null,
    [currentRobotSourceState, isSelectedUsdHydrating, shouldRenderAssembly],
  );
  const viewerGeneratedUrdfContent = useGeneratedRobotSource({
    cache: generatedSourceCacheRef,
    cacheKey: viewerGeneratedUrdfRequest ? `viewer-urdf:${currentRobotSourceSnapshot}` : null,
    options: viewerGeneratedUrdfRequest,
    scope: 'useWorkspaceSourceSync:viewerGeneratedUrdfContent',
  });

  const generatedXacroRequest = useMemo(
    () =>
      !shouldRenderAssembly && !isSelectedUsdHydrating && selectedFile?.format === 'xacro'
        ? {
            format: 'xacro' as const,
            robotState: currentRobotSourceState,
            includeHardware: 'auto' as const,
            preserveMeshPaths: true,
          }
        : null,
    [currentRobotSourceState, isSelectedUsdHydrating, selectedFile?.format, shouldRenderAssembly],
  );
  const generatedXacroContent = useGeneratedRobotSource({
    cache: generatedSourceCacheRef,
    cacheKey: generatedXacroRequest ? `xacro:${currentRobotSourceSnapshot}` : null,
    options: generatedXacroRequest,
    scope: 'useWorkspaceSourceSync:generatedXacroContent',
  });

  const viewerUrdfContent = useMemo(() => {
    if (
      shouldRenderAssembly ||
      isSelectedUsdHydrating ||
      selectedFile?.format === 'mjcf' ||
      selectedFile?.format === 'sdf'
    ) {
      return null;
    }

    if (selectedFile?.format === 'xacro') {
      return hasSourceStoreEdits
        ? viewerGeneratedUrdfContent
        : (originalUrdfContent ?? viewerGeneratedUrdfContent);
    }

    return getPreferredUrdfContent({
      fileContent: selectedFile?.format === 'urdf' ? selectedFile.content : null,
      originalContent: originalUrdfContent,
      generatedContent: viewerGeneratedUrdfContent,
      hasStoreEdits: isSelectedUrdfSource ? hasSourceStoreEdits : true,
    });
  }, [
    hasSourceStoreEdits,
    isSelectedUrdfSource,
    isSelectedUsdHydrating,
    originalUrdfContent,
    selectedFile,
    viewerGeneratedUrdfContent,
    shouldRenderAssembly,
  ]);

  const generatedMjcfRequest = useMemo(() => {
    const shouldGenerateMjcfSource =
      !shouldRenderAssembly &&
      !isSelectedUsdHydrating &&
      (selectedFile?.format === 'mjcf' ||
        (isCodeViewerOpen && sourceCodeDocumentFlavor === 'equivalent-mjcf'));

    if (!shouldGenerateMjcfSource) {
      return null;
    }

    return {
      format: 'mjcf' as const,
      robotState: currentRobotSourceState,
    };
  }, [
    currentRobotSourceState,
    isCodeViewerOpen,
    isSelectedUsdHydrating,
    selectedFile?.format,
    shouldRenderAssembly,
    sourceCodeDocumentFlavor,
  ]);
  const generatedMjcfContent = useGeneratedRobotSource({
    cache: generatedSourceCacheRef,
    cacheKey: generatedMjcfRequest ? `mjcf:${currentRobotSourceSnapshot}` : null,
    options: generatedMjcfRequest,
    scope: 'useWorkspaceSourceSync:generatedMjcfContent',
  });

  const generatedSdfRequest = useMemo(
    () =>
      !shouldRenderAssembly && !isSelectedUsdHydrating && selectedFile?.format === 'sdf'
        ? {
            format: 'sdf' as const,
            robotState: currentRobotSourceState,
          }
        : null,
    [currentRobotSourceState, isSelectedUsdHydrating, selectedFile?.format, shouldRenderAssembly],
  );
  const generatedSdfContent = useGeneratedRobotSource({
    cache: generatedSourceCacheRef,
    cacheKey: generatedSdfRequest ? `sdf:${currentRobotSourceSnapshot}` : null,
    options: generatedSdfRequest,
    scope: 'useWorkspaceSourceSync:generatedSdfContent',
  });

  const resolvedMjcfSource = useMemo(() => {
    if (!selectedFile || selectedFile.format !== 'mjcf') {
      return null;
    }

    return resolveMJCFSource(selectedFile, availableFiles);
  }, [availableFiles, selectedFile]);

  const hasMjcfViewerEdits = useMjcfViewerEditState({
    selectedFile,
    resolvedMjcfContent: resolvedMjcfSource?.content ?? null,
    generatedMjcfContent,
    selectedFilePreviewSourceSnapshot,
    currentRobotSourceSnapshot,
  });

  const workspaceViewerNeedsGeneratedUrdfContent = useMemo(() => {
    if (!shouldRenderAssembly || !workspaceViewerRobotData) {
      return false;
    }

    return shouldUseGeneratedWorkspaceViewerReloadContent({
      robotLinks: workspaceViewerRobotData.links,
      hasActiveTransformTarget: hasActiveWorkspaceTransformTarget,
    });
  }, [hasActiveWorkspaceTransformTarget, shouldRenderAssembly, workspaceViewerRobotData]);
  const workspaceViewerSourceRobotState = useMemo(() => {
    if (!workspaceViewerNeedsGeneratedUrdfContent || !workspaceViewerRobotData) {
      return null;
    }

    return {
      ...normalizeWorkspaceAssemblyViewerDisplayRobotDataForSource(workspaceViewerRobotData),
      selection: { type: null, id: null },
    };
  }, [workspaceViewerNeedsGeneratedUrdfContent, workspaceViewerRobotData]);
  const workspaceViewerGeneratedUrdfContent = useGeneratedRobotSource({
    cache: generatedSourceCacheRef,
    cacheKey: workspaceViewerSourceRobotState
      ? `workspace-viewer-urdf:${createRobotSourceSnapshot(workspaceViewerSourceRobotState)}`
      : null,
    options: workspaceViewerSourceRobotState
      ? {
          format: 'urdf' as const,
          robotState: workspaceViewerSourceRobotState,
          preserveMeshPaths: true,
        }
      : null,
    scope: 'useWorkspaceSourceSync:workspaceViewerGeneratedUrdfContent',
  });
  const workspaceViewerMjcfContent = useMemo(() => {
    if (!shouldRenderAssembly) {
      return null;
    }

    return buildSingleComponentWorkspaceMjcfViewerContent({
      assemblyState,
      sourceFile: workspaceViewerMjcfSourceFile,
      resolvedMjcfSourceContent: workspaceResolvedMjcfSource?.content ?? null,
    });
  }, [
    assemblyState,
    shouldRenderAssembly,
    workspaceResolvedMjcfSource,
    workspaceViewerMjcfSourceFile,
  ]);

  useEffect(() => {
    if (!shouldRenderAssembly || !workspaceViewerGeneratedUrdfContent) {
      return;
    }

    lastStableWorkspaceViewerGeneratedUrdfContentRef.current = workspaceViewerGeneratedUrdfContent;
  }, [shouldRenderAssembly, workspaceViewerGeneratedUrdfContent]);

  useEffect(() => {
    if (shouldRenderAssembly) {
      return;
    }

    lastStableWorkspaceViewerGeneratedUrdfContentRef.current = null;
  }, [shouldRenderAssembly]);

  const workspaceViewerReloadContent = useMemo(() => {
    if (!shouldRenderAssembly) {
      return null;
    }

    if (workspaceViewerMjcfContent) {
      return workspaceViewerMjcfContent;
    }

    if (workspaceViewerNeedsGeneratedUrdfContent) {
      return (
        workspaceViewerGeneratedUrdfContent ??
        lastStableWorkspaceViewerGeneratedUrdfContentRef.current ??
        buildLightweightWorkspaceViewerReloadContent(assemblyRevision)
      );
    }

    return buildLightweightWorkspaceViewerReloadContent(assemblyRevision);
  }, [
    assemblyRevision,
    shouldRenderAssembly,
    workspaceViewerGeneratedUrdfContent,
    workspaceViewerMjcfContent,
    workspaceViewerNeedsGeneratedUrdfContent,
  ]);

  const syncedSourceContent = useMemo(() => {
    if (!selectedFile || shouldRenderAssembly) {
      return null;
    }

    if (selectedFile.format === 'urdf') {
      return getPreferredUrdfContent({
        fileContent: selectedFile.content,
        originalContent: originalUrdfContent,
        generatedContent: generatedUrdfContent,
        hasStoreEdits: hasSourceStoreEdits,
      });
    }

    if (selectedFile.format === 'xacro') {
      return selectedFile.content;
    }

    if (selectedFile.format === 'mjcf' && isCodeViewerOpen) {
      return getPreferredMjcfContent({
        sourceContent: selectedFile.content,
        generatedContent: generatedMjcfContent,
        hasViewerEdits: hasMjcfViewerEdits,
      });
    }

    if (selectedFile.format === 'sdf' && isCodeViewerOpen) {
      return getPreferredSdfContent({
        fileContent: selectedFile.content,
        generatedContent: generatedSdfContent,
        hasStoreEdits: hasSourceStoreEdits,
      });
    }

    if (
      selectedFile.format === 'usd' &&
      sourceCodeDocumentFlavor === 'equivalent-mjcf' &&
      isCodeViewerOpen
    ) {
      return generatedMjcfContent;
    }

    return null;
  }, [
    generatedXacroContent,
    generatedMjcfContent,
    generatedSdfContent,
    generatedUrdfContent,
    hasMjcfViewerEdits,
    hasSourceStoreEdits,
    isCodeViewerOpen,
    originalUrdfContent,
    selectedFile,
    sourceCodeDocumentFlavor,
    shouldRenderAssembly,
  ]);

  const viewerSourceFormat = useMemo<'auto' | 'urdf' | 'mjcf' | 'sdf' | 'xacro'>(() => {
    if (shouldRenderAssembly) {
      return workspaceViewerMjcfContent ? 'mjcf' : 'urdf';
    }

    return resolveStandaloneViewerSourceFormat(selectedFile?.format);
  }, [selectedFile?.format, shouldRenderAssembly, workspaceViewerMjcfContent]);

  const syncTextFileContent = useWorkspaceTextFileSync({
    selectedFile,
    availableFiles,
    allFileContents,
    originalUrdfContent,
    setSelectedFile,
    setAvailableFiles,
    setAllFileContents,
    setOriginalUrdfContent,
  });

  const urdfContentForViewer = useMemo(() => {
    if (shouldRenderAssembly) {
      return workspaceViewerReloadContent ?? '';
    }

    return resolveStandaloneViewerContent({
      selectedFileFormat: selectedFile?.format,
      selectedFileContent: selectedFile?.content,
      resolvedMjcfSourceContent: resolvedMjcfSource?.content,
      viewerUrdfContent,
      viewerGeneratedUrdfContent,
      isSelectedUsdHydrating,
    });
  }, [
    isSelectedUsdHydrating,
    resolvedMjcfSource,
    selectedFile,
    viewerGeneratedUrdfContent,
    viewerUrdfContent,
    workspaceViewerReloadContent,
    shouldRenderAssembly,
  ]);

  const viewerSourceFilePath = useMemo(() => {
    if (shouldRenderAssembly) {
      return workspaceResolvedMjcfSource?.effectiveFile.name ?? workspaceViewerMjcfSourceFile?.name;
    }

    if (selectedFile?.format === 'mjcf') {
      return resolvedMjcfSource?.effectiveFile.name ?? selectedFile.name;
    }

    if (selectedFile?.format === 'xacro') {
      return hasSourceStoreEdits
        ? selectedFile.name
        : (selectedXacroResolvedSourceFilePath ?? selectedFile.name);
    }

    return selectedFile?.name;
  }, [
    hasSourceStoreEdits,
    resolvedMjcfSource,
    selectedFile,
    selectedXacroResolvedSourceFilePath,
    shouldRenderAssembly,
    workspaceResolvedMjcfSource,
    workspaceViewerMjcfSourceFile,
  ]);

  const selectedEditableSourceSyncContent = useMemo(() => {
    if (!selectedFile || !hasSourceStoreEdits) {
      return null;
    }

    switch (selectedFile.format) {
      case 'urdf':
        return generatedUrdfContent;
      case 'sdf':
        return generatedSdfContent;
      default:
        return null;
    }
  }, [generatedSdfContent, generatedUrdfContent, hasSourceStoreEdits, selectedFile]);

  useEffect(() => {
    if (!selectedFile || !selectedEditableSourceSyncContent) {
      return;
    }

    syncTextFileContent(selectedFile.name, selectedEditableSourceSyncContent);
  }, [selectedEditableSourceSyncContent, selectedFile, syncTextFileContent]);

  useDeferredWorkspaceSourceSync({
    shouldRenderAssembly,
    assemblyState,
    isCodeViewerOpen,
    selectedFile,
    availableFiles,
    allFileContents,
    generatedSourceCache: generatedSourceCacheRef.current,
    syncTextFileContent,
    setSelectedFile,
    setAvailableFiles,
    setAllFileContents,
  });

  const sourceCodeContent =
    syncedSourceContent ?? (selectedFile ? selectedFile.content : urdfContentForViewer);
  const sourceCodeDocuments = useMemo<SourceCodeDocumentDescriptor[]>(() => {
    const baseDocuments = buildSourceCodeDocuments({
      activeSourceFile,
      sourceCodeContent,
      sourceCodeDocumentFlavor,
      availableFiles,
      allFileContents,
      forceReadOnly: false,
    });

    if (activeSourceFile?.format !== 'xacro' || !generatedXacroContent || !hasSourceStoreEdits) {
      return baseDocuments;
    }

    const rawPrimaryDocument = baseDocuments[0];
    if (!rawPrimaryDocument) {
      return baseDocuments;
    }

    const generatedFileName = rawPrimaryDocument.fileName.replace(
      /(?:\.urdf)?\.xacro$/i,
      '.generated.urdf',
    );
    const generatedPrimaryDocument: SourceCodeDocumentDescriptor = {
      ...rawPrimaryDocument,
      fileName:
        generatedFileName === rawPrimaryDocument.fileName
          ? `${rawPrimaryDocument.fileName}.generated.urdf`
          : generatedFileName,
      tabLabel: 'Resolved URDF',
      content: generatedXacroContent,
      documentFlavor: 'urdf',
      readOnly: true,
      validationEnabled: true,
      changeTarget: undefined,
    };
    const rawEditableDocument: SourceCodeDocumentDescriptor = {
      ...rawPrimaryDocument,
      id: `source-raw:${activeSourceFile.name}`,
      tabLabel: `${rawPrimaryDocument.tabLabel ?? rawPrimaryDocument.fileName} (Raw)`,
    };

    return [generatedPrimaryDocument, rawEditableDocument, ...baseDocuments.slice(1)];
  }, [
    activeSourceFile,
    allFileContents,
    availableFiles,
    generatedXacroContent,
    hasSourceStoreEdits,
    sourceCodeContent,
    sourceCodeDocumentFlavor,
  ]);

  return {
    isWorkspaceAssembly,
    shouldRenderAssembly,
    mergedRobotData,
    workspaceAssemblyRenderFailureReason,
    emptyRobot,
    robot,
    viewerRobot,
    sourceSceneAssemblyComponentId,
    jointAngleState,
    jointMotionState,
    showVisual,
    urdfContentForViewer,
    viewerSourceFormat,
    viewerSourceFilePath,
    workspaceViewerMjcfSourceFile,
    filePreview,
    previewRobot,
    previewFileName,
    sourceCodeDocuments,
    sourceCodeFileName: activeSourceFile?.name,
    sourceCodeContent,
    sourceCodeDocumentFlavor,
    hasSimpleModeSourceEdits: hasSourceStoreEdits,
    draftUrdfContent: viewerGeneratedUrdfContent,
    handlePreviewFile,
    handleClosePreview,
  };
}
