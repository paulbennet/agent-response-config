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
    session: { overrides: {} },
    turn: 0,
    updatedAt: 0,
  };
}

// Register items the assistant produced. Keeps the model's own IDs; advances counters.
export function registerItems(ledger, parsed) {
  const added = [];
  for (const { type, n, text } of parsed) {
    const id = `${type}${n}`;
    const existing = ledger.items.find((i) => i.id === id);
    if (existing) {
      if (existing.status === 'open') existing.text = text;
      continue;
    }
    ledger.items.push({ id, type, n, text, status: 'open', turn: ledger.turn });
    ledger.counters[type] = Math.max(ledger.counters[type], n);
    added.push(id);
  }
  return added;
}

const STATUS = { do: 'done', done: 'done', skip: 'skipped', answer: 'answered' };

export function applyReplies(ledger, replies) {
  const resolved = [];
  for (const r of replies) {
    const item = ledger.items.find((i) => i.id === r.id);
    if (!item) {
      resolved.push({ id: r.id, unknown: true, kind: r.kind, value: r.value });
      continue;
    }
    if (r.kind === 'do' && item.type === 'A') item.status = 'in-progress';
    else item.status = STATUS[r.kind] ?? item.status;
    if (r.value) item.answer = r.value;
    resolved.push({ id: r.id, kind: r.kind, value: r.value, text: item.text });
  }
  return resolved;
}

export const openItems = (ledger) =>
  ledger.items.filter((i) => i.status === 'open' || i.status === 'in-progress');

export const nextIds = (ledger) => TYPES.map((t) => `${t}${ledger.counters[t] + 1}`).join(' ');
