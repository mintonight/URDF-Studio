import { isMJCFContent } from '@/core/parsers/mjcf';
import type { RobotFile } from '@/types';

import type { ViewerRobotSourceFormat } from '../types';

export type ResolvedViewerRobotSourceFormat = 'urdf' | 'mjcf';

export function getViewerRobotSourceFormat(
  fileFormat: RobotFile['format'] | null | undefined,
): ViewerRobotSourceFormat {
  switch (fileFormat) {
    case 'urdf':
    case 'mjcf':
    case 'sdf':
    case 'xacro':
      return fileFormat;
    default:
      return 'auto';
  }
}

export function resolvePreferredViewerRobotSourceFormat(
  explicitSourceFormat: ViewerRobotSourceFormat | undefined,
  fileFormat: RobotFile['format'] | null | undefined,
): ViewerRobotSourceFormat {
  if (explicitSourceFormat !== undefined) {
    return explicitSourceFormat;
  }

  return getViewerRobotSourceFormat(fileFormat);
}

export function resolveViewerRobotSourceFormat(
  content: string,
  sourceFormat: ViewerRobotSourceFormat = 'auto',
): ResolvedViewerRobotSourceFormat {
  if (sourceFormat === 'mjcf') {
    return 'mjcf';
  }

  if (sourceFormat === 'urdf' || sourceFormat === 'sdf' || sourceFormat === 'xacro') {
    return 'urdf';
  }

  return isMJCFContent(content) ? 'mjcf' : 'urdf';
}
