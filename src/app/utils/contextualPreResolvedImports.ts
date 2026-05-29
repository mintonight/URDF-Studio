import {
  isStandaloneXacroEntry,
  type ResolveRobotFileDataOptions,
} from '@/core/parsers/importRobotFile';
import { resolveRobotFileDataWithWorker } from '@/app/hooks/robotImportWorkerBridge';
import type { RobotFile } from '@/types';
import type { PreResolvedImportEntry } from './importPreparation';
import { buildPreResolvedImportContentSignature } from './preResolvedImportSignature.ts';

export function shouldBuildContextualPreResolvedImports(
  options: Pick<ResolveRobotFileDataOptions, 'availableFiles' | 'assets' | 'allFileContents'>,
): boolean {
  const availableFiles = options.availableFiles ?? [];
  const assets = options.assets ?? {};
  const allFileContents = options.allFileContents ?? {};
  return availableFiles.length > 0
    || Object.keys(assets).length > 0
    || Object.keys(allFileContents).length > 0;
}

function compareContextualXacroPathPreference(left: RobotFile, right: RobotFile): number {
  const leftSegments = left.name.split('/').length;
  const rightSegments = right.name.split('/').length;
  if (leftSegments !== rightSegments) {
    return leftSegments - rightSegments;
  }

  const leftBaseName = left.name.split('/').pop() ?? left.name;
  const rightBaseName = right.name.split('/').pop() ?? right.name;
  if (leftBaseName.length !== rightBaseName.length) {
    return leftBaseName.length - rightBaseName.length;
  }

  return left.name.localeCompare(right.name);
}

function pickPreferredContextualXacroFile(robotFiles: readonly RobotFile[]): RobotFile | null {
  const xacroFiles = robotFiles.filter((file) => file.format === 'xacro');
  if (xacroFiles.length === 0) {
    return null;
  }

  const standaloneEntries = xacroFiles.filter((file) => isStandaloneXacroEntry(file));
  const candidates = standaloneEntries.length > 0 ? standaloneEntries : xacroFiles;

  return [...candidates].sort(compareContextualXacroPathPreference)[0] ?? null;
}

export async function buildContextualPreResolvedImports(
  robotFiles: readonly RobotFile[],
  options: Pick<ResolveRobotFileDataOptions, 'availableFiles' | 'assets' | 'allFileContents'>,
): Promise<PreResolvedImportEntry[]> {
  const preferredFile = pickPreferredContextualXacroFile(robotFiles);
  if (!preferredFile || preferredFile.format !== 'xacro') {
    return [];
  }

  const result = await resolveRobotFileDataWithWorker(preferredFile, options);

  return [{
    fileName: preferredFile.name,
    format: preferredFile.format,
    contentSignature: buildPreResolvedImportContentSignature(preferredFile.content),
    result,
  }];
}
