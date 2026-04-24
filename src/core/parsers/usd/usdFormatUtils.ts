/**
 * USD format detection utilities.
 * These helpers are intentionally limited to format detection only.
 * Runtime parsing and metadata extraction should come from usd-viewer WASM.
 */

const SUPPORTED_USD_EXTENSIONS = new Set(['usd', 'usda', 'usdc', 'usdz']);

function getUsdExtension(path: string): string {
  const normalizedPath = String(path || '')
    .trim()
    .toLowerCase();
  const lastDotIndex = normalizedPath.lastIndexOf('.');
  if (lastDotIndex < 0) return '';
  return normalizedPath.slice(lastDotIndex + 1);
}

function getUsdPathDepth(path: string): number {
  return String(path || '')
    .split('/')
    .filter(Boolean).length;
}

function getUsdRootCandidateScore(path: string): number {
  const extension = getUsdExtension(path);
  if (extension === 'usd') return 0;
  if (extension === 'usda') return 1;
  if (extension === 'usdc') return 2;
  if (extension === 'usdz') return 3;
  return 4;
}

function isSupportedUsdPath(path: string): boolean {
  return SUPPORTED_USD_EXTENSIONS.has(getUsdExtension(path));
}

export function isViewerRoundtripUsdRootPath(path: string): boolean {
  const normalizedPath = String(path || '')
    .trim()
    .toLowerCase();
  const baseName = normalizedPath.split('/').pop() || '';
  return /\.viewer_roundtrip\.usd[a-z]?$/i.test(baseName);
}

/**
 * Check if content is likely a USDA file.
 */
export function isUSDA(content: string): boolean {
  if (!content || typeof content !== 'string') return false;
  const trimmed = content.trim();
  if (trimmed.startsWith('#usda')) return true;
  if (trimmed.startsWith('PXR-USDC')) return false;
  return (
    /\b(?:def|over|class)\s+(?:[\w:]+\s+)?"[^"]+"/.test(content) || /\bdefaultPrim\b/.test(content)
  );
}

/**
 * Check whether an ArrayBuffer looks like a USDC binary file.
 */
export function isUSDCBinary(content: ArrayBuffer): boolean {
  if (!(content instanceof ArrayBuffer) || content.byteLength < 8) {
    return false;
  }

  const view = new DataView(content);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
    view.getUint8(4),
    view.getUint8(5),
    view.getUint8(6),
    view.getUint8(7),
  );
  return magic === 'PXR-USDC';
}

/**
 * Detect configuration sidecar layers that should not be auto-picked as bundle roots.
 */
export function isLikelyNonRenderableUsdConfigPath(path: string): boolean {
  const normalizedPath = String(path || '')
    .trim()
    .toLowerCase();
  if (!normalizedPath.includes('/configuration/')) return false;

  if (
    normalizedPath.endsWith('_sensor.usd') ||
    normalizedPath.endsWith('_robot.usd') ||
    normalizedPath.endsWith('h1_2_handless_robot.usd')
  ) {
    return true;
  }

  return /_(base|physics|sensor|robot)\.usd[a-z]?$/i.test(normalizedPath);
}

/**
 * Pick the most likely root USD file from an imported bundle.
 */
export function pickPreferredUsdRootFile<T extends { name: string }>(files: T[]): T | null {
  const usdCandidates = files.filter((file) => isSupportedUsdPath(file.name));
  if (usdCandidates.length === 0) return null;

  const preferredCandidates = usdCandidates.filter(
    (file) => !isLikelyNonRenderableUsdConfigPath(file.name),
  );
  const candidatePool = preferredCandidates.length > 0 ? preferredCandidates : usdCandidates;

  candidatePool.sort((left, right) => {
    const leftRoundtripScore = isViewerRoundtripUsdRootPath(left.name) ? 0 : 1;
    const rightRoundtripScore = isViewerRoundtripUsdRootPath(right.name) ? 0 : 1;
    if (leftRoundtripScore !== rightRoundtripScore) return leftRoundtripScore - rightRoundtripScore;

    const depthDiff = getUsdPathDepth(left.name) - getUsdPathDepth(right.name);
    if (depthDiff !== 0) return depthDiff;

    const leftConfigPenalty = isLikelyNonRenderableUsdConfigPath(left.name) ? 1 : 0;
    const rightConfigPenalty = isLikelyNonRenderableUsdConfigPath(right.name) ? 1 : 0;
    if (leftConfigPenalty !== rightConfigPenalty) return leftConfigPenalty - rightConfigPenalty;

    const extensionScoreDiff =
      getUsdRootCandidateScore(left.name) - getUsdRootCandidateScore(right.name);
    if (extensionScoreDiff !== 0) return extensionScoreDiff;

    return left.name.localeCompare(right.name);
  });

  return candidatePool[0] ?? null;
}
