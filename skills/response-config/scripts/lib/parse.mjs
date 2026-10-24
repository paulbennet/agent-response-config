// Parsing: assistant items, user quick replies, inline tags. Pure: no node: imports.

// Remove fenced code blocks so IDs inside code are ignored.
export function stripFences(text) {
  return String(text ?? '').replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '');
}

// A list item that starts with an ID: "- A1 text", "* **Q2:** text", "3. D1 - text".
const LISTED_RE = /^\s*(?:[-*+]|\d+[.)])\s+\**([ASQD])(\d+)\**\s*[:.)–—-]?\**\s+(\S.*)$/;
// A bare "A1 text" line, accepted only inside a section headed Actions/Suggestions/Questions/Decisions.
const BARE_RE = /^\s*\**([ASQD])(\d+)\**\s*[:.)–—-]?\**\s+(\S.*)$/;
const HEADING_RE = /^\s*(?:#{1,6}\s*)?\**(actions?|suggestions?|questions?|decisions?)\**\s*:?\s*\**\s*$/i;
// "Resolved: A2, Q1" / "Done: A1" / "Closed: S3"
const RESOLVED_RE = /^\s*\**(resolved|done|closed|answered|skipped)\**\s*:\s*((?:[ASQD]\d+[\s,;]*)+)\s*$/i;
// An item whose whole text is a status: "- A2 done", "- Q1 (answered)"
const CLOSING_TEXT_RE = /^\(?(done|resolved|answered|skipped|closed)\)?\.?$/i;

const CLOSE_STATUS = { done: 'done', resolved: 'done', closed: 'done', answered: 'answered', skipped: 'skipped' };

export function parseAssistantItems(text) {
  const items = [];
  let inSection = false;
  for (const line of stripFences(text).split(/\r?\n/)) {
    if (/^\s*\|/.test(line)) { inSection = false; continue; } // table rows
    if (HEADING_RE.test(line)) { inSection = true; continue; }
    const resolved = RESOLVED_RE.exec(line);
    if (resolved) {
      for (const id of resolved[2].match(/[ASQD]\d+/gi) ?? []) {
        items.push({ type: id[0].toUpperCase(), n: Number(id.slice(1)), text: '', close: CLOSE_STATUS[resolved[1].toLowerCase()] });
      }
      continue;
    }
    const m = LISTED_RE.exec(line) ?? (inSection ? BARE_RE.exec(line) : null);
    if (!m) {
      if (line.trim() && !/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) inSection = false;
      continue;
    }
    const body = m[3].trim().replace(/\*+$/, '');
    const close = CLOSING_TEXT_RE.exec(body);
    items.push(close
      ? { type: m[1], n: Number(m[2]), text: '', close: CLOSE_STATUS[close[1].toLowerCase()] }
      : { type: m[1], n: Number(m[2]), text: body });
  }
  return items;
}

const ID = '[ASQD]\\d+';
const MAX_ANSWER = 80;

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
  // "done A1", "do A2", "skip S3 S4" at the start of the message or of a clause.
  const verbRe = new RegExp(`(?:^|[\\n,;])[ \\t]*(done|do|skip)[ \\t]+(${ID}(?:[ \\t]*,?[ \\t]*${ID})*)(?=$|[\\s.,;!?])`, 'gi');
  for (const m of t.matchAll(verbRe)) {
    for (const id of m[2].match(new RegExp(ID, 'gi')) ?? []) push({ kind: m[1].toLowerCase(), id: id.toUpperCase() });
  }
  // "Q1: yes", "D3 = b". The value ends at , ; ! ? newline or a sentence-ending period.
  const answerRe = /(?:^|[\s,;])([QD]\d+)\s*[:=]\s*((?:[^,;!?\n.]|\.(?=\S))+)(\??)/gi;
  for (const m of t.matchAll(answerRe)) {
    const id = m[1].toUpperCase();
    const value = m[2].trim();
    if (m[3] === '?') push({ kind: 'ref', id, value: value.slice(0, MAX_ANSWER) });
    else if (value && value.length <= MAX_ANSWER) push({ kind: 'answer', id, value });
  }
  // A message that is only IDs ("A2", "A2, S1") means "do these".
  if (replies.length === 0 && new RegExp(`^[\\s,;]*(?:${ID}[\\s,;]*)+$`, 'i').test(t)) {
    for (const id of t.match(new RegExp(ID, 'gi'))) push({ kind: 'do', id: id.toUpperCase() });
  }
  return replies;
}

// Tags must stand alone: preceded by start or whitespace, followed by end, whitespace or punctuation.
const TAG_RE =
  /(?<=^|\s)!(?:(verbose|plain|off|on|terse)|level=([A-Ca-c][12])|words=(\d{2,4}))(?=$|[\s.,;:!?])[ \t]?/g;

// Removes only the tags (and one following space). Everything else, indentation included, is untouched.
export function parseTags(text) {
  const tags = {};
  const source = String(text ?? '');
  const stripped = source.replace(TAG_RE, (all, name, level, words) => {
    if (name) tags[name] = true;
    if (level) tags.level = level.toUpperCase();
    if (words) tags.words = Number(words);
    return '';
  });
  return { text: hasTags(tags) ? stripped : source, tags };
}

export function hasTags(tags) {
  return Object.keys(tags).length > 0;
}
