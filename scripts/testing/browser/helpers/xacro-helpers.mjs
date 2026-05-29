#!/usr/bin/env node

/**
 * Xacro-specific browser regression helpers.
 * Provides file-upload import for xacro files.
 */

import path from 'node:path';

import { uploadFile } from '../../../e2e/helpers/browser-helpers.mjs';

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
 * Import a xacro file by uploading it.
 * @param {import('puppeteer').Page} page
 * @param {string} xacroPath - Absolute or relative path to the .xacro file
 * @param {string} expectedName - Expected name after expansion (e.g. 'robot.xacro')
 * @param {number} [timeoutMs=60_000]
 */
export async function importModel(page, xacroPath, expectedName, timeoutMs = 60_000) {
  const absPath = path.isAbsolute(xacroPath) ? xacroPath : path.join(UNITREE_ROS, xacroPath);
  await uploadFile(page, absPath, timeoutMs);
  await page.waitForFunction(
    (fn) => window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.()?.selectedFile?.name === fn,
    { timeout: timeoutMs }, expectedName,
  );
}
