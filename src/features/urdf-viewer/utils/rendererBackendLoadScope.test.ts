import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotData, type RobotFile } from '@/types';
import { createRendererBackendLoadScopeKey } from './rendererBackendLoadScope.ts';

function createRobotData(angle: number): RobotData {
  return {
    name: 'demo',
    rootLinkId: 'base',
    links: {
      base: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base',
        name: 'base',
      },
      arm: {
        ...structuredClone(DEFAULT_LINK),
        id: 'arm',
        name: 'arm',
      },
    },
    joints: {
      shoulder: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'shoulder',
        name: 'shoulder',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'arm',
        angle,
      },
    },
    materials: {},
  };
}

const sourceFile: RobotFile = {
  name: 'demo.urdf',
  format: 'urdf',
  content: '<robot name="demo" />',
};

test('createRendererBackendLoadScopeKey ignores transient joint motion changes', () => {
  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: createRobotData(0),
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile: { ...sourceFile },
    assets: {},
    reloadToken: 0,
    robotData: createRobotData(1),
  });

  assert.equal(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey changes for structural robot edits', () => {
  const baselineRobotData = createRobotData(0);
  const editedRobotData = createRobotData(0);
  editedRobotData.joints.shoulder.origin.xyz.x = 0.25;

  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: baselineRobotData,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: editedRobotData,
  });

  assert.notEqual(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey stays stable for primary visual color edits', () => {
  const baselineRobotData = createRobotData(0);
  const editedRobotData = createRobotData(0);
  baselineRobotData.links.base.visual.color = '#808080';
  editedRobotData.links.base.visual.color = '#12ab34';

  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: baselineRobotData,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: editedRobotData,
  });

  assert.equal(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey stays stable for authored material color edits', () => {
  const baselineRobotData = createRobotData(0);
  const editedRobotData = createRobotData(0);
  baselineRobotData.links.base.visual.authoredMaterials = [
    { name: 'body', color: '#808080' },
    { name: 'trim', color: '#101010' },
  ];
  editedRobotData.links.base.visual.authoredMaterials = [
    { name: 'body', color: '#12ab34' },
    { name: 'trim', color: '#101010' },
  ];

  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: baselineRobotData,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: editedRobotData,
  });

  assert.equal(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey keeps USD hydration data from triggering reloads', () => {
  const usdSourceFile: RobotFile = {
    name: 'demo.usd',
    format: 'usd',
    content: '#usda 1.0',
  };

  const loadingKey = createRendererBackendLoadScopeKey({
    sourceFile: usdSourceFile,
    assets: {},
    availableFiles: [],
    reloadToken: 0,
    robotData: null,
  });
  const hydratedKey = createRendererBackendLoadScopeKey({
    sourceFile: { ...usdSourceFile },
    assets: {},
    availableFiles: [],
    reloadToken: 0,
    robotData: createRobotData(0),
  });

  assert.equal(hydratedKey, loadingKey);
});

test('createRendererBackendLoadScopeKey treats USDA aliases like USD for hydration reloads', () => {
  const usdaSourceFile: RobotFile = {
    name: 'demo.usda',
    format: 'usda' as RobotFile['format'],
    content: '#usda 1.0',
  };

  const loadingKey = createRendererBackendLoadScopeKey({
    sourceFile: usdaSourceFile,
    assets: {},
    availableFiles: [],
    reloadToken: 0,
    robotData: null,
  });
  const hydratedKey = createRendererBackendLoadScopeKey({
    sourceFile: { ...usdaSourceFile },
    assets: {},
    availableFiles: [],
    reloadToken: 0,
    robotData: createRobotData(0),
  });

  assert.equal(hydratedKey, loadingKey);
});

test('createRendererBackendLoadScopeKey changes when reload token changes', () => {
  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: createRobotData(0),
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 1,
    robotData: createRobotData(0),
  });

  assert.notEqual(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey changes when XML fallback policy changes', () => {
  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    allowUrdfXmlFallback: false,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    allowUrdfXmlFallback: true,
  });

  assert.notEqual(secondKey, firstKey);
});
