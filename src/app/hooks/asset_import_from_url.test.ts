import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRemoteImportBlobWithinLimits,
  assertRemoteImportContentLengthWithinLimits,
  assertRemoteImportFileListWithinLimits,
  resolveAllowedRemoteImportOrigin,
  type FileDownloadInfo,
} from './useAssetImportFromUrl.ts';
import {
  isAllowedHandoffOrigin,
  normalizeHandoffOrigin,
} from '@/shared/utils/popupHandoffProtocol.ts';

test('resolveAllowedRemoteImportOrigin rejects userinfo origin confusion', () => {
  assert.equal(resolveAllowedRemoteImportOrigin('http://localhost:80@evil.example'), null);
  assert.equal(resolveAllowedRemoteImportOrigin('http://localhost:5173'), 'http://localhost:5173');
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

test('handoff origin allowlist rejects userinfo host confusion at the protocol layer', () => {
  // Arrange: an origin embedding userinfo to confuse host parsing
  const maliciousOrigin = 'http://localhost:80@evil.example';

  // Assert: normalization drops it and the allowlist rejects it,
  // while a plain localhost origin is still accepted.
  assert.equal(normalizeHandoffOrigin(maliciousOrigin), null);
  assert.equal(isAllowedHandoffOrigin(maliciousOrigin), false);
  assert.equal(isAllowedHandoffOrigin('http://localhost:5173'), true);
});
