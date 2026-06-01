#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BROWSER_REPORT_PATH = path.resolve(
  'tmp/regression/unitree-ros-usda-selected.json',
);
export const DEFAULT_TRUTH_PATH = path.resolve(
  'tmp/regression/unitree-ros-usda-isaaclab22-physics.json',
);
export const DEFAULT_OUTPUT_PATH = path.resolve(
  'tmp/regression/unitree-ros-usda-browser-physics-compare.json',
);
export const DEFAULT_MASS_TOLERANCE = 1e-6;
export const DEFAULT_COM_TOLERANCE = 1e-6;

const UNITREE_USDA_PREFIX = 'test/unitree_ros_usda/';

function normalizePathToken(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function stripUnitreePrefix(value) {
  const normalized = normalizePathToken(value);
  const index = normalized.indexOf(UNITREE_USDA_PREFIX);
  return index >= 0 ? normalized.slice(index + UNITREE_USDA_PREFIX.length) : normalized;
}

function lastPathSegment(value) {
  const normalized = normalizePathToken(value).replace(/\/+$/, '');
  if (!normalized || normalized === '/') {
    return '';
  }
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function finiteNumberOrZero(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function vector3OrZero(value) {
  if (Array.isArray(value)) {
    return [
      finiteNumberOrZero(value[0]),
      finiteNumberOrZero(value[1]),
      finiteNumberOrZero(value[2]),
    ];
  }

  if (value && typeof value === 'object') {
    return [
      finiteNumberOrZero(value.x),
      finiteNumberOrZero(value.y),
      finiteNumberOrZero(value.z),
    ];
  }

  return [0, 0, 0];
}

function vectorDistance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function getBrowserLinkName(link) {
  return String(link?.name ?? link?.id ?? '');
}

function getBrowserLinkCenterOfMass(link) {
  return vector3OrZero(link?.centerOfMass?.xyz);
}

function getTruthBodyName(body) {
  return (
    lastPathSegment(body?.fullPath) ||
    lastPathSegment(body?.path) ||
    lastPathSegment(body?.linkPath)
  );
}

function getResultModelKey(result) {
  return String(result?.modelKey || result?.targetFileName || result?.selectedFileName || '');
}

function getTruthCandidatesForResult(result) {
  const rawCandidates = [
    result?.modelKey,
    result?.targetFileName,
    result?.selectedFileName,
    result?.snapshot?.selectedFile?.name,
  ].filter(Boolean);
  const candidates = new Set();

  for (const candidate of rawCandidates) {
    const normalized = normalizePathToken(candidate);
    const stripped = stripUnitreePrefix(normalized);
    candidates.add(normalized);
    candidates.add(stripped);
    candidates.add(`${UNITREE_USDA_PREFIX}${stripped}`);
  }

  return [...candidates];
}

function buildTruthStageIndex(truthReport) {
  const index = new Map();

  for (const [key, value] of Object.entries(truthReport || {})) {
    const normalized = normalizePathToken(key);
    const stripped = stripUnitreePrefix(normalized);
    index.set(normalized, { key, stage: value });
    index.set(stripped, { key, stage: value });
    index.set(`${UNITREE_USDA_PREFIX}${stripped}`, { key, stage: value });
  }

  return index;
}

function buildUniqueNameMap(entries, getName) {
  const map = new Map();
  const duplicates = new Set();

  for (const entry of entries) {
    const name = getName(entry);
    if (!name) {
      continue;
    }
    if (map.has(name)) {
      duplicates.add(name);
      continue;
    }
    map.set(name, entry);
  }

  return { duplicates: [...duplicates].sort(), map };
}

function normalizeModelFilters(modelFilters) {
  return new Set((modelFilters || []).map((entry) => stripUnitreePrefix(entry)));
}

function shouldIncludeResult(result, modelFilterSet) {
  if (!modelFilterSet || modelFilterSet.size === 0) {
    return true;
  }

  const candidates = getTruthCandidatesForResult(result).map((entry) => stripUnitreePrefix(entry));
  return candidates.some((candidate) => modelFilterSet.has(candidate));
}

export function compareUnitreeRosUsdaBrowserPhysics({
  browserReport,
  truthReport,
  massTolerance = DEFAULT_MASS_TOLERANCE,
  comTolerance = DEFAULT_COM_TOLERANCE,
  modelFilters = [],
  maxFailureSamples = 32,
} = {}) {
  const results = Array.isArray(browserReport?.results) ? browserReport.results : [];
  const truthIndex = buildTruthStageIndex(truthReport);
  const modelFilterSet = normalizeModelFilters(modelFilters);
  const perModel = [];
  const failures = [];
  const summary = {
    models: 0,
    matchedLinks: 0,
    browserLinks: 0,
    truthBodies: 0,
    maxMassErr: 0,
    maxComErr: 0,
    missingLinks: 0,
    extraLinks: 0,
    massMismatches: 0,
    comMismatches: 0,
    duplicateBrowserNames: 0,
    duplicateTruthNames: 0,
    missingTruthStages: 0,
    worstMass: null,
    worstCom: null,
  };

  const addFailure = (failure) => {
    failures.push(failure);
  };

  for (const result of results) {
    if (!shouldIncludeResult(result, modelFilterSet)) {
      continue;
    }

    const modelKey = getResultModelKey(result);
    const truthEntry = getTruthCandidatesForResult(result)
      .map((candidate) => truthIndex.get(candidate))
      .find(Boolean);

    summary.models += 1;

    if (!truthEntry?.stage) {
      summary.missingTruthStages += 1;
      addFailure({
        type: 'missing-truth-stage',
        model: modelKey,
        candidates: getTruthCandidatesForResult(result),
      });
      perModel.push({
        model: modelKey,
        pass: false,
        browserLinks: Number(result?.snapshot?.store?.linkCount ?? 0),
        truthBodies: 0,
        matchedLinks: 0,
        missingLinks: 0,
        extraLinks: 0,
        maxMassErr: 0,
        maxComErr: 0,
      });
      continue;
    }

    const truthStage = truthEntry.stage;
    if (truthStage.open_ok === false) {
      addFailure({
        type: 'truth-stage-open-failed',
        model: modelKey,
        truthKey: truthEntry.key,
      });
    }

    const browserLinks = Array.isArray(result?.snapshot?.store?.links)
      ? result.snapshot.store.links
      : [];
    const truthBodies = Object.values(truthStage.rigidBodies || {});
    const browserNameMap = buildUniqueNameMap(browserLinks, getBrowserLinkName);
    const truthNameMap = buildUniqueNameMap(truthBodies, getTruthBodyName);
    const modelStats = {
      model: modelKey,
      truthKey: truthEntry.key,
      pass: true,
      browserLinks: browserLinks.length,
      truthBodies: truthBodies.length,
      matchedLinks: 0,
      missingLinks: 0,
      extraLinks: 0,
      massMismatches: 0,
      comMismatches: 0,
      duplicateBrowserNames: browserNameMap.duplicates.length,
      duplicateTruthNames: truthNameMap.duplicates.length,
      maxMassErr: 0,
      maxComErr: 0,
      worstMass: null,
      worstCom: null,
    };

    for (const duplicateName of browserNameMap.duplicates) {
      addFailure({ type: 'duplicate-browser-link-name', model: modelKey, link: duplicateName });
    }
    for (const duplicateName of truthNameMap.duplicates) {
      addFailure({ type: 'duplicate-truth-body-name', model: modelKey, link: duplicateName });
    }

    for (const truthBody of truthBodies) {
      const linkName = getTruthBodyName(truthBody);
      const browserLink = browserNameMap.map.get(linkName);
      if (!browserLink) {
        modelStats.missingLinks += 1;
        addFailure({
          type: 'missing-browser-link',
          model: modelKey,
          link: linkName,
          truthFullPath: truthBody.fullPath ?? null,
          truthMass: finiteNumberOrZero(truthBody.mass),
          truthCenterOfMass: vector3OrZero(truthBody.centerOfMass),
        });
        continue;
      }

      modelStats.matchedLinks += 1;
      const browserMass = finiteNumberOrZero(browserLink.mass);
      const truthMass = finiteNumberOrZero(truthBody.mass);
      const massErr = Math.abs(browserMass - truthMass);
      if (massErr > modelStats.maxMassErr) {
        modelStats.maxMassErr = massErr;
        modelStats.worstMass = {
          link: linkName,
          browserMass,
          truthMass,
          massErr,
        };
      }
      if (massErr > massTolerance) {
        modelStats.massMismatches += 1;
        addFailure({
          type: 'mass-mismatch',
          model: modelKey,
          link: linkName,
          browserMass,
          truthMass,
          massErr,
          tolerance: massTolerance,
        });
      }

      const browserCenterOfMass = getBrowserLinkCenterOfMass(browserLink);
      const truthCenterOfMass = vector3OrZero(truthBody.centerOfMass);
      const comErr = vectorDistance(browserCenterOfMass, truthCenterOfMass);
      if (comErr > modelStats.maxComErr) {
        modelStats.maxComErr = comErr;
        modelStats.worstCom = {
          link: linkName,
          browserCenterOfMass,
          truthCenterOfMass,
          comErr,
        };
      }
      if (comErr > comTolerance) {
        modelStats.comMismatches += 1;
        addFailure({
          type: 'center-of-mass-mismatch',
          model: modelKey,
          link: linkName,
          browserCenterOfMass,
          truthCenterOfMass,
          comErr,
          tolerance: comTolerance,
        });
      }
    }

    for (const browserLink of browserLinks) {
      const linkName = getBrowserLinkName(browserLink);
      if (!truthNameMap.map.has(linkName)) {
        modelStats.extraLinks += 1;
        addFailure({
          type: 'extra-browser-link',
          model: modelKey,
          link: linkName,
          browserMass: finiteNumberOrZero(browserLink.mass),
          browserCenterOfMass: getBrowserLinkCenterOfMass(browserLink),
        });
      }
    }

    modelStats.pass =
      modelStats.missingLinks === 0 &&
      modelStats.extraLinks === 0 &&
      modelStats.massMismatches === 0 &&
      modelStats.comMismatches === 0 &&
      modelStats.duplicateBrowserNames === 0 &&
      modelStats.duplicateTruthNames === 0 &&
      truthStage.open_ok !== false;

    summary.matchedLinks += modelStats.matchedLinks;
    summary.browserLinks += modelStats.browserLinks;
    summary.truthBodies += modelStats.truthBodies;
    summary.missingLinks += modelStats.missingLinks;
    summary.extraLinks += modelStats.extraLinks;
    summary.massMismatches += modelStats.massMismatches;
    summary.comMismatches += modelStats.comMismatches;
    summary.duplicateBrowserNames += modelStats.duplicateBrowserNames;
    summary.duplicateTruthNames += modelStats.duplicateTruthNames;
    if (modelStats.maxMassErr > summary.maxMassErr) {
      summary.maxMassErr = modelStats.maxMassErr;
      summary.worstMass = modelStats.worstMass
        ? { model: modelKey, ...modelStats.worstMass }
        : null;
    }
    if (modelStats.maxComErr > summary.maxComErr) {
      summary.maxComErr = modelStats.maxComErr;
      summary.worstCom = modelStats.worstCom ? { model: modelKey, ...modelStats.worstCom } : null;
    }

    perModel.push(modelStats);
  }

  if (summary.models === 0) {
    addFailure({
      type: 'no-browser-results',
      message: 'No browser report results matched the requested filters.',
    });
  }

  const pass = failures.length === 0;
  return {
    pass,
    summary: {
      ...summary,
      pass,
      failureCount: failures.length,
      massTolerance,
      comTolerance,
    },
    perModel,
    failures: failures.slice(0, maxFailureSamples),
    omittedFailureCount: Math.max(0, failures.length - maxFailureSamples),
  };
}

function printUsage() {
  console.log(`Usage:
  node scripts/test/truth/compare_unitree_ros_usda_browser_physics.mjs [options]

Options:
  --browser-report <path>  Browser regression JSON. Default: ${DEFAULT_BROWSER_REPORT_PATH}
  --truth <path>           IsaacLab/IsaacSim physics JSON. Default: ${DEFAULT_TRUTH_PATH}
  --output <path>          Comparison JSON output. Default: ${DEFAULT_OUTPUT_PATH}
  --model <filter>         Restrict to a model path. Repeatable.
  --mass-tolerance <n>     Absolute mass tolerance. Default: ${DEFAULT_MASS_TOLERANCE}
  --com-tolerance <n>      Euclidean COM tolerance. Default: ${DEFAULT_COM_TOLERANCE}
  --max-failures <n>       Failure samples to include in output. Default: 32
  --help                   Show this help message.
`);
}

function parseArgs(argv) {
  const options = {
    browserReportPath: DEFAULT_BROWSER_REPORT_PATH,
    truthPath: DEFAULT_TRUTH_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    massTolerance: DEFAULT_MASS_TOLERANCE,
    comTolerance: DEFAULT_COM_TOLERANCE,
    maxFailureSamples: 32,
    modelFilters: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[index];
    };

    switch (arg) {
      case '--browser-report':
        options.browserReportPath = path.resolve(next());
        break;
      case '--truth':
        options.truthPath = path.resolve(next());
        break;
      case '--output':
        options.outputPath = path.resolve(next());
        break;
      case '--model':
        options.modelFilters.push(next());
        break;
      case '--mass-tolerance':
        options.massTolerance = Number(next());
        break;
      case '--com-tolerance':
        options.comTolerance = Number(next());
        break;
      case '--max-failures':
        options.maxFailureSamples = Number.parseInt(next(), 10);
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.massTolerance) || options.massTolerance < 0) {
    throw new Error(`Invalid --mass-tolerance: ${options.massTolerance}`);
  }
  if (!Number.isFinite(options.comTolerance) || options.comTolerance < 0) {
    throw new Error(`Invalid --com-tolerance: ${options.comTolerance}`);
  }
  if (!Number.isInteger(options.maxFailureSamples) || options.maxFailureSamples < 1) {
    throw new Error(`Invalid --max-failures: ${options.maxFailureSamples}`);
  }

  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const [browserReport, truthReport] = await Promise.all([
    readJson(options.browserReportPath),
    readJson(options.truthPath),
  ]);
  const comparison = compareUnitreeRosUsdaBrowserPhysics({
    browserReport,
    truthReport,
    massTolerance: options.massTolerance,
    comTolerance: options.comTolerance,
    modelFilters: options.modelFilters,
    maxFailureSamples: options.maxFailureSamples,
  });

  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        output: options.outputPath,
        pass: comparison.pass,
        summary: comparison.summary,
      },
      null,
      2,
    ),
  );

  if (!comparison.pass) {
    throw new Error(
      `Unitree ROS USDA browser physics comparison failed: ${JSON.stringify(
        comparison.failures,
        null,
        2,
      )}`,
    );
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
