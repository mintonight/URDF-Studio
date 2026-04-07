export type WorkspaceCanvasWebglFailureReason =
  | 'missing-api'
  | 'context-creation-failed'
  | 'context-lost';

export interface WorkspaceCanvasWebglSupportState {
  supported: boolean;
  reason?: WorkspaceCanvasWebglFailureReason;
  detail?: string;
}

interface WebglProbeWindowLike {
  WebGLRenderingContext?: unknown;
  WebGL2RenderingContext?: unknown;
}

interface WebglLoseContextExtensionLike {
  loseContext?: () => void;
}

interface WebglContextLike {
  isContextLost?: () => boolean;
  getExtension?: (name: string) => WebglLoseContextExtensionLike | null;
}

interface WebglCanvasLike {
  getContext: (
    contextId: 'webgl2' | 'webgl' | 'experimental-webgl',
    attributes?: WebGLContextAttributes,
  ) => WebglContextLike | null;
}

interface WebglDocumentLike {
  createElement: (tagName: 'canvas') => WebglCanvasLike | null;
}

interface WorkspaceCanvasWebglProbeEnvironment {
  window?: WebglProbeWindowLike;
  document?: WebglDocumentLike;
}

const PROBE_ATTRIBUTES: WebGLContextAttributes = {
  antialias: false,
  alpha: true,
  depth: true,
  failIfMajorPerformanceCaveat: false,
  powerPreference: 'high-performance',
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  stencil: false,
};

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    const normalized = error.message.trim();
    return normalized.length > 0 ? normalized : error.name;
  }

  if (typeof error === 'string') {
    const normalized = error.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

export function probeWorkspaceCanvasWebglSupport(
  environment: WorkspaceCanvasWebglProbeEnvironment = globalThis as WorkspaceCanvasWebglProbeEnvironment,
): WorkspaceCanvasWebglSupportState {
  const probeWindow = environment.window;
  const probeDocument = environment.document;

  if (!probeWindow || !probeDocument) {
    return { supported: true };
  }

  if (!probeWindow.WebGLRenderingContext && !probeWindow.WebGL2RenderingContext) {
    return {
      supported: false,
      reason: 'missing-api',
      detail: 'WebGL APIs are unavailable in the current browser environment.',
    };
  }

  const canvas = probeDocument.createElement('canvas');
  if (!canvas || typeof canvas.getContext !== 'function') {
    return {
      supported: false,
      reason: 'context-creation-failed',
      detail: 'Unable to create a temporary canvas for WebGL probing.',
    };
  }

  try {
    const context =
      canvas.getContext('webgl2', PROBE_ATTRIBUTES) ??
      canvas.getContext('webgl', PROBE_ATTRIBUTES) ??
      canvas.getContext('experimental-webgl', PROBE_ATTRIBUTES);

    if (!context) {
      return {
        supported: false,
        reason: 'context-creation-failed',
        detail: 'Unable to create a WebGL rendering context.',
      };
    }

    if (typeof context.isContextLost === 'function' && context.isContextLost()) {
      return {
        supported: false,
        reason: 'context-lost',
        detail: 'The browser created a WebGL context, but it was already lost.',
      };
    }

    context.getExtension?.('WEBGL_lose_context')?.loseContext?.();

    return { supported: true };
  } catch (error) {
    return {
      supported: false,
      reason: 'context-creation-failed',
      detail: getErrorMessage(error) ?? 'Unknown WebGL initialization error.',
    };
  }
}

export function getWorkspaceCanvasErrorDetail(error: unknown): string | undefined {
  return getErrorMessage(error);
}
