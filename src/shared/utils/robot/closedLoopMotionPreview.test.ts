import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { JSDOM } from 'jsdom';

import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser.ts';

import { createClosedLoopMotionPreviewSession } from './closedLoopMotionPreview.ts';

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.window = dom.window as any;
  globalThis.document = dom.window.document as any;
  globalThis.DOMParser = dom.window.DOMParser as any;
  globalThis.XMLSerializer = dom.window.XMLSerializer as any;
  globalThis.Node = dom.window.Node as any;
  globalThis.Element = dom.window.Element as any;
  globalThis.Document = dom.window.Document as any;
}

test(
  'createClosedLoopMotionPreviewSession projects the active Robotiq coupler angle into the feasible loop range',
  { concurrency: false },
  () => {
    installDomGlobals();

    const robot = parseMJCF(
      fs.readFileSync('test/mujoco_menagerie-main/robotiq_2f85/2f85.xml', 'utf8'),
    );
    assert.ok(robot);

    const session = createClosedLoopMotionPreviewSession();
    session.setBaseRobot(robot);

    const preview = session.solve('right_coupler_joint', -1.57);

    assert.equal(preview.constrained, true);
    assert.ok(
      typeof preview.appliedAngle === 'number' && preview.appliedAngle > -0.8,
      `expected preview to report a constrained applied angle near the feasible boundary, angle=${preview.appliedAngle}`,
    );
    assert.ok(typeof preview.angles.right_coupler_joint === 'number');
    assert.ok(
      (preview.angles.right_coupler_joint ?? 0) > -0.8,
      `expected right_coupler_joint preview to move toward the feasible boundary, angle=${preview.angles.right_coupler_joint}`,
    );
    assert.ok(
      (preview.angles.right_coupler_joint ?? 0) < -0.3,
      `expected right_coupler_joint preview to clamp near the feasible boundary, angle=${preview.angles.right_coupler_joint}`,
    );
    assert.ok(
      typeof preview.angles.right_driver_joint === 'number' &&
        (preview.angles.right_driver_joint ?? 0) > 0.2,
      `expected right_driver_joint preview to be driven by the closed-loop solve, angle=${preview.angles.right_driver_joint}`,
    );
    assert.ok(
      Math.abs((preview.angles.right_follower_joint ?? 0) - 0.872664) < 1e-6,
      `expected right_follower_joint preview to reach its feasible boundary, angle=${preview.angles.right_follower_joint}`,
    );
  },
);
