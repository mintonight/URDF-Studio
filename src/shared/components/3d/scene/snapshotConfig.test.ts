import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSnapshotCaptureOptions } from './snapshotConfig.ts';
import type { WorkspaceCameraSnapshot } from '../workspace/workspaceCameraSnapshot';

test('normalizeSnapshotCaptureOptions defaults the export background to studio', () => {
  const options = normalizeSnapshotCaptureOptions();

  assert.equal(options.backgroundStyle, 'studio');
  assert.equal(options.imageQuality, 96);
  assert.equal(options.detailLevel, 'high');
  assert.equal(options.environmentPreset, 'city');
  assert.equal(options.shadowStyle, 'balanced');
  assert.equal(options.groundStyle, 'shadow');
  assert.equal(options.dofMode, 'off');
  assert.equal(options.hideGrid, false);
});

test('normalizeSnapshotCaptureOptions keeps transparent backgrounds for alpha-capable formats', () => {
  const options = normalizeSnapshotCaptureOptions({
    imageFormat: 'png',
    backgroundStyle: 'transparent',
  });

  assert.equal(options.backgroundStyle, 'transparent');
});

test('normalizeSnapshotCaptureOptions falls back from transparent backgrounds for jpeg', () => {
  const options = normalizeSnapshotCaptureOptions({
    imageFormat: 'jpeg',
    backgroundStyle: 'transparent',
  });

  assert.equal(options.backgroundStyle, 'studio');
});

test('normalizeSnapshotCaptureOptions disables DOF when the export stays transparent', () => {
  const options = normalizeSnapshotCaptureOptions({
    imageFormat: 'png',
    backgroundStyle: 'transparent',
    dofMode: 'hero',
  });

  assert.equal(options.backgroundStyle, 'transparent');
  assert.equal(options.dofMode, 'off');
});

test('normalizeSnapshotCaptureOptions clamps lossy image quality into the supported range', () => {
  const tooLow = normalizeSnapshotCaptureOptions({
    imageFormat: 'webp',
    imageQuality: 12,
  });
  const tooHigh = normalizeSnapshotCaptureOptions({
    imageFormat: 'jpeg',
    imageQuality: 180,
  });

  assert.equal(tooLow.imageQuality, 60);
  assert.equal(tooHigh.imageQuality, 100);
});

test('normalizeSnapshotCaptureOptions preserves a frozen camera snapshot for export', () => {
  const cameraSnapshot: WorkspaceCameraSnapshot = {
    kind: 'perspective',
    position: { x: 2, y: 3, z: 4 },
    quaternion: { x: 0, y: 0.5, z: 0, w: 0.8660254037844386 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 1.2,
    target: { x: 0.5, y: -0.25, z: 1 },
    aspectRatio: 1.6,
    fov: 50,
    near: 0.1,
    far: 1000,
  };

  const options = normalizeSnapshotCaptureOptions({
    longEdgePx: 3840,
    cameraSnapshot,
  });

  assert.equal(options.longEdgePx, 3840);
  assert.deepEqual(options.cameraSnapshot, cameraSnapshot);
});
