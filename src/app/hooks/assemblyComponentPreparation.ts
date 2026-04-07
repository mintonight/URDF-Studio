import { useCallback, useState } from 'react';

import { buildAssemblyComponentIdentity } from '@/core/robot';
import type { AssemblyComponent, AssemblyState, RobotData, RobotFile } from '@/types';

import type { ImportPreparationOverlayState } from './useFileImport';
import { prepareAssemblyComponentWithWorker } from './robotImportWorkerBridge';
import { waitForNextPaint } from '../utils/waitForNextPaint';

interface AssemblyComponentPreparationTranslations {
  addingAssemblyComponentToWorkspace: string;
  groundingAssemblyComponent: string;
  loadingRobot: string;
  preparingAssemblyComponent: string;
}

type AssemblyComponentPreparationStage = 'prepare' | 'add' | 'ground';

interface PreparedAssemblyComponent {
  componentId: string;
  displayName: string;
  robotData: RobotData;
  renderableBounds?: import('@/types').RenderableBounds | null;
  suggestedTransform?: import('@/types').AssemblyTransform | null;
}

interface UseAssemblyComponentPreparationParams {
  assemblyState: AssemblyState | null;
  availableFiles: RobotFile[];
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
  t: AssemblyComponentPreparationTranslations;
  addComponent: (
    file: RobotFile,
    context?: {
      availableFiles?: RobotFile[];
      assets?: Record<string, string>;
      allFileContents?: Record<string, string>;
      preResolvedRobotData?: RobotData | null;
      preparedComponent?: PreparedAssemblyComponent | null;
    },
  ) => AssemblyComponent | null;
  focusOn: (id: string) => void;
  selectComponent: (id: string) => void;
  setSelection: (selection: { type: null; id: null }) => void;
}

export function buildAssemblyComponentPreparationOverlayState(
  file: RobotFile,
  stage: AssemblyComponentPreparationStage,
  t: AssemblyComponentPreparationTranslations,
): ImportPreparationOverlayState {
  const fileLabel = file.name.split('/').pop() ?? file.name;

  if (stage === 'ground') {
    return {
      label: t.loadingRobot,
      detail: fileLabel,
      progress: 0.92,
      statusLabel: '3/3',
      stageLabel: t.groundingAssemblyComponent,
    };
  }

  if (stage === 'add') {
    return {
      label: t.loadingRobot,
      detail: fileLabel,
      progress: 0.72,
      statusLabel: '2/3',
      stageLabel: t.addingAssemblyComponentToWorkspace,
    };
  }

  return {
    label: t.loadingRobot,
    detail: fileLabel,
    progress: 0.36,
    statusLabel: '1/3',
    stageLabel: t.preparingAssemblyComponent,
  };
}

export function useAssemblyComponentPreparation({
  assemblyState,
  availableFiles,
  assets,
  allFileContents,
  t,
  addComponent,
  focusOn,
  selectComponent,
  setSelection,
}: UseAssemblyComponentPreparationParams) {
  const [assemblyComponentPreparationOverlay, setAssemblyComponentPreparationOverlay] =
    useState<ImportPreparationOverlayState | null>(null);

  const prepareAssemblyComponentForInsert = useCallback(
    async (
      file: RobotFile,
      options: {
        existingComponentIds?: Iterable<string>;
        existingComponentNames?: Iterable<string>;
        preResolvedRobotData?: RobotData | null;
      } = {},
    ) => {
      const identity = buildAssemblyComponentIdentity({
        fileName: file.name,
        existingComponentIds:
          options.existingComponentIds ?? Object.keys(assemblyState?.components ?? {}),
        existingComponentNames:
          options.existingComponentNames ??
          Object.values(assemblyState?.components ?? {}).map((component) => component.name),
      });
      const existingPlacementComponents = Object.values(assemblyState?.components ?? {}).map(
        (component) => ({
          renderableBounds: component.renderableBounds ?? null,
          transform: component.transform ?? null,
          robotData: component.renderableBounds ? null : component.robot,
        }),
      );

      return prepareAssemblyComponentWithWorker(file, {
        availableFiles,
        assets,
        allFileContents,
        usdRobotData: options.preResolvedRobotData ?? null,
        existingPlacementComponents,
        componentId: identity.componentId,
        rootName: identity.displayName,
      });
    },
    [allFileContents, assemblyState, assets, availableFiles],
  );

  const showAssemblyComponentPreparationOverlay = useCallback(
    (file: RobotFile, stage: AssemblyComponentPreparationStage) => {
      setAssemblyComponentPreparationOverlay(
        buildAssemblyComponentPreparationOverlayState(file, stage, t),
      );
    },
    [t],
  );

  const clearAssemblyComponentPreparationOverlay = useCallback(() => {
    setAssemblyComponentPreparationOverlay(null);
  }, []);

  const activateInsertedAssemblyComponent = useCallback(
    (component: AssemblyComponent) => {
      setSelection({ type: null, id: null });
      selectComponent(component.id);
      if (component.robot.rootLinkId) {
        focusOn(component.robot.rootLinkId);
      }
    },
    [focusOn, selectComponent, setSelection],
  );

  const insertAssemblyComponentIntoWorkspace = useCallback(
    async (
      file: RobotFile,
      options: {
        preResolvedRobotData?: RobotData | null;
      } = {},
    ) => {
      showAssemblyComponentPreparationOverlay(file, 'prepare');
      await waitForNextPaint();

      const preparedComponent = await prepareAssemblyComponentForInsert(file, {
        preResolvedRobotData: options.preResolvedRobotData ?? null,
      });

      showAssemblyComponentPreparationOverlay(file, 'add');
      await waitForNextPaint();

      const component = addComponent(file, {
        availableFiles,
        assets,
        allFileContents,
        preResolvedRobotData: options.preResolvedRobotData ?? null,
        preparedComponent,
      });
      if (!component) {
        throw new Error(`Failed to add assembly component: ${file.name}`);
      }

      activateInsertedAssemblyComponent(component);

      showAssemblyComponentPreparationOverlay(file, 'ground');
      await waitForNextPaint();

      return component;
    },
    [
      activateInsertedAssemblyComponent,
      addComponent,
      allFileContents,
      assets,
      availableFiles,
      prepareAssemblyComponentForInsert,
      showAssemblyComponentPreparationOverlay,
    ],
  );

  return {
    assemblyComponentPreparationOverlay,
    prepareAssemblyComponentForInsert,
    showAssemblyComponentPreparationOverlay,
    clearAssemblyComponentPreparationOverlay,
    activateInsertedAssemblyComponent,
    insertAssemblyComponentIntoWorkspace,
  };
}
