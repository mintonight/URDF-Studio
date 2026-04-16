import { useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { generateMujocoXML, generateSDF, generateURDF } from '@/core/parsers';
import { findStandaloneXacroTruthFile } from '@/core/parsers/importRobotFile';
import {
  prefixMJCFSourceIdentifiers,
  resolveMJCFSource,
} from '@/core/parsers/mjcf/mjcfSourceResolver';
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
import { buildSourceCodeDocuments } from '@/app/utils/sourceCodeDocuments';
import {
  areJointSourceCompatible,
  buildVisibleAssemblyState,
} from './workspace-source-sync/compatibility';
import { readGeneratedSourceFromCache } from './workspace-source-sync/sourceGenerationCache';
import { useDeferredWorkspaceSourceSync } from './workspace-source-sync/useDeferredWorkspaceSourceSync';
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
  const isWorkspaceAssembly = Boolean(assemblyState && sidebarTab === 'workspace');
  const hasWorkspaceComponents = Boolean(
    assemblyState && Object.keys(assemblyState.components).length > 0,
  );
  const sourceJointsRef = useRef<Record<string, UrdfJoint>>({});
  const {
    filePreview,
    previewRobot,
    previewFileName,
    handlePreviewFile,
    handleClosePreview,
    activePreviewFile,
  } = useWorkspaceFilePreview({
    availableFiles,
    assets,
    allFileContents,
    getUsdPreparedExportCache,
  });
  const activeSourceFile = useMemo(
    () => activePreviewFile ?? selectedFile,
    [activePreviewFile, selectedFile],
  );
  const readCachedGeneratedSource = useCallback(
    (cacheKey: string, buildSource: () => string): string => {
      return readGeneratedSourceFromCache(generatedSourceCacheRef.current, cacheKey, buildSource);
    },
    [],
  );
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
        liveRobot: sourceViewerRobot,
        lastStableViewerRobot: lastStableViewerRobotRef.current,
        selection,
      }),
    [hasWorkspaceDisplayRobot, selection, shouldRenderAssembly, sourceViewerRobot],
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
    return Object.values(robot.links).some((link) => link.visible !== false);
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

  const { hasSourceStoreEdits, isSelectedUrdfSource, isSelectedXacroSource, isSelectedSdfSource } =
    useSourceEditBaseline({
      shouldRenderAssembly,
      selectedFile,
      currentRobotSourceSnapshot,
      selectedFilePreviewSourceSnapshot,
      selectedXacroBaselineSourceSnapshot,
      selectedFilePreviewSourceSnapshotStatus,
      selectedXacroBaselineSourceSnapshotStatus,
    });

  const generatedUrdfContent = useMemo(() => {
    if (
      shouldRenderAssembly ||
      isSelectedUsdHydrating ||
      selectedFile?.format === 'mjcf' ||
      selectedFile?.format === 'sdf'
    ) {
      return null;
    }

    return readCachedGeneratedSource(`urdf:${currentRobotSourceSnapshot}`, () =>
      generateURDF(currentRobotSourceState, { includeHardware: 'auto' }),
    );
  }, [
    currentRobotSourceSnapshot,
    currentRobotSourceState,
    isSelectedUsdHydrating,
    readCachedGeneratedSource,
    selectedFile?.format,
    shouldRenderAssembly,
  ]);

  const viewerGeneratedUrdfContent = useMemo(() => {
    if (shouldRenderAssembly || isSelectedUsdHydrating || selectedFile?.format === 'sdf') {
      return null;
    }

    return readCachedGeneratedSource(`viewer-urdf:${currentRobotSourceSnapshot}`, () =>
      generateURDF(currentRobotSourceState, { preserveMeshPaths: true }),
    );
  }, [
    currentRobotSourceSnapshot,
    currentRobotSourceState,
    isSelectedUsdHydrating,
    readCachedGeneratedSource,
    selectedFile?.format,
    shouldRenderAssembly,
  ]);

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

  const generatedMjcfContent = useMemo(() => {
    const shouldGenerateMjcfSource =
      !shouldRenderAssembly &&
      !isSelectedUsdHydrating &&
      (selectedFile?.format === 'mjcf' ||
        (isCodeViewerOpen && sourceCodeDocumentFlavor === 'equivalent-mjcf'));

    if (!shouldGenerateMjcfSource) {
      return null;
    }

    return readCachedGeneratedSource(`mjcf:${currentRobotSourceSnapshot}`, () =>
      generateMujocoXML(currentRobotSourceState, {
        meshdir: 'meshes/',
        includeSceneHelpers: false,
      }),
    );
  }, [
    currentRobotSourceSnapshot,
    currentRobotSourceState,
    isCodeViewerOpen,
    isSelectedUsdHydrating,
    readCachedGeneratedSource,
    selectedFile?.format,
    shouldRenderAssembly,
    sourceCodeDocumentFlavor,
  ]);

  const generatedSdfContent = useMemo(() => {
    if (shouldRenderAssembly || isSelectedUsdHydrating || selectedFile?.format !== 'sdf') {
      return null;
    }

    return readCachedGeneratedSource(`sdf:${currentRobotSourceSnapshot}`, () =>
      generateSDF(currentRobotSourceState),
    );
  }, [
    currentRobotSourceSnapshot,
    currentRobotSourceState,
    isSelectedUsdHydrating,
    readCachedGeneratedSource,
    selectedFile?.format,
    shouldRenderAssembly,
  ]);

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
  const workspaceViewerGeneratedUrdfContent = useMemo(() => {
    if (!workspaceViewerNeedsGeneratedUrdfContent || !workspaceViewerRobotData) {
      return null;
    }

    const normalizedWorkspaceViewerRobotData =
      normalizeWorkspaceAssemblyViewerDisplayRobotDataForSource(workspaceViewerRobotData);

    return readCachedGeneratedSource(`workspace-viewer-urdf:${assemblyRevision}`, () =>
      generateURDF(
        {
          ...normalizedWorkspaceViewerRobotData,
          selection: { type: null, id: null },
        },
        { preserveMeshPaths: true },
      ),
    );
  }, [
    assemblyRevision,
    readCachedGeneratedSource,
    workspaceViewerNeedsGeneratedUrdfContent,
    workspaceViewerRobotData,
  ]);
  const workspaceViewerMjcfContent = useMemo(() => {
    if (
      !shouldRenderAssembly ||
      !workspaceViewerMjcfSourceFile ||
      !workspaceResolvedMjcfSource ||
      !assemblyState
    ) {
      return null;
    }

    const visibleComponent = Object.values(assemblyState.components).find(
      (component) =>
        component.visible !== false && component.sourceFile === workspaceViewerMjcfSourceFile.name,
    );

    if (!visibleComponent) {
      return null;
    }

    const componentSnapshot = createRobotSourceSnapshot({
      ...visibleComponent.robot,
      selection: { type: null, id: null },
    });

    return readCachedGeneratedSource(
      `workspace-viewer-mjcf:${workspaceViewerMjcfSourceFile.name}:${componentSnapshot}`,
      () =>
        prefixMJCFSourceIdentifiers(
          workspaceResolvedMjcfSource.content,
          `${visibleComponent.name}_`,
        ),
    );
  }, [
    assemblyState,
    readCachedGeneratedSource,
    shouldRenderAssembly,
    workspaceResolvedMjcfSource,
    workspaceViewerMjcfSourceFile,
  ]);

  const workspaceViewerReloadContent = useMemo(() => {
    if (!shouldRenderAssembly) {
      return null;
    }

    if (workspaceViewerMjcfContent) {
      return workspaceViewerMjcfContent;
    }

    if (workspaceViewerNeedsGeneratedUrdfContent) {
      return workspaceViewerGeneratedUrdfContent;
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
    generatedMjcfContent,
    generatedSdfContent,
    generatedUrdfContent,
    hasMjcfViewerEdits,
    hasSourceStoreEdits,
    isCodeViewerOpen,
    originalUrdfContent,
    resolvedMjcfSource,
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

  useEffect(() => {
    if (
      !selectedFile ||
      selectedFile.format !== 'urdf' ||
      !generatedUrdfContent ||
      !hasSourceStoreEdits
    ) {
      return;
    }

    syncTextFileContent(selectedFile.name, generatedUrdfContent);
  }, [generatedUrdfContent, hasSourceStoreEdits, selectedFile, syncTextFileContent]);

  useDeferredWorkspaceSourceSync({
    shouldRenderAssembly,
    assemblyState,
    isCodeViewerOpen,
    selectedFile,
    availableFiles,
    allFileContents,
    readCachedGeneratedSource,
    syncTextFileContent,
    setSelectedFile,
    setAvailableFiles,
    setAllFileContents,
  });

  const sourceCodeContent =
    activePreviewFile?.content ??
    syncedSourceContent ??
    (selectedFile ? selectedFile.content : urdfContentForViewer);
  const sourceCodeDocuments = useMemo(
    () =>
      buildSourceCodeDocuments({
        activeSourceFile,
        sourceCodeContent,
        sourceCodeDocumentFlavor,
        availableFiles,
        allFileContents,
        forceReadOnly: Boolean(activePreviewFile),
      }),
    [
      activePreviewFile,
      activeSourceFile,
      allFileContents,
      availableFiles,
      sourceCodeContent,
      sourceCodeDocumentFlavor,
    ],
  );

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
    handlePreviewFile,
    handleClosePreview,
  };
}
