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
- A1 Run `npm run lint` before committing.
Questions
- Q1 Keep the old `--legacy` flag? (yes/no)
Decisions
- D1 Error format: (a) JSON (b) plain text
```

Reply with `Q1: yes, D1: a, done A1, skip S2` (also `please do A2`, `A1 done`). IDs count up per type for the whole session. The agent closes items it finished with `- A1 done` or `Resolved: A1, Q1`.

Every part has an on/off switch. Hooks, a Claude output style and a Claude mod are optional extras.

## Install

Pick one.

| Method | Command |
|---|---|
| skills.sh (Claude, Codex, Copilot, many more) | `npx skills add paulbennet/agent-response-config --skill response-config` (add `-a claude-code`, `-a codex` or `-a github-copilot`, and `-g` for user-wide) |
| GitHub CLI 2.90+ | `gh skill install paulbennet/agent-response-config response-config --agent claude-code --scope user` |
| Claude Code plugin (skill + hooks + output style; hooks are on once the plugin is enabled) | `/plugin install response-config --marketplace paulbennet/agent-response-config` |
| Claude mod (interactive panes, optional) | `/plugin install response-config-mod --marketplace paulbennet/agent-response-config` |
| Manual | copy `skills/response-config/` to `.claude/skills/`, `.agents/skills/` (Codex, Copilot) or `~/.copilot/skills/` |

Hooks, the config CLI and the mod need Node.js 22 or newer. The skill text alone works without Node.

## Configure

Ask the agent ("make replies terser", "use B1 English") or run the CLI:

```
node <skill-dir>/scripts/config.mjs --show
node <skill-dir>/scripts/config.mjs --set minimal.level=medium --set language.on=true --set language.cefr=B1
node <skill-dir>/scripts/config.mjs --set minimal.maxWords=60 --project
```

Files, later wins per key:

| Layer | Where |
|---|---|
| defaults | `skills/response-config/config.default.json` |
| user | `~/.config/response-config/config.json` (Windows: `%APPDATA%\response-config\config.json`) |
| project | `.response-config.json` in the repo (found by walking up from the working directory; `--project` edits that file, or creates one at the git root) |
| session | `/response-config on\|off\|verbose\|terse` (Claude mod only) |
| one turn | `!verbose`, `!plain`, `!level=B1`, `!words=40`, `!off` in your message |

The JSON schema is `skills/response-config/config.schema.json`; point your editor at it with `"$schema"`.

| Key | Values |
|---|---|
| `minimal.level` | low, medium, high, extreme |
| `minimal.maxWords` | 10 to 1000 prose words |
| `minimal.preserve` | code, commands, tables, errors, paths, diffs |
| `structured.sections` | actions, suggestions, questions, decisions |
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
| Codex | `~/.codex/hooks.json` or `.codex/hooks.json` | Run `/hooks` and trust the 3 hooks, or they do not run. The `hooks.json` wrapper shape is unverified against a live Codex |
| Copilot CLI | `~/.copilot/hooks/response-config.json` or `.github/hooks/response-config.json` | Per-prompt hints use `userPromptTransformed` |
| Copilot in VS Code | `.github/hooks/response-config.json` (`--vscode --scope project`) | VS Code compatible event names; VS Code hooks are a preview feature and this path is unverified live |

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

With `manage` on, `response-config-managed.md` is created in `~/.claude/output-styles/` (or `.claude/output-styles/` at the project root with `scope=project`) and regenerated whenever the config changes through the CLI, the session-start hook or the mod. A hand-edited file is never overwritten: it is reported as drift until `--style sync --force`. Switch to it with `/output-style response-config-managed` or `--style activate`.

## Claude mod (optional)

The `response-config-mod` plugin adds, inside Claude Code:

- `/response-config` with a first-run wizard, a config pane, an open-items pane with one-click replies, and a status band showing the mode and open item counts;
- rules injected into the system prompt and reloaded when a config file changes, tags and quick replies handled when you send;
- classic hooks stand down automatically while the mod runs.

The mod uses an early-access Claude Code API. It bundles a copy of the scripts under `mods/response-config-mod/engine/`; refresh it with `node tools/sync-mod.mjs`.

## Develop

```
npm test                          # mod engine copy check + node:test suite (no dependencies)
npm run test:mod                  # mod tests on the Claude Code engine (needs a recent claude, 2.1.310 tested)
npm run validate                  # claude plugin validate on the plugin and the mod
node tools/sync-mod.mjs           # copy skill scripts into the mod after editing them
node tools/build-output-style.mjs # regenerate output-styles/response-config.md
```

The `claude` commands need a Claude Code build that knows `plugin test` and mods; older builds (2.1.70 was checked) reject them.

The Claude plugin's root is the repository root, so an installed copy also carries `tests/`, `tools/`, `docs/` and `mods/`. They are inert there.

Layout: `skills/response-config/` (the skill, references, scripts), `.claude-plugin/` + `hooks/` + `output-styles/` (Claude plugin), `mods/response-config-mod/` (mod), `tests/`, `evals/`, `docs/`.

## Known limits

- Adherence depends on the model following instructions. There is no validator or retry.
- Copilot only supports per-prompt hints through the `userPromptTransformed` hook, and gives the Stop hook a transcript path rather than the final message, so item tracking there is best effort.
- VS Code Copilot hooks are a preview feature; the `--vscode` event names are unverified against a live install.
- The Codex `hooks.json` shape is unverified against a live install.
- Hooks and plugin were not yet run in a live Claude, Codex or Copilot session; see [docs/STATUS.md](docs/STATUS.md).
- A terminal Claude session reads output style files at startup, so a regenerated style applies from the next session.

## Licence

MIT. Oxford 3000/5000 and ASD-STE100 are named only; their word lists are not included.
