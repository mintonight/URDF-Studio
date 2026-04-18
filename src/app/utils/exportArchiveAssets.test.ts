import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { DEFAULT_LINK, GeometryType, type RobotState } from '@/types';

import { addRobotAssetsToZip, collectRobotAssetReferences } from './exportArchiveAssets.ts';

function createDataUrl(content: string, mimeType = 'text/plain'): string {
  return `data:${mimeType};base64,${Buffer.from(content).toString('base64')}`;
}

test('collectRobotAssetReferences includes both mesh and texture dependencies', () => {
  const robot: RobotState = {
    name: 'asset_refs',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'package://demo/meshes/base.stl',
          dimensions: { x: 1, y: 1, z: 1 },
          authoredMaterials: [
            {
              texture: 'package://demo/textures/body/base.png',
            },
          ],
        },
        visualBodies: [
          {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.5, y: 0.5, z: 0.5 },
            authoredMaterials: [
              {
                texture: 'package://demo/textures/body/secondary.png',
              },
            ],
          },
        ],
      },
    },
    joints: {},
    materials: {
      base_link: {
        texture: 'package://demo/textures/body/coat.png',
      },
    },
  };

  const references = collectRobotAssetReferences(robot);
  assert.deepEqual(Array.from(references.meshPaths), ['package://demo/meshes/base.stl']);
  assert.deepEqual(Array.from(references.texturePaths).sort(), [
    'package://demo/textures/body/base.png',
    'package://demo/textures/body/coat.png',
    'package://demo/textures/body/secondary.png',
  ]);
});

test('addRobotAssetsToZip packages texture assets alongside meshes for roundtrip exports', async () => {
  const robot: RobotState = {
    name: 'asset_zip',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'package://demo/meshes/base.stl',
          dimensions: { x: 1, y: 1, z: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        texture: 'package://demo/textures/body/coat.png',
      },
    },
  };

  const zip = new JSZip();
  const result = await addRobotAssetsToZip({
    robot,
    zip,
    assets: {
      'package://demo/meshes/base.stl': createDataUrl('solid base\nendsolid base', 'model/stl'),
      'package://demo/textures/body/coat.png': createDataUrl('png-texture', 'image/png'),
    },
  });
  assert.equal(result.failedAssets.length, 0);

  const roundtripZip = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
  const meshEntry = roundtripZip.file('meshes/base.stl');
  const textureEntry = roundtripZip.file('textures/body/coat.png');

  assert.ok(meshEntry, 'expected mesh to be written into meshes/');
  assert.ok(textureEntry, 'expected texture to be written into textures/');
  assert.match(await meshEntry!.async('string'), /solid base/);
  assert.equal(await textureEntry!.async('string'), 'png-texture');
});

test('addRobotAssetsToZip skips source meshes that were replaced for MJCF export', async () => {
  const robot: RobotState = {
    name: 'asset_skip',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'package://go2_description/dae/hip.dae',
          dimensions: { x: 1, y: 1, z: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const zip = new JSZip();
  const result = await addRobotAssetsToZip({
    robot,
    zip,
    assets: {
      'package://go2_description/dae/hip.dae': createDataUrl('<dae />', 'text/xml'),
    },
    skipMeshPaths: new Set(['package://go2_description/dae/hip.dae', 'dae/hip.dae']),
  });
  assert.equal(result.failedAssets.length, 0);

  const roundtripZip = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
  assert.equal(roundtripZip.file('meshes/dae/hip.dae'), null);
});

test('addRobotAssetsToZip reports missing assets instead of silently succeeding', async () => {
  const robot: RobotState = {
    name: 'asset_missing',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'package://missing/meshes/base.stl',
          dimensions: { x: 1, y: 1, z: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const zip = new JSZip();
  const result = await addRobotAssetsToZip({
    robot,
    zip,
    assets: {},
  });

  assert.equal(result.failedAssets.length, 1);
  assert.equal(result.failedAssets[0]?.code, 'mesh_asset_missing');
  assert.match(result.failedAssets[0]?.message ?? '', /not found/i);
});

test('addRobotAssetsToZip packages inline texture blobs when no asset URL exists', async () => {
  const robot: RobotState = {
    name: 'asset_inline_texture_zip',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'package://demo/meshes/base.stl',
          dimensions: { x: 1, y: 1, z: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        texture: 'package://demo/textures/body/coat.png',
      },
    },
  };

  const zip = new JSZip();
  const result = await addRobotAssetsToZip({
    robot,
    zip,
    assets: {},
    extraMeshFiles: new Map([
      [
        'package://demo/meshes/base.stl',
        new Blob(['solid inline\nendsolid inline'], { type: 'model/stl' }),
      ],
      [
        'package://demo/textures/body/coat.png',
        new Blob(['inline-png-texture'], { type: 'image/png' }),
      ],
    ]),
  });
  assert.equal(result.failedAssets.length, 0);

  const roundtripZip = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
  const meshEntry = roundtripZip.file('meshes/base.stl');
  const textureEntry = roundtripZip.file('textures/body/coat.png');

  assert.ok(meshEntry, 'expected inline mesh to be written into meshes/');
  assert.ok(textureEntry, 'expected inline texture to be written into textures/');
  assert.match(await meshEntry!.async('string'), /solid inline/);
  assert.equal(await textureEntry!.async('string'), 'inline-png-texture');
});

test('addRobotAssetsToZip keeps distinct Gazebo package textures with the same filename', async () => {
  const robot: RobotState = {
    name: 'asset_duplicate_texture_zip',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          authoredMaterials: [{ texture: 'model_a/materials/textures/bus.png' }],
        },
        visualBodies: [
          {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.5, y: 0.5, z: 0.5 },
            authoredMaterials: [{ texture: 'model_b/materials/textures/bus.png' }],
          },
        ],
      },
    },
    joints: {},
    materials: {},
  };

  const zip = new JSZip();
  const result = await addRobotAssetsToZip({
    robot,
    zip,
    assets: {
      'model_a/materials/textures/bus.png': createDataUrl('model-a-texture', 'image/png'),
      'model_b/materials/textures/bus.png': createDataUrl('model-b-texture', 'image/png'),
    },
  });
  assert.equal(result.failedAssets.length, 0);

  const roundtripZip = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
  const textureA = roundtripZip.file('textures/model_a/bus.png');
  const textureB = roundtripZip.file('textures/model_b/bus.png');

  assert.ok(textureA, 'expected the first Gazebo package texture to be preserved');
  assert.ok(textureB, 'expected the second Gazebo package texture to be preserved');
  assert.equal(await textureA!.async('string'), 'model-a-texture');
  assert.equal(await textureB!.async('string'), 'model-b-texture');
});
