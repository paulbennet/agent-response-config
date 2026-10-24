#!/usr/bin/env node
// Install or remove response-config hooks (and an instructions block) for Claude Code, Codex, GitHub Copilot.
//   node setup.mjs --agent claude|codex|copilot|all [--scope user|project] [--instructions] [--vscode]
//                  [--uninstall] [--dry-run] [--force]
// Idempotent: re-running replaces only the entries this script owns.
// Never rewrites a settings file it cannot parse.
//
// Scope project:
//   claude  -> .claude/settings.local.json (personal, not committed), absolute hook path
//   codex   -> .codex/hooks.json, hook path relative to the project (the skill must live in the project)
//   copilot -> .github/hooks/response-config.json, same relative rule; --vscode is project-only
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonForEdit } from './lib/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ABS = path.join(HERE, 'hook.mjs');
const SNIPPET = path.join(HERE, '..', 'assets', 'templates', 'instructions.md');
const PROJECT_SKILL_DIRS = ['.agents/skills', '.claude/skills', '.github/skills'];

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f, d) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const dry = has('dry-run');
const uninstall = has('uninstall');
const force = has('force');
const scope = val('scope', 'user');
const agentArg = val('agent');
const cwd = process.cwd();
const home = os.homedir();
const messages = [];
const say = (m) => messages.push(m);
const posix = (p) => p.replace(/\\/g, '/');
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
const codexHome = () => process.env.CODEX_HOME || path.join(home, '.codex');
const copilotHome = () => process.env.COPILOT_HOME || path.join(home, '.copilot');

const USAGE = 'usage: setup.mjs --agent claude|codex|copilot|all [--scope user|project] [--instructions] [--vscode (project scope only)] [--uninstall] [--dry-run] [--force]';
if (!['user', 'project'].includes(scope) || !['claude', 'codex', 'copilot', 'all'].includes(agentArg)) {
  console.error(USAGE);
  process.exit(1);
}
if (has('vscode') && scope !== 'project') {
  console.error('--vscode needs --scope project: VS Code reads hooks from .github/hooks/ in the workspace.');
  process.exit(1);
}

class Refusal extends Error {}

// The hook path to write into a config file.
// User scope and Claude's personal settings.local.json: absolute.
// Committed project files: relative to the project, so teammates can use them.
function hookPath(portable) {
  if (!portable) return posix(HOOK_ABS);
  const rel = path.relative(cwd, HOOK_ABS);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return posix(rel);
  for (const dir of PROJECT_SKILL_DIRS) {
    const candidate = path.join(dir, 'response-config', 'scripts', 'hook.mjs');
    if (fs.existsSync(path.join(cwd, candidate))) return posix(candidate);
  }
  if (force) {
    say(`WARNING: wrote an absolute hook path (${posix(HOOK_ABS)}) into a project file; it will not work on other machines.`);
    return posix(HOOK_ABS);
  }
  throw new Refusal(
    'project scope needs the skill inside the project (for example: npx skills add <repo> --skill response-config, without -g), '
    + 'so the hook path works for everyone. Use --scope user, install the skill into the project, or pass --force to write this machine\'s path.',
  );
}

const OURS = /hook\.mjs["']?\s+--agent\s+(claude|codex|copilot)/;
const ownsCommand = (h) => [h?.command, h?.bash, h?.powershell].some((c) => typeof c === 'string' && OURS.test(c));

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
const cmd = (hook, agent, event) => `node "${hook}" --agent ${agent} --event ${event}`;

// ---- Claude Code / Codex: { hooks: { Event: [ { matcher?, hooks: [ {type, command, timeout} ] } ] } } ----

function stripOurs(hooksObj) {
  for (const [event, groups] of Object.entries(hooksObj ?? {})) {
    if (!Array.isArray(groups)) continue;
    hooksObj[event] = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !ownsCommand(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (hooksObj[event].length === 0) delete hooksObj[event];
  }
}

function mergeClassic(file, agent, hook) {
  const data = readJsonForEdit(file); // throws on a broken file: nothing is written
  if (uninstall && !data.hooks) {
    say(`nothing to remove in ${file}`);
    return;
  }
  data.hooks ??= {};
  stripOurs(data.hooks);
  if (!uninstall) {
    const entry = (event, matcher) => ({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command: cmd(hook, agent, event), timeout: 10 }],
    });
    const add = (name, e) => (data.hooks[name] ??= []).push(e);
    add('SessionStart', entry('session-start', 'startup|resume|clear|compact|fork'));
    add('UserPromptSubmit', entry('prompt'));
    add('Stop', entry('stop'));
  }
  if (Object.keys(data.hooks).length === 0) delete data.hooks;
  writeJson(file, data);
}

function claudePluginInstalled() {
  let s;
  try {
    s = readJsonForEdit(path.join(claudeHome(), 'settings.json'));
  } catch {
    return false;
  }
  return Object.keys(s.enabledPlugins ?? {}).some((k) => k.startsWith('response-config@') && s.enabledPlugins[k]);
}

function setupClaude() {
  if (!uninstall && !force && claudePluginInstalled()) {
    say('claude: the response-config plugin is enabled and ships these hooks; skipped (use --force to add them anyway).');
    return;
  }
  const file = scope === 'project'
    ? path.join(cwd, '.claude', 'settings.local.json')
    : path.join(claudeHome(), 'settings.json');
  // settings.local.json is personal, so an absolute path is fine there.
  mergeClassic(file, 'claude', uninstall ? '' : hookPath(false));
}

function setupCodex() {
  const file = scope === 'project' ? path.join(cwd, '.codex', 'hooks.json') : path.join(codexHome(), 'hooks.json');
  mergeClassic(file, 'codex', uninstall ? '' : hookPath(scope === 'project'));
  if (!uninstall) {
    say('codex: run /hooks in Codex and trust the 3 response-config hooks. Untrusted hooks do not run.');
    if (scope === 'project') say('codex: project hooks only load when the project .codex/ layer is trusted, and run from the project root.');
    say('codex: the hooks.json wrapper shape is unverified against a live Codex; confirm all 3 hooks appear in /hooks.');
  }
}

// ---- GitHub Copilot ----

function setupCopilot() {
  const file = scope === 'project'
    ? path.join(cwd, '.github', 'hooks', 'response-config.json')
    : path.join(copilotHome(), 'hooks', 'response-config.json');
  if (uninstall) {
    if (!fs.existsSync(file)) say(`nothing at ${file}`);
    else if (dry) say(`[dry-run] would remove ${file}`);
    else {
      fs.unlinkSync(file);
      say(`removed ${file}`);
    }
    return;
  }
  const hook = hookPath(scope === 'project');
  let hooks;
  if (has('vscode')) {
    // VS Code compatible (Claude-style) names; VS Code reads .github/hooks/*.json in the workspace.
    const mk = (event) => ({ type: 'command', command: cmd(hook, 'copilot', event), timeout: 10 });
    hooks = { SessionStart: [mk('session-start')], UserPromptSubmit: [mk('prompt')], Stop: [mk('stop')] };
    say('copilot: --vscode writes VS Code compatible event names only (VS Code hooks are a preview feature; unverified live).');
  } else {
    const mk = (event) => ({
      type: 'command',
      bash: `node '${hook}' --agent copilot --event ${event}`,
      powershell: cmd(hook, 'copilot', event),
      timeoutSec: 10,
    });
    hooks = { sessionStart: [mk('session-start')], userPromptTransformed: [mk('prompt-transformed')], agentStop: [mk('stop')] };
  }
  writeJson(file, { version: 1, hooks });
}

// ---- instructions block ----

const START = '<!-- response-config:start -->';
const END = '<!-- response-config:end -->';

function instructionsFile(agent) {
  if (agent === 'claude') return scope === 'project' ? path.join(cwd, 'CLAUDE.md') : path.join(claudeHome(), 'CLAUDE.md');
  if (agent === 'codex') return scope === 'project' ? path.join(cwd, 'AGENTS.md') : path.join(codexHome(), 'AGENTS.md');
  return scope === 'project'
    ? path.join(cwd, '.github', 'copilot-instructions.md')
    : path.join(copilotHome(), 'copilot-instructions.md');
}

function setupInstructions(agent) {
  const file = instructionsFile(agent);
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const had = text.includes(START);
  text = text.replace(new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`), '\n');
  if (!uninstall) {
    const body = fs.readFileSync(SNIPPET, 'utf8').trim();
    text = `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${START}\n${body}\n${END}\n`;
    if (agent === 'copilot' && scope === 'user') say('copilot: ~/.copilot/copilot-instructions.md is not a documented location; prefer --scope project.');
  } else {
    if (!had) {
      say(`nothing to remove in ${file}`);
      return;
    }
    text = `${text.trim()}\n`;
    if (text.trim() === '') {
      if (dry) say(`[dry-run] would remove empty ${file}`);
      else {
        fs.unlinkSync(file);
        say(`removed empty ${file}`);
      }
      return;
    }
  }
  writeText(file, text);
}

let failed = false;
const agents = agentArg === 'all' ? ['claude', 'codex', 'copilot'] : [agentArg];
for (const a of agents) {
  try {
    if (a === 'claude') setupClaude();
    if (a === 'codex') setupCodex();
    if (a === 'copilot') setupCopilot();
    if (has('instructions')) setupInstructions(a);
  } catch (e) {
    failed = true;
    say(`${a}: not changed. ${e.message}`);
  }
}
console.log(messages.join('\n'));
if (failed) process.exit(1);
