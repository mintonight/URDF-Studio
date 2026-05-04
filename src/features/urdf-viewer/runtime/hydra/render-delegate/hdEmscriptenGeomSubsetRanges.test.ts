import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const renderDelegateSourcePath = path.resolve(
  'third_party/OpenUSD/pxr/usdImaging/hdEmscripten/webRenderDelegate.cpp',
);

function extractFindContiguousSectionsBody(source: string): string {
  const signatureIndex = source.indexOf('void findContiguousSections(');
  assert.notEqual(signatureIndex, -1, 'webRenderDelegate.cpp must define findContiguousSections');

  const bodyStart = source.indexOf('{', signatureIndex);
  assert.notEqual(bodyStart, -1, 'findContiguousSections must have a function body');

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }

  assert.fail('findContiguousSections body must be closed');
}

test('hdEmscripten geom subset sections are built from real face ordinals', async () => {
  const source = await readFile(renderDelegateSourcePath, 'utf8');
  const body = extractFindContiguousSectionsBody(source);

  assert.match(
    body,
    /triangleStartByFace/,
    'subset draw ranges must be based on the triangulated start offset of every source face',
  );
  assert.doesNotMatch(
    body,
    /currentStart\s*=\s*currentLength\s*;/,
    'a discontinuous subset range must restart at the next face triangle offset, not the previous length',
  );
  assert.doesNotMatch(
    body,
    /faceVertexCounts\s*\[\s*i\s*\]/,
    'subset loop indices are not mesh face ordinals and must not index faceVertexCounts directly',
  );
  assert.match(
    body,
    /std::sort\s*\(\s*sortedFaceIndices\.begin\(\),\s*sortedFaceIndices\.end\(\)\s*\)/,
    'subset face indices should be normalized before contiguous ranges are emitted',
  );
  assert.match(
    body,
    /std::unique\s*\(\s*sortedFaceIndices\.begin\(\),\s*sortedFaceIndices\.end\(\)\s*\)/,
    'duplicate subset face indices should not duplicate draw ranges',
  );
});
