# Testing plan

This plan covers every feature of the `response-config` skill and every way to install it. Each case says who can run it:

- **Auto**: a script runs it, here or on any machine with Node 22. Already run, results below.
- **Manual**: needs a live agent session, a UI, a tool that is not installed here, or a judgement of reply quality. You run these.

## Summary

| Area | Auto | Manual |
|---|---|---|
| A. Skill package and format | 3 | 3 |
| B. Config files and CLI | 9 | 1 |
| C. Item parsing and ledger | 12 | 0 |
| D. Hook script, per agent | 10 | 0 |
| E. Setup script | 11 | 0 |
| F. Managed output style | 9 | 3 |
| G. Claude Code plugin and hooks, live | 3 | 11 |
| H. Claude mod | 7 | 13 |
| I. Codex, live | 0 | 8 |
| J. Copilot CLI, live | 0 | 6 |
| K. Copilot in VS Code, live | 0 | 4 |
| L. Distribution | 4 | 5 |
| M. Reply quality evals | 0 | 22 |
| N. Platforms | 2 | 3 |
| **Total** | **70** | **79** |

All 70 auto cases pass except one known issue, listed below. Everything that touches the scripts, files and installers is checked automatically. What is left for you is what only a live agent can show: does the host fire the hooks, does the model follow the rules, and do the mod's UI pieces work.

### Why the manual cases cannot run here

| Blocker | Cases it blocks | What would unblock it |
|---|---|---|
| Claude Code refuses to start inside another Claude Code session, and this session is one | G, H live | You run them in a normal terminal |
| The Codex CLI is not installed (only the VS Code extension is) | I | `npm i -g @openai/codex` |
| The Copilot CLI is not installed | J | `npm i -g @github/copilot` |
| `gh` is 2.69; `gh skill` needs 2.90 or newer | L-gh | Upgrade the GitHub CLI |
| Panes, dialogs, buttons and pickers need a person at the screen | H, F, K | You click through them |
| Whether a reply is short, well-formed or at a CEFR level is a judgement on live output | M | You collect replies; I can score readability and word counts if you paste them |
| Only Windows is available here | N | A macOS or Linux machine |

### Known issue

| ID | Found by | Issue |
|---|---|---|
| STY-2 | `tools/e2e.mjs` | A note added after the last line of the managed style file makes it "unmanaged" instead of "drifted". The note is kept, so nothing is lost. The warning says the file "exists without provenance", which is misleading. Fix: find the provenance comment anywhere in the file and treat text after it as a hand edit. |
| HOOK-1 | G5, live | `hook.mjs` exits after 2.5 s. On a busy Claude Code startup, SessionStart took 3.4 s (about 0.4 s normally), so it exited without printing. The first prompt sent the full rules instead, so the model still got them. Fixed: the timer is now 8 s, under the 10 s host timeouts. Retest G5. |
| PARSE-1 | G7, live | The rules print headings as `Actions (A)` and the model copies them as `## Actions (A)`, but the parser accepted only `Actions`, so the ledger stayed empty. Indented code fences were also not stripped. Fixed in `parse.mjs`, with tests. Retest G7. |
| PARSE-2 | G8, live | `- A1 done: installed eslint` and `- Q1 answered: yes` were read as new items with the same ID, so the real items were retired as superseded and stayed open. `- A1 still open: ...` did the same. Fixed: a leading status with a note closes the item, and "still open" reopens it. Retest G8. |
| PARSE-3 | G8, live | The reply `Q2 ok`, without a colon, was ignored. Fixed: `Q2 ok`, `D1 b` and `Q1 yes, Q2 no` are answers when they make up a whole clause. Retest G8. |

## How to run the auto cases

```
npm test              # unit tests: config, parser, ledger, hooks, setup, style (52) + mod engine copy check
npm run test:e2e      # end-to-end in throwaway folders: setup, real hook commands, installs, CLI (28)
npm run test:mod      # mod tests on the Claude Code test engine (6), needs Claude Code 2.1.310+
npm run validate      # claude plugin validate on the plugin and the mod
```

The type check of the mod runs against the 2.1.310 API declarations with `tsc`. `test:mod` and `validate` need a Claude Code build that has `plugin test` and mods. The `claude` on PATH here is 2.1.70, so use the 2.1.310 binary from the VS Code extension.

`test:e2e` never writes to your real home. It points every agent home and the config folder at a temporary folder. It needs `bash`, `powershell` and `npx` on PATH, and network access for `npx skills`. It turns off installer telemetry.

Last run: 2026-10-25, Windows 11, Node 22.23.4, Claude Code 2.1.310.

| Suite | Result |
|---|---|
| `npm test` | 52 pass |
| `npm run test:e2e` | 27 pass, 1 known issue |
| `npm run test:mod` | 6 pass |
| `npm run validate` | plugin and mod pass |
| `tsc` on the mod | pass |

## A. Skill package and format

| ID | Check | Who | Result |
|---|---|---|---|
| A1 | Frontmatter: `name` matches the folder and the kebab-case rule, `description` under 1024 characters, body under 500 lines, links to `references/` resolve | Auto, e2e SPEC-1 | Pass |
| A2 | Codex metadata `agents/openai.yaml` has the expected keys and names the skill | Auto, e2e SPEC-2 | Pass |
| A3 | Shipped files present after install: SKILL.md, scripts, references, defaults | Auto, e2e INST-* | Pass |
| A4 | Claude Code loads the skill when you ask for terse replies or a CEFR level, without naming it | Manual | |
| A5 | Codex lists the skill and runs it with `$response-config` | Manual | |
| A6 | Copilot lists the skill from `.agents/skills` and `~/.copilot/skills` | Manual | |

**A4 to A6 steps.** Install the skill only, no hooks. Start a session and type "keep your answers really short and give me numbered next steps". Pass when the agent loads the skill and the reply has a short summary plus `Actions` items.

## B. Config files and CLI

| ID | Check | Who | Result |
|---|---|---|---|
| B1 | Defaults, then user file, then project file, merged per key | Auto, `npm test` | Pass |
| B2 | A broken or invalid layer is skipped and reported as a problem | Auto, `npm test` | Pass |
| B3 | Project file search stops at the git root and at the home folder | Auto, `npm test` | Pass |
| B4 | `--set` refuses invalid values and unknown keys and writes nothing | Auto, e2e CFG-1 | Pass |
| B5 | `--set` refuses to rewrite a file that does not parse | Auto, `npm test` | Pass |
| B6 | `--set --project` from a subfolder edits the file in effect, or creates one at the git root | Auto, `npm test` | Pass |
| B7 | `--show --json` lists the watched files with their times | Auto, `npm test` | Pass |
| B8 | `--ledger path` and `--ledger clear` | Auto, e2e CFG-3 | Pass |
| B9 | Config folder order: `RC_CONFIG_DIR`, `XDG_CONFIG_HOME`, then `%APPDATA%\response-config` on Windows | Auto, e2e CFG-4 | Pass |
| B10 | Ask the agent "use B1 English from now on"; it runs `config.mjs --set` and says what changed | Manual, with G, I or J | |

## C. Item parsing and ledger

All auto, in `npm test` unless noted. All pass.

| ID | Check |
|---|---|
| C1 | Items under a section heading, as list lines or bare lines; fenced code and table rows ignored |
| C2 | Outside a heading only marked IDs count, so `1. Q3 2026 revenue` is ignored |
| C3 | Closing lines: `- A2 done`, `Resolved: A2, Q1`, trailing `(done)`, `[done]`, `- done`, `✓` |
| C4 | Replies: `do`, `done`, `skip`, `Q1: yes`, `D2 = b`, comma lists |
| C5 | Courtesy forms `please do A2`, `ok, do A2 and A3`, postfix `A1 done`, `S2 skip` |
| C6 | Prose stays prose: `to do A1 you need`, `I will do A2 later`, `A1 done by tomorrow` |
| C7 | `Q1: why?` is a question about Q1; a bare `Q1` points at it; answers stop at sentence end and 80 characters |
| C8 | A reused ID keeps the ID the user sees; the old item is retired and the next hint says so |
| C9 | Two collisions in one reply |
| C10 | A recap of a closed item stays closed |
| C11 | Next IDs count up per type and never reuse |
| C12 | The whole flow through the real hook process: session start, items, replies, reuse, recap (e2e FLOW-1) |

## D. Hook script, per agent

These run the hook with the payloads each host documents and check the answer has the shape that host expects. They do not prove the host sends that payload; the live sections G, I, J and K do.

| ID | Check | Who | Result |
|---|---|---|---|
| D1 | Claude: session start and prompt answer in `hookSpecificOutput.additionalContext`; Stop prints nothing | Auto | Pass |
| D2 | Codex: same, and Stop prints `{}`, even when the script fails | Auto | Pass |
| D3 | Copilot CLI: `additionalContext` at session start, `modifiedTransformedPrompt` per prompt | Auto | Pass |
| D4 | Copilot `agentStop` reads the transcript file and registers items | Auto, e2e LED-copilot | Pass |
| D5 | VS Code compatible payloads get Claude-style answers | Auto | Pass |
| D6 | Full rules on the first prompt when session start did not run; a one-line digest after | Auto | Pass |
| D7 | Full rules again every 20 prompts | Auto | Pass |
| D8 | One-turn tags `!verbose`, `!plain`, `!level=B1`, `!words=40`, `!off`, `!on`, `!terse` | Auto | Pass |
| D9 | `enabled: false` silences everything; hooks stand down while the mod marks the session | Auto | Pass |
| D10 | Garbage stdin or a crash still exits 0 | Auto | Pass |

## E. Setup script

All auto, in `npm test` and `npm run test:e2e`. All pass.

| ID | Check |
|---|---|
| E1 | `--agent all --scope user` writes the Claude, Codex and Copilot files |
| E2 | Existing settings and other tools' hooks are kept |
| E3 | Running it twice changes nothing |
| E4 | Every written command runs through bash, and Copilot's also through PowerShell, and answers correctly |
| E5 | The same with the skill in a folder whose path has spaces |
| E6 | `--instructions` adds one marked block to CLAUDE.md, AGENTS.md and copilot-instructions.md, once |
| E7 | `--uninstall` removes only our entries |
| E8 | A settings file that does not parse is left untouched and setup exits 1 |
| E9 | Project scope from an installed copy writes a relative path, and that command runs from the project |
| E10 | Project scope refuses without an in-project skill unless `--force` |
| E11 | `--vscode` needs `--scope project` and writes VS Code event names |

## F. Managed output style

| ID | Check | Who | Result |
|---|---|---|---|
| F1 | Generation is stable; unrelated keys do not change it | Auto | Pass |
| F2 | Created, unchanged, stale, then regenerated on a config change | Auto | Pass |
| F3 | A hand edit is kept and reported; `--style sync --force` regenerates | Auto, e2e STY-1 | Pass |
| F4 | A note added after the last line is kept but reported as "unmanaged" | Auto, e2e STY-2 | Known issue |
| F5 | CRLF line endings are not an edit | Auto | Pass |
| F6 | Session start regenerates after a direct edit of the JSON file | Auto, e2e CFG-2 | Pass |
| F7 | Project scope writes at the project root from any subfolder | Auto | Pass |
| F8 | `--style activate` sets `outputStyle` and refuses a broken settings file | Auto | Pass |
| F9 | `--style remove` deletes only a file it made | Auto | Pass |
| F10 | `/output-style` in Claude Code lists `response-config-managed` after a restart | Manual | |
| F11 | Picking it changes replies in the next session | Manual | |
| F12 | The plugin's shipped `response-config` style is listed and works | Manual | |

**F10 to F12 steps.**

```
node <skill-dir>/scripts/config.mjs --set claude.outputStyle.manage=true
```

Restart Claude Code and open `/output-style`. Pass when both `response-config` and `response-config-managed` are listed. Pick the managed one and ask a question. Pass when the reply follows the rules even with no hooks installed.

## G. Claude Code plugin and hooks, live

Use Claude Code 2.1.310 or newer in a normal terminal, not inside another Claude session.

| ID | Check | Who | Result |
|---|---|---|---|
| G1 | Plugin and marketplace manifests valid | Auto, `npm run validate` | Pass |
| G2 | The plugin's hook commands run with `CLAUDE_PLUGIN_ROOT` set | Auto, e2e PLUG-1 | Pass |
| G3 | The shipped output style matches the rules | Auto, e2e PLUG-2 | Pass |
| G4 | The install command in the README works | Manual | Pass (needed `http.sslBackend schannel` on this machine) |
| G5 | SessionStart fires and its rules reach the model | Manual | Pass after the HOOK-1 fix. First run failed: the 2.5 s exit timer cut it off. The retest took 5.9 s on startup, a thin margin under 8 s |
| G6 | The per-prompt hint reaches the model | Manual | Pass (sent the full rules, as D6 expects after a silent session start) |
| G7 | Stop fills the ledger | Manual | Pass after the PARSE-1 fix (needed a reinstall: same version number, so the cache was stale) |
| G8 | Quick replies resolve items | Manual | Model: pass. Ledger: fail, then fixed (PARSE-2, PARSE-3); retest |
| G9 | After `/compact`, IDs continue | Manual | |
| G10 | After `claude --resume`, open items come back | Manual | |
| G11 | Hooks installed by `setup.mjs` instead of the plugin behave the same | Manual | |
| G12 | Plugin and `setup.mjs` hooks both installed: does the model get the rules twice? | Manual | |
| G13 | `claude -p "list the files here"` runs the hooks too | Manual | |
| G14 | The same in the VS Code extension | Manual | |

**Steps.**

1. **G4.** Run the README command:

   ```
   /plugin install response-config --marketplace paulbennet/agent-response-config
   ```

   If it is rejected, try `/plugin marketplace add paulbennet/agent-response-config` then `/plugin install response-config@response-config`, and note which one worked so the README can be fixed.
2. **G5, G6.** Start with `claude --debug`, then send "what is 2+2". In the debug log, look for the SessionStart and UserPromptSubmit hooks with `[response-config]` text. Pass when the reply is one short line with no preamble.
3. **G7.** Ask "plan three steps to add a lint script; give me Actions and one Question". Then run `node <skill-dir>/scripts/config.mjs --ledger path` and open the newest `claude-*.json` file. Pass when it lists A1 to A3 and Q1.
4. **G8.** Reply `Q1: yes, done A1`. Pass when the agent acts on both, does not repeat them, and new items start at A4.
5. **G9.** Run `/compact`, then ask for one more step. Pass when the new item is A4 or later, not A1.
6. **G10.** Quit, run `claude --resume`, pick the session and send `A2`. Pass when the agent knows what A2 is.
7. **G12.** With both installed, check the debug log for the rules once or twice. If twice, `setup.mjs` should skip Claude when the plugin is present.

## H. Claude mod

Install with `/plugin install response-config-mod --marketplace paulbennet/agent-response-config`, or start with `claude --plugin-dir mods/response-config-mod`.

| ID | Check | Who | Result |
|---|---|---|---|
| H1 | Manifest, hooks module and state contract valid | Auto, validate | Pass |
| H2 | Types check against the 2.1.310 API | Auto, `tsc` | Pass |
| H3 | A prompt without tags passes through untouched | Auto, mod test | Pass |
| H4 | A tag is removed and named in the hint | Auto, mod test | Pass |
| H5 | Finished turns register items; interrupted ones do not; quick replies resolve | Auto, mod test | Pass |
| H6 | Items pane shows items and buttons on terminal and desktop | Auto, mod test | Pass |
| H7 | A config file changed on disk reaches the next prompt; reused IDs are announced | Auto, mod tests | Pass |
| H8 | The mod loads with no error line in the transcript | Manual | |
| H9 | First-run wizard appears; Later and Never ask behave | Manual | |
| H10 | `/response-config` shows the mode | Manual | |
| H11 | `on`, `off`, `verbose`, `terse`, `reset` change the next reply | Manual | |
| H12 | `/response-config pane`: edits save to the config file and the style syncs | Manual | |
| H13 | `/response-config items`: Do, Done, Skip, Yes, No, option and Answer buttons send the right reply | Manual | |
| H14 | The band above the prompt shows the mode and open counts, and updates after a turn | Manual | |
| H15 | `/response-config style status` and `style sync` | Manual | |
| H16 | With the plugin hooks also installed, the hooks stand down and the rules appear once | Manual | |
| H17 | Change a setting with `config.mjs --set` in a shell mid-session; the next reply follows it | Manual | |
| H18 | A session left open over an hour keeps the hooks stood down | Manual | |
| H19 | The same in the Claude desktop app | Manual | |
| H20 | The same in the VS Code extension | Manual | |

**H16 steps.** Install both plugins and start with `--debug`. Pass when the classic hooks print nothing for this session. The mod's rules are in the system prompt instead.

## I. Codex, live

Install the Codex CLI and the skill:

```
npx skills add paulbennet/agent-response-config --skill response-config -a codex -g
```

| ID | Check | Who |
|---|---|---|
| I1 | `setup.mjs --agent codex --scope user` then `/hooks` lists 3 response-config hooks | Manual |
| I2 | After trusting them, session start adds the rules | Manual |
| I3 | The per-prompt hint arrives; replies follow the format | Manual |
| I4 | Stop prints `{}` and Codex shows no hook error | Manual |
| I5 | The ledger file `codex-*.json` fills after a reply with items | Manual |
| I6 | Project scope: `.codex/hooks.json` runs in a trusted project | Manual |
| I7 | `--instructions` block in AGENTS.md is read | Manual |
| I8 | The Codex VS Code extension: does it run the same hooks? | Manual |

I1 also confirms the `hooks.json` wrapper shape, which nobody has checked against a live Codex. If `/hooks` lists nothing, that shape is wrong.

## J. Copilot CLI, live

| ID | Check | Who |
|---|---|---|
| J1 | `setup.mjs --agent copilot --scope user` writes `~/.copilot/hooks/response-config.json`; Copilot loads it | Manual |
| J2 | `sessionStart` context reaches the model | Manual |
| J3 | `userPromptTransformed` appends the hint, and you do not see it echoed as your own text | Manual |
| J4 | `agentStop` reads the transcript; the `copilot-*.json` ledger fills | Manual |
| J5 | Project hooks in `.github/hooks/` | Manual |
| J6 | 25 or more prompts in one session: the rules still hold | Manual |

## K. Copilot in VS Code, live

Turn on the VS Code hooks preview setting first.

| ID | Check | Who |
|---|---|---|
| K1 | `setup.mjs --agent copilot --scope project --vscode`; the hooks run, as shown in the Output panel | Manual |
| K2 | Rules reach the model in Copilot Chat agent mode | Manual |
| K3 | Copilot Chat finds the skill in `.agents/skills` or `.github/skills` | Manual |
| K4 | `copilot-instructions.md` block from `--instructions` is applied | Manual |

## L. Distribution

| ID | Check | Who | Result |
|---|---|---|---|
| L1 | `npx skills add <local repo>` for claude-code | Auto, e2e | Pass |
| L2 | Same for codex | Auto, e2e | Pass |
| L3 | Same for github-copilot | Auto, e2e | Pass |
| L4 | The installed copy runs | Auto, e2e | Pass |
| L5 | `npx skills add paulbennet/agent-response-config --skill response-config` from GitHub, project and `-g` | Manual | |
| L6 | The skills.sh page and README badge appear after real installs | Manual | |
| L7 | `gh skill install paulbennet/agent-response-config response-config --agent claude-code --scope user` | Manual, gh 2.90+ | |
| L8 | Claude marketplace install of both plugins, as G4 and H8 | Manual | |
| L9 | A fresh clone passes `npm test` and `npm run test:e2e` | Manual | |

L5 and L6 send install telemetry, which is what lists the repo on skills.sh.

## M. Reply quality evals

Run each in a fresh session with default settings unless the row says otherwise. Do the full set in Claude Code. Do at least M1 to M8 in Codex and Copilot. Record the agent, version, settings, a copy of the reply, pass or fail, and notes. If you paste the replies, I can count prose words and compute readability scores for M13 to M17.

| ID | Setting or prompt | Pass when |
|---|---|---|
| M1 | "Rename `foo` to `bar` in src/util.js and run the tests." | Summary at most 80 prose words; code and output verbatim |
| M2 | A task that makes a test fail | Error output shown in full; summary still short |
| M3 | "Should we use Redis or Postgres for the queue?" | One D1 item with lettered options |
| M4 | Reply `D1: a` after M3 | Proceeds with a; does not repeat D1; next IDs continue |
| M5 | "Explain how the build works !verbose" | Long answer; rules back on the next turn |
| M6 | `!off Summarise this repo in detail.` | Normal full answer |
| M7 | A destructive request: "delete the build folder" | Asks for confirmation in full sentences |
| M8 | A long session past a compaction | IDs continue, none reused |
| M9 | `minimal.level` low, then medium, high, extreme | Each level visibly shorter |
| M10 | `minimal.maxWords=30` | Prose within 30 words |
| M11 | `minimal.preserve` without `tables` | Tables may be shortened; others not |
| M12 | `structured.on=false` | Plain prose, still brief |
| M13 | `language.on=true`, `cefr=A1` | Sentences of 8 words or fewer, very common words |
| M14 | `cefr=B1` | Sentences of 16 words or fewer; technical terms explained |
| M15 | `cefr=C1` | Fluent, no padding |
| M16 | `readability={"standard":"flesch-kincaid","target":6}` | Measured grade about 6 or lower |
| M17 | `vocabulary=ste` | Active voice, short sentences, one meaning per word |
| M18 | `vocabulary=basic-english` | Simple words, technical terms allowed |
| M19 | `plainLanguage=true` | Says "you", main point first |
| M20 | `structured.showEmptySections=true` | All four headings, "none" when empty |
| M21 | `structured.sections=["actions","questions"]` | Only those two sections |
| M22 | `!level=A2 !words=20` in one prompt | That turn follows both; the next turn does not |

## N. Platforms

| ID | Check | Who | Result |
|---|---|---|---|
| N1 | Windows: all auto suites | Auto | Pass |
| N2 | Windows: PowerShell forms of the Copilot commands | Auto, e2e | Pass |
| N3 | macOS: `npm test`, `npm run test:e2e` | Manual | |
| N4 | Linux: the same, and `~/.config/response-config` or `XDG_CONFIG_HOME` is used | Manual | |
| N5 | One live agent on macOS or Linux, with G5 to G8 | Manual | |

## Suggested order for the manual cases

1. **Claude Code first:** G4 to G13, F10 to F12, then the Claude rows of M. Everything else depends on the rules reaching the model.
2. **The mod:** H8 to H20.
3. **Codex, then Copilot CLI, then VS Code:** these hooks are the least proven, especially I1 and K1.
4. **Distribution from GitHub:** L5 to L8, last, because real installs count on skills.sh.
