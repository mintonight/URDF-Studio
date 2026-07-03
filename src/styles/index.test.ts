import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const css = readFileSync(path.join(process.cwd(), 'src/styles/index.css'), 'utf8');

test('global style theme exposes warning color tokens used by inspection notices', () => {
  for (const token of ['warning', 'warning-hover', 'warning-active', 'warning-soft', 'warning-border']) {
    assert.match(css, new RegExp(`--ui-${token}:`), `expected --ui-${token} to be defined`);
    assert.match(
      css,
      new RegExp(`--color-${token}: var\\(--ui-${token}\\);`),
      `expected --color-${token} to be exported through @theme`,
    );
  }
});
