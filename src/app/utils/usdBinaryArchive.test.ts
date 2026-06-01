import test from 'node:test';
import assert from 'node:assert/strict';

import { convertUsdArchiveFilesToBinary } from './usdBinaryArchive.ts';

type FakeFsData = Uint8Array;

function createFakeUsdRuntime(
  options: {
    disableRootLayerExport?: boolean;
    failRootLayerExport?: boolean;
    failStageExport?: boolean;
  } = {},
) {
  const files = new Map<string, FakeFsData>();
  const rootLayerExportCalls: unknown[][] = [];
  const stageExportCalls: unknown[][] = [];

  const runtime = {
    USD: {
      FS_createPath: () => {},
      FS_writeFile: (filePath: string, data: string | ArrayLike<number> | ArrayBufferView) => {
        if (typeof data === 'string') {
          files.set(filePath, new TextEncoder().encode(data));
          return;
        }

        const view = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
          : new Uint8Array(Array.from(data));
        files.set(filePath, view);
      },
      FS_readFile: (filePath: string) => files.get(filePath) ?? new Uint8Array(),
      FS_unlink: (filePath: string) => {
        files.delete(filePath);
      },
      flushPendingDeletes: () => {},
      UsdStage: {
        Open: (sourcePath: string) => {
          const sourceData = files.get(sourcePath);
          if (!sourceData) {
            return null;
          }

          return {
            Export: (...args: unknown[]) => {
              stageExportCalls.push(args);
              if (options.failStageExport) {
                throw new Error('stage export rejected');
              }
              const [targetPath] = args as [string];
              const nextData = new Uint8Array(sourceData.length + 12);
              nextData.set(new TextEncoder().encode('PXR-USDCFLAT'));
              nextData.set(sourceData, 12);
              files.set(targetPath, nextData);
            },
            GetRootLayer: options.disableRootLayerExport
              ? undefined
              : () => ({
                  Export: (...args: unknown[]) => {
                    rootLayerExportCalls.push(args);
                    if (options.failRootLayerExport) {
                      throw new Error('root export rejected');
                    }
                    const [targetPath] = args as [string];
                    const nextData = new Uint8Array(sourceData.length + 12);
                    nextData.set(new TextEncoder().encode('PXR-USDCROOT'));
                    nextData.set(sourceData, 12);
                    files.set(targetPath, nextData);
                    return true;
                  },
                }),
            delete: () => {},
          };
        },
      },
    },
  };

  return {
    runtime,
    rootLayerExportCalls,
    stageExportCalls,
  };
}

test('convertUsdArchiveFilesToBinary prefers root layer crate export and leaves non-USD assets untouched', async () => {
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document?: Document & object }).document =
    {} as unknown as Document & object;

  try {
    const usdLayer = new Blob(['#usda 1.0\n'], { type: 'text/plain;charset=utf-8' });
    const textureBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' });
    const archiveFiles = new Map<string, Blob>([
      ['robot/usd/robot.usd', usdLayer],
      ['robot/usd/assets/checker.png', textureBlob],
    ]);
    const progress: string[] = [];
    const { runtime, rootLayerExportCalls, stageExportCalls } = createFakeUsdRuntime();

    const converted = await (
      convertUsdArchiveFilesToBinary as typeof convertUsdArchiveFilesToBinary &
        ((...args: any[]) => Promise<Map<string, Blob>>)
    )(archiveFiles, {
      onProgress: ({ filePath }: { filePath: string }) => progress.push(filePath),
      loadRuntime: async () => runtime,
    } as any);

    assert.deepEqual(progress, ['robot/usd/robot.usd']);
    assert.equal(await converted.get('robot/usd/robot.usd')?.text(), 'PXR-USDCROOT#usda 1.0\n');
    assert.equal(converted.get('robot/usd/assets/checker.png'), textureBlob);
    assert.equal(stageExportCalls.length, 0);
    assert.equal(rootLayerExportCalls.length, 1);
    assert.equal(String(rootLayerExportCalls[0]?.[0]).endsWith('/robot/usd/robot.usd'), true);
    assert.equal(rootLayerExportCalls[0]?.[1], '');
    assert.deepEqual(rootLayerExportCalls[0]?.[2], { format: 'usdc' });
  } finally {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      (globalThis as typeof globalThis & { document?: object }).document = previousDocument;
    }
  }
});

test('convertUsdArchiveFilesToBinary preserves failed USD export attempt causes', async () => {
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document?: Document & object }).document =
    {} as unknown as Document & object;

  try {
    const usdLayer = new Blob(['#usda 1.0\n'], { type: 'text/plain;charset=utf-8' });
    const archiveFiles = new Map<string, Blob>([['robot/usd/robot.usd', usdLayer]]);
    const { runtime } = createFakeUsdRuntime({
      failRootLayerExport: true,
      failStageExport: true,
    });

    await assert.rejects(
      () =>
        (
          convertUsdArchiveFilesToBinary as typeof convertUsdArchiveFilesToBinary &
            ((...args: any[]) => Promise<Map<string, Blob>>)
        )(archiveFiles, {
          loadRuntime: async () => runtime,
        } as any),
      (error: unknown) => {
        assert.match(String(error), /root export rejected/);
        assert.match(String(error), /stage export rejected/);
        return true;
      },
    );
  } finally {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      (globalThis as typeof globalThis & { document?: object }).document = previousDocument;
    }
  }
});

test('convertUsdArchiveFilesToBinary falls back to stage export when root layer export is unavailable', async () => {
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document?: Document & object }).document =
    {} as unknown as Document & object;

  try {
    const usdLayer = new Blob(['#usda 1.0\n'], { type: 'text/plain;charset=utf-8' });
    const archiveFiles = new Map<string, Blob>([['robot/usd/robot.usd', usdLayer]]);
    const { runtime, rootLayerExportCalls, stageExportCalls } = createFakeUsdRuntime({
      disableRootLayerExport: true,
    });

    const converted = await (
      convertUsdArchiveFilesToBinary as typeof convertUsdArchiveFilesToBinary &
        ((...args: any[]) => Promise<Map<string, Blob>>)
    )(archiveFiles, {
      loadRuntime: async () => runtime,
    } as any);

    assert.equal(await converted.get('robot/usd/robot.usd')?.text(), 'PXR-USDCFLAT#usda 1.0\n');
    assert.equal(rootLayerExportCalls.length, 0);
    assert.equal(stageExportCalls.length, 1);
    assert.equal(String(stageExportCalls[0]?.[0]).endsWith('/robot/usd/robot.usd'), true);
    assert.equal(stageExportCalls[0]?.[1], false);
    assert.deepEqual(stageExportCalls[0]?.[2], { format: 'usdc' });
  } finally {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      (globalThis as typeof globalThis & { document?: object }).document = previousDocument;
    }
  }
});
