---
title: response-config
description: Short, structured replies from Claude Code, Codex and Copilot, with next steps you answer by ID and the English level you choose.
---

# response-config

<p class="lede">Short, structured replies from your coding agent. Every next step gets an ID you can answer in one line. Pick the English level you want.</p>

```text
Fixed parseConfig crashing on an empty file; 14 of 14 tests pass.

## Actions
- 🔵 A1 Commit the fix: git commit -am "Handle empty config"
- 🔵 A2 Add a test for a config that has only comments.

## Questions
- 🔵 Q1 Should an empty file warn? (yes/no)

## Decisions
- 🔵 D1 Where should the default live?
  (a) in parseConfig (recommended)
  (b) in each caller
```

Answer with `done A1, Q1: yes, D1: a`. The IDs stay the same for the whole session, even after compaction or resume.

## What you get

- **Minimal**: a word budget for prose. Code, commands, errors, paths and diffs are never cut.
- **Structured**: a one-line summary, then Actions, Suggestions, Questions and Decisions with IDs.
- **English level**: CEFR A1 to C2, plain language, readability targets and controlled vocabularies.
- **Three agents**: one skill for Claude Code, Codex and GitHub Copilot, with optional hooks that keep the item list.

## Install

| You use | Install |
|---|---|
| Any agent (skills.sh) | `npx skills add paulbennet/agent-response-config --skill response-config` |
| GitHub CLI 2.90+ | `gh skill install paulbennet/agent-response-config response-config --agent claude-code --scope user` |
| Claude Code plugin | `/plugin install response-config --marketplace paulbennet/agent-response-config` |
| Codex plugin | `codex plugin marketplace add paulbennet/agent-response-config`, then `codex plugin add response-config@response-config` |

Then say "configure response-config" to your agent. The [README](https://github.com/paulbennet/agent-response-config#readme) has every setting.

## From the blog

{{posts}}
