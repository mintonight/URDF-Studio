#!/usr/bin/env node

/**
 * MuJoCo Source Editor browser regression test.
 *
 * Covers: importing an MJCF fixture, opening the real source/code UI,
 * verifying Monaco content, and confirming edits can be made while the
 * source editor remains mounted.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert, assertEqual, assertGreaterThan,
  importModel, waitForReady, getTopology, store, writeReport, printSummary,
} from './helpers/mjcf-helpers.mjs';

const MODEL = { dir: 'unitree_go2', file: 'go2.xml' };

async function openSourceEditor(page) {
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const button = buttons.find((candidate) => {
      const label = `${candidate.textContent ?? ''} ${candidate.title ?? ''} ${candidate.getAttribute('aria-label') ?? ''}`;
      return /source\s*code|source|code|xml/i.test(label);
    });
    button?.click();
    return Boolean(button);
  });
  if (!clicked) return false;

  return page.waitForFunction(
    () => Boolean(window.monaco?.editor?.getModels?.().length) || Boolean(document.querySelector('.monaco-editor')),
    { timeout: 45_000 },
  ).then(() => true).catch(() => false);
}

async function readSourceEditor(page) {
  return page.evaluate(() => {
    const monacoModel = window.monaco?.editor?.getModels?.()[0] ?? null;
    const monacoEditors = window.monaco?.editor?.getEditors?.() ?? [];
    const text = monacoModel?.getValue?.() ?? document.querySelector('.monaco-editor')?.textContent ?? '';
    const saveButton = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim().toLowerCase() === 'save',
    );
    const visibleText = document.body?.innerText ?? '';
    return {
      hasMonacoModel: Boolean(monacoModel),
      hasMonacoEditor: Boolean(monacoEditors.length) || Boolean(document.querySelector('.monaco-editor')),
      languageId: monacoModel?.getLanguageId?.() ?? null,
      text,
      hasMjcfLabel: /MJCF\/XML/i.test(visibleText),
      saveDisabled: saveButton instanceof HTMLButtonElement ? saveButton.disabled : null,
      modifiedVisible: /\bModified\b/i.test(visibleText),
    };
  });
}

async function main() {
  const suite = createTestSuite('MuJoCo Source Editor');
  let session = null;
  const report = { model: MODEL, steps: [] };

  try {
    session = await createSession();
    const { page } = session;

    await importModel(page, MODEL.dir, MODEL.file);
    await waitForReady(page);
    const baseline = await getTopology(page);
    report.baseline = { name: baseline.name, links: baseline.linkCount, joints: baseline.jointCount };

    assertGreaterThan(suite, baseline.linkCount, 10, 'Go2 MJCF links loaded');
    assertGreaterThan(suite, baseline.jointCount, 10, 'Go2 MJCF joints loaded');
    assertEqual(suite, baseline.name, 'go2', 'baseline MJCF model name');

    const editorReady = await openSourceEditor(page);
    assert(suite, editorReady, 'source/code UI opens with Monaco');

    const editor = await readSourceEditor(page);
    report.editor = {
      hasMonacoModel: editor.hasMonacoModel,
      languageId: editor.languageId,
      hasMjcfLabel: editor.hasMjcfLabel,
      saveDisabled: editor.saveDisabled,
      sourceLength: editor.text.length,
    };
    assert(suite, editor.hasMonacoEditor, 'Monaco editor container present');
    assert(suite, editor.hasMonacoModel, 'Monaco text model present');
    assert(suite, editor.hasMjcfLabel, 'MJCF/XML document label visible');
    assert(suite, editor.text.includes('<mujoco model="go2"'), 'source contains MJCF root');
    assert(suite, editor.text.includes('<worldbody>'), 'source contains worldbody');
    assert(suite, editor.text.includes('FL_hip_joint'), 'source contains Go2 joint');
    assert(suite, editor.text.includes('foot.obj'), 'source contains mesh asset references');

    await store.setName(page, 'go2_source_editor_regression');
    await delay(300);
    const renamed = await getTopology(page);
    assertEqual(suite, renamed.name, 'go2_source_editor_regression', 'robot can be edited while source editor is open');
    assertEqual(suite, renamed.linkCount, baseline.linkCount, 'store edit preserves link count');
    assertEqual(suite, renamed.jointCount, baseline.jointCount, 'store edit preserves joint count');

    await store.undo(page);
    await delay(300);
    const afterUndo = await getTopology(page);
    assertEqual(suite, afterUndo.linkCount, baseline.linkCount, 'undo keeps topology intact after source save');

    const errs = session.errors();
    report.errors = errs;
    assert(suite, errs.page.length === 0, 'no page errors');
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    assert(suite, false, `unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (session) await session.cleanup();
  }

  await writeReport('mujoco_source_editor', report);
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
