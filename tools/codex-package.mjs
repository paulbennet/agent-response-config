// Builds dist/response-config-codex-<version>.zip for the OpenAI plugin portal.
// The portal rejects lifecycle hooks, so the zip is skills-only: the hooks
// field is dropped from the manifest and hooks/ is not copied.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'));
delete manifest.hooks;
delete manifest.$schema;
const desc = 'Minimal, structured, level-controlled agent replies with numbered A/S/Q/D items you answer by ID. The skill can also install optional hooks that keep the item ledger.';
manifest.description = desc;
manifest.interface.longDescription = desc;
manifest.keywords = manifest.keywords.filter((k) => k !== 'hooks');

const dist = join(root, 'dist');
const stage = join(dist, 'response-config');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, '.codex-plugin'), { recursive: true });
writeFileSync(join(stage, '.codex-plugin/plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const p of ['skills', 'assets', 'README.md', 'LICENSE']) cpSync(join(root, p), join(stage, p), { recursive: true });

const zip = join(dist, `response-config-codex-${manifest.version}.zip`);
rmSync(zip, { force: true });
// bsdtar (Windows 10+, macOS) writes zip with -a; fall back to zip(1) elsewhere.
try {
  execFileSync('tar', ['-a', '-cf', zip, 'response-config'], { cwd: dist, stdio: 'pipe' });
  execFileSync('tar', ['-tf', zip], { stdio: 'pipe' });
} catch {
  execFileSync('zip', ['-rq', zip, 'response-config'], { cwd: dist, stdio: 'inherit' });
}
rmSync(stage, { recursive: true, force: true });
console.log(zip);
