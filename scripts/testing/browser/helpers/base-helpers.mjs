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
        transform: c.transform ?? null,
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

export async function getRegressionSnapshot(page) {
  return page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.() ?? null);
}

export async function getProjectedInteractionTargets(page, filters = {}) {
  const targets = await page.evaluate(() =>
    window.__URDF_STUDIO_DEBUG__?.getProjectedInteractionTargets?.() ?? []);
  return targets
    .filter((target) => !filters.type || target.type === filters.type)
    .filter((target) => !filters.subType || target.subType === filters.subType)
    .filter((target) => !filters.targetKind || target.targetKind === filters.targetKind)
    .filter((target) => !filters.helperKind || target.helperKind === filters.helperKind)
    .filter((target) => filters.id == null || target.id === filters.id)
    .filter((target) => Number.isFinite(target.clientX) && Number.isFinite(target.clientY))
    .sort((left, right) => {
      const areaDelta = Number(right.projectedArea ?? 0) - Number(left.projectedArea ?? 0);
      if (areaDelta !== 0) return areaDelta;
      return Number(left.averageDepth ?? 0) - Number(right.averageDepth ?? 0);
    });
}

export async function getBestProjectedInteractionTarget(page, filters = {}) {
  const targets = await getProjectedInteractionTargets(page, filters);
  return targets[0] ?? null;
}

export async function getCanvasDiagnostics(page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')].map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return {
        width: canvas.width,
        height: canvas.height,
        clientWidth: rect.width,
        clientHeight: rect.height,
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    const primary = canvases.find((canvas) => canvas.visible) ?? canvases[0] ?? null;
    return {
      canvasCount: canvases.length,
      primary,
      usable: Boolean(primary && primary.clientWidth >= 200 && primary.clientHeight >= 200),
      canvases,
    };
  });
}

async function resolveCanvasPoint(page, point) {
  if (point && Number.isFinite(point.clientX) && Number.isFinite(point.clientY)) {
    return { x: point.clientX, y: point.clientY };
  }

  const center = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  if (!center) throw new Error('Could not resolve a usable canvas point.');
  return center;
}

export async function clickCanvasTarget(page, target) {
  const point = await resolveCanvasPoint(page, target);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  return point;
}

export async function dragCanvasByDelta(page, target, delta, options = {}) {
  const point = await resolveCanvasPoint(page, target);
  const steps = options.steps ?? 12;
  const end = {
    x: point.x + Number(delta?.x ?? 0),
    y: point.y + Number(delta?.y ?? 0),
  };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  return { start: point, end, steps };
}

async function startFrameProbe(page, durationMs) {
  return page.evaluate((probeDurationMs) =>
    new Promise((resolve) => {
      const frames = [];
      const start = performance.now();
      let last = start;
      const step = (now) => {
        frames.push(now - last);
        last = now;
        if (now - start >= probeDurationMs) {
          const sorted = [...frames].sort((left, right) => left - right);
          const sum = frames.reduce((total, value) => total + value, 0);
          const percentile = (ratio) =>
            sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
          resolve({
            durationMs: now - start,
            frameCount: frames.length,
            averageFrameMs: frames.length > 0 ? sum / frames.length : 0,
            maxFrameMs: frames.length > 0 ? Math.max(...frames) : 0,
            p95FrameMs: percentile(0.95),
            longFrameCount: frames.filter((value) => value > 50).length,
          });
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }), durationMs);
}

export async function measureCanvasDrag(page, target, delta, options = {}) {
  const durationMs = options.durationMs ?? 900;
  const probePromise = startFrameProbe(page, durationMs);
  await delay(50);
  const drag = await dragCanvasByDelta(page, target, delta, options);
  const metrics = await probePromise;
  return { drag, metrics };
}

export async function measureInteractionFrames(page, action, options = {}) {
  const durationMs = options.durationMs ?? 900;
  const probePromise = startFrameProbe(page, durationMs);
  await delay(50);
  const actionResult = await action();
  const metrics = await probePromise;
  return { actionResult, metrics };
}

export async function getSemanticSnapshot(page) {
  return page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const snapshot = api?.getRegressionSnapshot?.() ?? null;
    const assemblyState = api?.__store__?.getState?.()?.assemblyState ?? null;
    const assetsState = api?.getAssetDebugState?.() ?? null;
    const usdScene = api?.getSelectedUsdSceneSummary?.() ?? null;

    const links = snapshot?.store?.links ?? [];
    const joints = snapshot?.store?.joints ?? [];
    const geometrySummary = (geometry) => ({
      name: geometry?.name ?? null,
      type: geometry?.type ?? null,
      meshPath: geometry?.meshPath ?? null,
      visible: geometry?.visible !== false,
      color: geometry?.color ?? null,
      materialSource: geometry?.materialSource ?? null,
      authoredMaterialCount: Array.isArray(geometry?.authoredMaterials)
        ? geometry.authoredMaterials.length
        : 0,
      meshMaterialGroupCount: Array.isArray(geometry?.meshMaterialGroups)
        ? geometry.meshMaterialGroups.length
        : 0,
      origin: geometry?.origin ?? null,
    });

    return {
      selectedFile: snapshot?.selectedFile ?? null,
      robot: snapshot?.store
        ? {
            name: snapshot.store.name,
            rootLinkId: snapshot.store.rootLinkId,
            linkCount: snapshot.store.linkCount,
            jointCount: snapshot.store.jointCount,
            totalMass: snapshot.store.totalMass,
          }
        : null,
      links: links
        .map((link) => ({
          id: link.id,
          name: link.name,
          visible: link.visible !== false,
          visual: geometrySummary(link.visual),
          visualBodyCount: Array.isArray(link.visualBodies) ? link.visualBodies.length : 0,
          collision: geometrySummary(link.collision),
          collisionBodyCount: Array.isArray(link.collisionBodies) ? link.collisionBodies.length : 0,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      joints: joints
        .map((joint) => ({
          id: joint.id,
          name: joint.name,
          type: joint.type,
          parentLinkId: joint.parentLinkId,
          childLinkId: joint.childLinkId,
          axis: joint.axis,
          origin: joint.origin,
          limit: joint.limit,
          dynamics: joint.dynamics,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      runtime: snapshot?.runtime
        ? {
            linkCount: snapshot.runtime.linkCount,
            jointCount: snapshot.runtime.jointCount,
            visualMeshCount: snapshot.runtime.visualMeshCount,
            collisionMeshCount: snapshot.runtime.collisionMeshCount,
            texturedVisualMeshCount: snapshot.runtime.texturedVisualMeshCount,
            visiblePlaceholderMeshCount: snapshot.runtime.visiblePlaceholderMeshCount,
            hiddenPlaceholderMeshCount: snapshot.runtime.hiddenPlaceholderMeshCount,
          }
        : null,
      assembly: assemblyState
        ? {
            name: assemblyState.name,
            componentCount: Object.keys(assemblyState.components ?? {}).length,
            bridgeCount: Object.keys(assemblyState.bridges ?? {}).length,
            components: Object.entries(assemblyState.components ?? {})
              .map(([id, component]) => ({
                id,
                name: component.name,
                sourceFile: component.sourceFile,
                rootLinkId: component.robot?.rootLinkId ?? null,
                linkCount: Object.keys(component.robot?.links ?? {}).length,
                transform: component.transform ?? null,
              }))
              .sort((left, right) => left.id.localeCompare(right.id)),
            bridges: Object.entries(assemblyState.bridges ?? {})
              .map(([id, bridge]) => ({
                id,
                name: bridge.name,
                jointType: bridge.joint?.type ?? null,
                parentComponentId: bridge.parentComponentId,
                childComponentId: bridge.childComponentId,
              }))
              .sort((left, right) => left.id.localeCompare(right.id)),
          }
        : null,
      assets: assetsState,
      usdScene,
      interaction: snapshot?.interaction ?? null,
      viewer: snapshot?.viewer ?? null,
    };
  });
}

export async function getMaterialSnapshot(page) {
  return page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const snapshot = api?.getRegressionSnapshot?.() ?? null;
    const usdMaterials = api?.getSelectedUsdVisualMaterialSummary?.() ?? null;
    const links = snapshot?.store?.links ?? [];
    const storeMaterials = [];

    const collectGeometry = (link, role, geometry, bodyIndex = 0) => {
      const authoredMaterials = Array.isArray(geometry?.authoredMaterials)
        ? geometry.authoredMaterials
        : [];
      if (geometry?.color || geometry?.materialSource || authoredMaterials.length > 0) {
        storeMaterials.push({
          linkId: link.id,
          linkName: link.name,
          role,
          bodyIndex,
          color: geometry?.color ?? null,
          materialSource: geometry?.materialSource ?? null,
          meshPath: geometry?.meshPath ?? null,
          materialCount: authoredMaterials.length,
          textureCount: authoredMaterials.filter((material) => Boolean(material?.texture)).length,
          materialNames: authoredMaterials
            .map((material) => material?.name)
            .filter(Boolean)
            .sort(),
          meshMaterialGroupCount: Array.isArray(geometry?.meshMaterialGroups)
            ? geometry.meshMaterialGroups.length
            : 0,
        });
      }
    };

    links.forEach((link) => {
      collectGeometry(link, 'visual', link.visual, 0);
      (link.visualBodies ?? []).forEach((entry, index) =>
        collectGeometry(link, 'visual', entry.geometry, index + 1));
      collectGeometry(link, 'collision', link.collision, 0);
      (link.collisionBodies ?? []).forEach((entry, index) =>
        collectGeometry(link, 'collision', entry.geometry, index + 1));
    });

    const runtimeVisualMeshes = snapshot?.runtime?.visualMeshes ?? [];
    const runtimeMaterialCount = runtimeVisualMeshes.reduce(
      (sum, mesh) => sum + (Array.isArray(mesh.materials) ? mesh.materials.length : 0),
      0,
    );
    const runtimeTextureCount = runtimeVisualMeshes.reduce(
      (sum, mesh) =>
        sum + (Array.isArray(mesh.materials) ? mesh.materials.filter((m) => m.hasTexture).length : 0),
      0,
    );

    return {
      selectedFile: snapshot?.selectedFile ?? null,
      storeMaterialCount: storeMaterials.length,
      storeTextureCount: storeMaterials.reduce((sum, material) => sum + material.textureCount, 0),
      storeMaterials: storeMaterials.sort((left, right) =>
        `${left.linkId}:${left.role}:${left.bodyIndex}`.localeCompare(
          `${right.linkId}:${right.role}:${right.bodyIndex}`,
        )),
      runtimeVisualMeshCount: runtimeVisualMeshes.length,
      runtimeMaterialCount,
      runtimeTextureCount,
      runtimeVisualMeshes: runtimeVisualMeshes
        .map((mesh) => ({
          link: mesh.link,
          name: mesh.name,
          visible: mesh.visible,
          effectiveVisible: mesh.effectiveVisible,
          isPlaceholder: mesh.isPlaceholder,
          missingMeshPath: mesh.missingMeshPath,
          materialCount: Array.isArray(mesh.materials) ? mesh.materials.length : 0,
          textureCount: Array.isArray(mesh.materials)
            ? mesh.materials.filter((material) => material.hasTexture).length
            : 0,
          colors: Array.isArray(mesh.materials)
            ? mesh.materials.map((material) => material.color).filter(Boolean).sort()
            : [],
        }))
        .sort((left, right) => `${left.link}:${left.name}`.localeCompare(`${right.link}:${right.name}`)),
      usdMaterials,
    };
  });
}

export async function openSourceEditor(page) {
  const opened = await page.evaluate(() => {
    const candidates = [
      document.querySelector('[data-testid="source-code-open"]'),
      ...document.querySelectorAll('button'),
    ].filter(Boolean);
    const button = candidates.find((candidate) => {
      const text = `${candidate.textContent ?? ''} ${candidate.getAttribute?.('title') ?? ''} ${
        candidate.getAttribute?.('aria-label') ?? ''
      }`;
      return /source|code|xml|源码|源代码/i.test(text);
    });
    button?.click();
    return Boolean(button);
  });
  if (!opened) throw new Error('Could not find source editor open button.');

  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('.monaco-editor .view-line').length > 0, {
    timeout: 30_000,
  });
}

export async function getSourceEditorText(page) {
  return page.evaluate(() => {
    const monacoModels = globalThis.monaco?.editor?.getModels?.();
    const activeModel = Array.isArray(monacoModels) ? monacoModels[monacoModels.length - 1] : null;
    const monacoText = activeModel?.getValue?.();
    if (typeof monacoText === 'string' && monacoText.length > 0) return monacoText;
    return document.querySelector('.monaco-editor')?.textContent ?? '';
  });
}

export async function replaceSourceEditorText(page, nextText) {
  const changedViaMonaco = await page.evaluate((value) => {
    const monacoModels = globalThis.monaco?.editor?.getModels?.();
    const activeModel = Array.isArray(monacoModels) ? monacoModels[monacoModels.length - 1] : null;
    if (!activeModel || typeof activeModel.setValue !== 'function') return false;
    activeModel.setValue(value);
    return true;
  }, nextText);
  if (changedViaMonaco) {
    await delay(100);
    return;
  }

  await page.click('.monaco-editor');
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.press('A');
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(nextText, { delay: 0 });
  await page.waitForFunction(
    (expectedLength) => {
      const monacoModels = globalThis.monaco?.editor?.getModels?.();
      const activeModel = Array.isArray(monacoModels) ? monacoModels[monacoModels.length - 1] : null;
      const value = activeModel?.getValue?.();
      return typeof value === 'string' && value.length === expectedLength;
    },
    { timeout: 30_000 },
    nextText.length,
  ).catch(() => {});
}

export async function saveSourceEditor(page) {
  await page.waitForFunction(
    () => {
      const button =
        document.querySelector('[data-testid="source-code-save"]') ??
        [...document.querySelectorAll('button')].find((candidate) =>
          /save|保存/i.test(`${candidate.textContent ?? ''} ${candidate.title ?? ''} ${candidate.getAttribute('aria-label') ?? ''}`));
      return Boolean(button && !button.disabled);
    },
    { timeout: 30_000 },
  );
  const clicked = await page.evaluate(() => {
    const button =
      document.querySelector('[data-testid="source-code-save"]') ??
      [...document.querySelectorAll('button')].find((candidate) =>
        /save|保存/i.test(`${candidate.textContent ?? ''} ${candidate.title ?? ''} ${candidate.getAttribute('aria-label') ?? ''}`));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  });
  if (!clicked) throw new Error('Could not click source editor save button.');
}

export async function waitForRobotPredicate(page, predicateSource, timeoutMs = 60_000) {
  await page.waitForFunction(
    (source) => {
      const snapshot = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
      if (!snapshot?.store) return false;
      return new Function('snapshot', `return (${source})(snapshot);`)(snapshot);
    },
    { timeout: timeoutMs },
    predicateSource,
  );
}

export function assertNoBrowserErrors(suite, session, label = 'no browser errors') {
  const errs = session.errors();
  assert(suite, errs.page.length === 0, `${label}: no page errors`);
  assert(
    suite,
    errs.console.filter((entry) => /\[(error|assert)\]/i.test(entry)).length === 0,
    `${label}: no console errors`,
  );
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
