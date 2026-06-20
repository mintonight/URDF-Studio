#!/usr/bin/env node

/**
 * Joint-origin Pick browser regression test (Fusion 360 style "Joint").
 *
 * Drives the real interactive flow that the debug-API assembly tests skip:
 * open the bridge modal, set the relation by clicking links in the canvas,
 * activate "Pick parent"/"Pick child", click the components in the 3D view, and
 * confirm. Verifies the raycast -> snap resolve -> commit -> auto-align pipeline
 * end to end in a real browser.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert, assertEqual, assertGreaterThan,
  waitForReady, getAssemblyState, findAvailableFile, getProjectedInteractionTargets,
  clickCanvasTarget, store, writeReport, printSummary,
} from './helpers/base-helpers.mjs';

const PICK_PARENT = ['Pick parent', '拾取父侧'];
const PICK_CHILD = ['Pick child', '拾取子侧'];
const PARENT_DONE = ['Parent ✓', '父侧 ✓'];
const CHILD_DONE = ['Child ✓', '子侧 ✓'];
const CONFIRM = ['Confirm', '确认'];
const CREATE_BRIDGE = ['Create Bridge', '创建拼接'];
const CYLINDER_FILE = 'joint_pick_cylinder.urdf';
const BOX_FILE = 'joint_pick_box.urdf';
const MODIFIER_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

const CYLINDER_URDF = `<?xml version="1.0"?>
<robot name="joint_pick_cylinder">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <cylinder radius="0.6" length="0.4"/>
      </geometry>
      <material name="cyan"><color rgba="0.1 0.7 0.9 1"/></material>
    </visual>
  </link>
</robot>`;

const BOX_URDF = `<?xml version="1.0"?>
<robot name="joint_pick_box">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.6 0.6 0.6"/>
      </geometry>
      <material name="green"><color rgba="0.1 0.8 0.3 1"/></material>
    </visual>
  </link>
</robot>`;

async function selectionOf(page) {
  return page.evaluate(() => {
    const snap = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
    return snap?.interaction?.selection ?? null;
  });
}

async function seedJointPickFixtures(page) {
  await page.waitForFunction(
    () => Boolean(
      window.__URDF_STUDIO_DEBUG__?.resetFixtureFiles
        && window.__URDF_STUDIO_DEBUG__?.seedFixtureFile
        && window.__URDF_STUDIO_DEBUG__?.loadRobotByName,
    ),
    { timeout: 30_000 },
  );
  await page.evaluate(
    ({ cylinderFile, cylinderUrdf, boxFile, boxUrdf }) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      api.resetFixtureFiles();
      api.seedFixtureFile({
        name: cylinderFile,
        content: cylinderUrdf,
        format: 'urdf',
        addFileContent: true,
      });
      api.seedFixtureFile({
        name: boxFile,
        content: boxUrdf,
        format: 'urdf',
        addFileContent: true,
      });
    },
    {
      cylinderFile: CYLINDER_FILE,
      cylinderUrdf: CYLINDER_URDF,
      boxFile: BOX_FILE,
      boxUrdf: BOX_URDF,
    },
  );
  await page.evaluate(async (fileName) => {
    await window.__URDF_STUDIO_DEBUG__.loadRobotByName(fileName);
  }, CYLINDER_FILE);
}

async function jointPickSession(page) {
  return page.evaluate(() => {
    const state = window.__URDF_STUDIO_DEBUG__?.__jointPickSessionStore__?.getState?.();
    return state
      ? {
          active: state.active,
          side: state.side,
          parentSnap: state.parentSnap,
          childSnap: state.childSnap,
        }
      : null;
  });
}

async function waitForSnapKind(page, side, kind, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const key = side === 'parent' ? 'parentSnap' : 'childSnap';
  let last = null;
  while (Date.now() < deadline) {
    last = await jointPickSession(page);
    if (last?.[key]?.kind === kind) return last[key];
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${side} snap kind ${kind}; last=${JSON.stringify(last)}`);
}

function offsetWithinTarget(target) {
  const dx = Math.max(6, Math.min(24, Number(target.projectedWidth ?? 0) * 0.2));
  const dy = Math.max(6, Math.min(24, Number(target.projectedHeight ?? 0) * 0.15));
  return {
    ...target,
    clientX: target.clientX + dx,
    clientY: target.clientY + dy,
  };
}

async function clickCanvasTargetWithModifier(page, target) {
  const point = { x: target.clientX, y: target.clientY };
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down(MODIFIER_KEY);
  try {
    await page.mouse.down();
    await page.mouse.up();
  } finally {
    await page.keyboard.up(MODIFIER_KEY);
  }
  return point;
}

// Click an empty canvas spot to clear any pre-existing selection so the bridge
// modal's selection-sync does not swallow the first relation pick.
async function clearViewerSelection(page) {
  const rect = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!rect) return;
  for (const [fx, fy] of [[0.06, 0.94], [0.94, 0.06], [0.06, 0.06]]) {
    await page.mouse.click(rect.x + rect.w * fx, rect.y + rect.h * fy);
    await delay(250);
    const sel = await selectionOf(page);
    if (!sel || !sel.id) return;
  }
}

async function clickByTitle(page, titles) {
  return page.evaluate((wanted) => {
    for (const title of wanted) {
      const button = document.querySelector(`button[title="${title}"]`);
      if (button instanceof HTMLElement) { button.click(); return true; }
    }
    return false;
  }, titles);
}

async function findButton(page, texts) {
  return page.evaluate((wanted) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (element) => wanted.includes(element.textContent?.trim()),
    );
    if (!button) return { exists: false, disabled: false };
    return { exists: true, disabled: button.disabled };
  }, texts);
}

async function clickButton(page, texts) {
  return page.evaluate((wanted) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (element) => wanted.includes(element.textContent?.trim()) && !element.disabled,
    );
    if (button instanceof HTMLElement) { button.click(); return true; }
    return false;
  }, texts);
}

async function waitForButton(page, texts, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await findButton(page, texts)).exists) return true;
    await delay(150);
  }
  return false;
}

// Attribute a link target to a component by LONGEST component-id prefix, so a
// component id that is a prefix of another (comp_a1 vs comp_a1_1) does not
// swallow the other component's links.
function ownsTarget(targetId, componentId, allIds) {
  if (typeof targetId !== 'string' || !targetId.startsWith(`${componentId}_`)) return false;
  return !allIds.some(
    (other) =>
      other !== componentId && other.length > componentId.length && targetId.startsWith(`${other}_`),
  );
}

async function targetsForComponent(page, componentId, allIds, modalSafeMaxX) {
  const targets = await getProjectedInteractionTargets(page, { type: 'link' });
  return targets.filter(
    (target) => ownsTarget(target.id, componentId, allIds) && Number(target.clientX) < modalSafeMaxX,
  );
}

async function targetById(page, linkId) {
  return (await getProjectedInteractionTargets(page, { type: 'link' })).find((t) => t.id === linkId) ?? null;
}

// Wait until a component has projected at least `minCount` pickable link targets,
// so we never sample mid-(re)projection after moving/loading it.
async function waitForComponentTargets(page, componentId, allIds, modalSafeMaxX, minCount, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    last = (await targetsForComponent(page, componentId, allIds, modalSafeMaxX)).length;
    if (last >= minCount) return last;
    await delay(300);
  }
  return last;
}

async function main() {
  const suite = createTestSuite('Joint Pick');
  const session = await createSession();
  const { page } = session;
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  // Keep picks clear of the top-right bridge modal (~600px wide).
  const modalSafeMaxX = viewportWidth - 640;

  try {
    // ── Two-component assembly with controlled primitive snap surfaces ──
    await seedJointPickFixtures(page);
    await waitForReady(page);

    await store.initAssembly(page, 'joint_pick_asm'); await delay(300);
    const cylinderFile = await findAvailableFile(page, CYLINDER_FILE);
    const boxFile = await findAvailableFile(page, BOX_FILE);
    const compA = await store.addComponent(page, cylinderFile); await delay(500);
    const compB = await store.addComponent(page, boxFile); await delay(800);
    assert(suite, compA.ok && compB.ok, 'two components added');
    assertEqual(suite, (await getAssemblyState(page)).componentCount, 2, '2 components');
    const allIds = [compA.id, compB.id];

    // Separate the child sideways so both render fully (no occlusion) and stay
    // left of the top-right modal.
    await store.updateComponentTransform(page, compB.id, {
      position: { x: -1.2, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 },
    });
    await delay(1000);

    // ── Clear selection, then open the bridge modal ──
    await clearViewerSelection(page);
    assert(suite, await clickByTitle(page, CREATE_BRIDGE), 'create-bridge button clicked');
    assert(suite, await waitForButton(page, PICK_PARENT, 10000), 'bridge modal open with pick UI');
    assert(suite, (await findButton(page, PICK_PARENT)).disabled, 'pick disabled before relation');

    // ── Set the relation by clicking each component's link in the canvas ──
    // Wait for both components to finish projecting so target sampling is stable.
    await waitForComponentTargets(page, compA.id, allIds, modalSafeMaxX, 1);
    await waitForComponentTargets(page, compB.id, allIds, modalSafeMaxX, 1);
    const parentTargets = await targetsForComponent(page, compA.id, allIds, modalSafeMaxX);
    const childTargets = await targetsForComponent(page, compB.id, allIds, modalSafeMaxX);
    assertGreaterThan(suite, parentTargets.length, 0, 'parent link targets projected');
    assertGreaterThan(suite, childTargets.length, 0, 'child link targets projected');
    const parentTarget = parentTargets[0];
    const childTarget = childTargets[0];

    // Capture the link each relation click actually selected; the joint pick must
    // land on that same link (the layer validates both component AND link).
    await clickCanvasTarget(page, parentTarget); await delay(700);
    const relParentLinkId = (await selectionOf(page))?.id;
    await clickCanvasTarget(page, childTarget); await delay(800);
    const relChildLinkId = (await selectionOf(page))?.id;

    const enabled = (await waitForButton(page, PICK_PARENT, 4000))
      && !(await findButton(page, PICK_PARENT)).disabled;
    assert(suite, enabled, 'pick enabled after relation');

    // ── Pick the parent joint origin (re-fetch the link's current point) ──
    assert(suite, await clickButton(page, PICK_PARENT), 'activate parent pick');
    await delay(500);
    const parentPick = (await targetById(page, relParentLinkId)) ?? parentTarget;
    await clickCanvasTarget(page, parentPick); await delay(900);
    assert(suite, await waitForButton(page, PARENT_DONE, 5000), 'parent snap committed (raycast→resolve→commit)');
    const parentSnap = await waitForSnapKind(page, 'parent', 'circleCenter');
    assertEqual(suite, parentSnap.kind, 'circleCenter', 'cylinder cap pick snaps to circle center');

    // ── Pick the child joint origin ──
    assert(suite, await clickButton(page, PICK_CHILD), 'activate child pick');
    await delay(500);
    const childPick = (await targetById(page, relChildLinkId)) ?? childTarget;
    await clickCanvasTarget(page, childPick); await delay(1000);
    assert(suite, await waitForButton(page, CHILD_DONE, 5000), 'child snap committed');
    const childSnap = await waitForSnapKind(page, 'child', 'faceCenter');
    assertEqual(suite, childSnap.kind, 'faceCenter', 'box face pick snaps to face center');

    // ── Ctrl/Cmd override: same box surface can be committed as a raw surface point ──
    assert(suite, await clickButton(page, CHILD_DONE), 'reactivate child pick for free-point override');
    await delay(500);
    const freePointPick = offsetWithinTarget((await targetById(page, relChildLinkId)) ?? childPick);
    await clickCanvasTargetWithModifier(page, freePointPick); await delay(1000);
    const freePointSnap = await waitForSnapKind(page, 'child', 'surface');
    assertEqual(suite, freePointSnap.kind, 'surface', 'Ctrl/Cmd pick commits a free surface point');

    // ── Confirm → bridge created + child auto-aligned by the picked snaps ──
    const beforeChild = (await getAssemblyState(page)).components.find((c) => c.id === compB.id);
    assert(suite, await clickButton(page, CONFIRM), 'confirm bridge');
    await delay(1200);

    const asm = await getAssemblyState(page);
    assertEqual(suite, asm.bridgeCount, 1, 'bridge created via pick flow');
    const afterChild = asm.components.find((c) => c.id === compB.id);
    assert(
      suite,
      JSON.stringify(afterChild?.transform) !== JSON.stringify(beforeChild?.transform),
      'child component transform changed by snap alignment',
    );

    const errs = session.errors();
    assert(suite, errs.page.length === 0, `no page errors${errs.page.length ? `: ${errs.page.join(' | ')}` : ''}`);
  } finally {
    await session.cleanup();
  }

  await writeReport('joint_pick', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
