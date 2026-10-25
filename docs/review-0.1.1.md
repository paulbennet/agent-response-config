# Review of the review fixes

Reviewed commit `07536cb` (fixes for [review-0.1.0.md](review-0.1.0.md)). Findings marked **verified** were reproduced by running the code; the rest come from reading it.

Severity: **high** = the feature gives wrong results in normal use; **medium** = wrong behaviour in realistic cases; **low** = edge cases, polish.

Most 0.1.0 findings are fixed and hold up: settings files are protected, project-scope paths are portable, rules reach the model without the session hook, tags no longer touch the prompt, and the mod loads, validates and passes its tests. The problems below are mostly in the new renumbering logic (the M4 fix), which made ID tracking worse in a common case.

## High

### N1. Renumbering makes the ledger disagree with what the user sees (verified)
- `skills/response-config/scripts/lib/core.mjs` `registerItems`
- When the model reuses a closed ID, the new item is stored under the next free number. That number can be one the model is about to use in the same reply, so its own fresh IDs shift too. The user reads the reply, not the ledger, so their replies now hit the wrong item.
- Reproduced: A1 done, A2 open. The model replies `- A1 Deploy staging` and `- A3 Tag release`. The ledger stores them as A3 and A4. The user types `done A3`, meaning "Tag release"; the ledger closes "Deploy staging".
- Fix: the ID the user sees must win. When an incoming ID matches an existing item with different text, retire the old item (status `superseded`, moved out of ID lookup, for example renamed `A1~1`) and store the new item under the ID as displayed. Never assign an ID the model did not print. Keep the counter at the highest ID seen. Tell the model in the next hint: "A1 was reused for a new item; the earlier A1 (Run tests) is no longer tracked." Drop the `renumbered` queue, or keep it only for this notice.
- Add tests: the scenario above, and a reply where two items collide.

### N2. Recapping a finished item reopens it as a new item (verified)
- `core.mjs` `registerItems`
- Models often recap: `- A1 Run tests (completed)`. A1 is already done, so the recap is treated as a collision and becomes a new open item A2, plus a renumber notice.
- Fix: when the existing item is closed and `sameItem(existing.text, p.text)` holds, leave it closed and skip the line. Also treat trailing status words in the text, such as "(completed)", "(done)", "✓", as a closing marker, not as text.

## Medium

### N3. Project-scope output style is written once per working directory (verified)
- `skills/response-config/scripts/lib/style.mjs` `styleDir`, called from `hook.mjs` with the session's `cwd`
- With `scope: project`, a session started in `repo/src` creates `repo/src/.claude/output-styles/response-config-managed.md` beside the one in `repo/`. Each subdirectory gets its own managed copy, and Claude Code picks the nearest one.
- Fix: anchor project scope to the project root: the folder holding `.response-config.json` if one is found, else the git root, else `cwd`. Apply the same root in `activateStyle` (`settings.local.json`).

### N4. `config.mjs --set --project` can create a second, shadowing project file
- `skills/response-config/scripts/config.mjs` `targetFile`
- `--project` always writes `.response-config.json` in the current directory. If one already exists higher up (found by `findProjectConfig`), a new file in a subdirectory now shadows it, and the change is invisible from the root.
- Fix: write to the file `findProjectConfig` returns when there is one; create a new file only at the project root (git root, else `cwd`).

### N5. The mod keeps stale settings when the agent changes the config mid-session
- `mods/response-config-mod/hooks/register.tsx`: `refresh($)` runs only at session start and inside `/response-config` subcommands
- The skill tells the agent to change settings with `config.mjs --set` in a shell. The mod never sees that, so its system-prompt rules and status band keep the old settings until the next session. The managed output style is updated by the CLI, so the two disagree.
- Fix: have `config.mjs --show --json` also return the paths it read (user file, project file); in `prompt.submit`, `$.fs.stat` those paths and call `refresh($)` when an `mtimeMs` changed. Cheap, and no process spawn per prompt.

### N6. Common reply phrasings are not recognised (verified)
- `skills/response-config/scripts/lib/parse.mjs` `parseUserReplies`
- `please do A2`, `A1 done`, `ok do A2` produce nothing; the item stays open. These are natural follow-ups to a list of IDs.
- Fix: allow a short courtesy prefix before a verb (`please`, `ok`, `yes`, `go ahead and`), and accept the postfix form `A1 done` / `S2 skip` at clause start. Keep prose like "to do A1 you need" unmatched; extend the tests with both lists.

## Low

### N7. A bare question or decision ID is marked in progress (verified)
- `parse.mjs` bare-ID branch and `core.mjs` `STATUS.do`
- A message that is only `Q1` sets the question to `in-progress`, which is meaningless for a question and shows "(in progress)" in the hint and the items pane.
- Fix: for Q and D, a bare ID is a `ref` (the user is pointing at it), not `do`.

### N8. Numbered lists that start with an ID-like token still register (verified)
- `parse.mjs` `LISTED_RE`
- `1. Q3 2026 revenue grew 10%` registers Q3. Bullets with these tokens are rarer than prose, but finance and cloud text hits them ("S3 bucket", "A4 paper").
- Fix: accept a listed item only when the reply also contains a section heading, or when the ID is followed by `:` / `)` / bold. Or require the type letter to match the section it sits in.

### N9. The mod's stand-down marker expires after 24 hours
- `skills/response-config/scripts/lib/ledger.mjs` `isModActive`; the mod writes the marker only at session start
- A session open longer than 24 hours gets the rules twice (mod system prompt plus classic hooks).
- Fix: drop the expiry and rely on `pruneOld`, or have the mod refresh the marker when it is older than an hour (store the last write time in `$.store`).

### N10. After compaction, Copilot keeps only the one-line digest
- `hook.mjs` `rulesSentAt`
- Claude and Codex re-fire SessionStart on compaction, so the full rules come back. Copilot is not documented to re-fire `sessionStart` on compaction, and `rulesSentAt` is never cleared, so the model is left with the digest. Unverified.
- Fix: also send the full rules every N prompts (for example every 20 turns), or when `ledger.turn - lastRulesTurn` passes a threshold. Store the turn, not only a timestamp.

### N11. Session overrides exist only in the mod
- `hook.mjs` reads `ledger.session.overrides`, but only the mod's `/response-config on|off|verbose` writes them. Without the mod there is no way to set them, so the classic path carries dead logic.
- Fix: add `config.mjs --session <id> --set ...`, or remove the classic-side reading and say in the README that session switches need the mod. The README table already labels the row "(mod)".

### N12. `0.1.0` review file overstates M4
- `docs/review-0.1.0.md` resolution table marks M4 "fixed". After N1 and N2 it should read "reworked, see review-0.1.1".

## Tests to add

- N1: the shift scenario, and the user reply hitting the displayed item.
- N2: recap of a done item stays a single closed item with no renumber notice.
- N3/N4: project scope from a subdirectory writes to the project root only.
- N6/N7: the extra reply phrasings, and bare `Q1` as a reference.
- N5: mod test where the config file mtime changes between two prompts and the hint follows.

## Suggested fix order

1. N1, N2 (tracking correctness), with tests.
2. N3, N4, N5 (one source of truth for config and style).
3. N6 to N12.

## Resolution

| ID | Status | Change |
|---|---|---|
| N1 | fixed | The displayed ID wins. The earlier item is retired as `superseded` under `A1~1`, and the next hint says which item was dropped. The `renumbered` queue is replaced by `reused`. |
| N2 | fixed | A re-listed item that matches a closed one stays closed. Trailing `(done)`, `(completed)`, `[done]`, `- done` and `✓` close an item. |
| N3 | fixed | `projectRoot` (folder of the project file, else git root, else cwd) anchors the project-scope style and `settings.local.json`. |
| N4 | fixed | `--set --project` and `--init --project` write the project file in effect, or a new one at the project root. |
| N5 | fixed | `--show --json` returns `watch` (config paths and mtimes). The mod checks them on each prompt and reloads only when one changed. |
| N6 | fixed | Courtesy words before a verb (`please`, `ok`, `yes`, `go ahead and`, ...), and postfix `A1 done` / `S2 skip` that end their clause. |
| N7 | fixed | A bare `Q1` or `D1` is a `ref` with no value; the hint says the user pointed at it. |
| N8 | fixed | Outside a section heading only marked IDs count (`- A1: x`, `- **A1** x`). Closing lines count anywhere. Rules and format.md say items go under their heading. |
| N9 | fixed | The mod rewrites the marker at session start and at most hourly on prompts; the 24-hour expiry stays so a session resumed without the mod gets its hooks back. |
| N10 | fixed | The prompt hook re-sends the full rules every 20 prompts (`RULES_EVERY`), tracked by turn. Applies to every agent. |
| N11 | fixed | The classic hooks no longer read session overrides. SKILL.md and README say session switches are mod-only. |
| N12 | fixed | The M4 row in review-0.1.0.md now reads "reworked". |
