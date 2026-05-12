import type { RobotData, RobotFile, UrdfJoint, UrdfLink } from '@/types';
import { isUsdLikeFormat } from '@/core/parsers/usd';
import {
  createStableJsonSnapshot,
  stripTransientJointMotionFromJoint,
} from '@/shared/utils/robot/semanticSnapshot';
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

export interface RendererBackendLoadScopeKeyMemo {
  lastKey?: string;
  lastSourceFile?: RobotFile;
  lastAvailableFiles?: RobotFile[];
  lastAssets?: Record<string, string>;
  lastReloadToken?: number;
  lastAllowUrdfXmlFallback?: boolean;
  lastResolvedRobotLinks?: Record<string, UrdfLink>;
  lastResolvedRobotJoints?: Record<string, UrdfJoint>;
  lastResolvedRobotJointsSignature?: string;
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

function createJointStructureSignature(joints: Record<string, UrdfJoint> | undefined): string {
  if (!joints) {
    return '';
  }

  return hashStableValue(stripTransientJointMotionFromJointsForSignature(joints));
}

function stripTransientJointMotionFromJointsForSignature(
  joints: Record<string, UrdfJoint>,
): Record<string, UrdfJoint> {
  return Object.fromEntries(
    Object.entries(joints).map(([jointId, joint]) => [
      jointId,
      stripTransientJointMotionFromJoint(joint),
    ]),
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
    isUsdLikeFormat(format)
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

export function createMemoizedRendererBackendLoadScopeKey(
  options: CreateRendererBackendLoadScopeKeyOptions,
  memo: RendererBackendLoadScopeKeyMemo,
): string {
  const resolvedRobotLinks = options.robotData?.links ?? options.robotLinks;
  const resolvedRobotJoints = options.robotData?.joints ?? options.robotJoints;

  if (
    memo.lastKey &&
    memo.lastSourceFile === options.sourceFile &&
    memo.lastAvailableFiles === options.availableFiles &&
    memo.lastAssets === options.assets &&
    memo.lastReloadToken === (options.reloadToken ?? 0) &&
    memo.lastAllowUrdfXmlFallback === (options.allowUrdfXmlFallback ?? false) &&
    memo.lastResolvedRobotLinks === resolvedRobotLinks
  ) {
    const nextJointStructureSignature = createJointStructureSignature(resolvedRobotJoints);
    if (memo.lastResolvedRobotJointsSignature === nextJointStructureSignature) {
      memo.lastResolvedRobotJoints = resolvedRobotJoints;
      return memo.lastKey;
    }
  }

  const nextKey = createRendererBackendLoadScopeKey(options);
  memo.lastKey = nextKey;
  memo.lastSourceFile = options.sourceFile;
  memo.lastAvailableFiles = options.availableFiles;
  memo.lastAssets = options.assets;
  memo.lastReloadToken = options.reloadToken ?? 0;
  memo.lastAllowUrdfXmlFallback = options.allowUrdfXmlFallback ?? false;
  memo.lastResolvedRobotLinks = resolvedRobotLinks;
  memo.lastResolvedRobotJoints = resolvedRobotJoints;
  memo.lastResolvedRobotJointsSignature = createJointStructureSignature(resolvedRobotJoints);

  return nextKey;
}
