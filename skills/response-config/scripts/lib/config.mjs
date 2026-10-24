// Config resolution: defaults < plugin options < user file < project file.
// Session overrides (ledger) and per-turn tags are applied by hint.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepMerge, isObj } from './core.mjs';

export { deepMerge };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(HERE, '..', '..');
export const PROJECT_FILE = '.response-config.json';

export function configDir(env = process.env) {
  if (env.RC_CONFIG_DIR) return env.RC_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'response-config');
  if (process.platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'response-config');
  return path.join(os.homedir(), '.config', 'response-config');
}

export const userConfigPath = (env = process.env) => path.join(configDir(env), 'config.json');

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export function loadDefaults() {
  return readJson(path.join(SKILL_DIR, 'config.default.json')) ?? {};
}

// Walk up from cwd looking for the project file; stop at a .git root or filesystem root.
export function findProjectConfig(cwd) {
  let dir = path.resolve(cwd || process.cwd());
  for (;;) {
    const candidate = path.join(dir, PROJECT_FILE);
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(dir, '.git'))) return undefined;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// Minimal structural validation matching config.schema.json.
const ENUMS = {
  'minimal.level': ['low', 'medium', 'high', 'extreme'],
  'language.cefr': ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null],
  'language.vocabulary': ['basic-english', 'globish', 'ste', 'oxford-3000', 'oxford-5000', 'ngsl', 'awl', null],
  'claude.outputStyle.scope': ['user', 'project'],
};
export const READABILITY = ['flesch-reading-ease', 'flesch-kincaid', 'gunning-fog', 'smog', 'coleman-liau', 'dale-chall'];
const PRESERVE = ['code', 'commands', 'tables', 'errors', 'paths', 'diffs'];
const SECTIONS = ['actions', 'suggestions', 'questions', 'decisions'];
const BOOLS = [
  'enabled', 'minimal.on', 'structured.on', 'structured.showEmptySections', 'structured.replyHint',
  'language.on', 'language.plainLanguage', 'hooks.sessionStart', 'hooks.eachPrompt', 'hooks.ledger',
  'overrides.inlineTags', 'claude.outputStyle.manage', 'claude.outputStyle.activate',
];

function walk(obj, prefix, fn) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isObj(v) && p !== 'language.readability') walk(v, p, fn);
    else fn(p, v);
  }
}

export function validate(cfg) {
  const errors = [];
  if (!isObj(cfg)) return ['config must be a JSON object'];
  const known = new Set([
    ...Object.keys(ENUMS), ...BOOLS, 'minimal.maxWords', 'minimal.preserve', 'structured.sections',
    'language.readability', '$schema',
  ]);
  walk(cfg, '', (p, v) => {
    if (!known.has(p)) errors.push(`unknown key: ${p}`);
    else if (p in ENUMS) {
      if (!ENUMS[p].includes(v)) errors.push(`${p}: invalid value ${JSON.stringify(v)}`);
    } else if (BOOLS.includes(p)) {
      if (typeof v !== 'boolean') errors.push(`${p}: must be boolean`);
    } else if (p === 'minimal.maxWords') {
      if (!Number.isInteger(v) || v < 10 || v > 1000) errors.push('minimal.maxWords: integer 10-1000');
    } else if (p === 'minimal.preserve') {
      if (!Array.isArray(v) || v.some((x) => !PRESERVE.includes(x))) errors.push('minimal.preserve: invalid list');
    } else if (p === 'structured.sections') {
      if (!Array.isArray(v) || v.some((x) => !SECTIONS.includes(x))) errors.push('structured.sections: invalid list');
    } else if (p === 'language.readability') {
      if (v !== null && !(isObj(v) && READABILITY.includes(v.standard) && typeof v.target === 'number')) {
        errors.push('language.readability: null or {standard, target}');
      }
    }
  });
  return errors;
}

// CLAUDE_PLUGIN_OPTION_* values (plugin userConfig) form the lowest non-default layer.
export function pluginOptionsLayer(env = process.env) {
  const layer = {};
  const lvl = env.CLAUDE_PLUGIN_OPTION_MINIMAL_LEVEL;
  if (lvl === 'off') layer.minimal = { on: false };
  else if (lvl) layer.minimal = { on: true, level: lvl };
  const cefr = env.CLAUDE_PLUGIN_OPTION_CEFR;
  if (cefr === 'off') layer.language = { on: false };
  else if (cefr) layer.language = { on: true, cefr };
  const st = env.CLAUDE_PLUGIN_OPTION_STRUCTURED;
  if (st === 'true' || st === 'false') layer.structured = { on: st === 'true' };
  return layer;
}

export function loadConfig({ cwd, env = process.env } = {}) {
  const sources = ['defaults'];
  const problems = [];
  let cfg = loadDefaults();
  const layers = [
    ['plugin-options', pluginOptionsLayer(env)],
    ['user', readJson(userConfigPath(env))],
  ];
  const projectPath = findProjectConfig(cwd);
  if (projectPath) layers.push([`project:${projectPath}`, readJson(projectPath)]);
  for (const [name, layer] of layers) {
    if (!layer || (isObj(layer) && Object.keys(layer).length === 0)) continue;
    const errs = validate(layer);
    if (errs.length) {
      problems.push(`${name}: ${errs.join('; ')}`);
      continue;
    }
    cfg = deepMerge(cfg, layer);
    sources.push(name);
  }
  return { config: cfg, sources, problems, projectPath };
}

// --- editing helpers (used by the config CLI and the mod) ---

export function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[keys.at(-1)] = value;
  return obj;
}

export function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
