import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK, GeometryType, type RobotData, type RobotFile } from '@/types';
import { generateMujocoXML, generateURDF } from '@/core/parsers';
import { useRobotStore } from './robotStore.ts';

function resetAssemblyStore() {
  const state = useRobotStore.getState();
  state.clearHistory();
  state.exitAssembly();
  state.setAssembly(null);
}

function expectSerializedHexColor(
  xml: string,
  pattern: RegExp,
  expected: [number, number, number, number],
  tolerance = 1e-4,
) {
  const match = xml.match(pattern);
  assert.ok(match, `Expected color match for ${pattern} in export output`);

  const serialized = String(match[1] || '')
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));

  assert.equal(serialized.length, 4);
  serialized.forEach((channel, index) => {
    assert.ok(
      Number.isFinite(channel),
      `Expected finite RGBA channel at index ${index}, got ${String(match[1] || '')}`,
    );
    assert.ok(
      Math.abs(channel - expected[index]) <= tolerance,
      `Expected channel ${index} to be close to ${expected[index]}, got ${channel}`,
    );
  });
}

test('addComponent applies USD RobotData provided through context', () => {
  resetAssemblyStore();

  useRobotStore.getState().initAssembly('usd-integration');

  const usdFile: RobotFile = {
    name: 'robots/demo/simple.usd',
    content: '',
    format: 'usd',
  };

  const preResolvedRobotData: RobotData = {
    name: 'usd_robot',
    rootLinkId: 'usd_root',
    links: {
      usd_root: {
        ...DEFAULT_LINK,
        id: 'usd_root',
        name: 'usd_root',
        visible: true,
      },
    },
    joints: {},
  };

  const component = useRobotStore.getState().addComponent(usdFile, {
    availableFiles: [],
    assets: {},
    preResolvedRobotData,
  });

  assert.ok(component, 'USD component creation should not return null');
  assert.equal(component?.name, 'usd_robot');
  assert.ok(component?.robot.links.comp_usd_robot_usd_root);
  assert.equal(component?.robot.rootLinkId, 'comp_usd_robot_usd_root');

  const stored = useRobotStore.getState().assemblyState?.components[component!.id];
  assert.ok(stored, 'Assembly state should hold the new component');
  assert.equal(stored?.sourceFile, 'robots/demo/simple.usd');
  assert.equal(component?.id, stored?.id);
});

test('assembly export preserves colors stored in component materials after prefixing', () => {
  resetAssemblyStore();

  useRobotStore.getState().initAssembly('usd-material-export');

  const usdFile: RobotFile = {
    name: 'robots/demo/materials.usd',
    content: '',
    format: 'usd',
  };

  const preResolvedRobotData: RobotData = {
    name: 'usd_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          color: '#3b82f6',
          meshPath: 'meshes/base.obj',
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#12ab34',
      },
    },
  };

  const component = useRobotStore.getState().addComponent(usdFile, {
    availableFiles: [],
    assets: {},
    preResolvedRobotData,
  });

  assert.ok(component, 'USD component creation should not return null');

  const merged = useRobotStore.getState().getMergedRobotData();
  assert.ok(merged, 'Merged robot data should be available for export');

  const robotForExport = {
    ...merged,
    selection: { type: null, id: null as string | null },
  };

  const urdf = generateURDF(robotForExport);
  const mjcf = generateMujocoXML(robotForExport, {
    meshdir: 'meshes/',
    includeSceneHelpers: false,
  });

  expectSerializedHexColor(
    urdf,
    /<color rgba="([^"]+)"\/>/,
    [0.07058824, 0.67058824, 0.20392157, 1],
  );
  expectSerializedHexColor(
    mjcf,
    /<material name="[^"]+" rgba="([^"]+)"(?: [^/>]+="[^"]+")* \/>/,
    [0.07058824, 0.67058824, 0.20392157, 1],
  );
  assert.match(mjcf, /<geom[^>]*material="[^"]+"[^>]*type="mesh"/);
});

test('updateComponentRobot keeps namespaced component materials in sync with edited visual colors', () => {
  resetAssemblyStore();

  useRobotStore.getState().initAssembly('usd-material-sync');

  const usdFile: RobotFile = {
    name: 'robots/demo/material_sync.usd',
    content: '',
    format: 'usd',
  };

  const preResolvedRobotData: RobotData = {
    name: 'usd_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          color: '#3b82f6',
          meshPath: 'meshes/base.obj',
        },
      },
    },
    joints: {},
  };

  const component = useRobotStore.getState().addComponent(usdFile, {
    availableFiles: [],
    assets: {},
    preResolvedRobotData,
  });

  assert.ok(component, 'USD component creation should not return null');

  const linkId = component!.robot.rootLinkId;
  const updatedLink = {
    ...component!.robot.links[linkId],
    visual: {
      ...component!.robot.links[linkId].visual,
      color: '#ff6600',
    },
  };

  useRobotStore.getState().updateComponentRobot(component!.id, {
    links: {
      ...component!.robot.links,
      [linkId]: updatedLink,
    },
  });

  const stored = useRobotStore.getState().assemblyState?.components[component!.id];
  assert.equal(stored?.robot.links[linkId].visual.color, '#ff6600');
  assert.equal(stored?.robot.materials?.[linkId]?.color, '#ff6600');
});

test('addComponent rewrites USD prepared mesh paths into source-relative library paths', () => {
  resetAssemblyStore();

  useRobotStore.getState().initAssembly('usd-mesh-path-rewrite');

  const usdFile: RobotFile = {
    name: 'robots/go2/usd/go2.usd',
    content: '',
    format: 'usd',
  };

  const preResolvedRobotData: RobotData = {
    name: 'usd_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'base_link_visual_0.obj',
        },
      },
    },
    joints: {},
  };

  const component = useRobotStore.getState().addComponent(usdFile, {
    availableFiles: [],
    assets: {},
    preResolvedRobotData,
  });

  assert.ok(component, 'USD component creation should not return null');

  const rewrittenMeshPath = component?.robot.links.comp_usd_robot_base_link.visual.meshPath;
  assert.equal(rewrittenMeshPath, 'robots/go2/usd/base_link_visual_0.obj');
});
