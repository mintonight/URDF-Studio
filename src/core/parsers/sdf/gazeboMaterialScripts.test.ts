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
