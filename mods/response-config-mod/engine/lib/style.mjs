// Managed Claude Code output style: generate, drift-check, sync, activate, remove.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectRoot, readJsonForEdit, writeJsonAtomic } from './config.mjs';
import { renderRules } from './hint.mjs';

export const STYLE_NAME = 'response-config-managed';
export const STYLE_FILE = `${STYLE_NAME}.md`;
const VERSION = 'v1';
const PROV_RE = /<!-- response-config (v\d+) config=([0-9a-f]{16}) body=([0-9a-f]{16}) -->\s*$/;

// Line endings are normalised so an editor that saves CRLF does not count as an edit.
const sha = (s) => crypto.createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

// Only the keys that change the rules text feed the config hash.
export function relevantConfig(cfg) {
  return { enabled: cfg.enabled, minimal: cfg.minimal, structured: cfg.structured, language: cfg.language };
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function compileStyle(cfg) {
  const configHash = sha(canonical(relevantConfig(cfg)));
  const content = [
    '---',
    `name: ${STYLE_NAME}`,
    'description: Generated from response-config. Do not hand-edit; change the config instead.',
    'keep-coding-instructions: true',
    '---',
    '',
    'These rules come from the response-config skill. Follow them in every reply.',
    '',
    renderRules(cfg),
    '',
  ].join('\n');
  const bodyHash = sha(content);
  const file = `${content}<!-- response-config ${VERSION} config=${configHash} body=${bodyHash} -->\n`;
  return { content, configHash, bodyHash, file };
}

export function parseProvenance(text) {
  const m = PROV_RE.exec(text);
  if (!m) return undefined;
  return { version: m[1], configHash: m[2], bodyHash: m[3], content: text.slice(0, m.index) };
}

export function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Project scope is anchored at the project root, so a session started in a subfolder
// updates the same file instead of creating another one beside it.
export function styleDir(scope, { cwd, env = process.env } = {}) {
  return scope === 'project'
    ? path.join(projectRoot(cwd, env), '.claude', 'output-styles')
    : path.join(claudeDir(env), 'output-styles');
}

export const stylePath = (scope, opts) => path.join(styleDir(scope, opts), STYLE_FILE);

function settingsPath(scope, { cwd, env = process.env } = {}) {
  return scope === 'project'
    ? path.join(projectRoot(cwd, env), '.claude', 'settings.local.json')
    : path.join(claudeDir(env), 'settings.json');
}

// state: missing | unmanaged | in-sync | stale | drifted
export function styleStatus(cfg, opts = {}) {
  const scope = cfg.claude.outputStyle.scope;
  const file = stylePath(scope, opts);
  const want = compileStyle(cfg);
  if (!fs.existsSync(file)) return { state: 'missing', file, want };
  const text = fs.readFileSync(file, 'utf8');
  const prov = parseProvenance(text);
  if (!prov) return { state: 'unmanaged', file, want };
  const bodyIntact = sha(prov.content) === prov.bodyHash;
  if (!bodyIntact) return { state: 'drifted', file, want, prov };
  if (prov.configHash !== want.configHash) return { state: 'stale', file, want, prov };
  return { state: 'in-sync', file, want, prov };
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// Bring the file in line with the config. Never overwrites a hand-edited file unless force.
export function syncStyle(cfg, { force = false, explicit = false, ...opts } = {}) {
  const manage = cfg.claude.outputStyle.manage;
  const st = styleStatus(cfg, opts);
  if (!manage && !force && !explicit) return { action: 'skipped', reason: 'manage is off', file: st.file, state: st.state };
  switch (st.state) {
    case 'in-sync':
      return { action: 'unchanged', file: st.file, state: st.state };
    case 'missing':
      write(st.file, st.want.file);
      return { action: 'created', file: st.file, state: 'in-sync' };
    case 'stale':
      write(st.file, st.want.file);
      return { action: 'updated', file: st.file, state: 'in-sync' };
    case 'drifted':
      if (force) {
        write(st.file, st.want.file);
        return { action: 'updated', file: st.file, state: 'in-sync', forced: true };
      }
      return { action: 'drift', file: st.file, state: 'drifted' };
    case 'unmanaged':
      if (force) {
        write(st.file, st.want.file);
        return { action: 'updated', file: st.file, state: 'in-sync', forced: true };
      }
      return { action: 'drift', file: st.file, state: 'unmanaged' };
    default:
      return { action: 'skipped', file: st.file, state: st.state };
  }
}

export function removeStyle(cfg, opts = {}) {
  const st = styleStatus(cfg, opts);
  if (st.state === 'missing') return { action: 'none', file: st.file };
  if (st.state === 'unmanaged') return { action: 'refused', reason: 'file has no response-config provenance', file: st.file };
  fs.unlinkSync(st.file);
  return { action: 'removed', file: st.file };
}

// Sets outputStyle in the matching settings file. Caller is responsible for user confirmation.
export function activateStyle(cfg, opts = {}) {
  const scope = cfg.claude.outputStyle.scope;
  const file = settingsPath(scope, opts);
  const data = readJsonForEdit(file);
  const previous = data.outputStyle;
  data.outputStyle = STYLE_NAME;
  writeJsonAtomic(file, data);
  return { file, previous };
}

export function driftNote(result) {
  if (result?.action !== 'drift') return undefined;
  const why = result.state === 'unmanaged' ? 'exists without provenance' : 'was hand-edited';
  return `The managed output style ${why} (${result.file}). It was not overwritten. Run "node scripts/config.mjs --style sync --force" to regenerate it.`;
}
