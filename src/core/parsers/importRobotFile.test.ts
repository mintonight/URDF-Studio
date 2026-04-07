import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { GeometryType, type RobotData, type RobotFile } from '@/types';
import { parseURDF, injectGazeboTags } from './index';
import { createUsdPlaceholderRobotData, resolveRobotFileData } from './importRobotFile';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

function pathFromMyosuiteFixture(relativePath: string): string {
  return path.join('test', 'myosuite-main', ...relativePath.split('/'));
}

function createUsdFile(name = 'robots/demo/demo.usd'): RobotFile {
  return {
    name,
    content: '',
    format: 'usd',
  };
}

function createSdfFile(name = 'robots/demo/model.sdf'): RobotFile {
  return {
    name,
    content: `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo_sdf">
    <link name="base_link">
      <visual name="visual">
        <geometry>
          <mesh>
            <uri>model://demo/meshes/base_link.dae</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
    format: 'sdf' as unknown as RobotFile['format'],
  };
}

function createResolvedUsdRobotData(name = 'demo'): RobotData {
  return {
    name,
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
    },
    joints: {},
    rootLinkId: 'base_link',
  };
}

test('resolveRobotFileData returns cached USD robot data when provided', () => {
  const usdRobotData = createResolvedUsdRobotData('cached_usd_robot');

  const result = resolveRobotFileData(createUsdFile(), {
    usdRobotData,
  });

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected USD import result to be ready');
  }
  assert.equal(result.robotData.name, 'cached_usd_robot');
  assert.equal(result.robotData.rootLinkId, 'base_link');
  assert.deepEqual(result.robotData.links, usdRobotData.links);
});

test('resolveRobotFileData syncs cached USD material colors back onto link visuals', () => {
  const baseRobotData = createResolvedUsdRobotData('cached_usd_robot');
  const usdRobotData: RobotData = {
    ...baseRobotData,
    links: {
      base_link: {
        ...baseRobotData.links.base_link,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.3, z: 0.4 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      },
    },
    materials: {
      base_link: { color: '#12ab34' },
    },
  };

  const result = resolveRobotFileData(createUsdFile(), {
    usdRobotData,
  });

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected USD import result to be ready');
  }
  assert.equal(result.robotData.links.base_link.visual.color, '#12ab34');
  assert.equal(result.robotData.materials?.base_link?.color, '#12ab34');
});

test('resolveRobotFileData returns needs_hydration for USD when runtime robot data is unavailable', () => {
  const result = resolveRobotFileData(createUsdFile());

  assert.equal(result.status, 'needs_hydration');
  assert.equal(result.format, 'usd');
});

test('resolveRobotFileData returns a ready result for mesh files', () => {
  const result = resolveRobotFileData({
    name: 'meshes/demo/link.stl',
    content: '',
    format: 'mesh',
  });

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected mesh import result to be ready');
  }
  assert.equal(result.robotData.name, 'link');
  assert.equal(result.robotData.links.base_link?.visual.meshPath, 'meshes/demo/link.stl');
});

test('resolveRobotFileData keeps image asset previews on the mesh path with a neutral texture tint', () => {
  const result = resolveRobotFileData({
    name: 'textures/demo/poster.png',
    content: '',
    format: 'mesh',
  });

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected image asset preview import result to be ready');
  }
  assert.equal(result.robotData.links.base_link?.visual.meshPath, 'textures/demo/poster.png');
  assert.equal(result.robotData.links.base_link?.visual.color, '#ffffff');
});

test('resolveRobotFileData keeps all Aliengo leg links when importing the generated URDF fixture', () => {
  const fixturePath = 'test/unitree_ros/robots/aliengo_description/urdf/aliengo.urdf';
  const result = resolveRobotFileData({
    name: fixturePath,
    content: fs.readFileSync(fixturePath, 'utf8'),
    format: 'urdf',
  });

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected Aliengo URDF import result to be ready');
  }

  const expectedLegLinks = [
    'FL_hip',
    'FL_thigh',
    'FL_calf',
    'FL_foot',
    'FR_hip',
    'FR_thigh',
    'FR_calf',
    'FR_foot',
    'RL_hip',
    'RL_thigh',
    'RL_calf',
    'RL_foot',
    'RR_hip',
    'RR_thigh',
    'RR_calf',
    'RR_foot',
  ];

  for (const linkId of expectedLegLinks) {
    assert.ok(
      result.robotData.links[linkId],
      `Expected imported Aliengo robot to include ${linkId}`,
    );
  }
});

test('resolveRobotFileData restores empty URDF inline content from exact contextual sources', () => {
  const contextualUrdf = '<robot name="contextual"><link name="base_link" /></robot>';
  const result = resolveRobotFileData(
    {
      name: 'robots/demo/demo.urdf',
      content: '',
      format: 'urdf',
    },
    {
      availableFiles: [
        {
          name: 'robots/demo/demo.urdf',
          content: '<robot name="stale"><link name="stale_link" /></robot>',
          format: 'urdf',
        },
      ],
      allFileContents: {
        '/robots/demo/demo.urdf': contextualUrdf,
      },
    },
  );

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected contextual URDF import result to be ready');
  }
  assert.equal(result.robotData.name, 'contextual');
  assert.ok(result.robotData.links.base_link);
  assert.equal(result.resolvedUrdfContent, contextualUrdf);
  assert.equal(result.resolvedUrdfSourceFilePath, '/robots/demo/demo.urdf');
});

test('resolveRobotFileData returns a ready result for sdf files', () => {
  const result = resolveRobotFileData(createSdfFile());

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected sdf import result to be ready');
  }
  assert.equal(result.robotData.name, 'demo_sdf');
  assert.equal(result.robotData.links.base_link?.visual.type, GeometryType.MESH);
  assert.equal(result.robotData.links.base_link?.visual.meshPath, 'demo/meshes/base_link.dae');
});

test('resolveRobotFileData forwards auxiliary text files to the sdf parser', () => {
  const result = resolveRobotFileData(
    {
      name: 'robots/demo/model.sdf',
      content: `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo_sdf">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <box>
            <size>1 2 3</size>
          </box>
        </geometry>
        <material>
          <script>
            <uri>model://demo/materials/scripts</uri>
            <uri>model://demo/materials/textures</uri>
            <name>Demo/Diffuse</name>
          </script>
        </material>
      </visual>
    </link>
  </model>
</sdf>`,
      format: 'sdf' as unknown as RobotFile['format'],
    },
    {
      allFileContents: {
        'robots/demo/materials/scripts/demo.material': `material Demo/Diffuse
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
      },
    },
  );

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected sdf import result to be ready');
  }
  assert.equal(result.robotData.materials?.base_link?.texture, 'demo/materials/textures/demo.png');
});

test('resolveRobotFileData expands included sdf models from bundled file contents', () => {
  const result = resolveRobotFileData(
    {
      name: 'robots/assembly/model.sdf',
      content: `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="assembly">
    <include>
      <name>arm</name>
      <uri>model://arm</uri>
    </include>
    <include>
      <name>tool</name>
      <pose>2 0 0 0 0 0</pose>
      <uri>model://tool</uri>
    </include>
    <joint name="mount" type="fixed">
      <parent>arm::tip</parent>
      <child>tool::base</child>
    </joint>
  </model>
</sdf>`,
      format: 'sdf' as unknown as RobotFile['format'],
    },
    {
      allFileContents: {
        'robots/arm/model.sdf': `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="arm">
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
    <link name="tip">
      <pose>1 0 0 0 0 0</pose>
      <visual name="body">
        <geometry>
          <box>
            <size>0.5 0.5 0.5</size>
          </box>
        </geometry>
      </visual>
    </link>
    <joint name="arm_joint" type="fixed">
      <parent>base</parent>
      <child>tip</child>
    </joint>
  </model>
</sdf>`,
        'robots/tool/model.sdf': `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="tool">
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>0.25 0.25 0.25</size>
          </box>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
      },
    },
  );

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected included sdf import result to be ready');
  }
  assert.ok(result.robotData.links['arm::base']);
  assert.ok(result.robotData.links['tool::base']);
  assert.equal(result.robotData.joints.mount?.parentLinkId, 'arm::tip');
  assert.equal(result.robotData.joints.mount?.childLinkId, 'tool::base');
  assert.deepEqual(result.robotData.joints.mount?.origin.xyz, { x: 1, y: 0, z: 0 });
});

test('resolveRobotFileData returns a parse error when XML parser APIs are unavailable', () => {
  const previousDomParser = globalThis.DOMParser;

  try {
    delete globalThis.DOMParser;

    const result = resolveRobotFileData(createSdfFile());
    assert.equal(result.status, 'error');
    if (result.status !== 'error') {
      assert.fail('Expected missing XML parser APIs to return a parse error');
    }
    assert.equal(result.reason, 'parse_failed');
    assert.match(result.message ?? '', /robots\/demo\/model\.sdf/);
  } finally {
    globalThis.DOMParser = previousDomParser;
  }
});

test('resolveRobotFileData keeps file context on malformed URDF imports', () => {
  const result = resolveRobotFileData({
    name: 'robots/demo/broken.urdf',
    content: '<robot name="broken">',
    format: 'urdf',
  });

  assert.equal(result.status, 'error');
  if (result.status !== 'error') {
    assert.fail('Expected malformed URDF import result to be an error');
  }
  assert.equal(result.reason, 'parse_failed');
  assert.match(result.message ?? '', /URDF file "robots\/demo\/broken\.urdf"/);
});

test('resolveRobotFileData does not hide malformed URDF inline content behind contextual truth', () => {
  const result = resolveRobotFileData(
    {
      name: 'robots/demo/broken.urdf',
      content: '<robot name="broken">',
      format: 'urdf',
    },
    {
      allFileContents: {
        'robots/demo/broken.urdf': '<robot name="truth"><link name="base_link" /></robot>',
      },
    },
  );

  assert.equal(result.status, 'error');
  if (result.status !== 'error') {
    assert.fail('Expected malformed inline URDF import result to remain an error');
  }
  assert.equal(result.reason, 'parse_failed');
});

test('resolveRobotFileData returns an error result for unsupported formats', () => {
  const result = resolveRobotFileData({
    name: 'robots/demo/invalid.txt',
    content: '',
    format: 'unsupported' as unknown as RobotFile['format'],
  });

  assert.equal(result.status, 'error');
  if (result.status !== 'error') {
    assert.fail('Expected unsupported import result to be an error');
  }
  assert.equal(String(result.format), 'unsupported');
  assert.equal(result.reason, 'unsupported_format');
  assert.match(result.message ?? '', /robots\/demo\/invalid\.txt/);
});

test('resolveRobotFileData prefers packaged URDF truth for standalone xacro entries', () => {
  const result = resolveRobotFileData(
    {
      name: 'robots/b2w_description/xacro/robot.xacro',
      content:
        '<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="broken"><link name="wrong_link" /></robot>',
      format: 'xacro',
    },
    {
      availableFiles: [
        {
          name: 'robots/b2w_description/urdf/b2w_description.urdf',
          content: '<robot name="b2w_truth"><link name="truth_link" /></robot>',
          format: 'urdf',
        },
      ],
    },
  );

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected standalone xacro import result to be ready');
  }
  assert.equal(result.robotData.name, 'b2w_truth');
  assert.ok(result.robotData.links.truth_link);
  assert.equal(result.robotData.links.wrong_link, undefined);
  assert.equal(
    result.resolvedUrdfContent,
    '<robot name="b2w_truth"><link name="truth_link" /></robot>',
  );
  assert.equal(
    result.resolvedUrdfSourceFilePath,
    'robots/b2w_description/urdf/b2w_description.urdf',
  );
});

test('resolveRobotFileData expands xacro include sidecars with non-xacro extensions', () => {
  const result = resolveRobotFileData(
    {
      name: 'robots/demo_pkg/xacro/robot.xacro',
      content: `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo_pkg">
  <xacro:include filename="$(find demo_pkg)/urdf/demo.gazebo" />
  <link name="base_link" />
</robot>`,
      format: 'xacro',
    },
    {
      allFileContents: {
        'robots/demo_pkg/urdf/demo.gazebo': `<gazebo reference="base_link">
  <material>Gazebo/Orange</material>
</gazebo>`,
      },
    },
  );

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected xacro import result with gazebo sidecar include to be ready');
  }
  assert.equal(result.robotData.name, 'demo_pkg');
  assert.ok(result.robotData.links.base_link);
  assert.match(result.resolvedUrdfContent ?? '', /<gazebo reference="base_link">/);
});

test('resolveRobotFileData classifies linkless xacro fragments as source-only previews', () => {
  const result = resolveRobotFileData({
    name: 'robots/demo/xacro/gazebo.xacro',
    content: '<gazebo reference="base_link"><material>Gazebo/Orange</material></gazebo>',
    format: 'xacro',
  });

  assert.equal(result.status, 'error');
  if (result.status !== 'error') {
    assert.fail('Expected source-only xacro fragment import result to be an error');
  }
  assert.equal(result.reason, 'source_only_fragment');
});

test('resolveRobotFileData classifies worldbody-free MJCF fragments as source-only previews', () => {
  const result = resolveRobotFileData({
    name: 'robots/demo/mjcf/keyframes.xml',
    content: `<mujoco>
  <keyframe>
    <key name="home" qpos="0 0 0" />
  </keyframe>
</mujoco>`,
    format: 'mjcf',
  });

  assert.equal(result.status, 'error');
  if (result.status !== 'error') {
    assert.fail('Expected source-only MJCF fragment import result to be an error');
  }
  assert.equal(result.reason, 'source_only_fragment');
});

test('resolveRobotFileData classifies mujocoinclude MJCF assets as source-only previews', () => {
  const result = resolveRobotFileData({
    name: 'myosuite/simhive/MPL_sim/assets/simpleHandR_assets.xml',
    content: fs.readFileSync(
      'test/myosuite-main/myosuite/simhive/MPL_sim/assets/simpleHandR_assets.xml',
      'utf8',
    ),
    format: 'mjcf',
  });

  assert.equal(result.status, 'error');
  if (result.status !== 'error') {
    assert.fail('Expected mujocoinclude MJCF asset import result to be an error');
  }
  assert.equal(result.reason, 'source_only_fragment');
});

test('resolveRobotFileData classifies bare MJCF body fragments as source-only previews', () => {
  const result = resolveRobotFileData({
    name: 'myosuite/simhive/furniture_sim/bin/bin_body.xml',
    content: '<body name="bin"><geom type="box" size="0.1 0.1 0.1" /></body>',
    format: 'mjcf',
  });

  assert.equal(result.status, 'error');
  if (result.status !== 'error') {
    assert.fail('Expected MJCF body fragment import result to be an error');
  }
  assert.equal(result.reason, 'source_only_fragment');
});

test('resolveRobotFileData surfaces missing MJCF include dependencies as parse errors', () => {
  const file: RobotFile = {
    name: 'robots/demo/scene.xml',
    content: `<mujoco model="broken-include">
  <include file="missing.xml" />
  <worldbody>
    <body name="base_link" />
  </worldbody>
</mujoco>`,
    format: 'mjcf',
  };

  const result = resolveRobotFileData(file, {
    availableFiles: [file],
  });

  assert.equal(result.status, 'error');
  if (result.status !== 'error') {
    assert.fail('Expected MJCF with a missing include to fail import');
  }
  assert.equal(result.reason, 'parse_failed');
  assert.match(result.message ?? '', /missing\.xml/);
});

test('resolveRobotFileData surfaces unresolved MyoSuite OBJECT_NAME templates as actionable parse errors', () => {
  const supportFiles = [
    'myosuite/envs/myo/assets/hand/myohand_object.xml',
    'myosuite/envs/myo/assets/hand/myohand_tabletop.xml',
    'myosuite/simhive/object_sim/common.xml',
    'myosuite/simhive/myo_sim/hand/assets/myohand_assets.xml',
    'myosuite/simhive/myo_sim/hand/assets/myohand_body.xml',
    'myosuite/simhive/furniture_sim/simpleTable/simpleTable_asset.xml',
    'myosuite/simhive/furniture_sim/simpleTable/simpleGraniteTable_body.xml',
  ].map((relativePath) => ({
    name: pathFromMyosuiteFixture(relativePath),
    content: fs.readFileSync(pathFromMyosuiteFixture(relativePath), 'utf8'),
    format: 'mjcf' as const,
  }));

  const file = supportFiles[0]!;

  const result = resolveRobotFileData(file, {
    availableFiles: supportFiles,
  });

  assert.equal(result.status, 'error');
  if (result.status !== 'error') {
    assert.fail('Expected unresolved OBJECT_NAME template import to fail');
  }
  assert.equal(result.reason, 'parse_failed');
  assert.match(result.message ?? '', /OBJECT_NAME/);
  assert.match(result.message ?? '', /concrete object directory/);
});

test('resolveRobotFileData can enforce MJCF external asset validation before parse-ready import', () => {
  const file: RobotFile = {
    name: 'robots/demo/paddle.xml',
    content: `<mujoco model="paddle">
  <compiler meshdir="assets" texturedir="textures" />
  <asset>
    <mesh name="paddle_mesh" file="paddle.obj" />
    <texture name="paddle_tex" type="2d" file="paddle.png" />
  </asset>
  <worldbody>
    <body name="base_link">
      <geom type="mesh" mesh="paddle_mesh" />
    </body>
  </worldbody>
</mujoco>`,
    format: 'mjcf',
  };

  const result = resolveRobotFileData(file, {
    availableFiles: [file],
    assets: {
      'robots/demo/textures/paddle.png': 'blob:texture',
    },
    mjcfExternalAssetValidation: 'always',
  });

  assert.equal(result.status, 'error');
  if (result.status !== 'error') {
    assert.fail('Expected MJCF with a missing mesh asset to fail strict import validation');
  }
  assert.equal(result.reason, 'parse_failed');
  assert.match(result.message ?? '', /robots\/demo\/assets\/paddle\.obj/);
});

test('resolveRobotFileData imports the myosuite sally scene when support files are available', () => {
  const supportFiles = [
    'myosuite/simhive/MPL_sim/scenes/sally.xml',
    'myosuite/simhive/MPL_sim/scenes/basic_scene.xml',
    'myosuite/simhive/MPL_sim/assets/arms_assets.xml',
    'myosuite/simhive/MPL_sim/assets/simpleHandR_assets.xml',
    'myosuite/simhive/MPL_sim/assets/simpleHandL_assets.xml',
    'myosuite/simhive/MPL_sim/assets/arms_chain.xml',
    'myosuite/simhive/MPL_sim/assets/simpleHandR_chain.xml',
    'myosuite/simhive/MPL_sim/assets/simpleHandL_chain.xml',
  ].map((relativePath) => ({
    name: relativePath,
    content: fs.readFileSync(pathFromMyosuiteFixture(relativePath), 'utf8'),
    format: 'mjcf' as const,
  }));

  const sceneFile = supportFiles.find(
    (file) => file.name === 'myosuite/simhive/MPL_sim/scenes/sally.xml',
  );
  assert.ok(sceneFile, 'Expected the myosuite sally scene fixture to be present');

  const result = resolveRobotFileData(sceneFile, {
    availableFiles: supportFiles,
  });

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected myosuite sally import result to be ready');
  }
  assert.equal(result.robotData.name, 'sally');
  assert.ok(result.robotData.rootLinkId);
  assert.ok(Object.keys(result.robotData.links).length >= 10);
  assert.ok(Object.keys(result.robotData.joints).length >= 4);
});

test('resolveRobotFileData tolerates MuJoCo-style MJCF with missing attribute whitespace', () => {
  const file = {
    name: pathFromMyosuiteFixture(
      'myosuite/simhive/myo_sim/elbow/myoelbow_1dof6muscles_1dofSoftexo_sim2.xml',
    ),
    content: fs.readFileSync(
      pathFromMyosuiteFixture(
        'myosuite/simhive/myo_sim/elbow/myoelbow_1dof6muscles_1dofSoftexo_sim2.xml',
      ),
      'utf8',
    ),
    format: 'mjcf' as const,
  };

  const result = resolveRobotFileData(file, {
    availableFiles: [file],
  });

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected malformed-but-MuJoCo-compatible MJCF to import successfully');
  }
  assert.equal(result.robotData.name, 'arm26');
  assert.ok(Object.keys(result.robotData.links).length >= 4);
  assert.ok(Object.keys(result.robotData.joints).length >= 1);
});

test('resolveRobotFileData can import xacro exports with ROS1 and ROS2 control blocks', () => {
  const sourceUrdf = `<?xml version="1.0"?>
<robot name="demo_description">
  <link name="base_link" />
  <link name="tip_link" />
  <joint name="shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="tip_link" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="10" velocity="5" />
  </joint>
</robot>`;

  const robot = parseURDF(sourceUrdf);
  assert.ok(robot);

  const ros1Xacro = injectGazeboTags(sourceUrdf, robot, 'ros1', 'effort');
  const ros2Xacro = injectGazeboTags(sourceUrdf, robot, 'ros2', 'position');

  const ros1Result = resolveRobotFileData({
    name: 'robots/demo/demo_description.urdf.xacro',
    content: ros1Xacro,
    format: 'xacro',
  });
  const ros2Result = resolveRobotFileData({
    name: 'robots/demo/demo_description.urdf.xacro',
    content: ros2Xacro,
    format: 'xacro',
  });

  assert.equal(ros1Result.status, 'ready');
  if (ros1Result.status !== 'ready') {
    assert.fail('Expected ROS1 xacro import result to be ready');
  }
  assert.equal(ros1Result.robotData.name, 'demo_description');
  assert.ok(ros1Result.robotData.links.base_link);
  assert.ok(ros1Result.robotData.joints.shoulder_joint);

  assert.equal(ros2Result.status, 'ready');
  if (ros2Result.status !== 'ready') {
    assert.fail('Expected ROS2 xacro import result to be ready');
  }
  assert.equal(ros2Result.robotData.name, 'demo_description');
  assert.ok(ros2Result.robotData.links.base_link);
  assert.ok(ros2Result.robotData.joints.shoulder_joint);
});

test('createUsdPlaceholderRobotData can synthesize a USD placeholder robot', () => {
  const result = createUsdPlaceholderRobotData(createUsdFile('robots/demo/scene.usdz'));

  assert.equal(result.name, 'scene');
  assert.equal(result.rootLinkId, 'usd_scene_root');
  assert.equal(result.links.usd_scene_root?.visual.type, GeometryType.NONE);
  assert.equal(result.links.usd_scene_root?.collision.type, GeometryType.NONE);
});
