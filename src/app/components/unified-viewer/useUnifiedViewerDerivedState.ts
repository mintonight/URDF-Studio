import React from 'react';

import type { AppMode, AssemblyState, RobotFile, RobotState, Theme } from '@/types';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransforms';
import {
  denormalizeSourceSceneAssemblyComponentTransform,
  normalizeSourceSceneAssemblyComponentTransform,
} from '@/app/utils/sourceSceneAssemblyTransform';
import { useResolvedTheme } from '@/shared/hooks';
import {
  createInitialUnifiedViewerMountState,
  resolveUnifiedViewerMountState,
  resolveUnifiedViewerSessionState,
  type UnifiedViewerMountState,
} from '@/app/utils/unifiedViewerMountState';
import { captureUnifiedViewerOptionsVisibility } from '@/app/utils/unifiedViewerOptionsRestore';
import { buildUnifiedViewerResourceScopes } from '@/app/utils/unifiedViewerResourceScopes';
import { resolveUnifiedViewerEditorRobot } from '@/app/utils/unifiedViewerSceneRobots';
import { resolveUnifiedViewerViewportState } from '@/app/utils/unifiedViewerViewportState';
import { useUIStore } from '@/store';
import type { AssemblySelection } from '@/store/assemblySelectionStore';
import type { DocumentLoadLifecycleState } from '@/store/assetsStore';
import type { UpdateCommitOptions } from '@/types/viewer';
import { setRegressionViewerResourceScope } from '@/shared/debug/regressionBridge';
import {
  buildViewerRobotLinksScopeSignature,
  type ToolMode,
  type ViewerResourceScope,
} from '@/features/editor';

import type { FilePreviewState } from './types';

interface UseUnifiedViewerDerivedStateParams {
  mode: AppMode;
  filePreview?: FilePreviewState;
  pendingViewerToolMode?: ToolMode | null;
  theme: Theme;
  showOptionsPanel: boolean;
  editorRobotInput?: RobotState;
  robot: RobotState;
  assemblyWorkspaceActive: boolean;
  urdfContent: string;
  sourceFilePath?: string;
  sourceFile?: RobotFile | null;
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
  availableFiles: RobotFile[];
  assemblyState?: AssemblyState | null;
  sourceSceneAssemblyComponentId?: string | null;
  assemblySelection?: AssemblySelection;
  onComponentTransform?: (
    componentId: string,
    transform: {
      position: { x: number; y: number; z: number };
      rotation: { r: number; p: number; y: number };
    },
    options?: UpdateCommitOptions,
  ) => void;
  viewerReloadKey?: number;
  documentLoadState: DocumentLoadLifecycleState;
}

export function useUnifiedViewerDerivedState({
  mode,
  filePreview,
  pendingViewerToolMode = null,
  theme,
  showOptionsPanel,
  editorRobotInput,
  robot,
  assemblyWorkspaceActive,
  urdfContent,
  sourceFilePath,
  sourceFile,
  assets,
  allFileContents,
  availableFiles,
  assemblyState,
  sourceSceneAssemblyComponentId = null,
  assemblySelection,
  onComponentTransform,
  viewerReloadKey = 0,
  documentLoadState,
}: UseUnifiedViewerDerivedStateParams) {
  const groundPlaneOffset = useUIStore((state) => state.groundPlaneOffset);
  const setGroundPlaneOffset = useUIStore((state) => state.setGroundPlaneOffset);
  const [forcedViewerSession, setForcedViewerSession] = React.useState(false);
  const viewerToolSessionActive = pendingViewerToolMode === 'measure' || forcedViewerSession;
  const sessionState = React.useMemo(
    () =>
      resolveUnifiedViewerSessionState({
        mode,
        filePreview,
        forceViewerSession: viewerToolSessionActive,
      }),
    [filePreview, mode, viewerToolSessionActive],
  );
  const { activePreview, isPreviewing, isViewerMode } = sessionState;
  const viewerSceneMode = sessionState.viewerSceneMode;
  const [mountState, setMountState] = React.useState<UnifiedViewerMountState>(() =>
    createInitialUnifiedViewerMountState({
      mode,
      isPreviewing,
      forceViewerSession: viewerToolSessionActive,
    }),
  );
  const resolvedTheme = useResolvedTheme(theme);
  const viewerOptionsVisibleRef = React.useRef(showOptionsPanel);
  const viewerResourceScopeRef = React.useRef<ViewerResourceScope | null>(null);
  const optionsVisibleAtPointerDownRef = React.useRef(
    captureUnifiedViewerOptionsVisibility({
      showViewerOptions: showOptionsPanel,
    }),
  );

  React.useEffect(() => {
    viewerOptionsVisibleRef.current = showOptionsPanel;
  }, [showOptionsPanel]);

  React.useEffect(() => {
    setMountState((current) =>
      resolveUnifiedViewerMountState(current, {
        mode,
        isPreviewing,
        forceViewerSession: viewerToolSessionActive,
      }),
    );
  }, [isPreviewing, mode, viewerToolSessionActive]);

  const editorRobot = React.useMemo(
    () =>
      resolveUnifiedViewerEditorRobot({
        robot: editorRobotInput ?? robot,
        viewerRobot: robot,
        assemblyWorkspaceActive,
      }),
    [assemblyWorkspaceActive, editorRobotInput, robot],
  );
  const viewerRobotLinksScopeSignature = React.useMemo(
    () =>
      buildViewerRobotLinksScopeSignature(
        activePreview ? undefined : robot.links,
        activePreview ? undefined : robot.materials,
      ),
    [activePreview, robot.links, robot.materials],
  );
  const viewerRobotLinksForScope = React.useMemo(
    () => (activePreview ? undefined : robot.links),
    [activePreview, viewerRobotLinksScopeSignature],
  );
  const viewerRobotMaterialsForScope = React.useMemo(
    () => (activePreview ? undefined : robot.materials),
    [activePreview, viewerRobotLinksScopeSignature],
  );
  const {
    effectiveUrdfContent,
    effectiveSourceFilePath,
    effectiveSourceFile,
    activeViewportFileName,
    viewerResourceScope,
  } = React.useMemo(() => {
    const next = buildUnifiedViewerResourceScopes({
      activePreview,
      urdfContent,
      sourceFilePath,
      sourceFile,
      assets,
      allFileContents,
      availableFiles,
      viewerRobotLinks: viewerRobotLinksForScope,
      viewerRobotMaterials: viewerRobotMaterialsForScope,
      previousViewerResourceScope: viewerResourceScopeRef.current,
    });
    viewerResourceScopeRef.current = next.viewerResourceScope;
    return next;
  }, [
    activePreview,
    assets,
    allFileContents,
    availableFiles,
    sourceFile,
    sourceFilePath,
    urdfContent,
    viewerRobotLinksForScope,
    viewerRobotMaterialsForScope,
  ]);

  React.useEffect(() => {
    setRegressionViewerResourceScope({
      sourceFileName: effectiveSourceFile?.name ?? null,
      sourceFilePath: effectiveSourceFilePath ?? null,
      assetKeys: Object.keys(viewerResourceScope.assets).sort((left, right) =>
        left.localeCompare(right),
      ),
      availableFileNames: viewerResourceScope.availableFiles
        .map((file) => file.name)
        .sort((left, right) => left.localeCompare(right)),
      signature: viewerResourceScope.signature,
    });

    return () => {
      setRegressionViewerResourceScope(null);
    };
  }, [effectiveSourceFile?.name, effectiveSourceFilePath, viewerResourceScope]);

  const sourceSceneAssemblyComponent = React.useMemo(() => {
    if (!sourceSceneAssemblyComponentId || !assemblyState) {
      return null;
    }

    const component = assemblyState.components[sourceSceneAssemblyComponentId];
    if (!component || component.visible === false) {
      return null;
    }

    return component;
  }, [assemblyState, sourceSceneAssemblyComponentId]);
  const sourceSceneAssemblyComponentTransform = React.useMemo(
    () => normalizeSourceSceneAssemblyComponentTransform(sourceSceneAssemblyComponent),
    [sourceSceneAssemblyComponent],
  );
  const handleSourceSceneAssemblyComponentTransform = React.useCallback(
    (
      componentId: string,
      transform: {
        position: { x: number; y: number; z: number };
        rotation: { r: number; p: number; y: number };
      },
      options?: UpdateCommitOptions,
    ) => {
      if (!onComponentTransform) {
        return;
      }

      const normalizedTransform =
        sourceSceneAssemblyComponent && sourceSceneAssemblyComponent.id === componentId
          ? denormalizeSourceSceneAssemblyComponentTransform(
              sourceSceneAssemblyComponent,
              transform,
            )
          : cloneAssemblyTransform(transform);

      onComponentTransform(componentId, normalizedTransform, options);
    },
    [onComponentTransform, sourceSceneAssemblyComponent],
  );
  const showSourceSceneAssemblyComponentControls = Boolean(
    sourceSceneAssemblyComponent &&
    assemblySelection?.type === 'component' &&
    assemblySelection.id === sourceSceneAssemblyComponent.id,
  );
  const viewportState = React.useMemo(
    () =>
      resolveUnifiedViewerViewportState({
        isViewerMode,
        mountState,
        activeViewportFileName,
        viewerReloadKey,
        documentLoadState,
      }),
    [activeViewportFileName, documentLoadState, isViewerMode, mountState, viewerReloadKey],
  );

  return {
    groundPlaneOffset,
    setGroundPlaneOffset,
    forcedViewerSession,
    setForcedViewerSession,
    activePreview,
    isPreviewing,
    isViewerMode,
    viewerSceneMode,
    mountState,
    setMountState,
    resolvedTheme,
    viewerOptionsVisibleRef,
    optionsVisibleAtPointerDownRef,
    editorRobot,
    effectiveUrdfContent,
    effectiveSourceFilePath,
    effectiveSourceFile,
    activeViewportFileName,
    viewerResourceScope,
    sourceSceneAssemblyComponent,
    sourceSceneAssemblyComponentTransform,
    handleSourceSceneAssemblyComponentTransform,
    showSourceSceneAssemblyComponentControls,
    viewportState,
  };
}
