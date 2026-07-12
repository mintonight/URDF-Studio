import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

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
  createSourceSemanticRobotHash,
} from '@/core/robot';
import {
  graftAssemblyGroupUrdfSource,
  resolveAssemblyGroupMasterComponentId,
} from './assemblyUrdfSourceGraft.ts';
import { partitionFlattenedGroupEdit } from './assemblyUrdfSourcePartition.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

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

function basicAssembly(): AssemblyState {
  const slave: RobotData = {
    name: 'slave',
    rootLinkId: 's_base',
    links: { s_base: makeLink('s_base'), s_tip: makeLink('s_tip') },
    joints: { sj1: makeJoint('sj1', 's_base', 's_tip') },
  };
  return {
    name: 'ws',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: {
      m: makeComponent('m', 'master', masterRobot()),
      s: makeComponent('s', 'slave', slave),
    },
    bridges: { b1: makeBridge('b1', 'm', 'tip', 's', 's_base') },
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
  assert.equal(result.provenance?.masterComponentId, 'm');
  assert.deepEqual(result.provenance?.linkOwnerByName.get('s_base'), {
    componentId: 's',
    originalName: 's_base',
  });
  assert.deepEqual(result.provenance?.jointOwnerByName.get('b1'), {
    kind: 'bridge',
    bridgeId: 'b1',
  });
  assert.deepEqual(result.provenance?.slaveById.get('s'), {
    originalRootLinkId: 's_base',
  });
});

test('partitions a master semantic edit into only the master component robot', () => {
  const assembly = basicAssembly();
  const grafted = graftAssemblyGroupUrdfSource({
    assembly,
    groupComponentIds: ['m', 's'],
    masterComponentId: 'm',
    masterSourceUrdfText: MASTER_TEXT,
  });
  assert.ok(grafted.urdfText && grafted.provenance);

  const partitioned = partitionFlattenedGroupEdit(
    grafted.urdfText.replace('<robot name="master">', '<robot name="master_edited">'),
    grafted.provenance,
  );

  assert.equal(partitioned.ok, true, partitioned.reason);
  assert.equal(partitioned.componentRobots?.size, 1);
  assert.equal(partitioned.componentRobots?.get('m')?.name, 'master_edited');
  assert.equal(partitioned.componentRobots?.has('s'), false);
  assert.deepEqual(partitioned.bridgeJointEdits, []);
});

test('partitions a bridge origin edit into a source-local bridge joint', () => {
  const assembly = basicAssembly();
  const grafted = graftAssemblyGroupUrdfSource({
    assembly,
    groupComponentIds: ['m', 's'],
    masterComponentId: 'm',
    masterSourceUrdfText: MASTER_TEXT,
  });
  assert.ok(grafted.urdfText && grafted.provenance);
  const editedText = grafted.urdfText.replace(
    /(<joint name="b1"[\s\S]*?<origin xyz=")[^"]+/,
    (_match, prefix: string) => `${prefix}1 2 3`,
  );

  const partitioned = partitionFlattenedGroupEdit(editedText, grafted.provenance);

  assert.equal(partitioned.ok, true, partitioned.reason);
  assert.equal(partitioned.componentRobots?.size, 0);
  assert.equal(partitioned.bridgeJointEdits?.length, 1);
  assert.equal(partitioned.bridgeJointEdits?.[0].bridgeId, 'b1');
  assert.deepEqual(partitioned.bridgeJointEdits?.[0].joint.origin.xyz, { x: 1, y: 2, z: 3 });
  assert.equal(partitioned.bridgeJointEdits?.[0].joint.parentLinkId, 'tip');
  assert.equal(partitioned.bridgeJointEdits?.[0].joint.childLinkId, 's_base');
});

test('rejects slave edits and unattributed entities in Phase 1', () => {
  const assembly = basicAssembly();
  const grafted = graftAssemblyGroupUrdfSource({
    assembly,
    groupComponentIds: ['m', 's'],
    masterComponentId: 'm',
    masterSourceUrdfText: MASTER_TEXT,
  });
  assert.ok(grafted.urdfText && grafted.provenance);

  const slaveEdit = partitionFlattenedGroupEdit(
    grafted.urdfText.replace('<link name="s_base">', '<link name="s_base" type="edited">'),
    grafted.provenance,
  );
  assert.equal(slaveEdit.ok, false);
  assert.match(slaveEdit.reason ?? '', /slave component/);

  const unattributed = partitionFlattenedGroupEdit(
    grafted.urdfText.replace('</robot>', '  <link name="new_link" />\n</robot>'),
    grafted.provenance,
  );
  assert.equal(unattributed.ok, false);
  assert.match(unattributed.reason ?? '', /no component provenance/);
});

test('unchanged graft partitions without semantic drift or writeback targets', () => {
  const assembly = basicAssembly();
  const originalHashes = new Map(
    Object.entries(assembly.components).map(([id, component]) => [
      id,
      createSourceSemanticRobotHash(component.robot),
    ]),
  );
  const grafted = graftAssemblyGroupUrdfSource({
    assembly,
    groupComponentIds: ['m', 's'],
    masterComponentId: 'm',
    masterSourceUrdfText: MASTER_TEXT,
  });
  assert.ok(grafted.urdfText && grafted.provenance);

  const partitioned = partitionFlattenedGroupEdit(grafted.urdfText, grafted.provenance);

  assert.equal(partitioned.ok, true, partitioned.reason);
  assert.equal(partitioned.componentRobots?.size, 0);
  assert.deepEqual(partitioned.bridgeJointEdits, []);
  for (const [componentId, originalHash] of originalHashes) {
    const unchangedRobot: RobotData = partitioned.componentRobots?.get(componentId)
      ?? assembly.components[componentId].robot;
    assert.equal(createSourceSemanticRobotHash(unchangedRobot), originalHash);
  }
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
