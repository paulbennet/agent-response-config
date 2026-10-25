// Parsing: assistant items, user quick replies, inline tags. Pure: no node: imports.

// Remove fenced code blocks so IDs inside code are ignored. Fences may be indented under a list item.
export function stripFences(text) {
  return String(text ?? '').replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, '');
}

// A list line that starts with an ID: "- A1 text", "* **Q2:** text", "3. D1 - text".
// Groups: 1 bold before the ID, 2 type, 3 number, 4 separator, 5 text.
const LISTED_RE = /^\s*(?:[-*+]|\d+[.)])\s+(\**)([ASQD])(\d+)\**\s*([:.)–—-]?)\**\s+(\S.*)$/;
// The same without a list marker; accepted only inside a section.
const BARE_RE = /^\s*(\**)([ASQD])(\d+)\**\s*([:.)–—-]?)\**\s+(\S.*)$/;
const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s/;
// "Actions", "## Questions (Q)", "**Decisions (D):**"; the rules name the headings with their letter.
const HEADING_RE = /^\s*(?:#{1,6}\s*)?\**(actions?|suggestions?|questions?|decisions?)(?:\s*\([ASQD]\))?\**\s*:?\s*\**\s*$/i;
// "Resolved: A2, Q1" / "Done: A1" / "Closed: S3"
const RESOLVED_RE = /^\s*\**(resolved|done|closed|answered|skipped)\**\s*:\s*((?:[ASQD]\d+[\s,;]*)+)\s*$/i;
const STATUS_WORD = 'done|completed|complete|finished|fixed|resolved|answered|skipped|closed';
// An item whose whole text is a status: "- A2 done", "- Q1 (answered)", "- A3 ✓"
const CLOSING_TEXT_RE = new RegExp(`^(?:\\(?(${STATUS_WORD})\\)?\\.?|[✓✔✅]+)$`, 'i');
// A recap that ends in a status: "Run tests (completed)", "Run tests [done]", "Run tests - done", "Run tests ✓"
const TRAILING_CLOSE_RE = new RegExp(
  `\\s*(?:\\((${STATUS_WORD})\\)|\\[(${STATUS_WORD})\\]|[—–-]\\s*(${STATUS_WORD})|([✓✔✅]+))\\.?\\s*$`, 'i',
);

const CLOSE_STATUS = {
  done: 'done', completed: 'done', complete: 'done', finished: 'done', fixed: 'done', resolved: 'done', closed: 'done',
  answered: 'answered', skipped: 'skipped',
};
const closeStatus = (word) => (word ? CLOSE_STATUS[word.toLowerCase()] : 'done');

// Items count when they sit under an Actions/Suggestions/Questions/Decisions heading. Outside
// a section only a marked ID counts ("- A1: text", "- **A1** text"), so numbered prose such as
// "1. Q3 2026 revenue grew" or "- S3 bucket is public" is not taken for an item.
// Closing lines ("- A2 done", "Resolved: A2") count anywhere.
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
      if (line.trim() && !LIST_LINE_RE.test(line)) inSection = false;
      continue;
    }
    const [, bold, type, num, sep, rest] = m;
    const n = Number(num);
    const body = rest.trim().replace(/\*+$/, '').trim();
    const whole = CLOSING_TEXT_RE.exec(body);
    if (whole) {
      items.push({ type, n, text: '', close: closeStatus(whole[1]) });
      continue;
    }
    if (!inSection && !bold && !sep) continue;
    const tail = TRAILING_CLOSE_RE.exec(body);
    const itemText = tail ? body.slice(0, tail.index).trim() : body;
    if (tail && itemText) {
      items.push({ type, n, text: itemText, close: closeStatus(tail[1] ?? tail[2] ?? tail[3]) });
      continue;
    }
    items.push({ type, n, text: body });
  }
  return items;
}

const ID = '[ASQD]\\d+';
const ID_LIST = `${ID}(?:[ \\t]*(?:,|and)?[ \\t]*${ID})*`;
// Words that may come before a reply verb without making it prose.
const COURTESY = '(?:(?:please|pls|ok|okay|yes|yeah|yep|sure|now|then|go ahead and|let\'s|lets)[ \\t]*,?[ \\t]+)*';
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
  const ids = (s) => s.match(new RegExp(ID, 'gi')) ?? [];
  // "done A1", "do A2", "skip S3 S4" at the start of the message or of a clause, optionally
  // after a courtesy word: "please do A2", "ok, do A2", "go ahead and do A2".
  const verbRe = new RegExp(
    `(?:^|[\\n,;.!])[ \\t]*${COURTESY}(done|do|skip)[ \\t]+(${ID_LIST})(?=$|[\\s.,;!?])`, 'gi',
  );
  for (const m of t.matchAll(verbRe)) {
    for (const id of ids(m[2])) push({ kind: m[1].toLowerCase(), id: id.toUpperCase() });
  }
  // Postfix form at clause start, ending the clause: "A1 done", "S2, S3 skip", "A1 is done."
  const postfixRe = new RegExp(
    `(?:^|[\\n,;.!])[ \\t]*(${ID_LIST})[ \\t]+(?:is[ \\t]+|are[ \\t]+)?(done|finished|skip|skipped)(?=[ \\t]*(?:$|[\\n.,;!?]))`, 'gi',
  );
  for (const m of t.matchAll(postfixRe)) {
    const kind = /^skip/i.test(m[2]) ? 'skip' : 'done';
    for (const id of ids(m[1])) push({ kind, id: id.toUpperCase() });
  }
  // "Q1: yes", "D3 = b". The value ends at , ; ! ? newline or a sentence-ending period.
  const answerRe = /(?:^|[\s,;])([QD]\d+)\s*[:=]\s*((?:[^,;!?\n.]|\.(?=\S))+)(\??)/gi;
  for (const m of t.matchAll(answerRe)) {
    const id = m[1].toUpperCase();
    const value = m[2].trim();
    if (m[3] === '?') push({ kind: 'ref', id, value: value.slice(0, MAX_ANSWER) });
    else if (value && value.length <= MAX_ANSWER) push({ kind: 'answer', id, value });
  }
  // A message that is only IDs ("A2", "A2, S1") means "do these" for actions and suggestions;
  // for questions and decisions it only points at the item.
  if (replies.length === 0 && new RegExp(`^[\\s,;]*(?:${ID}[\\s,;]*)+$`, 'i').test(t)) {
    for (const raw of ids(t)) {
      const id = raw.toUpperCase();
      push(id[0] === 'Q' || id[0] === 'D' ? { kind: 'ref', id, value: '' } : { kind: 'do', id });
    }
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
