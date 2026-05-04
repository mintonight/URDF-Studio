import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  normalizeLibraryPathKey,
  normalizeVirtualDirectoryPath,
  normalizeVirtualUsdPath,
} from './pathKeys';

describe('path key normalization', () => {
  test('normalizes library keys without leading slash or query', () => {
    assert.equal(
      normalizeLibraryPathKey(' /robots//demo/../demo/usd/go2.usd?cache=1 '),
      'robots/demo/usd/go2.usd',
    );
    assert.equal(normalizeLibraryPathKey('\\pkg\\meshes\\base.stl'), 'pkg/meshes/base.stl');
  });

  test('normalizes USD virtual paths with a single leading slash', () => {
    assert.equal(
      normalizeVirtualUsdPath('unitree_model\\Go2//usd/./go2.usd?v=2026'),
      '/unitree_model/Go2/usd/go2.usd',
    );
    assert.equal(normalizeVirtualUsdPath('/unitree_model/Go2/usd/go2.usd'), '/unitree_model/Go2/usd/go2.usd');
    assert.equal(normalizeVirtualUsdPath(''), '/');
  });

  test('normalizes virtual directories with exactly one trailing slash', () => {
    assert.equal(
      normalizeVirtualDirectoryPath('unitree_model/Go2/usd/go2.usd'),
      '/unitree_model/Go2/usd/go2.usd/',
    );
    assert.equal(normalizeVirtualDirectoryPath('/unitree_model/Go2/usd'), '/unitree_model/Go2/usd/');
    assert.equal(normalizeVirtualDirectoryPath('/'), '/');
  });
});
