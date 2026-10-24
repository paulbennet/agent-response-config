import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SETUP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'response-config', 'scripts', 'setup.mjs');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-setup-'));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, 'c'), CODEX_HOME: path.join(dir, 'x'), COPILOT_HOME: path.join(dir, 'p'), HOME: dir, USERPROFILE: dir };
  const go = (...args) => spawnSync(process.execPath, [SETUP, ...args], { env, cwd: dir, encoding: 'utf8' });
  return { dir, env, go };
}

test('install is idempotent and preserves unrelated settings', () => {
  const { dir, go } = sandbox();
  fs.mkdirSync(path.join(dir, 'c'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'c', 'settings.json'), JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
  assert.equal(go('--agent', 'claude').status, 0);
  go('--agent', 'claude');
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'c', 'settings.json'), 'utf8'));
  assert.equal(s.theme, 'dark');
  assert.equal(s.hooks.Stop.length, 2);
  assert.equal(s.hooks.SessionStart.length, 1);
});

test('uninstall removes only our entries', () => {
  const { dir, go } = sandbox();
  fs.mkdirSync(path.join(dir, 'c'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'c', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
  go('--agent', 'all');
  go('--agent', 'all', '--uninstall');
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'c', 'settings.json'), 'utf8'));
  assert.deepEqual(s, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } });
  assert.equal(fs.existsSync(path.join(dir, 'p', 'hooks', 'response-config.json')), false);
});

test('copilot file has bash and powershell commands; --dry-run writes nothing', () => {
  const { dir, go } = sandbox();
  const dry = go('--agent', 'copilot', '--dry-run');
  assert.match(dry.stdout, /dry-run/);
  assert.equal(fs.existsSync(path.join(dir, 'p')), false);
  go('--agent', 'copilot');
  const f = JSON.parse(fs.readFileSync(path.join(dir, 'p', 'hooks', 'response-config.json'), 'utf8'));
  assert.equal(f.version, 1);
  assert.ok(f.hooks.sessionStart[0].bash && f.hooks.sessionStart[0].powershell);
  assert.ok(f.hooks.userPromptTransformed && f.hooks.agentStop);
});

test('instructions block is added once and removed cleanly', () => {
  const { dir, go } = sandbox();
  fs.mkdirSync(path.join(dir, 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'x', 'AGENTS.md'), '# mine\n');
  go('--agent', 'codex', '--instructions');
  go('--agent', 'codex', '--instructions');
  const t = fs.readFileSync(path.join(dir, 'x', 'AGENTS.md'), 'utf8');
  assert.equal(t.split('response-config:start').length, 2);
  go('--agent', 'codex', '--instructions', '--uninstall');
  assert.equal(fs.readFileSync(path.join(dir, 'x', 'AGENTS.md'), 'utf8'), '# mine\n');
});
