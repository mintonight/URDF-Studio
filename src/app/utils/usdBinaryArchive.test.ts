import test from 'node:test';
import assert from 'node:assert/strict';

import { convertUsdArchiveFilesToBinary } from './usdBinaryArchive.ts';

type FakeFsData = Uint8Array;

function createFakeUsdRuntime(
  options: {
    disableLayerExport?: boolean;
    failLayerExport?: boolean;
    failStageExport?: boolean;
  } = {},
) {
  const files = new Map<string, FakeFsData>();
  const layerFindOrOpenCalls: unknown[][] = [];
  const layerExportCalls: unknown[][] = [];
  const stageExportCalls: unknown[][] = [];
  const stageOpenCalls: unknown[][] = [];

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
      SdfLayer: {
        FindOrOpen: (...args: unknown[]) => {
          layerFindOrOpenCalls.push(args);
          const [sourcePath] = args as [string];
          const sourceData = files.get(sourcePath);
          if (!sourceData) {
            return null;
          }

          if (options.disableLayerExport) {
            return {};
          }

          return {
            Export: (...exportArgs: unknown[]) => {
              layerExportCalls.push(exportArgs);
              if (options.failLayerExport) {
                throw new Error('layer export rejected');
              }
              const [targetPath] = exportArgs as [string];
              const nextData = new Uint8Array(sourceData.length + 12);
              nextData.set(new TextEncoder().encode('PXR-USDCROOT'));
              nextData.set(sourceData, 12);
              files.set(targetPath, nextData);
              return true;
            },
            delete: () => {},
          };
        },
      },
      UsdStage: {
        Open: (sourcePath: string) => {
          stageOpenCalls.push([sourcePath]);
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
            delete: () => {},
          };
        },
      },
    },
  };

  return {
    runtime,
    layerFindOrOpenCalls,
    layerExportCalls,
    stageOpenCalls,
    stageExportCalls,
  };
}

test('convertUsdArchiveFilesToBinary exports each USD layer directly and leaves non-USD assets untouched', async () => {
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
    const {
      runtime,
      layerFindOrOpenCalls,
      layerExportCalls,
      stageOpenCalls,
      stageExportCalls,
    } = createFakeUsdRuntime();

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
    assert.equal(stageOpenCalls.length, 0);
    assert.equal(stageExportCalls.length, 0);
    assert.equal(layerFindOrOpenCalls.length, 1);
    assert.equal(String(layerFindOrOpenCalls[0]?.[0]).endsWith('/robot/usd/robot.usd'), true);
    assert.deepEqual(layerFindOrOpenCalls[0]?.[1], {});
    assert.equal(layerExportCalls.length, 1);
    assert.equal(String(layerExportCalls[0]?.[0]).endsWith('/robot/usd/robot.usd'), true);
    assert.equal(layerExportCalls[0]?.[1], '');
    assert.deepEqual(layerExportCalls[0]?.[2], { format: 'usdc' });
  } finally {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      (globalThis as typeof globalThis & { document?: object }).document = previousDocument;
    }
  }
});

test('convertUsdArchiveFilesToBinary preserves failed SdfLayer export causes', async () => {
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document?: Document & object }).document =
    {} as unknown as Document & object;

  try {
    const usdLayer = new Blob(['#usda 1.0\n'], { type: 'text/plain;charset=utf-8' });
    const archiveFiles = new Map<string, Blob>([['robot/usd/robot.usd', usdLayer]]);
    const { runtime } = createFakeUsdRuntime({
      failLayerExport: true,
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
        assert.match(String(error), /layer export rejected/);
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

test('convertUsdArchiveFilesToBinary does not fall back to composed stage export', async () => {
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document?: Document & object }).document =
    {} as unknown as Document & object;

  try {
    const usdLayer = new Blob(['#usda 1.0\n'], { type: 'text/plain;charset=utf-8' });
    const archiveFiles = new Map<string, Blob>([['robot/usd/robot.usd', usdLayer]]);
    const {
      runtime,
      layerExportCalls,
      stageOpenCalls,
      stageExportCalls,
    } = createFakeUsdRuntime({
      disableLayerExport: true,
    });

    await assert.rejects(
      () =>
        (
          convertUsdArchiveFilesToBinary as typeof convertUsdArchiveFilesToBinary &
            ((...args: any[]) => Promise<Map<string, Blob>>)
        )(archiveFiles, {
          loadRuntime: async () => runtime,
        } as any),
      /SdfLayer\.FindOrOpen\/Export/i,
    );

    assert.equal(layerExportCalls.length, 0);
    assert.equal(stageOpenCalls.length, 0);
    assert.equal(stageExportCalls.length, 0);
  } finally {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      (globalThis as typeof globalThis & { document?: object }).document = previousDocument;
    }
  }
});
