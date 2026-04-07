import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { RobotInspectorController } from './robot-inspector.js';

test('RobotInspectorController initialize/dispose manages global listeners exactly once', () => {
  const dom = new JSDOM(`
    <!doctype html>
    <div id="panel"></div>
    <div id="header"></div>
    <div id="list"></div>
  `);

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
  });

  const panel = dom.window.document.getElementById('panel');
  const header = dom.window.document.getElementById('header');
  const list = dom.window.document.getElementById('list');

  assert.ok(panel);
  assert.ok(header);
  assert.ok(list);

  const windowAdds: string[] = [];
  const windowRemoves: string[] = [];
  const headerAdds: string[] = [];
  const headerRemoves: string[] = [];

  const originalWindowAdd = dom.window.addEventListener.bind(dom.window);
  const originalWindowRemove = dom.window.removeEventListener.bind(dom.window);
  const originalHeaderAdd = header.addEventListener.bind(header);
  const originalHeaderRemove = header.removeEventListener.bind(header);

  dom.window.addEventListener = ((type, listener, options) => {
    windowAdds.push(String(type));
    return originalWindowAdd(type, listener, options);
  }) as typeof dom.window.addEventListener;

  dom.window.removeEventListener = ((type, listener, options) => {
    windowRemoves.push(String(type));
    return originalWindowRemove(type, listener, options);
  }) as typeof dom.window.removeEventListener;

  header.addEventListener = ((type, listener, options) => {
    headerAdds.push(String(type));
    return originalHeaderAdd(type, listener, options);
  }) as typeof header.addEventListener;

  header.removeEventListener = ((type, listener, options) => {
    headerRemoves.push(String(type));
    return originalHeaderRemove(type, listener, options);
  }) as typeof header.removeEventListener;

  try {
    const controller = new RobotInspectorController({
      panel,
      header,
      list,
      requestSnapshot: async () => null,
    });

    controller.initialize();
    controller.initialize();

    assert.deepEqual(headerAdds, ['pointerdown']);
    assert.deepEqual(windowAdds, ['pointermove', 'pointerup', 'pointercancel']);

    controller.dispose();
    controller.dispose();

    assert.deepEqual(headerRemoves, ['pointerdown']);
    assert.deepEqual(windowRemoves, ['pointermove', 'pointerup', 'pointercancel']);
  } finally {
    dom.window.addEventListener = originalWindowAdd;
    dom.window.removeEventListener = originalWindowRemove;
    header.addEventListener = originalHeaderAdd;
    header.removeEventListener = originalHeaderRemove;

    Object.assign(globalThis, {
      window: previousWindow,
      document: previousDocument,
    });
    dom.window.close();
  }
});
