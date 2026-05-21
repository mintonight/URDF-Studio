import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, JointType, type UrdfJoint, type UrdfLink } from '@/types';

import { createViewerRobotLoadInputSignature } from './robotLoadScope';

function createLinks(): Record<string, UrdfLink> {
  return {
    base_link: {
      id: 'base_link',
      name: 'base_link',
      visual: {
        type: GeometryType.BOX,
        dimensions: { x: 1, y: 1, z: 1 },
        color: '#ffffff',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      collision: {
        type: GeometryType.BOX,
        dimensions: { x: 1, y: 1, z: 1 },
        color: '#ffffff',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
    },
  };
}

function createJoints(angle = 0): Record<string, UrdfJoint> {
  return {
    shoulder_joint: {
      id: 'shoulder_joint',
      name: 'shoulder_joint',
      type: JointType.REVOLUTE,
      parentLinkId: 'world',
      childLinkId: 'base_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
      angle,
    },
  };
}

test('createViewerRobotLoadInputSignature uses structured robot state instead of URDF text when available', () => {
  const links = createLinks();
  const joints = createJoints();

  const fromFirstContent = createViewerRobotLoadInputSignature({
    urdfContent: '<robot name="first" />',
    robotLinks: links,
    robotJoints: joints,
    hasStructuredRobotState: true,
  });
  const fromSecondContent = createViewerRobotLoadInputSignature({
    urdfContent: '<robot name="second" />',
    robotLinks: links,
    robotJoints: joints,
    hasStructuredRobotState: true,
  });

  assert.equal(fromFirstContent, fromSecondContent);
});

test('createViewerRobotLoadInputSignature ignores transient joint motion for structured robot state', () => {
  const links = createLinks();

  const baseline = createViewerRobotLoadInputSignature({
    urdfContent: '<robot name="demo" />',
    robotLinks: links,
    robotJoints: createJoints(0),
    hasStructuredRobotState: true,
  });
  const moved = createViewerRobotLoadInputSignature({
    urdfContent: '<robot name="demo" />',
    robotLinks: links,
    robotJoints: createJoints(1.2),
    hasStructuredRobotState: true,
  });

  assert.equal(baseline, moved);
});

test('createViewerRobotLoadInputSignature ignores patchable joint origin edits', () => {
  const links = createLinks();
  const baselineJoints = createJoints();
  const editedJoints = createJoints();
  editedJoints.shoulder_joint.origin.xyz.z = 0.4;

  const baseline = createViewerRobotLoadInputSignature({
    urdfContent: '<robot name="demo" />',
    robotLinks: links,
    robotJoints: baselineJoints,
    hasStructuredRobotState: true,
  });
  const edited = createViewerRobotLoadInputSignature({
    urdfContent: '<robot name="demo" />',
    robotLinks: links,
    robotJoints: editedJoints,
    hasStructuredRobotState: true,
  });

  assert.equal(baseline, edited);
});

test('createViewerRobotLoadInputSignature detects structured geometry edits', () => {
  const joints = createJoints();
  const baselineLinks = createLinks();
  const editedLinks = createLinks();
  editedLinks.base_link.visual.dimensions = { x: 2, y: 1, z: 1 };

  const baseline = createViewerRobotLoadInputSignature({
    urdfContent: '<robot name="demo" />',
    robotLinks: baselineLinks,
    robotJoints: joints,
    hasStructuredRobotState: true,
  });
  const edited = createViewerRobotLoadInputSignature({
    urdfContent: '<robot name="demo" />',
    robotLinks: editedLinks,
    robotJoints: joints,
    hasStructuredRobotState: true,
  });

  assert.notEqual(baseline, edited);
});

test('createViewerRobotLoadInputSignature falls back to URDF content when structured state is unavailable', () => {
  const first = createViewerRobotLoadInputSignature({
    urdfContent: '<robot name="first" />',
    hasStructuredRobotState: false,
  });
  const second = createViewerRobotLoadInputSignature({
    urdfContent: '<robot name="second" />',
    hasStructuredRobotState: false,
  });

  assert.notEqual(first, second);
});
