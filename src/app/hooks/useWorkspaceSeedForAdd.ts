import { useCallback } from 'react';

import { useRobotStore } from '@/store';
import type { RobotStoreState } from '@/store/robot/robotStoreTypes';
import type { RobotData, RobotFile } from '@/types';

interface UseWorkspaceSeedForAddOptions {
  addComponent: RobotStoreState['addComponent'];
  allFileContents: Record<string, string>;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  closedLoopConstraints: RobotData['closedLoopConstraints'];
  initAssembly: RobotStoreState['initAssembly'];
  robotJoints: RobotData['joints'];
  robotLinks: RobotData['links'];
  robotMaterials: RobotData['materials'];
  robotName: string;
  rootLinkId: RobotData['rootLinkId'];
  selectedFile: RobotFile | null;
}

export function useWorkspaceSeedForAdd({
  addComponent,
  allFileContents,
  assets,
  availableFiles,
  closedLoopConstraints,
  initAssembly,
  robotJoints,
  robotLinks,
  robotMaterials,
  robotName,
  rootLinkId,
  selectedFile,
}: UseWorkspaceSeedForAddOptions) {
  return useCallback(
    (targetFile: RobotFile) => {
      const currentAssemblyState = useRobotStore.getState().assemblyState;
      if (currentAssemblyState && Object.keys(currentAssemblyState.components).length > 0) {
        return;
      }

      if (!currentAssemblyState) {
        initAssembly(robotName || 'assembly');
      }

      const activeFile = selectedFile;
      if (
        !activeFile ||
        activeFile.name === targetFile.name ||
        activeFile.format === 'mesh' ||
        activeFile.format === 'asset'
      ) {
        return;
      }

      const currentRobotData: RobotData = structuredClone({
        name: robotName,
        links: robotLinks,
        joints: robotJoints,
        rootLinkId,
        materials: robotMaterials,
        closedLoopConstraints,
      });

      addComponent(activeFile, {
        availableFiles,
        assets,
        allFileContents,
        preResolvedImportResult: {
          status: 'ready',
          format: activeFile.format,
          robotData: currentRobotData,
          resolvedUrdfContent: null,
          resolvedUrdfSourceFilePath: null,
        },
        queueAutoGround: false,
      });
    },
    [
      addComponent,
      allFileContents,
      assets,
      availableFiles,
      closedLoopConstraints,
      initAssembly,
      robotJoints,
      robotLinks,
      robotMaterials,
      robotName,
      rootLinkId,
      selectedFile,
    ],
  );
}
