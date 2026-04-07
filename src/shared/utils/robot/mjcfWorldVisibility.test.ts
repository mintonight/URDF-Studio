import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK } from '@/types';

import { applyMjcfWorldVisibility } from './mjcfWorldVisibility';

test('applyMjcfWorldVisibility hides the synthetic MJCF world link without mutating children', () => {
  const robot = {
    name: 'demo',
    rootLinkId: 'world',
    selection: { type: null, id: null },
    inspectionContext: {
      sourceFormat: 'mjcf' as const,
    },
    joints: {},
    links: {
      world: {
        ...DEFAULT_LINK,
        id: 'world',
        name: 'world',
      },
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
  };

  const nextRobot = applyMjcfWorldVisibility(robot, false);

  assert.notEqual(nextRobot, robot);
  assert.notEqual(nextRobot.links, robot.links);
  assert.notEqual(nextRobot.links.world, robot.links.world);
  assert.equal(nextRobot.links.world.visible, false);
  assert.equal(nextRobot.links.world.visual.visible, false);
  assert.equal(nextRobot.links.world.collision.visible, false);
  assert.equal(nextRobot.links.base_link, robot.links.base_link);
  assert.equal(nextRobot.links.base_link.visible, true);
});

test('applyMjcfWorldVisibility leaves non-MJCF robots unchanged', () => {
  const robot = {
    name: 'demo',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    inspectionContext: {
      sourceFormat: 'urdf' as const,
    },
    joints: {},
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
  };

  const nextRobot = applyMjcfWorldVisibility(robot, false);

  assert.equal(nextRobot, robot);
});
