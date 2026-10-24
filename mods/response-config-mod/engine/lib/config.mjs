// Config resolution: defaults < user file < project file.
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

// Like readJson, but tells "missing" apart from "exists and does not parse".
// Writers must refuse to touch a file whose state is 'invalid', or they would wipe it.
export function readJsonStrict(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { state: 'missing', data: undefined };
  }
  if (!text.trim()) return { state: 'ok', data: {} };
  try {
    return { state: 'ok', data: JSON.parse(text) };
  } catch (e) {
    return { state: 'invalid', data: undefined, error: e.message };
  }
}

// Reads a JSON object file for editing. Throws instead of returning {} for a broken file.
export function readJsonForEdit(file) {
  const r = readJsonStrict(file);
  if (r.state === 'invalid') {
    throw new Error(`${file} is not valid JSON (${r.error}). Fix it by hand; nothing was changed.`);
  }
  if (r.state === 'ok' && !isObj(r.data)) throw new Error(`${file} does not hold a JSON object; nothing was changed.`);
  return r.data ?? {};
}

export function loadDefaults() {
  return readJson(path.join(SKILL_DIR, 'config.default.json')) ?? {};
}

// Walk up from cwd looking for the project file; stop at a .git root, the home directory
// (exclusive: a file there is not a project file) or the filesystem root.
export function findProjectConfig(cwd, home = os.homedir()) {
  let dir = path.resolve(cwd || process.cwd());
  const stop = path.resolve(home);
  for (;;) {
    if (dir === stop) return undefined;
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

export function loadConfig({ cwd, env = process.env } = {}) {
  const sources = ['defaults'];
  const problems = [];
  let cfg = loadDefaults();
  const layers = [['user', userConfigPath(env)]];
  const projectPath = findProjectConfig(cwd, env.RC_HOME_DIR || os.homedir());
  if (projectPath) layers.push([`project:${projectPath}`, projectPath]);
  for (const [name, file] of layers) {
    const r = readJsonStrict(file);
    if (r.state === 'invalid') {
      problems.push(`${name}: not valid JSON (${r.error}); layer ignored`);
      continue;
    }
    const layer = r.data;
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
