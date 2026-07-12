import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type AssemblyComponent,
  type AssemblyState,
  type BridgeJoint,
  type RobotData,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';
import {
  graftAssemblyGroupUrdfSource,
  resolveAssemblyGroupMasterComponentId,
} from './assemblyUrdfSourceGraft.ts';

function makeLink(id: string, name = id): UrdfLink {
  return { ...DEFAULT_LINK, id, name };
}

function makeJoint(
  id: string,
  parentLinkId: string,
  childLinkId: string,
  overrides: Partial<UrdfJoint> = {},
): UrdfJoint {
  return {
    ...DEFAULT_JOINT,
    id,
    name: id,
    type: JointType.FIXED,
    parentLinkId,
    childLinkId,
    ...overrides,
  };
}

function makeComponent(id: string, name: string, robot: RobotData): AssemblyComponent {
  return {
    id,
    name,
    sourceFile: `robots/${name}.urdf`,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    visible: true,
    robot,
  };
}

function makeBridge(
  id: string,
  parentComponentId: string,
  parentLinkId: string,
  childComponentId: string,
  childLinkId: string,
  type: JointType = JointType.FIXED,
): BridgeJoint {
  return {
    id,
    name: id,
    parentComponentId,
    parentLinkId,
    childComponentId,
    childLinkId,
    joint: makeJoint(id, parentLinkId, childLinkId, { type }),
  };
}

const MASTER_TEXT = `<?xml version="1.0"?>
<robot name="master">
  <link name="base_link" />
  <link name="tip" />
  <joint name="j1" type="fixed">
    <parent link="base_link" />
    <child link="tip" />
  </joint>
</robot>
`;

function masterRobot(): RobotData {
  return {
    name: 'master',
    rootLinkId: 'base_link',
    links: { base_link: makeLink('base_link'), tip: makeLink('tip') },
    joints: { j1: makeJoint('j1', 'base_link', 'tip') },
  };
}

test('preserves master source text verbatim and injects the slave under the bridge', () => {
  const slave: RobotData = {
    name: 'slave',
    rootLinkId: 's_base',
    links: { s_base: makeLink('s_base'), s_tip: makeLink('s_tip') },
    joints: { sj1: makeJoint('sj1', 's_base', 's_tip') },
  };
  const assembly: AssemblyState = {
    name: 'ws',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: {
      m: makeComponent('m', 'master', masterRobot()),
      s: makeComponent('s', 'slave', slave),
    },
    bridges: { b1: makeBridge('b1', 'm', 'tip', 's', 's_base') },
  };

  const result = graftAssemblyGroupUrdfSource({
    assembly,
    groupComponentIds: ['m', 's'],
    masterComponentId: 'm',
    masterSourceUrdfText: MASTER_TEXT,
  });

  assert.equal(result.ok, true, result.reason);
  const urdf = result.urdfText ?? '';
  // Master body preserved verbatim (everything up to the injection point).
  assert.ok(urdf.startsWith('<?xml version="1.0"?>\n<robot name="master">'));
  assert.ok(urdf.includes('  <link name="base_link" />'));
  assert.ok(urdf.includes('  <joint name="j1" type="fixed">'));
  // Slave links injected.
  assert.ok(urdf.includes('name="s_base"'));
  assert.ok(urdf.includes('name="s_tip"'));
  // Bridge joint connects master tip -> slave root.
  assert.match(urdf, /<joint name="b1" type="fixed">[\s\S]*?<parent link="tip" \/>/);
  assert.match(urdf, /<joint name="b1"[\s\S]*?<child link="s_base" \/>/);
  // Single closing tag at the very end.
  assert.equal(urdf.match(/<\/robot>/g)?.length, 1);
});

test('re-roots the slave when the bridge attaches to a non-root link and reverses the axis', () => {
  const slave: RobotData = {
    name: 'slave',
    rootLinkId: 's_base',
    links: { s_base: makeLink('s_base'), s_tip: makeLink('s_tip') },
    joints: {
      sj1: makeJoint('sj1', 's_base', 's_tip', {
        type: JointType.REVOLUTE,
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 10, velocity: 10 },
      }),
    },
  };
  const assembly: AssemblyState = {
    name: 'ws',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: {
      m: makeComponent('m', 'master', masterRobot()),
      s: makeComponent('s', 'slave', slave),
    },
    // Attach to the slave's TIP, forcing a reroot so s_tip becomes the new root.
    bridges: { b1: makeBridge('b1', 'm', 'tip', 's', 's_tip') },
  };

  const result = graftAssemblyGroupUrdfSource({
    assembly,
    groupComponentIds: ['m', 's'],
    masterComponentId: 'm',
    masterSourceUrdfText: MASTER_TEXT,
  });

  assert.equal(result.ok, true, result.reason);
  const urdf = result.urdfText ?? '';
  // Bridge now attaches to the rerooted slave root (s_tip).
  assert.match(urdf, /<joint name="b1"[\s\S]*?<child link="s_tip" \/>/);
  // Reversed internal joint axis (z -> -z).
  assert.match(urdf, /<axis xyz="0 0 -1" \/>/);
});

test('namespaces only slave names that collide with the master; master stays verbatim', () => {
  // Slave root shares the name "base_link" with the master.
  const slave: RobotData = {
    name: 'slave',
    rootLinkId: 'base_link',
    links: { base_link: makeLink('base_link'), s_tip: makeLink('s_tip') },
    joints: { sj1: makeJoint('sj1', 'base_link', 's_tip') },
  };
  const assembly: AssemblyState = {
    name: 'ws',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: {
      m: makeComponent('m', 'master', masterRobot()),
      s: makeComponent('s', 'slave', slave),
    },
    bridges: { b1: makeBridge('b1', 'm', 'tip', 's', 'base_link') },
  };

  const result = graftAssemblyGroupUrdfSource({
    assembly,
    groupComponentIds: ['m', 's'],
    masterComponentId: 'm',
    masterSourceUrdfText: MASTER_TEXT,
  });

  assert.equal(result.ok, true, result.reason);
  const urdf = result.urdfText ?? '';
  // Master's own base_link declaration is untouched.
  assert.ok(urdf.includes('  <link name="base_link" />'));
  // Slave's colliding base_link is prefixed with the component name.
  assert.ok(urdf.includes('name="slave__base_link"'));
  assert.match(urdf, /<joint name="b1"[\s\S]*?<child link="slave__base_link" \/>/);
  // The un-colliding slave link keeps its original name.
  assert.ok(urdf.includes('name="s_tip"'));
});

test('grafts a chain master -> A -> B with two bridge joints', () => {
  const robotA: RobotData = {
    name: 'a',
    rootLinkId: 'a_base',
    links: { a_base: makeLink('a_base'), a_tip: makeLink('a_tip') },
    joints: { aj: makeJoint('aj', 'a_base', 'a_tip') },
  };
  const robotB: RobotData = {
    name: 'b',
    rootLinkId: 'b_base',
    links: { b_base: makeLink('b_base') },
    joints: {},
  };
  const assembly: AssemblyState = {
    name: 'ws',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: {
      m: makeComponent('m', 'master', masterRobot()),
      a: makeComponent('a', 'compA', robotA),
      b: makeComponent('b', 'compB', robotB),
    },
    bridges: {
      b1: makeBridge('b1', 'm', 'tip', 'a', 'a_base'),
      b2: makeBridge('b2', 'a', 'a_tip', 'b', 'b_base'),
    },
  };

  const result = graftAssemblyGroupUrdfSource({
    assembly,
    groupComponentIds: ['m', 'a', 'b'],
    masterComponentId: 'm',
    masterSourceUrdfText: MASTER_TEXT,
  });

  assert.equal(result.ok, true, result.reason);
  const urdf = result.urdfText ?? '';
  assert.ok(urdf.includes('name="a_base"'));
  assert.ok(urdf.includes('name="b_base"'));
  assert.match(urdf, /<joint name="b1"[\s\S]*?<parent link="tip" \/>/);
  assert.match(urdf, /<joint name="b2"[\s\S]*?<parent link="a_tip" \/>/);
  assert.equal(urdf.match(/<\/robot>/g)?.length, 1);
});

test('fails when the master text has no closing robot tag', () => {
  const assembly: AssemblyState = {
    name: 'ws',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: {
      m: makeComponent('m', 'master', masterRobot()),
      s: makeComponent('s', 'slave', masterRobot()),
    },
    bridges: { b1: makeBridge('b1', 'm', 'tip', 's', 'base_link') },
  };

  const result = graftAssemblyGroupUrdfSource({
    assembly,
    groupComponentIds: ['m', 's'],
    masterComponentId: 'm',
    masterSourceUrdfText: '<robot name="master"><link name="base_link"/>',
  });

  assert.equal(result.ok, false);
});

test('fails when a bridge would close a cycle (not expressible in URDF)', () => {
  const robotA: RobotData = {
    name: 'a',
    rootLinkId: 'a_base',
    links: { a_base: makeLink('a_base') },
    joints: {},
  };
  const assembly: AssemblyState = {
    name: 'ws',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: {
      m: makeComponent('m', 'master', masterRobot()),
      a: makeComponent('a', 'compA', robotA),
    },
    bridges: {
      b1: makeBridge('b1', 'm', 'tip', 'a', 'a_base'),
      // Reverse edge back to the master closes a cycle.
      b2: makeBridge('b2', 'a', 'a_base', 'm', 'base_link'),
    },
  };

  const result = graftAssemblyGroupUrdfSource({
    assembly,
    groupComponentIds: ['m', 'a'],
    masterComponentId: 'm',
    masterSourceUrdfText: MASTER_TEXT,
  });

  assert.equal(result.ok, false);
});

test('resolveAssemblyGroupMasterComponentId returns the tree root, null for multi-root', () => {
  const base = (id: string): AssemblyComponent =>
    makeComponent(id, id, {
      name: id,
      rootLinkId: 'l',
      links: { l: makeLink('l') },
      joints: {},
    });
  const treeAssembly: AssemblyState = {
    name: 'ws',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: { m: base('m'), a: base('a'), b: base('b') },
    bridges: {
      b1: makeBridge('b1', 'm', 'l', 'a', 'l'),
      b2: makeBridge('b2', 'a', 'l', 'b', 'l'),
    },
  };
  assert.equal(resolveAssemblyGroupMasterComponentId(treeAssembly, ['m', 'a', 'b']), 'm');

  const disconnected: AssemblyState = {
    name: 'ws',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: { m: base('m'), a: base('a') },
    bridges: {},
  };
  // Two roots -> ambiguous, cannot express as one verbatim-master URDF.
  assert.equal(resolveAssemblyGroupMasterComponentId(disconnected, ['m', 'a']), null);
});
