import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRemoteImportBlobWithinLimits,
  assertRemoteImportContentLengthWithinLimits,
  assertRemoteImportFileListWithinLimits,
  resolveAllowedRemoteImportOrigin,
  resolveRemoteImportFileUrl,
  type FileDownloadInfo,
} from './useAssetImportFromUrl.ts';

test('resolveAllowedRemoteImportOrigin rejects userinfo origin confusion', () => {
  assert.equal(resolveAllowedRemoteImportOrigin('http://localhost:80@evil.example'), null);
  assert.equal(resolveAllowedRemoteImportOrigin('http://localhost:5173'), 'http://localhost:5173');
});

test('resolveRemoteImportFileUrl keeps downloads on the handoff origin', () => {
  assert.equal(
    resolveRemoteImportFileUrl('http://localhost:5173/files/robot.urdf', 'http://localhost:5173')
      .pathname,
    '/files/robot.urdf',
  );

  assert.throws(
    () => resolveRemoteImportFileUrl('https://evil.example/robot.urdf', 'http://localhost:5173'),
    /Unexpected asset download origin: https:\/\/evil\.example/i,
  );
});

test('remote import file list rejects excessive file counts before download', () => {
  const files: FileDownloadInfo[] = Array.from({ length: 2_001 }, (_, index) => ({
    path: `mesh-${index}.stl`,
    url: `http://localhost:5173/files/mesh-${index}.stl`,
  }));

  assert.throws(
    () => assertRemoteImportFileListWithinLimits(files),
    /Remote import contains too many files \(2001\)\. Maximum: 2000\./i,
  );
});

test('remote import size checks reject oversized content-length and blobs', () => {
  const oversizedResponse = new Response('', {
    headers: {
      'content-length': String(512 * 1024 * 1024 + 1),
    },
  });
  assert.throws(
    () => assertRemoteImportContentLengthWithinLimits(oversizedResponse, 0),
    /Remote file is too large/i,
  );

  const oversizedBlob = new Blob([new Uint8Array(1)]);
  assert.throws(
    () => assertRemoteImportBlobWithinLimits(oversizedBlob, 512 * 1024 * 1024 + 1),
    /Remote import is too large/i,
  );
});
