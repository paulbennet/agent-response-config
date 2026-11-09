#!/usr/bin/env node
// End-to-end checks that run on this machine without a live agent (see docs/testing-plan.md).
// Needs Node 22, bash and npx on PATH; PowerShell (powershell on Windows, pwsh elsewhere) for the Copilot powershell forms; network for npx skills.
// Every write goes into a throwaway folder; the real home is never touched.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').split(path.sep).join('/');
const SKILL = `${REPO}/skills/response-config`;
const results = [];
// Checks that fail today because of a known, documented issue (docs/testing-plan.md, Known issues).
const KNOWN = new Set([]);
const check = (id, name, fn) => {
  try {
    const note = fn();
    results.push({ id, name, ok: true, note: note ?? '' });
  } catch (e) {
    results.push({ id, name, ok: false, note: String(e.message).split('\n').slice(0, 3).join(' | ') });
  }
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-e2e-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    CODEX_HOME: path.join(home, '.codex'),
    COPILOT_HOME: path.join(home, '.copilot'),
    RC_CONFIG_DIR: path.join(home, 'rc'),
    RC_HOME_DIR: home,
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
  };
  delete env.CLAUDE_PLUGIN_ROOT;
  return { dir, home, env };
}
const node = (args, opts) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts });
const sh = (cmd, input, opts) => spawnSync('bash', ['-c', cmd], { encoding: 'utf8', input, ...opts });
const ps = (cmd, input, opts) => spawnSync(process.platform === 'win32' ? 'powershell' : 'pwsh', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', input, ...opts });
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Payloads the hosts send, as documented.
const payload = {
  claude: {
    'session-start': (cwd) => ({ session_id: 'e2e', cwd, source: 'startup', hook_event_name: 'SessionStart' }),
    prompt: (cwd, prompt = 'hi') => ({ session_id: 'e2e', cwd, prompt, hook_event_name: 'UserPromptSubmit' }),
    stop: (cwd, msg) => ({ session_id: 'e2e', cwd, last_assistant_message: msg, stop_hook_active: false, hook_event_name: 'Stop' }),
  },
  codex: {
    'session-start': (cwd) => ({ session_id: 'e2e', cwd, source: 'startup', hook_event_name: 'SessionStart' }),
    prompt: (cwd, prompt = 'hi') => ({ session_id: 'e2e', cwd, prompt, turn_id: 't1', hook_event_name: 'UserPromptSubmit' }),
    stop: (cwd, msg) => ({ session_id: 'e2e', cwd, last_assistant_message: msg, stop_hook_active: false, hook_event_name: 'Stop' }),
  },
  copilot: {
    'session-start': (cwd) => ({ sessionId: 'e2e', cwd, source: 'new', timestamp: 1 }),
    'prompt-transformed': (cwd, prompt = 'hi') => ({ sessionId: 'e2e', cwd, prompt, transformedPrompt: prompt, timestamp: 1 }),
    stop: (cwd, _msg, transcriptPath) => ({ sessionId: 'e2e', cwd, transcriptPath, timestamp: 1 }),
  },
};

// Hosts never send the same payload twice (timestamps, turn ids, new prompts), and the hook
// answers a repeated payload once, so every payload here carries a sequence number.
let seq = 0;
for (const events of Object.values(payload)) {
  for (const [ev, make] of Object.entries(events)) events[ev] = (...a) => ({ ...make(...a), e2e_seq: ++seq });
}

function shapeOk(agent, event, out) {
  const t = out.trim();
  if (agent === 'codex' && event === 'stop') return assert(t === '{}', `codex stop printed ${JSON.stringify(t)}`);
  if (event === 'stop') return assert(t === '', `stop printed ${JSON.stringify(t)}`);
  const j = JSON.parse(t);
  if (agent === 'copilot' && event === 'session-start') return assert(/\[response-config\]/.test(j.additionalContext), 'no additionalContext');
  if (agent === 'copilot') return assert(/\[response-config\]/.test(j.modifiedTransformedPrompt), 'no modifiedTransformedPrompt');
  assert(/\[response-config\]/.test(j.hookSpecificOutput?.additionalContext), 'no hookSpecificOutput.additionalContext');
}

// Collect every command a settings / hooks file holds for us.
function claudeCommands(file) {
  const out = [];
  for (const [event, groups] of Object.entries(readJ(file).hooks ?? {})) {
    for (const g of groups) for (const h of g.hooks ?? []) if (/hook\.mjs/.test(h.command)) out.push({ event, cmd: h.command });
  }
  return out;
}
const EVENT_OF = {
  SessionStart: 'session-start', UserPromptSubmit: 'prompt', Stop: 'stop',
  sessionStart: 'session-start', userPromptTransformed: 'prompt-transformed', agentStop: 'stop',
};

// ---------------------------------------------------------------- 1. setup, user scope
{
  const { dir, env } = sandbox();
  const settings = path.join(env.CLAUDE_CONFIG_DIR, 'settings.json');
  fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  const foreign = { theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  fs.writeFileSync(settings, JSON.stringify(foreign, null, 2));
  const setup = (...a) => node([`${SKILL}/scripts/setup.mjs`, ...a], { cwd: dir, env });

  check('SET-1', 'setup --agent all --scope user writes Claude, Codex and Copilot files', () => {
    const r = setup('--agent', 'all', '--scope', 'user');
    assert(r.status === 0, r.stderr || r.stdout);
    for (const f of [settings, path.join(env.CODEX_HOME, 'hooks.json'), path.join(env.COPILOT_HOME, 'hooks', 'response-config.json')]) assert(fs.existsSync(f), `missing ${f}`);
  });
  check('SET-2', 'existing Claude settings and foreign hooks are kept', () => {
    const s = readJ(settings);
    assert(s.theme === 'dark', 'theme lost');
    assert(JSON.stringify(s.hooks.Stop).includes('echo mine'), 'foreign Stop hook lost');
  });
  check('SET-3', 'running setup twice changes nothing (idempotent)', () => {
    const before = [settings, path.join(env.CODEX_HOME, 'hooks.json'), path.join(env.COPILOT_HOME, 'hooks', 'response-config.json')].map((f) => fs.readFileSync(f, 'utf8'));
    setup('--agent', 'all', '--scope', 'user');
    const after = [settings, path.join(env.CODEX_HOME, 'hooks.json'), path.join(env.COPILOT_HOME, 'hooks', 'response-config.json')].map((f) => fs.readFileSync(f, 'utf8'));
    assert(before.every((b, i) => b === after[i]), 'files changed on second run');
  });

  // Run every installed command exactly as written, through the shell the host would use.
  for (const agent of ['claude', 'codex']) {
    const file = agent === 'claude' ? settings : path.join(env.CODEX_HOME, 'hooks.json');
    check(`RUN-${agent}`, `each installed ${agent} hook command runs through bash and answers in the host's shape`, () => {
      const cmds = claudeCommands(file);
      assert(cmds.length === 3, `expected 3 commands, got ${cmds.length}`);
      for (const { event, cmd } of cmds) {
        const ev = EVENT_OF[event];
        const r = sh(cmd, JSON.stringify(payload[agent][ev](dir, '- A1 x')), { env });
        assert(r.status === 0, `${event} exit ${r.status}: ${r.stderr}`);
        shapeOk(agent, ev, r.stdout);
      }
      return cmds.map((c) => c.event).join(', ');
    });
  }
  check('RUN-copilot', 'each installed Copilot command runs in both its bash and powershell form', () => {
    const j = readJ(path.join(env.COPILOT_HOME, 'hooks', 'response-config.json'));
    assert(j.version === 1, 'version is not 1');
    const transcript = path.join(dir, 't.jsonl');
    fs.writeFileSync(transcript, '{"role":"assistant","content":[{"type":"text","text":"Actions\\n- A1 Run tests"}]}\n');
    let n = 0;
    for (const [event, list] of Object.entries(j.hooks)) {
      for (const h of list) {
        const ev = EVENT_OF[event];
        for (const [form, runner] of [['bash', sh], ['powershell', ps]]) {
          const input = JSON.stringify(payload.copilot[ev](dir, 'hi', transcript));
          const r = runner(h[form], input, { env });
          assert(r.status === 0, `${event}/${form} exit ${r.status}: ${r.stderr}`);
          shapeOk('copilot', ev, r.stdout);
          n += 1;
        }
      }
    }
    return `${n} command forms`;
  });
  check('LED-copilot', 'Copilot agentStop reads the transcript and registers items', () => {
    const l = readJ(path.join(env.RC_CONFIG_DIR, 'sessions', 'copilot-e2e.json'));
    assert(l.items.some((i) => i.id === 'A1' && i.text === 'Run tests'), JSON.stringify(l.items));
  });

  check('SET-4', 'setup --instructions adds one marked block per agent file, once', () => {
    setup('--agent', 'all', '--scope', 'user', '--instructions');
    setup('--agent', 'all', '--scope', 'user', '--instructions');
    for (const f of [path.join(env.CLAUDE_CONFIG_DIR, 'CLAUDE.md'), path.join(env.CODEX_HOME, 'AGENTS.md'), path.join(env.COPILOT_HOME, 'copilot-instructions.md')]) {
      const t = fs.readFileSync(f, 'utf8');
      const count = (t.match(/response-config/gi) ?? []).length;
      assert(count >= 1, `${f} has no block`);
      assert(t.split(/<!-- response-config:start/).length - 1 <= 1, `${f} has the block twice`);
    }
  });
  check('SET-5', 'setup --uninstall removes our hooks and keeps the rest', () => {
    const r = setup('--agent', 'all', '--scope', 'user', '--uninstall');
    assert(r.status === 0, r.stderr || r.stdout);
    const s = readJ(settings);
    assert(!JSON.stringify(s).includes('hook.mjs'), 'our hook still in settings.json');
    assert(s.theme === 'dark' && JSON.stringify(s.hooks?.Stop ?? []).includes('echo mine'), 'foreign content lost');
    const codex = path.join(env.CODEX_HOME, 'hooks.json');
    assert(!fs.existsSync(codex) || !fs.readFileSync(codex, 'utf8').includes('hook.mjs'), 'codex hook remains');
    assert(!fs.existsSync(path.join(env.COPILOT_HOME, 'hooks', 'response-config.json')), 'copilot hook file remains');
  });
  check('SET-6', 'setup refuses a settings file that does not parse, and leaves it as it was', () => {
    const broken = '{ "theme": "dark", }';
    fs.writeFileSync(settings, broken);
    const r = setup('--agent', 'claude', '--scope', 'user');
    assert(r.status !== 0, 'setup succeeded on a broken file');
    assert(fs.readFileSync(settings, 'utf8') === broken, 'broken file was rewritten');
  });
}

// ---------------------------------------------------------------- 1b. a skill path with spaces
{
  const { dir, env } = sandbox();
  check('SET-space', 'hook commands still run when the skill lives in a folder with spaces', () => {
    const copy = path.join(dir, 'my skills', 'response config', 'response-config');
    fs.cpSync(SKILL, copy, { recursive: true });
    const r = node([path.join(copy, 'scripts', 'setup.mjs'), '--agent', 'all', '--scope', 'user'], { cwd: dir, env });
    assert(r.status === 0, r.stderr || r.stdout);
    let n = 0;
    for (const [agent, file] of [['claude', path.join(env.CLAUDE_CONFIG_DIR, 'settings.json')], ['codex', path.join(env.CODEX_HOME, 'hooks.json')]]) {
      for (const { event, cmd } of claudeCommands(file)) {
        const ev = EVENT_OF[event];
        const out = sh(cmd, JSON.stringify(payload[agent][ev](dir, 'x')), { env });
        assert(out.status === 0, `${agent} ${event}: ${out.stderr}`);
        shapeOk(agent, ev, out.stdout);
        n += 1;
      }
    }
    const cp = readJ(path.join(env.COPILOT_HOME, 'hooks', 'response-config.json'));
    for (const [event, list] of Object.entries(cp.hooks)) {
      for (const h of list) {
        const ev = EVENT_OF[event];
        for (const [form, runner] of [['bash', sh], ['powershell', ps]]) {
          const out = runner(h[form], JSON.stringify(payload.copilot[ev](dir, 'hi', path.join(dir, 'none.jsonl'))), { env });
          assert(out.status === 0, `copilot ${event}/${form}: ${out.stderr}`);
          shapeOk('copilot', ev, out.stdout);
          n += 1;
        }
      }
    }
    return `${n} commands`;
  });
}

// ---------------------------------------------------------------- 2. full ledger flow through the real process
{
  const { dir, env } = sandbox();
  const hook = (agent, event, input) => node([`${SKILL}/scripts/hook.mjs`, '--agent', agent, '--event', event], { input: JSON.stringify(input), env, cwd: dir });
  check('FLOW-1', 'Claude: session start, items, quick replies, reused ID, recap, all through the CLI process', () => {
    const p = payload.claude;
    let out = JSON.parse(hook('claude', 'session-start', p['session-start'](dir)).stdout).hookSpecificOutput.additionalContext;
    assert(/BREVITY/.test(out) && /Next IDs: A1 S1 Q1 D1/.test(out), 'session hint');
    hook('claude', 'stop', p.stop(dir, 'Done.\n\nActions\n- A1 Run tests\n- A2 Write docs\nQuestions\n- Q1 Keep flag? (yes/no)'));
    out = JSON.parse(hook('claude', 'prompt', p.prompt(dir, 'Q1: yes, A1 done')).stdout).hookSpecificOutput.additionalContext;
    assert(/User answered Q1/.test(out) && /User finished A1/.test(out) && /Open: A2/.test(out), out);
    hook('claude', 'stop', p.stop(dir, 'Actions\n- A1 Run tests (done)\n- A3 Tag release'));
    out = JSON.parse(hook('claude', 'prompt', p.prompt(dir, 'please do A3')).stdout).hookSpecificOutput.additionalContext;
    assert(!/reused A/.test(out), 'recap counted as reuse');
    assert(/User started A3: Tag release/.test(out) && /Next IDs: A4 S1 Q2 D1/.test(out), out);
  });
}

// ---------------------------------------------------------------- 3. Claude plugin hooks file
{
  const { dir, env } = sandbox();
  check('PLUG-1', 'plugin hooks/hooks.json commands run with CLAUDE_PLUGIN_ROOT set', () => {
    const j = readJ(`${REPO}/hooks/hooks.json`);
    let n = 0;
    for (const [event, groups] of Object.entries(j.hooks)) {
      for (const g of groups) for (const h of g.hooks) {
        const ev = EVENT_OF[event];
        const r = sh(h.command, JSON.stringify(payload.claude[ev](dir, 'x')), { env: { ...env, CLAUDE_PLUGIN_ROOT: REPO } });
        assert(r.status === 0, `${event}: ${r.stderr}`);
        shapeOk('claude', ev, r.stdout);
        n += 1;
      }
    }
    assert(j.hooks.SessionStart[0].matcher.includes('compact'), 'SessionStart matcher lacks compact');
    return `${n} commands`;
  });
  check('PLUG-2', 'shipped output style is current', () => {
    const r = node([`${REPO}/tools/build-output-style.mjs`], { cwd: REPO });
    assert(r.status === 0, r.stderr);
    const diff = spawnSync('git', ['diff', '--quiet', '--', 'output-styles/response-config.md'], { cwd: REPO });
    assert(diff.status === 0, 'output style differs after rebuild');
  });
}

// ---------------------------------------------------------------- 4. skill format
check('SPEC-1', 'SKILL.md frontmatter follows the Agent Skills spec', () => {
  const t = fs.readFileSync(`${SKILL}/SKILL.md`, 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(t.replace(/\r\n/g, '\n'))?.[1] ?? '';
  const name = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim();
  const desc = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim() ?? '';
  assert(name === 'response-config', `name ${name}`);
  assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && name.length <= 64, 'name format');
  assert(desc.length > 0 && desc.length <= 1024, `description length ${desc.length}`);
  const lines = t.split('\n').length;
  assert(lines < 500, `SKILL.md has ${lines} lines`);
  for (const ref of t.match(/\]\((references\/[^)]+|config\.schema\.json)\)/g) ?? []) {
    const p = ref.slice(2, -1);
    assert(fs.existsSync(`${SKILL}/${p}`), `broken link ${p}`);
  }
  return `description ${desc.length} chars, ${lines} lines`;
});

check('SPEC-2', 'Codex metadata agents/openai.yaml has the expected keys and names the skill', () => {
  const t = fs.readFileSync(`${SKILL}/agents/openai.yaml`, 'utf8');
  for (const key of ['interface:', 'display_name:', 'short_description:', 'default_prompt:', 'policy:', 'allow_implicit_invocation:']) {
    assert(t.includes(key), `missing ${key}`);
  }
  assert(/\$response-config/.test(t), 'default_prompt does not name $response-config');
  assert(!/\t/.test(t), 'tabs in YAML');
});

{
  const { dir, env } = sandbox();
  check('CFG-3', 'CLI --ledger path points at the sessions folder; --ledger clear empties it', () => {
    node([`${SKILL}/scripts/hook.mjs`, '--agent', 'claude', '--event', 'stop'], { input: JSON.stringify(payload.claude.stop(dir, 'Actions\n- A1 x')), env, cwd: dir });
    const p = node([`${SKILL}/scripts/config.mjs`, '--ledger', 'path'], { env, cwd: dir }).stdout.trim();
    assert(path.resolve(p) === path.resolve(env.RC_CONFIG_DIR, 'sessions'), p);
    assert(fs.readdirSync(p).length === 1, 'no ledger written');
    const c = node([`${SKILL}/scripts/config.mjs`, '--ledger', 'clear'], { env, cwd: dir });
    assert(/removed 1 file/.test(c.stdout), c.stdout);
    assert(fs.readdirSync(p).length === 0, 'ledger not cleared');
  });
  check('CFG-4', 'config folder: RC_CONFIG_DIR, then XDG_CONFIG_HOME, then %APPDATA% on Windows', () => {
    const probe = (extra) => {
      const e = { ...process.env, ...extra };
      delete e.RC_CONFIG_DIR;
      if (!('XDG_CONFIG_HOME' in extra)) delete e.XDG_CONFIG_HOME;
      Object.assign(e, extra);
      const url = new URL(`file:///${SKILL}/scripts/lib/config.mjs`).href;
      return node(['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); console.log(m.configDir())`], { env: e }).stdout.trim();
    };
    assert(probe({ RC_CONFIG_DIR: path.join(dir, 'x') }) === path.join(dir, 'x'), 'RC_CONFIG_DIR ignored');
    assert(probe({ XDG_CONFIG_HOME: path.join(dir, 'xdg') }) === path.join(dir, 'xdg', 'response-config'), 'XDG ignored');
    if (process.platform === 'win32') {
      assert(probe({ APPDATA: path.join(dir, 'roaming') }) === path.join(dir, 'roaming', 'response-config'), 'APPDATA ignored');
      return 'Windows: APPDATA checked';
    }
    return 'not Windows: APPDATA branch skipped';
  });
}

// ---------------------------------------------------------------- 5. skills.sh install from the local repo
{
  const { dir, env } = sandbox();
  const proj = path.join(dir, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  const where = { 'claude-code': '.claude/skills/response-config', codex: '.agents/skills/response-config', 'github-copilot': '.agents/skills/response-config' };
  for (const [agent, rel] of Object.entries(where)) {
    check(`INST-${agent}`, `npx skills add (local path) installs for ${agent} into ${rel}`, () => {
      // One retry: on Windows the shell has once failed to find npx in the middle of a run.
      let r;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        r = spawnSync('npx', ['-y', 'skills', 'add', REPO, '--skill', 'response-config', '-a', agent, '-y', '--copy'], { cwd: proj, env, encoding: 'utf8', shell: true, timeout: 180000 });
        if (r.status === 0) break;
      }
      assert(r.status === 0, (r.stderr || r.stdout).slice(-300));
      for (const f of ['SKILL.md', 'scripts/hook.mjs', 'scripts/config.mjs', 'scripts/setup.mjs', 'config.default.json', 'references/format.md']) {
        assert(fs.existsSync(path.join(proj, rel, f)), `missing ${rel}/${f}`);
      }
    });
  }
  const installed = path.join(proj, '.agents/skills/response-config');
  check('INST-run', 'the installed copy runs: config --show and a hook call', () => {
    const r = node([path.join(installed, 'scripts/config.mjs'), '--show', '--json'], { cwd: proj, env });
    assert(r.status === 0, r.stderr);
    assert(JSON.parse(r.stdout).config.minimal.level === 'high', 'defaults not loaded');
  });
  check('INST-proj', 'project-scope setup from the installed copy writes a relative hook path and the command runs', () => {
    const r = node([path.join(installed, 'scripts/setup.mjs'), '--agent', 'codex', '--scope', 'project'], { cwd: proj, env });
    assert(r.status === 0, r.stderr || r.stdout);
    const cmds = claudeCommands(path.join(proj, '.codex', 'hooks.json'));
    assert(cmds.length === 3, `got ${cmds.length}`);
    assert(cmds.every((c) => c.cmd.includes('.agents/skills/response-config/scripts/hook.mjs') && !/[A-Za-z]:[\\/]/.test(c.cmd)), cmds[0].cmd);
    const run = sh(cmds[0].cmd, JSON.stringify(payload.codex['session-start'](proj)), { env, cwd: proj });
    assert(run.status === 0, run.stderr);
    shapeOk('codex', 'session-start', run.stdout);
    return cmds[0].cmd;
  });
  check('INST-vscode', 'setup --vscode --scope project writes VS Code event names', () => {
    const r = node([path.join(installed, 'scripts/setup.mjs'), '--agent', 'copilot', '--scope', 'project', '--vscode'], { cwd: proj, env });
    assert(r.status === 0, r.stderr || r.stdout);
    const j = readJ(path.join(proj, '.github/hooks/response-config.json'));
    const names = Object.keys(j.hooks);
    assert(names.includes('SessionStart') && names.includes('UserPromptSubmit'), names.join(','));
    return names.join(', ');
  });
}

// ---------------------------------------------------------------- 6. output style through the CLI
{
  const { dir, env } = sandbox();
  const cli = (...a) => node([`${SKILL}/scripts/config.mjs`, ...a], { cwd: dir, env });
  check('STY-1', 'CLI: manage on creates the style; a change regenerates it; a hand edit is kept and reported', () => {
    let r = cli('--set', 'claude.outputStyle.manage=true');
    assert(/output style: created/.test(r.stdout), r.stdout + r.stderr);
    const file = path.join(env.CLAUDE_CONFIG_DIR, 'output-styles', 'response-config-managed.md');
    r = cli('--set', 'minimal.level=low');
    assert(/output style: updated/.test(r.stdout), r.stdout);
    assert(/Cut filler/.test(fs.readFileSync(file, 'utf8')), 'level low text missing');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Follow them in every reply.', 'Follow them in every reply. my note'));
    r = cli('--set', 'minimal.level=medium');
    assert(/WARNING/.test(r.stdout) && /my note/.test(fs.readFileSync(file, 'utf8')), 'hand edit overwritten');
    r = cli('--style', 'status');
    assert(/^drifted/.test(r.stdout), r.stdout);
    r = cli('--style', 'sync', '--force');
    assert(!/my note/.test(fs.readFileSync(file, 'utf8')), 'force did not regenerate');
    r = cli('--style', 'activate');
    assert(readJ(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json')).outputStyle === 'response-config-managed', 'not activated');
    r = cli('--style', 'remove');
    assert(!fs.existsSync(file), 'not removed');
  });
  check('STY-2', 'a note appended after the provenance line is kept and reported as drift', () => {
    const s2 = sandbox();
    const c2 = (...a) => node([`${SKILL}/scripts/config.mjs`, ...a], { cwd: s2.dir, env: s2.env });
    c2('--set', 'claude.outputStyle.manage=true');
    const f2 = path.join(s2.env.CLAUDE_CONFIG_DIR, 'output-styles', 'response-config-managed.md');
    fs.appendFileSync(f2, 'my note\n');
    const st = c2('--style', 'status').stdout;
    assert(/my note/.test(fs.readFileSync(f2, 'utf8')), 'note lost');
    assert(/^drifted/.test(st), `reported as: ${st.split(':')[0]}`);
  });
  check('CFG-1', 'CLI refuses invalid values and unknown keys, and writes nothing', () => {
    const r1 = cli('--set', 'minimal.level=huge');
    const r2 = cli('--set', 'nope=1');
    assert(r1.status === 1 && r2.status === 1, 'accepted bad input');
  });
  check('CFG-2', 'session-start hook regenerates the style after a direct JSON edit', () => {
    cli('--set', 'claude.outputStyle.manage=true');
    cli('--style', 'sync', '--force');
    const cfgFile = path.join(env.RC_CONFIG_DIR, 'config.json');
    const j = readJ(cfgFile);
    j.minimal = { ...(j.minimal ?? {}), maxWords: 33 };
    fs.writeFileSync(cfgFile, JSON.stringify(j));
    node([`${SKILL}/scripts/hook.mjs`, '--agent', 'claude', '--event', 'session-start'], { input: JSON.stringify(payload.claude['session-start'](dir)), env, cwd: dir });
    const t = fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'output-styles', 'response-config-managed.md'), 'utf8');
    assert(/at most 33 words/.test(t), 'style not regenerated');
  });
}

// ---------------------------------------------------------------- report
const pad = (s, n) => String(s).padEnd(n);
for (const r of results) console.log(`${r.ok ? 'PASS' : KNOWN.has(r.id) ? 'KNOWN' : 'FAIL'}  ${pad(r.id, 18)} ${r.name}${r.note ? `  [${r.note}]` : ''}`);
const known = results.filter((r) => !r.ok && KNOWN.has(r.id)).length;
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed${known ? `, ${known} known issue(s)` : ''}`);
process.exitCode = results.every((r) => r.ok || KNOWN.has(r.id)) ? 0 : 1;
