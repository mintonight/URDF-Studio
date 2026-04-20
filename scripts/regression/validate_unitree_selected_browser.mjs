#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const OUTPUT_PATH = path.resolve('tmp/regression/unitree-browser-selected.json');
const SITE_URL = 'http://127.0.0.1:4173/?regressionDebug=1';
const SITE_BASE_URL = 'http://127.0.0.1:4173';
const MODELS = ['Go2', 'Go2W', 'B2', 'H1', 'H1-2', 'H1-2-Handless', 'G1-23DoF', 'G1-29DoF'];
const MAX_ATTEMPTS = 2;
const SITE_TIMEOUT_MS = 120_000;
const MODEL_TIMEOUT_MS = 600_000;

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

function hasResolvedRobotData(result) {
  return (
    result?.workerResolveEntry?.status === 'resolved' ||
    result?.runtimeResolveEntry?.status === 'resolved'
  );
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

function hasExpectedB2VisualMaterialRendering(result) {
  const targetPath = String(result?.selectedFileName || result?.targetFileName || '').toLowerCase();
  if (!targetPath.includes('unitree_model/b2/')) {
    return true;
  }

  const summary = result?.selectedUsdVisualMaterialSummary;
  if (!summary || !Array.isArray(summary.meshes) || summary.meshes.length === 0) {
    return false;
  }

  const materialColorsByName = new Map();
  for (const mesh of summary.meshes) {
    if (mesh?.overrideColor || mesh?.hasOverrideMaterial) {
      return false;
    }
    const materials = Array.isArray(mesh?.materials) ? mesh.materials : [];
    for (const material of materials) {
      const name = String(material?.name || '').trim();
      const color = String(material?.color || '')
        .trim()
        .toLowerCase();
      if (name && color && !materialColorsByName.has(name)) {
        materialColorsByName.set(name, color);
      }
    }
  }

  const parseHexColor = (value) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    const match = /^#([0-9a-f]{6})$/.exec(normalized);
    return match ? Number.parseInt(match[1], 16) : Number.NaN;
  };

  const accentColor = parseHexColor(materialColorsByName.get('material_______024'));
  return (
    materialColorsByName.get('material_______023') === '#000000' &&
    Number.isFinite(accentColor) &&
    accentColor >= 0x000000 &&
    accentColor <= 0x101010
  );
}

function isExpectedMainThreadModel(result) {
  const targetPath = String(
    result?.selectedFileName || result?.targetFileName || result?.modelKey || '',
  )
    .replace(/\\/g, '/')
    .toLowerCase();

  return (
    targetPath.includes('/b2/') ||
    targetPath.includes('b2_description') ||
    targetPath.includes('/h1_2/') ||
    targetPath.includes('/h1_2_handless/')
  );
}

function validateResult(result) {
  const expectsOffscreenRenderer = !isExpectedMainThreadModel(result);
  const usesOffscreenRenderer =
    result?.workerResolveEntry?.status === 'resolved' &&
    !result?.runtimeResolveEntry &&
    result?.orbitInteraction?.canvasLabel === 'usd-offscreen-canvas' &&
    result?.orbitInteraction?.changed === true;
  const usesMainThreadRenderer = result?.runtimeResolveEntry?.status === 'resolved';
  return Boolean(
    result?.loaded === true &&
    hasResolvedRobotData(result) &&
    result?.stageReady === true &&
    result?.stagePreparationMode === 'worker' &&
    result?.metadataSourcePass === true &&
    hasSceneBindingCoverage(result) &&
    hasExpectedB2VisualMaterialRendering(result) &&
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
      sampleId: result.sampleId,
      loaded: result.loaded,
      runtimePresent: result.runtimePresent,
      workerResolveStatus: result.workerResolveEntry?.status ?? null,
      runtimeResolveStatus: result.runtimeResolveEntry?.status ?? null,
      stageReady: result.stageReady,
      stagePreparationMode: result.stagePreparationMode,
      metadataSource: result.metadataSource,
      metadataSourcePass: result.metadataSourcePass,
      selectedUsdSceneSummary: result.selectedUsdSceneSummary ?? null,
      selectedUsdVisualMaterialSummary: result.selectedUsdVisualMaterialSummary ?? null,
      orbitInteraction: result.orbitInteraction ?? null,
      consoleErrors: result.consoleErrors,
      consoleWarnings: result.consoleWarnings,
      pageErrors: result.pageErrors,
    }));
}

function buildPerModelOutputPath(modelKey) {
  const fileName = modelKey.replace(/[\\/]/g, '__').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return path.resolve('tmp/regression/unitree-browser-selected', `${fileName}.json`);
}

async function writeAggregateReport(results) {
  const report = {
    generatedAtUtc: new Date().toISOString(),
    workspace: process.cwd(),
    siteUrl: SITE_URL,
    summary: {
      modelCount: MODELS.length,
      passedCount: results.filter((result) => validateResult(result)).length,
      failedCount: results.filter((result) => !validateResult(result)).length,
      models: MODELS,
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
        'scripts/regression/run_unitree_browser_regression.mjs',
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
      if (!(await pathExists(modelOutputPath))) {
        throw new Error(`Missing regression output for ${modelKey}`);
      }
      const report = await readJson(modelOutputPath);
      const result = report?.results?.[0] ?? null;
      if (result) {
        return result;
      }
      throw new Error(`Missing regression result for ${modelKey}`);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[validate-unitree-selected-browser] retrying model ${modelKey} after attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return {
    modelKey,
    sampleId: modelKey,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    loaded: false,
    runtimePresent: false,
    workerResolveEntry: null,
    runtimeResolveEntry: null,
    stageReady: false,
    stagePreparationMode: null,
    metadataSource: null,
    metadataSourcePass: false,
    selectedUsdSceneSummary: null,
    selectedUsdVisualMaterialSummary: null,
    orbitInteraction: null,
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
  };
}

async function main() {
  const site = await ensureSite();
  try {
    const results = [];
    for (const modelKey of MODELS) {
      results.push(await runModelRegression(modelKey));
    }
    const report = await writeAggregateReport(results);
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

    throw new Error(`Unitree USD browser validation failed: ${JSON.stringify(failures, null, 2)}`);
  } finally {
    await site.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
