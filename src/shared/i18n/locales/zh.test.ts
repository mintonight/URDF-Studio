import assert from 'node:assert/strict';
import test from 'node:test';

import { zh } from './zh.ts';

test('advanced mode product copy stays consistent in Chinese', () => {
  assert.equal(zh.proMode, '高级模式');
  assert.match(zh.generateWorkspaceUrdfConfirmMessage, /高级模式/);
  assert.match(zh.generateWorkspaceUrdfDisconnected, /高级模式/);
  assert.match(zh.exportProjectWorkspaceSummaryDesc, /高级模式/);
  assert.match(zh.disconnectedWorkspaceUrdfExportMessage, /高级模式/);
  assert.doesNotMatch(zh.exportProjectWorkspaceSummaryDesc, /专业模式/);
});
