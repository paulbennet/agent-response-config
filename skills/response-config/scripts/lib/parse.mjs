// Parsing: assistant items, user quick replies, inline tags.

// Remove fenced code blocks so IDs inside code are ignored.
export function stripFences(text) {
  return String(text ?? '').replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '');
}

const ITEM_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\**([ASQD])(\d+)\**\s*[:.)–—-]?\**\s+(\S.*)$/;

export function parseAssistantItems(text) {
  const items = [];
  for (const line of stripFences(text).split(/\r?\n/)) {
    const m = ITEM_RE.exec(line);
    if (m) items.push({ type: m[1], n: Number(m[2]), text: m[3].trim().replace(/\*+$/, '') });
  }
  return items;
}

const ID = '[ASQD]\\d+';

export function parseUserReplies(text) {
  const t = stripFences(text);
  const replies = [];
  const seen = new Set();
  const push = (r) => {
    const key = `${r.kind}:${r.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      replies.push(r);
    }
  };
  // "done A1", "do A2", "skip S3" (several IDs allowed: "skip S1 S2")
  for (const m of t.matchAll(new RegExp(`\\b(done|do|skip)\\s+((?:${ID}[ \\t,]*)+)`, 'gi'))) {
    for (const id of m[2].match(new RegExp(ID, 'gi')) ?? []) {
      push({ kind: m[1].toLowerCase(), id: id.toUpperCase() });
    }
  }
  // "Q1: yes", "D3 = b" (value runs to comma, semicolon or newline)
  for (const m of t.matchAll(/(?:^|[\s,;])([QD]\d+)\s*[:=]\s*([^,;\n]+)/gi)) {
    push({ kind: 'answer', id: m[1].toUpperCase(), value: m[2].trim() });
  }
  // A message that is only IDs ("A2", "A2, S1") means "do these".
  if (new RegExp(`^[\\s,;]*(?:${ID}[\\s,;]*)+$`, 'i').test(t) && replies.length === 0) {
    for (const id of t.match(new RegExp(ID, 'gi'))) push({ kind: 'do', id: id.toUpperCase() });
  }
  return replies;
}

const TAG_RE =
  /(^|\s)!(verbose|plain|off|on|terse)(?=$|[\s.,;:!?])|(^|\s)!level=([A-Ca-c][12])(?=$|[\s.,;:!?])|(^|\s)!words=(\d{2,4})(?=$|[\s.,;:!?])/g;

export function parseTags(text) {
  const tags = {};
  const stripped = String(text ?? '').replace(TAG_RE, (all, a, name, b, level, c, words) => {
    if (name) tags[name] = true;
    if (level) tags.level = level.toUpperCase();
    if (words) tags.words = Number(words);
    return a ?? b ?? c ?? '';
  });
  return { text: stripped.replace(/[ \t]{2,}/g, ' ').trim(), tags };
}

export const hasTags = (tags) => Object.keys(tags).length > 0;
