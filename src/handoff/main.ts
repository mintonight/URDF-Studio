import './index.css';
import {
  POPUP_HANDOFF_PAYLOAD,
  POPUP_HANDOFF_PROTOCOL_VERSION,
  POPUP_HANDOFF_READY,
  POPUP_HANDOFF_RESULT,
  type PopupHandoffResultKind,
  validatePopupHandoffPayload,
} from '@/shared/utils/popupHandoffProtocol';
import { getPopupHandoffArchive } from '@/shared/utils/popupHandoffArchiveStore';
import { pruneExpiredPendingHandoffImports, savePendingHandoffImport } from '@/app/handoff/storage';

type Locale = 'en' | 'zh';
type Phase = 'waiting' | 'saving' | 'activating' | 'redirecting' | 'error';

const TRANSLATIONS: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Importing into URDF Studio...',
    waitingStatus: 'Receiving files...',
    noOpenerError: 'This page must be opened by the sender site.',
    savingStatus: 'Saving archive...',
    redirectingStatus: 'Redirecting to editor...',
    errorStatus: 'Import failed.',
    pluginTitle: 'Activating Plugin...',
    pluginStatus: 'Activating plugin...',
    pluginRedirecting: 'Redirecting to editor...',
  },
  zh: {
    title: '正在导入 URDF Studio...',
    waitingStatus: '正在接收文件...',
    noOpenerError: '此页面必须由发送方页面打开。',
    savingStatus: '正在保存...',
    redirectingStatus: '正在跳转到编辑器...',
    errorStatus: '导入失败。',
    pluginTitle: '正在激活插件...',
    pluginStatus: '正在激活插件...',
    pluginRedirecting: '正在跳转到编辑器...',
  },
};

const locale: Locale =
  typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en';
const t = TRANSLATIONS[locale];

const root = document.getElementById('root');
if (!root) {
  throw new Error('Could not find the handoff root container.');
}

let currentPhase: Phase = 'waiting';
let isPluginFlow = false;

function redirectTopluginEditor(pluginKey: string): void {
  currentPhase = 'redirecting';
  render();
  const nextUrl = new URL('./', window.location.href);
  nextUrl.searchParams.set('plugin', pluginKey);
  window.location.assign(nextUrl.toString());
}

function redirectToEditor(handoffId: string): void {
  currentPhase = 'redirecting';
  render();
  const nextUrl = new URL('./', window.location.href);
  nextUrl.searchParams.set('handoff', handoffId);
  window.location.assign(nextUrl.toString());
}

function sendReadyMessage(): void {
  if (!window.opener) {
    currentPhase = 'error';
    render(t.noOpenerError);
    return;
  }

  window.opener.postMessage(
    {
      type: POPUP_HANDOFF_READY,
      version: POPUP_HANDOFF_PROTOCOL_VERSION,
    },
    '*',
  );
}

function sendResultMessage(result: PopupHandoffResultKind): void {
  if (!window.opener) return;
  try {
    window.opener.postMessage(
      {
        type: POPUP_HANDOFF_RESULT,
        version: POPUP_HANDOFF_PROTOCOL_VERSION,
        result,
      },
      '*',
    );
  } catch {
    // Opener may have navigated away — ignore
  }
}

function render(errorMessage?: string): void {
  const isPlugin =
    currentPhase === 'activating' || (currentPhase === 'redirecting' && isPluginFlow);
  const statusText =
    currentPhase === 'waiting'
      ? t.waitingStatus
      : currentPhase === 'saving'
        ? t.savingStatus
        : currentPhase === 'activating'
          ? t.pluginStatus
          : currentPhase === 'redirecting'
            ? isPlugin
              ? t.pluginRedirecting
              : t.redirectingStatus
            : (errorMessage ?? t.errorStatus);

  const showSpinner = currentPhase !== 'error';
  const title = currentPhase === 'error' ? t.errorStatus : isPlugin ? t.pluginTitle : t.title;

  root.innerHTML = `
    <main class="handoff-shell">
      <section class="handoff-card${currentPhase === 'error' ? ' handoff-error' : ''}">
        ${showSpinner ? '<div class="handoff-spinner"></div>' : ''}
        <h1 class="handoff-title">${title}</h1>
        <p class="handoff-status">${statusText}</p>
      </section>
    </main>
  `;
}

async function trySilentHandoff(handoffId: string): Promise<boolean> {
  const POLL_INTERVAL_MS = 500;
  const TIMEOUT_MS = 5000;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const pollInterval = setInterval(async () => {
      if (Date.now() - startTime >= TIMEOUT_MS) {
        clearInterval(pollInterval);
        resolve(false);
        return;
      }

      try {
        const record = await getPopupHandoffArchive(handoffId);
        // Record consumed (status changed) or deleted by main tab — either means success
        if (!record || record.status === 'consumed') {
          clearInterval(pollInterval);
          resolve(true);
        }
      } catch {
        // IndexedDB read error — keep polling
      }
    }, POLL_INTERVAL_MS);
  });
}

async function handlePayloadMessage(data: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  zip: Blob;
}): Promise<void> {
  const validation = validatePopupHandoffPayload({
    fileName: data.fileName,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
  });

  if (!validation.ok) {
    sendResultMessage('failed');
    currentPhase = 'error';
    const message = (validation as { message: string }).message;
    render(message);
    return;
  }

  currentPhase = 'saving';
  render();

  try {
    await pruneExpiredPendingHandoffImports();
    const savedRecord = await savePendingHandoffImport({
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      sourceOrigin: window.opener ? '*' : '',
      zipBlob: data.zip,
      status: 'pending',
    });

    const isSilentSuccess = await trySilentHandoff(savedRecord.id);
    if (isSilentSuccess) {
      // An existing editor tab consumed the archive — notify opener and close
      sendResultMessage('existing-tab');
      currentPhase = 'redirecting';
      render(t.redirectingStatus);
      setTimeout(() => {
        window.close();
      }, 500);
    } else {
      // No existing tab picked it up — open a new editor tab
      sendResultMessage('new-tab');
      redirectToEditor(savedRecord.id);
    }
  } catch (error) {
    sendResultMessage('failed');
    currentPhase = 'error';
    render(error instanceof Error ? error.message : t.errorStatus);
  }
}

window.addEventListener('message', (event) => {
  if (!window.opener || event.source !== window.opener) {
    return;
  }

  const data = event.data;
  if (
    data?.type === POPUP_HANDOFF_PAYLOAD &&
    data?.version === POPUP_HANDOFF_PROTOCOL_VERSION &&
    data?.zip instanceof Blob
  ) {
    void handlePayloadMessage(data);
  }
});

// ---------------------------------------------------------------------------
//  Plugin activation path: ?plugin=<key>
//  When present, the popup writes a lightweight record to IndexedDB and waits
//  for the main editor tab to consume it.  No postMessage ZIP exchange needed.
// ---------------------------------------------------------------------------
async function handlePluginActivation(pluginKey: string): Promise<void> {
  isPluginFlow = true;
  currentPhase = 'activating';
  render();

  try {
    await pruneExpiredPendingHandoffImports();
    const savedRecord = await savePendingHandoffImport({
      fileName: '__plugin-activate__',
      mimeType: '',
      sizeBytes: 0,
      sourceOrigin: window.opener ? '*' : '',
      status: 'pending',
      pluginKey,
    });

    const isSilentSuccess = await trySilentHandoff(savedRecord.id);
    if (isSilentSuccess) {
      sendResultMessage('existing-tab');
      currentPhase = 'redirecting';
      render();
      setTimeout(() => {
        window.close();
      }, 500);
    } else {
      sendResultMessage('new-tab');
      redirectTopluginEditor(pluginKey);
    }
  } catch (error) {
    sendResultMessage('failed');
    currentPhase = 'error';
    render(error instanceof Error ? error.message : t.errorStatus);
  }
}

// ---------------------------------------------------------------------------
//  Bootstrap
// ---------------------------------------------------------------------------
render();
void pruneExpiredPendingHandoffImports().catch((error) => {
  console.error('Failed to prune expired handoff imports:', error);
});

const pluginKeyParam = new URLSearchParams(window.location.search).get('plugin');
if (pluginKeyParam) {
  void handlePluginActivation(pluginKeyParam);
} else {
  sendReadyMessage();
}
