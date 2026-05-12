import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildUrlWithoutHandoffParam,
  consumeHandoffImportFromUrl,
  readHandoffIdFromUrl,
} from './bootstrap.ts';
import type { PopupHandoffArchiveRecord as PendingHandoffImportRecord } from '../../shared/utils/popupHandoffProtocol.ts';

function createSessionStorageMock() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function createRecord(
  overrides: Partial<PendingHandoffImportRecord> = {},
): PendingHandoffImportRecord {
  return {
    id: 'handoff-123',
    fileName: 'demo_bundle.zip',
    mimeType: 'application/zip',
    sizeBytes: 128,
    sourceOrigin: 'https://sender.example',
    createdAt: 1_713_000_000_000,
    zipBlob: new Blob([new Uint8Array([80, 75, 3, 4])], { type: 'application/zip' }),
    ...overrides,
  };
}

test('readHandoffIdFromUrl returns the handoff query param when present', () => {
  assert.equal(readHandoffIdFromUrl('https://urdf.example/?handoff=abc123&foo=1'), 'abc123');
  assert.equal(readHandoffIdFromUrl('https://urdf.example/?foo=1'), null);
});

test('buildUrlWithoutHandoffParam removes only the handoff query param', () => {
  assert.equal(
    buildUrlWithoutHandoffParam('https://urdf.example/?handoff=abc123&foo=1'),
    'https://urdf.example/?foo=1',
  );
});

test('consumeHandoffImportFromUrl imports the pending archive and deletes it on success', async () => {
  const sessionStorage = createSessionStorageMock();
  const record = createRecord();
  const importedFiles: File[][] = [];
  const deletedIds: string[] = [];
  const replacedUrls: string[] = [];

  const result = await consumeHandoffImportFromUrl({
    currentUrl: 'https://urdf.example/?handoff=handoff-123',
    sessionStorage,
    loadRecord: async (handoffId) => (handoffId === record.id ? record : null),
    deleteRecord: async (handoffId) => {
      deletedIds.push(handoffId);
    },
    importArchive: async (files) => {
      importedFiles.push([...files]);
      return { status: 'completed' };
    },
    replaceUrl: (nextUrl) => {
      replacedUrls.push(nextUrl);
    },
  });

  assert.deepEqual(result, { status: 'completed', handoffId: 'handoff-123' });
  assert.equal(importedFiles.length, 1);
  assert.equal(importedFiles[0]?.[0]?.name, 'demo_bundle.zip');
  assert.equal(importedFiles[0]?.[0]?.type, 'application/zip');
  assert.deepEqual(deletedIds, ['handoff-123']);
  assert.deepEqual(replacedUrls, ['https://urdf.example/']);
});

test('consumeHandoffImportFromUrl strips the query param when the handoff record is missing', async () => {
  const replacedUrls: string[] = [];

  const result = await consumeHandoffImportFromUrl({
    currentUrl: 'https://urdf.example/?handoff=missing&foo=1',
    sessionStorage: createSessionStorageMock(),
    loadRecord: async () => null,
    deleteRecord: async () => {
      assert.fail('missing handoff records should not be deleted');
    },
    importArchive: async () => {
      assert.fail('missing handoff records should not import');
    },
    replaceUrl: (nextUrl) => {
      replacedUrls.push(nextUrl);
    },
  });

  assert.deepEqual(result, { status: 'missing', handoffId: 'missing' });
  assert.deepEqual(replacedUrls, ['https://urdf.example/?foo=1']);
});

test('consumeHandoffImportFromUrl avoids re-importing the same handoff id in one session', async () => {
  const sessionStorage = createSessionStorageMock();
  sessionStorage.setItem('urdf-studio-handoff-attempted:handoff-123', '1');
  const replacedUrls: string[] = [];

  const result = await consumeHandoffImportFromUrl({
    currentUrl: 'https://urdf.example/?handoff=handoff-123',
    sessionStorage,
    loadRecord: async () => {
      assert.fail('already-attempted handoff ids should not reload storage');
    },
    deleteRecord: async () => {
      assert.fail('already-attempted handoff ids should not delete records');
    },
    importArchive: async () => {
      assert.fail('already-attempted handoff ids should not import');
    },
    replaceUrl: (nextUrl) => {
      replacedUrls.push(nextUrl);
    },
  });

  assert.deepEqual(result, { status: 'already-attempted', handoffId: 'handoff-123' });
  assert.deepEqual(replacedUrls, ['https://urdf.example/']);
});

test('consumeHandoffImportFromUrl keeps the record when the import fails', async () => {
  const record = createRecord();
  let deleteCalls = 0;
  const replacedUrls: string[] = [];

  const result = await consumeHandoffImportFromUrl({
    currentUrl: 'https://urdf.example/?handoff=handoff-123',
    sessionStorage: createSessionStorageMock(),
    loadRecord: async () => record,
    deleteRecord: async () => {
      deleteCalls += 1;
    },
    importArchive: async () => ({ status: 'failed' }),
    replaceUrl: (nextUrl) => {
      replacedUrls.push(nextUrl);
    },
  });

  assert.deepEqual(result, { status: 'failed', handoffId: 'handoff-123' });
  assert.equal(deleteCalls, 0);
  assert.deepEqual(replacedUrls, ['https://urdf.example/']);
});

test('index boot placeholder renders only a minimal spinner before React mounts', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const html = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

  assert.match(
    html,
    /<div id="root">\s*<div class="boot-loading" aria-label="Loading">\s*<div class="boot-spinner"><\/div>\s*<\/div>\s*<\/div>/,
  );
  assert.doesNotMatch(
    html,
    /boot-(header|sidebar|inspector|workspace|view|line|tool|mark|title)/,
  );
});
