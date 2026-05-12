import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

function countLines(relativePath: string): number {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8').split('\n').length;
}

test('property-editor utility entry points stay under the 1000 line split boundary', () => {
  const files = [
    './features/property-editor/utils/geometryConversion.ts',
    './features/property-editor/utils/collisionOptimization.ts',
  ];

  files.forEach((file) => {
    const lineCount = countLines(file);
    assert.ok(lineCount <= 1000, `${file} has ${lineCount} lines; split cohesive logic out`);
  });
});

test('extracted property-editor utility modules stay focused', () => {
  const directories = [
    './features/property-editor/utils/geometry-conversion/',
    './features/property-editor/utils/collision-optimization/',
  ];

  directories.forEach((directory) => {
    readdirSync(new URL(directory, import.meta.url))
      .filter((fileName) => fileName.endsWith('.ts') && !fileName.endsWith('.test.ts'))
      .forEach((fileName) => {
        const file = `${directory}${fileName}`;
        const lineCount = countLines(file);
        assert.ok(lineCount <= 800, `${file} has ${lineCount} lines; split it again`);
      });
  });
});
