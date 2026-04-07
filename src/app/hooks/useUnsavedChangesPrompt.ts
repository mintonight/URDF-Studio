import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useAssemblyStore, useRobotStore } from '@/store';
import {
  isRegressionBeforeUnloadPromptSuppressed,
  subscribeRegressionBeforeUnloadPromptSuppression,
} from '@/shared/debug/regressionBridge';
import { createAssemblyPersistenceSnapshot } from '@/shared/utils/assembly/semanticSnapshot';
import { createRobotPersistenceSnapshot } from '@/shared/utils/robot/semanticSnapshot';

import {
  registerUnsavedChangesBaselineMarker,
  type UnsavedChangesSaveScope,
} from '@/app/utils/unsavedChangesBaseline';

interface UnsavedChangesBaseline {
  robot: string;
  assembly: string;
}

function getCurrentRobotPersistenceSnapshot(): string {
  const state = useRobotStore.getState();
  return createRobotPersistenceSnapshot({
    name: state.name,
    links: state.links,
    joints: state.joints,
    rootLinkId: state.rootLinkId,
    materials: state.materials,
    closedLoopConstraints: state.closedLoopConstraints,
  });
}

function getCurrentAssemblyPersistenceSnapshot(): string {
  return createAssemblyPersistenceSnapshot(useAssemblyStore.getState().assemblyState);
}

export function useUnsavedChangesPrompt() {
  const { robotName, robotLinks, robotJoints, rootLinkId, robotMaterials, closedLoopConstraints } =
    useRobotStore(
      useShallow((state) => ({
        robotName: state.name,
        robotLinks: state.links,
        robotJoints: state.joints,
        rootLinkId: state.rootLinkId,
        robotMaterials: state.materials,
        closedLoopConstraints: state.closedLoopConstraints,
      })),
    );
  const assemblyState = useAssemblyStore((state) => state.assemblyState);

  const currentRobotSnapshot = useMemo(
    () =>
      createRobotPersistenceSnapshot({
        name: robotName,
        links: robotLinks,
        joints: robotJoints,
        rootLinkId,
        materials: robotMaterials,
        closedLoopConstraints,
      }),
    [closedLoopConstraints, robotJoints, robotLinks, robotMaterials, robotName, rootLinkId],
  );
  const currentAssemblySnapshot = useMemo(
    () => createAssemblyPersistenceSnapshot(assemblyState),
    [assemblyState],
  );

  const [baseline, setBaseline] = useState<UnsavedChangesBaseline>(() => ({
    robot: currentRobotSnapshot,
    assembly: currentAssemblySnapshot,
  }));
  const [beforeUnloadPromptSuppressed, setBeforeUnloadPromptSuppressed] = useState(() =>
    isRegressionBeforeUnloadPromptSuppressed(),
  );

  const markCurrentStateSaved = useCallback((scope: UnsavedChangesSaveScope = 'all') => {
    setBaseline((previousBaseline) => {
      const nextBaseline = { ...previousBaseline };
      if (scope === 'all' || scope === 'robot') {
        nextBaseline.robot = getCurrentRobotPersistenceSnapshot();
      }
      if (scope === 'all' || scope === 'assembly') {
        nextBaseline.assembly = getCurrentAssemblyPersistenceSnapshot();
      }
      return nextBaseline;
    });
  }, []);

  const hasUnsavedChanges =
    currentRobotSnapshot !== baseline.robot || currentAssemblySnapshot !== baseline.assembly;

  useEffect(() => {
    registerUnsavedChangesBaselineMarker(markCurrentStateSaved);
    return () => {
      registerUnsavedChangesBaselineMarker(null);
    };
  }, [markCurrentStateSaved]);

  useEffect(() => {
    return subscribeRegressionBeforeUnloadPromptSuppression(setBeforeUnloadPromptSuppressed);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasUnsavedChanges || beforeUnloadPromptSuppressed) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [beforeUnloadPromptSuppressed, hasUnsavedChanges]);

  return {
    hasUnsavedChanges,
    markCurrentStateSaved,
  };
}
