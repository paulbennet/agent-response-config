// Renders the rules text (session start, output style) and the short per-prompt hint.
import { STATUS_EMOJI as E, deepMerge, nextIds, openItems } from './core.mjs';
import { levelPatch, resolveLanguage } from './language.mjs';

export const MAX_HINT_CHARS = 9000;

const LEVELS = {
  low: 'Cut filler, preamble and repetition. Full sentences are fine.',
  medium: 'No preamble, recap or restating the question. Short paragraphs, one idea per sentence.',
  high: 'Lead with the result in 1-3 short sentences. No preamble, narration, recap or hedging. Drop every sentence that does not change what the reader does next.',
  extreme: 'Result first, then stop. Fragments are fine. One line unless artefacts or items are needed. No explanation unless asked.',
};

// Default prose budget per level; an explicit minimal.maxWords wins.
export const LEVEL_WORDS = { low: 150, medium: 110, high: 80, extreme: 40 };

export const wordBudget = (minimal) => minimal.maxWords ?? LEVEL_WORDS[minimal.level] ?? LEVEL_WORDS.high;

// Under a tight budget the model fills it with suggestions and questions nobody asked for.
const TIGHT_WORDS = 40;

const PRESERVE_TEXT = {
  code: 'code blocks',
  commands: 'shell commands',
  tables: 'tables',
  errors: 'error and log output',
  paths: 'file paths and identifiers',
  diffs: 'diffs and patches',
};

const CEFR = {
  A1: 'CEFR A1: sentences of 8 words or fewer, the 500 most common words, present tense, no idioms or phrasal verbs.',
  A2: 'CEFR A2: sentences of 12 words or fewer, about 1,000 common words, simple tenses, no idioms.',
  B1: 'CEFR B1: sentences of 16 words or fewer, about 2,000 common words, explain any technical term in a few words, avoid idioms.',
  B2: 'CEFR B2: sentences of 20 words or fewer, clear everyday and technical words, idioms only when common.',
  C1: 'CEFR C1: fluent, precise, varied sentences, no padding.',
  C2: 'CEFR C2: no limit on vocabulary or structure; stay precise and economical.',
};

const READABILITY = {
  'flesch-reading-ease': (n) => `Aim for a Flesch Reading Ease score of ${n} or higher.`,
  'flesch-kincaid': (n) => `Aim for a Flesch-Kincaid grade level of ${n} or lower.`,
  'gunning-fog': (n) => `Aim for a Gunning Fog index of ${n} or lower.`,
  smog: (n) => `Aim for a SMOG grade of ${n} or lower.`,
  'coleman-liau': (n) => `Aim for a Coleman-Liau grade of ${n} or lower.`,
  'dale-chall': (n) => `Aim for a Dale-Chall score of ${n} or lower; prefer words on the Dale-Chall familiar-word list.`,
};

const VOCAB = {
  'basic-english': 'Vocabulary: Basic English (Ogden, about 850 words). Technical terms, names and numbers are allowed.',
  globish: 'Vocabulary: Globish (about 1,500 common words). Technical terms and names are allowed.',
  ste: 'Vocabulary: follow ASD-STE100 Simplified Technical English: approved words, one meaning per word, active voice, sentences of 20 words or fewer.',
  'oxford-3000': 'Vocabulary: prefer words from the Oxford 3000 list.',
  'oxford-5000': 'Vocabulary: prefer words from the Oxford 5000 list.',
  ngsl: 'Vocabulary: prefer words from the New General Service List (NGSL).',
  awl: 'Vocabulary: prefer general-service words; Academic Word List words are allowed.',
};

const PLAIN =
  'Plain language: main point first, active voice, short sentences, common words. Speak to the reader directly as "you" ("you can", "your files"), never in impersonal terms.';

// The config patch the tags stand for. `!keep` stores the same patch as a session override.
export function tagPatch(tags = {}) {
  let p = {};
  if (tags.on) p = deepMerge(p, { enabled: true });
  if (tags.verbose) p = deepMerge(p, { minimal: { on: false } });
  if (tags.terse) p = deepMerge(p, { minimal: { on: true } });
  if (tags.plain) p = deepMerge(p, { language: { on: true, plainLanguage: true } });
  if (tags.level) p = deepMerge(p, levelPatch(tags.level) ?? {});
  if (tags.words) p = deepMerge(p, { minimal: { on: true, maxWords: tags.words } });
  if (tags.off) p = deepMerge(p, { enabled: false });
  return p;
}

// Session overrides after `!keep` / `!reset` tags: what the session keeps from now on.
export function keptOverrides(overrides = {}, tags = {}) {
  const base = tags.reset ? {} : overrides ?? {};
  return tags.keep ? deepMerge(base, tagPatch(tags)) : base;
}

// Apply session overrides and one-turn tags on top of a loaded config.
export function effectiveConfig(config, sessionOverrides = {}, tags = {}) {
  return deepMerge(deepMerge(config, sessionOverrides ?? {}), tagPatch(tags));
}

export function modeSummary(cfg) {
  if (!cfg.enabled) return 'off';
  const parts = [];
  if (cfg.minimal.on) parts.push(`terse:${cfg.minimal.level}`);
  if (cfg.structured.on) parts.push('structured');
  if (cfg.language.on) parts.push(cfg.language.preset ?? cfg.language.cefr ?? 'plain');
  return parts.join(' ') || 'idle';
}

const SECTION_LABEL = { actions: 'Actions (A)', suggestions: 'Suggestions (S)', questions: 'Questions (Q)', decisions: 'Decisions (D)' };

// The stable rules. Used by the session-start hint, the managed output style and the mod.
export function renderRules(cfg) {
  const lines = [];
  if (!cfg.enabled) return 'response-config is off. Answer normally.';
  if (cfg.minimal.on) {
    const keep = (cfg.minimal.preserve ?? []).map((k) => PRESERVE_TEXT[k]).filter(Boolean);
    lines.push('BREVITY');
    lines.push(`- ${LEVELS[cfg.minimal.level]}`);
    const budget = wordBudget(cfg.minimal);
    lines.push(`- Prose budget: at most ${budget} words outside artefacts, the items included. Add a table or code block only when the request needs one.`);
    if (budget <= TIGHT_WORDS) {
      lines.push(`- ${budget} words is a hard cap: count the prose words before you send and cut until it fits. Answer only what was asked, with no extra tips or follow-ups.`);
      const unasked = cfg.structured.on ? ['suggestions', 'questions'].filter((x) => cfg.structured.sections.includes(x)) : [];
      if (unasked.length) lines.push(`- Add no ${unasked.join(' or ')} the user did not ask for.`);
    }
    if (keep.length) lines.push(`- Never shorten or alter these artefacts: ${keep.join(', ')}.`);
    lines.push(
      '- Exceptions, always full length: error messages, failing test output, security warnings, confirmations before destructive actions, and anything the user explicitly asks to have explained in detail.',
    );
    lines.push('- Quote error messages and failing test output verbatim in a code block; never only paraphrase them.');
  }
  if (cfg.structured.on) {
    lines.push('STRUCTURE');
    lines.push('- Shape: a minimal summary of what happened, then the sections below.');
    const sections = cfg.structured.sections;
    for (const s of sections) lines.push(`  ${SECTION_LABEL[s]}`);
    if (sections.length < 4) lines.push('- Use only these sections. What would go in another section goes in the summary.');
    const emoji = cfg.structured.statusEmoji;
    lines.push(
      `- One bullet per item, written "- ${emoji ? `${E.open} ` : ''}A1 text", under its section heading. Number each type separately (A, S, Q, D) with counters that never reset and never reuse an ID in this session.`,
    );
    if (emoji) lines.push(`- Start each item with its status: ${E.open} open, ${E['in-progress']} in progress.`);
    lines.push(
      cfg.structured.showEmptySections
        ? '- Show every section, writing "none" when empty.'
        : '- Omit sections that are empty.',
    );
    lines.push(
      '- Anything the user must notice (risk, caveat, blocked step, follow-up) goes in an item, not in the summary prose.',
    );
    const forms = [
      sections.includes('questions') && 'Questions need a concrete answer form, for example "(yes/no)".',
      sections.includes('decisions') && 'Decisions list lettered options: "(a) ... (b) ...".',
    ].filter(Boolean);
    if (forms.length) lines.push(`- ${forms.join(' ')}`);
    if (sections.includes('decisions')) {
      lines.push('- When the user asks which option to take, or a choice is theirs to make, put it under Decisions and mark your pick "(recommended)". Do not settle it in the summary.');
    }
    const resolvedLine = emoji
      ? `"Resolved: ${E.done} A2, ${E.answered} Q1, ${E.skipped} S1" (${E.done} done, ${E.answered} answered, ${E.skipped} skipped)`
      : '"Resolved: A2, Q1 (answered), S1 (skipped)"';
    lines.push(`- Never list a finished or settled item under its section again, not even as a recap. Close it in one line after the sections: ${resolvedLine}. Never add an item only to close it in the same reply.`);
    if (cfg.structured.replyHint) {
      lines.push(
        '- The user may reply by ID: "A2" or "do A2", "done A1", "skip S1", "Q1: yes", "D3: b". Treat these as answers to those items.',
      );
    }
  }
  lines.push(...languageLines(cfg));
  lines.push(
    'TAGS: if the user message has !verbose (full detail this turn), !plain (plain language), !level=<A1-C2>, !words=<n>, or !off (ignore these rules this turn), apply it for that turn only.',
  );
  return lines.join('\n');
}

// The LANGUAGE block. The prompt hint repeats it in full: a level set by a tag or kept with
// !keep is not in the session's rules, and a bare "A2" or "simple" tells the model too little.
export function languageLines(cfg) {
  if (!cfg.language.on) return [];
  const lang = resolveLanguage(cfg.language);
  const lines = ['LANGUAGE'];
  if (lang.cefr) lines.push(`- ${CEFR[lang.cefr]}`);
  if (['A1', 'A2', 'B1'].includes(lang.cefr)) {
    lines.push('- The sentence limit is a hard cap: count the words of each sentence before you send and split any that runs over.');
  }
  const r = lang.readability;
  if (r) lines.push(`- ${READABILITY[r.standard](r.target)}`);
  if (lang.vocabulary) lines.push(`- ${VOCAB[lang.vocabulary]}`);
  if (lang.plainLanguage) lines.push(`- ${PLAIN}`);
  lines.push('- Code, identifiers, commands and quoted output are exempt from these language limits.');
  return lines;
}

function itemLines(ledger, emoji, limit = 12) {
  const open = openItems(ledger);
  const shown = open.slice(-limit).map((i) => (emoji
    ? `- ${E[i.status]} ${i.id}: ${i.text}`
    : `- ${i.id}${i.status === 'in-progress' ? ' (in progress)' : ''}: ${i.text}`));
  const more = open.length - shown.length;
  if (more > 0) shown.push(`- ... and ${more} older open item(s)`);
  return shown;
}

const cap = (s) => (s.length > MAX_HINT_CHARS ? `${s.slice(0, MAX_HINT_CHARS - 20)}\n[truncated]` : s);

export function renderSessionHint(cfg, ledger, { notes = [] } = {}) {
  const out = ['[response-config] Follow these rules for every reply in this session.', renderRules(cfg)];
  if (cfg.enabled && cfg.structured.on && ledger) {
    const open = itemLines(ledger, cfg.structured.statusEmoji);
    if (open.length) out.push('OPEN ITEMS from earlier turns:', ...open);
    out.push(`Next IDs: ${nextIds(ledger, cfg.structured.sections)}`);
  }
  for (const n of notes) out.push(`NOTE: ${n}`);
  return cap(out.join('\n'));
}

// One line that restates the rules, for prompts after the full rules were delivered.
export function renderDigest(cfg) {
  if (!cfg.enabled) return '';
  const parts = [];
  if (cfg.minimal.on) {
    const budget = wordBudget(cfg.minimal);
    const cap = budget <= TIGHT_WORDS ? ' (hard cap: count before sending, no extra tips)' : '';
    parts.push(`brevity ${cfg.minimal.level}, at most ${budget} prose words with the items${cap}, artefacts verbatim, errors in full`);
  }
  if (cfg.structured.on) {
    const s = cfg.structured.sections;
    const ids = s.map((x) => `${x[0].toUpperCase()}1`).join('/');
    const heads = s.map((x) => x[0].toUpperCase() + x.slice(1)).join('/');
    const mark = cfg.structured.statusEmoji ? `${E.open} ` : '';
    parts.push(`summary then "- ${mark}${ids}" items under ${heads} headings only, closed items only in a Resolved line, IDs never reused`);
  }
  return parts.length ? `Rules: ${parts.join('; ')}.` : '';
}

const VERB = { do: 'started', done: 'finished', skip: 'skipped' };

// Short per-prompt hint. withRules: also include the full rules (session hint not delivered).
export function renderPromptHint(cfg, ledger, { resolved = [], tags = {}, problems = [], reused = [], withRules = false } = {}) {
  if (!cfg.enabled) {
    return tags.off ? '[response-config] off for this turn (!off). Answer normally.' : '';
  }
  const lines = [`[response-config] mode: ${modeSummary(cfg)}.`];
  if (withRules) lines.push(renderRules(cfg));
  else {
    const digest = renderDigest(cfg);
    if (digest) lines.push(digest);
    lines.push(...languageLines(cfg));
  }
  const tagNames = Object.entries(tags).filter(([k]) => k !== 'keep' && k !== 'reset')
    .map(([k, v]) => (v === true ? `!${k}` : `!${k}=${v}`));
  if (tags.reset) lines.push('Session overrides cleared (!reset).');
  if (tagNames.length) lines.push(`${tags.keep ? 'Kept for the rest of this session' : 'Tags this turn only'}: ${tagNames.join(' ')}.`);
  if (cfg.structured.on && ledger) {
    for (const r of reused.slice(0, 4)) {
      lines.push(`Your last reply reused ${r.id} for a new item; the earlier ${r.id} (${r.text}) is no longer tracked. Never reuse IDs: take new ones from "Next IDs".`);
    }
    for (const r of resolved.slice(0, 6)) {
      if (r.unknown) lines.push(`User referenced ${r.id}. If it is in your earlier replies, act on it; otherwise ask which item they mean. Do not mention this note.`);
      else if (r.kind === 'answer') lines.push(`User answered ${r.id} (${r.text}): "${r.value}".`);
      else if (r.kind === 'ref' && !r.value) lines.push(`User pointed at ${r.id} (${r.text}); help them settle it.`);
      else if (r.kind === 'ref') lines.push(`User asked about ${r.id} (${r.text}): "${r.value}?"`);
      else lines.push(`User ${VERB[r.kind]} ${r.id}: ${r.text}.`);
    }
    const open = openItems(ledger);
    if (open.length) lines.push(`Open: ${open.map((i) => i.id).join(' ')}`);
    lines.push(`Next IDs: ${nextIds(ledger, cfg.structured.sections)}`);
  }
  for (const p of problems.slice(0, 1)) lines.push(`Config problem: ${p}`);
  return cap(lines.join('\n'));
}
