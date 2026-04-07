#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const OUTPUT_PATH = path.resolve('tmp/regression/unitree-ros-usda-selected.json');
const SITE_URL = 'http://127.0.0.1:4173/?regressionDebug=1';
const SITE_BASE_URL = 'http://127.0.0.1:4173';
const MODELS = [
  'go2_description/urdf/go2_description.usda',
  'b2_description/urdf/b2_description.usda',
  'h1_2_description/h1_2.usda',
];
const MAX_ATTEMPTS = 2;
const SITE_TIMEOUT_MS = 120_000;

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

  const child = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
    detached: true,
  });

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

function validateResult(result) {
  return Boolean(
    result?.loaded === true &&
    result?.runtimePresent === true &&
    result?.stageReady === true &&
    result?.metadataSourcePass === true &&
    result?.selectedFileName === result?.targetFileName,
  );
}

function summarizeFailures(report) {
  return (report?.results || [])
    .filter((result) => !validateResult(result))
    .map((result) => ({
      modelKey: result.modelKey,
      loaded: result.loaded,
      runtimePresent: result.runtimePresent,
      stageReady: result.stageReady,
      stagePreparationMode: result.stagePreparationMode,
      metadataSource: result.metadataSource,
      metadataSourcePass: result.metadataSourcePass,
      selectedFileName: result.selectedFileName,
      targetFileName: result.targetFileName,
      consoleErrors: result.consoleErrors,
      pageErrors: result.pageErrors,
    }));
}

async function main() {
  let lastReport = null;
  const site = await ensureSite();
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await runCommand('node', [
        'scripts/regression/run_unitree_ros_usda_browser_regression.mjs',
        '--site-url',
        SITE_URL,
        '--no-start',
        '--output',
        OUTPUT_PATH,
        ...MODELS.flatMap((model) => ['--model', model]),
      ]);
      lastReport = await readJson(OUTPUT_PATH);

      const failures = summarizeFailures(lastReport);
      if (failures.length === 0) {
        console.log(
          JSON.stringify(
            {
              output: OUTPUT_PATH,
              modelCount: lastReport.summary?.modelCount ?? MODELS.length,
              passedCount: MODELS.length,
              failedCount: 0,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[validate-unitree-ros-usda-selected-browser] retrying after attempt ${attempt}`,
          failures,
        );
      }
    }
  } finally {
    await site.stop();
  }

  throw new Error(
    `Unitree USDA browser validation failed: ${JSON.stringify(summarizeFailures(lastReport), null, 2)}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
