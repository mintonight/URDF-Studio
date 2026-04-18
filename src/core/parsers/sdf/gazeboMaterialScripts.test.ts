import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveGazeboScriptMaterial } from './gazeboMaterialScripts.ts';

test('resolveGazeboScriptMaterial resolves texture paths relative to gazebo material script roots', () => {
  const material = resolveGazeboScriptMaterial({
    allFileContents: {
      'demo/materials/scripts/demo.material': `
        material Demo/Painted
        {
          technique
          {
            pass
            {
              texture_unit
              {
                texture ../textures/coat.png
              }
            }
          }
        }`,
    },
    scriptName: 'Demo/Painted',
    scriptUris: ['materials/scripts'],
    sourcePath: 'demo/model.sdf',
  });

  assert.deepEqual(material, {
    name: 'Demo/Painted',
    texture: 'demo/materials/textures/coat.png',
  });
});

test('resolveGazeboScriptMaterial extracts alpha_rejection as alphaTest', () => {
  const material = resolveGazeboScriptMaterial({
    allFileContents: {
      'demo/materials/scripts/demo.material': `
        material Demo/Leaves
        {
          technique
          {
            pass
            {
              alpha_rejection greater 128
              texture_unit
              {
                texture leaves.png
              }
            }
          }
        }`,
    },
    scriptName: 'Demo/Leaves',
    scriptUris: ['materials/scripts'],
    sourcePath: 'demo/model.sdf',
  });

  assert.deepEqual(material, {
    name: 'Demo/Leaves',
    texture: 'demo/materials/textures/leaves.png',
    alphaTest: 128 / 255,
  });
});
