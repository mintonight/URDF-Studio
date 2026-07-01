import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPopupHandoffImportStateSnapshot,
  didPopupHandoffImportChangeState,
  readPopupHandoffId,
  resolvePopupHandoffImport,
  stripPopupHandoffQueryParam,
} from './popupHandoffImport.ts';
import {
  isAllowedHandoffOrigin,
  normalizeHandoffOrigin,
} from '@/shared/utils/popupHandoffProtocol.ts';

test('readPopupHandoffId returns null when the query is absent', () => {
  assert.equal(readPopupHandoffId('?foo=bar'), null);
});

test('readPopupHandoffId returns the handoff query value', () => {
  assert.equal(readPopupHandoffId('?handoff=abc123&foo=bar'), 'abc123');
});

test('stripPopupHandoffQueryParam removes only the handoff query key', () => {
  assert.equal(stripPopupHandoffQueryParam('/?handoff=abc123&foo=bar#hash'), '/?foo=bar#hash');
});

test('handoff origin validation rejects userinfo host confusion', () => {
  assert.equal(normalizeHandoffOrigin('http://localhost:80@evil.example'), null);
  assert.equal(isAllowedHandoffOrigin('http://localhost:80@evil.example'), false);
  assert.equal(isAllowedHandoffOrigin('http://localhost:5173'), true);
});

test('resolvePopupHandoffImport returns ready when a stored archive exists', async () => {
  let cleanupCalls = 0;
  const result = await resolvePopupHandoffImport('?handoff=abc123', {
    cleanupExpired: async () => {
      cleanupCalls += 1;
    },
    readArchive: async (handoffId) => ({
      id: handoffId,
      fileName: 'bundle.zip',
      mimeType: 'application/zip',
      sizeBytes: 42,
      sourceOrigin: 'https://partner.example',
      createdAt: 123,
      zipBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/zip' }),
    }),
  });

  assert.equal(cleanupCalls, 1);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('expected popup handoff archive to resolve');
  }
  assert.equal(result.handoffId, 'abc123');
  assert.equal(result.file.name, 'bundle.zip');
  assert.equal(result.sourceOrigin, 'https://partner.example');
});

test('resolvePopupHandoffImport returns missing when the record no longer exists', async () => {
  const result = await resolvePopupHandoffImport('?handoff=missing', {
    cleanupExpired: async () => {},
    readArchive: async () => null,
  });

  assert.deepEqual(result, {
    status: 'missing',
    handoffId: 'missing',
  });
});

test('didPopupHandoffImportChangeState reports successful import side effects', () => {
  const before = buildPopupHandoffImportStateSnapshot({
    availableFiles: [],
    assets: {},
    selectedFile: null,
  });
  const after = buildPopupHandoffImportStateSnapshot({
    availableFiles: [{}, {}],
    assets: { 'robot/mesh.stl': 'blob:mesh' },
    selectedFile: { name: 'robot/demo.urdf' },
  });

  assert.equal(didPopupHandoffImportChangeState(before, after), true);
});

test('didPopupHandoffImportChangeState stays false when import produced no state delta', () => {
  const before = buildPopupHandoffImportStateSnapshot({
    availableFiles: [{}],
    assets: {},
    selectedFile: { name: 'robot/demo.urdf' },
  });
  const after = buildPopupHandoffImportStateSnapshot({
    availableFiles: [{}],
    assets: {},
    selectedFile: { name: 'robot/demo.urdf' },
  });

  assert.equal(didPopupHandoffImportChangeState(before, after), false);
});
