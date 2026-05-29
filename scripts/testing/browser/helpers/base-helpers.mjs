#!/usr/bin/env node

/**
 * Format-agnostic base helpers for browser regression tests.
 * Extracted from mjcf-helpers.mjs to support URDF, SDF, USD, Xacro, etc.
 *
 * This module provides: session management, state queries, store operations,
 * report output, and assertion re-exports. Format-specific importModel() is
 * provided by each format helper (urdf-helpers, sdf-helpers, usd-helpers, etc.).
 */

import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  ensureSite, launchBrowser, createPage, writeJsonAtomic,
  ensureDir, DEFAULT_SITE_URL, DEFAULT_OPERATION_TIMEOUT_MS,
} from '../../../e2e/helpers/browser-helpers.mjs';

import {
  createTestSuite, assert, assertEqual, assertGreaterThan, assertNonNull, printSummary,
} from '../../../e2e/helpers/assertions.mjs';

export {
  createTestSuite, assert, assertEqual, assertGreaterThan, assertNonNull, printSummary,
  DEFAULT_OPERATION_TIMEOUT_MS,
};

// ── Session ──────────────────────────────────────────────────────────

export async function createSession(options = {}) {
  let siteUrl = options.siteUrl ?? DEFAULT_SITE_URL;
  // Append regressionDebug=1 if not already present
  const url = new URL(siteUrl);
  if (!url.searchParams.has('regressionDebug')) url.searchParams.set('regressionDebug', '1');
  siteUrl = url.toString();

  const site = await ensureSite(siteUrl, {
    siteTimeoutMs: 120_000, timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
    noStart: false, headed: options.headed ?? false, startCommand: null,
  });
  const browser = await launchBrowser({
    headed: options.headed ?? false, siteUrl, timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
  });
  const { page, consoleMessages, pageErrors } = await createPage(browser, siteUrl, DEFAULT_OPERATION_TIMEOUT_MS);
  await page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.setBeforeUnloadPromptEnabled?.(false));
  return {
    page, browser,
    async cleanup() { await browser.close(); await site.stop(); },
    errors() {
      return {
        console: consoleMessages.snapshot().filter((e) => !e.includes('favicon') && !e.includes('DevTools') && e.length > 0),
        page: pageErrors.snapshot(),
      };
    },
  };
}

// ── Wait ─────────────────────────────────────────────────────────────

export async function waitForReady(page, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.getDocumentLoadState?.()?.status === 'ready')) return;
    await delay(200);
  }
  throw new Error('Timed out waiting for robot ready');
}

// ── State queries ────────────────────────────────────────────────────

export async function getTopology(page) {
  return page.evaluate(() => {
    const s = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
    const store = s?.store;
    const links = store?.links ? Object.entries(store.links) : [];
    const joints = store?.joints ? Object.entries(store.joints) : [];
    return {
      name: store?.name, rootLinkId: store?.rootLinkId,
      linkCount: links.length, jointCount: joints.length,
      links: links.map(([id, l]) => ({
        id, name: l?.name, visible: l?.visible,
        visualCount: l?.visualBodies?.length ?? (l?.visual ? 1 : 0),
        collisionCount: l?.collisionBodies?.length ?? (l?.collision ? 1 : 0),
        inertial: l?.inertial ? { mass: l.inertial.mass } : null,
      })),
      joints: joints.map(([id, j]) => ({
        id, name: j?.name, type: j?.type,
        parentLinkId: j?.parentLinkId, childLinkId: j?.childLinkId,
        originXyz: j?.origin?.xyz, originRpy: j?.origin?.rpy,
        axis: j?.axis, limit: j?.limit,
        damping: j?.dynamics?.damping ?? j?.damping,
        friction: j?.dynamics?.friction ?? j?.friction,
        hardware: j?.hardware,
        angle: j?.angle,
      })),
    };
  });
}

export async function getAssemblyState(page) {
  return page.evaluate(() => {
    const s = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
    const a = s?.assembly;
    if (!a) return { exists: false };
    return {
      exists: true, name: a.name,
      componentCount: Object.keys(a.components ?? {}).length,
      bridgeCount: Object.keys(a.bridges ?? {}).length,
      components: Object.entries(a.components ?? {}).map(([id, c]) => ({
        id, name: c.name, linkCount: Object.keys(c.robotData?.links ?? {}).length,
      })),
      bridges: Object.entries(a.bridges ?? {}).map(([id, b]) => ({
        id, name: b.name, jointType: b.joint?.type,
        parentComponentId: b.parentComponentId, childComponentId: b.childComponentId,
      })),
    };
  });
}

export async function getRuntimeTransforms(page) {
  return page.evaluate(() => {
    const rt = window.__URDF_STUDIO_DEBUG__?.getRuntimeSceneTransforms?.();
    return rt ? Object.values(rt.links ?? {}).map((l) => ({ name: l?.name, position: l?.position })) : [];
  });
}

// ── Store operations ─────────────────────────────────────────────────

function storeOp(page, fn) {
  return page.evaluate((src) => {
    const store = window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.();
    if (!store) return { error: 'no store' };
    return new Function('store', `return (${src})(store)`)(store);
  }, fn.toString());
}

export const store = {
  // Robot
  setName:            (page, name) => storeOp(page, (s) => { s.setName(name); return { ok: true }; }),

  // Links
  addChild:           (page, parentId) => storeOp(page, (s) => {
    const r = s.addChild(parentId);
    return r ? { ok: true, linkId: r.linkId, jointId: r.jointId } : { ok: false };
  }),
  updateLink:         (page, id, upd) => storeOp(page, (s) => { s.updateLink(id, upd); return { ok: true }; }),
  deleteLink:         (page, id) => storeOp(page, (s) => { s.deleteLink(id); return { ok: true }; }),
  setLinkVisibility:  (page, id, v) => storeOp(page, (s) => { s.setLinkVisibility(id, v); return { ok: true }; }),
  setAllLinksVisibility: (page, v) => storeOp(page, (s) => { s.setAllLinksVisibility(v); return { ok: true }; }),

  // Joints
  updateJoint:        (page, id, upd) => storeOp(page, (s) => { s.updateJoint(id, upd); return { ok: true }; }),
  deleteJoint:        (page, id) => storeOp(page, (s) => { s.deleteJoint(id); return { ok: true }; }),
  setJointAngle:      (page, name, angle) => storeOp(page, (s) => { s.setJointAngle(name, angle); return { ok: true }; }),

  // Subtree
  deleteSubtree:      (page, id) => storeOp(page, (s) => { s.deleteSubtree(id); return { ok: true }; }),

  // History
  undo:               (page) => storeOp(page, (s) => { if (typeof s.undo === 'function') { s.undo(); return { ok: true }; } return { ok: false }; }),
  redo:               (page) => storeOp(page, (s) => { if (typeof s.redo === 'function') { s.redo(); return { ok: true }; } return { ok: false }; }),

  // Assembly
  initAssembly:       (page, name) => storeOp(page, (s) => { s.initAssembly(name); return { ok: true }; }),
  addComponent:       (page, file) => storeOp(page, (s) => {
    const c = s.addComponent(file, { queueAutoGround: true });
    return c ? { ok: true, id: c.id, name: c.name } : { ok: false };
  }),
  removeComponent:    (page, id) => storeOp(page, (s) => { s.removeComponent(id); return { ok: true }; }),
  updateComponentTransform: (page, id, t) => storeOp(page, (s) => { s.updateComponentTransform(id, t); return { ok: true }; }),
  toggleComponentVisibility: (page, id, v) => storeOp(page, (s) => { s.toggleComponentVisibility(id, v); return { ok: true }; }),
  addBridge:          (page, params) => storeOp(page, (s) => {
    const b = s.addBridge(params);
    return b ? { ok: true, id: b.id, name: b.name } : { ok: false };
  }),
  removeBridge:       (page, id) => storeOp(page, (s) => { s.removeBridge(id); return { ok: true }; }),
  updateBridge:       (page, id, upd) => storeOp(page, (s) => { s.updateBridge(id, upd); return { ok: true }; }),

  // Debug API shortcuts
  setJointAngles: (page, map) => page.evaluate((m) => {
    const api = window.__URDF_STUDIO_DEBUG__;
    return typeof api?.setViewerJointAngles === 'function' ? api.setViewerJointAngles(m) : { ok: false };
  }, map),
  setViewerFlags: (page, flags) => page.evaluate((f) => {
    const api = window.__URDF_STUDIO_DEBUG__;
    return typeof api?.setViewerFlags === 'function' ? api.setViewerFlags(f) : { ok: false };
  }, flags),
  setViewerToolMode: (page, mode) => page.evaluate((m) => {
    const api = window.__URDF_STUDIO_DEBUG__;
    return typeof api?.setViewerToolMode === 'function' ? api.setViewerToolMode(m) : { ok: false };
  }, mode),
};

// ── Output ───────────────────────────────────────────────────────────

export async function writeReport(name, data) {
  const out = path.resolve(`tmp/regression/${name}_results.json`);
  await ensureDir(path.dirname(out));
  await writeJsonAtomic(out, { ...data, generatedAt: new Date().toISOString() });
  return out;
}
