import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStageAxisAlignmentToRoot as applyStageAxisAlignmentToRootUntyped,
  extractStageUpAxisFromLayerText,
  resolveAxisAlignmentRotationX as resolveAxisAlignmentRotationXUntyped,
  resolveStageUpAxis as resolveStageUpAxisUntyped,
} from './stage-up-axis.js';

type StageUpAxis = 'y' | 'z' | null;
type StageLike = { GetRootLayer?: () => { ExportToString?: () => string } | null } | null;

const resolveStageUpAxis = resolveStageUpAxisUntyped as (options?: {
  reportedUpAxis?: string | null;
  stage?: StageLike;
}) => StageUpAxis;

const resolveAxisAlignmentRotationX = resolveAxisAlignmentRotationXUntyped as (options?: {
  sourceUpAxis?: string | null;
  targetUpAxis?: string | null;
}) => number;

const applyStageAxisAlignmentToRoot = applyStageAxisAlignmentToRootUntyped as (
  root: { rotation?: { x: number; y: number; z: number } } | null,
  options?: { reportedUpAxis?: string | null; stage?: StageLike; targetUpAxis?: string | null },
) => number;

test('extracts up-axis from authored USD root-layer metadata', () => {
  assert.equal(
    extractStageUpAxisFromLayerText(`#usda 1.0
(
    upAxis = "Z"
)
`),
    'z',
  );
  assert.equal(
    extractStageUpAxisFromLayerText(`#usda 1.0
(
    upAxis = "Y"
)
`),
    'y',
  );
});

test('prefers reported stage metadata before parsing layer text', () => {
  assert.equal(
    resolveStageUpAxis({
      reportedUpAxis: 'z',
      stage: {
        GetRootLayer: () => ({
          ExportToString: () => '#usda 1.0\n(\n    upAxis = "Y"\n)\n',
        }),
      },
    }),
    'z',
  );
});

test('falls back to root-layer metadata when reported up-axis is missing', () => {
  assert.equal(
    resolveStageUpAxis({
      reportedUpAxis: null,
      stage: {
        GetRootLayer: () => ({
          ExportToString: () => '#usda 1.0\n(\n    upAxis = "Z"\n)\n',
        }),
      },
    }),
    'z',
  );
});

test('returns null when neither metadata source is available', () => {
  assert.equal(
    resolveStageUpAxis({
      reportedUpAxis: null,
      stage: null,
    }),
    null,
  );
});

test('keeps unresolved up-axis null when no metadata source is available', () => {
  assert.equal(
    resolveStageUpAxis({
      reportedUpAxis: null,
      stage: null,
    }),
    null,
  );
});

test('does not invent an up-axis when metadata is missing', () => {
  assert.equal(
    resolveStageUpAxis({
      reportedUpAxis: null,
      stage: null,
    }),
    null,
  );
});

test('computes generic source->target up-axis alignment rotations', () => {
  assert.equal(
    resolveAxisAlignmentRotationX({ sourceUpAxis: 'z', targetUpAxis: 'z' }),
    0,
  );
  assert.equal(
    resolveAxisAlignmentRotationX({ sourceUpAxis: 'y', targetUpAxis: 'z' }),
    Math.PI / 2,
  );
  assert.equal(
    resolveAxisAlignmentRotationX({ sourceUpAxis: 'z', targetUpAxis: 'y' }),
    -Math.PI / 2,
  );
});

test('re-applies root alignment when late stage metadata resolves an initially unknown up-axis', () => {
  const root = {
    rotation: {
      x: 123,
      y: 0,
      z: 0,
    },
  };

  assert.equal(
    applyStageAxisAlignmentToRoot(root, {
      reportedUpAxis: null,
      stage: null,
    }),
    0,
  );
  assert.equal(root.rotation.x, 0);

  assert.equal(
    applyStageAxisAlignmentToRoot(root, {
      reportedUpAxis: 'z',
      stage: null,
    }),
    0,
  );
  assert.equal(root.rotation.x, 0);
});
