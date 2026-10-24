import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deepMerge, loadDefaults } from '../skills/response-config/scripts/lib/config.mjs';
import {
  activateStyle, compileStyle, removeStyle, styleStatus, syncStyle,
} from '../skills/response-config/scripts/lib/style.mjs';

function setup(manage = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-style-'));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir };
  const cfg = deepMerge(loadDefaults(), { claude: { outputStyle: { manage } } });
  return { dir, env, cfg, opts: { env, cwd: dir } };
}

test('compileStyle is deterministic and ignores unrelated keys', () => {
  const { cfg } = setup();
  const a = compileStyle(cfg);
  const b = compileStyle(deepMerge(cfg, { hooks: { eachPrompt: false } }));
  assert.equal(a.file, b.file);
  assert.notEqual(a.configHash, compileStyle(deepMerge(cfg, { minimal: { level: 'low' } })).configHash);
});

test('create, unchanged, stale -> updated', () => {
  const { cfg, opts } = setup();
  assert.equal(syncStyle(cfg, opts).action, 'created');
  assert.equal(syncStyle(cfg, opts).action, 'unchanged');
  const next = deepMerge(cfg, { minimal: { maxWords: 40 } });
  assert.equal(styleStatus(next, opts).state, 'stale');
  assert.equal(syncStyle(next, opts).action, 'updated');
  assert.equal(styleStatus(next, opts).state, 'in-sync');
});

test('hand edit is detected and never overwritten without force', () => {
  const { cfg, opts } = setup();
  syncStyle(cfg, opts);
  const file = styleStatus(cfg, opts).file;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Follow them in every reply.', 'Do my thing.'));
  const changed = deepMerge(cfg, { minimal: { level: 'low' } });
  assert.equal(syncStyle(changed, opts).action, 'drift');
  assert.match(fs.readFileSync(file, 'utf8'), /Do my thing/);
  assert.equal(syncStyle(changed, { ...opts, force: true }).action, 'updated');
  assert.equal(styleStatus(changed, opts).state, 'in-sync');
});

test('missing file is recreated; manage off leaves files alone', () => {
  const { cfg, opts } = setup();
  syncStyle(cfg, opts);
  fs.unlinkSync(styleStatus(cfg, opts).file);
  assert.equal(syncStyle(cfg, opts).action, 'created');
  const off = setup(false);
  assert.equal(syncStyle(off.cfg, off.opts).action, 'skipped');
});

test('remove deletes managed files and refuses unmanaged ones', () => {
  const { cfg, opts } = setup();
  syncStyle(cfg, opts);
  assert.equal(removeStyle(cfg, opts).action, 'removed');
  const file = styleStatus(cfg, opts).file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '---\nname: response-config-managed\n---\nmine\n');
  assert.equal(removeStyle(cfg, opts).action, 'refused');
  assert.ok(fs.existsSync(file));
});

test('activate sets outputStyle in settings and reports the previous value', () => {
  const { cfg, opts, dir } = setup();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ outputStyle: 'Concise', keep: 1 }));
  const res = activateStyle(cfg, opts);
  assert.equal(res.previous, 'Concise');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.deepEqual(saved, { outputStyle: 'response-config-managed', keep: 1 });
});

test('a CRLF re-save is not drift (review L2)', () => {
  const { cfg, opts } = setup();
  syncStyle(cfg, opts);
  const file = styleStatus(cfg, opts).file;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(styleStatus(cfg, opts).state, 'in-sync');
});

test('activate refuses to rewrite a settings file that does not parse (review H1)', () => {
  const { cfg, opts, dir } = setup();
  const broken = '{ "outputStyle": "Concise", }';
  fs.writeFileSync(path.join(dir, 'settings.json'), broken);
  assert.throws(() => activateStyle(cfg, opts), /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), broken);
});
