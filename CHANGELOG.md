# Changelog

## Unreleased

- A closing line with a note, such as `- A1 done: installed eslint` or `- Q1 answered: yes`, now closes the item. Before this it was read as a new item with the same ID, which retired the old one (PARSE-2).
- `- A1 still open: ...` sets the item back to open instead of replacing it.
- Short answers without a colon, such as `Q2 ok`, `D1 b` or `Q1 yes, Q2 no`, are recognised (PARSE-3).
- Section headings with their type letter, such as `## Actions (A)`, which is how the rules print them, now open a section. Before this, items under them were not tracked (PARSE-1).
- Code fences indented under a list item are ignored when reading items.
- The hook script waits up to 8 s before giving up, instead of 2.5 s. A slow Claude Code startup cut off the session-start hook (HOOK-1).

Fixes from [docs/review-0.1.1.md](docs/review-0.1.1.md):

- Item tracking keeps the ID the user sees: a reused ID takes over and the old item is retired, instead of shifting the new IDs.
- A recap of a finished item no longer reopens it; trailing `(done)`, `(completed)` or `✓` close an item.
- Project-scope output style, `settings.local.json` and `--set --project` all use the project root, so subfolders no longer get their own copies.
- The mod reloads the config when a config file changes on disk, and refreshes its stand-down marker hourly.
- Replies `please do A2`, `ok do A2` and `A1 done` are recognised; a bare `Q1` points at the question instead of marking it in progress.
- Outside a section heading, only marked IDs (`- A1: text`) count, so prose like `1. Q3 2026 revenue` is ignored.
- The full rules are re-sent every 20 prompts, for hosts that do not re-run session start after compaction.
- The classic hooks no longer read session switches, which only the mod sets.

Fixes from [docs/review-0.1.0.md](docs/review-0.1.0.md):

- Setup, `--set` and `--style activate` no longer overwrite a settings file that does not parse.
- The mod is listed in the marketplace, loads, validates and has tests.
- Project-scope hooks no longer write machine paths into committed files.
- Rules reach the model even when the session-start hook did not run.
- Stricter item and reply parsing; reused IDs are renumbered; the agent can close items.
- Tags no longer alter the rest of the prompt.
- `npm test` checks that the mod engine copy is in sync.

## 0.1.0

- Skill `response-config`: minimal, structured (A/S/Q/D IDs) and language-level reply rules, with references.
- Hook script for Claude Code, Codex and GitHub Copilot (session start, each prompt, ledger on stop).
- `config.mjs` CLI, `setup.mjs` installer, JSON schema, managed Claude output style with drift detection.
- Claude plugin packaging and the optional `response-config-mod` mod.
