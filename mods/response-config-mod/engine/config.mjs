#!/usr/bin/env node
// response-config CLI: show, get, set, init, and manage the Claude output style.
//   node config.mjs --show [--json]
//   node config.mjs --get minimal.level
//   node config.mjs --set minimal.level=medium [--set language.on=true ...] [--project]
//   node config.mjs --level B1|plain|simple|global|technical|off [--project]
//   node config.mjs --readability flesch-kincaid=8|off   --vocab ste|off   [--project]
//   node config.mjs --init [--project]
//   node config.mjs --style status|sync|activate|remove [--force]
//   node config.mjs --ledger path|clear
import fs from 'node:fs';
import {
  deepMerge, getPath, loadConfig, loadDefaults, parseValue, projectConfigTarget, readJsonForEdit, setPath,
  userConfigPath, validate, writeJsonAtomic,
} from './lib/config.mjs';
import { LEVEL_NAMES, levelPairs, withDetach } from './lib/language.mjs';
import { clearLedgers, markModActive, sessionsDir } from './lib/ledger.mjs';
import {
  activateStyle, driftNote, removeStyle, styleStatus, syncStyle,
} from './lib/style.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const all = (f) => argv.flatMap((a, i) => (a === `--${f}` && argv[i + 1] ? [argv[i + 1]] : []));
const one = (f) => all(f)[0];
const cwd = process.cwd();

// --project edits the project file already in effect (found walking up), so a write from a
// subfolder never creates a second file that shadows it. A new file goes to the project root.
function targetFile() {
  return has('project') ? projectConfigTarget(cwd) : userConfigPath();
}

// The files the config is read from, with their mtimes, so the mod can tell when to reload.
function watchList() {
  return [userConfigPath(), projectConfigTarget(cwd)].map((file) => {
    try {
      return { path: file, mtimeMs: fs.statSync(file).mtimeMs };
    } catch {
      return { path: file, mtimeMs: null };
    }
  });
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// Shortcuts for the language block; each switches language on (or off) as well.
function languagePairs() {
  const pairs = [];
  if (has('level')) {
    const level = one('level');
    const p = levelPairs(level);
    if (!p) fail(`--level expects one of ${LEVEL_NAMES.join('|')}, got: ${level ?? ''}`);
    pairs.push(...p);
  }
  if (has('readability')) {
    const v = one('readability') ?? '';
    const m = /^([a-z-]+)=(\d+(?:\.\d+)?)$/.exec(v);
    if (v === 'off') pairs.push('language.readability=null');
    else if (m) pairs.push('language.on=true', `language.readability=${JSON.stringify({ standard: m[1], target: Number(m[2]) })}`);
    else fail(`--readability expects <standard>=<target> (e.g. flesch-kincaid=8) or off, got: ${v}`);
  }
  if (has('vocab')) {
    const v = one('vocab') ?? '';
    pairs.push(...(v === 'off' ? ['language.vocabulary=null'] : ['language.on=true', `language.vocabulary=${JSON.stringify(v)}`]));
  }
  return pairs;
}

// Writes key=value pairs to the target file. A change to a field a language preset sets first
// writes the preset out and clears it, so the change is not hidden by the preset.
function writePairs(pairs) {
  const file = targetFile();
  const data = readJsonForEdit(file);
  for (const pair of withDetach(loadConfig({ cwd }).config.language, pairs)) {
    const eq = pair.indexOf('=');
    if (eq < 1) fail(`--set expects key=value, got: ${pair}`);
    setPath(data, pair.slice(0, eq), parseValue(pair.slice(eq + 1)));
  }
  const errors = validate(data);
  if (errors.length) fail(`not written, invalid config:\n- ${errors.join('\n- ')}`);
  writeJsonAtomic(file, data);
  console.log(`wrote ${file}`);
  return syncAfterWrite();
}

function syncAfterWrite() {
  const { config } = loadConfig({ cwd });
  if (!config.claude.outputStyle.manage) return;
  const res = syncStyle(config, { cwd });
  console.log(`output style: ${res.action} (${res.file})`);
  const note = driftNote(res);
  if (note) console.log(`WARNING: ${note}`);
}

function main() {
  if (has('mod-active')) {
    markModActive(one('mod-active'));
    return console.log('marked');
  }
  if (has('ledger')) {
    const action = one('ledger');
    if (action === 'path') return console.log(sessionsDir());
    if (action === 'clear') return console.log(`removed ${clearLedgers()} file(s)`);
    fail('--ledger expects path|clear');
  }
  if (has('show')) {
    const { config, sources, problems } = loadConfig({ cwd });
    if (has('json')) {
      const style = config.claude.outputStyle.manage ? styleStatus(config, { cwd }).state : 'off';
      return console.log(JSON.stringify({ config, sources, problems, style, watch: watchList() }));
    }
    console.log(`sources: ${sources.join(', ')}`);
    for (const p of problems) console.log(`problem: ${p}`);
    console.log(JSON.stringify(config, null, 2));
    if (config.claude.outputStyle.manage) {
      const st = styleStatus(config, { cwd });
      console.log(`output style: ${st.state} (${st.file})`);
    }
    return;
  }
  if (has('get')) {
    const key = one('get');
    const { config } = loadConfig({ cwd });
    const v = key ? getPath(config, key) : config;
    return console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  }
  if (has('set') || has('level') || has('readability') || has('vocab')) {
    return writePairs([...languagePairs(), ...all('set')]);
  }
  if (has('init')) {
    const file = targetFile();
    if (fs.existsSync(file) && !has('force')) fail(`${file} exists (use --force to overwrite)`);
    writeJsonAtomic(file, deepMerge(loadDefaults(), {}));
    console.log(`wrote ${file}`);
    return syncAfterWrite();
  }
  if (has('style')) {
    const action = one('style');
    const { config } = loadConfig({ cwd });
    const opts = { cwd, force: has('force') };
    if (action === 'status') {
      const st = styleStatus(config, opts);
      console.log(`${st.state}: ${st.file}`);
      if (st.state === 'drifted' || st.state === 'unmanaged') console.log(driftNote({ action: 'drift', ...st }));
      return;
    }
    if (action === 'sync') {
      const res = syncStyle(config, { ...opts, explicit: true });
      console.log(`${res.action}: ${res.file}`);
      const note = driftNote(res);
      if (note) console.log(`WARNING: ${note}`);
      return;
    }
    if (action === 'activate') {
      const res = activateStyle(config, opts);
      console.log(`outputStyle set in ${res.file}${res.previous ? ` (was: ${res.previous})` : ''}`);
      return console.log('A terminal session reads style files at startup; restart or run /output-style response-config-managed.');
    }
    if (action === 'remove') {
      const res = removeStyle(config, opts);
      return console.log(`${res.action}: ${res.file}${res.reason ? ` (${res.reason})` : ''}`);
    }
    fail('--style expects status|sync|activate|remove');
  }
  console.log(
    [
      'usage:',
      '  config.mjs --show [--json]',
      '  config.mjs --get <key>',
      '  config.mjs --set key=value [--set key=value ...] [--project]',
      `  config.mjs --level ${LEVEL_NAMES.join('|')} [--project]`,
      '  config.mjs --readability <standard>=<target>|off  --vocab <list>|off  [--project]',
      '  config.mjs --init [--project] [--force]',
      '  config.mjs --style status|sync|activate|remove [--force]',
      '  config.mjs --ledger path|clear',
    ].join('\n'),
  );
}

try {
  main();
} catch (e) {
  fail(e.message);
}
