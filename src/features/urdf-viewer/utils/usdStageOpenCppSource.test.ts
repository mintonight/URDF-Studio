import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webSyncDriverPath = fileURLToPath(
  new URL(
    '../../../../third_party/OpenUSD/pxr/usdImaging/hdEmscripten/webSyncDriver.h',
    import.meta.url,
  ),
);

test('HdWebSyncDriver sensor-skipping stage open reuses the LoadNone stage when no sensor payload is skipped', () => {
  const source = readFileSync(webSyncDriverPath, 'utf8');

  assert.doesNotMatch(
    source,
    /if\s*\(\s*!skippedSensorPayload\s*\)\s*{\s*return\s+UsdStage::Open\(usdFilePath\);\s*}/,
  );
  assert.match(
    source,
    /if\s*\(\s*!loadSet\.empty\(\)\s*\)\s*{\s*stage->LoadAndUnload\(loadSet,\s*SdfPathSet\(\),\s*UsdLoadWithDescendants\);/,
  );
});
