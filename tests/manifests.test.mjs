// Plugin manifests for Claude Code and Codex: versions in sync, hook files point at the shipped script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const exists = (p) => fs.existsSync(path.join(root, p));

test('package, skill, Claude and Codex manifests carry one version', () => {
  const v = json('package.json').version;
  assert.equal(json('.claude-plugin/plugin.json').version, v);
  assert.equal(json('.codex-plugin/plugin.json').version, v);
  const skill = fs.readFileSync(path.join(root, 'skills/response-config/SKILL.md'), 'utf8');
  assert.match(skill, new RegExp(`version: "${v.replace(/\./g, '\\.')}"`));
});

test('no root plugin.json: Codex CLI 0.165 skips plugin hooks when one exists', () => {
  assert.equal(exists('plugin.json'), false);
});

for (const [manifest, agent, rootVar] of [
  ['.claude-plugin/plugin.json', 'claude', '${CLAUDE_PLUGIN_ROOT}'],
  ['.codex-plugin/plugin.json', 'codex', '${PLUGIN_ROOT}'],
]) {
  test(`${manifest} hooks run hook.mjs with --agent ${agent}`, () => {
    const hooksFile = json(manifest).hooks;
    assert.ok(hooksFile && exists(hooksFile), `${manifest} names a hooks file that exists`);
    const events = {};
    for (const [event, groups] of Object.entries(json(hooksFile).hooks)) {
      for (const g of groups) for (const h of g.hooks) {
        assert.ok(h.command.includes(`"${rootVar}/skills/response-config/scripts/hook.mjs"`), h.command);
        assert.ok(h.command.includes(`--agent ${agent} `), h.command);
        events[event] = h.command.match(/--event (\S+)/)[1];
      }
    }
    assert.deepEqual(events, { SessionStart: 'session-start', UserPromptSubmit: 'prompt', Stop: 'stop' });
  });
}

test('Codex manifest names the skills folder', () => {
  const m = json('.codex-plugin/plugin.json');
  assert.ok(exists(path.join(m.skills, 'response-config/SKILL.md')));
});

test('both marketplaces list the plugin from the repo root', () => {
  const claude = json('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'response-config');
  assert.equal(claude.source, './');
  const codex = json('.agents/plugins/marketplace.json').plugins.find((p) => p.name === 'response-config');
  assert.deepEqual(codex.source, { source: 'local', path: './' });
  assert.equal(codex.policy.installation, 'AVAILABLE');
});
