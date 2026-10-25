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
    reused: [],
    session: { overrides: {}, rulesSentAt: 0, rulesTurn: 0 },
    turn: 0,
    updatedAt: 0,
  };
}

// Older ledgers may lack newer fields, or carry the retired `renumbered` queue.
export function normalizeLedger(l) {
  delete l.renumbered;
  l.reused ??= [];
  l.session ??= {};
  l.session.overrides ??= {};
  l.session.rulesSentAt ??= 0;
  l.session.rulesTurn ??= 0;
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

// Register items the assistant produced. The ID the user sees is the ID that is tracked:
// the ledger never stores an item under a number the assistant did not print.
// - A new ID is added as open.
// - A re-listed item with the same meaning keeps its ID and status (a recap of a closed
//   item stays closed).
// - An ID reused for something else takes over the ID. The earlier item is retired as
//   `superseded` under `A1~1` (out of ID lookup) and queued in `reused` for the next hint.
// - Entries with `close` mark an existing item done/answered/skipped.
// - Entries with `reopen` ("A1 still open: ...") set an existing item back to open.
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
    if (p.reopen && existing) {
      existing.status = 'open';
      continue;
    }
    if (existing && sameItem(existing.text, p.text)) {
      if (isOpen(existing)) existing.text = p.text;
      continue;
    }
    if (existing) {
      const retired = ledger.items.filter((i) => i.id.startsWith(`${id}~`)).length + 1;
      existing.id = `${id}~${retired}`;
      existing.status = 'superseded';
      ledger.reused.push({ id, text: existing.text });
    }
    ledger.items.push({ id, type: p.type, n: p.n, text: p.text, status: 'open', turn: ledger.turn });
    ledger.counters[p.type] = Math.max(ledger.counters[p.type], p.n);
    added.push(id);
  }
  return added;
}

// A bare Q or D id is a pointer ("let's look at Q1"), so `ref` leaves its status alone.
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

// Returns and clears the queued notices about reused IDs.
export function takeReused(ledger) {
  const list = ledger.reused ?? [];
  ledger.reused = [];
  return list;
}

export const openItems = (ledger) => ledger.items.filter(isOpen);

export const nextIds = (ledger) => TYPES.map((t) => `${t}${ledger.counters[t] + 1}`).join(' ');
