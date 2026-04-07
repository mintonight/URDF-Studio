import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  buildStandaloneImportAssetWarning,
  buildStandalonePackageAssetImportWarning,
  extractStandaloneImportAssetReferences,
  extractPackageAssetBundleRoots,
  inferCommonPackageAssetBundleRoot,
} from './importPackageAssetReferences.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

test('extractPackageAssetBundleRoots keeps ROS package roots with intermediate model folders', () => {
  const content = `
<robot name="valkyrie">
  <link name="pelvis">
    <visual>
      <geometry>
        <mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />
      </geometry>
    </visual>
  </link>
</robot>`;

  assert.deepEqual(extractPackageAssetBundleRoots(content), ['val_description/model']);
});

test('extractPackageAssetBundleRoots preserves deeper package roots before mesh and texture folders', () => {
  const content = `
<robot name="pointfoot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://robot_description/pointfoot/PF_P441A/meshes/base_Link.STL" />
      </geometry>
    </visual>
  </link>
</robot>`;

  assert.deepEqual(extractPackageAssetBundleRoots(content), [
    'robot_description/pointfoot/PF_P441A',
  ]);
});

test('inferCommonPackageAssetBundleRoot derives a shared root from package-dependent robot definitions', () => {
  const sources = [
    {
      format: 'urdf',
      content: '<mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />',
    },
    {
      format: 'urdf',
      content:
        '<mesh filename="package://val_description/model/materials/textures/pelvistexture.png" />',
    },
  ];

  assert.equal(inferCommonPackageAssetBundleRoot(sources), 'val_description/model');
});

test('buildStandalonePackageAssetImportWarning reports package-backed imports with no accompanying assets', () => {
  const warning = buildStandalonePackageAssetImportWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />',
    },
    [],
  );

  assert.deepEqual(warning, {
    bundleRoots: ['val_description/model'],
    packageNames: ['val_description'],
  });
});

test('buildStandalonePackageAssetImportWarning stays silent once assets are imported together', () => {
  const warning = buildStandalonePackageAssetImportWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />',
    },
    ['val_description/model/meshes/pelvis/pelvis.dae'],
  );

  assert.equal(warning, null);
});

test('buildStandalonePackageAssetImportWarning stays silent for nested ZIP roots that still contain the package bundle', () => {
  const warning = buildStandalonePackageAssetImportWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />',
    },
    ['archives/2026-04-05/val_description/model/meshes/pelvis/pelvis.dae'],
  );

  assert.equal(warning, null);
});

test('buildStandalonePackageAssetImportWarning stays silent when import path collisions rename the package folder', () => {
  const warning = buildStandalonePackageAssetImportWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://autokit/meshes/base_link.STL" />',
    },
    ['autokit (1)/meshes/base_link.STL'],
  );

  assert.equal(warning, null);
});

test('buildStandalonePackageAssetImportWarning ignores unrelated assets from other bundles', () => {
  const warning = buildStandalonePackageAssetImportWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />',
    },
    ['other_description/meshes/base.dae'],
  );

  assert.deepEqual(warning, {
    bundleRoots: ['val_description/model'],
    packageNames: ['val_description'],
  });
});

test('buildStandaloneImportAssetWarning reports missing mesh assets for standalone MJCF imports', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      name: 'robots/demo/missing.xml',
      format: 'mjcf',
      content: `
        <mujoco model="missing-mjcf-assets">
          <compiler meshdir="assets" />
          <asset>
            <mesh name="nut_2_5" file="nut_2_5.stl" />
          </asset>
        </mujoco>`,
    },
    [],
  );

  assert.deepEqual(warning, {
    missingAssetPaths: ['robots/demo/assets/nut_2_5.stl'],
  });
});

test('buildStandaloneImportAssetWarning accepts compiler-normalized MJCF bundle paths', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      name: 'myosuite/envs/myo/assets/arm/myoarm_tabletennis.xml',
      format: 'mjcf',
      content: `
        <mujoco model="tabletennis">
          <compiler meshdir="../../../../simhive/myo_sim" />
          <asset>
            <mesh name="tabletennis_table" file="../../envs/myo/assets/tabletennis_table.obj" />
          </asset>
        </mujoco>`,
    },
    ['myosuite/envs/myo/assets/tabletennis_table.obj'],
  );

  assert.equal(warning, null);
});

test('buildStandaloneImportAssetWarning treats nested folder-import asset paths as satisfying URDF mesh references', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      format: 'urdf',
      content: '<mesh filename="../meshes/base_link.dae" />',
    },
    ['robots/b2w_description/meshes/base_link.dae'],
  );

  assert.equal(warning, null);
});

test('buildStandaloneImportAssetWarning reports URDF mesh references that only exist under mismatched asset folders', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      name: 'google_barkour_v0/barkour_v0.urdf',
      format: 'urdf',
      content: '<mesh filename="meshes/body.stl" />',
    },
    ['google_barkour_v0/assets/body.stl'],
  );

  assert.deepEqual(warning, {
    missingAssetPaths: ['meshes/body.stl'],
  });
});

test('extractStandaloneImportAssetReferences includes URDF texture filenames', () => {
  const references = extractStandaloneImportAssetReferences({
    format: 'urdf',
    content: `
      <robot name="textured">
        <material name="painted">
          <texture filename="textures/paint.png" />
        </material>
        <link name="base_link">
          <visual>
            <geometry>
              <mesh filename="meshes/base_link.stl" />
            </geometry>
            <material name="painted" />
          </visual>
        </link>
      </robot>`,
  });

  assert.deepEqual(references, ['meshes/base_link.stl', 'textures/paint.png']);
});

test('buildStandaloneImportAssetWarning reports missing URDF textures alongside meshes', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      name: 'demo/robot.urdf',
      format: 'urdf',
      content: `
        <robot name="textured">
          <material name="painted">
            <texture filename="textures/paint.png" />
          </material>
          <link name="base_link">
            <visual>
              <geometry>
                <mesh filename="meshes/base_link.stl" />
              </geometry>
              <material name="painted" />
            </visual>
          </link>
        </robot>`,
    },
    ['demo/meshes/base_link.stl'],
  );

  assert.deepEqual(warning, {
    missingAssetPaths: ['textures/paint.png'],
  });
});

test('extractStandaloneImportAssetReferences resolves SDF gazebo material script textures', () => {
  const references = extractStandaloneImportAssetReferences(
    {
      name: 'demo/model.sdf',
      format: 'sdf',
      content: `
        <sdf version="1.7">
          <model name="demo_model">
            <link name="base_link">
              <visual name="visual">
                <geometry>
                  <mesh>
                    <uri>meshes/base_link.dae</uri>
                  </mesh>
                </geometry>
                <material>
                  <script>
                    <uri>materials/scripts</uri>
                    <name>Demo/Painted</name>
                  </script>
                </material>
              </visual>
            </link>
          </model>
        </sdf>`,
    },
    {
      allFileContents: {
        'demo/materials/scripts/demo.material': `
          material Demo/Painted
          {
            technique
            {
              pass
              {
                texture_unit
                {
                  texture ../textures/coat.png
                }
              }
            }
          }`,
      },
    },
  );

  assert.deepEqual(references, ['demo/materials/textures/coat.png', 'meshes/base_link.dae']);
});

test('buildStandaloneImportAssetWarning reports missing SDF gazebo material script textures', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      name: 'demo/model.sdf',
      format: 'sdf',
      content: `
        <sdf version="1.7">
          <model name="demo_model">
            <link name="base_link">
              <visual name="visual">
                <geometry>
                  <mesh>
                    <uri>meshes/base_link.dae</uri>
                  </mesh>
                </geometry>
                <material>
                  <script>
                    <uri>materials/scripts</uri>
                    <name>Demo/Painted</name>
                  </script>
                </material>
              </visual>
            </link>
          </model>
        </sdf>`,
    },
    ['demo/meshes/base_link.dae'],
    {
      allFileContents: {
        'demo/materials/scripts/demo.material': `
          material Demo/Painted
          {
            technique
            {
              pass
              {
                texture_unit
                {
                  texture ../textures/coat.png
                }
              }
            }
          }`,
      },
    },
  );

  assert.deepEqual(warning, {
    missingAssetPaths: ['demo/materials/textures/coat.png'],
  });
});

test('buildStandaloneImportAssetWarning tolerates renamed top-level package folders after import collisions', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://autokit/meshes/base_link.STL" />',
    },
    ['autokit (1)/meshes/base_link.STL'],
  );

  assert.equal(warning, null);
});
