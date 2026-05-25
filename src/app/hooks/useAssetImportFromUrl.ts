import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HANDOFF_BROADCAST_CHANNEL,
  HANDOFF_BROADCAST_TIMEOUT_MS,
  type HandoffBroadcastMessage,
  isAllowedHandoffOrigin,
  readImportParamsFromUrl,
  stripImportParamsFromUrl,
} from '@/shared/utils/popupHandoffProtocol';

// ---------------------------------------------------------------------------
//  Title blink utility — draws attention to an existing tab
// ---------------------------------------------------------------------------

let blinkTimer: ReturnType<typeof setInterval> | null = null;
let blinkTimeout: ReturnType<typeof setTimeout> | null = null;
let savedOriginalTitle: string | null = null;

/** Flag to prevent self-delegation: when this tab is broadcasting an import-request,
 *  its own listener must not claim it. */
let isDelegating = false;

function startTitleBlink(alertTitle: string) {
  // Clean up any existing blink first
  stopTitleBlink();

  savedOriginalTitle = document.title;
  let show = true;

  blinkTimer = setInterval(() => {
    document.title = show ? alertTitle : savedOriginalTitle;
    show = !show;
  }, 800);

  // Auto-restore after 5 seconds
  blinkTimeout = setTimeout(() => stopTitleBlink(), 5000);

  // Restore immediately when user focuses this tab
  const onVis = () => {
    if (!document.hidden) {
      stopTitleBlink();
      document.removeEventListener('visibilitychange', onVis);
    }
  };
  document.addEventListener('visibilitychange', onVis);
}

function stopTitleBlink() {
  if (blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
  if (blinkTimeout) {
    clearTimeout(blinkTimeout);
    blinkTimeout = null;
  }
  if (savedOriginalTitle !== null) {
    document.title = savedOriginalTitle;
    savedOriginalTitle = null;
  }
}

interface FileDownloadInfo {
  path: string;
  url: string;
}

interface AssetDownloadResponse {
  success: boolean;
  message?: string;
  data?: {
    files: FileDownloadInfo[];
    rootFolderName: string;
    urdfFile?: string;
  };
}

export interface ImportFromUrlProgress {
  /** Current file index (1-based) */
  current: number;
  /** Total number of files to download */
  total: number;
  /** Name of the file currently being downloaded */
  currentFileName?: string;
}

export type ImportPhase = 'waiting' | 'fetching' | 'downloading' | 'importing' | 'complete';

interface ImportFromUrlState {
  isImporting: boolean;
  error: string | null;
  phase: ImportPhase | null;
  progress: ImportFromUrlProgress | null;
}

type UseAssetImportFromUrlOptions = {
  handleImport: (files: readonly File[]) => Promise<{ status: 'completed' | 'skipped' | 'failed' }>;
  onImportComplete?: (success: boolean) => void;
};

/**
 * Hook to import assets from BOT-World via URL parameters.
 * Supports existing-tab detection via BroadcastChannel:
 *   - If an existing Studio tab is open, it claims the import and the new tab closes.
 *   - If no existing tab responds, the new tab handles the import itself.
 */
export function useAssetImportFromUrl(options: UseAssetImportFromUrlOptions) {
  const { handleImport, onImportComplete } = options;

  const [state, setState] = useState<ImportFromUrlState>({
    isImporting: false,
    error: null,
    phase: null,
    progress: null,
  });

  // Refs so BroadcastChannel listeners can access latest callbacks
  const handleImportRef = useRef(handleImport);
  handleImportRef.current = handleImport;
  const onImportCompleteRef = useRef(onImportComplete);
  onImportCompleteRef.current = onImportComplete;

  // -----------------------------------------------------------------------
  //  Core import logic (shared by self-import and delegated import)
  // -----------------------------------------------------------------------
  const importAssetFromBotWorld = useCallback(async (assetId: string, fromOrigin: string) => {
    if (!isAllowedHandoffOrigin(fromOrigin)) {
      setState({
        isImporting: false,
        error: `Unauthorized origin: ${fromOrigin}`,
        phase: null,
        progress: null,
      });
      console.error('[AssetImport] Unauthorized origin:', fromOrigin);
      return { success: false };
    }

    setState({ isImporting: true, error: null, phase: 'fetching', progress: null });

    try {
      const apiUrl = new URL('/api/download-asset', fromOrigin);
      const token = import.meta.env.VITE_API_TOKEN;

      const response = await fetch(apiUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ assetId }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const result: AssetDownloadResponse = await response.json();
      if (!result.success || !result.data?.files) {
        throw new Error(result.message || 'Failed to fetch asset files');
      }

      const { files, rootFolderName } = result.data;

      setState({
        isImporting: true,
        error: null,
        phase: 'downloading',
        progress: {
          current: 0,
          total: files.length,
          currentFileName: files[0]?.path.split('/').pop(),
        },
      });

      const downloadedFiles: File[] = [];
      for (let i = 0; i < files.length; i++) {
        const fileInfo = files[i];
        setState((prev) => ({
          ...prev,
          progress: {
            current: i,
            total: files.length,
            currentFileName: fileInfo.path.split('/').pop() || fileInfo.path,
          },
        }));

        const fileResp = await fetch(fileInfo.url);
        if (!fileResp.ok) {
          throw new Error(`Failed to download ${fileInfo.path}: ${fileResp.statusText}`);
        }

        const blob = await fileResp.blob();
        const fileName = fileInfo.path.split('/').pop() || fileInfo.path;
        const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });

        Object.defineProperty(file, 'webkitRelativePath', {
          value: `${rootFolderName}/${fileInfo.path}`,
          configurable: true,
        });

        downloadedFiles.push(file);

        setState((prev) => ({
          ...prev,
          progress: { current: i + 1, total: files.length, currentFileName: fileName },
        }));
      }

      setState({
        isImporting: true,
        error: null,
        phase: 'importing',
        progress: { current: files.length, total: files.length },
      });
      await handleImportRef.current(downloadedFiles);

      setState({ isImporting: false, error: null, phase: 'complete', progress: null });

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[AssetImport] Import failed:', message);
      setState({ isImporting: false, error: message, phase: null, progress: null });
      return { success: false };
    }
  }, []);

  // -----------------------------------------------------------------------
  //  BroadcastChannel: listen for import requests from new tabs.
  //  When this (existing) tab receives an import-request, it claims it
  //  by sending import-accepted, then performs the import.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const channel = new BroadcastChannel(HANDOFF_BROADCAST_CHANNEL);

    channel.onmessage = (event: MessageEvent<HandoffBroadcastMessage>) => {
      const msg = event.data;
      if (msg?.type === 'import-request' && !isDelegating) {
        // Claim the import immediately
        channel.postMessage({
          type: 'import-accepted',
          assetId: msg.assetId,
        } satisfies HandoffBroadcastMessage);

        // Perform the import in this existing tab
        void importAssetFromBotWorld(msg.assetId, msg.fromOrigin).then((result) => {
          onImportCompleteRef.current?.(result.success);
        });

        // Blink title to alert user (auto-restores when tab is focused or after 5s)
        startTitleBlink('新资产导入 - URDF Studio');
      }
    };

    return () => channel.close();
  }, [importAssetFromBotWorld]);

  // -----------------------------------------------------------------------
  //  On mount: if URL has import params, show waiting overlay, try
  //  delegating to an existing tab. If no tab responds, handle here.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = readImportParamsFromUrl(window.location.href);
    if (!params) return;

    // Clean URL immediately to prevent re-processing
    const nextUrl = stripImportParamsFromUrl(window.location.href);
    window.history.replaceState(window.history.state, '', nextUrl);

    // Show waiting overlay while checking for existing tab
    setState({ isImporting: true, error: null, phase: 'waiting', progress: null });

    const channel = new BroadcastChannel(HANDOFF_BROADCAST_CHANNEL);
    let settled = false;

    const cleanup = () => {
      settled = true;
      channel.close();
    };

    // Listen for an existing tab accepting the import
    channel.onmessage = (event: MessageEvent<HandoffBroadcastMessage>) => {
      const msg = event.data;
      if (msg?.type === 'import-accepted' && msg.assetId === params.assetId && !settled) {
        cleanup();
        isDelegating = false;
        // Existing tab claimed it — close this new tab
        try {
          window.close();
        } catch {
          /* close() may be blocked */
        }
      }
    };

    // Broadcast the import request
    isDelegating = true;
    channel.postMessage({
      type: 'import-request',
      assetId: params.assetId,
      fromOrigin: params.fromOrigin,
    } satisfies HandoffBroadcastMessage);

    // If no existing tab responds, handle import here
    setTimeout(() => {
      if (!settled) {
        cleanup();
        isDelegating = false;
        void importAssetFromBotWorld(params.assetId, params.fromOrigin).then((result) => {
          onImportCompleteRef.current?.(result.success);
        });
      }
    }, HANDOFF_BROADCAST_TIMEOUT_MS);

    // No cleanup — the channel is closed by either the import-accepted
    // handler or the timeout. Closing it in cleanup would break Strict
    // Mode (channel dies before import-accepted arrives → double import).
  }, [importAssetFromBotWorld]);

  return {
    ...state,
    importAssetFromBotWorld,
  };
}
