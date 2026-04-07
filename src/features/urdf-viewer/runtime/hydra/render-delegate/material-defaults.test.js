import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    applyUnifiedHydraMaterialDefaults,
    createHydraColorFromTuple,
    createUnifiedHydraStandardMaterial,
    createUnifiedHydraPhysicalMaterial,
    HYDRA_DEFAULT_GRAY_HEX,
    hydraMaterialRequiresPhysicalExtensions,
    HYDRA_UNIFIED_MATERIAL_DEFAULTS,
} from './material-defaults.js';

function assertColorClose(actual, expectedHex, epsilon = 1e-6) {
    const expected = new THREE.Color(expectedHex);
    assert.ok(Math.abs(actual.r - expected.r) <= epsilon, `expected r=${actual.r} to be close to ${expected.r}`);
    assert.ok(Math.abs(actual.g - expected.g) <= epsilon, `expected g=${actual.g} to be close to ${expected.g}`);
    assert.ok(Math.abs(actual.b - expected.b) <= epsilon, `expected b=${actual.b} to be close to ${expected.b}`);
}

test('createUnifiedHydraPhysicalMaterial uses shared viewer defaults', () => {
    const material = createUnifiedHydraPhysicalMaterial();

    assert.equal(material.roughness, HYDRA_UNIFIED_MATERIAL_DEFAULTS.roughness);
    assert.equal(material.metalness, HYDRA_UNIFIED_MATERIAL_DEFAULTS.metalness);
    assert.equal(material.envMapIntensity, HYDRA_UNIFIED_MATERIAL_DEFAULTS.envMapIntensity);
    assert.equal(material.toneMapped, false);
    assertColorClose(material.color, HYDRA_DEFAULT_GRAY_HEX);
});

test('createUnifiedHydraStandardMaterial uses shared viewer defaults', () => {
    const material = createUnifiedHydraStandardMaterial();

    assert.equal(material.roughness, HYDRA_UNIFIED_MATERIAL_DEFAULTS.roughness);
    assert.equal(material.metalness, HYDRA_UNIFIED_MATERIAL_DEFAULTS.metalness);
    assert.equal(material.envMapIntensity, HYDRA_UNIFIED_MATERIAL_DEFAULTS.envMapIntensity);
    assert.equal(material.toneMapped, false);
    assertColorClose(material.color, HYDRA_DEFAULT_GRAY_HEX);
});

test('applyUnifiedHydraMaterialDefaults normalizes existing material settings', () => {
    const material = new THREE.MeshPhysicalMaterial({
        roughness: 1,
        metalness: 1,
        envMapIntensity: 1,
    });

    applyUnifiedHydraMaterialDefaults(material);

    assert.equal(material.roughness, HYDRA_UNIFIED_MATERIAL_DEFAULTS.roughness);
    assert.equal(material.metalness, HYDRA_UNIFIED_MATERIAL_DEFAULTS.metalness);
    assert.equal(material.envMapIntensity, HYDRA_UNIFIED_MATERIAL_DEFAULTS.envMapIntensity);
    assert.equal(material.toneMapped, false);
});

test('createHydraColorFromTuple interprets authored SRGB tuples consistently', () => {
    const authoredTuple = [1, 0.5, 0.2];
    const expected = new THREE.Color().setRGB(
        authoredTuple[0],
        authoredTuple[1],
        authoredTuple[2],
        THREE.SRGBColorSpace,
    );
    const actual = createHydraColorFromTuple(authoredTuple, THREE.SRGBColorSpace);

    assert.ok(Math.abs(actual.r - expected.r) <= 1e-6);
    assert.ok(Math.abs(actual.g - expected.g) <= 1e-6);
    assert.ok(Math.abs(actual.b - expected.b) <= 1e-6);
});

test('hydraMaterialRequiresPhysicalExtensions only flags physical-only properties', () => {
    assert.equal(hydraMaterialRequiresPhysicalExtensions(['color', 'roughness', 'map']), false);
    assert.equal(hydraMaterialRequiresPhysicalExtensions(['color', 'clearcoat']), true);
    assert.equal(hydraMaterialRequiresPhysicalExtensions(['normalMap', 'specularColorMap']), true);
});
