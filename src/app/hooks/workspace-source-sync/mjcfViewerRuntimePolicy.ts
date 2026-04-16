import type { RobotFile } from '@/types';

export type ViewerRuntimeSourceFormat = 'auto' | 'urdf' | 'mjcf' | 'sdf' | 'xacro';

export function resolveStandaloneViewerSourceFormat(
  selectedFileFormat: RobotFile['format'] | null | undefined,
): ViewerRuntimeSourceFormat {
  switch (selectedFileFormat) {
    case 'urdf':
    case 'mjcf':
    case 'sdf':
    case 'xacro':
      return selectedFileFormat;
    default:
      return 'auto';
  }
}

export function resolveStandaloneViewerContent({
  selectedFileFormat,
  selectedFileContent,
  resolvedMjcfSourceContent,
  viewerUrdfContent,
  viewerGeneratedUrdfContent,
  isSelectedUsdHydrating,
}: {
  selectedFileFormat: RobotFile['format'] | null | undefined;
  selectedFileContent?: string | null;
  resolvedMjcfSourceContent?: string | null;
  viewerUrdfContent?: string | null;
  viewerGeneratedUrdfContent?: string | null;
  isSelectedUsdHydrating: boolean;
}): string {
  if (selectedFileFormat === 'usd' && isSelectedUsdHydrating) {
    return selectedFileContent ?? '';
  }

  if (selectedFileFormat === 'mjcf') {
    return resolvedMjcfSourceContent ?? selectedFileContent ?? '';
  }

  if (selectedFileFormat === 'sdf') {
    return selectedFileContent ?? '';
  }

  return viewerUrdfContent ?? viewerGeneratedUrdfContent ?? '';
}
