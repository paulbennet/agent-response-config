---
title: Stop scrolling agent replies
date: 2026-11-10
devto: https://dev.to/paulbennetjoshua/stop-scrolling-agent-replies-1o17
description: A skill for Claude Code, Codex and Copilot that makes agent replies short, gives every next step an ID you can answer, and sets the English level you want.
---

# Stop scrolling agent replies

I use coding agents all day. Claude Code in the terminal, Codex for a second opinion, Copilot in VS Code. They are good at the work. They are less good at telling me about it.

A typical reply to "the test is failing, fix it" looks like this:

<div class="compare">
<div>

**Before**

```text
Great question! I took a look at the failing test, and I think I understand what's going on here. The test `parses an empty config` in `tests/config.test.mjs` is failing with `TypeError: Cannot read properties of undefined (reading 'trim')`. This happens because `parseConfig` assumes the file always has at least one line, but when the file is empty, `lines[0]` is undefined.

To fix this, I've updated `parseConfig` so that it returns the default config when the input is empty. I also took the opportunity to tidy up the function a little, which should make it easier to maintain going forward.

Now all 14 tests pass! 🎉

There are a few things you might want to consider next. First, you may want to commit this change. It could also be worth adding a test for a config file that only contains comments, since that is a similar edge case. Additionally, I was wondering whether an empty file should produce a warning or whether it should stay silent; both approaches have trade-offs. Another thing to think about is where the default should live: it could stay in `parseConfig`, or each caller could supply its own. Let me know how you'd like to proceed, and I'm happy to help with any of these!
```

</div>
<div>

**After**

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

</div>
</div>

Both replies say the same thing. The first one hides four next steps, a question and a decision inside 230 words of prose. To answer it, I have to read all of it, remember which "thing to consider" was which, and write a paragraph back.

The second one I can answer in one line:

```text
done A1, Q1: yes, D1: a
```

That is what [response-config](https://github.com/paulbennet/agent-response-config) does. It is one agent skill, with optional hooks, for Claude Code, Codex and GitHub Copilot. It is free and MIT licensed.

## Reply by ID

Every reply starts with a short summary of what happened. Then come up to four sections, each with numbered items:

- **Actions** (A1, A2, ...): steps for you or the agent.
- **Suggestions** (S1, ...): things you can do or skip.
- **Questions** (Q1, ...): each with an answer form, such as `(yes/no)`.
- **Decisions** (D1, ...): lettered options, with the agent's pick marked "(recommended)".

You answer by ID, in any order, in one message: `done A1`, `skip S2`, `Q1: yes`, `D1: b`, `please do A2`. Each item starts with a status, 🔵 open or ⏳ in progress. Finished items are not listed again. The agent closes them in one line at the end:

```text
Added the warning and moved the default into parseConfig; tests pass.

## Actions
- 🔵 A3 Add the change to the CHANGELOG.

Resolved: ✅ A1, 💬 Q1, 💬 D1
```

The IDs count up for the whole session and are never reused. A3 comes after A2, even if A2 is still open twenty prompts later. So "A2" always means the same thing.

That only works if something remembers the items. A skill alone cannot: the model forgets after the context is compacted, and a resumed session starts cold. The optional hooks fix this. After each reply, a Stop hook reads the items into a small ledger file per session. On each prompt, a short hint tells the model which items are still open and which IDs come next. Your `done A1` updates the ledger directly, so the item closes even if the model forgets to say so.

The hooks only add instructions. They never rewrite or block an answer.

## Pick your English level

I wrote this for myself first. Then I watched colleagues who read English as a second language copy agent replies into a translator. Long sentences and idioms ("let's circle back", "low-hanging fruit") make that harder than it needs to be.

So response-config can set a reading level:

- **CEFR levels**, A1 to C2. At A2 the agent keeps sentences short and uses common words. At C1 it writes like a fluent colleague.
- **Plain language**: the main point first, "you" instead of "the user", active voice.
- **Readability targets**, such as Flesch-Kincaid grade 8 or Gunning Fog.
- **Controlled vocabularies**: Simplified Technical English (ASD-STE100), Globish, the Oxford 3000.

Three presets cover the usual cases:

| Preset | Sets |
|---|---|
| `simple` | A2, plain language, Oxford 3000 words |
| `global` | B1, Globish words, for readers of any first language |
| `technical` | B2, Simplified Technical English |

Set one for good with `config.mjs --level global`, or just ask the agent: "use B1 English". You can also change it for one message. `!level=A2` in a prompt gives one simple reply. Add `!keep` to keep the level for the rest of the session. Here is the fix above, at `!level=A2`:

```text
I fixed the crash. The config file was empty, and the code did not expect that. Now all 14 tests pass.
```

Code, commands, error messages and file paths are never simplified. Only the prose around them changes.

How well does it hold? The repo has headless evals that run the same cases on all three agents and measure the replies. In the last Claude run, an A1 reply had a longest sentence of 8 words, and a 30-word cap came back at 27 words. Those are model results, not guarantees, but they are measured.

## One skill, three agents

The skill uses the open [Agent Skills](https://agentskills.io) format, so one folder works in every agent that reads it. Install it the way you install other skills:

| You use | Install |
|---|---|
| Any agent (skills.sh) | `npx skills add paulbennet/agent-response-config --skill response-config` |
| GitHub CLI 2.90+ | `gh skill install paulbennet/agent-response-config response-config --agent claude-code --scope user` |
| Claude Code plugin | `/plugin install response-config --marketplace paulbennet/agent-response-config` |
| Codex plugin | `codex plugin marketplace add paulbennet/agent-response-config`, then `codex plugin add response-config@response-config` |

The two plugins also bring the hooks. In Claude Code they are on as soon as the plugin is enabled. In Codex, run `/hooks` once and trust the three hooks. For Copilot, or to add hooks to a plain skill install, one command writes them:

```text
node <skill-dir>/scripts/setup.mjs --agent copilot --scope user
```

Then make it yours. Say "configure response-config", and the agent walks you through each setting, one group at a time, with lettered options. Or set keys directly: `config.mjs --set minimal.level=extreme` for the shortest replies, `--set structured.sections='["actions","questions"]'` for only two sections. Config lives in your user folder, with an optional `.response-config.json` in a repo, so a team can share one style.

When you need the long version, put `!verbose` in your message. `!off` turns everything off for one turn.

## What it does not do

Some limits, up front.

- **It instructs; it does not enforce.** The rules are text that the model follows well, not a validator. A model can still run long, and nothing regenerates the reply.
- **Copilot item tracking is best effort.** Copilot's Stop hook gives a transcript path, not the final message, so the ledger can miss items there.
- **Codex plugin hooks need your trust once**, through `/hooks`. Until you trust them, only the skill is active.

## Try it

Install it with one of the commands above, then ask your agent for something with a few steps in it. Answer the reply with `done A1`, and see how it feels.

The code, the full docs and the test plan are on [GitHub](https://github.com/paulbennet/agent-response-config). If a reply comes back wrong, [open an issue](https://github.com/paulbennet/agent-response-config/issues) with your agent, its version and the output of `config.mjs --show`.
