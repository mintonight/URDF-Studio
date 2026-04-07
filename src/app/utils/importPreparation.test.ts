import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { prepareImportPayload, type ImportPreparationFileDescriptor } from './importPreparation.ts';
import { ensureWorkerXmlDomApis } from '@/app/workers/ensureWorkerXmlDomApis';
import { buildPreResolvedImportContentSignature } from './preResolvedImportSignature.ts';

ensureWorkerXmlDomApis(globalThis as typeof globalThis);

function createLooseFile(
  name: string,
  content: BlobPart,
  relativePath?: string,
  options?: FilePropertyBag,
): File {
  const file = new File([content], name, options);

  if (relativePath) {
    Object.defineProperty(file, 'webkitRelativePath', {
      value: relativePath,
      configurable: true,
    });
  }

  return file;
}

test('prepareImportPayload renames colliding loose imports while preserving file classifications', async () => {
  const files = [
    createLooseFile(
      'demo.urdf',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      'robot/demo.urdf',
    ),
    createLooseFile('base.stl', 'solid demo', 'robot/meshes/base.stl'),
    createLooseFile('M1.txt', '{"name":"M1"}', 'robot/motor library/Acme/M1.txt'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: ['robot/existing.urdf'],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'robot (1)/demo.urdf', format: 'urdf' },
      { name: 'robot (1)/meshes/base.stl', format: 'mesh' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['robot (1)/meshes/base.stl'],
  );
  assert.deepEqual(
    result.libraryFiles.map((file) => file.path),
    ['robot (1)/motor library/Acme/M1.txt'],
  );
});

test('prepareImportPayload scans zip bundles off the main classification path and skips hidden entries', async () => {
  const zip = new JSZip();
  zip.file('.hidden/ignored.urdf', '<robot name="ignored" />');
  zip.file(
    'robot/demo.urdf',
    `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
  );
  zip.file('robot/meshes/base.obj', 'o Mesh');
  zip.file('robot/textures/albedo.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('robot/motor library/Acme/M1.txt', '{"name":"M1"}');
  zip.file('robot/scene.usdc', new Uint8Array([80, 88, 82, 45, 85, 83, 68, 67, 1, 2, 3]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.equal(
    result.robotFiles.some((file) => file.name.includes('.hidden')),
    false,
  );
  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format, content: file.content }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      {
        name: 'robot/demo.urdf',
        format: 'urdf',
        content: `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      },
      { name: 'robot/meshes/base.obj', format: 'mesh', content: '' },
      { name: 'robot/scene.usdc', format: 'usd', content: '' },
      { name: 'robot/textures/albedo.png', format: 'mesh', content: '' },
    ],
  );
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'robot/meshes/base.obj',
    'robot/textures/albedo.png',
  ]);
  assert.deepEqual(
    result.libraryFiles.map((file) => file.path),
    ['robot/motor library/Acme/M1.txt'],
  );
  assert.deepEqual(
    result.usdSourceFiles.map((file) => file.name),
    ['robot/scene.usdc'],
  );
  assert.equal(result.usdSourceFiles[0].blob.size > 0, true);
});

test('prepareImportPayload exposes loose image assets in the browser file list', async () => {
  const files = [
    createLooseFile('poster.png', new Uint8Array([137, 80, 78, 71]), 'robot/textures/poster.png', {
      type: 'image/png',
    }),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles.map((file) => ({ name: file.name, format: file.format })),
    [{ name: 'robot/textures/poster.png', format: 'mesh' }],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['robot/textures/poster.png'],
  );
});

test('prepareImportPayload classifies motor-library.json as a library file', async () => {
  const files = [
    createLooseFile(
      'motor-library.json',
      JSON.stringify({
        Unitree: [
          {
            name: 'Unitree-Custom-X',
            armature: 0.1,
            velocity: 20,
            effort: 40,
          },
        ],
      }),
      'robot/motor-library.json',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.libraryFiles.map((file) => file.path),
    ['robot/motor-library.json'],
  );
  assert.equal(result.robotFiles.length, 0);
  assert.equal(result.assetFiles.length, 0);
});

test('prepareImportPayload keeps textual usd content available for downstream hydration', async () => {
  const usdText = `#usda 1.0
def Xform "robot"
{
}`;
  const usdFile = createLooseFile('scene.usd', usdText, 'scene/scene.usd');

  const result = await prepareImportPayload({
    files: [usdFile],
    existingPaths: [],
  });

  assert.equal(result.robotFiles.length, 1);
  assert.equal(result.robotFiles[0].name, 'scene/scene.usd');
  assert.equal(result.robotFiles[0].format, 'usd');
  assert.equal(result.robotFiles[0].content, usdText);
  assert.equal(result.usdSourceFiles.length, 1);
  assert.equal(await result.usdSourceFiles[0].blob.text(), usdText);
});

test('prepareImportPayload keeps large USDA sidecars blob-backed instead of eagerly decoding them', async () => {
  const rootUsdText = `#usda 1.0
(
    defaultPrim = "demo_robot"
)

def Xform "demo_robot"
{
    prepend references = @configuration/demo_base.usda@
}`;
  const largeBaseUsdText = `#usda 1.0\n${'def Mesh "part" {}\n'.repeat(80_000)}`;

  const files = [
    createLooseFile('demo_robot.usda', rootUsdText, 'robot/demo_robot.usda'),
    createLooseFile('demo_base.usda', largeBaseUsdText, 'robot/configuration/demo_base.usda'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'robot/demo_robot.usda');
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'robot/demo_robot.usda');
  assert.equal(result.preResolvedImports[0]?.result.status, 'needs_hydration');

  const rootFile = result.robotFiles.find((file) => file.name === 'robot/demo_robot.usda');
  const largeSidecarFile = result.robotFiles.find(
    (file) => file.name === 'robot/configuration/demo_base.usda',
  );

  assert.ok(rootFile, 'expected root USDA file to be present');
  assert.ok(largeSidecarFile, 'expected large USDA sidecar file to be present');
  assert.equal(rootFile?.content, rootUsdText);
  assert.equal(largeSidecarFile?.content, '');
  assert.equal(result.usdSourceFiles.length, 2);
});

test('prepareImportPayload fast-open mode skips pre-resolving the preferred URDF candidate', async () => {
  const files = [
    createLooseFile(
      'g1_29dof.urdf',
      `<?xml version="1.0"?>
<robot name="g1_description">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://g1_description/meshes/base_link.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'g1_description/g1_29dof.urdf',
    ),
    createLooseFile(
      'g1_29dof_with_hand.urdf',
      `<?xml version="1.0"?>
<robot name="g1_description">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://g1_description/meshes/base_link.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'g1_description/g1_29dof_with_hand.urdf',
    ),
    createLooseFile('base_link.stl', 'solid demo', 'g1_description/meshes/base_link.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'g1_description/g1_29dof.urdf');
  assert.deepEqual(result.preResolvedImports, []);
});

test('prepareImportPayload fast-open mode prefers MJCF over a non-self-contained URDF sidecar', async () => {
  const files = [
    createLooseFile(
      'barkour_v0.urdf',
      `<?xml version="1.0"?>
<robot name="barkour">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/body.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'google_barkour_v0/barkour_v0.urdf',
    ),
    createLooseFile(
      'barkour_v0.xml',
      `<?xml version="1.0"?>
<mujoco model="barkour v0">
  <compiler meshdir="assets" />
  <asset>
    <mesh name="body" file="body.stl" />
  </asset>
  <worldbody>
    <body name="base_link">
      <geom type="mesh" mesh="body" />
    </body>
  </worldbody>
</mujoco>`,
      'google_barkour_v0/barkour_v0.xml',
    ),
    createLooseFile('body.stl', 'solid body', 'google_barkour_v0/assets/body.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'google_barkour_v0/barkour_v0.xml');
  assert.deepEqual(result.preResolvedImports, []);
});

test('prepareImportPayload fast-open mode picks the root USDA file without pre-resolving it', async () => {
  const files = [
    createLooseFile(
      'go2_description.usda',
      `#usda 1.0
(
    defaultPrim = "go2_description"
)

def Xform "go2_description"
{
    prepend references = @configuration/go2_description_base.usda@
}`,
      'go2_description/urdf/go2_description.usda',
    ),
    createLooseFile(
      'go2_description_base.usda',
      `#usda 1.0
def Scope "configuration" {}`,
      'go2_description/urdf/configuration/go2_description_base.usda',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'go2_description/urdf/go2_description.usda');
  assert.deepEqual(result.preResolvedImports, []);
});

test('prepareImportPayload synthesizes a bundle root when loose robot folders arrive without their outer directory', async () => {
  const files = [
    createLooseFile(
      'demo.urdf',
      `<?xml version="1.0"?>
<robot name="demo_pkg">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://demo_pkg/meshes/base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'urdf/demo.urdf',
    ),
    createLooseFile(
      'mjmodel.xml',
      `<?xml version="1.0"?>
<mujoco model="demo_pkg">
  <compiler meshdir="../meshes" />
  <asset>
    <mesh name="base_mesh" file="base.stl" />
  </asset>
</mujoco>`,
      'mjcf/mjmodel.xml',
    ),
    createLooseFile('base.stl', 'solid demo', 'meshes/base.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'demo_pkg/meshes/base.stl', format: 'mesh' },
      { name: 'demo_pkg/mjcf/mjmodel.xml', format: 'mjcf' },
      { name: 'demo_pkg/urdf/demo.urdf', format: 'urdf' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['demo_pkg/meshes/base.stl'],
  );
  assert.equal(result.preferredFileName, 'demo_pkg/urdf/demo.urdf');
});

test('prepareImportPayload synthesizes a bundle root for rootless gazebo zip bundles with thumbnails', async () => {
  const zip = new JSZip();
  zip.file(
    'model.sdf',
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <mesh>
            <uri>model://NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/meshes/base_link.dae</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
  );
  zip.file(
    'materials/scripts/demo.material',
    `material Demo/Diffuse
{
}`,
  );
  zip.file('materials/textures/demo.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('meshes/base_link.dae', '<dae />');
  zip.file('thumbnails/preview.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY.zip', {
    type: 'application/zip',
  });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      {
        name: 'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/materials/textures/demo.png',
        format: 'mesh',
      },
      {
        name: 'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/meshes/base_link.dae',
        format: 'mesh',
      },
      {
        name: 'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/model.sdf',
        format: 'sdf',
      },
      {
        name: 'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/thumbnails/preview.png',
        format: 'mesh',
      },
    ],
  );
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/meshes/base_link.dae',
  ]);
  assert.deepEqual(result.deferredAssetFiles.map((file) => file.name).sort(), [
    'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/materials/textures/demo.png',
    'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/thumbnails/preview.png',
  ]);
  assert.deepEqual(
    result.textFiles.map((file) => file.path),
    ['NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/materials/scripts/demo.material'],
  );
  assert.equal(
    result.preferredFileName,
    'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/model.sdf',
  );
});

test('prepareImportPayload preserves explicit relativePath metadata when files are worker-cloned', async () => {
  const files: ImportPreparationFileDescriptor[] = [
    {
      file: createLooseFile('mjmodel.xml', '<mujoco model="demo_pkg" />'),
      relativePath: 'casbot mini/mjcf/mjmodel.xml',
    },
    {
      file: createLooseFile('pelvis_link.STL', 'solid demo'),
      relativePath: 'casbot mini/meshes/pelvis_link.STL',
    },
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(result.robotFiles.map((file) => file.name).sort(), [
    'casbot mini/meshes/pelvis_link.STL',
    'casbot mini/mjcf/mjmodel.xml',
  ]);
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['casbot mini/meshes/pelvis_link.STL'],
  );
});

test('prepareImportPayload eagerly hydrates MJCF deferred textures required by the preferred model', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/bin.xml',
    `<?xml version="1.0"?>
<mujoco model="demo_bin">
  <asset>
    <mesh name="bin_mesh" file="meshes/bin.stl" />
    <texture name="bin_texture" type="2d" file="../demo/common/textures/metal0.png" />
    <material name="bin_material" texture="bin_texture" />
  </asset>
  <worldbody>
    <body name="bin_body">
      <geom type="mesh" mesh="bin_mesh" material="bin_material" />
    </body>
  </worldbody>
</mujoco>`,
  );
  zip.file('demo/meshes/bin.stl', 'solid demo');
  zip.file('demo/common/textures/metal0.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('demo/thumbnails/preview.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo/bin.xml');
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'demo/common/textures/metal0.png',
    'demo/meshes/bin.stl',
  ]);
  assert.deepEqual(
    result.deferredAssetFiles.map((file) => file.name),
    ['demo/thumbnails/preview.png'],
  );
});

test('prepareImportPayload eagerly hydrates URDF deferred textures referenced by the preferred model', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/robot.urdf',
    `<?xml version="1.0"?>
<robot name="demo_robot">
  <material name="painted">
    <texture filename="textures/paint.png" />
  </material>
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/base.stl" />
      </geometry>
      <material name="painted" />
    </visual>
  </link>
</robot>`,
  );
  zip.file('demo/meshes/base.stl', 'solid demo');
  zip.file('demo/textures/paint.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('demo/docs/preview.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo/robot.urdf');
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'demo/meshes/base.stl',
    'demo/textures/paint.png',
  ]);
  assert.deepEqual(
    result.deferredAssetFiles.map((file) => file.name),
    ['demo/docs/preview.png'],
  );
});

test('prepareImportPayload eagerly hydrates SDF gazebo material script textures required by the preferred model', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/model.sdf',
    `<?xml version="1.0"?>
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
  );
  zip.file(
    'demo/materials/scripts/demo.material',
    `material Demo/Painted
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
  );
  zip.file('demo/meshes/base_link.dae', '<dae />');
  zip.file('demo/materials/textures/coat.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('demo/docs/preview.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo/model.sdf');
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'demo/materials/textures/coat.png',
    'demo/meshes/base_link.dae',
  ]);
  assert.deepEqual(
    result.textFiles.map((file) => file.path),
    ['demo/materials/scripts/demo.material'],
  );
  assert.deepEqual(
    result.deferredAssetFiles.map((file) => file.name),
    ['demo/docs/preview.png'],
  );
});

test('prepareImportPayload prefixes rootless ROS package contents using package asset roots', async () => {
  const files = [
    createLooseFile(
      'valkyrie_sim.urdf',
      `<?xml version="1.0"?>
<robot name="valkyrie">
  <link name="pelvis">
    <visual>
      <geometry>
        <mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'robots/valkyrie_sim.urdf',
    ),
    createLooseFile('pelvis.dae', '<dae />', 'meshes/pelvis/pelvis.dae'),
    createLooseFile(
      'pelvistexture.png',
      new Uint8Array([137, 80, 78, 71]),
      'materials/textures/pelvistexture.png',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'val_description/model/materials/textures/pelvistexture.png', format: 'mesh' },
      { name: 'val_description/model/meshes/pelvis/pelvis.dae', format: 'mesh' },
      { name: 'val_description/model/robots/valkyrie_sim.urdf', format: 'urdf' },
    ],
  );
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'val_description/model/materials/textures/pelvistexture.png',
    'val_description/model/meshes/pelvis/pelvis.dae',
  ]);
  assert.equal(result.preferredFileName, 'val_description/model/robots/valkyrie_sim.urdf');
});

test('prepareImportPayload prefixes rootless package assets when only the package-dependent definition sits at the root', async () => {
  const files = [
    createLooseFile(
      'robot.urdf',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://demo_pkg/meshes/base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'robot.urdf',
    ),
    createLooseFile('base.stl', 'solid demo', 'meshes/base.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'demo_pkg/meshes/base.stl', format: 'mesh' },
      { name: 'demo_pkg/robot.urdf', format: 'urdf' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['demo_pkg/meshes/base.stl'],
  );
});

test('prepareImportPayload keeps package-rooted assets stable when the referenced package root is already present', async () => {
  const files = [
    createLooseFile(
      'robot.urdf',
      `<?xml version="1.0"?>
<robot name="sigmaban2019_urdf">
  <link name="tronc">
    <visual>
      <geometry>
        <mesh filename="package://assets/merged/tronc_visual.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'robot.urdf',
    ),
    createLooseFile('tronc_visual.stl', 'solid tronc', 'assets/merged/tronc_visual.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'assets/merged/tronc_visual.stl', format: 'mesh' },
      { name: 'robot.urdf', format: 'urdf' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['assets/merged/tronc_visual.stl'],
  );
});

test('prepareImportPayload prefers MJCF when a mixed MuJoCo folder ships an export-only URDF sidecar', async () => {
  const files = [
    createLooseFile(
      'barkour_v0.urdf',
      `<?xml version="1.0"?>
<robot name="barkour">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/body.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'google_barkour_v0/barkour_v0.urdf',
    ),
    createLooseFile(
      'barkour_v0.xml',
      `<?xml version="1.0"?>
<mujoco model="barkour v0">
  <compiler meshdir="assets" />
  <asset>
    <mesh name="body" file="body.stl" />
  </asset>
  <worldbody>
    <body name="base_link">
      <geom type="mesh" mesh="body" />
    </body>
  </worldbody>
</mujoco>`,
      'google_barkour_v0/barkour_v0.xml',
    ),
    createLooseFile('body.stl', 'solid body', 'google_barkour_v0/assets/body.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'google_barkour_v0/assets/body.stl', format: 'mesh' },
      { name: 'google_barkour_v0/barkour_v0.urdf', format: 'urdf' },
      { name: 'google_barkour_v0/barkour_v0.xml', format: 'mjcf' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['google_barkour_v0/assets/body.stl'],
  );
  assert.equal(result.preferredFileName, 'google_barkour_v0/barkour_v0.xml');
});

test('prepareImportPayload pre-resolves standalone urdf imports for immediate loading', async () => {
  const files = [
    createLooseFile(
      'demo.xml',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      'robot/demo.xml',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.robotFiles.length, 1);
  assert.equal(result.robotFiles[0]?.format, 'urdf');
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'robot/demo.xml');
  assert.equal(result.preResolvedImports[0]?.format, 'urdf');
  assert.equal(
    result.preResolvedImports[0]?.contentSignature,
    buildPreResolvedImportContentSignature(files[0]?.text ? await files[0].text() : ''),
  );
  assert.equal(result.preResolvedImports[0]?.result.status, 'ready');
  if (result.preResolvedImports[0]?.result.status !== 'ready') {
    assert.fail('Expected pre-resolved URDF import result to be ready');
  }
  assert.equal(result.preResolvedImports[0].result.robotData.name, 'demo');
  assert.equal(result.preResolvedImports[0].result.robotData.rootLinkId, 'base_link');
  assert.equal(result.preResolvedImports[0].result.resolvedUrdfSourceFilePath, null);
});

test('prepareImportPayload pre-resolves only the preferred robot file to keep worker responses compact', async () => {
  const files = [
    createLooseFile(
      'primary.urdf',
      `<?xml version="1.0"?>
<robot name="primary">
  <link name="base_link" />
</robot>`,
      'robot/primary.urdf',
    ),
    createLooseFile(
      'secondary.urdf',
      `<?xml version="1.0"?>
<robot name="secondary">
  <link name="secondary_link" />
</robot>`,
      'robot/secondary.urdf',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'robot/primary.urdf');
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'robot/primary.urdf');
  assert.equal(result.preResolvedImports[0]?.format, 'urdf');
});

test('prepareImportPayload pre-resolves preferred mjcf imports for immediate loading', async () => {
  const files = [
    createLooseFile(
      'mjmodel.xml',
      `<?xml version="1.0"?>
<mujoco model="demo_mjcf">
  <worldbody>
    <body name="base">
      <geom type="box" size="0.1 0.1 0.1" />
    </body>
  </worldbody>
</mujoco>`,
      'robot/mjcf/mjmodel.xml',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'robot/mjcf/mjmodel.xml');
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'robot/mjcf/mjmodel.xml');
  assert.equal(result.preResolvedImports[0]?.format, 'mjcf');
  assert.equal(result.preResolvedImports[0]?.result.status, 'ready');
  if (result.preResolvedImports[0]?.result.status !== 'ready') {
    assert.fail('Expected pre-resolved MJCF import result to be ready');
  }
  assert.equal(result.preResolvedImports[0].result.robotData.name, 'demo_mjcf');
});

test('prepareImportPayload pre-resolves xacro imports with package-local includes', async () => {
  const files = [
    createLooseFile(
      'robot.xacro',
      `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo_xacro">
  <xacro:include filename="parts/link.xacro" />
</robot>`,
      'demo_pkg/xacro/robot.xacro',
    ),
    createLooseFile(
      'link.xacro',
      `<robot name="included_links">
  <link name="base_link" />
</robot>`,
      'demo_pkg/xacro/parts/link.xacro',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  const rootEntry = result.preResolvedImports.find(
    (entry) => entry.fileName === 'demo_pkg/xacro/robot.xacro',
  );
  assert.ok(rootEntry, 'Expected root xacro import to be pre-resolved');
  assert.equal(result.preResolvedImports.filter((entry) => entry.format === 'xacro').length, 1);
  assert.equal(rootEntry?.format, 'xacro');
  assert.equal(rootEntry?.result.status, 'ready');
  if (!rootEntry || rootEntry.result.status !== 'ready') {
    assert.fail('Expected pre-resolved xacro import result to be ready');
  }
  assert.equal(rootEntry.result.robotData.name, 'demo_xacro');
  assert.equal(rootEntry.result.robotData.rootLinkId, 'base_link');
  assert.equal(rootEntry.result.resolvedUrdfSourceFilePath, 'demo_pkg/xacro/robot.xacro');
});

test('prepareImportPayload pre-resolves preferred usd imports as hydration-ready placeholders', async () => {
  const usdText = `#usda 1.0
def Xform "robot"
{
}`;
  const files = [createLooseFile('scene.usd', usdText, 'scene/scene.usd')];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'scene/scene.usd');
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'scene/scene.usd');
  assert.equal(result.preResolvedImports[0]?.format, 'usd');
  assert.equal(result.preResolvedImports[0]?.result.status, 'needs_hydration');
});

test('prepareImportPayload classifies sdf bundles as robot definition files', async () => {
  const files = [
    createLooseFile(
      'model.sdf',
      `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="bus_stop">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <mesh>
            <uri>model://bus_stop/meshes/base_link.dae</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
      'bus_stop/model.sdf',
    ),
    createLooseFile('base_link.dae', '<dae />', 'bus_stop/meshes/base_link.dae'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'bus_stop/meshes/base_link.dae', format: 'mesh' },
      { name: 'bus_stop/model.sdf', format: 'sdf' },
    ],
  );
});

test('prepareImportPayload keeps gazebo material scripts as auxiliary text files', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/model.sdf',
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo">
    <link name="base_link" />
  </model>
</sdf>`,
  );
  zip.file(
    'demo/materials/scripts/demo.material',
    `material Demo/Diffuse
{
  technique
  {
    pass
    {
      texture_unit
      {
        texture demo.png
      }
    }
  }
}`,
  );
  zip.file('demo/materials/textures/demo.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.deepEqual(
    result.textFiles.map((file) => file.path),
    ['demo/materials/scripts/demo.material'],
  );
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'demo/materials/textures/demo.png',
  ]);
});

test('prepareImportPayload keeps xacro gazebo sidecars as auxiliary text files', async () => {
  const zip = new JSZip();
  zip.file(
    'demo_pkg/xacro/robot.xacro',
    `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo_pkg">
  <xacro:include filename="$(find demo_pkg)/urdf/demo.gazebo" />
  <link name="base_link" />
</robot>`,
  );
  zip.file(
    'demo_pkg/urdf/demo.gazebo',
    `<gazebo reference="base_link">
  <material>Gazebo/Orange</material>
</gazebo>`,
  );

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo_pkg/xacro/robot.xacro');
  assert.deepEqual(
    result.textFiles.map((file) => file.path),
    ['demo_pkg/urdf/demo.gazebo'],
  );
});

test('prepareImportPayload skips gazebo material sidecars for usd-only bundles', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/scene.usda',
    `#usda 1.0
(
    defaultPrim = "demo"
)

def Xform "demo"
{
}`,
  );
  zip.file(
    'demo/materials/scripts/demo.material',
    `material Demo/Diffuse
{
}`,
  );

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.deepEqual(result.textFiles, []);
  assert.equal(result.preferredFileName, 'demo/scene.usda');
});

test('prepareImportPayload keeps loose image assets while skipping unrelated loose text files', async () => {
  const files = [
    createLooseFile(
      'demo.urdf',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      'robot/demo.urdf',
    ),
    createLooseFile('README.md', '# Demo robot', 'robot/README.md'),
    createLooseFile('LICENSE', 'Apache-2.0', 'robot/LICENSE'),
    createLooseFile('preview.png', new Uint8Array([137, 80, 78, 71]), 'robot/docs/preview.png'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'robot/demo.urdf', format: 'urdf' },
      { name: 'robot/docs/preview.png', format: 'mesh' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['robot/docs/preview.png'],
  );
  assert.deepEqual(result.textFiles, []);
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'robot/demo.urdf');
});
