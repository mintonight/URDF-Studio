import assert from 'node:assert/strict';
import test from 'node:test';

import { StepOcctResourceScope } from './stepOcctResourceScope';

function fakeWrapper(id: number, log: number[]) {
  return {
    id,
    delete() {
      log.push(id);
    },
  };
}

test('dispose deletes owned resources in reverse order', () => {
  const log: number[] = [];
  const scope = new StepOcctResourceScope();
  scope.own(fakeWrapper(1, log));
  scope.own(fakeWrapper(2, log));
  scope.own(fakeWrapper(3, log));
  scope.dispose();
  assert.deepEqual(log, [3, 2, 1]);
});

test('dispose is idempotent and does not double-delete', () => {
  const log: number[] = [];
  const scope = new StepOcctResourceScope();
  scope.own(fakeWrapper(1, log));
  scope.dispose();
  scope.dispose();
  assert.deepEqual(log, [1]);
});

test('release removes ownership so dispose skips it', () => {
  const log: number[] = [];
  const scope = new StepOcctResourceScope();
  const a = fakeWrapper(1, log);
  const b = fakeWrapper(2, log);
  scope.own(a);
  scope.own(b);
  scope.release(a);
  scope.dispose();
  assert.deepEqual(log, [2]);
});

test('cleanup still runs after a thrown callback', () => {
  const log: number[] = [];
  const scope = new StepOcctResourceScope();
  scope.own(fakeWrapper(1, log));
  scope.own(fakeWrapper(2, log));
  assert.throws(() => {
    try {
      throw new Error('boom');
    } finally {
      scope.dispose();
    }
  }, /boom/);
  assert.deepEqual(log, [2, 1]);
});
