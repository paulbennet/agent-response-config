# response-config: implementation plan

## Context

Agents answer with long prose; caveats and questions get buried. `idea.md` asks for a cross-agent skill (Claude Code, Codex, GitHub Copilot) that makes responses minimal, structured with trackable IDs, and written at a chosen English level, plus opt-in hooks that remind the agent every session/prompt, a Claude mod for interactive setup, and distribution via skills.sh.

Decisions taken in Q/A (binding for this plan):

| Topic | Decision |
|---|---|
| Name | `response-config` (skill, plugin, folder, `$response-config` / `/response-config`) |
| Enforcement | Instruct only. No validator, no Stop-hook blocking. Stop hook exists only to *read* the answer for the ledger. |
| Runtime | Node.js >= 22, zero dependencies, ESM scripts |
| ID tracking | Hook-kept per-session ledger + model instructions; model-only fallback where no Stop hook |
| Packaging | One repo, dual-shaped: `skills/response-config/` for skills.sh / gh skill / Codex / Copilot; root `.claude-plugin/` for Claude plugin; `mods/` for the Claude mod |
| Copilot scope | CLI + VS Code (cloud agent documented as untested) |
| Word lists | Instruction-only for every list (nothing bundled, no licence exposure) |
| IDs | Per-type letter+number, session-wide counters: `A1 S1 Q1 D1`. Replies: `A2`/`do A2`, `Q1: yes`, `D3: b`, `skip S1`, `done A1` |
| Config | `~/.config/response-config/config.json` (Windows `%APPDATA%\response-config\config.json`) + `.response-config.json` at repo root; project overrides per key; JSON Schema shipped |
| Mod | Config pane + open-items pane + status band + dialog wizard |
| Per-turn override | Inline `!verbose`, `!plain`, `!level=C1`, `!off` tags stripped by the prompt hook + `/response-config on|off|verbose` |
| Extras | `maxWords` prose budget only (no spelling/tone in v1) |

## Research facts the design relies on

- **Agent Skills spec** (agentskills.io): `SKILL.md` frontmatter `name` (kebab, <=64, must equal folder), `description` (<=1024), optional `license`, `compatibility`, `metadata`, `allowed-tools`; keep body < 500 lines; `scripts/`, `references/`, `assets/` conventions; validate with `skills-ref validate`.
- **Install paths** (vercel-labs/skills `docs/agents.md`): Claude `.claude/skills` / `~/.claude/skills`; Codex `.agents/skills` / `~/.agents/skills`; Copilot `.agents/skills` (project) / `~/.copilot/skills`; universal `.agents/skills` / `~/.config/agents/skills`. `npx skills add <owner/repo> --skill response-config [-a <agent>] [-g]`. skills.sh lists any public repo once installs happen (no submission); README badge `skills.sh/b/<owner>/<repo>`. Also `gh skill install <owner/repo> response-config --agent <id> --scope user|project` (gh >= 2.90) and Codex `$skill-installer`.
- **Claude Code hooks**: `SessionStart` (matchers `startup|resume|clear|compact|fork`, stdout JSON `hookSpecificOutput.additionalContext`), `UserPromptSubmit` (stdin `prompt`; `additionalContext`; cannot rewrite the prompt), `Stop` (stdin `last_assistant_message`, `stop_hook_active`; exit 0 + no decision = no-op). Exec form `"command": "node", "args": [...]` recommended; `${CLAUDE_PLUGIN_ROOT}` resolves in plugin hooks. Plugin hooks live in `hooks/hooks.json` wrapped in `{"hooks": {...}}`. Skill-frontmatter hooks only register when the skill is invoked (not suitable for always-on). Plugins may ship `output-styles/*.md` (`keep-coding-instructions: true`, optional `force-for-plugin`). `userConfig` options appear in `/config`.
- **Codex hooks** (learn.chatgpt.com/docs/hooks): enabled by default; `~/.codex/hooks.json` or `[hooks]` in `config.toml`; project `.codex/` only when trusted; **every non-managed hook must be trusted via `/hooks` before it runs**. Events include `SessionStart` (stdin `source`), `UserPromptSubmit` (stdin `prompt`, `turn_id`; stdout `hookSpecificOutput.additionalContext`), `Stop` (stdin `last_assistant_message`, `stop_hook_active`; **JSON required on exit 0**, so print `{}`). Codex skills: `.agents/skills` up the tree, `~/.agents/skills`; optional `agents/openai.yaml` (`interface.display_name`, `policy.allow_implicit_invocation`).
- **Copilot hooks** (docs.github.com hooks reference): `.github/hooks/*.json` (repo) and `~/.copilot/hooks/*.json` (user, CLI only); `{"version": 1, "hooks": {...}}`; entries `{"type":"command","bash":...,"powershell":...,"command":...,"exec":...,"args":[...],"timeoutSec":30}`. `sessionStart` → stdout `additionalContext` (only inject point at session start). `userPromptSubmitted` config-file hooks **cannot** add context; use `userPromptTransformed` → `modifiedTransformedPrompt` to append the per-prompt hint. `agentStop` gives `transcriptPath` (no `last_assistant_message`). VS Code hooks are preview, read `.github/hooks/*.json`, PascalCase names + snake_case fields (Claude-compatible). Copilot skills: `.github/skills`, `.claude/skills`, `.agents/skills`; personal `~/.copilot/skills`, `~/.agents/skills`.
- **Claude mods** (bundled `plugin-authoring` skill, build 2.1.310): hooks module `hooks/register.tsx` exporting `register(on, options)`; events used here: `session.start`, `prompt.compose` (add a `session`-scope section → hot-applied rules), `prompt.submit` (`next({...e, text, context})` can rewrite the prompt → strip `!tags`, expand quick replies), `turn.complete` (`e.answer` = final visible text → feed ledger), `ui.render` on `Pane` and `AbovePrompt`, `command.run` for `/response-config`, `$.ui.ask` dialogs, `$.fs` for config/ledger, `$.store` for cross-session state, `$.state` with `types/index.d.ts` contract. Validate with `claude plugin validate`, test with `claude plugin test`.

## Gaps found in idea.md and how the plan addresses them

1. **Nothing can rewrite the final answer** on any agent; adherence is instruction-driven. Mitigation: strong, short, repeated hints (session start + every prompt) and a response *template* the model fills; validator deliberately out of scope.
2. **Counters drift after compaction** → ledger is file-based and re-injected on `SessionStart(compact|resume)`.
3. **Quick replies must be resolved by something** → prompt hook parses `Q3: yes`, `done A1`, `skip S2`, marks ledger, and tells the model what was resolved.
4. **Copilot per-prompt hint** only possible through `userPromptTransformed`; **Copilot `agentStop` has no final message** → read `transcriptPath` best-effort; fallback to model-kept numbering.
5. **Codex hooks need manual trust (`/hooks`)** and project hooks need a trusted project → setup script prints the exact next step.
6. **Always-on vs skill triggering**: skills load only when relevant. Always-on behaviour = hooks (opt-in) or a one-line pointer appended to `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` (setup `--instructions` flag). Claude additionally gets an output style.
7. **Artefact boundary** undefined → config `preserve` list: `code`, `commands`, `tables`, `errors`, `paths`, `diffs` (default all on).
8. **Level pillar is unmeasurable without a validator** → ship concrete per-level writing rules in `references/` (sentence length, syllables, allowed constructions, examples) so "B1" means something operational to the model.
9. **Mod and classic hooks would double-inject** → ledger records `modActive: true` for the session; classic hooks become no-ops when set.
10. **Windows**: config path via `APPDATA`; hook commands use exec form (`node` + args) to avoid shell quoting; Copilot entries provide both `bash` and `powershell`.
11. **Safety exceptions**: minimal mode must never truncate error output, failing test output, security warnings, destructive-action confirmations. Encoded in SKILL.md.

## Repository layout

```
agent-response-config/                      (git repo; publish as <owner>/response-config)
├── .claude-plugin/
│   ├── plugin.json                         name=response-config, skills=["./skills/"], hooks=./hooks/hooks.json, outputStyles=./output-styles/, userConfig (mirror of key options)
│   └── marketplace.json                    plugins: response-config (source ./), response-config-mod (source ./mods/response-config-mod)
├── hooks/hooks.json                        Claude plugin hooks (SessionStart, UserPromptSubmit, Stop) → node ${CLAUDE_PLUGIN_ROOT}/skills/response-config/scripts/hook.mjs --agent claude --event <E>
├── output-styles/response-config.md        keep-coding-instructions: true; the style text = compiled rules (not forced by default)
├── skills/response-config/
│   ├── SKILL.md                            the skill (spec-compliant frontmatter; < 300 lines)
│   ├── agents/openai.yaml                  Codex display metadata
│   ├── config.schema.json                  JSON Schema for config
│   ├── config.default.json
│   ├── references/
│   │   ├── format.md                       response template + ID grammar + quick-reply grammar + examples
│   │   ├── minimal.md                      reduction levels (low/medium/high/extreme) with before/after samples
│   │   ├── levels-cefr.md                  A1..C2 operational rules
│   │   ├── levels-readability.md           Flesch/FK/Fog/SMOG/Dale-Chall target bands → sentence/word rules
│   │   ├── vocab.md                        controlled vocabularies & frequency lists (Basic English, Globish, STE, Oxford 3000/5000, NGSL, AWL) as instruction-only profiles
│   │   └── plain-language.md               Federal Plain Language rules distilled
│   ├── scripts/
│   │   ├── hook.mjs                        single entry: --agent claude|codex|copilot --event session-start|prompt|stop|prompt-transformed
│   │   ├── setup.mjs                       install/uninstall hooks + instructions pointer per agent/scope
│   │   ├── config.mjs                      --get/--set/--show/--init; used by agent and by mod
│   │   └── lib/ {config.mjs, ledger.mjs, parse.mjs, hint.mjs, style.mjs, adapters/{claude,codex,copilot}.mjs}
│   └── assets/templates/                   AGENTS.md / CLAUDE.md / copilot-instructions.md snippet, hooks JSON/TOML templates
├── mods/response-config-mod/
│   ├── .claude-plugin/plugin.json          "types": "./types/index.d.ts"
│   ├── hooks/hooks.json                    {"modules": ["./register.tsx"]}
│   ├── hooks/register.tsx (+ panes/*.tsx, wizard.ts)
│   ├── types/index.d.ts
│   └── hooks/*.test.tsx
├── tests/                                  node --test for scripts
├── evals/                                  Claude plugin eval cases (claude plugin eval)
├── README.md, LICENSE (MIT), CHANGELOG.md
└── idea.md, english-levels-research.md (keep as docs/)
```

## Config model (`config.schema.json`)

```jsonc
{
  "enabled": true,
  "minimal":    { "on": true, "level": "high",            // low|medium|high|extreme
                  "maxWords": 80,                          // prose budget, artefacts excluded
                  "preserve": ["code","commands","tables","errors","paths","diffs"] },
  "structured": { "on": true, "sections": ["actions","suggestions","questions","decisions"],
                  "showEmptySections": false, "replyHint": true },
  "language":   { "on": false, "cefr": "B2",               // A1..C2 | null
                  "readability": { "standard": "flesch-kincaid", "target": 8 },  // or null
                  "vocabulary": null,                       // basic-english|globish|ste|oxford-3000|oxford-5000|ngsl|awl
                  "plainLanguage": false },
  "hooks":      { "sessionStart": true, "eachPrompt": true, "ledger": true },
  "overrides":  { "inlineTags": true },
  "claude":     { "outputStyle": { "manage": false, "scope": "user", "activate": false } }  // see Phase 4b
}
```

Precedence: built-in defaults < user config < project `.response-config.json` < session overrides (`/response-config` command, stored in ledger) < inline `!tag` for one turn.

Ledger: `<configDir>/sessions/<agent>-<sessionId>.json` = `{ counters:{A,S,Q,D}, items:[{id,type,text,status,turn}], session:{mode overrides, modActive}, updatedAt }`. Prune files older than 30 days on session start.

## Phases

### Phase 0: scaffold (no behaviour)
- `git init`, MIT LICENSE, `package.json` (`"type":"module"`, `engines.node>=22`, scripts: `test`, `validate`), `.gitignore`.
- Move the two notes into `docs/`.
- Write `config.schema.json`, `config.default.json`.

### Phase 1: the skill text
- `SKILL.md`: frontmatter (`name: response-config`, description keyed on "concise/terse/short responses, structured next actions, English level, CEFR, plain language, readability"), `license: MIT`, `metadata.version`.
- Body sections: when it applies; read config (`node scripts/config.mjs --show` if available, else defaults); the response template (summary → Actions/Suggestions/Questions/Decisions with IDs); ID and quick-reply grammar; minimal-mode rules by level; artefact preservation; safety exceptions (errors, tests, security, destructive confirmations always full); language-level pointers to `references/`; inline tag semantics; how to run `setup.mjs` when the user asks to install hooks (the "agent can configure it" requirement).
- `references/*.md` as listed; each self-contained, < 150 lines, derived from `docs/english-levels-research.md`.
- Validate: `npx skills-ref validate skills/response-config` (or `skills-ref` from agentskills repo).

### Phase 2: hook scripts (Node, zero deps)
- `lib/config.mjs`: resolve config dir (`XDG_CONFIG_HOME` → `APPDATA` → `~/.config`), load+merge user/project/defaults, schema-light validation.
- `lib/ledger.mjs`: load/save per session, `register(items)`, `resolve(ref, note)`, `open()`, `nextIds()`.
- `lib/parse.mjs`: parse assistant text for `^[-*] (A|S|Q|D)(\d+)\b` lines (skip fenced code); parse user text for quick replies and `!tags`.
- `lib/hint.mjs`: render the session-start hint (full rules, ~40 lines max) and per-prompt hint (<= 8 lines: mode, budget, next IDs, open items, resolved refs this turn). Cap at 9,000 chars (Claude limit 10,000).
- `lib/adapters/*.mjs`: map stdin → `{sessionId, prompt, lastAssistantMessage, source}` and build stdout per agent:
  - claude: `{"hookSpecificOutput":{"hookEventName":..., "additionalContext": hint}}`; Stop → no output.
  - codex: same shape for SessionStart/UserPromptSubmit; Stop → `{}`.
  - copilot: sessionStart → `{"additionalContext": hint}`; `userPromptTransformed` → `{"modifiedTransformedPrompt": transformed + "\n\n" + hint}`; `agentStop` → read `transcriptPath` tail for last assistant text (best-effort, try/catch), no output.
- `hook.mjs`: dispatch; always exit 0; never write to stderr except with `--debug`; 2s self-timeout guard; no-op when `config.enabled=false` or ledger says `modActive`.
- Tests: `node --test tests/` with fixture stdin for each agent/event.

### Phase 3: setup script (`scripts/setup.mjs`)
- `--agent claude|codex|copilot|all --scope user|project --instructions --uninstall --dry-run`.
- claude: merge into `~/.claude/settings.json` or `.claude/settings.json` `hooks` (exec form, absolute path to `hook.mjs`); skip if the plugin is installed (detect `CLAUDE_PLUGIN_ROOT` layout / `enabledPlugins`).
- codex: write `~/.codex/hooks.json` or `.codex/hooks.json` entries for SessionStart/UserPromptSubmit/Stop; print "run `/hooks` in Codex and trust the 3 hooks".
- copilot: write `~/.copilot/hooks/response-config.json` or `.github/hooks/response-config.json` with `bash` + `powershell` + `exec/args` forms, `version: 1`.
- `--instructions`: append the 3-line pointer snippet (idempotent marker comments) to `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md`.
- Always idempotent (marker key `"_response-config"` or comment), prints a diff in `--dry-run`.

### Phase 4: Claude plugin packaging
- `.claude-plugin/plugin.json` with `skills: ["./skills/"]`, `hooks: "./hooks/hooks.json"`, `outputStyles: "./output-styles/"`, `userConfig` for `minimal_level`, `cefr`, `structured` (string options) → `hook.mjs` reads `CLAUDE_PLUGIN_OPTION_*` as a lower-precedence layer under the JSON config.
- `hooks/hooks.json` wrapped `{"hooks": {...}}`, exec form `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/skills/response-config/scripts/hook.mjs", "--agent", "claude", "--event", "session-start"]`, matcher `startup|resume|clear|compact|fork` on SessionStart.
- `output-styles/response-config.md`: `keep-coding-instructions: true`, `force-for-plugin: false` (user opts in via `/output-style response-config`).
- `.claude-plugin/marketplace.json`: `response-config` (source `./`) and `response-config-mod` (source `./mods/response-config-mod`).
- `claude plugin validate .` and `claude plugin validate mods/response-config-mod` must pass with `--strict`.

### Phase 4b: managed custom output style (Claude only, optional)
Goal: the skill can create, update and drift-check a custom Claude output style that mirrors the current config, for the user (`~/.claude/output-styles/`) or the project (`.claude/output-styles/`).

- Config keys: `"claude": { "outputStyle": { "manage": false, "scope": "user" | "project", "activate": false } }`. Off by default; the agent, `config.mjs`, the wizard or the pane can turn it on.
- File: `response-config-managed.md` with frontmatter `name: response-config-managed`, `description: Generated from response-config; do not hand-edit`, `keep-coding-instructions: true`. Distinct name from the plugin's shipped generic `response-config` style so both can coexist in the picker.
- Single compiler `lib/style.mjs: compileStyle(config) -> { body, configHash }`. Body = the same compiled rules `hint.mjs` produces for session start (one source of truth), so style and hints never disagree. A trailing HTML comment carries provenance: `<!-- response-config v1 config=<sha256 of the config subset> body=<sha256 of generated body> -->`.
- Sync points (all call `syncStyle(config)`):
  - `scripts/config.mjs --set/--init` (agent- or user-driven edits)
  - SessionStart hook (catches edits made directly to the JSON file): compare current `configHash` with the embedded one
  - mod: after the config pane or wizard saves
  - `scripts/config.mjs --style sync|status|activate|remove`
- Drift rules:
  - config changed, body untouched (embedded `body` hash == hash of file body) → regenerate silently
  - body hand-edited (hash mismatch) → never overwrite; report "output style drifted: hand-edited" in the session-start hint, mod toast and `--style status`; `--style sync --force` regenerates
  - file missing while `manage: true` → recreate
  - `manage: false` → leave file alone; `--style remove` deletes only a file whose provenance comment matches
- Activation: `activate: true` or `--style activate` sets `outputStyle: "response-config-managed"` in the matching settings file (`~/.claude/settings.json` or `.claude/settings.local.json`) only after the user confirms; `/output-style response-config-managed` otherwise. Document that a terminal session reads style files at startup, so a regenerated style applies from the next session (the mod's `prompt.compose` covers the current one).
- Tests: generate → hash stable; edit body → drift detected, not overwritten; change config → regenerated; `remove` refuses a file without provenance.

### Phase 5: the Claude mod (`mods/response-config-mod`)
- `register.tsx`:
  - `session.start`: load config via `$.fs`, write `modActive` into the ledger file, register `/response-config` command, open status band.
  - `prompt.compose`: append section `response-config:rules` (scope `session`) with the compiled hint; re-render when config atom changes.
  - `prompt.submit`: strip `!tags`, resolve quick replies against ledger, attach `context` with resolved refs/next IDs; honour `e.command` (do not rewrite command lines).
  - `turn.complete` (main loop only, `e.agentId === undefined`): parse `e.answer` → ledger; update atoms.
  - `command.run` for `/response-config [on|off|verbose|wizard|pane|items]`.
  - `ui.render` `AbovePrompt`: `terse · structured · B2 │ A2 S1 Q1 D0` with key hints; `Pane` ids `rc-config` (Select/Input/Button form writing the user config JSON) and `rc-items` (open items with "resolve" buttons that `$.prompt.suggest`/submit the quick reply).
  - Wizard: `$.ui.ask` sequence (3–5 questions, playful copy), run on first launch (`$.store` flag) or `/response-config wizard`; works on terminal/desktop/vscode. Last step offers the managed output style (Phase 4b).
  - Config pane and wizard call `syncStyle` after saving; status band shows a `style drift` marker when the hand-edit drift state is set.
- `types/index.d.ts` contract for `$.state` (`config`, `openItems`, `counters`).
- Tests via `claude plugin test` over `['terminal','desktop']`.
- Develop in `~/.claude/dev-mods/<session>/response-config-mod/` with hot reload, then copy into the repo (per plugin-authoring skill).

### Phase 6: distribution & docs
- README: what it does (1 screenshot/sample), install matrix:
  - skills.sh: `npx skills add <owner>/response-config --skill response-config -a claude-code|codex|github-copilot [-g]`
  - gh: `gh skill install <owner>/response-config response-config --agent <id> --scope user`
  - Codex: `$skill-installer <owner>/response-config` (verify syntax at publish time)
  - Claude plugin: `/plugin install response-config --marketplace <owner>/response-config`; mod: `/plugin install response-config-mod --marketplace <owner>/response-config`
  - Hooks: `node <skill>/scripts/setup.mjs --agent all --scope user` or ask the agent: "set up response-config hooks for codex"
- Badge `https://skills.sh/b/<owner>/response-config`; `metadata.version`; CHANGELOG.
- Other platforms to mention: Anthropic plugin directory (`claude plugin` submit), Codex curated catalog PR to `openai/skills`, `github/awesome-copilot` PR, `agentskills.io` listing. Recommend skills.sh + gh skill + Claude marketplace as the three to actually maintain.

### Phase 7: quality
- `tests/` fixtures: each agent × each event; ledger round trip; quick-reply grammar; `!tag` stripping; Windows path resolution (`APPDATA`).
- `evals/` for Claude plugin eval: prompts that should produce <= maxWords prose + ID sections; prompts that must stay long (error output).
- Manual matrix: Claude terminal (plugin + mod), Claude VS Code, Codex CLI (trust hooks), Copilot CLI, Copilot VS Code (hooks preview).

## Critical files (to create)
- `skills/response-config/SKILL.md`, `references/format.md`, `references/levels-cefr.md`
- `skills/response-config/scripts/hook.mjs`, `lib/ledger.mjs`, `lib/parse.mjs`, `lib/hint.mjs`, `lib/adapters/*.mjs`
- `skills/response-config/scripts/setup.mjs`
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, `output-styles/response-config.md`
- `mods/response-config-mod/hooks/register.tsx`, `types/index.d.ts`

## Verification
1. `npm test` (node --test) green on Windows and in a Linux shell (Git Bash acceptable).
2. `npx skills-ref validate skills/response-config` passes.
3. `claude plugin validate . --strict` and `claude plugin validate mods/response-config-mod --strict` pass; `claude plugin test mods/response-config-mod` passes.
4. `claude --plugin-dir . -p "list files"`: debug log shows SessionStart/UserPromptSubmit hooks ran, answer uses the template; `echo '{"session_id":"x","prompt":"Q1: yes"}' | node hook.mjs --agent claude --event prompt` prints additionalContext with Q1 resolved.
5. Codex: `setup.mjs --agent codex`, trust via `/hooks`, start session, confirm hint appears (`codex --debug`) and Stop hook prints `{}`.
6. Copilot CLI: `setup.mjs --agent copilot`, confirm sessionStart context and transformed prompt carry the hint.
7. Mod: enable via hot-reload question; `/response-config wizard` runs; band updates after a turn with `A1` items; config pane writes the JSON and the next prompt reflects it.
8. Fresh clone: `npx skills add ./ --skill response-config -a claude-code` installs into `.claude/skills/response-config` and `SKILL.md` loads in a new session.
9. Output style: `config.mjs --set claude.outputStyle.manage=true` creates `~/.claude/output-styles/response-config-managed.md`; `/output-style` lists it; changing `minimal.level` regenerates it; hand-editing the body then starting a session reports drift and leaves the edit intact.
