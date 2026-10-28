# CEFR writing levels

Write so a reader at the chosen level understands without help. CEFR describes learners; the limits below are working rules for text, not official definitions.

| Level | Sentences | Vocabulary | Grammar | Avoid |
|---|---|---|---|---|
| A1 | 8 words or fewer; one idea each | About 500 most common words | Present simple, "can", imperatives | Idioms, phrasal verbs, passive, subordinate clauses |
| A2 | 12 words or fewer | About 1,000 common words | Past simple, future with "will", simple "and/but/because" | Idioms, conditionals, relative clauses |
| B1 | 16 words or fewer | About 2,000 common words; explain a technical term in a few words the first time | Present perfect, first conditional, simple passive | Rare idioms, long noun chains |
| B2 | 20 words or fewer on average | Everyday and common technical words; no need to explain basic terms | Most tenses, conditionals, relative clauses | Slang, dense nominalisation |
| C1 | Natural length and variety | Wide, precise vocabulary | Full range | Padding, vague words |
| C2 | No limit | No limit | No limit | Padding; keep it economical |

## Presets

`language.preset` bundles a level with a word list; set one with `config.mjs --level <name>`.

| Preset | CEFR | Also |
|---|---|---|
| `simple` | A2 | plain language, Oxford 3000 words |
| `global` | B1 | Globish words, for readers of any first language |
| `technical` | B2 | Simplified Technical English (ASD-STE100) |

## Rules for every level

- One idea per sentence at A1-B1.
- Prefer concrete verbs over abstract nouns: "check the file", not "perform a verification of the file".
- Use the same word for the same thing. Do not vary terms for style.
- Keep technical terms the user needs (names, APIs, flags). At A1-B1 add a short gloss the first time: "a *branch* (a separate line of work)".
- Numbers as digits. Dates as "12 March".
- Code, identifiers and quoted output are exempt.

## Quick examples

Same message at three levels:

- A2: "The test failed. I fixed the file. Now the test works."
- B1: "The test failed because a file name was wrong. I fixed the name, and now the test passes."
- C1: "The test failed on a misspelt import path; correcting it brings the suite back to green."
