# Language level tests

As of 2026-11-08. Results of testing the English level feature on Claude Code, Codex and Copilot. Details and history are in [testing-plan.md](testing-plan.md), section M.

## Summary

The English level feature passes on Claude Code and Codex, and on Copilot except for three cases where its sentences run 1 or 2 words over the limit. All configuration paths pass their automated tests: 77 unit tests and 10 mod tests.

- Agents: Claude Code 2.1.314, Codex CLI 0.165.0, GitHub Copilot CLI 1.0.107, all on Windows 11, run on 2026-11-08.
- Live reply cases: 19 per agent (M13 to M19, M22 to M33). Two of them (M15, M18) need a person to judge.
- Four bugs found and fixed during the run (EVAL-7 to EVAL-10). One issue is still open (EVAL-11, Copilot's sentence length).
- Changes are in commit `daa85de`.

## What was tested

Every way to set an English level was tested, from the config file to a one-turn tag.

| Setting | Values tested | Rule the agent gets |
| --- | --- | --- |
| CEFR level (`language.cefr`) | A1, A2, B1, B2, C1, C2 | Max sentence length: 8, 12, 16 and 20 words for A1 to B2; C1 and C2 have no limit |
| Preset (`language.preset`) | simple, global, technical | simple = A2 + plain language + Oxford 3000; global = B1 + Globish; technical = B2 + Simplified Technical English |
| Readability (`language.readability`) | Flesch-Kincaid 6, Gunning Fog 8, Flesch Reading Ease 70 | A target score |
| Vocabulary (`language.vocabulary`) | ste, basic-english | A word list or controlled language |
| Plain language (`language.plainLanguage`) | true | Main point first, active voice, address the reader as "you" |
| One-turn tags | `!level=A2 !words=20`, `!level=simple` | Applies to that prompt only |
| Session tags | `!level=A2 !keep`, then `!reset` | Kept for later prompts until reset |
| Asking in words | "Use B1 English from now on, and save that setting." | The agent runs `config.mjs --level B1` |

## How it was tested

There were two layers of tests: automated tests of the config and hooks, and live headless runs of each agent with its replies measured.

| Layer | Command | What it checks | Result |
| --- | --- | --- | --- |
| Unit tests | `npm test` | `--level`, `--vocab` and `--readability` CLI; presets win on their fields; `!keep` and `!reset`; the prompt hint spells out the level | 77 of 77 pass |
| Mod tests | `claude plugin test mods/response-config-mod` | `/response-config level`, the level select, presets saved in one pick | 10 of 10 pass |
| Live evals | `npm run evals -- --agent <agent> --cases <ids>` | Real replies from Claude, Codex and Copilot | See Results |

In the live evals, each case runs in a new, throwaway project with its own config folder, so personal settings are never touched. The prompt is the same for every case: "Explain what a .gitignore file does and when to use one." The harness ([../tools/evals.mjs](../tools/evals.mjs)) then measures the reply's prose; code blocks, tables, headings and item IDs are skipped:

- Longest sentence and average sentence length, in words
- Flesch-Kincaid grade, Gunning Fog index and Flesch Reading Ease
- Whether the reply says "you"

A case passes when the measure meets its rule. For example, A1 passes only if no sentence is longer than 8 words. Fluency (C1) and word choice (Basic English) cannot be measured, so a person has to judge them.

## Results

After the fixes, Claude and Codex pass all 17 measured cases. Copilot passes 14; its 3 failures are A1 and A2 sentence limits missed by 1 or 2 words.

| Case | Setting | Pass rule | Claude | Codex | Copilot |
| --- | --- | --- | --- | --- | --- |
| M13 | A1 | Sentences ≤ 8 words | Pass (8) | Pass (8) | Fail (9) |
| M23 | A2 | ≤ 12 words | Pass (9) | Pass (10) | Pass (11) |
| M14 | B1 | ≤ 16 words | Pass (15) | Pass (14) | Pass (12) |
| M24 | B2 | ≤ 20 words | Pass (12) | Pass (15) | Pass (14) |
| M15 | C1 | Fluent, no padding | Review | Review | Review |
| M25 | C2 | Within the 80-word budget | Pass | Pass | Pass |
| M26 | Preset simple | ≤ 12 words, says "you" | Pass (11) | Pass (11) | Fail (13) |
| M27 | Preset global | ≤ 16 words | Pass (13) | Pass (13) | Pass (12) |
| M28 | Preset technical | ≤ 20 words | Pass (12) | Pass (12) | Pass (10) |
| M16 | Flesch-Kincaid 6 | Grade ≤ 7 | Pass (3.4) | Pass (6.8) | Pass (3.2) |
| M32 | Gunning Fog 8 | Fog ≤ 9 | Pass (8.0) | Pass (7.3) | Pass (6.3) |
| M33 | Reading Ease 70 | Score ≥ 65 | Pass (85.3) | Pass (68.6) | Pass (73.3) |
| M17 | Simplified Technical English | ≤ 20 words | Pass (12) | Pass (15) | Pass (12) |
| M18 | Basic English | Simple words | Review | Review | Review |
| M19 | Plain language | Says "you" | Pass | Pass | Pass |
| M22 | `!level=A2 !words=20` | Turn 1 ≤ 20 words, turn 2 not limited | Pass | Pass | Pass |
| M29 | `!level=simple` | ≤ 12 words, says "you" | Pass (11) | Pass (10) | Fail (14) |
| M30 | `!level=A2 !keep`, `!reset` | Turns 1 and 2 ≤ 12 words | Pass | Pass | Pass |
| M31 | Asked for B1 in words | Level saved; next reply ≤ 16 words | Pass | Pass | Pass |

Numbers in brackets are the longest sentence in words, or the measured score. Full transcripts are in `evals/results/lang*-<agent>/`; that folder is not committed.

## Issues found

The first run found one real bug, a weak rule and two bugs in the eval checks. One model-adherence issue is still open.

| ID | Found in | Problem | Fix | Status |
| --- | --- | --- | --- | --- |
| EVAL-7 | M29, M30 | A level set with `!level=` or `!keep` reached the model only as its name ("A2", "simple"), with no sentence limit. Claude and Codex wrote sentences of 17 to 27 words. | Every prompt hint now includes the full LANGUAGE rules. A1 to B1 limits are called a hard cap. | Fixed |
| EVAL-8 | M19, Codex | Under plain language, Codex wrote impersonally, without "you", in two runs. | The rule now says to speak to the reader as "you" ("you can", "your files"). | Fixed |
| EVAL-9 | M13, eval check | The measure counted an item's emoji and ID ("S1") as words, so an 8-word sentence read as 9. | `tools/evals.mjs` skips them. | Fixed |
| EVAL-10 | M31, eval check | Codex saved the level in the project file (`.response-config.json`), but the check read only the user file. | Both files count. | Fixed |
| EVAL-11 | M13, M26, M29, Copilot | Copilot writes sentences 1 or 2 words over the A1 and A2 limits, even with the hard-cap line. | None found; this is the model's adherence. | Open |

## Still to do

- [ ] Read the C1 (M15) and Basic English (M18) replies for all three agents and record pass or fail.
- [ ] Click through the mod's level select, preset fields and wizard language steps in a live session (testing plan H24).
- [ ] Retry Copilot on M13, M26 and M29 after its next release, to see whether EVAL-11 persists.
- [ ] Reinstall the user-scope skill at `~/.agents/skills/response-config`. That copy is from 0.1.1 and has no `--level`.
