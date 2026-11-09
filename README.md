# response-config

An agent skill that makes replies **short**, **structured** and **easy to answer**, with an optional **English level**. Works in Claude Code, Codex and GitHub Copilot.

[![skills.sh](https://skills.sh/b/paulbennet/agent-response-config)](https://skills.sh/paulbennet/agent-response-config)

## What you get

1. **Minimal**: prose cut hard (four levels, a word budget). Code, commands, errors, paths and diffs stay untouched.
2. **Structured**: a one-line summary, then numbered items you can answer by ID.
3. **Language level**: CEFR (A1 to C2), readability targets, controlled vocabularies, plain language.

```
Moved the parser into `lib/parse.ts`; tests pass.

Actions
- 🔵 A2 Run `npm run lint` before committing.
Questions
- 🔵 Q1 Keep the old `--legacy` flag? (yes/no)
Decisions
- 🔵 D1 Error format: (a) JSON (b) plain text

Resolved: ✅ A1
```

Reply with `Q1: yes, D1: a, done A1, skip S2` (also `please do A2`, `A1 done`). IDs count up per type for the whole session. Each item starts with its status, 🔵 open or ⏳ in progress. A finished item is not listed again; the agent closes it in one line, `Resolved: ✅ A1, 💬 Q1, ⏭️ S1` (done, answered, skipped). `structured.statusEmoji=false` drops the emojis.

Every part has an on/off switch. Hooks and a Claude output style are optional extras.

## Install

Pick one.

| Method | Command |
|---|---|
| skills.sh (Claude, Codex, Copilot, many more) | `npx skills add paulbennet/agent-response-config --skill response-config` (add `-a claude-code`, `-a codex` or `-a github-copilot`, and `-g` for user-wide) |
| GitHub CLI 2.90+ | `gh skill install paulbennet/agent-response-config response-config --agent claude-code --scope user` |
| Claude Code plugin (skill + hooks + output style; hooks are on once the plugin is enabled) | `/plugin install response-config --marketplace paulbennet/agent-response-config` |
| Manual | copy `skills/response-config/` to `.claude/skills/`, `.agents/skills/` (Codex, Copilot) or `~/.copilot/skills/` |

Hooks and the config CLI need Node.js 22 or newer. The skill text alone works without Node.

## Configure

Ask the agent ("make replies terser", "use B1 English"), say "configure response-config" for a guided menu that goes through each setting, or run the CLI:

```
node <skill-dir>/scripts/config.mjs --show
node <skill-dir>/scripts/config.mjs --set minimal.level=medium
node <skill-dir>/scripts/config.mjs --set minimal.maxWords=60 --project
```

### English level

One word sets the level and switches language on: a CEFR level, `plain` (plain language only), a preset, or `off`.

```
node <skill-dir>/scripts/config.mjs --level B1
node <skill-dir>/scripts/config.mjs --level simple
node <skill-dir>/scripts/config.mjs --readability flesch-kincaid=8 --vocab ste
```

| Preset | Sets |
|---|---|
| `simple` | A2, plain language, Oxford 3000 words |
| `global` | B1, Globish words, for readers of any first language |
| `technical` | B2, Simplified Technical English (ASD-STE100) |

A preset wins on the fields it sets; readability and the other fields still apply. Changing one of its fields (`--vocab`, `--set language.cefr=...`, the config pane) writes the preset's fields out and clears it, so the change takes effect.

For this session only: `!level=B1 !keep` in a message (any agent with the hooks). `!reset` drops it. `!keep` works for every tag: `!words=40 !keep`.

Files, later wins per key:

| Layer | Where |
|---|---|
| defaults | `skills/response-config/config.default.json` |
| user | `~/.config/response-config/config.json` (Windows: `%APPDATA%\response-config\config.json`) |
| project | `.response-config.json` in the repo (found by walking up from the working directory; `--project` edits that file, or creates one at the git root) |
| session | `!keep` after any tags in a message (needs the hooks); `!reset` clears |
| one turn | `!verbose`, `!plain`, `!level=B1` (or a preset), `!words=40`, `!off` in your message |

The JSON schema is `skills/response-config/config.schema.json`; point your editor at it with `"$schema"`.

| Key | Values |
|---|---|
| `minimal.level` | low, medium, high, extreme |
| `minimal.maxWords` | 10 to 1000 prose words, or null (default) for the level's budget: low 150, medium 110, high 80, extreme 40 |
| `minimal.preserve` | code, commands, tables, errors, paths, diffs |
| `structured.sections` | actions, suggestions, questions, decisions |
| `structured.statusEmoji` | true (default) or false: status emojis on items and in the Resolved line |
| `language.preset` | simple, global, technical, or null; wins on the fields it sets |
| `language.cefr` | A1 to C2 |
| `language.readability` | `{standard, target}`; flesch-reading-ease, flesch-kincaid, gunning-fog, smog, coleman-liau, dale-chall |
| `language.vocabulary` | basic-english, globish, ste, oxford-3000, oxford-5000, ngsl, awl |
| `language.plainLanguage` | true or false |

Vocabulary lists are instructions to the model; no word list is bundled.

## Hooks (opt-in)

A skill only loads when relevant. Hooks make the rules always-on: they add the rules at session start, a short reminder on every prompt, and keep the A/S/Q/D ledger so IDs survive compaction and resume.

```
node <skill-dir>/scripts/setup.mjs --agent all --scope user --dry-run   # preview
node <skill-dir>/scripts/setup.mjs --agent codex --scope user --instructions
node <skill-dir>/scripts/setup.mjs --agent claude --uninstall
```

Or ask the agent: "set up response-config hooks for Codex".

| Agent | Writes | Notes |
|---|---|---|
| Claude Code | `~/.claude/settings.json` or `.claude/settings.json` | Not needed if the plugin is installed |
| Codex | `~/.codex/hooks.json` or `.codex/hooks.json` | Run `/hooks` and trust the 3 hooks, or they do not run |
| Copilot CLI | `~/.copilot/hooks/response-config.json` or `.github/hooks/response-config.json` | Per-prompt hints use `userPromptTransformed` |
| Copilot in VS Code | `.github/hooks/response-config.json` (`--vscode --scope project`) | VS Code hooks are a preview feature: turn on `chat.useHooks` and keep `.github/hooks` in `chat.hookFilesLocations` |

`--scope project` for Claude writes `.claude/settings.local.json`, which stays on your machine. For Codex and Copilot the project files are meant to be committed, so the skill must be installed in the project (for example with `npx skills add` without `-g`); the hook path is then written relative to the project. Without that the script refuses, unless you pass `--force`.

The script never rewrites a settings file that does not parse: it stops and names the file.

`--instructions` also adds a short block to `CLAUDE.md`, `AGENTS.md` or `copilot-instructions.md`. The user-level Copilot location `~/.copilot/copilot-instructions.md` is not documented by GitHub; prefer `--scope project` there.

The A/S/Q/D ledger is stored per session under the config directory and pruned after 30 days. It holds the item texts the agent wrote. `config.mjs --ledger path` shows where; `config.mjs --ledger clear` deletes it.

Hooks instruct; they cannot rewrite the model's answer. Nothing is blocked or regenerated.

## Claude output style (optional)

```
node <skill-dir>/scripts/config.mjs --set claude.outputStyle.manage=true
node <skill-dir>/scripts/config.mjs --style status     # in-sync | stale | drifted | missing
```

With `manage` on, `response-config-managed.md` is created in `~/.claude/output-styles/` (or `.claude/output-styles/` at the project root with `scope=project`) and regenerated whenever the config changes through the CLI or the session-start hook. A hand-edited file is never overwritten: it is reported as drift until `--style sync --force`. Switch to it with `/output-style response-config-managed` or `--style activate`.

## Coming in V2: Claude mod

`mods/response-config-mod/` holds a Claude Code mod (config pane, open-items pane, status band, setup wizard). It is not released in V1 and not listed in the marketplace; the plan is in [docs/v2-mod.md](docs/v2-mod.md).

## Develop

```
npm test                          # node:test suite (no dependencies)
npm run validate                  # claude plugin validate on the plugin
node tools/build-output-style.mjs # regenerate output-styles/response-config.md
```

V2 mod work: `npm run test:mod` (engine copy check + mod tests, Claude Code 2.1.310+), `npm run validate:mod`, `node tools/sync-mod.mjs` after editing the skill scripts.

The Claude plugin's root is the repository root, so an installed copy also carries `tests/`, `tools/`, `docs/` and `mods/`. They are inert there.

Layout: `skills/response-config/` (the skill, references, scripts), `.claude-plugin/` + `hooks/` + `output-styles/` (Claude plugin), `mods/response-config-mod/` (V2 mod, not released), `tests/`, `evals/`, `docs/`.

## Known limits

- Adherence depends on the model following instructions. There is no validator or retry.
- Copilot only supports per-prompt hints through the `userPromptTransformed` hook, and gives the Stop hook a transcript path rather than the final message, so item tracking there is best effort.
- VS Code Copilot hooks are a preview feature and need the `chat.useHooks` setting.
- What was checked live, per agent, is in [docs/testing-plan.md](docs/testing-plan.md); reply quality is measured by `npm run evals` ([evals/README.md](evals/README.md)).
- A terminal Claude session reads output style files at startup, so a regenerated style applies from the next session.

## Licence

MIT. Oxford 3000/5000 and ASD-STE100 are named only; their word lists are not included.
