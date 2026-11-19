# Readability targets

Pick a standard and a target in `language.readability`. You cannot compute scores while writing, so use the writing proxies in the last column.

| Standard | Direction | Scale | Writing proxy |
|---|---|---|---|
| flesch-reading-ease | higher = easier | 0-100 | 90+: 8-word sentences, 1-syllable words. 60-70: 15-20 words, mostly 1-2 syllables. 30-50: 25 words, long words. |
| flesch-kincaid | lower = easier | US grade | Grade 5: ~10 words/sentence. Grade 8: ~15. Grade 12: ~22. |
| gunning-fog | lower = easier | US grade | Count words of 3+ syllables; keep them under 10% and sentences under 15 words for Fog 8. |
| smog | lower = easier | US grade | Fewer polysyllabic words (3+ syllables) per 30 sentences. Grade 8 needs about 1 per sentence or fewer. |
| coleman-liau | lower = easier | US grade | Shorter words (fewer letters per word) and shorter sentences. |
| dale-chall | lower = easier | 4.9 and below = grade 4 and under; 5.0-5.9 = 5-6; 6.0-6.9 = 7-8; 7.0-7.9 = 9-10; 8.0-8.9 = 11-12; 9.0+ = college | Use words from the Dale-Chall familiar-word list (about 3,000); keep sentences short. |

## Formulas (for reference)

- Flesch Reading Ease = 206.835 - 1.015 (words/sentences) - 84.6 (syllables/words)
- Flesch-Kincaid Grade = 0.39 (words/sentences) + 11.8 (syllables/words) - 15.59
- Gunning Fog = 0.4 [(words/sentences) + 100 (complex words/words)]
- SMOG = 1.043 sqrt(polysyllables x 30/sentences) + 3.1291
- Coleman-Liau = 0.0588 L - 0.296 S - 15.8 (L = letters per 100 words, S = sentences per 100 words)

## Mapping to CEFR (rough)

| CEFR | Flesch-Kincaid grade | Flesch Reading Ease |
|---|---|---|
| A1-A2 | 2-5 | 80-100 |
| B1 | 6-8 | 60-80 |
| B2 | 9-11 | 50-60 |
| C1-C2 | 12+ | below 50 |

## Notes

- Scores ignore meaning; short sentences with rare words still read hard.
- Code, identifiers and quoted output distort scores; exclude them.
- A set `cefr` and a set `readability` both apply; the stricter wins.
