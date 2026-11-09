// Per-session ledger of numbered items (A/S/Q/D) plus session overrides.
import crypto from 'node:crypto';
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

// --- event claims: one answer per hook event when two copies are installed ---
// The plugin and setup.mjs can both register the hooks. The host sends each copy the same
// payload, so the first copy to claim it answers and the other stays silent.

const claimsDir = (env) => path.join(configDir(env), 'claims');
export const CLAIM_MS = 10000;

export function claimEvent(agent, event, raw, env = process.env) {
  const dir = claimsDir(env);
  const key = crypto.createHash('sha256').update(`${agent}\0${event}\0${raw}`).digest('hex').slice(0, 32);
  const file = path.join(dir, key);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, String(Date.now()), { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') return true;
    try {
      if (Date.now() - fs.statSync(file).mtimeMs < CLAIM_MS) return false;
      fs.writeFileSync(file, String(Date.now()));
    } catch {
      return true;
    }
  }
  pruneDir(dir, CLAIM_MS * 6);
  return true;
}

// The first full rules of a session: Copilot runs sessionStart and the first prompt hook at
// the same moment, before either has saved the ledger, so both would send them (HOOK-3).
// The first to claim sends the rules; the other leaves them out.
export function claimFirstRules(agent, sessionId, env = process.env) {
  const dir = claimsDir(env);
  const file = path.join(dir, `rules-${safe(agent)}-${safe(sessionId)}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, String(Date.now()), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') return true;
    try {
      if (Date.now() - fs.statSync(file).mtimeMs < CLAIM_MS) return false;
      fs.writeFileSync(file, String(Date.now()));
    } catch {
      /* claim anyway */
    }
    return true;
  }
}

function pruneDir(dir, maxAgeMs) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    try {
      const f = path.join(dir, n);
      if (Date.now() - fs.statSync(f).mtimeMs > maxAgeMs) fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

// --- mod-active marker: the Claude mod writes it so classic hooks stand down ---
// It expires after a day so a session resumed without the mod gets its hooks back; the mod
// rewrites it at session start and then at most every hour while prompts arrive.

// The marker carries the format version of the mod's parser. A mod whose bundled scripts are
// older (no `v`, or a lower one) cannot read the current reply format, so the hooks keep running
// rather than leave the session to it. Raise MARKER_VERSION when the item format changes.
const MARKER_VERSION = 2;

const modDir = (env) => path.join(configDir(env), 'mod-active');

export function isModActive(sessionId, env = process.env) {
  const data = readJson(path.join(modDir(env), `${safe(sessionId)}.json`));
  return Boolean(data && Date.now() - data.ts < 24 * 3600 * 1000 && Number(data.v) >= MARKER_VERSION);
}

export function markModActive(sessionId, env = process.env) {
  writeJsonAtomic(path.join(modDir(env), `${safe(sessionId)}.json`), { ts: Date.now(), v: MARKER_VERSION });
}

export function pruneOld(days = 30, env = process.env) {
  for (const dir of [path.join(configDir(env), 'sessions'), modDir(env)]) pruneDir(dir, days * 86400000);
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
