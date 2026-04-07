import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('import preparation stays on worker-safe file-io utility imports', async () => {
  const sourcePath = path.resolve('src/app/utils/importPreparation.ts');
  const source = await readFile(sourcePath, 'utf8');

  assert.doesNotMatch(
    source,
    /from ['"]@\/features\/file-io['"]/,
    'worker-facing import preparation must not depend on the feature barrel',
  );
});
