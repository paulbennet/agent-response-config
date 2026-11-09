#!/usr/bin/env node
// Live Claude Code check of the plugin hooks (testing-plan G5 to G8, run as N5 on macOS and Linux).
// Needs `claude` on PATH and a login (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY).
// The agent gets no tools, so it can only answer in text.
//   node tools/live-ci.mjs [--plugin-dir <repo>]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--plugin-dir');
const pluginDir = i > 0 ? path.resolve(process.argv[i + 1]) : root;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-live-'));
const rcDir = path.join(work, 'rc');
const project = path.join(work, 'project');
fs.mkdirSync(project, { recursive: true });
spawnSync('git', ['init', '-q'], { cwd: project });
const env = { ...process.env, RC_CONFIG_DIR: rcDir };
// An installed copy of the plugin would answer the same hooks; only the --plugin-dir copy runs.
const settings = path.join(work, 'settings.json');
fs.writeFileSync(settings, JSON.stringify({ enabledPlugins: { 'response-config@response-config': false } }));
// Windows runs claude.cmd through the shell, so each argument is quoted there.
const win = process.platform === 'win32';
const q = (a) => (win ? `"${a.replace(/"/g, '\\"')}"` : a);

function claude(prompt, resume) {
  const args = ['-p', '--settings', settings, '--plugin-dir', pluginDir, '--tools', '', '--include-hook-events',
    '--output-format', 'stream-json', '--verbose'];
  if (resume) args.push('--resume', resume);
  args.push(prompt);
  const r = spawnSync('claude', args.map(q), { cwd: project, env, encoding: 'utf8', timeout: 240000, shell: win });
  const msgs = String(r.stdout || '').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return {}; }
  });
  const result = msgs.find((m) => m.type === 'result');
  if (!result) throw new Error(`claude gave no result (exit ${r.status}): ${String(r.stderr || r.stdout).slice(0, 800)}`);
  return { msgs, result };
}

const hookOut = (msgs, event) =>
  msgs.filter((m) => m.subtype === 'hook_response' && m.hook_event === event).map((m) => m.output || '').join('\n');
const ledger = (sid) => JSON.parse(fs.readFileSync(path.join(rcDir, 'sessions', `claude-${sid}.json`), 'utf8'));

let failed = 0;
function check(id, what, fn) {
  try {
    fn();
    console.log(`PASS  ${id}  ${what}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${id}  ${what}  [${e.message}]`);
  }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

console.log(`claude ${spawnSync('claude', ['--version'], { encoding: 'utf8', shell: win }).stdout.trim()}, ${process.platform}`);

const t1 = claude('Give me two next actions to learn git, as items.');
const sid = t1.result.session_id;
console.log(`--- turn 1 reply:\n${t1.result.result}\n---`);
check('G5', 'SessionStart sends the rules', () =>
  assert(/\[response-config\]/.test(hookOut(t1.msgs, 'SessionStart')), 'no [response-config] in SessionStart output'));
check('G6', 'the per-prompt hook sends its hint', () =>
  assert(/\[response-config\]/.test(hookOut(t1.msgs, 'UserPromptSubmit')), 'no [response-config] in UserPromptSubmit output'));
let first;
check('G7', 'Stop fills the ledger with the reply items', () => {
  const open = ledger(sid).items.filter((it) => it.status === 'open' && it.type === 'A');
  assert(open.length > 0, 'no open action in the ledger');
  first = open[0].id;
});

if (first) {
  const t2 = claude(`done ${first}`, sid);
  console.log(`--- turn 2 reply:\n${t2.result.result}\n---`);
  check('G8', `the quick reply "done ${first}" closes the item`, () => {
    const it = ledger(sid).items.find((x) => x.id === first);
    assert(it && it.status === 'done', `${first} is ${it ? it.status : 'missing'}`);
  });
  check('G6b', 'the turn 2 hint lists the open items', () =>
    assert(/Next IDs:/.test(hookOut(t2.msgs, 'UserPromptSubmit')), 'no Next IDs line'));
}

fs.rmSync(work, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
