#!/usr/bin/env node

/**
 * SDF-specific browser regression helpers.
 * Provides directory-upload import for Gazebo SDF model packages.
 */

import path from 'node:path';

import { uploadDirectory } from '../../../e2e/helpers/browser-helpers.mjs';

// Re-export all format-agnostic helpers
export {
  createTestSuite, assert, assertEqual, assertGreaterThan, assertNonNull, printSummary,
  DEFAULT_OPERATION_TIMEOUT_MS,
  createSession, waitForReady, getTopology, getAssemblyState, getRuntimeTransforms,
  store, writeReport,
} from './base-helpers.mjs';

const GAZEBO_MODELS = path.resolve('test/gazebo_models');

// ── Import ───────────────────────────────────────────────────────────

/**
 * Import an SDF model by uploading its directory.
 * @param {import('puppeteer').Page} page
 * @param {string} modelDir - Relative to test/gazebo_models/ or absolute
 * @param {string} fileName - Expected file name after load (e.g. 'model.sdf')
 * @param {number} [timeoutMs=60_000]
 */
export async function importModel(page, modelDir, fileName, timeoutMs = 60_000) {
  const dir = path.isAbsolute(modelDir) ? modelDir : path.join(GAZEBO_MODELS, modelDir);
  await uploadDirectory(page, dir, timeoutMs);
  await page.waitForFunction(
    (fn) => window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.()?.selectedFile?.name === fn,
    { timeout: timeoutMs }, fileName,
  );
}
