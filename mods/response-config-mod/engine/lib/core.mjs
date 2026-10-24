// Pure logic shared by the hook scripts and the Claude mod. No node: imports allowed here.

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

export const TYPES = ['A', 'S', 'Q', 'D'];

export function emptyLedger(agent, sessionId) {
  return {
    agent,
    sessionId,
    counters: { A: 0, S: 0, Q: 0, D: 0 },
    items: [],
    renumbered: [],
    session: { overrides: {}, rulesSentAt: 0 },
    turn: 0,
    updatedAt: 0,
  };
}

// Older ledgers may lack newer fields.
export function normalizeLedger(l) {
  l.renumbered ??= [];
  l.session ??= {};
  l.session.overrides ??= {};
  l.session.rulesSentAt ??= 0;
  return l;
}

const isOpen = (i) => i.status === 'open' || i.status === 'in-progress';

const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) ?? []);

// Two texts describe the same item when they share at least half their words.
export function sameItem(a, b) {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return true;
  let common = 0;
  for (const w of x) if (y.has(w)) common += 1;
  return common / Math.min(x.size, y.size) >= 0.5;
}

// Register items the assistant produced.
// - A new ID is added as open.
// - A re-listed open item with the same meaning keeps its ID.
// - An ID that collides with a closed item, or with an open item about something else,
//   gets the next free number; the change is queued in `renumbered` for the next hint.
// - Entries with `close` mark an existing item done/answered/skipped.
export function registerItems(ledger, parsed) {
  normalizeLedger(ledger);
  const added = [];
  for (const p of parsed) {
    const id = `${p.type}${p.n}`;
    const existing = ledger.items.find((i) => i.id === id);
    if (p.close) {
      if (existing) existing.status = p.close;
      continue;
    }
    if (existing && isOpen(existing) && sameItem(existing.text, p.text)) {
      existing.text = p.text;
      continue;
    }
    let n = p.n;
    if (existing) {
      n = ledger.counters[p.type] + 1;
      ledger.renumbered.push({ from: id, to: `${p.type}${n}` });
    }
    ledger.items.push({ id: `${p.type}${n}`, type: p.type, n, text: p.text, status: 'open', turn: ledger.turn });
    ledger.counters[p.type] = Math.max(ledger.counters[p.type], n);
    added.push(`${p.type}${n}`);
  }
  return added;
}

const STATUS = { do: 'in-progress', done: 'done', skip: 'skipped', answer: 'answered' };

export function applyReplies(ledger, replies) {
  const resolved = [];
  for (const r of replies) {
    const item = ledger.items.find((i) => i.id === r.id);
    if (!item) {
      resolved.push({ id: r.id, unknown: true, kind: r.kind, value: r.value });
      continue;
    }
    if (STATUS[r.kind]) item.status = STATUS[r.kind];
    if (r.kind === 'answer' && r.value) item.answer = r.value;
    resolved.push({ id: r.id, kind: r.kind, value: r.value, text: item.text });
  }
  return resolved;
}

// Returns and clears the queued renumbering notices.
export function takeRenumbered(ledger) {
  const list = ledger.renumbered ?? [];
  ledger.renumbered = [];
  return list;
}

export const openItems = (ledger) => ledger.items.filter(isOpen);

export const nextIds = (ledger) => TYPES.map((t) => `${t}${ledger.counters[t] + 1}`).join(' ');
