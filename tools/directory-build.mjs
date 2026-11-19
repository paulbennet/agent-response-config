#!/usr/bin/env node
// Builds the Claude plugin directory edition of response-config into --out (default dist/directory).
//   node tools/directory-build.mjs [--out <dir>]
// The directory accepts only Markdown, text, JSON, YAML and images from organizations that are not
// Verified: no hooks, no scripts, no package.json. So this edition ships the skill rules and the
// output style only. Settings come from the JSON config files, which the agent reads and edits itself.
// The full edition (hooks, config CLI, setup script) stays on main and installs from GitHub.
// CI (.github/workflows/directory.yml) pushes the output to the `directory` branch on each release tag.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--out');
const out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(root, 'dist/directory'));
const REPO = 'https://github.com/paulbennet/agent-response-config';
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

// Replace exactly one match, or stop: a change on main must not slip through unedited.
function swap(text, from, to, what) {
  const n = typeof from === 'string' ? text.split(from).length - 1 : (text.match(new RegExp(from.source, from.flags.replace('g', '') + 'g')) || []).length;
  if (n !== 1) throw new Error(`directory-build: ${what}: expected 1 match, found ${n}. Update tools/directory-build.mjs.`);
  return text.replace(from, to);
}

const CONFIG_LITE = `This edition has no hooks and no scripts. Read the settings yourself, lowest to highest precedence:

1. Built-in defaults: [config.default.json](config.default.json).
2. User config: \`~/.config/response-config/config.json\` (or \`$XDG_CONFIG_HOME/response-config/config.json\`), if it exists.
3. Project config: \`.response-config.json\` in the working directory or a parent up to the git root, if it exists.
4. One-turn tags in the user message.

A later layer overrides only the keys it sets. If you cannot read the files, use the defaults: minimal on (high, 80 prose words), structured on, language off.
`;

const CHANGE_LITE = `## 3. Change settings when the user asks

Edit the JSON file yourself. Keys and valid values are in [config.schema.json](config.schema.json). Write only the keys that differ from the defaults, keep the file valid JSON, and tell the user what changed (old → new).

- Default target: the user file \`~/.config/response-config/config.json\`. Create it, with its folder, if it is missing.
- If the user says "for this project": \`.response-config.json\` at the git root. It is shared with the repo.
- For the English level, set \`language.on\` to true and set \`language.cefr\`, \`language.preset\`, \`language.readability\` or \`language.vocabulary\`.

If the user wants a level only for now, suggest a one-turn tag such as \`!level=B1\` instead of saving it.

If the user asks to configure or review the settings without naming one, follow the guided flow in [references/configure.md](references/configure.md).

Valid values: \`minimal.level\` low|medium|high|extreme; \`language.preset\` simple|global|technical|null; \`language.cefr\` A1..C2; \`language.vocabulary\` basic-english|globish|ste|oxford-3000|oxford-5000|ngsl|awl; \`language.readability\` \`{"standard":"flesch-kincaid","target":8}\` with standard flesch-reading-ease|flesch-kincaid|gunning-fog|smog|coleman-liau|dale-chall.

## 4. Full edition

This is the Claude plugin directory edition. The full edition adds hooks that repeat the rules on every prompt and keep the A/S/Q/D ledger, a config CLI, a managed output style, and Codex and Copilot support. If the user asks for any of these, point them to ${REPO}.
`;

function skill() {
  let s = read('skills/response-config/SKILL.md');
  s = swap(s, /, install or manage the hooks and Claude output style that enforce this\./, '.', 'SKILL.md description');
  s = swap(s, /^compatibility: .*$/m, `compatibility: Claude Code plugin directory edition, with no hooks or scripts. The full edition is at ${REPO}.`, 'SKILL.md compatibility');
  s = swap(s, /(## 1\. Find the active settings\n\n)[\s\S]*?(?=\n## 2\. )/, `$1${CONFIG_LITE}`, 'SKILL.md section 1');
  s = swap(s, /## 3\. Change settings when the user asks\n[\s\S]*$/, CHANGE_LITE, 'SKILL.md sections 3 to 5');
  s = swap(s, /With the hooks or the Claude mod, `!keep` keeps the message's other tags for the rest of the session and `!reset` drops them\. /, '', 'SKILL.md !keep note');
  return s;
}

function configure() {
  let s = read('skills/response-config/references/configure.md');
  s = swap(s, /Run `node <skill-dir>\/scripts\/config\.mjs --show` and summarise it/, 'Read the config layers listed in SKILL.md section 1 and summarise them', 'configure.md show');
  s = swap(s, /Name the layers listed in `sources:` \(defaults, user, project\)/, 'Name the layers that exist (defaults, user, project)', 'configure.md layers');
  s = swap(s, /\| Hooks \| [^\n]*\n/, '', 'configure.md hooks row');
  s = swap(s, /\| Output style \(Claude Code\) \| [^\n]*\n/, '', 'configure.md output style row');
  s = swap(s, /\| Group \| Setting \| Options \| Command \|/, '| Group | Setting | Options | Key and example |', 'configure.md header');
  s = swap(s, /Add `--project` for \(b\)\./, 'For (b) write `.response-config.json` at the git root.', 'configure.md project');
  s = swap(s, /Run every change for the group in one `config\.mjs` call \(several `--set` flags are allowed\)\. Report each changed key as old → new\. If the CLI refuses a value, show its error and ask again\. Changes apply from the next prompt\. A managed output style is regenerated at once but loads in the next session\./,
    'Write every change for the group in one edit of the JSON file. The key column shows the path, for example `--set minimal.level=high` means `{"minimal":{"level":"high"}}`. Check each value against config.schema.json. Report each changed key as old → new. Changes apply from the next reply.', 'configure.md apply');
  s = swap(s, /Do not install hooks, activate the output style or write a project file without the user's yes\./, "Do not write a project file without the user's yes.", 'configure.md consent');
  return s;
}

function outputStyle() {
  return swap(read('output-styles/response-config.md'),
    /^To use your own settings, enable the managed style: .*$/m,
    'To use your own settings, use the response-config skill; the style itself uses the defaults.', 'output style settings line');
}

const readme = (version) => `# response-config (Claude plugin directory edition)

Makes Claude Code replies short, structured and easy to act on. Replies lead with the result and keep a small prose budget. They end with numbered Actions, Suggestions, Questions and Decisions that you answer by ID ("do A2", "D3: b"). An optional English level (CEFR, readability, controlled vocabulary, plain language) keeps the wording simple.

Install: \`/plugin install response-config@claude-plugins-official\`

This edition holds the skill and the output style. It has no hooks and no scripts. Settings are JSON files that Claude reads and edits for you: ask "configure response-config".

The full edition adds hooks that repeat the rules on every prompt and keep the item ledger, a config CLI, and Codex and Copilot support: ${REPO}

Version ${version}. MIT license.
`;

const manifest = JSON.parse(read('.claude-plugin/plugin.json'));
const plugin = {
  name: manifest.name,
  version: manifest.version,
  description: 'Minimal, structured, level-controlled replies with numbered A/S/Q/D items you answer by ID. Skill and output style; the hooks edition is on GitHub.',
  author: manifest.author,
  homepage: manifest.homepage,
  repository: manifest.repository,
  license: manifest.license,
  keywords: manifest.keywords.filter((k) => k !== 'hooks'),
  icon: './assets/icon.png',
  outputStyles: './output-styles/',
};

fs.rmSync(out, { recursive: true, force: true });
const write = (rel, text) => {
  const f = path.join(out, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const copy = (rel) => {
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  fs.copyFileSync(path.join(root, rel), path.join(out, rel));
};

write('.claude-plugin/plugin.json', JSON.stringify(plugin, null, 2) + '\n');
write('skills/response-config/SKILL.md', skill());
write('skills/response-config/references/configure.md', configure());
write('skills/response-config/references/levels-cefr.md', swap(read('skills/response-config/references/levels-cefr.md'),
  'set one with `config.mjs --level <name>`', 'set one with `language.preset` in the config file', 'levels-cefr.md preset'));
for (const f of fs.readdirSync(path.join(root, 'skills/response-config/references'))) {
  if (f === 'configure.md' || f === 'levels-cefr.md') continue;
  copy(`skills/response-config/references/${f}`);
}
copy('skills/response-config/config.default.json');
copy('skills/response-config/config.schema.json');
write('output-styles/response-config.md', outputStyle());
copy('assets/icon.png');
copy('LICENSE');
write('README.md', readme(plugin.version));
console.log(out);
