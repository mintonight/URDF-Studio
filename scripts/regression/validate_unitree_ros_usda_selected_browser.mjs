#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const OUTPUT_PATH = path.resolve('tmp/regression/unitree-ros-usda-selected.json');
const SITE_URL = 'http://127.0.0.1:4173/?regressionDebug=1';
const SITE_BASE_URL = 'http://127.0.0.1:4173';
const MAX_ATTEMPTS = 2;
const SITE_TIMEOUT_MS = 120_000;
const MODEL_TIMEOUT_MS = 600_000;
const URDF_FIXTURE_ROOT = path.resolve('test/unitree_ros/robots');
const USDA_FIXTURE_ROOT = path.resolve('test/unitree_ros_usda');

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectUrdfFiles(rootDir) {
  const files = [];
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectUrdfFiles(absolutePath)));
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith('.urdf') &&
      absolutePath.includes(`${path.sep}urdf${path.sep}`)
    ) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function discoverModels() {
  const urdfFiles = await collectUrdfFiles(URDF_FIXTURE_ROOT);
  const discoveredModels = [];

  for (const absoluteUrdfPath of urdfFiles) {
    const relativeUrdfPath = path.relative(URDF_FIXTURE_ROOT, absoluteUrdfPath).replace(/\\/g, '/');
    const packageDir = path.dirname(path.dirname(relativeUrdfPath));
    const fileStem = path.basename(relativeUrdfPath, '.urdf');
    const usdaRelativePath = `${packageDir}/urdf/${fileStem}.usda`;
    if (await pathExists(path.join(USDA_FIXTURE_ROOT, usdaRelativePath))) {
      discoveredModels.push(usdaRelativePath);
    }
  }

  const extraModels = ['b2_description_mujoco/xml/b2_description.usda'];
  for (const relativePath of extraModels) {
    if (await pathExists(path.join(USDA_FIXTURE_ROOT, relativePath))) {
      discoveredModels.push(relativePath);
    }
  }

  return [...new Set(discoveredModels)].sort((left, right) => left.localeCompare(right));
}

async function isSiteReachable(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureSite() {
  if (await isSiteReachable(SITE_BASE_URL)) {
    return { stop: async () => {} };
  }

  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
      detached: true,
    },
  );

  const deadline = Date.now() + SITE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isSiteReachable(SITE_BASE_URL)) {
      return {
        stop: async () => {
          if (child.exitCode != null || child.signalCode != null) return;
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {}
          await delay(500);
        },
      };
    }
    if (child.exitCode != null) {
      throw new Error(`preview process exited early with code ${child.exitCode}`);
    }
    await delay(500);
  }

  throw new Error(`Timed out waiting for preview at ${SITE_BASE_URL}`);
}

function hasFiniteVector(value, expectedLength) {
  return (
    Array.isArray(value) &&
    value.length === expectedLength &&
    value.every((entry) => Number.isFinite(Number(entry)))
  );
}

function hasSceneBindingCoverage(result) {
  const sceneSummary = result?.selectedUsdSceneSummary;
  const baseLink = sceneSummary?.baseLink;
  if (!sceneSummary || !baseLink) {
    return false;
  }

  const hasAnyBaseLinkBinding =
    baseLink.bindingSummary?.withDescriptorMaterialId > 0 ||
    baseLink.bindingSummary?.withGeometryMaterialId > 0 ||
    baseLink.bindingSummary?.withGeomSubsetSections > 0;
  const linkTransform = baseLink.transform ?? baseLink.runtimeLinkTransform ?? null;
  const maxDimension = hasFiniteVector(baseLink.bounds?.size, 3)
    ? Math.max(...baseLink.bounds.size.map((entry) => Number(entry)))
    : Number.NaN;
  const hasRuntimeBaseLinkTransform =
    (hasFiniteVector(linkTransform?.position, 3) &&
      hasFiniteVector(linkTransform?.quaternion, 4)) ||
    (Array.isArray(baseLink.runtimeVisualMeshTransforms) &&
      baseLink.runtimeVisualMeshTransforms.some(
        (entry) => hasFiniteVector(entry?.position, 3) && hasFiniteVector(entry?.quaternion, 4),
      ));

  return Boolean(
    sceneSummary.available === true &&
    sceneSummary.fileName === result?.selectedFileName &&
    baseLink.found === true &&
    baseLink.visualDescriptorCount > 0 &&
    hasAnyBaseLinkBinding &&
    baseLink.bindingSummary?.withoutAnyMaterialBinding < baseLink.bindingSummary?.descriptorCount &&
    hasFiniteVector(baseLink.bounds?.size, 3) &&
    baseLink.bounds.size.every((entry) => Number(entry) > 0) &&
    Number.isFinite(maxDimension) &&
    maxDimension < 10 &&
    hasRuntimeBaseLinkTransform,
  );
}

function shouldRequireSceneBindingCoverage(result) {
  return Boolean(
    typeof result?.selectedFileName === 'string' &&
    (result.selectedFileName.endsWith('.viewer_roundtrip.usd') ||
      result.selectedFileName.endsWith('.usd')),
  );
}

function isExpectedMainThreadModel(result) {
  const targetPath = String(
    result?.selectedFileName || result?.targetFileName || result?.modelKey || '',
  )
    .replace(/\\/g, '/')
    .toLowerCase();

  return (
    targetPath.includes('/h1_2/') ||
    targetPath.includes('/h1_2_handless/') ||
    targetPath.includes('/h1_with_hand')
  );
}

function validateResult(result) {
  const hasResolvedRobotData =
    result?.workerResolveEntry?.status === 'resolved' ||
    result?.runtimeResolveEntry?.status === 'resolved';
  const requiresWorkerPipeline = shouldRequireSceneBindingCoverage(result);
  const expectsOffscreenRenderer = !isExpectedMainThreadModel(result);
  const usesOffscreenRenderer =
    result?.workerResolveEntry?.status === 'resolved' &&
    !result?.runtimeResolveEntry &&
    result?.orbitInteraction?.canvasLabel === 'usd-offscreen-canvas' &&
    result?.orbitInteraction?.changed === true;
  const usesMainThreadRenderer = result?.runtimeResolveEntry?.status === 'resolved';
  return Boolean(
    result?.loaded === true &&
    hasResolvedRobotData &&
    result?.stageReady === true &&
    result?.metadataSourcePass === true &&
    result?.selectedFileName === result?.targetFileName &&
    result?.stagePreparationMode === 'worker' &&
    (!requiresWorkerPipeline || hasSceneBindingCoverage(result)) &&
    (!expectsOffscreenRenderer || usesOffscreenRenderer) &&
    (expectsOffscreenRenderer || usesMainThreadRenderer) &&
    (result?.consoleErrors?.length ?? 0) === 0 &&
    (result?.consoleWarnings?.length ?? 0) === 0 &&
    (result?.pageErrors?.length ?? 0) === 0,
  );
}

function summarizeFailures(report) {
  return (report?.results || [])
    .filter((result) => !validateResult(result))
    .map((result) => ({
      modelKey: result.modelKey,
      error: result.error ?? null,
      loaded: result.loaded,
      runtimePresent: result.runtimePresent,
      stageReady: result.stageReady,
      stagePreparationMode: result.stagePreparationMode,
      metadataSource: result.metadataSource,
      metadataSourcePass: result.metadataSourcePass,
      selectedFileName: result.selectedFileName,
      targetFileName: result.targetFileName,
      selectedUsdSceneSummary: result.selectedUsdSceneSummary ?? null,
      orbitInteraction: result.orbitInteraction ?? null,
      consoleErrors: result.consoleErrors,
      consoleWarnings: result.consoleWarnings,
      pageErrors: result.pageErrors,
    }));
}

function buildPerModelOutputPath(modelKey) {
  const fileName = modelKey.replace(/[\\/]/g, '__').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return path.resolve('tmp/regression/unitree-ros-usda-selected', `${fileName}.json`);
}

async function writeAggregateReport(models, results) {
  const report = {
    generatedAtUtc: new Date().toISOString(),
    workspace: process.cwd(),
    siteUrl: SITE_URL,
    summary: {
      modelCount: models.length,
      passedCount: results.filter((result) => validateResult(result)).length,
      failedCount: results.filter((result) => !validateResult(result)).length,
      models,
    },
    results,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function runModelRegression(modelKey) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const modelOutputPath = buildPerModelOutputPath(modelKey);
    try {
      await runCommand('node', [
        'scripts/regression/run_unitree_ros_usda_browser_regression.mjs',
        '--site-url',
        SITE_URL,
        '--no-start',
        '--timeout-ms',
        String(MODEL_TIMEOUT_MS),
        '--output',
        modelOutputPath,
        '--model',
        modelKey,
      ]);
      const report = await readJson(modelOutputPath);
      const result = report?.results?.[0] ?? null;
      if (result) {
        return result;
      }
      lastError = new Error(`Missing regression result for ${modelKey}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < MAX_ATTEMPTS) {
      console.warn(
        `[validate-unitree-ros-usda-selected-browser] retrying model ${modelKey} after attempt ${attempt}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    }
  }

  return {
    modelKey,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    loaded: false,
    runtimePresent: false,
    stageReady: false,
    stagePreparationMode: null,
    metadataSource: null,
    metadataSourcePass: false,
    selectedFileName: null,
    targetFileName: modelKey,
    selectedUsdSceneSummary: null,
    consoleErrors: [],
    pageErrors: [],
  };
}

async function main() {
  const models = await discoverModels();
  if (models.length === 0) {
    throw new Error(`No Unitree ROS USDA fixtures were discovered under ${USDA_FIXTURE_ROOT}`);
  }

  const site = await ensureSite();
  try {
    const results = [];
    for (const modelKey of models) {
      results.push(await runModelRegression(modelKey));
    }
    const report = await writeAggregateReport(models, results);
    const failures = summarizeFailures(report);
    if (failures.length === 0) {
      console.log(
        JSON.stringify(
          {
            output: OUTPUT_PATH,
            modelCount: report.summary.modelCount,
            passedCount: report.summary.passedCount,
            failedCount: 0,
          },
          null,
          2,
        ),
      );
      return;
    }

    throw new Error(`Unitree USDA browser validation failed: ${JSON.stringify(failures, null, 2)}`);
  } finally {
    await site.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
