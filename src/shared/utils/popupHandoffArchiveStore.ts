import {
  POPUP_HANDOFF_STORE_DB_NAME,
  POPUP_HANDOFF_STORE_NAME,
  POPUP_HANDOFF_STORE_VERSION,
  POPUP_HANDOFF_TTL_MS,
  type PopupHandoffArchiveRecord,
} from './popupHandoffProtocol';

type PopupHandoffIndexedDbFactory = Pick<IDBFactory, 'open'>;

function createPopupHandoffId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensurePopupHandoffIndexedDb(
  indexedDbFactory: PopupHandoffIndexedDbFactory | undefined = globalThis.indexedDB,
): PopupHandoffIndexedDbFactory {
  if (!indexedDbFactory) {
    throw new Error('IndexedDB is unavailable in this browser.');
  }

  return indexedDbFactory;
}

function runPopupHandoffRequest<T>(
  request: IDBRequest<T>,
  operationDescription: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new Error(`Popup handoff storage request failed during ${operationDescription}.`),
      );
  });
}

async function openPopupHandoffDatabase(
  indexedDbFactory?: PopupHandoffIndexedDbFactory,
): Promise<IDBDatabase> {
  const factory = ensurePopupHandoffIndexedDb(indexedDbFactory);
  const request = factory.open(POPUP_HANDOFF_STORE_DB_NAME, POPUP_HANDOFF_STORE_VERSION);

  return await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(POPUP_HANDOFF_STORE_NAME)) {
        database.createObjectStore(POPUP_HANDOFF_STORE_NAME, {
          keyPath: 'id',
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open popup handoff storage.'));
  });
}

async function withPopupHandoffStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
  indexedDbFactory?: PopupHandoffIndexedDbFactory,
): Promise<T> {
  const database = await openPopupHandoffDatabase(indexedDbFactory);

  try {
    const transaction = database.transaction(POPUP_HANDOFF_STORE_NAME, mode);
    const store = transaction.objectStore(POPUP_HANDOFF_STORE_NAME);
    const result = await callback(store);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Popup handoff storage transaction failed.'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Popup handoff storage transaction aborted.'));
    });

    return result;
  } finally {
    database.close();
  }
}

export async function putPopupHandoffArchive(
  input: Omit<PopupHandoffArchiveRecord, 'id' | 'createdAt'>,
  indexedDbFactory?: PopupHandoffIndexedDbFactory,
): Promise<string> {
  const record: PopupHandoffArchiveRecord = {
    ...input,
    id: createPopupHandoffId(),
    createdAt: Date.now(),
  };

  await withPopupHandoffStore(
    'readwrite',
    async (store) => {
      await runPopupHandoffRequest(store.put(record), 'storing popup handoff archive');
    },
    indexedDbFactory,
  );

  return record.id;
}

export async function getPopupHandoffArchive(
  id: string,
  indexedDbFactory?: PopupHandoffIndexedDbFactory,
): Promise<PopupHandoffArchiveRecord | null> {
  if (!id) {
    return null;
  }

  return await withPopupHandoffStore(
    'readonly',
    async (store) =>
      (await runPopupHandoffRequest(
        store.get(id),
        'reading popup handoff archive',
      )) as PopupHandoffArchiveRecord | null,
    indexedDbFactory,
  );
}

export async function deletePopupHandoffArchive(
  id: string,
  indexedDbFactory?: PopupHandoffIndexedDbFactory,
): Promise<void> {
  if (!id) {
    return;
  }

  await withPopupHandoffStore(
    'readwrite',
    async (store) => {
      await runPopupHandoffRequest(store.delete(id), 'deleting popup handoff archive');
    },
    indexedDbFactory,
  );
}

export async function updatePopupHandoffArchiveStatus(
  id: string,
  status: 'pending' | 'consumed',
  indexedDbFactory?: PopupHandoffIndexedDbFactory,
): Promise<void> {
  await withPopupHandoffStore(
    'readwrite',
    async (store) => {
      const record = (await runPopupHandoffRequest(
        store.get(id),
        'reading popup handoff archive for status update',
      )) as PopupHandoffArchiveRecord | null;
      if (!record) {
        return;
      }
      const updatedRecord = { ...record, status };
      await runPopupHandoffRequest(store.put(updatedRecord), 'updating popup handoff status');
    },
    indexedDbFactory,
  );
}

export async function getPendingHandoffArchives(
  options: {
    now?: number;
    ttlMs?: number;
    indexedDbFactory?: PopupHandoffIndexedDbFactory;
  } = {},
): Promise<PopupHandoffArchiveRecord[]> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? POPUP_HANDOFF_TTL_MS;

  return await withPopupHandoffStore(
    'readonly',
    async (store) => {
      const allRecords =
        ((await runPopupHandoffRequest(
          store.getAll(),
          'listing popup handoff archives',
        )) as PopupHandoffArchiveRecord[]) ?? [];

      return allRecords.filter(
        (record) => record.status === 'pending' && now - record.createdAt <= ttlMs,
      );
    },
    options.indexedDbFactory,
  );
}

export async function cleanupExpiredPopupHandoffArchives(
  options: {
    now?: number;
    ttlMs?: number;
    indexedDbFactory?: PopupHandoffIndexedDbFactory;
  } = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? POPUP_HANDOFF_TTL_MS;

  return await withPopupHandoffStore(
    'readwrite',
    async (store) => {
      const allRecords =
        ((await runPopupHandoffRequest(
          store.getAll(),
          'listing popup handoff archives',
        )) as PopupHandoffArchiveRecord[]) ?? [];

      const expiredRecords = allRecords.filter((record) => now - record.createdAt > ttlMs);

      await Promise.all(
        expiredRecords.map((record) =>
          runPopupHandoffRequest(store.delete(record.id), 'cleaning expired popup handoff archive'),
        ),
      );

      return expiredRecords.length;
    },
    options.indexedDbFactory,
  );
}
