#!/usr/bin/env node
// Install or remove response-config hooks (and an instructions pointer) for Claude Code, Codex, GitHub Copilot.
//   node setup.mjs --agent claude|codex|copilot|all [--scope user|project] [--instructions] [--vscode]
//                  [--uninstall] [--dry-run] [--force]
// Idempotent: re-running replaces only the entries this script owns.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './lib/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, 'hook.mjs').replace(/\\/g, '/');
const SNIPPET = path.join(HERE, '..', 'assets', 'templates', 'instructions.md');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f, d) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const dry = has('dry-run');
const uninstall = has('uninstall');
const scope = val('scope', 'user');
const agentArg = val('agent');
const cwd = process.cwd();
const home = os.homedir();
const messages = [];
const say = (m) => messages.push(m);

if (!['user', 'project'].includes(scope) || !['claude', 'codex', 'copilot', 'all'].includes(agentArg)) {
  console.error('usage: setup.mjs --agent claude|codex|copilot|all [--scope user|project] [--instructions] [--vscode] [--uninstall] [--dry-run] [--force]');
  process.exit(1);
}

const OURS = /hook\.mjs["']?\s+--agent\s+(claude|codex|copilot)/;
const ownsCommand = (c) => typeof c === 'string' && OURS.test(c);

function writeText(file, text) {
  if (dry) {
    say(`[dry-run] would write ${file}:\n${text}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  say(`wrote ${file}`);
}

const writeJson = (file, data) => writeText(file, `${JSON.stringify(data, null, 2)}\n`);

function cmd(agent, event) {
  return `node "${HOOK}" --agent ${agent} --event ${event}`;
}

// ---- Claude Code / Codex: { hooks: { Event: [ { matcher?, hooks: [ {type, command, timeout} ] } ] } } ----

function stripOurs(hooksObj) {
  for (const [event, groups] of Object.entries(hooksObj ?? {})) {
    hooksObj[event] = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !ownsCommand(h.command)) }))
      .filter((g) => g.hooks.length > 0);
    if (hooksObj[event].length === 0) delete hooksObj[event];
  }
}

function mergeClassic(file, agent) {
  const data = readJson(file) ?? {};
  data.hooks ??= {};
  stripOurs(data.hooks);
  if (!uninstall) {
    const entry = (event, matcher) => ({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command: cmd(agent, event), timeout: 10 }],
    });
    const add = (name, e) => (data.hooks[name] ??= []).push(e);
    add('SessionStart', entry('session-start', 'startup|resume|clear|compact'));
    add('UserPromptSubmit', entry('prompt'));
    add('Stop', entry('stop'));
  }
  if (Object.keys(data.hooks).length === 0) delete data.hooks;
  writeJson(file, data);
}

function claudePluginInstalled() {
  const s = readJson(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'settings.json'));
  return Object.keys(s?.enabledPlugins ?? {}).some((k) => k.startsWith('response-config@') && s.enabledPlugins[k]);
}

function setupClaude() {
  if (!uninstall && !has('force') && claudePluginInstalled()) {
    say('claude: the response-config plugin is enabled and ships these hooks; skipped (use --force to add them anyway).');
    return;
  }
  const file = scope === 'project'
    ? path.join(cwd, '.claude', 'settings.json')
    : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'settings.json');
  mergeClassic(file, 'claude');
}

function setupCodex() {
  const file = scope === 'project' ? path.join(cwd, '.codex', 'hooks.json') : path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'hooks.json');
  mergeClassic(file, 'codex');
  if (!uninstall) {
    say('codex: open Codex and run /hooks to review and trust the 3 response-config hooks. Untrusted hooks do not run.');
    if (scope === 'project') say('codex: project hooks only load when the project .codex/ layer is trusted.');
    say('codex: hooks.json shape follows the documented event/matcher/handler layout; confirm in /hooks that all 3 appear.');
  }
}

// ---- GitHub Copilot ----

function setupCopilot() {
  const file = scope === 'project'
    ? path.join(cwd, '.github', 'hooks', 'response-config.json')
    : path.join(process.env.COPILOT_HOME || path.join(home, '.copilot'), 'hooks', 'response-config.json');
  if (uninstall) {
    if (fs.existsSync(file) && !dry) {
      fs.unlinkSync(file);
      say(`removed ${file}`);
    } else say(`${dry ? '[dry-run] would remove' : 'nothing at'} ${file}`);
    return;
  }
  const mk = (event) => ({
    type: 'command',
    bash: `node '${HOOK}' --agent copilot --event ${event}`,
    powershell: cmd('copilot', event),
    timeoutSec: 10,
  });
  const hooks = {
    sessionStart: [mk('session-start')],
    userPromptTransformed: [mk('prompt-transformed')],
    agentStop: [mk('stop')],
  };
  if (has('vscode')) {
    // VS Code compatible (Claude-style) names. Opt-in: Copilot CLI may also read these, which would double-inject.
    const mkc = (event) => ({ type: 'command', command: cmd('copilot', event), timeoutSec: 10 });
    hooks.SessionStart = [mkc('session-start')];
    hooks.UserPromptSubmit = [mkc('prompt')];
    hooks.Stop = [mkc('stop')];
    delete hooks.sessionStart;
    delete hooks.userPromptTransformed;
    delete hooks.agentStop;
    say('copilot: --vscode writes PascalCase (VS Code compatible) events only; the Copilot CLI camelCase events are not registered.');
  }
  writeJson(file, { version: 1, hooks });
  say('copilot: VS Code hooks are in preview; check Chat > Diagnostics for the loaded hooks.');
}

// ---- instructions pointer ----

const START = '<!-- response-config:start -->';
const END = '<!-- response-config:end -->';

function instructionsFile(agent) {
  if (agent === 'claude') return scope === 'project' ? path.join(cwd, 'CLAUDE.md') : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'CLAUDE.md');
  if (agent === 'codex') return scope === 'project' ? path.join(cwd, 'AGENTS.md') : path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'AGENTS.md');
  return scope === 'project'
    ? path.join(cwd, '.github', 'copilot-instructions.md')
    : path.join(process.env.COPILOT_HOME || path.join(home, '.copilot'), 'copilot-instructions.md');
}

function setupInstructions(agent) {
  const file = instructionsFile(agent);
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const re = new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`);
  text = text.replace(re, '\n');
  if (!uninstall) {
    const body = fs.readFileSync(SNIPPET, 'utf8').trim().replace('{{CONFIG_CLI}}', path.join(HERE, 'config.mjs').replace(/\\/g, '/'));
    text = `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${START}\n${body}\n${END}\n`;
  } else {
    text = `${text.trim()}\n`;
    if (text.trim() === '' && !dry && fs.existsSync(file)) {
      fs.unlinkSync(file);
      say(`removed empty ${file}`);
      return;
    }
  }
  writeText(file, text);
}

const agents = agentArg === 'all' ? ['claude', 'codex', 'copilot'] : [agentArg];
for (const a of agents) {
  if (a === 'claude') setupClaude();
  if (a === 'codex') setupCodex();
  if (a === 'copilot') setupCopilot();
  if (has('instructions')) setupInstructions(a);
}
console.log(messages.join('\n'));
