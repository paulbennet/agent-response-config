// Regenerates output-styles/response-config.md (the generic shipped style) from the default config.
import fs from 'node:fs';
import { loadDefaults } from '../skills/response-config/scripts/lib/config.mjs';
import { renderRules } from '../skills/response-config/scripts/lib/hint.mjs';

const body = [
  '---',
  'name: response-config',
  'description: Minimal, structured replies with numbered A/S/Q/D items (default response-config settings)',
  'keep-coding-instructions: true',
  '---',
  '',
  'These rules come from the response-config skill (default settings). Follow them in every reply.',
  'To use your own settings, enable the managed style: node <skill-dir>/scripts/config.mjs --set claude.outputStyle.manage=true',
  '',
  renderRules(loadDefaults()),
  '',
].join('\n');
fs.mkdirSync(new URL('../output-styles/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../output-styles/response-config.md', import.meta.url), body);
console.log('wrote output-styles/response-config.md');
