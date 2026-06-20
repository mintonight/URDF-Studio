import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

import type { AssemblyState } from '@/types';
import { useJointPickSessionStore, type PickedSnapFrame } from '@/store/jointPickSessionStore';
import { CoordinateAxes } from '@/shared/components/3d/helpers/CoordinateAxes';
import { throttle } from '@/shared/utils';

import { resolveJointSnapFromHit, type ResolvedJointSnap } from '../utils/jointSnapResolver';

const PICK_THROTTLE_MS = 33;
const PICK_MOVE_THRESHOLD_PX = 2;
const PICK_CLICK_DRAG_THRESHOLD_PX = 5;
// Clicks inside these overlay containers must never place a snap point.
const PICK_POINTER_IGNORE_SELECTORS = [
  '.urdf-toolbar',
  '.urdf-options-panel',
  '.urdf-joint-panel',
  '.draggable-window',
];
const PICK_RENDER_ORDER = 2500;
const FRAME_SIZE = 0.05;

const SNAP_TONE = {
  valid: '#22d3ee',
  invalid: '#94a3b8',
  parent: '#0ea5e9',
  child: '#10b981',
} as const;

function isFreePointOverride(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

interface AssemblyJointPickLayerProps {
  robot: THREE.Object3D | null;
  assemblyState: AssemblyState | null;
  hidden?: boolean;
}

interface HoverSnap {
  valid: boolean;
  point: THREE.Vector3;
  pose: THREE.Matrix4 | null;
}

function decomposeMatrix(matrix: THREE.Matrix4): {
  position: [number, number, number];
  quaternion: [number, number, number, number];
} {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return {
    position: [position.x, position.y, position.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
  };
}

const FrameAxes = memo(({ matrix, opacity = 1 }: { matrix: THREE.Matrix4; opacity?: number }) => {
  const { position, quaternion } = useMemo(() => decomposeMatrix(matrix), [matrix]);
  return (
    <group position={position} quaternion={quaternion}>
      <CoordinateAxes
        size={FRAME_SIZE}
        depthTest={false}
        renderOrder={PICK_RENDER_ORDER}
        opacity={opacity}
      />
    </group>
  );
});

const SnapDot = memo(
  ({ point, tone, radius = 0.007 }: { point: THREE.Vector3; tone: string; radius?: number }) => (
    <mesh position={point} renderOrder={PICK_RENDER_ORDER + 1}>
      <sphereGeometry args={[radius, 16, 16]} />
      <meshBasicMaterial color={tone} depthTest={false} depthWrite={false} transparent opacity={0.96} />
    </mesh>
  ),
);

const CommittedSnap = memo(({ frame, tone }: { frame: PickedSnapFrame; tone: string }) => {
  const matrix = useMemo(
    () => new THREE.Matrix4().fromArray(frame.poseWorldMatrix),
    [frame.poseWorldMatrix],
  );
  const point = useMemo(
    () => new THREE.Vector3(frame.pointWorld.x, frame.pointWorld.y, frame.pointWorld.z),
    [frame.pointWorld.x, frame.pointWorld.y, frame.pointWorld.z],
  );
  return (
    <group>
      <SnapDot point={point} tone={tone} />
      <FrameAxes matrix={matrix} opacity={0.92} />
    </group>
  );
});

export const AssemblyJointPickLayer = memo(
  ({ robot, assemblyState, hidden = false }: AssemblyJointPickLayerProps) => {
    const { camera, gl } = useThree();
    const active = useJointPickSessionStore((state) => state.active);
    const side = useJointPickSessionStore((state) => state.side);
    const snapFilter = useJointPickSessionStore((state) => state.snapFilter);
    const parentComponentId = useJointPickSessionStore((state) => state.parentComponentId);
    const parentLinkId = useJointPickSessionStore((state) => state.parentLinkId);
    const childComponentId = useJointPickSessionStore((state) => state.childComponentId);
    const childLinkId = useJointPickSessionStore((state) => state.childLinkId);
    const parentSnap = useJointPickSessionStore((state) => state.parentSnap);
    const childSnap = useJointPickSessionStore((state) => state.childSnap);
    const commitSnap = useJointPickSessionStore((state) => state.commitSnap);

    const [hover, setHover] = useState<HoverSnap | null>(null);

    const expectedComponentId = side === 'parent' ? parentComponentId : childComponentId;
    const expectedLinkId = side === 'parent' ? parentLinkId : childLinkId;

    // Latest values for the throttled DOM handlers (avoids stale closures).
    const ctxRef = useRef({ side, snapFilter, expectedComponentId, expectedLinkId, assemblyState, robot });
    useEffect(() => {
      ctxRef.current = { side, snapFilter, expectedComponentId, expectedLinkId, assemblyState, robot };
    }, [side, snapFilter, expectedComponentId, expectedLinkId, assemblyState, robot]);

    useEffect(() => {
      if (!active || hidden || !robot || !assemblyState) {
        setHover(null);
        return undefined;
      }

      const domElement = gl.domElement;
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let lastX = 0;
      let lastY = 0;
      let downX = 0;
      let downY = 0;

      const updatePointer = (event: MouseEvent): boolean => {
        const rect = domElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return false;
        }
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        return true;
      };

      const raycastSnap = (freePointOverride = false): { snap: ResolvedJointSnap; valid: boolean } | null => {
        const ctx = ctxRef.current;
        if (!ctx.robot || !ctx.assemblyState) {
          return null;
        }
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObject(ctx.robot, true);
        for (const hit of hits) {
          if (hit.object.userData?.isHelper || hit.object.userData?.isGizmo) {
            continue;
          }
          const snap = resolveJointSnapFromHit(
            { object: hit.object, point: hit.point, faceIndex: hit.faceIndex },
            ctx.assemblyState,
            ctx.snapFilter,
            {
              camera,
              domSize: {
                width: domElement.clientWidth,
                height: domElement.clientHeight,
              },
              freePointOverride,
            },
          );
          if (snap) {
            const componentMatches =
              !ctx.expectedComponentId || snap.componentId === ctx.expectedComponentId;
            const linkMatches = !ctx.expectedLinkId || snap.linkId === ctx.expectedLinkId;
            return { snap, valid: componentMatches && linkMatches };
          }
        }
        return null;
      };

      const handleMoveCore = (event: MouseEvent) => {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        if (dx * dx + dy * dy < PICK_MOVE_THRESHOLD_PX * PICK_MOVE_THRESHOLD_PX) {
          return;
        }
        lastX = event.clientX;
        lastY = event.clientY;

        if (!updatePointer(event)) {
          setHover(null);
          return;
        }
        const result = raycastSnap(isFreePointOverride(event));
        if (!result) {
          setHover(null);
          return;
        }
        setHover({
          valid: result.valid,
          point: result.snap.chosen.pointWorld.clone(),
          pose: result.valid ? result.snap.chosen.poseWorld.clone() : null,
        });
      };

      const throttledMove = throttle(handleMoveCore, PICK_THROTTLE_MS);

      const handleDown = (event: MouseEvent) => {
        downX = event.clientX;
        downY = event.clientY;
      };

      const handleClick = (event: MouseEvent) => {
        if (event.button !== 0) {
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target && PICK_POINTER_IGNORE_SELECTORS.some((selector) => target.closest(selector))) {
          return;
        }
        // Ignore the click that ends an orbit drag.
        const ddx = event.clientX - downX;
        const ddy = event.clientY - downY;
        if (
          ddx * ddx + ddy * ddy >
          PICK_CLICK_DRAG_THRESHOLD_PX * PICK_CLICK_DRAG_THRESHOLD_PX
        ) {
          return;
        }
        if (!updatePointer(event)) {
          return;
        }
        const result = raycastSnap(isFreePointOverride(event));
        if (!result || !result.valid) {
          return;
        }
        const { snap } = result;
        commitSnap({
          side: ctxRef.current.side,
          componentId: snap.componentId,
          linkId: snap.linkId,
          kind: snap.chosen.kind,
          pointWorld: {
            x: snap.chosen.pointWorld.x,
            y: snap.chosen.pointWorld.y,
            z: snap.chosen.pointWorld.z,
          },
          poseWorldMatrix: snap.chosen.poseWorld.toArray(),
          linkWorldMatrix: snap.linkWorldMatrix.toArray(),
        });
        setHover(null);
      };

      domElement.addEventListener('mousemove', throttledMove);
      domElement.addEventListener('mousedown', handleDown);
      domElement.addEventListener('click', handleClick);

      return () => {
        throttledMove.cancel();
        domElement.removeEventListener('mousemove', throttledMove);
        domElement.removeEventListener('mousedown', handleDown);
        domElement.removeEventListener('click', handleClick);
        setHover(null);
      };
    }, [active, hidden, robot, assemblyState, camera, gl, commitSnap]);

    const connectorPoints = useMemo(() => {
      if (!parentSnap || !childSnap) {
        return null;
      }
      return [
        new THREE.Vector3(parentSnap.pointWorld.x, parentSnap.pointWorld.y, parentSnap.pointWorld.z),
        new THREE.Vector3(childSnap.pointWorld.x, childSnap.pointWorld.y, childSnap.pointWorld.z),
      ];
    }, [parentSnap, childSnap]);

    if (!active || hidden) {
      return null;
    }

    return (
      <group>
        {hover ? (
          <>
            <SnapDot point={hover.point} tone={hover.valid ? SNAP_TONE.valid : SNAP_TONE.invalid} />
            {hover.valid && hover.pose ? <FrameAxes matrix={hover.pose} /> : null}
          </>
        ) : null}
        {parentSnap ? <CommittedSnap frame={parentSnap} tone={SNAP_TONE.parent} /> : null}
        {childSnap ? <CommittedSnap frame={childSnap} tone={SNAP_TONE.child} /> : null}
        {connectorPoints ? (
          <Line
            points={connectorPoints}
            color="#f59e0b"
            lineWidth={1.5}
            dashed
            dashSize={0.02}
            gapSize={0.012}
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={0.8}
            renderOrder={PICK_RENDER_ORDER}
          />
        ) : null}
      </group>
    );
  },
);

AssemblyJointPickLayer.displayName = 'AssemblyJointPickLayer';
