import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = path.resolve('scripts/omx_tmux_grid.sh');
const defaultSessionName = 'omx-urdf-studio';

function createFakeTmux() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omx-tmux-test-'));
  const logPath = path.join(dir, 'tmux.log');
  const paneCounterPath = path.join(dir, 'pane-counter.txt');
  const hudCounterPath = path.join(dir, 'hud-counter.txt');
  const fakeTmuxPath = path.join(dir, 'tmux');

  fs.writeFileSync(paneCounterPath, '1\n', 'utf8');
  fs.writeFileSync(hudCounterPath, '0\n', 'utf8');
  fs.writeFileSync(
    fakeTmuxPath,
    `#!/usr/bin/env node
const fs = require('node:fs');

const args = process.argv.slice(2);
const logPath = process.env.FAKE_TMUX_LOG;
const paneCounterPath = process.env.FAKE_TMUX_COUNTER;
const hudCounterPath = process.env.FAKE_TMUX_HUD_COUNTER;

if (logPath) {
  fs.appendFileSync(logPath, JSON.stringify(args) + '\\n', 'utf8');
}

function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
}

function readNumber(filePath, fallback = 0) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  return Number(fs.readFileSync(filePath, 'utf8').trim() || String(fallback));
}

function writeNumber(filePath, value) {
  if (!filePath) {
    return;
  }
  fs.writeFileSync(filePath, String(value) + '\\n', 'utf8');
}

function hasSession(target) {
  return (process.env.FAKE_TMUX_EXISTING_SESSIONS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(target);
}

const command = args[0];

if (command === 'has-session') {
  process.exit(hasSession(argValue('-t')) ? 0 : 1);
}

if (command === 'list-windows') {
  const target = argValue('-t');
  const output = target.endsWith('-backup')
    ? process.env.FAKE_TMUX_BACKUP_WINDOWS || ''
    : process.env.FAKE_TMUX_WINDOWS || '';
  process.stdout.write(output);
  process.exit(0);
}

if (command === 'display-message') {
  process.stdout.write('%1\\n');
  process.exit(0);
}

if (command === 'list-panes') {
  const format = argValue('-F');
  if (format === '#{pane_id}') {
    process.stdout.write((process.env.FAKE_TMUX_FIRST_PANE || '%1') + '\\n');
    process.exit(0);
  }

  if (format.includes('#{pane_id}') && format.includes('#{pane_start_command}')) {
    const snapshots = (process.env.FAKE_TMUX_HUD_SNAPSHOTS || '').split('|||').filter(Boolean);
    const index = readNumber(hudCounterPath, 0);
    writeNumber(hudCounterPath, index + 1);
    const fallback = '%1\\tomx --madmax\\n';
    const output = snapshots.length === 0
      ? fallback
      : (snapshots[index] ?? snapshots[snapshots.length - 1]);
    process.stdout.write(output);
    process.exit(0);
  }

  process.stdout.write('');
  process.exit(0);
}

if (command === 'split-window') {
  const current = readNumber(paneCounterPath, 1);
  const next = current + 1;
  writeNumber(paneCounterPath, next);
  process.stdout.write('%' + next + '\\n');
  process.exit(0);
}

process.exit(0);
`,
    { mode: 0o755 },
  );

  return { dir, logPath, paneCounterPath, hudCounterPath };
}

function readTmuxLog(logPath) {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  return fs
    .readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runScript(fakeTmux, args = [], extraEnv = {}) {
  return spawnSync('bash', [scriptPath, ...args], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeTmux.dir}:${process.env.PATH}`,
      FAKE_TMUX_LOG: fakeTmux.logPath,
      FAKE_TMUX_COUNTER: fakeTmux.paneCounterPath,
      FAKE_TMUX_HUD_COUNTER: fakeTmux.hudCounterPath,
      OMX_TMUX_GRID_HUD_CLEANUP_POLLS: '12',
      OMX_TMUX_GRID_HUD_CLEANUP_INTERVAL: '0.01',
      ...extraEnv,
    },
  });
}

async function waitForLogMatch(logPath, pattern, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const content = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    if (pattern.test(content)) {
      return content;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
}

test('omx_tmux_grid.sh creates a fresh 10-pane grid for a new session', () => {
  const fakeTmux = createFakeTmux();
  const result = runScript(fakeTmux, ['--command', '', '--no-attach'], {
    FAKE_TMUX_EXISTING_SESSIONS: '',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created 10 panes in session/);

  const commands = readTmuxLog(fakeTmux.logPath).map((entry) => entry[0]);
  assert.ok(commands.includes('new-session'));
  assert.equal(commands.filter((command) => command === 'split-window').length, 9);
  assert.ok(!commands.includes('kill-pane'));
  assert.ok(!commands.includes('attach-session'));
});

test('omx_tmux_grid.sh rebuilds the managed window instead of reusing it by default', () => {
  const fakeTmux = createFakeTmux();
  const result = runScript(fakeTmux, ['--command', '', '--no-attach'], {
    FAKE_TMUX_EXISTING_SESSIONS: defaultSessionName,
    FAKE_TMUX_WINDOWS: 'omx-grid\n',
    FAKE_TMUX_BACKUP_WINDOWS: '',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Creating a temporary replacement window/);
  assert.match(result.stdout, /Backing up existing window/);

  const commands = readTmuxLog(fakeTmux.logPath).map((entry) => entry[0]);
  assert.ok(commands.includes('new-window'));
  assert.ok(commands.includes('rename-window'));
  assert.ok(commands.includes('move-window'));
  assert.ok(!commands.includes('attach-session'));
});

test('omx_tmux_grid.sh removes late OMX auto-attached HUD panes by default', async () => {
  const fakeTmux = createFakeTmux();
  const result = runScript(fakeTmux, ['--no-attach'], {
    FAKE_TMUX_EXISTING_SESSIONS: '',
    FAKE_TMUX_HUD_SNAPSHOTS: [
      '%1\tomx --madmax\n',
      '%1\tomx --madmax\n',
      '%1\tomx --madmax\n',
      '%1\tomx --madmax\n%11\tnode /tmp/omx hud --watch\n',
      '%1\tomx --madmax\n',
      '%1\tomx --madmax\n',
    ].join('|||'),
  });

  assert.equal(result.status, 0, result.stderr);
  const log = await waitForLogMatch(fakeTmux.logPath, /"kill-pane"/);
  assert.match(log, /"kill-pane"/);
});

test('omx_tmux_grid.sh preserves HUD panes when --keep-hud is set', () => {
  const fakeTmux = createFakeTmux();
  const result = runScript(fakeTmux, ['--keep-hud', '--no-attach'], {
    FAKE_TMUX_EXISTING_SESSIONS: '',
    FAKE_TMUX_HUD_SNAPSHOTS: '%1\tomx --madmax\n%11\tnode /tmp/omx hud --watch\n',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(fs.readFileSync(fakeTmux.logPath, 'utf8'), /"kill-pane"/);
});
