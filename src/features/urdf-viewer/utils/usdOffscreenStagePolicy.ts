import type { RobotFile } from '@/types';
import type { ToolMode, ViewerProps } from '../types';
import { supportsUsdWorkerRenderer } from './usdWorkerRendererSupport.ts';
import { collectUsdStageOpenRelevantVirtualPaths, toVirtualUsdPath } from './usdPreloadSources.ts';

type OffscreenUsdFileLike = Pick<RobotFile, 'name' | 'content' | 'format' | 'blobUrl'>;

interface ShouldUseUsdOffscreenStageOptions {
  toolMode: ToolMode;
  selection?: ViewerProps['selection'];
  hoveredSelection?: ViewerProps['hoveredSelection'];
  focusTarget?: string | null;
  sourceFile?: OffscreenUsdFileLike | null;
  availableFiles?: OffscreenUsdFileLike[];
  showOrigins?: boolean;
  showJointAxes?: boolean;
  showCenterOfMass?: boolean;
  showInertia?: boolean;
  workerRendererSupported?: boolean;
}

const HAND_ARTICULATION_TOKEN_PATTERN =
  /\b(?:[LR]_(?:thumb|index|middle|ring|pinky)(?:_|\b)|(?:left|right)_(?:thumb|index|middle|ring|pinky)(?:_|\b))/i;
const KNOWN_UNSUPPORTED_OFFSCREEN_BUNDLE_TOKENS = new Set([
  'b2',
  'b2_description',
  'b2w',
  'b2w_description',
  'h1_2',
  'h1_2_handless',
]);
const EMPTY_OFFSCREEN_USD_FILES: OffscreenUsdFileLike[] = [];
const handArticulationSupportCache = new WeakMap<
  OffscreenUsdFileLike,
  WeakMap<OffscreenUsdFileLike[], boolean>
>();

function normalizeUsdFileName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .replace(/\\/g, '/');
}

function isUsdFileLike(file: OffscreenUsdFileLike | null | undefined): boolean {
  return Boolean(file && (file.format === 'usd' || /\.usd[a-z]?$/i.test(file.name)));
}

function getUsdFileStem(name: string | null | undefined): string {
  const normalizedName = normalizeUsdFileName(name);
  const fileName = normalizedName.split('/').pop() || '';
  return fileName.replace(/\.usd[a-z]?$/i, '').toLowerCase();
}

function hasKnownUnsupportedOffscreenBundleToken(name: string | null | undefined): boolean {
  const normalizedName = normalizeUsdFileName(name).toLowerCase();
  if (!normalizedName) {
    return false;
  }

  const normalizedSegments = normalizedName
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const stageScopeTokens = new Set(normalizedSegments);
  const fileStem = getUsdFileStem(normalizedName);
  if (fileStem) {
    stageScopeTokens.add(fileStem);
  }

  for (const token of KNOWN_UNSUPPORTED_OFFSCREEN_BUNDLE_TOKENS) {
    if (stageScopeTokens.has(token)) {
      return true;
    }
  }

  return false;
}

function hasUnsupportedHandArticulation({
  sourceFile,
  availableFiles,
}: Pick<ShouldUseUsdOffscreenStageOptions, 'sourceFile' | 'availableFiles'>): boolean {
  if (!isUsdFileLike(sourceFile)) {
    return false;
  }

  const scopedAvailableFiles = availableFiles ?? EMPTY_OFFSCREEN_USD_FILES;
  const cachedResultsBySource = handArticulationSupportCache.get(sourceFile);
  const cachedResult = cachedResultsBySource?.get(scopedAvailableFiles);
  if (cachedResult !== undefined) {
    return cachedResult;
  }

  const relevantPathSet = new Set(
    collectUsdStageOpenRelevantVirtualPaths(sourceFile, scopedAvailableFiles),
  );
  const candidateFiles = [
    sourceFile,
    ...scopedAvailableFiles.filter(
      (file) =>
        isUsdFileLike(file) &&
        file.name !== sourceFile.name &&
        relevantPathSet.has(toVirtualUsdPath(file.name)),
    ),
  ];

  const candidateFileNames = candidateFiles
    .map((file) => normalizeUsdFileName(file?.name))
    .filter((name) => name.length > 0);
  const hasUnsupportedBundlePattern = candidateFileNames.some((name) =>
    hasKnownUnsupportedOffscreenBundleToken(name),
  );
  const hasUnsupportedToken =
    !hasUnsupportedBundlePattern &&
    candidateFiles.some((file) => {
      if (typeof file.content !== 'string' || file.content.length === 0) {
        return false;
      }
      return HAND_ARTICULATION_TOKEN_PATTERN.test(file.content);
    });
  const nextResult = hasUnsupportedBundlePattern || hasUnsupportedToken;

  const nextCachedResultsBySource =
    cachedResultsBySource ?? new WeakMap<OffscreenUsdFileLike[], boolean>();
  nextCachedResultsBySource.set(scopedAvailableFiles, nextResult);
  if (!cachedResultsBySource) {
    handArticulationSupportCache.set(sourceFile, nextCachedResultsBySource);
  }

  return nextResult;
}

export function shouldUseUsdOffscreenStage({
  toolMode,
  selection,
  hoveredSelection,
  focusTarget,
  sourceFile,
  availableFiles,
  showOrigins = false,
  showJointAxes = false,
  showCenterOfMass = false,
  showInertia = false,
  workerRendererSupported = supportsUsdWorkerRenderer(),
}: ShouldUseUsdOffscreenStageOptions): boolean {
  void selection;
  void hoveredSelection;
  void focusTarget;

  if (!workerRendererSupported) {
    return false;
  }

  if (toolMode !== 'view' && toolMode !== 'select') {
    return false;
  }

  if (showJointAxes || showCenterOfMass || showInertia) {
    return false;
  }

  if (hasUnsupportedHandArticulation({ sourceFile, availableFiles })) {
    return false;
  }

  return true;
}

export function shouldBootstrapUsdOffscreenStage({
  toolMode,
  selection,
  hoveredSelection,
  focusTarget,
  workerRendererSupported = supportsUsdWorkerRenderer(),
}: ShouldUseUsdOffscreenStageOptions): boolean {
  void toolMode;
  void selection;
  void hoveredSelection;
  void focusTarget;
  void workerRendererSupported;

  // The offscreen bootstrap path opens the same USD stage twice during the
  // default interactive load: once in the worker bootstrap renderer and again
  // in the main-thread interactive renderer. That duplicate stage-open work
  // increases USDA load time and can expose transient scene swaps. Keep select
  // mode on the single proven interactive path until the bootstrap handoff is
  // reworked around shared stage-open data and a stable first-frame policy.
  return false;
}
