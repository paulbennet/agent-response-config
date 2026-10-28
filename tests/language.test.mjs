import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../skills/response-config/scripts/hook.mjs';
import { deepMerge, loadDefaults } from '../skills/response-config/scripts/lib/config.mjs';
import { effectiveConfig, keptOverrides, modeSummary, renderRules } from '../skills/response-config/scripts/lib/hint.mjs';
import {
  detachPairs, levelOf, levelPairs, normalizeLevel, resolveLanguage, withDetach,
} from '../skills/response-config/scripts/lib/language.mjs';
import { parseTags } from '../skills/response-config/scripts/lib/parse.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'response-config', 'scripts', 'config.mjs');
const cfg = (over = {}) => deepMerge(loadDefaults(), over);

test('a level is one word: CEFR, plain, a preset or off (notes A4)', () => {
  assert.equal(normalizeLevel('b1'), 'B1');
  assert.equal(normalizeLevel('Simple'), 'simple');
  assert.equal(normalizeLevel('nope'), undefined);
  assert.deepEqual(levelPairs('off'), ['language.on=false']);
  assert.deepEqual(levelPairs('c1'), ['language.on=true', 'language.preset=null', 'language.cefr=C1']);
  assert.ok(levelPairs('global').includes('language.preset="global"'));
  assert.equal(levelOf({ on: true, preset: 'simple', cefr: 'B2' }), 'simple');
  assert.equal(levelOf({ on: true, preset: null, cefr: null, plainLanguage: true }), 'plain');
  assert.equal(levelOf({ on: false, cefr: 'B1' }), 'off');
});

test('a preset wins on its fields; the rules and summary follow it', () => {
  const c = cfg({ language: { on: true, preset: 'simple', cefr: 'C1', readability: { standard: 'smog', target: 9 } } });
  const rules = renderRules(c);
  assert.match(rules, /CEFR A2/);
  assert.match(rules, /Oxford 3000/);
  assert.match(rules, /Plain language/);
  assert.match(rules, /SMOG grade of 9/); // a field the preset does not set still applies
  assert.doesNotMatch(rules, /CEFR C1/);
  assert.equal(modeSummary(c), 'terse:high structured simple');
  assert.deepEqual(resolveLanguage(resolveLanguage(c.language)), resolveLanguage(c.language));
  // Changing one field under a preset writes the preset out first.
  assert.deepEqual(detachPairs(c.language), ['language.cefr="A2"', 'language.plainLanguage=true', 'language.vocabulary="oxford-3000"', 'language.preset=null']);
  assert.deepEqual(withDetach(c.language, ['minimal.level=low']), ['minimal.level=low']);
  assert.deepEqual(withDetach(c.language, ['language.preset=null', 'language.cefr=B1']), ['language.preset=null', 'language.cefr=B1']);
});

test('!level takes presets; !keep keeps tags for the session and !reset clears them', () => {
  assert.deepEqual(parseTags('hi !level=technical').tags, { level: 'technical' });
  assert.deepEqual(parseTags('hi !level=b2 !keep').tags, { level: 'B2', keep: true });
  const kept = keptOverrides({}, { level: 'B1', words: 40, keep: true });
  assert.equal(effectiveConfig(cfg(), kept).language.cefr, 'B1');
  assert.equal(effectiveConfig(cfg(), kept).minimal.maxWords, 40);
  assert.deepEqual(keptOverrides(kept, { reset: true }), {});
  assert.equal(keptOverrides(kept, { plain: true }), kept); // a one-turn tag changes nothing kept
  // A kept CEFR level replaces a configured preset.
  const preset = cfg({ language: { on: true, preset: 'global' } });
  assert.match(renderRules(effectiveConfig(preset, keptOverrides({}, { level: 'C1', keep: true }))), /CEFR C1/);
});

test('hooks: a level kept with !keep reaches later prompts until !reset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-lang-'));
  const env = { ...process.env, RC_CONFIG_DIR: path.join(dir, 'cfg'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude') };
  const prompt = (text) => JSON.parse(run({ agent: 'claude', event: 'prompt', input: { session_id: 's', prompt: text, cwd: dir }, env })).hookSpecificOutput.additionalContext;
  assert.match(prompt('use this level !level=simple !keep'), /Kept for the rest of this session: !level=simple/);
  assert.match(prompt('next one'), /mode: terse:high structured simple/);
  assert.match(prompt('!reset'), /Session overrides cleared/);
  assert.doesNotMatch(prompt('after'), /simple/);
});

test('CLI: --level, --vocab and --readability set the language block in one step', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-cli-'));
  const env = { ...process.env, RC_CONFIG_DIR: path.join(dir, 'cfg') };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env });
  const lang = () => JSON.parse(cli('--get', 'language').stdout);
  assert.equal(cli('--level', 'simple').status, 0);
  assert.deepEqual([lang().on, lang().preset], [true, 'simple']);
  assert.equal(cli('--vocab', 'ste').status, 0); // detaches: the preset's other fields are kept
  assert.deepEqual(lang(), { on: true, preset: null, cefr: 'A2', readability: null, vocabulary: 'ste', plainLanguage: true });
  assert.equal(cli('--level', 'B1', '--readability', 'flesch-kincaid=8').status, 0);
  assert.deepEqual([lang().cefr, lang().readability], ['B1', { standard: 'flesch-kincaid', target: 8 }]);
  assert.equal(cli('--level', 'off').status, 0);
  assert.equal(lang().on, false);
  const bad = cli('--level', 'Z9');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--level expects one of off\|A1/);
  assert.match(cli('--readability', 'fk').stderr, /--readability expects <standard>=<target>/);
});
