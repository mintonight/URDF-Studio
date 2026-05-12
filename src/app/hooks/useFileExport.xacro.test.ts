import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import { useFileExport } from './useFileExport.ts';
import { useAssemblyStore, useAssetsStore, useRobotStore, useUIStore } from '@/store';
import { processXacro } from '@/core/parsers/xacro/xacroParser.ts';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotData,
  type RobotFile,
} from '@/types';
import type { ExportDialogConfig } from '@/features/file-io';

function restoreGlobalProperty<T extends keyof typeof globalThis>(
  key: T,
  originalValue: (typeof globalThis)[T] | undefined,
) {
  if (originalValue === undefined) {
    delete globalThis[key];
    return;
  }

  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: originalValue,
  });
}

function installDomEnvironment() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalSVGElement = globalThis.SVGElement;
  const originalNode = globalThis.Node;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalDOMParser = globalThis.DOMParser;
  const originalXMLSerializer = globalThis.XMLSerializer;

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    writable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    configurable: true,
    writable: true,
    value: dom.window.SVGElement,
  });
  Object.defineProperty(globalThis, 'Node', {
    configurable: true,
    writable: true,
    value: dom.window.Node,
  });
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    writable: true,
    value: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (handle: number) => clearTimeout(handle),
  });
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    writable: true,
    value: dom.window.DOMParser,
  });
  Object.defineProperty(globalThis, 'XMLSerializer', {
    configurable: true,
    writable: true,
    value: dom.window.XMLSerializer,
  });

  return {
    restore() {
      dom.window.close();
      restoreGlobalProperty('window', originalWindow);
      restoreGlobalProperty('document', originalDocument);
      restoreGlobalProperty('navigator', originalNavigator);
      restoreGlobalProperty('HTMLElement', originalHTMLElement);
      restoreGlobalProperty('SVGElement', originalSVGElement);
      restoreGlobalProperty('Node', originalNode);
      restoreGlobalProperty('MutationObserver', originalMutationObserver);
      restoreGlobalProperty('requestAnimationFrame', originalRequestAnimationFrame);
      restoreGlobalProperty('cancelAnimationFrame', originalCancelAnimationFrame);
      restoreGlobalProperty('DOMParser', originalDOMParser);
      restoreGlobalProperty('XMLSerializer', originalXMLSerializer);
    },
  };
}

function renderHook() {
  let hookValue: ReturnType<typeof useFileExport> | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);

  function Probe() {
    hookValue = useFileExport();
    return null;
  }

  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(Probe));
  });
  assert.ok(hookValue, 'hook should render');
  return {
    hook: hookValue,
    cleanup() {
      flushSync(() => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

function resetStoresToBaseline() {
  useUIStore.setState({
    lang: 'en',
    appMode: 'editor',
  });

  useAssemblyStore.setState({
    assemblyState: null,
    _history: { past: [], future: [] },
    _activity: [],
  });

  useAssetsStore.setState({
    assets: {},
    availableFiles: [],
    usdSceneSnapshots: {},
    usdPreparedExportCaches: {},
    selectedFile: null,
    documentLoadState: {
      status: 'idle',
      fileName: null,
      format: null,
      error: null,
    },
    allFileContents: {},
    motorLibrary: {},
    originalUrdfContent: '',
    originalFileFormat: null,
  });

  useRobotStore.getState().resetRobot();
}

function installDownloadMocks() {
  const originalCreateElement = document.createElement.bind(document);
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  let capturedBlob: Blob | null = null;
  let clicked = false;
  let appendedAnchor: HTMLAnchorElement | null = null;
  const revokedUrls: string[] = [];

  Object.defineProperty(document, 'createElement', {
    configurable: true,
    writable: true,
    value: (tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'a') {
        appendedAnchor = element as HTMLAnchorElement;
        Object.defineProperty(element, 'click', {
          configurable: true,
          writable: true,
          value: () => {
            clicked = true;
          },
        });
      }
      return element;
    },
  });

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      capturedBlob = blob;
      return 'blob:xacro-export-test';
    },
  });

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (url: string) => {
      revokedUrls.push(String(url || ''));
    },
  });

  return {
    get capturedBlob() {
      return capturedBlob;
    },
    get appendedAnchor() {
      return appendedAnchor;
    },
    get clicked() {
      return clicked;
    },
    get revokedUrls() {
      return revokedUrls;
    },
    restore() {
      Object.defineProperty(document, 'createElement', {
        configurable: true,
        writable: true,
        value: originalCreateElement,
      });

      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });

      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL,
      });
    },
  };
}

function createExportConfig(
  xacroOverrides: Partial<ExportDialogConfig['xacro']> = {},
): ExportDialogConfig {
  return {
    format: 'xacro',
    includeSkeleton: false,
    mjcf: {
      meshdir: 'meshes/',
      addFloatBase: false,
      preferSharedMeshReuse: true,
      includeActuators: true,
      actuatorType: 'position',
      includeMeshes: false,
      compressSTL: false,
      stlQuality: 50,
    },
    urdf: {
      includeExtended: false,
      includeBOM: false,
      useRelativePaths: true,
      preferSourceVisualMeshes: true,
      includeMeshes: false,
      compressSTL: false,
      stlQuality: 50,
    },
    xacro: {
      rosVersion: 'ros2',
      rosHardwareInterface: 'effort',
      useRelativePaths: true,
      includeMeshes: false,
      compressSTL: false,
      stlQuality: 50,
      ...xacroOverrides,
    },
    sdf: {
      includeMeshes: false,
      compressSTL: false,
      stlQuality: 50,
    },
    usd: {
      fileFormat: 'usd',
      compressMeshes: true,
      meshQuality: 50,
    },
  };
}

function createClosedLoopRobotData(robotName: string): RobotData {
  const baseLinkId = `${robotName}_base_link`;
  const closingLinkId = `${robotName}_closing_link`;

  return {
    name: robotName,
    rootLinkId: baseLinkId,
    links: {
      [baseLinkId]: {
        ...DEFAULT_LINK,
        id: baseLinkId,
        name: baseLinkId,
      },
      [closingLinkId]: {
        ...DEFAULT_LINK,
        id: closingLinkId,
        name: closingLinkId,
      },
    },
    joints: {
      [`${robotName}_hinge_joint`]: {
        ...DEFAULT_JOINT,
        id: `${robotName}_hinge_joint`,
        name: `${robotName}_hinge_joint`,
        type: JointType.REVOLUTE,
        parentLinkId: baseLinkId,
        childLinkId: closingLinkId,
      },
    },
    closedLoopConstraints: [
      {
        id: `${robotName}_closed_loop_constraint`,
        type: 'connect',
        linkAId: baseLinkId,
        linkBId: closingLinkId,
        anchorWorld: { x: 0, y: 0, z: 0 },
        anchorLocalA: { x: 0, y: 0, z: 0 },
        anchorLocalB: { x: 0, y: 0, z: 0 },
      },
    ],
  };
}

test('useFileExport packages selected xacro sources as an exportable xacro zip', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();

  const selectedFile: RobotFile = {
    name: 'robots/demo_robot.urdf.xacro',
    format: 'xacro',
    content: `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo_robot">
  <xacro:property name="box_size" value="0.1"/>
  <link name="base_link">
    <collision>
      <geometry>
        <box size="\${box_size} \${box_size} \${box_size}" />
      </geometry>
    </collision>
  </link>
</robot>`,
  };

  useUIStore.setState({
    lang: 'en',
    appMode: 'editor',
  });

  useAssetsStore.getState().setAvailableFiles([selectedFile]);
  useAssetsStore.getState().setSelectedFile(selectedFile);
  useAssetsStore.getState().setAllFileContents({
    [selectedFile.name]: selectedFile.content,
  });
  useAssetsStore.getState().setDocumentLoadState({
    status: 'ready',
    fileName: selectedFile.name,
    format: 'xacro',
    error: null,
  });
  useAssetsStore.getState().setOriginalUrdfContent('');
  useAssetsStore.getState().setOriginalFileFormat('xacro');

  useRobotStore.getState().setRobot(
    {
      name: 'demo_robot',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.BOX,
            dimensions: { x: 0.5, y: 0.25, z: 0.15 },
            origin: {
              xyz: { x: 0, y: 0, z: 0 },
              rpy: { r: 0, p: 0, y: 0 },
            },
          },
        },
      },
      joints: {},
    },
    {
      skipHistory: true,
      resetHistory: true,
      label: 'Load xacro export test robot',
    },
  );

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await rendered.hook.handleExportWithConfig(createExportConfig());

    assert.equal(downloadMocks.clicked, true, 'expected the generated archive to be downloaded');
    assert.match(downloadMocks.appendedAnchor?.download ?? '', /_xacro\.zip$/);
    assert.deepEqual(downloadMocks.revokedUrls, ['blob:xacro-export-test']);
    assert.ok(downloadMocks.capturedBlob, 'expected a zip blob to be generated');

    const archive = await JSZip.loadAsync(await downloadMocks.capturedBlob.arrayBuffer());
    const exportedXacroPath = Object.keys(archive.files).find((path) =>
      path.endsWith('.urdf.xacro'),
    );
    assert.ok(exportedXacroPath, 'expected exactly one exported xacro file in the archive');
    const exportedXacro = archive.file(exportedXacroPath);
    assert.ok(exportedXacro, 'expected xacro export inside the archive');

    const exportedXml = await exportedXacro.async('string');
    assert.match(exportedXml, /xmlns:xacro="http:\/\/www\.ros\.org\/wiki\/xacro"/);
    assert.match(exportedXml, /<xacro:arg name="ros_profile" default="ros2"\s*\/>/);
    assert.match(exportedXml, /<xacro:arg name="ros_hardware_interface" default="effort"\s*\/>/);
    assert.match(
      exportedXml,
      /<xacro:if value="\$\{xacro\.arg\('ros_profile'\) == 'ros1' and xacro\.arg\('ros_hardware_interface'\) == 'effort'\}">/,
    );
    assert.match(
      exportedXml,
      /<xacro:if value="\$\{xacro\.arg\('ros_profile'\) == 'ros2' and xacro\.arg\('ros_hardware_interface'\) == 'effort'\}">/,
    );
    assert.match(exportedXml, /<box size="0\.5 0\.25 0\.15"\s*\/>/);
    assert.match(exportedXml, /xacro:property name="box_size"/);
    assert.doesNotMatch(exportedXml, /\$\{box_size\}/);

    const expandedXml = processXacro(exportedXml);
    assert.match(expandedXml, /<ros2_control name="demo_robot" type="system">/);
    assert.match(expandedXml, /<plugin>gazebo_ros2_control\/GazeboSystem<\/plugin>/);
    assert.match(
      expandedXml,
      /<plugin name="gazebo_ros2_control" filename="libgazebo_ros2_control\.so">/,
    );
    assert.match(expandedXml, /<robot_param>robot_description<\/robot_param>/);
    assert.match(expandedXml, /<robot_param_node>robot_state_publisher<\/robot_param_node>/);
    assert.doesNotMatch(expandedXml, /<transmission\b/);

    const ros1ExpandedXml = processXacro(exportedXml, { ros_profile: 'ros1' });
    assert.match(
      ros1ExpandedXml,
      /<plugin name="gazebo_ros_control" filename="libgazebo_ros_control\.so">/,
    );
    assert.doesNotMatch(ros1ExpandedXml, /<ros2_control\b/);
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    downloadMocks.restore();
    domEnvironment.restore();
    resetStoresToBaseline();
  }
});

test('useFileExport rejects xacro export when the current robot contains closed-loop constraints', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  useRobotStore.getState().resetRobot(createClosedLoopRobotData('closed_loop_xacro_robot'));

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await assert.rejects(
      rendered.hook.handleExportWithConfig(createExportConfig()),
      /closed-loop constraint/i,
    );

    assert.equal(downloadMocks.clicked, false, 'expected xacro export to abort before downloading');
    assert.equal(downloadMocks.capturedBlob, null, 'expected no zip blob on failed xacro export');
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    downloadMocks.restore();
    domEnvironment.restore();
    resetStoresToBaseline();
  }
});

test('useFileExport fails fast when xacro mesh packaging is incomplete', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();

  useRobotStore.getState().setRobot(
    {
      name: 'missing_mesh_robot',
      rootLinkId: 'base_link',
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
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.MESH,
            meshPath: 'package://demo/meshes/base.stl',
            dimensions: { x: 1, y: 1, z: 1 },
          },
        },
      },
      joints: {},
    },
    {
      skipHistory: true,
      resetHistory: true,
      label: 'Load xacro mesh failure export test robot',
    },
  );

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await assert.rejects(
      rendered.hook.handleExportWithConfig(
        createExportConfig({
          includeMeshes: true,
        }),
      ),
      /Mesh asset not found: package:\/\/demo\/meshes\/base\.stl/,
    );

    assert.equal(downloadMocks.clicked, false, 'expected export to abort before downloading');
    assert.equal(downloadMocks.capturedBlob, null, 'expected no zip blob on failed export');
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 20));
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    downloadMocks.restore();
    domEnvironment.restore();
    resetStoresToBaseline();
  }
});

test('useFileExport packages ROS1 xacro exports with gazebo_ros_control metadata', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();

  const selectedFile: RobotFile = {
    name: 'robots/demo_robot.urdf.xacro',
    format: 'xacro',
    content: `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo_robot">
  <link name="base_link" />
  <link name="tip_link" />
  <joint name="shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="tip_link" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="10" velocity="5" />
  </joint>
</robot>`,
  };

  useUIStore.setState({
    lang: 'en',
    appMode: 'editor',
  });

  useAssetsStore.getState().setAvailableFiles([selectedFile]);
  useAssetsStore.getState().setSelectedFile(selectedFile);
  useAssetsStore.getState().setAllFileContents({
    [selectedFile.name]: selectedFile.content,
  });
  useAssetsStore.getState().setDocumentLoadState({
    status: 'ready',
    fileName: selectedFile.name,
    format: 'xacro',
    error: null,
  });
  useAssetsStore.getState().setOriginalUrdfContent('');
  useAssetsStore.getState().setOriginalFileFormat('xacro');

  useRobotStore.getState().setRobot(
    {
      name: 'demo_robot',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
        },
        tip_link: {
          ...DEFAULT_LINK,
          id: 'tip_link',
          name: 'tip_link',
        },
      },
      joints: {
        shoulder_joint: {
          ...DEFAULT_JOINT,
          id: 'shoulder_joint',
          name: 'shoulder_joint',
          type: JointType.REVOLUTE,
          parentLinkId: 'base_link',
          childLinkId: 'tip_link',
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
          axis: { x: 0, y: 0, z: 1 },
          limit: {
            lower: -1,
            upper: 1,
            effort: 10,
            velocity: 5,
          },
        },
      },
    },
    {
      skipHistory: true,
      resetHistory: true,
      label: 'Load ROS1 xacro export test robot',
    },
  );

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await rendered.hook.handleExportWithConfig(
      createExportConfig({
        rosVersion: 'ros1',
        rosHardwareInterface: 'effort',
      }),
    );

    assert.equal(downloadMocks.clicked, true, 'expected the generated archive to be downloaded');
    assert.ok(downloadMocks.capturedBlob, 'expected a zip blob to be generated');

    const archive = await JSZip.loadAsync(await downloadMocks.capturedBlob.arrayBuffer());
    const exportedXacroPath = Object.keys(archive.files).find((path) =>
      path.endsWith('.urdf.xacro'),
    );
    assert.ok(exportedXacroPath, 'expected exactly one exported xacro file in the archive');
    const exportedXacro = archive.file(exportedXacroPath);
    assert.ok(exportedXacro, 'expected xacro export inside the archive');

    const exportedXml = await exportedXacro.async('string');
    assert.match(exportedXml, /xmlns:xacro="http:\/\/www\.ros\.org\/wiki\/xacro"/);
    assert.match(exportedXml, /<xacro:arg name="ros_profile" default="ros1"\s*\/>/);
    assert.match(exportedXml, /<xacro:arg name="ros_hardware_interface" default="effort"\s*\/>/);
    assert.match(
      exportedXml,
      /<xacro:if value="\$\{xacro\.arg\('ros_profile'\) == 'ros1' and xacro\.arg\('ros_hardware_interface'\) == 'effort'\}">/,
    );

    const expandedXml = processXacro(exportedXml);
    assert.match(expandedXml, /<transmission name="shoulder_joint_trans">/);
    assert.match(
      expandedXml,
      /<hardwareInterface>hardware_interface\/EffortJointInterface<\/hardwareInterface>/,
    );
    assert.match(
      expandedXml,
      /<plugin name="gazebo_ros_control" filename="libgazebo_ros_control\.so">/,
    );
    assert.match(expandedXml, /<robotNamespace>\/demo_robot_gazebo<\/robotNamespace>/);
    assert.match(
      expandedXml,
      /<robotSimType>gazebo_ros_control\/DefaultRobotHWSim<\/robotSimType>/,
    );
    assert.doesNotMatch(expandedXml, /<ros2_control\b/);

    const ros2ExpandedXml = processXacro(exportedXml, {
      ros_profile: 'ros2',
      ros_hardware_interface: 'velocity',
    });
    assert.match(ros2ExpandedXml, /<command_interface name="velocity"\/>/);
    assert.doesNotMatch(ros2ExpandedXml, /<state_interface name="effort"\/>/);

    assert.match(ros2ExpandedXml, /<ros2_control name="demo_robot" type="system">/);
    assert.match(
      ros2ExpandedXml,
      /<plugin name="gazebo_ros2_control" filename="libgazebo_ros2_control\.so">/,
    );
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    downloadMocks.restore();
    domEnvironment.restore();
    resetStoresToBaseline();
  }
});
