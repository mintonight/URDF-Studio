#!/usr/bin/env node

/**
 * URDF-specific browser regression helpers.
 * Provides directory-upload import for URDF robot packages.
 */

import path from 'node:path';

import { collectFiles, uploadDirectory } from '../../../e2e/helpers/browser-helpers.mjs';

// Re-export all format-agnostic helpers
export {
  createTestSuite, assert, assertEqual, assertGreaterThan, assertNonNull, printSummary,
  DEFAULT_OPERATION_TIMEOUT_MS,
  createSession, waitForReady, getTopology, getAssemblyState, getRuntimeTransforms,
  store, writeReport,
} from './base-helpers.mjs';

const UNITREE_ROS = path.resolve('test/unitree_ros/robots');

// ── Import ───────────────────────────────────────────────────────────

/**
 * Import a URDF robot package by uploading its directory.
 * @param {import('puppeteer').Page} page
 * @param {string} modelDir - Relative to test/unitree_ros/robots/ or absolute
 * @param {string} fileName - Expected file name after load (e.g. 'a1.urdf')
 * @param {number} [timeoutMs=60_000]
 */
export async function importModel(page, modelDir, fileName, timeoutMs = 60_000) {
  const dir = path.isAbsolute(modelDir) ? modelDir : path.join(UNITREE_ROS, modelDir);
  await uploadDirectory(page, dir, timeoutMs);
  await page.waitForFunction(
    (fn) => window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.()?.selectedFile?.name === fn,
    { timeout: timeoutMs }, fileName,
  );
}
