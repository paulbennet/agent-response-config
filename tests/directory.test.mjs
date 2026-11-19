// The Claude plugin directory edition must pass the directory's rules for organizations that are
// not Verified: only Markdown, text, JSON, YAML and images; no hooks, scripts or package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-directory-'));
execFileSync(process.execPath, [path.join(root, 'tools/directory-build.mjs'), '--out', out]);

const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(path.join(dir, e.name)) : [path.relative(out, path.join(dir, e.name)).replace(/\\/g, '/')]);
const all = files(out);

test('directory edition holds only allowed file types', () => {
  for (const f of all) {
    assert.ok(/\.(md|txt|json|ya?ml|png|jpe?g|gif|webp|ico)$/.test(f) || f === 'LICENSE', `not allowed: ${f}`);
    if (!f.endsWith('.png')) {
      const text = fs.readFileSync(path.join(out, f), 'utf8');
      assert.ok(!text.startsWith('#!'), `${f} starts with #!`);
      assert.ok(!text.includes('\0'), `${f} has a NUL byte`);
    }
  }
  assert.ok(!all.some((f) => /(^|\/)(package(-lock)?\.json|hooks\.json|\.mcp\.json)$/.test(f)), all.join(', '));
});

test('directory manifest has no hooks and lists the output style and icon', () => {
  const m = JSON.parse(fs.readFileSync(path.join(out, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(m.name, 'response-config');
  assert.equal(m.hooks, undefined);
  assert.equal(m.outputStyles, './output-styles/');
  assert.ok(all.includes('assets/icon.png') && all.includes('skills/response-config/SKILL.md'));
  assert.equal(m.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
});

test('directory edition text names no script or CLI', () => {
  for (const f of all.filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(out, f), 'utf8');
    assert.doesNotMatch(text, /node <skill-dir>|scripts\/|\.mjs|setup\.mjs|config\.mjs/, f);
  }
});
