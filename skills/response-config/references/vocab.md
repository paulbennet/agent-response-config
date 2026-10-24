# Controlled vocabularies and word lists

These profiles are instructions only. No word list is bundled with this skill. Apply the closest match from what you know of each list; do not claim exact compliance.

Always allowed, whatever the list: technical terms the user needs, code and identifiers, proper names, numbers, units, quoted output.

| Value | What it is | How to write with it |
|---|---|---|
| basic-english | C. K. Ogden's Basic English, about 850 words | Use the 850 words. Express other ideas with them: "make clear" for "clarify". Few verbs; use "do", "make", "get", "put" with particles. |
| globish | Jean-Paul Nerriere's Globish, about 1,500 words | Common international words, short sentences, no idioms or humour, active voice, repeat key words instead of synonyms. |
| ste | ASD-STE100 Simplified Technical English (aerospace manuals; standard maintained by ASD) | Approved words, one meaning per word, one word per meaning. Sentences 20 words or fewer for descriptions, 25 for procedures. Active voice. One instruction per sentence, imperative. Paragraphs of 6 sentences or fewer. No "-ing" tricks, no contractions. |
| oxford-3000 | Oxford 3000: core words for learners, A1-B2 | Prefer these everyday words; avoid rarer synonyms. |
| oxford-5000 | Oxford 5000: Oxford 3000 plus B2-C1 words | As above, a wider range. |
| ngsl | New General Service List (about 2,800 words covering most general English) | Prefer these general words. |
| awl | Coxhead Academic Word List (570 word families) | Academic words are allowed for precision; otherwise use general-service words. |

## Choosing

| Goal | Value |
|---|---|
| Very small word set, learners | basic-english, globish |
| Procedures, manuals, warnings | ste |
| Natural text for learners at A1-B2 | oxford-3000 or ngsl |
| Natural text up to C1 | oxford-5000 |
| Formal or academic tone | awl |

## Combining

A vocabulary list controls word choice. Sentence length and grammar come from `cefr` and `readability`. Set both for the tightest control, for example `cefr: B1` with `vocabulary: oxford-3000`.

## Legal note

Oxford 3000/5000 are Oxford University Press lists and ASD-STE100 is published by ASD; this skill only names them. To use a licensed list as data, keep it in your own project and refer to it in your own instructions.
