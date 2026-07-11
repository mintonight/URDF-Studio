import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeExtraMeshFiles } from './stepExport';

test('mergeExtraMeshFiles reports only blob URLs it creates', () => {
  const callerOwnedUrl = 'blob:caller-owned';
  const originalCreateObjectUrl = URL.createObjectURL;
  let nextId = 0;
  URL.createObjectURL = () => `blob:created-${++nextId}`;
  try {
    const result = mergeExtraMeshFiles(
      { 'existing.stl': callerOwnedUrl },
      new Map([
        ['existing.stl', new Blob(['existing'])],
        ['new.stl', new Blob(['new'])],
      ]),
    );
    assert.equal(result.assets['existing.stl'], callerOwnedUrl);
    assert.equal(result.assets['new.stl'], 'blob:created-1');
    assert.deepEqual(result.createdBlobUrls, ['blob:created-1']);
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
  }
});
