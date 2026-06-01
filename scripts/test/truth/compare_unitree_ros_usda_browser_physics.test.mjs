import assert from 'node:assert/strict';
import test from 'node:test';

import { compareUnitreeRosUsdaBrowserPhysics } from './compare_unitree_ros_usda_browser_physics.mjs';

function browserReport(links) {
  return {
    results: [
      {
        modelKey: 'go2_description/urdf/go2_description.usda',
        targetFileName: 'go2_description/urdf/go2_description.usda',
        selectedFileName: 'go2_description/urdf/go2_description.usda',
        snapshot: {
          store: {
            links,
          },
        },
      },
    ],
  };
}

function browserLink(id, mass, centerOfMass = [0, 0, 0]) {
  return {
    id,
    name: id,
    mass,
    centerOfMass: {
      xyz: {
        x: centerOfMass[0],
        y: centerOfMass[1],
        z: centerOfMass[2],
      },
    },
  };
}

function truthReport(rigidBodies) {
  return {
    'test/unitree_ros_usda/go2_description/urdf/go2_description.usda': {
      open_ok: true,
      rigidBodies,
    },
  };
}

function truthBody(name, mass, centerOfMass = [0, 0, 0]) {
  return {
    fullPath: `/go2_description/${name}`,
    mass,
    centerOfMass,
  };
}

test('compareUnitreeRosUsdaBrowserPhysics passes exact mass and center-of-mass parity', () => {
  const comparison = compareUnitreeRosUsdaBrowserPhysics({
    browserReport: browserReport([
      browserLink('base', 6.921, [0.021112, 0, -0.005366]),
      browserLink('FL_calf_rotor', 0.089, [0, 0, 0]),
    ]),
    truthReport: truthReport({
      '/base': truthBody('base', 6.921, [0.021112, 0, -0.005366]),
      '/FL_calf_rotor': truthBody('FL_calf_rotor', 0.089, [0, 0, 0]),
    }),
  });

  assert.equal(comparison.pass, true);
  assert.equal(comparison.summary.matchedLinks, 2);
  assert.equal(comparison.summary.missingLinks, 0);
  assert.equal(comparison.summary.massMismatches, 0);
  assert.equal(comparison.summary.comMismatches, 0);
});

test('compareUnitreeRosUsdaBrowserPhysics fails when meshless physics links are missing', () => {
  const comparison = compareUnitreeRosUsdaBrowserPhysics({
    browserReport: browserReport([browserLink('base', 6.921, [0.021112, 0, -0.005366])]),
    truthReport: truthReport({
      '/base': truthBody('base', 6.921, [0.021112, 0, -0.005366]),
      '/FL_calf_rotor': truthBody('FL_calf_rotor', 0.089, [0, 0, 0]),
    }),
  });

  assert.equal(comparison.pass, false);
  assert.equal(comparison.summary.missingLinks, 1);
  assert.equal(comparison.failures[0]?.type, 'missing-browser-link');
  assert.equal(comparison.failures[0]?.link, 'FL_calf_rotor');
});

test('compareUnitreeRosUsdaBrowserPhysics treats missing MassAPI truth mass as zero', () => {
  const comparison = compareUnitreeRosUsdaBrowserPhysics({
    browserReport: browserReport([browserLink('base', 1, [0, 0, 0])]),
    truthReport: truthReport({
      '/base': truthBody('base', null, null),
    }),
  });

  assert.equal(comparison.pass, false);
  assert.equal(comparison.summary.massMismatches, 1);
  assert.equal(comparison.failures[0]?.type, 'mass-mismatch');
  assert.equal(comparison.failures[0]?.truthMass, 0);
});

test('compareUnitreeRosUsdaBrowserPhysics fails on link-local COM drift', () => {
  const comparison = compareUnitreeRosUsdaBrowserPhysics({
    browserReport: browserReport([browserLink('base', 6.921, [1.2, 0, -0.005366])]),
    truthReport: truthReport({
      '/base': truthBody('base', 6.921, [0.021112, 0, -0.005366]),
    }),
    comTolerance: 1e-6,
  });

  assert.equal(comparison.pass, false);
  assert.equal(comparison.summary.comMismatches, 1);
  assert.equal(comparison.failures[0]?.type, 'center-of-mass-mismatch');
});
