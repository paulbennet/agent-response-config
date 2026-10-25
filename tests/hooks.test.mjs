import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RULES_EVERY, run } from '../skills/response-config/scripts/hook.mjs';
import { loadConfig, validate } from '../skills/response-config/scripts/lib/config.mjs';
import { loadLedger, markModActive } from '../skills/response-config/scripts/lib/ledger.mjs';
import { lastAssistantText } from '../skills/response-config/scripts/lib/adapters/index.mjs';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'response-config', 'scripts');
const HOOK = path.join(SCRIPTS, 'hook.mjs');
const CLI = path.join(SCRIPTS, 'config.mjs');

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
  run({ agent: 'claude', event: 'stop', input: { session_id: 's', cwd: e.dir, last_assistant_message: 'Actions\n- A1 Run tests\nQuestions\n- Q1 Keep flag? (yes/no)\nSuggestions\n- S3 Cache it' }, env: e });
  const l = loadLedger('claude', 's', e);
  assert.deepEqual(l.counters, { A: 1, S: 3, Q: 1, D: 0 });
  const out = JSON.parse(run({ agent: 'claude', event: 'prompt', input: { session_id: 's', cwd: e.dir, prompt: 'Q1: yes, done A1' }, env: e })).hookSpecificOutput.additionalContext;
  assert.ok(out.includes('User answered Q1 (Keep flag? (yes/no)): "yes"'), out);
  assert.match(out, /User finished A1/);
  assert.match(out, /Open: S3/);
  assert.match(out, /Next IDs: A2 S4 Q2 D1/);
});

test('replay of live G8: closings with notes and "still open" do not retire IDs', () => {
  const e = env();
  const stop = (msg) => run({ agent: 'claude', event: 'stop', input: { session_id: 's', cwd: e.dir, last_assistant_message: msg }, env: e });
  const prompt = (p) => run({ agent: 'claude', event: 'prompt', input: { session_id: 's', cwd: e.dir, prompt: p }, env: e });
  stop('## Actions (A)\n- A1 Install ESLint\n- A2 Create the config\n- A3 Add the lint script\n\n## Questions (Q)\n- Q1 OK to add ESLint? (yes/no)');
  prompt('Q1: yes, done A1');
  stop('## Actions (A)\n- A1 still open: run `npm i -D eslint`\n\n## Questions (Q)\n- Q1 answered: yes\n- Q2 Should I run the install? (yes/no)');
  prompt('Q2 ok');
  stop('## Actions (A)\n- A1 done: installed eslint\n- A2 done: added the config\n- A3 done: added the script\n- A4 Run the e2e tests\n\n## Questions (Q)\n- Q2 answered: ok\n- Q3 Commit? (yes/no)');
  const l = loadLedger('claude', 's', e);
  const status = Object.fromEntries(l.items.map((i) => [i.id, i.status]));
  assert.deepEqual(status, { A1: 'done', A2: 'done', A3: 'done', Q1: 'answered', Q2: 'answered', A4: 'open', Q3: 'open' });
  assert.deepEqual(l.reused, []);
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

const session = (e) => ({
  stop: (msg) => run({ agent: 'claude', event: 'stop', input: { session_id: 's', cwd: e.dir, last_assistant_message: msg }, env: e }),
  say: (prompt) => JSON.parse(run({ agent: 'claude', event: 'prompt', input: { session_id: 's', cwd: e.dir, prompt }, env: e })).hookSpecificOutput.additionalContext,
  items: () => loadLedger('claude', 's', e).items.map((i) => `${i.id}:${i.status}:${i.text}`),
});

test('a reused ID keeps the ID the user sees; the old item is retired (review 0.1.1 N1)', () => {
  const s = session(env());
  s.stop('Actions\n- A1 Run tests\n- A2 Write docs');
  s.say('done A1');
  s.stop('Actions\n- A1 Deploy staging\n- A3 Tag release');
  assert.deepEqual(s.items(), [
    'A1~1:superseded:Run tests', 'A2:open:Write docs', 'A1:open:Deploy staging', 'A3:open:Tag release',
  ]);
  const hint = s.say('done A3');
  assert.match(hint, /reused A1 for a new item; the earlier A1 \(Run tests\) is no longer tracked/);
  assert.match(hint, /User finished A3: Tag release/);
  assert.match(hint, /Open: A2 A1/);
  assert.match(hint, /Next IDs: A4 /);
  assert.doesNotMatch(s.say('hi'), /reused A/);
});

test('two collisions in one reply both keep their displayed IDs', () => {
  const s = session(env());
  s.stop('Actions\n- A1 Run tests\n- A2 Write docs');
  s.say('done A1, done A2');
  s.stop('Actions\n- A1 Deploy staging\n- A2 Rotate keys');
  assert.deepEqual(s.items().filter((x) => x.includes(':open:')), ['A1:open:Deploy staging', 'A2:open:Rotate keys']);
  const hint = s.say('A2');
  assert.match(hint, /reused A1/);
  assert.match(hint, /reused A2/);
  assert.match(hint, /User started A2: Rotate keys/);
});

test('a recap of a finished item stays closed and is not a reuse (review 0.1.1 N2)', () => {
  const s = session(env());
  s.stop('Actions\n- A1 Run tests\n- A2 Write docs');
  s.say('done A1');
  s.stop('Summary.\n\nActions\n- A1 Run tests (completed)\n- A2 Write docs');
  assert.deepEqual(s.items(), ['A1:done:Run tests', 'A2:open:Write docs']);
  assert.doesNotMatch(s.say('hi'), /reused A/);
  s.stop('Actions\n- A2 Write docs ✓');
  assert.deepEqual(s.items(), ['A1:done:Run tests', 'A2:done:Write docs']);
});

test('a bare question ID is a pointer, not in progress (review 0.1.1 N7)', () => {
  const s = session(env());
  s.stop('Questions\n- Q1 Keep the flag? (yes/no)');
  const hint = s.say('Q1');
  assert.match(hint, /User pointed at Q1 \(Keep the flag\? \(yes\/no\)\)/);
  assert.deepEqual(s.items(), ['Q1:open:Keep the flag? (yes/no)']);
});

test('the full rules come back every RULES_EVERY prompts (review 0.1.1 N10)', () => {
  const e = env();
  run({ agent: 'copilot', event: 'session-start', input: { sessionId: 'c', cwd: e.dir }, env: e });
  const say = () => JSON.parse(run({ agent: 'copilot', event: 'prompt-transformed', input: { sessionId: 'c', cwd: e.dir, prompt: 'hi', transformedPrompt: 'hi' }, env: e })).modifiedTransformedPrompt;
  const withRules = [];
  for (let i = 1; i <= RULES_EVERY * 2; i += 1) if (/BREVITY/.test(say())) withRules.push(i);
  assert.deepEqual(withRules, [RULES_EVERY, RULES_EVERY * 2]);
});

test('project-scope style and --set --project use the project root (review 0.1.1 N3, N4)', () => {
  const e = env();
  const repo = path.join(e.dir, 'repo');
  const sub = path.join(repo, 'src', 'deep');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(sub, { recursive: true });
  const cenv = { ...e, RC_HOME_DIR: e.dir };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: sub, encoding: 'utf8', env: cenv });
  let r = cli('--set', 'claude.outputStyle.manage=true', '--set', 'claude.outputStyle.scope=project', '--project');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(repo, '.response-config.json')));
  assert.ok(!fs.existsSync(path.join(sub, '.response-config.json')));
  assert.ok(fs.existsSync(path.join(repo, '.claude', 'output-styles', 'response-config-managed.md')));
  r = cli('--set', 'minimal.level=low', '--project');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, '.response-config.json'), 'utf8')).minimal.level, 'low');
  run({ agent: 'claude', event: 'session-start', input: { session_id: 's', cwd: sub, source: 'startup' }, env: cenv });
  assert.ok(!fs.existsSync(path.join(repo, 'src', '.claude')));
  assert.ok(!fs.existsSync(path.join(sub, '.claude')));
  const shown = JSON.parse(cli('--show', '--json').stdout);
  assert.equal(shown.style, 'in-sync');
  assert.deepEqual(shown.watch.map((w) => path.basename(w.path)), ['config.json', '.response-config.json']);
  assert.deepEqual(shown.watch.map((w) => typeof w.mtimeMs), ['object', 'number']); // no user file yet
});

test('the assistant can close items itself (review M5)', () => {
  const e = env();
  const stop = (msg) => run({ agent: 'claude', event: 'stop', input: { session_id: 's', cwd: e.dir, last_assistant_message: msg }, env: e });
  stop('Actions\n- A1 Run tests\nSuggestions\n- S1 Cache it');
  stop('Tests pass.\nResolved: A1');
  const l = loadLedger('claude', 's', e);
  assert.deepEqual(l.items.map((i) => `${i.id}:${i.status}`), ['A1:done', 'S1:open']);
});

test('do marks actions and suggestions in progress alike', () => {
  const e = env();
  run({ agent: 'claude', event: 'stop', input: { session_id: 's', cwd: e.dir, last_assistant_message: 'Actions\n- A1 x\nSuggestions\n- S1 y' }, env: e });
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
