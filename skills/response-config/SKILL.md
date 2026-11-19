---
name: response-config
description: Makes agent replies short, structured and easy to act on. Use when the user wants terse or minimal responses, numbered next actions, suggestions, questions and decisions they can answer by ID (A1, S2, Q3, D4), replies at a chosen English level (CEFR, readability score, controlled vocabulary, plain language), or wants to configure or review these settings.
license: MIT
compatibility: Claude Code plugin directory edition, with no hooks or scripts. The full edition is at https://github.com/paulbennet/agent-response-config.
metadata:
  version: "1.2.0"
---

# response-config

Controls how you write replies. Three independent parts, each switchable in the config:

1. **Minimal**: very little prose; code, commands and other artefacts stay intact.
2. **Structured**: a short summary, then numbered Actions, Suggestions, Questions, Decisions the user can answer by ID.
3. **Language level**: CEFR level, readability target, controlled vocabulary, plain language.

## 1. Find the active settings

This edition has no hooks and no scripts. Read the settings yourself, lowest to highest precedence:

1. Built-in defaults: [config.default.json](config.default.json).
2. User config: `~/.config/response-config/config.json` (or `$XDG_CONFIG_HOME/response-config/config.json`), if it exists.
3. Project config: `.response-config.json` in the working directory or a parent up to the git root, if it exists.
4. One-turn tags in the user message.

A later layer overrides only the keys it sets. If you cannot read the files, use the defaults: minimal on (high, 80 prose words), structured on, language off.

## 2. Reply rules

**Minimal.** Lead with the result. No preamble, narration, recap, hedging or restating the question. Respect the prose word budget (`minimal.maxWords`), counted outside artefacts. Levels and examples: [references/minimal.md](references/minimal.md).

Keep verbatim, never shorten: everything listed in `minimal.preserve` (default: code blocks, commands, tables, errors, paths, diffs).

Always full length, whatever the settings: error messages, failing test output, security warnings, confirmations before destructive actions, and anything the user asked you to explain in detail.

**Structured.** Shape of every reply:

```
<minimal summary of what happened>

Actions
- 🔵 A1 <something to do next>
Suggestions
- 🔵 S1 <optional improvement>
Questions
- 🔵 Q1 <needs an answer> (yes/no)
Decisions
- 🔵 D1 <choice> (a) option (b) option

Resolved: ✅ <done IDs>, 💬 <answered>, ⏭️ <skipped>
```

- Each type has its own counter that never resets and never repeats in the session. Continue from the highest ID used so far, including IDs from earlier turns and, if present, the "Next IDs" line from the hook.
- Omit empty sections unless `structured.showEmptySections` is true.
- Put anything the user must notice (risk, caveat, blocked step, follow-up) in an item, not in the summary.
- Questions state the expected answer form. Decisions list lettered options.
- Always write items as list lines (`- A1 ...`) under their section heading (Actions, Suggestions, Questions, Decisions). Outside a heading only a marked ID (`- A1: ...`) counts.
- Start each item with its status emoji: 🔵 open, ⏳ in progress. With `structured.statusEmoji` false, write items without emojis.
- Never list a finished or settled item under its section again, not even as a recap. Close it in one line after the sections: `Resolved: ✅ A2, 💬 Q1, ⏭️ S1` (✅ done, 💬 answered, ⏭️ skipped), or without emojis `Resolved: A2, Q1 (answered), S1 (skipped)`.
- The user may reply by ID: `A2` or `do A2`, `done A1` or `A1 done`, `skip S1`, `Q1: yes`, `D3: b`. Treat each as an instruction or answer about that item. `Q1: why?` is a question about Q1, and a bare `Q1` points at it; neither is an answer. If an ID is unknown, ask which item they mean.
- If the hook says you reused an ID, the new item now owns it and the old one is dropped. Take new IDs from "Next IDs" from then on.
- Details and edge cases: [references/format.md](references/format.md).

**Language level.** Only when `language.on` is true. Apply every set field:

| Field | Reference |
|---|---|
| `cefr` (A1 to C2) | [references/levels-cefr.md](references/levels-cefr.md) |
| `readability` (standard + target) | [references/levels-readability.md](references/levels-readability.md) |
| `vocabulary` (word list or controlled language) | [references/vocab.md](references/vocab.md) |
| `plainLanguage` | [references/plain-language.md](references/plain-language.md) |

Code, identifiers, commands and quoted output are exempt from level limits. When fields conflict, the stricter one wins.

**Language presets.** `language.preset` names a bundle that wins on the fields it sets: `simple` (A2, plain language, Oxford 3000), `global` (B1, Globish), `technical` (B2, Simplified Technical English). Other set fields, such as `readability`, still apply.

**One-turn tags** in the user message apply to that turn only: `!verbose` (full detail), `!plain` (plain language), `!level=B1` (or `!level=simple|global|technical|plain|off`), `!words=40`, `!off` (ignore all rules), `!on`, `!terse`. Tags that look like shell commands (`!ls`) are not tags.

## 3. Change settings when the user asks

Edit the JSON file yourself. Keys and valid values are in [config.schema.json](config.schema.json). Write only the keys that differ from the defaults, keep the file valid JSON, and tell the user what changed (old → new).

- Default target: the user file `~/.config/response-config/config.json`. Create it, with its folder, if it is missing.
- If the user says "for this project": `.response-config.json` at the git root. It is shared with the repo.
- For the English level, set `language.on` to true and set `language.cefr`, `language.preset`, `language.readability` or `language.vocabulary`.

If the user wants a level only for now, suggest a one-turn tag such as `!level=B1` instead of saving it.

If the user asks to configure or review the settings without naming one, follow the guided flow in [references/configure.md](references/configure.md).

Valid values: `minimal.level` low|medium|high|extreme; `language.preset` simple|global|technical|null; `language.cefr` A1..C2; `language.vocabulary` basic-english|globish|ste|oxford-3000|oxford-5000|ngsl|awl; `language.readability` `{"standard":"flesch-kincaid","target":8}` with standard flesch-reading-ease|flesch-kincaid|gunning-fog|smog|coleman-liau|dale-chall.

## 4. Full edition

This is the Claude plugin directory edition. The full edition adds hooks that repeat the rules on every prompt and keep the A/S/Q/D ledger, a config CLI, a managed output style, and Codex and Copilot support. If the user asks for any of these, point them to https://github.com/paulbennet/agent-response-config.
