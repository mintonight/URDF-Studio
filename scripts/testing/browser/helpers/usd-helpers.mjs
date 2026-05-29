#!/usr/bin/env node

/**
 * USD/USDA-specific browser regression helpers.
 * Provides seed-and-load import for USD and USDA model files,
 * using the regression debug API (seedFixtureFile + loadRobotByName).
 */

import path from 'node:path';

// Re-export all format-agnostic helpers
export {
  createTestSuite, assert, assertEqual, assertGreaterThan, assertNonNull, printSummary,
  DEFAULT_OPERATION_TIMEOUT_MS,
  createSession, waitForReady, getTopology, getAssemblyState, getRuntimeTransforms,
  store, writeReport,
} from './base-helpers.mjs';

// ── Import ───────────────────────────────────────────────────────────

/**
 * Seed fixture files from a directory and load a specific USD/USDA model.
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @param {string} options.sourceRoot - Absolute path to model root directory
 * @param {string} options.exposedRoot - Relative path under public test dir
 * @param {string} options.loadFileName - File name to load via debug API
 * @param {number} [options.timeoutMs=120_000]
 */
export async function importModel(page, { sourceRoot, exposedRoot, loadFileName }, timeoutMs = 120_000) {
  // Reset fixture files first
  const resetResult = await page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    return api?.resetFixtureFiles?.() ?? { ok: false };
  });
  if (!resetResult?.ok) {
    throw new Error(`Failed to reset fixture files: ${JSON.stringify(resetResult)}`);
  }

  // Wait for regression debug handlers to be ready
  await page.waitForFunction(
    () => {
      const api = window.__URDF_STUDIO_DEBUG__;
      return typeof api?.seedFixtureFile === 'function' && typeof api?.loadRobotByName === 'function';
    },
    { timeout: timeoutMs },
  );

  // Seed the fixture directory
  const seedResult = await page.evaluate(
    ({ root, exposed }) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      return api?.seedFixtureFile?.(root, exposed) ?? { ok: false };
    },
    { root: sourceRoot, exposed: exposedRoot },
  );
  if (!seedResult?.ok) {
    throw new Error(`Failed to seed fixture: ${JSON.stringify(seedResult)}`);
  }

  // Load the robot by name
  const loadResult = await page.evaluate(
    (name) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      return api?.loadRobotByName?.(name) ?? { ok: false };
    },
    loadFileName,
  );
  if (!loadResult?.ok) {
    throw new Error(`Failed to load robot "${loadFileName}": ${JSON.stringify(loadResult)}`);
  }
}

/**
 * Convenience: import a Unitree USD model by key name.
 * @param {import('puppeteer').Page} page
 * @param {string} modelKey - e.g. 'Go2', 'H1', 'B2'
 * @param {number} [timeoutMs=120_000]
 */
export async function importUnitreeModel(page, modelKey, timeoutMs = 120_000) {
  const UNITREE_MODELS = {
    Go2: {
      sourceRoot: path.resolve('test/unitree_model/Go2'),
      exposedRoot: 'unitree_model/Go2',
      loadFileName: 'unitree_model/Go2/usd/go2.usd',
    },
    Go2W: {
      sourceRoot: path.resolve('test/unitree_model/Go2W'),
      exposedRoot: 'unitree_model/Go2W',
      loadFileName: 'unitree_model/Go2W/usd/go2w.usd',
    },
    B2: {
      sourceRoot: path.resolve('test/unitree_model/B2'),
      exposedRoot: 'unitree_model/B2',
      loadFileName: 'unitree_model/B2/usd/b2.usd',
    },
    H1: {
      sourceRoot: path.resolve('test/unitree_model/H1/h1'),
      exposedRoot: 'unitree_model/H1/h1',
      loadFileName: 'unitree_model/H1/h1/usd/h1.usd',
    },
  };

  const config = UNITREE_MODELS[modelKey];
  if (!config) {
    throw new Error(`Unknown Unitree model key: ${modelKey}. Available: ${Object.keys(UNITREE_MODELS).join(', ')}`);
  }

  return importModel(page, config, timeoutMs);
}
