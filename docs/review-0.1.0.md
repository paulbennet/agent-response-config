# Review of the 0.1.0 implementation

Reviewed commit `b7f8de9`. Each finding has a severity, the file and line, what goes wrong, and the fix to make. Findings marked **verified** were reproduced by running the code; the rest come from reading it.

Severity: **high** = data loss, broken install path or a core feature that does not work; **medium** = wrong behaviour in realistic use; **low** = quality, clarity, or unverified assumptions.

## High

### H1. Setup and style scripts can wipe a user's settings file (verified)
- `skills/response-config/scripts/setup.mjs:67`, `skills/response-config/scripts/lib/style.mjs:135`, `skills/response-config/scripts/config.mjs:71`
- `readJson()` returns `undefined` on any parse error, and every caller does `readJson(file) ?? {}`. A `settings.json` with a trailing comma or a comment is then replaced by a file holding only our keys. Reproduced: a malformed `~/.claude/settings.json` with `theme` and `permissions` came back containing only `hooks`.
- Fix: distinguish "missing" from "unparseable". When the file exists but does not parse, abort with a message naming the file and change nothing. Apply the same rule to `mergeClassic`, `activateStyle`, and `config.mjs --set`.

### H2. The mod is not installable from the marketplace
- `.claude-plugin/marketplace.json` lists only `response-config`. `README.md:37` tells users to run `/plugin install response-config-mod --marketplace paulbennet/agent-response-config`, which will answer "not found in marketplace".
- Fix: add `{ "name": "response-config-mod", "source": "./mods/response-config-mod", "description": "..." }` to the marketplace, then run `claude plugin validate .` again.

### H3. Project-scope hooks and instruction snippets embed an absolute machine path
- `setup.mjs:95` (`.claude/settings.json`), `setup.mjs:158` (`.github/copilot-instructions.md`, `CLAUDE.md`, `AGENTS.md`), and the Copilot `.github/hooks/response-config.json`.
- `--scope project` writes `node "/path/to/.../hook.mjs"` into files that are normally committed. Every teammate gets a hook that fails and an instructions block pointing at a path that does not exist on their machine.
- Fix: for Claude project scope write `.claude/settings.local.json` (gitignored by convention) instead of `settings.json`; for Codex and Copilot project scope either refuse unless `--force`, or write a command that resolves the skill relative to the project (for example after `npx skills add` without `-g`, the skill is at `.claude/skills/response-config/` or `.agents/skills/response-config/`, so the hook can be `node .agents/skills/response-config/scripts/hook.mjs`). The instructions snippet must not contain a path at all; say "run the response-config config script" instead.

### H4. The per-prompt hint never carries the rules, so a session without the start hook never learns them (verified)
- `skills/response-config/scripts/lib/hint.mjs` `renderPromptHint`, `hook.mjs:65`
- When the SessionStart hook did not fire (forked session, `hooks.sessionStart=false`, hook timeout, Copilot where only `sessionStart` injects, or any host that drops the session hook), every prompt gets only `mode: terse:high structured, max 80 prose words` and ID lines. The model is told a mode name with no definition. Reproduced: Stop then Prompt with no SessionStart yields a hint with no rules.
- Fix: include the full `renderRules()` text in the prompt hint when the ledger shows no session hint was delivered yet (track `ledger.session.rulesSentAt`, set by the session-start path, cleared on compaction/resume by source), and a one-line digest otherwise. Also add `fork` to both SessionStart matchers (`hooks/hooks.json:6`, `setup.mjs:76`), as the plan specified.

## Medium

### M1. Item parser registers ordinary prose as items (verified)
- `skills/response-config/scripts/lib/parse.mjs:8` `ITEM_RE`
- Any line that begins with a letter from A/S/Q/D and a number is an item: "Q3 2026 revenue grew.", "A4 paper is standard.", "S3 bucket is public." all registered, and table cells (`| D1 | ...`) are not excluded. Counters jump and "Open:" fills with junk.
- Fix: require a list marker (`-`, `*`, `+`, or `1.`) before the ID, or only accept IDs inside a recognised section (a preceding `Actions`/`Suggestions`/`Questions`/`Decisions` heading or bold label). Skip lines that start with `|`. Add tests for the three false positives above.

### M2. Reply parser swallows whole sentences and mis-fires on prose (verified)
- `parse.mjs` `parseUserReplies`
- "Q1: what does it mean? Also I will do A2 later" produces `answer Q1 = "what does it mean? Also I will do A2 later"` and `do A2`. "to do A1 you need..." marks A1 in progress.
- Fix: cap an answer value at the end of the sentence (stop at `.`, `?`, `!` as well as `,`, `;`, newline) and at a length (say 80 chars); treat a value that ends in `?` as a question about the item, not an answer; require `do`/`done`/`skip` to start the message or a clause (preceded by start, `,`, `;`, or newline). Document the grammar as "reply lines", not free prose.

### M3. The mod rewrites every prompt and destroys indentation in pasted code (verified)
- `parse.mjs` `parseTags` (the `replace(/[ \t]{2,}/g, ' ')` collapse) and `mods/response-config-mod/hooks/register.tsx:81` (`text: parsed.text || e.text`)
- `parseTags` collapses every run of spaces and trims, and the mod passes that text down whether or not a tag was present. A prompt containing an indented code snippet reaches the model with its indentation flattened.
- Fix: in `parseTags`, only remove the matched tag and the single space beside it; never touch the rest. In the mod, pass `text: parsed.text` only when `hasTags(parsed.tags)`.

### M4. ID collision after compaction silently drops new items (verified)
- `skills/response-config/scripts/lib/core.mjs:32` `registerItems`
- If the model restarts numbering (common after compaction or when it ignores "Next IDs") and emits `A1` while `A1` is already `done`, the new item is discarded and never tracked. If `A1` is still open its text is overwritten.
- Fix: when an incoming ID matches a non-open item, or an open item with clearly different text, assign the next free number instead, record `aliasOf`, and surface "renumbered A1 -> A5" in the next prompt hint so the user and model see the real ID.

### M5. Nothing can close an item except the user
- `core.mjs:43` `STATUS`, `hook.mjs` stop path
- "do A2" marks A2 in progress; the agent then performs it, but the item stays open until the user types `done A2`. Also `do S1` jumps straight to `done` while `do A1` becomes `in-progress` (inconsistent).
- Fix: let the assistant close items by writing `- A2 done` / `- Q1 answered` (or a `Resolved: A2 Q1` line) and parse that in the Stop path; treat `do` the same for A and S. Mention the closing form in `SKILL.md` and `references/format.md`.

### M6. Importing `hook.mjs` crashes when `process.argv[1]` is undefined (verified)
- `skills/response-config/scripts/hook.mjs:91`
- `process.argv[1].replace(...)` throws before the `||` fallback when the module is imported from `node -e`, a REPL, or an embedding host. The mod does not import it today, but the engine copy ships it.
- Fix: `const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`. Drop the `endsWith('hook.mjs')` fallback, which would also fire for any test file named `*hook.mjs`.

### M7. `--vscode` writes to a location VS Code does not read, and shares a file with Claude Code
- `setup.mjs:134`
- With `--vscode --scope user` the PascalCase hooks go to `~/.copilot/hooks/`, which the VS Code hooks page does not list; VS Code reads `.github/hooks/*.json`, `.claude/settings.json` and `~/.claude/settings.json`. Writing to the Claude settings file would double-inject with the Claude plugin.
- Fix: make `--vscode` valid only with `--scope project` (`.github/hooks/`) and say so in the usage line and README.

### M8. Mod and classic hooks may both inject if session ids differ
- `mods/response-config-mod/hooks/register.tsx` (`$.session.id()`), `skills/response-config/scripts/lib/ledger.mjs` (`isModActive`)
- The stand-down marker is keyed by `$.session.id()`, documented as "the transcript file's name". The classic hook keys by `session_id` from stdin. If one carries `.jsonl` or differs in any way, the marker never matches and every prompt gets the rules twice. Unverified because the mod never loaded.
- Fix: verify in a live session; strip a trailing `.jsonl` in `markModActive`/`isModActive` as a guard; alternatively have the mod write the marker under both forms.

### M9. Wizard auto-opens on every session until completed
- `register.tsx:44-47`
- `wizardDone` is only stored when the wizard finishes. Dismissing it (Escape) means a four-question dialog pops 1.5 s into every new session, in every project, until the user completes it.
- Fix: add a "Later" and "Never ask" option on the first question; store the flag on "Never" and on dismissal after the second time. Do not auto-run under `claude -p` or when `e.surface` is null (already partly guarded by `isInteractive`).

### M10. `turn.complete` registers items from aborted turns
- `register.tsx:88`
- `e.answer` is also set for `reason: 'aborted'`, so a half-written list of items is registered.
- Fix: `if (e.reason === 'answer' && e.agentId === undefined)`.

## Low

### L1. `pluginOptionsLayer` is dead code and the README/plan describe a feature that is not shipped
- `skills/response-config/scripts/lib/config.mjs:102`, `docs/implementation-plan.md` Phase 4
- `userConfig` was removed from `plugin.json` because the installed CLI (2.1.70) rejected it, yet `CLAUDE_PLUGIN_OPTION_*` is still read. The docs page for the manifest lists `userConfig` as valid, so the rejection is a version issue.
- Fix: either restore `userConfig` and validate with a current CLI (`claude --version` shows 2.1.70 while this session runs 2.1.310: check which binary is on PATH), or delete the layer and the mention. Add a "Deviations from plan" section to `docs/implementation-plan.md` or a `docs/STATUS.md` listing: no `userConfig`, shell-form hooks, manual evals, no mod tests, nothing run live.

### L2. Managed output style reports drift after a CRLF save (verified)
- `skills/response-config/scripts/lib/style.mjs` `styleStatus`
- Opening the generated file in a Windows editor that normalises line endings flips the state to `drifted` with no real edit.
- Fix: normalise `\r\n` to `\n` before hashing in both `compileStyle` and `styleStatus`.

### L3. Codex `hooks.json` shape, Copilot user-level instructions path and `$skill-installer` syntax are unverified
- `setup.mjs` `mergeClassic` (Codex), `setup.mjs:158-159`, `README.md` install table
- Codex docs confirm the event/matcher/handler nesting in TOML; whether `hooks.json` wants the `{"hooks": {...}}` wrapper is assumed. `~/.copilot/copilot-instructions.md` is not a documented location. The `$skill-installer <owner>/<repo>` form is a guess.
- Fix: test against a real Codex and Copilot CLI; until then, label these three as unverified in the README and in the setup script's printed notes (the Codex note already hints at it).

### L4. `sync-mod --check` is not part of `npm test`; no CI
- `package.json`
- The engine copy under `mods/response-config-mod/engine/` will drift the first time someone edits the scripts and forgets the tool.
- Fix: `"test": "node tools/sync-mod.mjs --check && node --test ..."`, plus a GitHub Actions workflow running `npm test` on ubuntu and windows, and `claude plugin validate .` where the CLI is available.

### L5. Mod has no tests and was never loaded
- `mods/response-config-mod/`
- The plan called for `claude plugin test` over terminal and desktop. Nothing exercises `prompt.submit`, `turn.complete`, the panes or the command.
- Fix: add `hooks/register.test.tsx` covering: tag stripping leaves other text intact; a quick reply resolves an item; `turn.complete` with `reason: 'answer'` registers items and `aborted` does not; the items pane renders one row per open item on both surfaces. Load the mod once with `--plugin-dir` and fix what the engine reports.

### L6. `findProjectConfig` walks above non-git folders to the filesystem root
- `config.mjs` `findProjectConfig`
- Outside a git repo the walk continues to `/` or `C:\`, so a `.response-config.json` left in the home directory applies to every unrelated folder beneath it.
- Fix: stop at the home directory as well as at `.git`.

### L7. Session hint lists item text from earlier sessions' transcripts on disk
- `ledger.mjs`
- Ledger files store assistant item text under the config dir for 30 days. That text can contain project details. Not a bug, but undocumented.
- Fix: one line in the README's "Known limits" and a `--ledger clear` / `--ledger path` option on `config.mjs`.

### L8. Small inconsistencies
- `.gitignore` ignores `.response-config.local.json`, which nothing reads: remove the line or implement a local layer.
- `plugin.json` description says "opt-out hooks" while `idea.md` and the README say hooks are opt-in. With the plugin they are on by default; say that plainly in both places.
- `renderPromptHint` prints "User do A2: ..." and "User done A1: ...". Use "User started A2" / "User finished A1" / "User skipped S1".
- `hook.mjs` still advances `ledger.turn` and applies replies when `config.enabled` is false; harmless but wasteful. Return early after the ledger-free path.
- `skills: ["./skills/"]` in `plugin.json` repeats the default scan; harmless, remove for clarity.
- The installed plugin copy includes `tests/`, `tools/`, `docs/`, `mods/` because the plugin root is the repo root. Acceptable for 0.1; consider a `.claudepluginignore` equivalent if one exists, or document it.
- `README.md` "Copilot CLI" row claims `userPromptTransformed` support but the `--vscode` note is only in the setup output; copy it to the README table.

## What is fine

- Config layering, validation, atomic writes and the schema match the plan.
- Ledger round trip, `!tag` precedence, Codex `{}` on Stop, Copilot `modifiedTransformedPrompt`, and the drift-detection state machine all behave as specified and are covered by tests.
- `SKILL.md` is under the 500-line limit, frontmatter is spec-valid, references are focused.
- `setup.mjs` is idempotent and removes only its own entries (tested).

## Suggested fix order

1. H1, H3 (data safety) and H2 (install path), with tests for a malformed settings file and for the marketplace listing.
2. H4, M1, M2, M3, M4, M5 (the tracking feature is only useful once these hold), with the new parser tests.
3. M6 through M10 and L2 (small, contained).
4. L1, L3, L4, L5 (documentation, verification, CI).

## Resolution

All findings were addressed. Regression tests reference the finding ID in their names.

| ID | Status | What changed |
|---|---|---|
| H1 | fixed | `readJsonStrict` / `readJsonForEdit` in `lib/config.mjs`; setup, `--set` and `--style activate` refuse to write a file that does not parse and name it. A broken config layer is reported as a problem. |
| H2 | fixed | `response-config-mod` added to `.claude-plugin/marketplace.json`. |
| H3 | fixed | Claude project scope writes `.claude/settings.local.json`. Codex/Copilot project scope writes a project-relative hook path, or refuses without `--force`. The instructions block holds no path. |
| H4 | fixed | The prompt hint carries the full rules until a session hint was delivered (`ledger.session.rulesSentAt`), then a one-line digest. `fork` added to both SessionStart matchers. |
| M1 | fixed | Items need a list marker, or a section heading for bare lines; table rows skipped. |
| M2 | fixed | Verbs only at message/clause start; answers stop at sentence end, max 80 chars; `Q1: ...?` is a question (`ref`), not an answer. |
| M3 | fixed | `parseTags` removes only the tag and one following space; the mod rewrites the prompt only when a tag was present. |
| M4 | fixed | Reused or conflicting IDs get the next free number; the next prompt hint announces the change. |
| M5 | fixed | `- A2 done` and `Resolved: A2, Q1` close items; `do` sets in-progress for A and S alike. Documented in SKILL.md and format.md. |
| M6 | fixed | `isMain` compares resolved paths and tolerates a missing `argv[1]`. A crash in `run` still prints `{}` for Codex Stop. |
| M7 | fixed | `--vscode` requires `--scope project`. |
| M8 | mitigated | Session ids drop a trailing `.jsonl` everywhere. Still to confirm in a live session. |
| M9 | fixed | First-run prompt offers Set up now / Later / Never ask; two dismissals count as never; not shown without a surface. |
| M10 | fixed | Items are registered only when `e.reason === 'answer'`. |
| L1 | fixed | `pluginOptionsLayer` removed; deviations listed in `docs/STATUS.md`. |
| L2 | fixed | Line endings normalised before hashing. |
| L3 | documented | Unverified paths and shapes labelled in README, setup output and STATUS.md. |
| L4 | fixed | `npm test` runs the sync check. No CI workflow, by choice. |
| L5 | fixed | `hooks/register.test.tsx`, 4 tests passing on Claude Code 2.1.310. Live load still pending. |
| L6 | fixed | Project config search stops at the home directory. |
| L7 | fixed | README note; `config.mjs --ledger path|clear`. |
| L8 | fixed | Stale `.gitignore` line removed; plugin description says hooks are on when enabled; hint wording ("started/finished/skipped"); disabled config returns before touching the ledger; redundant `skills` key removed; README notes on plugin copy and Copilot rows. |

Found while fixing (not in the review):

- **The mod could never load.** `Dollar` is a type but was imported as a value, so the engine rejected the module (`Export named 'Dollar' not found`). Fixed with `import type`.
- **The mod failed `claude plugin validate`.** The engine reads state statically and refuses an atom imported from another file. Each file now declares the atoms it reads.
