import test from 'node:test';
import assert from 'node:assert/strict';
import type { RobotFile } from '@/types';

import {
  buildEditableRobotSourceWorkerDispatch,
  buildEditableRobotSourceWorkerOptions,
  buildPrepareAssemblyComponentWorkerDispatch,
  buildResolveRobotImportWorkerDispatch,
  buildResolveRobotImportWorkerOptions,
} from './robotImportWorkerPayload.ts';

const demoUrdfFile = {
  name: 'robots/demo/urdf/demo.urdf',
  format: 'urdf',
  content: '<robot name="demo"><link name="base_link" /></robot>',
} as const;

test('buildResolveRobotImportWorkerOptions strips unused context for usd imports', () => {
  const usdRobotData = {
    name: 'cached-usd',
    links: {},
    joints: {},
    rootLinkId: 'usd_root',
  };

  const result = buildResolveRobotImportWorkerOptions(
    {
      name: 'robots/demo/usd/demo.usd',
      format: 'usd',
      content: '#usda 1.0',
    },
    {
      availableFiles: [
        demoUrdfFile,
        {
          name: 'robots/demo/xacro/demo.xacro',
          format: 'xacro',
          content: '<robot />',
        },
      ],
      assets: {
        'robots/demo/meshes/base.stl': 'blob:mesh',
      },
      allFileContents: {
        'robots/demo/materials/demo.material': 'material Demo {}',
      },
      usdRobotData,
    },
  );

  assert.deepEqual(result, { usdRobotData });
});

test('buildResolveRobotImportWorkerOptions keeps only mjcf sources for mjcf imports', () => {
  const result = buildResolveRobotImportWorkerOptions(
    {
      name: 'robots/demo/mjcf/demo.xml',
      format: 'mjcf',
      content: '<mujoco />',
    },
    {
      availableFiles: [
        demoUrdfFile,
        {
          name: 'robots/demo/mjcf/demo.xml',
          format: 'mjcf',
          content: '<mujoco />',
        },
        {
          name: 'robots/demo/meshes/base.stl',
          format: 'mesh',
          content: 'solid demo',
        },
      ],
      allFileContents: {
        'robots/demo/meshes/base.obj': 'o Mesh',
      },
    },
  );

  assert.deepEqual(
    result.availableFiles?.map((file) => ({ name: file.name, format: file.format })),
    [{ name: 'robots/demo/mjcf/demo.xml', format: 'mjcf' }],
  );
  assert.deepEqual(result.allFileContents, {
    'robots/demo/meshes/base.obj': 'o Mesh',
  });
});

test('buildResolveRobotImportWorkerDispatch moves mjcf context into a reusable worker snapshot', () => {
  const availableFiles = [
    demoUrdfFile,
    {
      name: 'robots/demo/mjcf/demo.xml',
      format: 'mjcf',
      content: '<mujoco />',
    },
    {
      name: 'robots/demo/meshes/base.stl',
      format: 'mesh',
      content: 'solid demo',
    },
  ] as const;

  const result = buildResolveRobotImportWorkerDispatch(
    {
      name: 'robots/demo/mjcf/demo.xml',
      format: 'mjcf',
      content: '<mujoco />',
    },
    {
      availableFiles: [...availableFiles],
      allFileContents: {
        'robots/demo/meshes/base.obj': 'o Mesh',
      },
    },
  );

  assert.deepEqual(result.options, {});
  assert.equal(typeof result.contextCacheKey, 'string');
  assert.deepEqual(
    result.contextSnapshot?.availableFiles?.map((file) => ({
      name: file.name,
      format: file.format,
    })),
    [{ name: 'robots/demo/mjcf/demo.xml', format: 'mjcf' }],
  );
  assert.deepEqual(result.contextSnapshot?.allFileContents, {
    'robots/demo/meshes/base.obj': 'o Mesh',
  });
});

test('buildResolveRobotImportWorkerDispatch forwards exact URDF source context only when inline content is missing', () => {
  const result = buildResolveRobotImportWorkerDispatch(
    {
      name: 'robots/demo/urdf/demo.urdf',
      format: 'urdf',
      content: '',
    },
    {
      availableFiles: [
        demoUrdfFile,
        {
          name: 'robots/demo/urdf/demo.urdf',
          format: 'urdf',
          content: '<robot name="library"><link name="base_link" /></robot>',
        },
        {
          name: 'robots/demo/xacro/demo.xacro',
          format: 'xacro',
          content: '<robot />',
        },
      ],
      allFileContents: {
        '/robots/demo/urdf/demo.urdf': '<robot name="text"><link name="base_link" /></robot>',
        'robots/demo/materials/demo.material': 'material Demo {}',
      },
    },
  );

  assert.deepEqual(result.options, {});
  assert.equal(typeof result.contextCacheKey, 'string');
  assert.deepEqual(
    result.contextSnapshot?.availableFiles?.map((file) => ({
      name: file.name,
      format: file.format,
    })),
    [{ name: 'robots/demo/urdf/demo.urdf', format: 'urdf' }],
  );
  assert.deepEqual(result.contextSnapshot?.allFileContents, {
    '/robots/demo/urdf/demo.urdf': '<robot name="text"><link name="base_link" /></robot>',
  });
});

test('buildEditableRobotSourceWorkerOptions keeps only source-relevant files for xacro edits', () => {
  const result = buildEditableRobotSourceWorkerOptions({
    file: {
      name: 'robots/demo/xacro/demo.xacro',
      format: 'xacro',
    },
    content: '<robot />',
    availableFiles: [
      demoUrdfFile,
      {
        name: 'robots/demo/xacro/demo.xacro',
        format: 'xacro',
        content: '<robot />',
      },
      {
        name: 'robots/demo/usd/demo.usd',
        format: 'usd',
        content: '#usda 1.0',
      },
      {
        name: 'robots/demo/meshes/base.stl',
        format: 'mesh',
        content: 'solid demo',
      },
    ],
    allFileContents: {
      'robots/demo/xacro/macros/common.xacro': '<robot />',
      'robots/demo/materials/demo.material': 'material Demo {}',
    },
  });

  assert.deepEqual(
    result.availableFiles.map((file) => ({ name: file.name, format: file.format })),
    [
      { name: demoUrdfFile.name, format: demoUrdfFile.format },
      { name: 'robots/demo/xacro/demo.xacro', format: 'xacro' },
    ],
  );
  assert.deepEqual(result.allFileContents, {
    'robots/demo/xacro/macros/common.xacro': '<robot />',
    'robots/demo/materials/demo.material': 'material Demo {}',
  });
});

test('buildEditableRobotSourceWorkerDispatch omits repeated xacro context from the per-request payload', () => {
  const availableFiles: RobotFile[] = [
    demoUrdfFile,
    {
      name: 'robots/demo/xacro/demo.xacro',
      format: 'xacro',
      content: '<robot />',
    },
    {
      name: 'robots/demo/usd/demo.usd',
      format: 'usd',
      content: '#usda 1.0',
    },
  ];
  const allFileContents = {
    'robots/demo/xacro/macros/common.xacro': '<robot />',
    'robots/demo/materials/demo.material': 'material Demo {}',
  };

  const result = buildEditableRobotSourceWorkerDispatch({
    file: {
      name: 'robots/demo/xacro/demo.xacro',
      format: 'xacro',
    },
    content: '<robot />',
    availableFiles,
    allFileContents,
  });

  assert.equal(typeof result.contextCacheKey, 'string');
  assert.deepEqual(result.options.availableFiles, undefined);
  assert.deepEqual(result.options.allFileContents, undefined);
  assert.deepEqual(
    result.contextSnapshot?.availableFiles?.map((file) => ({
      name: file.name,
      format: file.format,
    })),
    [
      { name: demoUrdfFile.name, format: demoUrdfFile.format },
      { name: 'robots/demo/xacro/demo.xacro', format: 'xacro' },
    ],
  );
  assert.deepEqual(result.contextSnapshot?.allFileContents, allFileContents);
});

test('buildPrepareAssemblyComponentWorkerDispatch keeps placement snapshots in the request payload', () => {
  const result = buildPrepareAssemblyComponentWorkerDispatch(
    {
      name: 'robots/demo/urdf/demo.urdf',
      format: 'urdf',
      content: '',
    },
    {
      availableFiles: [
        demoUrdfFile,
        {
          name: 'robots/demo/urdf/demo.urdf',
          format: 'urdf',
          content: '<robot name="demo"><link name="base_link" /></robot>',
        },
        {
          name: 'robots/demo/meshes/base.stl',
          format: 'mesh',
          content: 'solid demo',
        },
      ],
      assets: {
        'robots/demo/meshes/base.stl': 'blob:mesh',
      },
      allFileContents: {
        '/robots/demo/urdf/demo.urdf': '<robot name="text"><link name="base_link" /></robot>',
      },
      existingPlacementComponents: [
        {
          renderableBounds: {
            min: { x: -0.5, y: -0.5, z: 0 },
            max: { x: 0.5, y: 0.5, z: 1 },
          },
          transform: {
            position: { x: 1.25, y: 0, z: 0 },
            rotation: { r: 0, p: 0, y: 0 },
          },
        },
      ],
    },
  );

  assert.deepEqual(result.options, {
    availableFiles: [
      demoUrdfFile,
      {
        name: 'robots/demo/urdf/demo.urdf',
        format: 'urdf',
        content: '<robot name="demo"><link name="base_link" /></robot>',
      },
      {
        name: 'robots/demo/meshes/base.stl',
        format: 'mesh',
        content: 'solid demo',
      },
    ],
    assets: {
      'robots/demo/meshes/base.stl': 'blob:mesh',
    },
    allFileContents: {
      '/robots/demo/urdf/demo.urdf': '<robot name="text"><link name="base_link" /></robot>',
    },
    existingPlacementComponents: [
      {
        renderableBounds: {
          min: { x: -0.5, y: -0.5, z: 0 },
          max: { x: 0.5, y: 0.5, z: 1 },
        },
        transform: {
          position: { x: 1.25, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
      },
    ],
  });
  assert.equal(typeof result.contextCacheKey, 'string');
  assert.deepEqual(result.contextSnapshot?.assets, {
    'robots/demo/meshes/base.stl': 'blob:mesh',
  });
  assert.deepEqual(
    result.contextSnapshot?.availableFiles?.map((file) => ({
      name: file.name,
      format: file.format,
    })),
    [{ name: 'robots/demo/urdf/demo.urdf', format: 'urdf' }],
  );
  assert.deepEqual(result.contextSnapshot?.allFileContents, {
    '/robots/demo/urdf/demo.urdf': '<robot name="text"><link name="base_link" /></robot>',
  });
});

test('buildPrepareAssemblyComponentWorkerDispatch keeps MJCF text sidecars and mesh assets in worker context', () => {
  const mjcfFile = {
    name: 'mujoco_menagerie-main/agilex_piper/piper.xml',
    format: 'mjcf' as const,
    content: '<mujoco><compiler meshdir="assets" /></mujoco>',
  };

  const result = buildPrepareAssemblyComponentWorkerDispatch(mjcfFile, {
    availableFiles: [
      mjcfFile,
      {
        name: 'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj',
        format: 'asset',
        content: 'mtllib material.mtl',
      },
    ],
    assets: {
      'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj': 'blob:obj',
      'mujoco_menagerie-main/agilex_piper/assets/material.mtl': 'blob:mtl',
    },
    allFileContents: {
      'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj': 'mtllib material.mtl',
      'mujoco_menagerie-main/agilex_piper/assets/material.mtl': 'newmtl demo\nKd 1 0 0',
    },
  });

  assert.equal(typeof result.contextCacheKey, 'string');
  assert.deepEqual(result.options, {
    availableFiles: [
      mjcfFile,
      {
        name: 'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj',
        format: 'asset',
        content: 'mtllib material.mtl',
      },
    ],
    assets: {
      'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj': 'blob:obj',
      'mujoco_menagerie-main/agilex_piper/assets/material.mtl': 'blob:mtl',
    },
    allFileContents: {
      'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj': 'mtllib material.mtl',
      'mujoco_menagerie-main/agilex_piper/assets/material.mtl': 'newmtl demo\nKd 1 0 0',
    },
  });
  assert.deepEqual(
    result.contextSnapshot?.availableFiles?.map((file) => ({
      name: file.name,
      format: file.format,
    })),
    [{ name: mjcfFile.name, format: 'mjcf' }],
  );
  assert.deepEqual(result.contextSnapshot?.assets, {
    'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj': 'blob:obj',
    'mujoco_menagerie-main/agilex_piper/assets/material.mtl': 'blob:mtl',
  });
  assert.deepEqual(result.contextSnapshot?.allFileContents, {
    'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj': 'mtllib material.mtl',
    'mujoco_menagerie-main/agilex_piper/assets/material.mtl': 'newmtl demo\nKd 1 0 0',
  });
});
