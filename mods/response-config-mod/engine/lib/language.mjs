// English level in one word: a CEFR level, "plain", a preset or "off". Pure: no node: imports.
// Used by the CLI (--level), the hooks and the mod (session level, config pane, wizard).

// A preset sets the fields it names and wins over them; the other language fields still apply.
export const PRESETS = {
  simple: { cefr: 'A2', plainLanguage: true, vocabulary: 'oxford-3000' },
  global: { cefr: 'B1', vocabulary: 'globish' },
  technical: { cefr: 'B2', vocabulary: 'ste' },
};
export const PRESET_TEXT = {
  simple: 'A2, plain language, Oxford 3000 words',
  global: 'B1, Globish words, for readers of any first language',
  technical: 'B2, Simplified Technical English (ASD-STE100)',
};
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const LEVEL_NAMES = ['off', ...CEFR_LEVELS, 'plain', ...Object.keys(PRESETS)];

// "b1" -> "B1", "Simple" -> "simple"; undefined when it names no level.
export function normalizeLevel(raw) {
  const s = String(raw ?? '').trim();
  if (/^[a-c][12]$/i.test(s)) return s.toUpperCase();
  const lower = s.toLowerCase();
  return LEVEL_NAMES.includes(lower) ? lower : undefined;
}

// The language block with its preset's fields applied. Idempotent.
export function resolveLanguage(language) {
  const preset = language?.preset && PRESETS[language.preset];
  return preset ? { ...language, ...preset } : language;
}

// The one word that describes a language block, as the level select shows it.
export function levelOf(language) {
  if (!language?.on) return 'off';
  if (language.preset && PRESETS[language.preset]) return language.preset;
  if (language.cefr) return language.cefr;
  return language.plainLanguage ? 'plain' : 'off';
}

// The session override (or one-turn patch) for a level.
export function levelPatch(level) {
  const l = normalizeLevel(level);
  if (!l) return null;
  if (l === 'off') return { language: { on: false } };
  if (l === 'plain') return { language: { on: true, preset: null, cefr: null, plainLanguage: true } };
  if (PRESETS[l]) return { language: { on: true, preset: l } };
  return { language: { on: true, preset: null, cefr: l } };
}

// --set pairs that save a level. A preset starts clean: the fields it does not set are cleared.
export function levelPairs(level) {
  const l = normalizeLevel(level);
  if (!l) return null;
  if (l === 'off') return ['language.on=false'];
  if (l === 'plain') return ['language.on=true', 'language.preset=null', 'language.cefr=null', 'language.plainLanguage=true'];
  if (PRESETS[l]) {
    return [
      'language.on=true', `language.preset=${JSON.stringify(l)}`, 'language.readability=null',
      'language.vocabulary=null', 'language.plainLanguage=false',
    ];
  }
  return ['language.on=true', 'language.preset=null', `language.cefr=${l}`];
}

// Before one language field is changed under a preset: pairs that write the preset's fields out
// and clear it, so the change takes effect and the rest of the preset is kept.
export function detachPairs(language) {
  const preset = language?.preset && PRESETS[language.preset];
  if (!preset) return [];
  return [...Object.entries(preset).map(([k, v]) => `language.${k}=${JSON.stringify(v)}`), 'language.preset=null'];
}

const FIELD_RE = /^language\.(cefr|readability|vocabulary|plainLanguage)=/;
// The pairs, with detachPairs first when they change a field the preset sets and not the preset.
export function withDetach(language, pairs) {
  const touches = pairs.some((p) => FIELD_RE.test(p));
  const setsPreset = pairs.some((p) => p.startsWith('language.preset='));
  return touches && !setsPreset ? [...detachPairs(language), ...pairs] : pairs;
}
