#!/usr/bin/env node
// Single hook entry point for Claude Code, Codex and GitHub Copilot.
// Usage: node hook.mjs --agent claude|codex|copilot --event session-start|prompt|prompt-transformed|stop [--debug]
// Never fails the host: always exits 0.
import { adapters } from './lib/adapters/index.mjs';
import { loadConfig } from './lib/config.mjs';
import { effectiveConfig, renderPromptHint, renderSessionHint } from './lib/hint.mjs';
import {
  applyReplies, isModActive, loadLedger, pruneOld, registerItems, saveLedger,
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

const timer = setTimeout(() => process.exit(0), 2500);
timer.unref();

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

export function run({ agent, event, input, env = process.env }) {
  const adapter = adapters[agent];
  if (!adapter) return '';
  const n = adapter.parse(event, input);
  const { config, problems } = loadConfig({ cwd: n.cwd, env });
  if (!config.enabled && event !== 'prompt' && event !== 'prompt-transformed') return adapter.format(event, { hint: '', normalized: n });
  if (isModActive(n.sessionId, env)) return adapter.format(event, { hint: '', normalized: n });

  const useLedger = config.hooks.ledger;
  const ledger = useLedger ? loadLedger(agent, n.sessionId, env) : null;
  let hint = '';

  if (event === 'session-start') {
    if (!config.hooks.sessionStart) return '';
    if (n.source === 'startup') pruneOld(30, env);
    const notes = problems.map((p) => `Config problem: ${p}`);
    if (config.claude.outputStyle.manage && agent === 'claude') {
      const note = driftNote(syncStyle(config, { cwd: n.cwd, env }));
      if (note) notes.push(note);
    }
    const cfg = effectiveConfig(config, ledger?.session.overrides);
    hint = renderSessionHint(cfg, ledger, { notes });
  } else if (event === 'prompt' || event === 'prompt-transformed') {
    if (!config.hooks.eachPrompt) return '';
    const parsed = config.overrides.inlineTags ? parseTags(n.prompt) : { tags: {} };
    const replies = config.structured.on ? parseUserReplies(n.prompt) : [];
    let resolved = [];
    if (ledger) {
      ledger.turn += 1;
      resolved = applyReplies(ledger, replies);
      saveLedger(ledger, env);
    }
    const cfg = effectiveConfig(config, ledger?.session.overrides, parsed.tags);
    hint = renderPromptHint(cfg, ledger, { resolved, tags: hasTags(parsed.tags) ? parsed.tags : {}, problems });
  } else if (event === 'stop') {
    if (ledger && config.structured.on && n.lastAssistantMessage) {
      registerItems(ledger, parseAssistantItems(n.lastAssistantMessage));
      saveLedger(ledger, env);
    }
    return adapter.format(event, { hint: '', normalized: n });
  }
  return adapter.format(event, { hint, normalized: n });
}

async function main() {
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
  const out = run({ agent, event, input });
  if (out) process.stdout.write(`${out}\n`);
}

const isMain = import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href
  || process.argv[1]?.endsWith('hook.mjs');
if (isMain) {
  main().catch((e) => log('error', e?.stack ?? e)).finally(() => process.exit(0));
}
