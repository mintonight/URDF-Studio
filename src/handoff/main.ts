import './index.css';
import {
  POPUP_HANDOFF_PAYLOAD,
  POPUP_HANDOFF_PROTOCOL_VERSION,
  POPUP_HANDOFF_READY,
  validatePopupHandoffPayload,
} from '@/shared/utils/popupHandoffProtocol';
import { pruneExpiredPendingHandoffImports, savePendingHandoffImport } from '@/app/handoff/storage';

type Locale = 'en' | 'zh';
type Phase = 'waiting' | 'saving' | 'redirecting' | 'error';

const TRANSLATIONS: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Importing into URDF Studio\u2026',
    waitingStatus: 'Receiving files\u2026',
    noOpenerError: 'This page must be opened by the sender site.',
    savingStatus: 'Saving archive\u2026',
    redirectingStatus: 'Redirecting to editor\u2026',
    errorStatus: 'Import failed.',
  },
  zh: {
    title: '\u6b63\u5728\u5bfc\u5165 URDF Studio\u2026',
    waitingStatus: '\u6b63\u5728\u63a5\u6536\u6587\u4ef6\u2026',
    noOpenerError:
      '\u6b64\u9875\u9762\u5fc5\u987b\u7531\u53d1\u9001\u65b9\u9875\u9762\u6253\u5f00\u3002',
    savingStatus: '\u6b63\u5728\u4fdd\u5b58\u2026',
    redirectingStatus: '\u6b63\u5728\u8df3\u8f6c\u5230\u7f16\u8f91\u5668\u2026',
    errorStatus: '\u5bfc\u5165\u5931\u8d25\u3002',
  },
};

const locale: Locale =
  typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
const t = TRANSLATIONS[locale];

const root = document.getElementById('root');
if (!root) {
  throw new Error('Could not find the handoff root container.');
}

let currentPhase: Phase = 'waiting';

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

function render(errorMessage?: string): void {
  const statusText =
    currentPhase === 'waiting'
      ? t.waitingStatus
      : currentPhase === 'saving'
        ? t.savingStatus
        : currentPhase === 'redirecting'
          ? t.redirectingStatus
          : (errorMessage ?? t.errorStatus);

  const showSpinner = currentPhase !== 'error';

  root.innerHTML = `
    <main class="handoff-shell">
      <section class="handoff-card${currentPhase === 'error' ? ' handoff-error' : ''}">
        ${showSpinner ? '<div class="handoff-spinner"></div>' : ''}
        <h1 class="handoff-title">${currentPhase === 'error' ? t.errorStatus : t.title}</h1>
        <p class="handoff-status">${statusText}</p>
      </section>
    </main>
  `;
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
    currentPhase = 'error';
    render(validation.message ?? t.errorStatus);
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
    });
    redirectToEditor(savedRecord.id);
  } catch (error) {
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

render();
void pruneExpiredPendingHandoffImports().catch((error) => {
  console.error('Failed to prune expired handoff imports:', error);
});
sendReadyMessage();
