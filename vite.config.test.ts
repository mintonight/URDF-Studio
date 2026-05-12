import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';

import { createServer, loadConfigFromFile, type UserConfig } from 'vite';

function listen(server: net.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener('error', onError);
      reject(error);
    };

    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function reserveFreePort(): Promise<number> {
  const probe = net.createServer();
  await listen(probe, 0);

  const address = probe.address();
  assert.ok(address && typeof address !== 'string');

  await close(probe);
  return address.port;
}

test('dev server falls back to another port when the requested port is occupied', async () => {
  const occupiedPort = await reserveFreePort();
  const blocker = net.createServer();
  let viteServer: Awaited<ReturnType<typeof createServer>> | null = null;

  await listen(blocker, occupiedPort);

  try {
    const loaded = await loadConfigFromFile(
      {
        command: 'serve',
        mode: 'development',
        isSsrBuild: false,
        isPreview: false,
      },
      path.resolve('vite.config.ts'),
    );

    assert.ok(loaded?.config);

    viteServer = await createServer({
      ...(loaded.config as UserConfig),
      clearScreen: false,
      configFile: false,
      logLevel: 'silent',
      server: {
        ...loaded.config.server,
        host: '127.0.0.1',
        port: occupiedPort,
      },
    });

    await viteServer.listen();

    const address = viteServer.httpServer?.address();
    assert.ok(address && typeof address !== 'string');
    assert.notEqual(address.port, occupiedPort);
  } finally {
    if (viteServer) {
      await viteServer.close();
    }

    await close(blocker);
  }
});
