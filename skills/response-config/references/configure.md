# Guided configuration

Use this flow when the user asks to configure, set up, tune or review response-config without naming a key ("configure response-config", "show my reply settings", "change how you answer"). It is the settings menu for agents with no settings pane.

## 1. Show what is in effect

Run `node <skill-dir>/scripts/config.mjs --show` and summarise it as one table: group, setting, current value. Name the layers listed in `sources:` (defaults, user, project) and say which file a change will go to.

## 2. Ask one group at a time

Ask about one group per reply, as Decisions with lettered options. Mark the current value "(current)" and the suggested one "(recommended)". If the host has a choice tool (Claude Code `AskUserQuestion`), use it instead. Skip a group when the user says it is fine. Stop when the user says done.

| Group | Setting | Options | Command |
|---|---|---|---|
| Brevity | On or off | (a) on (b) off | `--set minimal.on=true` |
| | Level | (a) low, 150 words (b) medium, 110 (c) high, 80 (d) extreme, 40 | `--set minimal.level=high` |
| | Word budget | the level's default, or a number | `--set minimal.maxWords=null` or `=60` |
| Structure | On or off | (a) on (b) off | `--set structured.on=true` |
| | Sections | any of actions, suggestions, questions, decisions | `--set structured.sections='["actions","questions"]'` |
| | Status emojis | (a) on (b) off | `--set structured.statusEmoji=false` |
| | Empty sections | (a) hide (b) show | `--set structured.showEmptySections=true` |
| | Reply hint line | (a) on (b) off | `--set structured.replyHint=false` |
| English level | Level | (a) off (b) A1 to C2 (c) plain (d) simple (e) global (f) technical | `--level B1` |
| | Readability | (a) off (b) a standard and a target, such as flesch-kincaid=8 | `--readability flesch-kincaid=8` |
| | Vocabulary | (a) off (b) basic-english, globish, ste, oxford-3000, oxford-5000, ngsl, awl | `--vocab ste` |
| Tags | `!level=` and other tags | (a) on (b) off | `--set overrides.inlineTags=false` |
| Hooks | Session start, each prompt, ledger | on or off each | `--set hooks.eachPrompt=false` |
| Output style (Claude Code) | Managed style file | (a) off (b) user (c) project | `--set claude.outputStyle.manage=true --set claude.outputStyle.scope=user` |

Explain a preset in one line when you offer it: simple is A2, plain language and Oxford 3000; global is B1 and Globish; technical is B2 and Simplified Technical English.

## 3. Ask where to save

Before the first change, ask once: (a) user, for all projects (b) project, in `.response-config.json`, shared with the repo. Add `--project` for (b).

## 4. Apply and confirm

Run every change for the group in one `config.mjs` call (several `--set` flags are allowed). Report each changed key as old → new. If the CLI refuses a value, show its error and ask again. Changes apply from the next prompt. A managed output style is regenerated at once but loads in the next session.

Do not install hooks, activate the output style or write a project file without the user's yes.
