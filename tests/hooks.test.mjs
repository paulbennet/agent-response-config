import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../skills/response-config/scripts/hook.mjs';
import { loadConfig, validate } from '../skills/response-config/scripts/lib/config.mjs';
import { loadLedger, markModActive } from '../skills/response-config/scripts/lib/ledger.mjs';
import { lastAssistantText } from '../skills/response-config/scripts/lib/adapters/index.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'response-config', 'scripts', 'hook.mjs');

function env() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-test-'));
  return { ...process.env, RC_CONFIG_DIR: path.join(dir, 'cfg'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude'), dir };
}

const ctx = (e) => JSON.parse(run({ agent: 'claude', event: 'prompt', input: { session_id: 's', prompt: 'hi', cwd: e.dir }, env: e })).hookSpecificOutput.additionalContext;

test('session-start emits rules as additionalContext (claude)', () => {
  const e = env();
  const out = JSON.parse(run({ agent: 'claude', event: 'session-start', input: { session_id: 's', cwd: e.dir, source: 'startup' }, env: e }));
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /BREVITY/);
  assert.match(out.hookSpecificOutput.additionalContext, /Next IDs: A1 S1 Q1 D1/);
});

test('stop registers items, prompt resolves replies and advances IDs', () => {
  const e = env();
  run({ agent: 'claude', event: 'stop', input: { session_id: 's', cwd: e.dir, last_assistant_message: '- A1 Run tests\n- Q1 Keep flag? (yes/no)\n- S3 Cache it' }, env: e });
  const l = loadLedger('claude', 's', e);
  assert.deepEqual(l.counters, { A: 1, S: 3, Q: 1, D: 0 });
  const out = JSON.parse(run({ agent: 'claude', event: 'prompt', input: { session_id: 's', cwd: e.dir, prompt: 'Q1: yes, done A1' }, env: e })).hookSpecificOutput.additionalContext;
  assert.match(out, /User answered Q1: "yes"/);
  assert.match(out, /User done A1/);
  assert.match(out, /Open: S3/);
  assert.match(out, /Next IDs: A2 S4 Q2 D1/);
});

test('codex stop prints {} and copilot formats per event', () => {
  const e = env();
  assert.equal(run({ agent: 'codex', event: 'stop', input: { session_id: 's', cwd: e.dir, last_assistant_message: 'x' }, env: e }), '{}');
  const s = JSON.parse(run({ agent: 'copilot', event: 'session-start', input: { sessionId: 'c', cwd: e.dir }, env: e }));
  assert.match(s.additionalContext, /response-config/);
  const p = JSON.parse(run({ agent: 'copilot', event: 'prompt-transformed', input: { sessionId: 'c', cwd: e.dir, prompt: 'hi', transformedPrompt: 'hi' }, env: e }));
  assert.match(p.modifiedTransformedPrompt, /^hi\n\n\[response-config\]/);
  assert.equal(run({ agent: 'copilot', event: 'stop', input: { sessionId: 'c', cwd: e.dir }, env: e }), '');
});

test('copilot VS Code compatible payload gets Claude-style output', () => {
  const e = env();
  const out = JSON.parse(run({ agent: 'copilot', event: 'session-start', input: { session_id: 'c', hook_event_name: 'SessionStart', cwd: e.dir }, env: e }));
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
});

test('inline tags change the hint for one turn only', () => {
  const e = env();
  const hint = JSON.parse(run({ agent: 'claude', event: 'prompt', input: { session_id: 's', cwd: e.dir, prompt: 'go !verbose !level=B1' }, env: e })).hookSpecificOutput.additionalContext;
  assert.match(hint, /Tags this turn only: !verbose !level=B1/);
  assert.match(hint, /B1/);
  assert.doesNotMatch(ctx(e), /Tags this turn/);
});

test('!off silences the rules for the turn and enabled=false silences hooks', () => {
  const e = env();
  const off = JSON.parse(run({ agent: 'claude', event: 'prompt', input: { session_id: 's', cwd: e.dir, prompt: 'x !off' }, env: e })).hookSpecificOutput.additionalContext;
  assert.match(off, /off for this turn/);
  fs.mkdirSync(e.RC_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(e.RC_CONFIG_DIR, 'config.json'), JSON.stringify({ enabled: false }));
  assert.equal(run({ agent: 'claude', event: 'session-start', input: { session_id: 's', cwd: e.dir, source: 'startup' }, env: e }), '');
});

test('hooks stand down when the mod marked the session active', () => {
  const e = env();
  markModActive('s', e);
  assert.equal(run({ agent: 'claude', event: 'session-start', input: { session_id: 's', cwd: e.dir }, env: e }), '');
  assert.equal(run({ agent: 'claude', event: 'prompt', input: { session_id: 's', cwd: e.dir, prompt: 'hi' }, env: e }), '');
});

test('project config overrides user config per key; invalid layers are skipped with a problem', () => {
  const e = env();
  fs.mkdirSync(e.RC_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(e.RC_CONFIG_DIR, 'config.json'), JSON.stringify({ minimal: { level: 'low', maxWords: 50 } }));
  const proj = path.join(e.dir, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, '.response-config.json'), JSON.stringify({ minimal: { level: 'extreme' } }));
  const { config } = loadConfig({ cwd: proj, env: e });
  assert.equal(config.minimal.level, 'extreme');
  assert.equal(config.minimal.maxWords, 50);
  fs.writeFileSync(path.join(proj, '.response-config.json'), JSON.stringify({ minimal: { level: 'bogus' } }));
  const bad = loadConfig({ cwd: proj, env: e });
  assert.equal(bad.config.minimal.level, 'low');
  assert.equal(bad.problems.length, 1);
  assert.ok(validate({ nope: 1 }).length);
});

test('CLI entry never fails, even on garbage stdin', () => {
  const r = spawnSync(process.execPath, [HOOK, '--agent', 'claude', '--event', 'prompt'], { input: 'not json', encoding: 'utf8', env: env() });
  assert.equal(r.status, 0);
});

test('lastAssistantText finds assistant text in a JSONL transcript tail', () => {
  const jsonl = ['{"role":"user","content":"q"}', '{"role":"assistant","content":[{"type":"text","text":"- A1 go"}]}', '{"type":"tool","x":1}'].join('\n');
  assert.equal(lastAssistantText(jsonl), '- A1 go');
});
