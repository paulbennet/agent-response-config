# Structured reply format

## Template

```
<summary: what happened, 1-3 short sentences>

Actions
- A1 <imperative, one step>
Suggestions
- S1 <optional, user decides>
Questions
- Q1 <needs an answer> (yes/no)
Decisions
- D1 <choice to make> (a) <option> (b) <option>
```

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
- One item per list line, starting `- A1 `. Text on the same line. No sub-bullets that start with an ID pattern. Bare `A1 text` lines count only directly under a section heading.
- Re-listing an unresolved item from an earlier turn keeps its original ID; do not renumber.
- If you reuse an ID that is closed, or give an open ID to a different item, the hook renumbers the new item and tells you the new ID on the next turn.

## Closing items

When an item is finished or settled, close it so it leaves the open list:

```
- A2 done
- Q1 answered
Resolved: S1, D2
```

## Quick replies from the user

| User writes | Meaning |
|---|---|
| `A2`, `do A2` | Carry out action (or suggestion) 2 |
| `done A1` | Action 1 is finished; stop tracking it |
| `skip S1`, `skip S1 S2` | Drop these items |
| `Q1: yes` | Answer to question 1 |
| `D3: b` | Choose option b of decision 3 |
| Several, comma separated | `Q1: yes, D2: a, skip S3` |
| `Q1: why?` | A question about Q1, not an answer |

Verbs count only at the start of the message or of a clause (`to do A1 you need...` is prose). An answer ends at `,` `;` `!` `?`, a newline or a sentence-ending period, and is at most 80 characters.

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
- A1 Run `npm run lint` before committing.
Suggestions
- S1 Cache the AST between runs.
Questions
- Q1 Keep the old `--legacy` flag? (yes/no)
Decisions
- D1 Error format: (a) JSON (b) plain text
```

Reply: `Q1: yes, D1: a, skip S1`
