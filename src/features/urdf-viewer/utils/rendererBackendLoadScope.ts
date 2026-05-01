import type { RobotData, RobotFile, UrdfJoint, UrdfLink } from '@/types';
import { createStableJsonSnapshot } from '@/shared/utils/robot/semanticSnapshot';
import { createViewerRobotLoadInputSignature } from './robotLoadScope';

interface CreateRendererBackendLoadScopeKeyOptions {
  sourceFile: RobotFile;
  availableFiles?: RobotFile[];
  assets: Record<string, string>;
  reloadToken?: number;
  allowUrdfXmlFallback?: boolean;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  robotData?: RobotData | null;
}

function hashStringFNV1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function hashStableValue(value: unknown): string {
  return hashStringFNV1a(createStableJsonSnapshot(value));
}

function createAssetSignature(assets: Record<string, string>): string {
  return hashStableValue(
    Object.entries(assets)
      .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
      .map(([path, url]) => [path, url]),
  );
}

function createAvailableFilesSignature(availableFiles: RobotFile[] | undefined): string {
  return hashStableValue(
    (availableFiles ?? [])
      .map((file) => ({
        name: file.name,
        format: file.format,
        blobUrl: file.blobUrl ?? null,
        content: hashStringFNV1a(file.content ?? ''),
      }))
      .sort((left, right) =>
        `${left.format}:${left.name}`.localeCompare(`${right.format}:${right.name}`),
      ),
  );
}

function hasStructuredRobotState(
  links: Record<string, UrdfLink> | undefined,
  joints: Record<string, UrdfJoint> | undefined,
): links is Record<string, UrdfLink> {
  return Boolean(
    links &&
      joints &&
      (Object.keys(links).length > 0 || Object.keys(joints).length > 0),
  );
}

export function createRendererBackendLoadScopeKey({
  sourceFile,
  availableFiles,
  assets,
  reloadToken = 0,
  allowUrdfXmlFallback = false,
  robotLinks,
  robotJoints,
  robotData,
}: CreateRendererBackendLoadScopeKeyOptions): string {
  const sourceContentHash = hashStringFNV1a(sourceFile.content ?? '');
  const format = sourceFile.format;
  const sourceSignature = hashStableValue({
    name: sourceFile.name,
    format,
    blobUrl: sourceFile.blobUrl ?? null,
    content: sourceContentHash,
  });
  const resolvedRobotLinks = robotData?.links ?? robotLinks;
  const resolvedRobotJoints = robotData?.joints ?? robotJoints;
  const structuredRobotStateAvailable = hasStructuredRobotState(
    resolvedRobotLinks,
    resolvedRobotJoints,
  );
  const robotInputSignature =
    format === 'usd'
      ? `usd-source:${sourceContentHash}`
      : createViewerRobotLoadInputSignature({
          urdfContent: sourceFile.content ?? '',
          hasStructuredRobotState: structuredRobotStateAvailable,
          robotLinks: resolvedRobotLinks,
          robotJoints: resolvedRobotJoints,
        });

  return hashStableValue({
    format,
    reloadToken,
    allowUrdfXmlFallback,
    source: sourceSignature,
    input: robotInputSignature,
    assets: createAssetSignature(assets),
    availableFiles: createAvailableFilesSignature(availableFiles),
  });
}
