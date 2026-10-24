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

test('a settings file that does not parse is left untouched (review H1)', () => {
  const { dir, go } = sandbox();
  fs.mkdirSync(path.join(dir, 'c'), { recursive: true });
  const broken = '{"theme":"dark","permissions":{"allow":["Bash(npm:*)"]},}';
  fs.writeFileSync(path.join(dir, 'c', 'settings.json'), broken);
  const r = go('--agent', 'claude');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'c', 'settings.json'), 'utf8'), broken);
});

test('project scope: claude uses settings.local.json; codex and copilot need the skill in the project (review H3)', () => {
  const { dir, go } = sandbox();
  assert.equal(go('--agent', 'claude', '--scope', 'project').status, 0);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.local.json')));
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false);
  const refused = go('--agent', 'codex', '--scope', 'project');
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /needs the skill inside the project/);
  assert.equal(fs.existsSync(path.join(dir, '.codex')), false);
  const skill = path.join(dir, '.agents', 'skills', 'response-config', 'scripts');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'hook.mjs'), '');
  assert.equal(go('--agent', 'copilot', '--scope', 'project').status, 0);
  const f = fs.readFileSync(path.join(dir, '.github', 'hooks', 'response-config.json'), 'utf8');
  assert.match(f, /node '\.agents\/skills\/response-config\/scripts\/hook\.mjs'/);
});

test('instructions block contains no machine path (review H3)', () => {
  const { dir, go } = sandbox();
  go('--agent', 'claude', '--scope', 'project', '--instructions');
  const t = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(t, /response-config:start/);
  assert.doesNotMatch(t, /[A-Za-z]:\/|\/Users\/|\/home\//);
});

test('--vscode requires project scope (review M7)', () => {
  const { go } = sandbox();
  const r = go('--agent', 'copilot', '--vscode');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--scope project/);
});
