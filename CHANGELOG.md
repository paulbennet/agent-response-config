# Changelog

## Unreleased

- Finished or settled items are no longer listed under their sections, not even as a recap. The rules ask for one line after the sections: `Resolved: ✅ A2, 💬 Q1, ⏭️ S1`.
- Status emojis: items start with 🔵 open or ⏳ in progress; the Resolved line marks ✅ done, 💬 answered, ⏭️ skipped. New option `structured.statusEmoji` (default true). The hooks read an emoji before or after the ID with the option on or off; `- ⏳ A1 text` marks A1 in progress.
- Mod: the items pane shows each item's status emoji before its ID, the band counts in-progress items (⏳), and the config pane has a Status emojis switch.

## 0.1.1

- setup.mjs and the README drop the "unverified" notes for the Codex and VS Code hooks, which were checked live; the VS Code note names the `chat.useHooks` and `chat.hookFilesLocations` settings.
- Each brevity level has its own default prose budget: low 150, medium 110, high 80, extreme 40 words. `minimal.maxWords` defaults to null; a number set there still wins (EVAL-1).
- With a budget of 40 words or fewer, the rules and the per-prompt digest call it a hard cap to count before sending, with no extra tips, and say to add no suggestions or questions the user did not ask for (EVAL-2).
- Error messages and failing test output are quoted verbatim in a code block, not only paraphrased (EVAL-3).
- A choice that is the user's to make goes under Decisions with the pick marked "(recommended)", instead of being settled in the summary (EVAL-4).
- "Next IDs" lists only the configured section types (EVAL-6).
- Rules: the prose budget counts the items and asks for tables or code only when needed; with fewer than four sections, the rules say to use only those, and the answer-form line and the digest name only the configured sections; "never add an item only to close it in the same reply".
- `tools/evals.mjs` (`npm run evals`) runs the section M reply-quality cases headless against Claude Code, Codex or Copilot and scores them.

- `- A2 Review the README: done.` closes A2; a status after a colon at the end of an item is a closing (PARSE-8).
- Terminal band: the Items and Config buttons are replaced by the commands that open those panes. A band press keeps the keyboard in the band and no chord moves it into a pane, so the panes are only usable when opened by command.
- Mod UI redesigned per surface (design canvas: response-config mod UI). Items pane: grouped by type with type colors from the theme; the terminal draws a keyboard list with a focus marker and hotkeys (d done, s skip, o do, y/n, a-h option, r answer) on the focused item; desktop and VS Code expand the focused item and reveal the other actions on hover; decision options show their labels. The band shows colored open counts with Items and Config buttons; the config pane is grouped into Replies, Language and Output style.
- `Resolved: A2 (skipped), Q2 (answered), D1` gives each entry its own status. Before this only the first ID was read (PARSE-7).
- Options on their own lines under a decision or question (`  - (a) ...`) belong to that item, so the items pane offers them as buttons.
- Mod items pane: every open item is drawn and the pane scrolls once focused; buttons sit in a row; every question and decision has an Answer button. The band reads `open A:0 S:1 Q:1 D:1`, so the counts are not mistaken for IDs (MOD-2).
- `- Q1 is still open: ...` is read as a reminder and keeps the item's text.
- The mod starts when the response-config plugin is also installed. Its skill takes `/response-config`, which made the mod's session start fail before the wizard. The mod now registers its command last and falls back to `/response-config-mod` (MOD-1).
- `- Q1 skipped (replaced by Q2)` closes Q1; a status followed by a note in brackets is a closing line (PARSE-6).
- When the plugin and `setup.mjs` hooks are both installed, each event is answered once. Before this the rules were added twice and the ledger counted every prompt twice (HOOK-2).
- `Resolved: A4 (replaced by A6)` closes A4; a note after the IDs is allowed. `- D1 assumed (a)`, `- Q2 chose: no` and similar settle the item and keep its question text (PARSE-5).
- Items listed without a section heading, such as `- A1 text`, are tracked when they take the next unused ID (PARSE-4).
- `- Resolved: A1, Q1` with a list marker closes the items. A closing line no longer overwrites an item that is already settled, and closes a question as answered.
- The per-prompt digest names the section headings. The note about an unknown ID no longer prompts the model to talk about the tracker.
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
