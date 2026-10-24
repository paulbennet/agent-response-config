---
name: response-config
description: Makes agent replies short, structured and easy to act on. Use when the user wants terse or minimal responses, numbered next actions, suggestions, questions and decisions they can answer by ID (A1, S2, Q3, D4), replies at a chosen English level (CEFR, readability score, controlled vocabulary, plain language), or wants to configure, install or manage the hooks and Claude output style that enforce this.
license: MIT
compatibility: Works in Claude Code, Codex CLI and GitHub Copilot (CLI, VS Code). Hooks and the config CLI need Node.js 22 or newer.
metadata:
  version: "0.1.0"
---

# response-config

Controls how you write replies. Three independent parts, each switchable in the config:

1. **Minimal**: very little prose; code, commands and other artefacts stay intact.
2. **Structured**: a short summary, then numbered Actions, Suggestions, Questions, Decisions the user can answer by ID.
3. **Language level**: CEFR level, readability target, controlled vocabulary, plain language.

## 1. Find the active settings

Hooks, when installed, already put the rules in your context under `[response-config]`. Follow those first.

Otherwise read the config (needs Node.js):

```
node <skill-dir>/scripts/config.mjs --show
```

`<skill-dir>` is the folder holding this file. If the command is unavailable, use these defaults: minimal on (high, 80 prose words), structured on, language off.

Precedence, lowest to highest: built-in defaults, user config, project `.response-config.json`, session overrides, one-turn tags.

## 2. Reply rules

**Minimal.** Lead with the result. No preamble, narration, recap, hedging or restating the question. Respect the prose word budget (`minimal.maxWords`), counted outside artefacts. Levels and examples: [references/minimal.md](references/minimal.md).

Keep verbatim, never shorten: everything listed in `minimal.preserve` (default: code blocks, commands, tables, errors, paths, diffs).

Always full length, whatever the settings: error messages, failing test output, security warnings, confirmations before destructive actions, and anything the user asked you to explain in detail.

**Structured.** Shape of every reply:

```
<minimal summary of what happened>

Actions
- A1 <something to do next>
Suggestions
- S1 <optional improvement>
Questions
- Q1 <needs an answer> (yes/no)
Decisions
- D1 <choice> (a) option (b) option
```

- Each type has its own counter that never resets and never repeats in the session. Continue from the highest ID used so far, including IDs from earlier turns and, if present, the "Next IDs" line from the hook.
- Omit empty sections unless `structured.showEmptySections` is true.
- Put anything the user must notice (risk, caveat, blocked step, follow-up) in an item, not in the summary.
- Questions state the expected answer form. Decisions list lettered options.
- Always write items as list lines (`- A1 ...`). Bare `A1 ...` lines only count under an Actions/Suggestions/Questions/Decisions heading.
- When you finish or settle an item, close it: `- A2 done` (or `answered`, `skipped`), or one line `Resolved: A2, Q1`.
- The user may reply by ID: `A2` or `do A2`, `done A1`, `skip S1`, `Q1: yes`, `D3: b`. Treat each as an instruction or answer about that item. `Q1: why?` is a question about Q1, not an answer. If an ID is unknown, ask which item they mean.
- If the hook says an ID you reused was renumbered (for example "A1 is now A5"), use the new ID from then on.
- Details and edge cases: [references/format.md](references/format.md).

**Language level.** Only when `language.on` is true. Apply every set field:

| Field | Reference |
|---|---|
| `cefr` (A1 to C2) | [references/levels-cefr.md](references/levels-cefr.md) |
| `readability` (standard + target) | [references/levels-readability.md](references/levels-readability.md) |
| `vocabulary` (word list or controlled language) | [references/vocab.md](references/vocab.md) |
| `plainLanguage` | [references/plain-language.md](references/plain-language.md) |

Code, identifiers, commands and quoted output are exempt from level limits. When fields conflict, the stricter one wins.

**One-turn tags** in the user message apply to that turn only: `!verbose` (full detail), `!plain` (plain language), `!level=B1`, `!words=40`, `!off` (ignore all rules), `!on`, `!terse`. Tags that look like shell commands (`!ls`) are not tags.

## 3. Change settings when the user asks

Edit settings with the CLI, never by hand-writing JSON:

```
node <skill-dir>/scripts/config.mjs --set minimal.level=medium
node <skill-dir>/scripts/config.mjs --set language.on=true --set language.cefr=B1
node <skill-dir>/scripts/config.mjs --set minimal.maxWords=60 --project
```

`--project` writes `.response-config.json` in the current directory (shared with the repo); the default writes the user file. Keys are in [config.schema.json](config.schema.json). Tell the user what changed.

Valid values: `minimal.level` low|medium|high|extreme; `language.cefr` A1..C2; `language.vocabulary` basic-english|globish|ste|oxford-3000|oxford-5000|ngsl|awl; `language.readability` `{"standard":"flesch-kincaid","target":8}` with standard flesch-reading-ease|flesch-kincaid|gunning-fog|smog|coleman-liau|dale-chall.

## 4. Install hooks (opt-in)

Hooks remind the agent of the rules at session start and on every prompt, and keep the A/S/Q/D ledger. Only install them when the user asks, and say which files will change. Preview first:

```
node <skill-dir>/scripts/setup.mjs --agent claude|codex|copilot|all --scope user|project --dry-run
node <skill-dir>/scripts/setup.mjs --agent codex --scope user
```

Add `--instructions` to also append a short block to CLAUDE.md / AGENTS.md / copilot-instructions.md. Add `--uninstall` to remove. The script never rewrites a settings file it cannot parse; it stops and names the file. Notes to pass on:

- **Scope project**: Claude hooks go to `.claude/settings.local.json` (personal, not committed). Codex and Copilot project hooks are committed files, so the skill must be installed inside the project (for example `.agents/skills/response-config/`); the script writes a relative path, or refuses.
- **Codex** does not run hooks until the user reviews and trusts them with `/hooks`.
- **Copilot** hooks use the CLI event names; `--vscode --scope project` writes the VS Code compatible names instead (preview).
- **Claude Code**: if the response-config plugin is installed, it already ships the hooks.

The item ledger lives under the config directory. `node <skill-dir>/scripts/config.mjs --ledger path` prints it; `--ledger clear` deletes all stored ledgers.

## 5. Claude Code managed output style (optional)

Claude Code can load a generated output style that mirrors the config. Ask the user before enabling it.

```
node <skill-dir>/scripts/config.mjs --set claude.outputStyle.manage=true --set claude.outputStyle.scope=user
node <skill-dir>/scripts/config.mjs --style status      # in-sync | stale | drifted | missing
node <skill-dir>/scripts/config.mjs --style sync        # regenerate
node <skill-dir>/scripts/config.mjs --style activate    # sets outputStyle in settings (confirm with the user first)
node <skill-dir>/scripts/config.mjs --style remove
```

With `manage` on, every config change through the CLI, the session-start hook, or the Claude mod regenerates the file. A hand-edited style file is never overwritten; it is reported as drift until `--style sync --force`. A terminal session reads style files at startup, so a regenerated style applies from the next session.
