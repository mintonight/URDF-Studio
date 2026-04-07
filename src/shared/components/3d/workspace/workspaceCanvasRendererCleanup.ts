import * as THREE from 'three';

import { disposeWebGLRenderer } from '../../../utils/three/dispose.ts';

type WorkspaceCanvasCleanupNode = HTMLCanvasElement & {
  __workspaceCanvasCleanup?: () => void;
};

export function cleanupWorkspaceCanvasRenderer(
  renderer: THREE.WebGLRenderer | null | undefined,
  contextMenuCleanup?: (() => void) | null,
): void {
  if (!renderer) {
    contextMenuCleanup?.();
    return;
  }

  const canvas = renderer.domElement as WorkspaceCanvasCleanupNode;
  const hasCanvasCleanup = typeof canvas.__workspaceCanvasCleanup === 'function';

  canvas.__workspaceCanvasCleanup?.();

  if (!hasCanvasCleanup) {
    contextMenuCleanup?.();
  }

  disposeWebGLRenderer(renderer, { forceContextLoss: true });
}
