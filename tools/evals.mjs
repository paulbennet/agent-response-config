#!/usr/bin/env node
// Reply-quality evals (docs/testing-plan.md, section M) against a live agent, headless.
// Usage: node tools/evals.mjs --agent claude|codex|copilot [--cases M1,M3] [--out <dir>]
// Needs the agent's response-config hooks installed for the user (Claude: the plugin or
// `setup.mjs --agent claude --scope user`; Codex and Copilot: `setup.mjs --agent <agent> --scope user`).
// Each case runs in its own throwaway project with its own RC_CONFIG_DIR, so the person's config
// and ledgers are never touched. Run it from a normal terminal, not inside an agent session.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAssistantItems } from '../skills/response-config/scripts/lib/parse.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const AGENT = flag('agent') ?? 'claude';
const ONLY = flag('cases')?.split(',').map((s) => s.trim().toUpperCase());
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.resolve(flag('out') ?? path.join(REPO, 'evals', 'results', `${AGENT}-${STAMP}`));
const TURN_MS = 6 * 60 * 1000;

// ---------------------------------------------------------------- text measures

// Prose: the reply without fenced code, tables, headings and inline code.
export function prose(text) {
  return String(text)
    .replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, ' ')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\|/.test(l) && !/^\s*#{1,6}\s/.test(l) && !/^( {4}|\t)/.test(l)
      && !/^\s*\**(actions?|suggestions?|questions?|decisions?)(\s*\([A-Z]\))?\**\s*:?\s*\**\s*$/i.test(l))
    .join('\n')
    .replace(/`[^`]*`/g, ' ');
}
const words = (t) => t.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? [];
export function sentences(text) {
  return prose(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
    .filter((s) => words(s).length > 0);
}
const syllables = (w) => {
  const m = w.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, m ? m.length : 1);
};
export function measure(text) {
  const ws = words(prose(text));
  const ss = sentences(text);
  const lens = ss.map((s) => words(s).length);
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  const fk = ws.length && ss.length ? 0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59 : 0;
  const head = (name) => new RegExp(`^\\s*(?:#{1,6}\\s*)?\\**${name}s?(?:\\s*\\([A-Z]\\))?\\**\\s*:?\\**\\s*$`, 'im').test(text);
  return {
    proseWords: ws.length,
    sentences: ss.length,
    maxSentence: lens.length ? Math.max(...lens) : 0,
    avgSentence: lens.length ? +(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1) : 0,
    fkGrade: +fk.toFixed(1),
    headings: ['action', 'suggestion', 'question', 'decision'].filter(head),
    items: parseAssistantItems(text).filter((i) => !i.close && !i.loose).map((i) => `${i.type}${i.n}`),
    you: /\byou\b/i.test(prose(text)),
  };
}

// ---------------------------------------------------------------- the cases

const pass = (ok, note) => ({ status: ok ? 'pass' : 'fail', note });
const review = (note) => ({ status: 'review', note });
const EXPLAIN = 'Explain what a .gitignore file does and when to use one.';
const lastTurn = (run) => run[run.length - 1];

const CASES = [
  {
    id: 'M1', title: 'Rename and run tests: short summary, output verbatim', agents: 'all',
    turns: ['Rename the function `foo` to `bar` in src/util.js, update its callers, and run the tests with `npm test`.'],
    check: ([[r]]) => pass(measure(r).proseWords <= 80, `prose ${measure(r).proseWords} words (≤80)`),
  },
  {
    id: 'M2', title: 'Failing test: error output in full, summary short', agents: 'all', fixture: 'failing',
    turns: ['Run `npm test` and tell me what fails.'],
    check: ([[r]]) => {
      const m = measure(r);
      const shown = /AssertionError|Expected values|expected|not ok/i.test(r) && /```|^\s{4}/m.test(r);
      return pass(shown && m.proseWords <= 80, `error output shown: ${shown}; prose ${m.proseWords} words`);
    },
  },
  {
    id: 'M3', title: 'A choice becomes one decision with lettered options', agents: 'all',
    turns: ['Should we use Redis or Postgres for the job queue in this project?'],
    check: ([[r]]) => {
      const ds = measure(r).items.filter((i) => i.startsWith('D'));
      const lettered = /\(a\)[\s\S]*\(b\)/.test(r);
      return pass(ds.length === 1 && lettered, `decision items: ${ds.join(',') || 'none'}; lettered options: ${lettered}`);
    },
  },
  {
    id: 'M4', title: 'Answering D1 proceeds, no repeat, IDs continue', agents: 'all',
    turns: ['Should we use Redis or Postgres for the job queue in this project?', 'D1: a'],
    check: ([[r1, r2]]) => {
      const before = measure(r1).items;
      const after = measure(r2).items;
      const repeated = after.filter((id) => before.includes(id));
      return pass(repeated.length === 0, `turn 1 items ${before.join(',') || 'none'}; turn 2 new items ${after.join(',') || 'none'}; repeated ${repeated.join(',') || 'none'}`);
    },
  },
  {
    id: 'M5', title: '!verbose gives a long answer for one turn only', agents: 'all',
    turns: ['Explain how a JavaScript bundler works !verbose', EXPLAIN],
    check: ([[r1, r2]]) => {
      const a = measure(r1).proseWords;
      const b = measure(r2).proseWords;
      return pass(a > 120 && b <= 80, `turn 1 prose ${a} words (>120); turn 2 prose ${b} words (≤80)`);
    },
  },
  {
    id: 'M6', title: '!off gives a normal full answer', agents: 'all',
    turns: ['!off Summarise in detail what this project contains and how it is organised.'],
    check: ([[r]]) => {
      const m = measure(r);
      return pass(m.proseWords > 80, `prose ${m.proseWords} words (>80); headings ${m.headings.join(',') || 'none'}`);
    },
  },
  {
    id: 'M7', title: 'Destructive request asks first, in full sentences', agents: 'all',
    turns: ['Delete the build folder.'],
    // Headless runs cannot approve a delete, so the folder stays either way; what counts is that
    // the reply asks for, or hands back, the confirmation in full sentences.
    check: ([[r]], ctx) => {
      const kept = fs.existsSync(path.join(ctx.dir, 'build'));
      const confirms = /\?|\b(confirm|approve|approval|sure)\b/i.test(r);
      const full = measure(r).avgSentence >= 6;
      return pass(kept && confirms && full, `build folder kept: ${kept}; asks or hands back confirmation: ${confirms}; full sentences (avg ${measure(r).avgSentence} words): ${full}`);
    },
  },
  {
    id: 'M8', title: 'IDs continue past a compaction', agents: ['claude'],
    turns: ['Plan three steps to add a lint script; give me Actions.', '/compact', 'Add one more action: a pre-commit hook that runs the linter.'],
    check: ([[r1, , r3]]) => {
      const first = measure(r1).items.filter((i) => i[0] === 'A').map((i) => Number(i.slice(1)));
      const next = measure(r3).items.filter((i) => i[0] === 'A').map((i) => Number(i.slice(1)));
      const ok = first.length > 0 && next.length > 0 && Math.min(...next) > Math.max(...first);
      return pass(ok, `before A${first.join(',A')}; after compaction A${next.join(',A')}`);
    },
  },
  {
    id: 'M9', title: 'Brevity levels get visibly shorter', runs: ['low', 'medium', 'high', 'extreme'].map((level) => ({ label: level, config: { minimal: { level } } })),
    turns: [EXPLAIN],
    check: (runs) => {
      const n = runs.map((r) => measure(lastTurn(r)).proseWords);
      const ok = n.every((v, i) => i === 0 || v <= n[i - 1]) && n[3] < n[0];
      return pass(ok, `prose words low→extreme: ${n.join(' → ')}`);
    },
  },
  {
    id: 'M10', title: 'maxWords=30 holds', config: { minimal: { maxWords: 30 } }, turns: [EXPLAIN],
    check: ([[r]]) => pass(measure(r).proseWords <= 30, `prose ${measure(r).proseWords} words (≤30)`),
  },
  {
    id: 'M11', title: 'Without tables in preserve, tables may shrink', config: { minimal: { preserve: ['code', 'commands', 'errors', 'paths', 'diffs'] } },
    turns: ['Compare npm, pnpm and yarn in a table: install speed, disk use, lockfile, workspaces.'],
    check: ([[r]]) => review(`table rows: ${(r.match(/^\s*\|/gm) ?? []).length}; judge whether the table was cut down`),
  },
  {
    id: 'M12', title: 'structured.on=false gives plain brief prose', config: { structured: { on: false } }, turns: ['Plan three steps to add a lint script.'],
    check: ([[r]]) => {
      const m = measure(r);
      return pass(m.items.length === 0 && m.headings.length === 0 && m.proseWords <= 80, `items ${m.items.join(',') || 'none'}; headings ${m.headings.join(',') || 'none'}; prose ${m.proseWords} words`);
    },
  },
  {
    id: 'M13', title: 'CEFR A1: sentences of 8 words or fewer', config: { language: { on: true, cefr: 'A1' } }, turns: [EXPLAIN],
    check: ([[r]]) => { const m = measure(r); return pass(m.maxSentence <= 8, `longest sentence ${m.maxSentence} words, average ${m.avgSentence}`); },
  },
  {
    id: 'M14', title: 'CEFR B1: sentences of 16 words or fewer, terms explained', config: { language: { on: true, cefr: 'B1' } }, turns: [EXPLAIN],
    check: ([[r]]) => { const m = measure(r); return pass(m.maxSentence <= 16, `longest sentence ${m.maxSentence} words, average ${m.avgSentence}; judge whether terms are explained`); },
  },
  {
    id: 'M15', title: 'CEFR C1: fluent, no padding', config: { language: { on: true, cefr: 'C1' } }, turns: [EXPLAIN],
    check: ([[r]]) => review(`prose ${measure(r).proseWords} words, average sentence ${measure(r).avgSentence}; judge fluency and padding`),
  },
  {
    id: 'M16', title: 'Flesch-Kincaid target 6', config: { language: { on: true, readability: { standard: 'flesch-kincaid', target: 6 } } }, turns: [EXPLAIN],
    check: ([[r]]) => pass(measure(r).fkGrade <= 7, `measured grade ${measure(r).fkGrade} (≤7)`),
  },
  {
    id: 'M17', title: 'Simplified Technical English', config: { language: { on: true, vocabulary: 'ste' } }, turns: [EXPLAIN],
    check: ([[r]]) => { const m = measure(r); return review(`longest sentence ${m.maxSentence} words (STE: 20 for procedures, 25 for descriptions); judge active voice, one meaning per word`); },
  },
  {
    id: 'M18', title: 'Basic English vocabulary', config: { language: { on: true, vocabulary: 'basic-english' } }, turns: [EXPLAIN],
    check: () => review('judge: simple words, technical terms allowed'),
  },
  {
    id: 'M19', title: 'Plain language: says "you", main point first', config: { language: { on: true, plainLanguage: true } }, turns: [EXPLAIN],
    check: ([[r]]) => pass(measure(r).you, `says "you": ${measure(r).you}; judge main point first`),
  },
  {
    id: 'M20', title: 'showEmptySections: all four headings', config: { structured: { showEmptySections: true } }, turns: ['Plan two steps to add a README.'],
    check: ([[r]]) => { const h = measure(r).headings; return pass(h.length === 4, `headings ${h.join(',') || 'none'}`); },
  },
  {
    id: 'M21', title: 'Only actions and questions sections', config: { structured: { sections: ['actions', 'questions'], showEmptySections: true } },
    turns: ['Plan two steps to add a README, suggest one improvement, and pick a license for me.'],
    check: ([[r]]) => {
      const m = measure(r);
      const ok = m.headings.every((h) => h === 'action' || h === 'question') && !m.items.some((i) => i[0] === 'S' || i[0] === 'D');
      return pass(ok, `headings ${m.headings.join(',') || 'none'}; items ${m.items.join(',') || 'none'}`);
    },
  },
  {
    id: 'M22', title: '!level=A2 !words=20 apply to one turn only', turns: [`!level=A2 !words=20 ${EXPLAIN}`, 'Explain what a git branch is and when to use one.'],
    check: ([[r1, r2]]) => {
      const a = measure(r1);
      const b = measure(r2);
      return pass(a.proseWords <= 20 && b.proseWords > 20, `turn 1 prose ${a.proseWords} words (≤20), longest sentence ${a.maxSentence}; turn 2 prose ${b.proseWords} words (>20)`);
    },
  },
];

// ---------------------------------------------------------------- the project each case runs in

function fixture(kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-eval-'));
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  w('package.json', JSON.stringify({ name: 'eval-fixture', version: '1.0.0', type: 'module', scripts: { test: 'node --test', build: 'node build.mjs' } }, null, 2));
  w('src/util.js', 'export function foo(a, b) {\n  return a + b;\n}\n');
  w('src/index.js', "import { foo } from './util.js';\n\nconsole.log(foo(2, 3));\n");
  w('test/util.test.js', `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { foo } from '../src/util.js';\n\ntest('adds', () => {\n  assert.equal(foo(2, 3), ${kind === 'failing' ? 6 : 5});\n});\n`);
  w('build.mjs', "import fs from 'node:fs';\nfs.mkdirSync('build', { recursive: true });\nfs.copyFileSync('src/util.js', 'build/util.js');\n");
  w('build/util.js', 'export function foo(a, b) {\n  return a + b;\n}\n');
  w('README.md', '# eval-fixture\n\nA tiny project used by the response-config evals.\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

// ---------------------------------------------------------------- running a turn

const quote = (s) => (process.platform === 'win32' ? `"${s.replace(/"/g, '""')}"` : `'${s.replace(/'/g, "'\\''")}'`);
const run = (cmd, cwd, env) => spawnSync(cmd, { cwd, env, shell: true, encoding: 'utf8', timeout: TURN_MS, maxBuffer: 64 * 1024 * 1024 });

const AGENTS = {
  claude: {
    version: 'claude --version',
    turn(prompt, state, cwd, env) {
      // Claude on Windows runs commands through its PowerShell tool as well as Bash.
      const tools = ['npm test:*', 'npm run:*', 'node:*', 'git status:*'].flatMap((c) => [`Bash(${c})`, `PowerShell(${c})`])
        .concat(['Read', 'Edit', 'Write', 'Glob', 'Grep']);
      // The runs test this checkout through the hooks setup.mjs wrote: the plugin's cached copy
      // may be older, and the mod would take over from the hooks, so both are off for the run.
      const settings = JSON.stringify({ enabledPlugins: { 'response-config@response-config': false, 'response-config-mod@response-config': false } });
      const cmd = ['claude', '-p', quote(prompt), '--output-format', 'json', '--permission-mode', 'acceptEdits', '--settings', quote(settings),
        '--allowedTools', ...tools.map(quote), ...(state.session ? ['--resume', state.session] : [])].join(' ');
      const r = run(cmd, cwd, env);
      try {
        const j = JSON.parse(r.stdout.trim().split('\n').pop());
        state.session = j.session_id ?? state.session;
        return { text: String(j.result ?? ''), error: j.is_error ? 'agent reported an error' : '' };
      } catch {
        return { text: r.stdout, error: (r.stderr || r.error?.message || 'no JSON result').slice(0, 500) };
      }
    },
  },
  codex: {
    version: 'codex --version',
    turn(prompt, state, cwd, env) {
      const out = path.join(cwd, '.eval-last.txt');
      const cmd = state.started
        ? ['codex', 'exec', 'resume', '--last', '--skip-git-repo-check', '-o', quote(out), quote(prompt)].join(' ')
        : ['codex', 'exec', '--skip-git-repo-check', '-s', 'workspace-write', '-o', quote(out), quote(prompt)].join(' ');
      const r = run(cmd, cwd, env);
      state.started = true;
      const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : r.stdout;
      return { text, error: r.status === 0 ? '' : (r.stderr || r.error?.message || `exit ${r.status}`).slice(0, 500) };
    },
  },
  copilot: {
    version: 'copilot --version',
    turn(prompt, state, cwd, env) {
      const tools = ['write', 'shell(npm:*)', 'shell(node:*)', 'shell(git status)'];
      const cmd = ['copilot', '-p', quote(prompt), '-s', '--no-color', ...tools.flatMap((t) => ['--allow-tool', quote(t)]),
        ...(state.started ? ['--continue'] : [])].join(' ');
      const r = run(cmd, cwd, env);
      state.started = true;
      return { text: r.stdout, error: r.status === 0 ? '' : (r.stderr || r.error?.message || `exit ${r.status}`).slice(0, 500) };
    },
  },
};

// ---------------------------------------------------------------- main

function preflight(agent) {
  const v = run(AGENTS[agent].version, process.cwd(), process.env);
  if (v.status !== 0) throw new Error(`${agent} is not on PATH (${AGENTS[agent].version} failed)`);
  const home = os.homedir();
  const installed = {
    claude: () => {
      const f = path.join(home, '.claude', 'settings.json');
      return fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('hook.mjs');
    },
    codex: () => fs.existsSync(path.join(home, '.codex', 'hooks.json')) && fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8').includes('hook.mjs'),
    copilot: () => fs.existsSync(path.join(home, '.copilot', 'hooks', 'response-config.json')),
  }[agent]();
  if (!installed) console.warn(`warning: no user-scope response-config hooks found for ${agent}; replies will show the agent's own style`);
  return v.stdout.trim();
}

function main() {
  if (!AGENTS[AGENT]) throw new Error(`unknown agent ${AGENT}`);
  if (process.env.CLAUDECODE) console.warn('warning: running inside a Claude Code session; run this from a normal terminal');
  const version = preflight(AGENT);
  fs.mkdirSync(OUT, { recursive: true });
  const cases = CASES.filter((c) => (ONLY ? ONLY.includes(c.id) : true))
    .filter((c) => (c.agents === 'all' || (c.agents ?? ['claude']).includes(AGENT)));
  const rows = [];
  for (const c of cases) {
    const runs = c.runs ?? [{ label: '', config: c.config ?? {} }];
    const replies = [];
    const log = [`# ${c.id}: ${c.title}`, '', `Agent: ${AGENT} ${version}`, ''];
    let ctx = {};
    for (const r of runs) {
      const dir = fixture(c.fixture);
      const rc = path.join(dir, '.rc');
      fs.mkdirSync(rc, { recursive: true });
      fs.writeFileSync(path.join(rc, 'config.json'), JSON.stringify(r.config ?? {}, null, 2));
      const env = { ...process.env, RC_CONFIG_DIR: rc, DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' };
      const state = {};
      const texts = [];
      log.push(`## Run ${r.label || 1}`, '', `Config: \`${JSON.stringify(r.config ?? {})}\``, '');
      for (const prompt of c.turns) {
        process.stdout.write(`${c.id}${r.label ? ` (${r.label})` : ''}: ${prompt.slice(0, 60)}... `);
        const t = AGENTS[AGENT].turn(prompt, state, dir, env);
        texts.push(t.text);
        console.log(t.error ? `error: ${t.error.split('\n')[0]}` : `${measure(t.text).proseWords} prose words`);
        log.push(`### Prompt`, '', '```text', prompt, '```', '', '### Reply', '', t.text.trim() || '(empty)', '');
        if (t.error) log.push(`**Error:** ${t.error}`, '');
        log.push('```json', JSON.stringify(measure(t.text)), '```', '');
      }
      replies.push(texts);
      ctx = { dir };
    }
    let result;
    try {
      result = c.check(replies, ctx);
    } catch (e) {
      result = { status: 'fail', note: `check failed: ${e.message}` };
    }
    log.push(`## Result: ${result.status.toUpperCase()}`, '', result.note, '');
    fs.writeFileSync(path.join(OUT, `${c.id}.md`), log.join('\n'));
    rows.push({ id: c.id, title: c.title, ...result });
    console.log(`  → ${result.status.toUpperCase()}: ${result.note}`);
  }
  const report = [
    `# Eval report: ${AGENT}`, '', `${version} · ${new Date().toISOString()}`, '',
    '| ID | Case | Result | Measured |', '|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.status} | ${r.note.replace(/\|/g, '/')} |`), '',
    `Pass ${rows.filter((r) => r.status === 'pass').length}, fail ${rows.filter((r) => r.status === 'fail').length}, review ${rows.filter((r) => r.status === 'review').length}. Transcripts: one file per case beside this report.`,
  ];
  fs.writeFileSync(path.join(OUT, 'report.md'), report.join('\n'));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ agent: AGENT, version, rows }, null, 2));
  console.log(`\nreport: ${path.join(OUT, 'report.md')}`);
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
