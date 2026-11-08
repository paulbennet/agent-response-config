#!/usr/bin/env node
// Single hook entry point for Claude Code, Codex and GitHub Copilot.
// Usage: node hook.mjs --agent claude|codex|copilot --event session-start|prompt|prompt-transformed|stop [--debug]
// Never fails the host: always exits 0.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters } from './lib/adapters/index.mjs';
import { loadConfig } from './lib/config.mjs';
import { deepMerge } from './lib/core.mjs';
import { effectiveConfig, keptOverrides, renderPromptHint, renderSessionHint } from './lib/hint.mjs';
import {
  applyReplies, claimEvent, claimFirstRules, isModActive, loadLedger, pruneOld, registerItems, saveLedger, takeReused,
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

// The full rules are re-sent this often, in prompts, in case a compaction dropped them and the
// host did not fire a session-start hook again (Copilot is not documented to).
export const RULES_EVERY = 20;

// Session switches (/response-config on|off|verbose|level) belong to the Claude mod, which keeps
// them in its own state. The classic hooks apply the config files, one-turn tags, and the tags a
// message kept for the session with !keep (stored in the ledger).

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
    // The first prompt hook already claimed the session's first rules (HOOK-3): send only notes.
    if (ledger && !ledger.session.rulesSentAt && !claimFirstRules(agent, n.sessionId, env)) {
      return adapter.format(event, { hint: notes.map((x) => `[response-config] NOTE: ${x}`).join('\n'), normalized: n });
    }
    const hint = renderSessionHint(cfg, ledger, { notes });
    if (ledger) {
      ledger.session.rulesSentAt = Date.now();
      ledger.session.rulesTurn = ledger.turn;
      saveLedger(ledger, env);
    }
    return adapter.format(event, { hint, normalized: n });
  }

  if (isPrompt(event)) {
    if (!config.hooks.eachPrompt) return silent();
    const parsed = config.overrides.inlineTags ? parseTags(n.prompt) : { tags: {} };
    const ledger = config.hooks.ledger ? loadLedger(agent, n.sessionId, env) : null;
    const kept = keptOverrides(ledger?.session.overrides, parsed.tags);
    // Disabled: only a !on tag (or one kept) brings the rules back; nothing is tracked. A !off
    // goes on, so the hint can say the rules are off.
    if (!deepMerge(config, kept).enabled && !parsed.tags.on && !parsed.tags.off) {
      if (ledger && kept !== ledger.session.overrides) {
        ledger.session.overrides = kept;
        saveLedger(ledger, env);
      }
      return silent();
    }
    const replies = config.structured.on ? parseUserReplies(n.prompt) : [];
    let resolved = [];
    let reused = [];
    // Without a ledger we cannot know whether the session hint arrived, so always send the rules.
    let withRules = !ledger;
    if (ledger) {
      ledger.turn += 1;
      const s = ledger.session;
      s.overrides = kept;
      // A session start running at this moment may hold the first rules (HOOK-3).
      withRules = s.rulesSentAt
        ? ledger.turn - s.rulesTurn >= RULES_EVERY
        : claimFirstRules(agent, n.sessionId, env);
      resolved = applyReplies(ledger, replies);
      reused = takeReused(ledger);
      // Also when the session start holds the claim: it is sending the rules this turn.
      if (withRules || !s.rulesSentAt) {
        s.rulesSentAt = Date.now();
        s.rulesTurn = ledger.turn;
      }
      saveLedger(ledger, env);
    }
    const cfg = effectiveConfig(config, kept, parsed.tags);
    const hint = renderPromptHint(cfg, ledger, {
      resolved, reused, withRules, problems, tags: hasTags(parsed.tags) ? parsed.tags : {},
    });
    return adapter.format(event, { hint, normalized: n });
  }

  if (event === 'stop') {
    if (config.hooks.ledger && config.structured.on && n.lastAssistantMessage) {
      const ledger = loadLedger(agent, n.sessionId, env);
      if (deepMerge(config, ledger.session.overrides).enabled) {
        registerItems(ledger, parseAssistantItems(n.lastAssistantMessage));
        saveLedger(ledger, env);
      }
    }
    return silent();
  }
  return '';
}

async function main() {
  const timer = setTimeout(() => process.exit(0), 8000);
  timer.unref();
  const agent = flag('agent') ?? 'claude';
  const event = flag('event');
  if (!event) return;
  let input = {};
  let raw = '';
  try {
    raw = await readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    log('bad stdin', e.message);
  }
  let out;
  try {
    // A second installed copy of the hooks got the same payload: answer once.
    out = raw.trim() && !claimEvent(agent, event, raw)
      ? adapters[agent]?.format(event, { hint: '', normalized: {} }) ?? ''
      : run({ agent, event, input });
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
