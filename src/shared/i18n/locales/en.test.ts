import assert from 'node:assert/strict';
import test from 'node:test';

import { en } from './en.ts';

test('advanced mode product copy stays consistent in English', () => {
  assert.equal(en.proMode, 'Advanced');
  assert.match(en.generateWorkspaceUrdfConfirmTitle, /\bAdvanced mode\b/);
  assert.match(en.generateWorkspaceUrdfConfirmMessage, /\bAdvanced mode\b/);
  assert.match(en.generateWorkspaceUrdfDisconnected, /\bAdvanced mode\b/);
  assert.match(en.exportProjectWorkspaceSummaryDesc, /\bAdvanced mode\b/);
  assert.match(en.disconnectedWorkspaceUrdfExportMessage, /\bAdvanced mode\b/);
  assert.doesNotMatch(en.exportProjectWorkspaceSummaryDesc, /\b[Pp]ro mode\b/);
  assert.doesNotMatch(en.exportProjectWorkspaceSummaryDesc, /\bpro-mode\b/);
});
