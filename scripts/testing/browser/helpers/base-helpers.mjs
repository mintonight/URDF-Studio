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
  isTransientPageContextError,
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
  // Allow `--headed` from the unified runner (run-all.mjs) to flow through env.
  const headed = options.headed ?? (process.env.URDF_E2E_HEADED === '1');
  let siteUrl = options.siteUrl ?? DEFAULT_SITE_URL;
  // Append regressionDebug=1 if not already present
  const url = new URL(siteUrl);
  if (!url.searchParams.has('regressionDebug')) url.searchParams.set('regressionDebug', '1');
  siteUrl = url.toString();

  const site = await ensureSite(siteUrl, {
    siteTimeoutMs: 120_000, timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
    noStart: false, headed, startCommand: null,
  });
  const browser = await launchBrowser({
    headed, siteUrl, timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
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

export async function waitForReady(page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const probe = await page.evaluate(() => {
        const api = window.__URDF_STUDIO_DEBUG__;
        const snap = api?.getRegressionSnapshot?.();
        const st = api?.getDocumentLoadState?.() ?? null;
        return {
          status: st?.status ?? null,
          error: st?.error ?? null,
          fileName: st?.fileName ?? null,
          hasRuntime: Boolean(snap?.runtime),
          linkCount: snap?.store?.links ? Object.keys(snap.store.links).length : 0,
        };
      });
      last = probe;
      if (probe.status === 'error') {
        throw new Error(`Document load failed: ${probe.error ?? 'unknown'} (file: ${probe.fileName ?? '?'})`);
      }
      // USD reaches 'ready'/'hydrating'; the standard editor keeps status at
      // 'loading' even after the runtime robot is fully built, so a built runtime
      // with links is the authoritative "loaded" signal (matches the menagerie
      // regression's snapshotWithDebug check).
      if (probe.status === 'ready' || probe.status === 'hydrating') return;
      if (probe.hasRuntime && probe.linkCount > 0) return;
      if (probe.status === 'loading' && probe.fileName && probe.linkCount > 1) return;
    } catch (error) {
      // An import can trigger a one-off SPA navigation that destroys the
      // execution context mid-poll. Treat that as "not ready yet" and retry;
      // rethrow anything that is not a known transient navigation error.
      if (!isTransientPageContextError(error)) throw error;
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for robot ready (last: ${JSON.stringify(last)})`);
}

// ── State queries ────────────────────────────────────────────────────

export async function getTopology(page) {
  return page.evaluate(() => {
    const vector = (value, keys) => {
      if (Array.isArray(value)) return value;
      return keys.map((key) => Number(value?.[key] ?? 0));
    };
    const s = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
    const store = s?.store;
    const links = store?.links ? Object.entries(store.links) : [];
    const joints = store?.joints ? Object.entries(store.joints) : [];
    return {
      name: store?.name, rootLinkId: store?.rootLinkId,
      linkCount: links.length, jointCount: joints.length,
      links: links.map(([id, l]) => ({
        id: l?.id ?? id, name: l?.name, visible: l?.visible,
        visualCount: (l?.visualBodies?.length ?? 0) > 0 ? l.visualBodies.length : (l?.visual ? 1 : 0),
        collisionCount: (l?.collisionBodies?.length ?? 0) > 0 ? l.collisionBodies.length : (l?.collision ? 1 : 0),
        inertial: l?.inertial ? { mass: l.inertial.mass } : (Number.isFinite(l?.mass) ? { mass: l.mass } : null),
      })),
      joints: joints.map(([id, j]) => ({
        id: j?.id ?? id, name: j?.name, type: j?.type,
        parentLinkId: j?.parentLinkId, childLinkId: j?.childLinkId,
        originXyz: vector(j?.origin?.xyz, ['x', 'y', 'z']),
        originRpy: vector(j?.origin?.rpy, ['r', 'p', 'y']),
        axis: j?.axis ? vector(j.axis, ['x', 'y', 'z']) : null,
        limit: j?.limit,
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
    const a = window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.()?.assemblyState;
    if (!a) return { exists: false };
    return {
      exists: true, name: a.name,
      componentCount: Object.keys(a.components ?? {}).length,
      bridgeCount: Object.keys(a.bridges ?? {}).length,
      components: Object.entries(a.components ?? {}).map(([id, c]) => ({
        id,
        name: c.name,
        sourceFile: c.sourceFile,
        rootLinkId: c.robot?.rootLinkId ?? null,
        linkCount: Object.keys(c.robot?.links ?? {}).length,
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

function storeOp(page, fn, ...args) {
  return page.evaluate((src, callArgs) => {
    const store = window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.();
    if (!store) return { error: 'no store' };
    return new Function('store', 'args', `return (${src})(store, ...args)`)(store, callArgs);
  }, fn.toString(), args);
}

export async function findAvailableFile(page, fileName) {
  return page.evaluate((expectedName) => {
    const normalize = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    const basename = (value) => normalize(value).split('/').filter(Boolean).pop() ?? '';
    const matches = (candidateName, expected) => {
      const candidate = normalize(candidateName);
      const target = normalize(expected);
      return (
        candidate === target ||
        candidate.endsWith(`/${target}`) ||
        basename(candidate) === basename(target)
      );
    };
    const files =
      window.__URDF_STUDIO_DEBUG__?.__assetsStore__?.getState?.()?.availableFiles ??
      window.__URDF_STUDIO_DEBUG__?.getAvailableFiles?.() ??
      [];
    return (
      files.find((file) => matches(file?.name, expectedName)) ??
      null
    );
  }, fileName);
}

export const store = {
  // Robot
  setName:            (page, name) => storeOp(page, (s, nextName) => { s.setName(nextName); return { ok: true }; }, name),

  // Links
  addChild:           (page, parentId) => storeOp(page, (s, nextParentId) => {
    const r = s.addChild(nextParentId);
    return r ? { ok: true, linkId: r.linkId, jointId: r.jointId } : { ok: false };
  }, parentId),
  updateLink:         (page, id, upd) => storeOp(page, (s, nextId, nextUpdate) => { s.updateLink(nextId, nextUpdate); return { ok: true }; }, id, upd),
  deleteLink:         (page, id) => storeOp(page, (s, nextId) => { s.deleteLink(nextId); return { ok: true }; }, id),
  setLinkVisibility:  (page, id, v) => storeOp(page, (s, nextId, visible) => { s.setLinkVisibility(nextId, visible); return { ok: true }; }, id, v),
  setAllLinksVisibility: (page, v) => storeOp(page, (s, visible) => { s.setAllLinksVisibility(visible); return { ok: true }; }, v),

  // Joints
  updateJoint:        (page, id, upd) => storeOp(page, (s, nextId, nextUpdate) => { s.updateJoint(nextId, nextUpdate); return { ok: true }; }, id, upd),
  deleteJoint:        (page, id) => storeOp(page, (s, nextId) => { s.deleteJoint(nextId); return { ok: true }; }, id),
  setJointAngle:      (page, name, angle) => storeOp(page, (s, nextName, nextAngle) => { s.setJointAngle(nextName, nextAngle); return { ok: true }; }, name, angle),

  // Subtree
  deleteSubtree:      (page, id) => storeOp(page, (s, nextId) => { s.deleteSubtree(nextId); return { ok: true }; }, id),

  // History
  undo:               (page) => storeOp(page, (s) => { if (typeof s.undo === 'function') { s.undo(); return { ok: true }; } return { ok: false }; }),
  redo:               (page) => storeOp(page, (s) => { if (typeof s.redo === 'function') { s.redo(); return { ok: true }; } return { ok: false }; }),

  // Assembly
  initAssembly:       (page, name) => storeOp(page, (s, nextName) => { s.initAssembly(nextName); return { ok: true }; }, name),
  addComponent:       (page, file) => storeOp(page, (s, fileLike) => {
    const normalize = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    const basename = (value) => normalize(value).split('/').filter(Boolean).pop() ?? '';
    const matches = (candidateName, expectedName) => {
      const candidate = normalize(candidateName);
      const expected = normalize(expectedName);
      return candidate === expected || candidate.endsWith(`/${expected}`) || basename(candidate) === basename(expected);
    };
    const fileName = typeof fileLike === 'string' ? fileLike : fileLike?.name;
    const availableFiles = window.__URDF_STUDIO_DEBUG__?.__assetsStore__?.getState?.()?.availableFiles ?? [];
    const file = availableFiles.find((candidate) => matches(candidate?.name, fileName)) ?? fileLike;
    if (!file?.content) return { ok: false, error: `file not found: ${fileName ?? '<null>'}` };
    const c = s.addComponent(file, { queueAutoGround: true });
    return c ? { ok: true, id: c.id, name: c.name } : { ok: false };
  }, file),
  removeComponent:    (page, id) => storeOp(page, (s, nextId) => { s.removeComponent(nextId); return { ok: true }; }, id),
  updateComponentTransform: (page, id, t) => storeOp(page, (s, nextId, transform) => { s.updateComponentTransform(nextId, transform); return { ok: true }; }, id, t),
  toggleComponentVisibility: (page, id, v) => storeOp(page, (s, nextId, visible) => { s.toggleComponentVisibility(nextId, visible); return { ok: true }; }, id, v),
  addBridge:          (page, params) => storeOp(page, (s, nextParams) => {
    const b = s.addBridge(nextParams);
    return b ? { ok: true, id: b.id, name: b.name } : { ok: false };
  }, params),
  removeBridge:       (page, id) => storeOp(page, (s, nextId) => { s.removeBridge(nextId); return { ok: true }; }, id),
  updateBridge:       (page, id, upd) => storeOp(page, (s, nextId, nextUpdate) => { s.updateBridge(nextId, nextUpdate); return { ok: true }; }, id, upd),

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
