#!/usr/bin/env node
// Single hook entry point for Claude Code, Codex and GitHub Copilot.
// Usage: node hook.mjs --agent claude|codex|copilot --event session-start|prompt|prompt-transformed|stop [--debug]
// Never fails the host: always exits 0.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters } from './lib/adapters/index.mjs';
import { loadConfig } from './lib/config.mjs';
import { effectiveConfig, renderPromptHint, renderSessionHint } from './lib/hint.mjs';
import {
  applyReplies, isModActive, loadLedger, pruneOld, registerItems, saveLedger, takeRenumbered,
} from './lib/ledger.mjs';
import { hasTags, parseAssistantItems, parseTags, parseUserReplies } from './lib/parse.mjs';
import { driftNote, syncStyle } from './lib/style.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const debug = args.includes('--debug');
const log = (...a) => debug && console.error('[response-config]', ...a);

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const isPrompt = (event) => event === 'prompt' || event === 'prompt-transformed';

export function run({ agent, event, input, env = process.env }) {
  const adapter = adapters[agent];
  if (!adapter) return '';
  const n = adapter.parse(event, input);
  const silent = () => adapter.format(event, { hint: '', normalized: n });
  if (isModActive(n.sessionId, env)) return silent();
  const { config, problems } = loadConfig({ cwd: n.cwd, env });

  if (event === 'session-start') {
    if (!config.enabled || !config.hooks.sessionStart) return silent();
    const ledger = config.hooks.ledger ? loadLedger(agent, n.sessionId, env) : null;
    if (n.source === 'startup') pruneOld(30, env);
    const notes = problems.map((p) => `Config problem: ${p}`);
    if (config.claude.outputStyle.manage && agent === 'claude') {
      try {
        const note = driftNote(syncStyle(config, { cwd: n.cwd, env }));
        if (note) notes.push(note);
      } catch (e) {
        notes.push(`Output style sync failed: ${e.message}`);
      }
    }
    const cfg = effectiveConfig(config, ledger?.session.overrides);
    const hint = renderSessionHint(cfg, ledger, { notes });
    if (ledger) {
      ledger.session.rulesSentAt = Date.now();
      saveLedger(ledger, env);
    }
    return adapter.format(event, { hint, normalized: n });
  }

  if (isPrompt(event)) {
    if (!config.hooks.eachPrompt) return silent();
    const parsed = config.overrides.inlineTags ? parseTags(n.prompt) : { tags: {} };
    // Disabled: only a !on tag brings the rules back for this turn; nothing is tracked.
    if (!config.enabled && !parsed.tags.on) return silent();
    const ledger = config.hooks.ledger ? loadLedger(agent, n.sessionId, env) : null;
    const replies = config.structured.on ? parseUserReplies(n.prompt) : [];
    let resolved = [];
    let renumbered = [];
    // Without a ledger we cannot know whether the session hint arrived, so always send the rules.
    const withRules = !ledger || !ledger.session.rulesSentAt;
    if (ledger) {
      ledger.turn += 1;
      resolved = applyReplies(ledger, replies);
      renumbered = takeRenumbered(ledger);
      if (withRules) ledger.session.rulesSentAt = Date.now();
      saveLedger(ledger, env);
    }
    const cfg = effectiveConfig(config, ledger?.session.overrides, parsed.tags);
    const hint = renderPromptHint(cfg, ledger, {
      resolved, renumbered, withRules, problems, tags: hasTags(parsed.tags) ? parsed.tags : {},
    });
    return adapter.format(event, { hint, normalized: n });
  }

  if (event === 'stop') {
    if (config.enabled && config.hooks.ledger && config.structured.on && n.lastAssistantMessage) {
      const ledger = loadLedger(agent, n.sessionId, env);
      registerItems(ledger, parseAssistantItems(n.lastAssistantMessage));
      saveLedger(ledger, env);
    }
    return silent();
  }
  return '';
}

async function main() {
  const timer = setTimeout(() => process.exit(0), 2500);
  timer.unref();
  const agent = flag('agent') ?? 'claude';
  const event = flag('event');
  if (!event) return;
  let input = {};
  try {
    const raw = await readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    log('bad stdin', e.message);
  }
  let out;
  try {
    out = run({ agent, event, input });
  } catch (e) {
    log('error', e?.stack ?? e);
    // Still answer in the shape the host requires (Codex Stop needs JSON).
    out = adapters[agent]?.format(event, { hint: '', normalized: {} }) ?? '';
  }
  if (out) process.stdout.write(`${out}\n`);
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => log('error', e?.stack ?? e)).finally(() => process.exit(0));
}
