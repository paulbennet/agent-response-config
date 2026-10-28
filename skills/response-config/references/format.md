# Structured reply format

## Template

```
<summary: what happened, 1-3 short sentences>

Actions
- 🔵 A1 <imperative, one step>
Suggestions
- 🔵 S1 <optional, user decides>
Questions
- 🔵 Q1 <needs an answer> (yes/no)
Decisions
- 🔵 D1 <choice to make> (a) <option> (b) <option>

Resolved: <closed IDs, see below>
```

## Status emojis

| Emoji | Status | Where |
|---|---|---|
| 🔵 | open | before the ID of a listed item |
| ⏳ | in progress | before the ID of a listed item |
| ✅ | done | in the Resolved line |
| 💬 | answered | in the Resolved line |
| ⏭️ | skipped | in the Resolved line |

With `structured.statusEmoji` false, items carry no emoji. The hooks read an emoji before or after the ID either way: `- ✅ A2 text` closes A2, `- ⏳ A1 text` marks A1 in progress.

## Item types

| Type | Letter | Use for | Good form |
|---|---|---|---|
| Action | A | Something the user (or you, next) should do | "Run `npm test`." |
| Suggestion | S | Optional improvement; no reply needed | "Cache the AST between runs." |
| Question | Q | You need information to continue | "Keep the old flag? (yes/no)" |
| Decision | D | A choice between options that changes the work | "Error format: (a) JSON (b) text" |

## ID rules

- One counter per letter. Never reset, never reuse, even when an item is resolved.
- Continue from the highest ID seen in the conversation. If a hook supplied "Next IDs: A3 S2 Q1 D1", use those.
- One item per list line, starting `- 🔵 A1 ` (or `- A1 ` without emojis), under its section heading. Text on the same line. No sub-bullets that start with an ID pattern.
- Outside a section heading only a marked ID counts (`- A1: text`, `- **A1** text`), so numbered prose such as `1. Q3 2026 revenue` is not an item.
- Re-listing an open item from an earlier turn keeps its original ID; do not renumber. Never re-list a finished item.
- If you reuse an ID for a different item anyway, the new item takes that ID and the earlier one is no longer tracked; the hook tells you on the next turn.

## Closing items

When an item is finished or settled, do not list it under its section again. Close it in one line after the sections, so it leaves the open list:

```
Resolved: ✅ A2, 💬 Q1, ⏭️ S1
```

Without emojis: `Resolved: A2, Q1 (answered), S1 (skipped)`. The hooks also read older forms, such as `- A2 done`, `- A3 Update the changelog (done)` or a trailing `[done]`, `- done` or `✓`.

## Quick replies from the user

| User writes | Meaning |
|---|---|
| `A2`, `do A2`, `please do A2` | Carry out action (or suggestion) 2 |
| `Q1` alone | Points at question 1; help settle it, nothing is answered yet |
| `done A1`, `A1 done` | Action 1 is finished; stop tracking it |
| `skip S1`, `skip S1 S2`, `S1 skip` | Drop these items |
| `Q1: yes` | Answer to question 1 |
| `D3: b` | Choose option b of decision 3 |
| Several, comma separated | `Q1: yes, D2: a, skip S3` |
| `Q1: why?` | A question about Q1, not an answer |

Verbs count only at the start of the message or of a clause, optionally after `please`, `ok`, `yes` or `go ahead and` (`to do A1 you need...` is prose). The postfix form `A1 done` must end its clause. An answer ends at `,` `;` `!` `?`, a newline or a sentence-ending period, and is at most 80 characters.

If a referenced ID does not exist, say so in one line and ask what they meant. After acting on a reply, do not repeat the resolved item.

## Edge cases

- Nothing to follow up: send the summary only. No empty sections (unless `showEmptySections`).
- Long outputs (diffs, logs, tables) go after the summary, before the item sections, unchanged.
- Failure or risk: the first line says it failed; the cause goes in the summary; the next step is an Action.
- When the user asks a plain question, answer it in the summary. Add items only if they need a reply or a step.
- With structured off, write normal prose but keep brevity rules.

## Example

```
Moved the parser into `lib/parse.ts`; tests pass.

Actions
- 🔵 A1 Run `npm run lint` before committing.
Suggestions
- 🔵 S1 Cache the AST between runs.
Questions
- 🔵 Q1 Keep the old `--legacy` flag? (yes/no)
Decisions
- 🔵 D1 Error format: (a) JSON (b) plain text
```

Reply: `Q1: yes, D1: a, skip S1`. The next reply ends with `Resolved: 💬 Q1, 💬 D1, ⏭️ S1`.
