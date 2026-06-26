import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';

import { loadManagedTexture, registerManagedTextureHandlers } from './textureLoaderHandlers.ts';

test('registerManagedTextureHandlers routes .tga through TGALoader and .hdr through RGBELoader', () => {
  const manager = registerManagedTextureHandlers(new THREE.LoadingManager());

  assert.ok(manager.getHandler('model/textures/wood.tga') instanceof TGALoader);
  assert.ok(manager.getHandler('env/studio.hdr') instanceof RGBELoader);
  assert.equal(manager.getHandler('albedo.png'), null);
  assert.equal(manager.getHandler('albedo.jpg'), null);
});

test('registerManagedTextureHandlers ignores query/hash suffixes when matching extensions', () => {
  const manager = registerManagedTextureHandlers(new THREE.LoadingManager());

  assert.ok(manager.getHandler('wood.tga?v=2') instanceof TGALoader);
  assert.ok(manager.getHandler('studio.hdr#frag') instanceof RGBELoader);
});

test('registerManagedTextureHandlers returns the same manager for chaining', () => {
  const manager = new THREE.LoadingManager();
  assert.equal(registerManagedTextureHandlers(manager), manager);
});

test('loadManagedTexture routes by the extension hint even when the request url is an extensionless blob', () => {
  const tgaUrls: string[] = [];
  const rgbeUrls: string[] = [];
  const textureUrls: string[] = [];

  const originalTga = TGALoader.prototype.load;
  const originalRgbe = RGBELoader.prototype.load;
  const originalTexture = THREE.TextureLoader.prototype.load;

  TGALoader.prototype.load = function patchedLoad(url: string) {
    tgaUrls.push(url);
    return new THREE.DataTexture();
  } as typeof TGALoader.prototype.load;
  RGBELoader.prototype.load = function patchedLoad(url: string) {
    rgbeUrls.push(url);
    return new THREE.DataTexture();
  } as typeof RGBELoader.prototype.load;
  THREE.TextureLoader.prototype.load = function patchedLoad(url: string) {
    textureUrls.push(url);
    return new THREE.Texture();
  } as typeof THREE.TextureLoader.prototype.load;

  try {
    const manager = new THREE.LoadingManager();
    loadManagedTexture('models/wood.tga', 'blob:fake-tga', manager);
    loadManagedTexture('env/studio.hdr', 'blob:fake-hdr', manager);
    loadManagedTexture('textures/albedo.png', 'blob:fake-png', manager);
  } finally {
    TGALoader.prototype.load = originalTga;
    RGBELoader.prototype.load = originalRgbe;
    THREE.TextureLoader.prototype.load = originalTexture;
  }

  assert.deepEqual(tgaUrls, ['blob:fake-tga']);
  assert.deepEqual(rgbeUrls, ['blob:fake-hdr']);
  assert.deepEqual(textureUrls, ['blob:fake-png']);
});
