// Per-session ledger of numbered items (A/S/Q/D) plus session overrides.
import fs from 'node:fs';
import path from 'node:path';
import { configDir, readJson, writeJsonAtomic } from './config.mjs';
import { emptyLedger, normalizeLedger } from './core.mjs';

export {
  TYPES, applyReplies, emptyLedger, nextIds, normalizeLedger, openItems, registerItems, takeReused,
} from './core.mjs';

// Session ids are normalised so the mod ($.session.id(), a transcript file name) and the
// classic hooks (session_id on stdin) agree: a trailing .jsonl is dropped.
export const safe = (s) => String(s || 'unknown').replace(/\.jsonl$/i, '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);

export const ledgerPath = (agent, sessionId, env = process.env) =>
  path.join(configDir(env), 'sessions', `${safe(agent)}-${safe(sessionId)}.json`);

export function loadLedger(agent, sessionId, env = process.env) {
  const data = readJson(ledgerPath(agent, sessionId, env));
  if (!data || !data.counters || !Array.isArray(data.items)) return emptyLedger(agent, sessionId);
  return normalizeLedger(data);
}

export function saveLedger(ledger, env = process.env) {
  ledger.updatedAt = Date.now();
  writeJsonAtomic(ledgerPath(ledger.agent, ledger.sessionId, env), ledger);
}

// --- mod-active marker: the Claude mod writes it so classic hooks stand down ---
// It expires after a day so a session resumed without the mod gets its hooks back; the mod
// rewrites it at session start and then at most every hour while prompts arrive.

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

export const sessionsDir = (env = process.env) => path.join(configDir(env), 'sessions');

// Deletes every stored ledger. Returns how many files were removed.
export function clearLedgers(env = process.env) {
  let n = 0;
  for (const dir of [sessionsDir(env), modDir(env)]) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        fs.unlinkSync(path.join(dir, name));
        n += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return n;
}
