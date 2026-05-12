import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { JointType } from '@/types';

import {
  patchUrdfJointLimitInSource,
  patchUsdJointLimitInSource,
} from './jointEditableSourcePatch.ts';

const dom = new JSDOM('');

if (!globalThis.DOMParser) {
  globalThis.DOMParser = dom.window.DOMParser;
}

test('patchUrdfJointLimitInSource updates only the targeted joint limit attributes', () => {
  const source = `<robot name="go2">
  <joint name="FL_hip_joint" type="revolute">
    <parent link="base" />
    <child link="fl_hip" />
    <limit lower="-1.0472" upper="1.0472" effort="23.7" velocity="30.1" />
  </joint>
  <joint name="FR_hip_joint" type="revolute">
    <parent link="base" />
    <child link="fr_hip" />
    <limit lower="-1.0472" upper="1.0472" effort="23.7" velocity="30.1" />
  </joint>
</robot>
`;

  const patched = patchUrdfJointLimitInSource({
    sourceContent: source,
    jointName: 'FL_hip_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 12,
    },
  });

  assert.match(
    patched,
    /<joint name="FL_hip_joint"[\s\S]*?<limit lower="-0\.5" upper="0\.8" effort="25" velocity="12" \/>/,
  );
  assert.match(
    patched,
    /<joint name="FR_hip_joint"[\s\S]*?<limit lower="-1\.0472" upper="1\.0472" effort="23\.7" velocity="30\.1" \/>/,
  );
});

test('patchUsdJointLimitInSource updates only the targeted joint block', () => {
  const source = `#usda 1.0
def Xform "go2"
{
    over "joints"
    {
        def PhysicsRevoluteJoint "FL_hip_joint"
        {
            float drive:angular:physics:maxForce = 23.7
            float physics:lowerLimit = -60
            float physics:upperLimit = 60
            float physxJoint:maxJointVelocity = 1724.5
        }

        def PhysicsRevoluteJoint "FR_hip_joint"
        {
            float drive:angular:physics:maxForce = 23.7
            float physics:lowerLimit = -60
            float physics:upperLimit = 60
            float physxJoint:maxJointVelocity = 1724.5
        }
    }
}
`;

  const patched = patchUsdJointLimitInSource({
    sourceContent: source,
    jointName: 'FL_hip_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 10,
    },
  });

  assert.match(
    patched,
    /"FL_hip_joint"[\s\S]*?float drive:angular:physics:maxForce = 25[\s\S]*?float physics:lowerLimit = -28\.6478898[\s\S]*?float physics:upperLimit = 45\.8366236[\s\S]*?float physxJoint:maxJointVelocity = 572\.9577951/,
  );
  assert.match(
    patched,
    /"FR_hip_joint"[\s\S]*?float drive:angular:physics:maxForce = 23\.7[\s\S]*?float physics:lowerLimit = -60[\s\S]*?float physics:upperLimit = 60[\s\S]*?float physxJoint:maxJointVelocity = 1724\.5/,
  );
});
