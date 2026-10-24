// Copies the skill's scripts into the mod (mods/response-config-mod/engine) so the mod is self-contained.
// Run after any change under skills/response-config/scripts. `--check` exits 1 if the copy is stale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'skills', 'response-config');
const MOD = path.join(ROOT, 'mods', 'response-config-mod');
const check = process.argv.includes('--check');

const copies = [
  [path.join(SRC, 'scripts'), path.join(MOD, 'engine')],
  [path.join(SRC, 'config.default.json'), path.join(MOD, 'config.default.json')],
  [path.join(SRC, 'config.schema.json'), path.join(MOD, 'config.schema.json')],
];

function files(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return [''];
  return fs.readdirSync(p, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(p, path.join(d.parentPath, d.name)));
}

let stale = 0;
for (const [from, to] of copies) {
  for (const rel of files(from)) {
    const a = path.join(from, rel);
    const b = path.join(to, rel);
    const same = fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
    if (same) continue;
    stale += 1;
    if (!check) {
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.copyFileSync(a, b);
    }
  }
}
if (check) {
  console.log(stale ? `${stale} stale file(s); run node tools/sync-mod.mjs` : 'mod engine is in sync');
  process.exit(stale ? 1 : 0);
}
console.log(`synced ${stale} file(s) into mods/response-config-mod`);
