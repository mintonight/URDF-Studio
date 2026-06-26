#!/usr/bin/env node

/**
 * Transformer controller browser regression.
 *
 * Covers: CAD-style rotate arcs with direct ring dragging, screen E ring,
 * translate plane/center handles, universal-mode simplification, and stable
 * world sizing across camera zoom.
 */

import { setTimeout as delay } from 'node:timers/promises';

import {
  createSession, createTestSuite, assert, assertGreaterThan,
  importModel, waitForReady, getProjectedInteractionTargets,
  store, writeReport, printSummary, assertNoBrowserErrors,
} from './helpers/urdf-helpers.mjs';

const MODEL = { dir: 'go1_description', file: 'go1.urdf' };
const ROTATION_CHANGE_EPSILON = 1e-4;
const TRANSLATION_CHANGE_EPSILON = 1e-4;
const SCREEN_RADIUS_CHANGE_RELATIVE_MIN = 0.12;
const WORLD_RADIUS_STABLE_RELATIVE_EPSILON = 0.02;
const ZOOM_WHEEL_DELTA_Y = -700;
const ZOOM_WHEEL_STEPS = 3;

function relativeDelta(left, right) {
  return Math.abs(Number(left) - Number(right)) / Math.max(1e-9, Math.abs(Number(left)));
}

function numericOrigin(origin) {
  return {
    xyz: {
      x: Number(origin?.xyz?.x ?? 0),
      y: Number(origin?.xyz?.y ?? 0),
      z: Number(origin?.xyz?.z ?? 0),
    },
    rpy: {
      r: Number(origin?.rpy?.r ?? 0),
      p: Number(origin?.rpy?.p ?? 0),
      y: Number(origin?.rpy?.y ?? 0),
    },
  };
}

function rotationDistance(left, right) {
  const a = numericOrigin(left).rpy;
  const b = numericOrigin(right).rpy;
  return Math.hypot(a.r - b.r, a.p - b.p, a.y - b.y);
}

function translationDistance(left, right) {
  const a = numericOrigin(left).xyz;
  const b = numericOrigin(right).xyz;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

async function getCollisionOrigin(page, linkId, objectIndex = 0) {
  const origin = await page.evaluate(({ linkId, objectIndex }) => {
    const resolveLink = (links) => {
      if (!links || typeof links !== 'object') return null;
      if (links[linkId]) return links[linkId];
      return Object.values(links).find((link) => link?.id === linkId || link?.name === linkId) ?? null;
    };
    const resolveOrigin = (link) => {
      if (!link) return null;
      const collisionBodies = Array.isArray(link?.collisionBodies) ? link.collisionBodies : [];
      const collision = objectIndex === 0
        ? link?.collision
        : (collisionBodies[objectIndex - 1] ?? collisionBodies[objectIndex]);
      return (collision ?? link?.collision ?? collisionBodies[0] ?? null)?.origin ?? null;
    };
    const state = window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.() ?? null;
    for (const component of Object.values(state?.assemblyState?.components ?? {})) {
      const componentOrigin = resolveOrigin(resolveLink(component?.robot?.links));
      if (componentOrigin) return componentOrigin;
    }

    return resolveOrigin(resolveLink(state?.links));
  }, { linkId, objectIndex });

  return numericOrigin(origin);
}

async function getGizmoSummary(page) {
  return page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.getTransformGizmoSummary?.() ?? []);
}

async function waitForRuntimeCollisionReady(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const snapshot = api?.getRegressionSnapshot?.() ?? null;
      const runtime = snapshot?.runtime ?? null;
      const projectedCollisionTargets = (api?.getProjectedInteractionTargets?.() ?? [])
        .filter((target) =>
          target?.type === 'link' &&
          target?.subType === 'collision' &&
          target?.targetKind === 'geometry');

      return {
        runtimeLinkCount: Number(runtime?.linkCount ?? 0),
        runtimeCollisionGroupCount: Number(runtime?.collisionGroupCount ?? 0),
        projectedCollisionTargetCount: projectedCollisionTargets.length,
      };
    });

    if (
      last.runtimeLinkCount > 5 &&
      last.runtimeCollisionGroupCount > 0 &&
      last.projectedCollisionTargetCount > 0
    ) {
      return last;
    }

    await delay(200);
  }

  throw new Error(`Timed out waiting for runtime collision scene; last state: ${JSON.stringify(last)}`);
}

async function getBestEditableCollisionTarget(page) {
  const targets = await getProjectedInteractionTargets(page, {
    type: 'link',
    subType: 'collision',
    targetKind: 'geometry',
  });

  const resolved = await page.evaluate((nextTargets) => {
    const links = window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.()?.links ?? {};
    const resolveLinkKey = (identity) => {
      if (!identity) return null;
      if (Object.prototype.hasOwnProperty.call(links, identity)) return identity;
      const match = Object.entries(links)
        .find(([, link]) => link?.id === identity || link?.name === identity);
      return match?.[0] ?? null;
    };

    for (const target of nextTargets) {
      const resolvedLinkId =
        resolveLinkKey(target?.linkId) ??
        resolveLinkKey(target?.id) ??
        resolveLinkKey(target?.sourceName);
      if (resolvedLinkId) {
        return {
          ...target,
          id: resolvedLinkId,
          objectIndex: target?.objectIndex ?? 0,
        };
      }
    }

    return null;
  }, targets);

  return resolved ?? null;
}

async function selectCollisionTarget(page, target) {
  return page.evaluate((nextTarget) => {
    window.__URDF_STUDIO_DEBUG__?.__assemblySelectionStore__?.getState?.()?.clearSelection?.();
    const selectionStore = window.__URDF_STUDIO_DEBUG__?.__selectionStore__?.getState?.();
    if (!selectionStore?.setSelection) return { ok: false };
    selectionStore.setInteractionGuard?.(null);
    selectionStore.setSelection({
      type: 'link',
      id: nextTarget.id,
      subType: 'collision',
      objectIndex: nextTarget.objectIndex ?? 0,
    });
    return {
      ok: true,
      selection: window.__URDF_STUDIO_DEBUG__?.__selectionStore__?.getState?.()?.selection ?? null,
    };
  }, target);
}

async function setTransformMode(page, mode) {
  const result = await store.setViewerToolMode(page, mode);
  if (!result?.ok) {
    throw new Error(`Could not switch transform mode to ${mode}: ${JSON.stringify(result)}`);
  }
  await delay(350);
}

async function waitForGizmoEntry(page, predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];

  while (Date.now() < deadline) {
    last = await getGizmoSummary(page);
    const match = last.find(predicate);
    if (match) return match;
    await delay(100);
  }

  throw new Error(`Timed out waiting for ${label}; last gizmo summary: ${JSON.stringify(last)}`);
}

async function dragFromPoint(page, point, delta, steps = 14) {
  await page.mouse.move(point.clientX, point.clientY);
  await delay(60);
  await page.mouse.down();
  await page.mouse.move(point.clientX + delta.x, point.clientY + delta.y, { steps });
  await delay(140);
  await page.mouse.up();
  await delay(450);
}

async function moveToPointAndGetGizmoSummary(page, point) {
  await page.mouse.move(point.clientX, point.clientY);
  await delay(180);
  return getGizmoSummary(page);
}

async function zoomCanvas(page) {
  const point = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')]
      .map((entry) => {
        const rect = entry.getBoundingClientRect();
        return {
          height: rect.height,
          left: rect.left,
          top: rect.top,
          visible: rect.width > 0 && rect.height > 0,
          width: rect.width,
        };
      })
      .find((entry) => entry.visible);
    if (!canvas) return null;
    return {
      clientX: canvas.left + canvas.width * 0.25,
      clientY: canvas.top + canvas.height * 0.25,
    };
  });
  if (!point) throw new Error('Could not locate a visible canvas for zoom regression.');

  await page.mouse.move(point.clientX, point.clientY);
  for (let index = 0; index < ZOOM_WHEEL_STEPS; index += 1) {
    await page.mouse.wheel({ deltaY: ZOOM_WHEEL_DELTA_Y });
    await delay(120);
  }
  await delay(450);
}

function hasKind(summary, kind) {
  return summary.some((entry) => entry.kind === kind);
}

async function main() {
  const suite = createTestSuite('Transformer Controller Gizmo');
  const session = await createSession();
  const { page } = session;
  const report = {};

  try {
    await importModel(page, MODEL.dir, MODEL.file);
    await waitForReady(page);

    await store.setViewerFlags(page, {
      showCollision: true,
      showCollisionAlwaysOnTop: true,
      highlightMode: 'collision',
    });
    await store.setViewerToolMode(page, 'select');
    report.runtime = await waitForRuntimeCollisionReady(page);

    const target = await getBestEditableCollisionTarget(page);
    assert(suite, Boolean(target), 'projected collision target is available');

    const selectionResult = await selectCollisionTarget(page, target);
    assert(suite, selectionResult.ok, 'collision target selection is applied through debug store');
    await delay(250);

    await setTransformMode(page, 'universal');
    const universalSummary = await getGizmoSummary(page);
    assert(suite, hasKind(universalSummary, 'translate-center'), 'universal mode shows translate center');
    assert(suite, hasKind(universalSummary, 'rotate-e-ring'), 'universal mode shows E outer ring');
    assert(suite, !hasKind(universalSummary, 'rotate-trackball'), 'universal mode hides trackball');
    assert(suite, !hasKind(universalSummary, 'rotate-front-arc'), 'universal mode hides axis rotate arcs');
    assert(suite, !universalSummary.some((entry) => entry.kind?.includes('knob')), 'rotate knobs are removed');

    const center = await waitForGizmoEntry(
      page,
      (entry) => entry.kind === 'translate-center',
      'universal translate center',
    );
    const beforeCenterOrigin = await getCollisionOrigin(page, target.id, target.objectIndex ?? 0);
    await dragFromPoint(page, center, { x: 72, y: -44 });
    const afterCenterOrigin = await getCollisionOrigin(page, target.id, target.objectIndex ?? 0);
    assert(
      suite,
      translationDistance(beforeCenterOrigin, afterCenterOrigin) > TRANSLATION_CHANGE_EPSILON,
      'dragging the center translate point changes collision translation',
    );

    const eRing = await waitForGizmoEntry(
      page,
      (entry) => entry.kind === 'rotate-e-ring',
      'universal E ring',
    );
    const beforeERingOrigin = await getCollisionOrigin(page, target.id, target.objectIndex ?? 0);
    await dragFromPoint(page, eRing, { x: 95, y: 36 });
    const afterERingOrigin = await getCollisionOrigin(page, target.id, target.objectIndex ?? 0);
    assert(
      suite,
      rotationDistance(beforeERingOrigin, afterERingOrigin) > ROTATION_CHANGE_EPSILON,
      'dragging the E outer ring changes collision rotation',
    );

    await setTransformMode(page, 'translate');
    const translateSummary = await getGizmoSummary(page);
    for (const kind of ['translate-plane-xy', 'translate-plane-yz', 'translate-plane-xz']) {
      assert(suite, hasKind(translateSummary, kind), `${kind} is present in translate mode`);
    }
    assert(suite, hasKind(translateSummary, 'translate-center'), 'translate mode shows center point');
    assertGreaterThan(
      suite,
      translateSummary.filter((entry) => entry.kind === 'translate-arrow').length,
      0,
      'translate arrows remain present',
    );

    const xyPlane = await waitForGizmoEntry(
      page,
      (entry) => entry.kind === 'translate-plane-xy',
      'XY translate plane',
    );
    const beforePlaneOrigin = await getCollisionOrigin(page, target.id, target.objectIndex ?? 0);
    await dragFromPoint(page, xyPlane, { x: 80, y: -20 });
    const afterPlaneOrigin = await getCollisionOrigin(page, target.id, target.objectIndex ?? 0);
    assert(
      suite,
      translationDistance(beforePlaneOrigin, afterPlaneOrigin) > TRANSLATION_CHANGE_EPSILON,
      'dragging a translate plane square changes collision translation',
    );

    await setTransformMode(page, 'rotate');
    const rotateSummary = await getGizmoSummary(page);
    assert(
      suite,
      rotateSummary.filter((entry) => entry.kind === 'rotate-front-arc').length === 3,
      'three bright front arcs are present in rotate mode',
    );
    assert(
      suite,
      rotateSummary.filter((entry) => entry.kind === 'rotate-guide-ring').length === 3,
      'three faded full guide rings are present in rotate mode',
    );
    assert(suite, hasKind(rotateSummary, 'rotate-e-ring'), 'rotate mode shows E outer ring');
    assert(suite, hasKind(rotateSummary, 'rotate-trackball'), 'rotate mode shows trackball');
    assert(suite, !rotateSummary.some((entry) => entry.kind?.includes('knob')), 'rotate mode has no knobs');

    const frontArc = await waitForGizmoEntry(
      page,
      (entry) =>
        entry.kind === 'rotate-front-arc' &&
        Number.isFinite(entry.clientX) &&
        Number.isFinite(entry.clientY),
      'front rotate arc',
    );
    const hoverSummary = await moveToPointAndGetGizmoSummary(page, frontArc);
    assert(
      suite,
      hoverSummary.some(
        (entry) =>
          entry.kind === 'rotate-front-arc' &&
          entry.axis === frontArc.axis &&
          entry.active === true,
      ),
      'hovering the front rotate arc activates the arc visual',
    );

    const beforeArcOrigin = await getCollisionOrigin(page, target.id, target.objectIndex ?? 0);
    await dragFromPoint(page, frontArc, { x: 90, y: -54 });
    const afterArcOrigin = await getCollisionOrigin(page, target.id, target.objectIndex ?? 0);
    assert(
      suite,
      rotationDistance(beforeArcOrigin, afterArcOrigin) > ROTATION_CHANGE_EPSILON,
      'dragging a bright rotate arc directly changes collision rotation',
    );

    await zoomCanvas(page);
    const zoomedFrontArc = await waitForGizmoEntry(
      page,
      (entry) => entry.kind === 'rotate-front-arc' && entry.axis === frontArc.axis,
      'zoomed front rotate arc',
    );
    const worldRadiusDelta = relativeDelta(frontArc.worldRadius, zoomedFrontArc.worldRadius);
    const screenRadiusDelta = relativeDelta(frontArc.screenRadius, zoomedFrontArc.screenRadius);
    assert(
      suite,
      worldRadiusDelta <= WORLD_RADIUS_STABLE_RELATIVE_EPSILON,
      `front arc world radius stays fixed across zoom (${(worldRadiusDelta * 100).toFixed(2)}%)`,
    );
    assert(
      suite,
      screenRadiusDelta >= SCREEN_RADIUS_CHANGE_RELATIVE_MIN,
      `front arc screen radius changes across zoom (${(screenRadiusDelta * 100).toFixed(2)}%)`,
    );

    assertNoBrowserErrors(suite, session, 'transformer controller gizmo flow');
    report.gizmo = {
      frontArcAxis: frontArc.axis,
      screenRadiusDelta,
      universalKinds: universalSummary.map((entry) => entry.kind),
      worldRadiusDelta,
    };
  } finally {
    await session.cleanup();
  }

  await writeReport('transformer_controller_gizmo', report);
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
