// Per-session ledger of numbered items (A/S/Q/D) plus session overrides.
import fs from 'node:fs';
import path from 'node:path';
import { configDir, readJson, writeJsonAtomic } from './config.mjs';
import { emptyLedger } from './core.mjs';

export {
  TYPES, applyReplies, emptyLedger, nextIds, openItems, registerItems,
} from './core.mjs';

const safe = (s) => String(s || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);

export const ledgerPath = (agent, sessionId, env = process.env) =>
  path.join(configDir(env), 'sessions', `${safe(agent)}-${safe(sessionId)}.json`);

export function loadLedger(agent, sessionId, env = process.env) {
  const data = readJson(ledgerPath(agent, sessionId, env));
  if (!data || !data.counters || !Array.isArray(data.items)) return emptyLedger(agent, sessionId);
  data.session ??= { overrides: {} };
  data.session.overrides ??= {};
  return data;
}

export function saveLedger(ledger, env = process.env) {
  ledger.updatedAt = Date.now();
  writeJsonAtomic(ledgerPath(ledger.agent, ledger.sessionId, env), ledger);
}

// --- mod-active marker: the Claude mod writes it so classic hooks stand down ---

const modDir = (env) => path.join(configDir(env), 'mod-active');

export function isModActive(sessionId, env = process.env) {
  const data = readJson(path.join(modDir(env), `${safe(sessionId)}.json`));
  return Boolean(data && Date.now() - data.ts < 24 * 3600 * 1000);
}

export function markModActive(sessionId, env = process.env) {
  writeJsonAtomic(path.join(modDir(env), `${safe(sessionId)}.json`), { ts: Date.now() });
}

export function pruneOld(days = 30, env = process.env) {
  for (const dir of [path.join(configDir(env), 'sessions'), modDir(env)]) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      try {
        const f = path.join(dir, n);
        if (Date.now() - fs.statSync(f).mtimeMs > days * 86400000) fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }
}
