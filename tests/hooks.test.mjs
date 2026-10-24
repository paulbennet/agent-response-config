import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  assert.ok(out.includes('User answered Q1 (Keep flag? (yes/no)): "yes"'), out);
  assert.match(out, /User finished A1/);
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
  assert.match(hint, /CEFR B1/);
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

test('prompt hint carries the full rules until a session hint was delivered (review H4)', () => {
  const e = env();
  assert.match(ctx(e), /BREVITY/);
  const second = ctx(e);
  assert.doesNotMatch(second, /BREVITY/);
  assert.match(second, /Rules: brevity high/);
  const e2 = env();
  run({ agent: 'claude', event: 'session-start', input: { session_id: 's', cwd: e2.dir, source: 'startup' }, env: e2 });
  assert.doesNotMatch(ctx(e2), /BREVITY/);
});

test('a reused ID is renumbered and announced on the next prompt (review M4)', () => {
  const e = env();
  const stop = (msg) => run({ agent: 'claude', event: 'stop', input: { session_id: 's', cwd: e.dir, last_assistant_message: msg }, env: e });
  stop('- A1 Run tests');
  run({ agent: 'claude', event: 'prompt', input: { session_id: 's', cwd: e.dir, prompt: 'done A1' }, env: e });
  stop('- A1 Deploy to staging');
  const l = loadLedger('claude', 's', e);
  assert.deepEqual(l.items.map((i) => `${i.id}:${i.status}`), ['A1:done', 'A2:open']);
  assert.match(ctx(e), /reused A1; that item is now A2/);
});

test('the assistant can close items itself (review M5)', () => {
  const e = env();
  const stop = (msg) => run({ agent: 'claude', event: 'stop', input: { session_id: 's', cwd: e.dir, last_assistant_message: msg }, env: e });
  stop('- A1 Run tests\n- S1 Cache it');
  stop('Tests pass.\nResolved: A1');
  const l = loadLedger('claude', 's', e);
  assert.deepEqual(l.items.map((i) => `${i.id}:${i.status}`), ['A1:done', 'S1:open']);
});

test('do marks actions and suggestions in progress alike', () => {
  const e = env();
  run({ agent: 'claude', event: 'stop', input: { session_id: 's', cwd: e.dir, last_assistant_message: '- A1 x\n- S1 y' }, env: e });
  run({ agent: 'claude', event: 'prompt', input: { session_id: 's', cwd: e.dir, prompt: 'A1, S1' }, env: e });
  assert.deepEqual(loadLedger('claude', 's', e).items.map((i) => i.status), ['in-progress', 'in-progress']);
});

test('a broken user config is reported, not silently ignored', () => {
  const e = env();
  fs.mkdirSync(e.RC_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(e.RC_CONFIG_DIR, 'config.json'), '{ "minimal": { "level": "low" }, }');
  const { problems } = loadConfig({ cwd: e.dir, env: e });
  assert.match(problems[0], /not valid JSON/);
});

test('project config search stops at the home directory (review L6)', () => {
  const e = env();
  const home = path.join(e.dir, 'home');
  fs.mkdirSync(path.join(home, 'work', 'proj'), { recursive: true });
  fs.writeFileSync(path.join(home, '.response-config.json'), JSON.stringify({ minimal: { level: 'low' } }));
  const { config } = loadConfig({ cwd: path.join(home, 'work', 'proj'), env: { ...e, RC_HOME_DIR: home } });
  assert.equal(config.minimal.level, 'high');
});

test('session ids with a .jsonl suffix match the mod marker (review M8)', () => {
  const e = env();
  markModActive('abc.jsonl', e);
  assert.equal(run({ agent: 'claude', event: 'prompt', input: { session_id: 'abc', cwd: e.dir, prompt: 'hi' }, env: e }), '');
});

test('importing hook.mjs without argv[1] does not crash (review M6)', () => {
  const url = pathToFileURL(HOOK).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)}); console.log('ok')`], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'ok', r.stderr);
});

test('codex stop still prints {} when the hook throws', () => {
  const r = spawnSync(process.execPath, [HOOK, '--agent', 'codex', '--event', 'stop'], { input: '{"session_id":"s","cwd":42}', encoding: 'utf8', env: env() });
  assert.equal(r.stdout.trim(), '{}');
  assert.equal(r.status, 0);
});
