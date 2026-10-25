import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAssistantItems, parseTags, parseUserReplies, stripFences,
} from '../skills/response-config/scripts/lib/parse.mjs';
import { emptyLedger, registerItems } from '../skills/response-config/scripts/lib/core.mjs';

const ids = (items) => items.map((i) => `${i.type}${i.n}${i.close ? `:${i.close}` : ''}`);

test('parseAssistantItems reads list items and ignores code fences', () => {
  const text = ['Done.', '', 'Actions', '- A1 Run tests', '* **Q2:** Keep flag? (yes/no)', '3. D1 Pick (a) x (b) y', '```', '- A9 inside code', '```'].join('\n');
  const items = parseAssistantItems(text);
  assert.deepEqual(ids(items), ['A1', 'Q2', 'D1']);
  assert.equal(items[1].text, 'Keep flag? (yes/no)');
});

test('parseAssistantItems accepts bare IDs only under a section heading', () => {
  const text = ['Actions', 'A1 Run tests', 'A2 Lint', '', 'Some prose.', 'S4 not an item here'].join('\n');
  assert.deepEqual(ids(parseAssistantItems(text)), ['A1', 'A2']);
  assert.deepEqual(ids(parseAssistantItems('**Questions:**\nQ3 Keep it? (yes/no)')), ['Q3']);
});

test('headings with the type letter, as the rules print them, open a section (live G7)', () => {
  const text = [
    'Plan for a lint script.', '', '## Actions (A)', '- A1 Install ESLint', '- A2 Create the config',
    '- A3 Add scripts to `package.json`:', '  ```json', '  "scripts": {', '    "lint": "eslint ."', '  }', '  ```',
    '', '## Questions (Q)', '- Q1 Which folder? (path + stack)', '', '**Decisions (D):**', 'D1 Pick (a) x (b) y',
  ].join('\n');
  assert.deepEqual(ids(parseAssistantItems(text)), ['A1', 'A2', 'A3', 'Q1', 'D1']);
});

test('a status with a note closes the item; "still open" reopens it (live G8)', () => {
  const text = [
    '## Actions (A)', '- A1 done: installed `eslint`', '- A2 still open: run `npm i`', '- A3 Done - added the script',
    '', '## Questions (Q)', '- Q1 answered: yes', '- Q2 Should I run it? (yes/no)',
  ].join('\n');
  const items = parseAssistantItems(text);
  assert.deepEqual(ids(items), ['A1:done', 'A2', 'A3:done', 'Q1:answered', 'Q2']);
  assert.equal(items[1].reopen, true);
  assert.equal(items[1].text, 'run `npm i`');
  // A status word that does not lead with a separator is ordinary item text.
  assert.deepEqual(ids(parseAssistantItems('Actions\n- A1 Done criteria for the release')), ['A1']);
});

test('indented fences under a list item are stripped', () => {
  const text = ['Actions', '- A1 Add scripts:', '  ```', '  - A9 inside code', '  ```', 'A2 Run them'].join('\n');
  assert.deepEqual(ids(parseAssistantItems(text)), ['A1', 'A2']);
});

test('parseAssistantItems ignores prose and table rows that start with an ID-like token (review M1)', () => {
  const text = ['Q3 2026 revenue grew.', 'A4 paper is standard.', 'S3 bucket is public.', '| D1 | cell |'].join('\n');
  assert.deepEqual(parseAssistantItems(text), []);
});

test('parseAssistantItems reads closing lines (review M5)', () => {
  const text = ['- A2 done', '- Q1 (answered)', 'Resolved: S1, D2'].join('\n');
  assert.deepEqual(ids(parseAssistantItems(text)), ['A2:done', 'Q1:answered', 'S1:done', 'D2:done']);
});

test('outside a section only marked IDs count, or the next unused ID (review 0.1.1 N8, live G8)', () => {
  const register = (text, counters) => {
    const l = emptyLedger('claude', 's');
    Object.assign(l.counters, counters);
    return registerItems(l, parseAssistantItems(text));
  };
  const prose = ['Results:', '1. Q3 2026 revenue grew 10%', '- S3 bucket is public', '2. A4 paper is standard'].join('\n');
  assert.deepEqual(parseAssistantItems(prose).filter((i) => !i.loose), []);
  assert.deepEqual(register(prose), []);
  assert.deepEqual(ids(parseAssistantItems('Notes\n- A1: Run tests\n- **Q1** Keep it? (yes/no)')), ['A1', 'Q1']);
  assert.deepEqual(ids(parseAssistantItems('Fixed it.\n- A2 done')), ['A2:done']);
  assert.deepEqual(register('Revenue:\n1. Q3 2026 grew\n\nQuestions\n- Q1 Ship it? (yes/no)'), ['Q1']);
  // No headings, as the model sometimes writes them: the next IDs in order are items.
  const plain = ['Plan:', '', '- A1 Install ESLint', '- A2 Add the scripts', '- A3 Run it', '', '- Q1 Add Prettier too? (yes/no)'].join('\n');
  assert.deepEqual(register(plain), ['A1', 'A2', 'A3', 'Q1']);
  assert.deepEqual(register('- A4 Deploy\n- A6 Tag', { A: 3 }), ['A4']);
  assert.deepEqual(ids(parseAssistantItems('- Resolved: A1, Q1')), ['A1:done', 'Q1:done']);
});

test('trailing status words close an item (review 0.1.1 N2)', () => {
  const items = parseAssistantItems(['Actions', '- A1 Run tests (completed)', '- A2 Lint [done]', '- A3 Deploy - done', '- A4 Tag ✓', '- A5 Mark the task done', '- A6 ✓'].join('\n'));
  assert.deepEqual(ids(items), ['A1:done', 'A2:done', 'A3:done', 'A4:done', 'A5', 'A6:done']);
  assert.equal(items[0].text, 'Run tests');
  assert.equal(items[4].text, 'Mark the task done');
});

test('stripFences removes fenced blocks only', () => {
  assert.equal(stripFences('a\n```js\nA1 x\n```\nb').includes('A1'), false);
});

test('parseUserReplies understands do/done/skip, answers and bare IDs', () => {
  const r = parseUserReplies('done A1, skip S2 S3\nQ1: yes, D2 = b');
  assert.deepEqual(r.map((x) => `${x.kind}:${x.id}${x.value ? `=${x.value}` : ''}`), [
    'done:A1', 'skip:S2', 'skip:S3', 'answer:Q1=yes', 'answer:D2=b',
  ]);
  assert.deepEqual(parseUserReplies('A2, S1').map((x) => `${x.kind}:${x.id}`), ['do:A2', 'do:S1']);
  assert.deepEqual(parseUserReplies('please fix the A2 problem'), []);
});

test('parseUserReplies does not swallow sentences or fire on prose verbs (review M2)', () => {
  const r = parseUserReplies('Q1: what does it mean? Also I will do A2 later');
  assert.deepEqual(r.map((x) => `${x.kind}:${x.id}`), ['ref:Q1']);
  assert.deepEqual(parseUserReplies('to do A1 you need a key'), []);
  assert.deepEqual(parseUserReplies('Q1: use v2.1. Then deploy.').map((x) => x.value), ['use v2.1']);
  assert.deepEqual(parseUserReplies(`Q1: ${'x'.repeat(120)}`), []);
});

test('courtesy prefixes, postfix verbs and bare Q/D ids (review 0.1.1 N6, N7)', () => {
  const r = (t) => parseUserReplies(t).map((x) => `${x.kind}:${x.id}`);
  assert.deepEqual(r('please do A2'), ['do:A2']);
  assert.deepEqual(r('ok, do A2 and A3'), ['do:A2', 'do:A3']);
  assert.deepEqual(r('go ahead and do A1'), ['do:A1']);
  assert.deepEqual(r('A1 done'), ['done:A1']);
  assert.deepEqual(r('A1 is done. Q1: yes'), ['done:A1', 'answer:Q1']);
  assert.deepEqual(r('S2, S3 skip'), ['skip:S2', 'skip:S3']);
  assert.deepEqual(r('Q1'), ['ref:Q1']);
  assert.deepEqual(r('A1, D2'), ['do:A1', 'ref:D2']);
  // still prose
  assert.deepEqual(r('to do A1 you need a key'), []);
  assert.deepEqual(r('I will do A2 later'), []);
  assert.deepEqual(r('A1 done by tomorrow would be great'), []);
  assert.deepEqual(r('the A1 done flag is wrong'), []);
});

test('short answers without a colon (live G8)', () => {
  const r = (t) => parseUserReplies(t).map((x) => `${x.kind}:${x.id}=${x.value ?? ''}`);
  assert.deepEqual(r('Q2 ok'), ['answer:Q2=ok']);
  assert.deepEqual(r('D1 b'), ['answer:D1=b']);
  assert.deepEqual(r('Q1 yes, Q2 no'), ['answer:Q1=yes', 'answer:Q2=no']);
  assert.deepEqual(r('Q2 ok, done A3'), ['done:A3=', 'answer:Q2=ok']);
  // still prose
  assert.deepEqual(r('Q2 ok but why'), []);
  assert.deepEqual(r('about Q1 a better option exists'), []);
});

test('parseTags strips known tags only', () => {
  const { text, tags } = parseTags('explain this !verbose !level=c1 !words=40 and !important');
  assert.equal(text, 'explain this and !important');
  assert.deepEqual(tags, { verbose: true, level: 'C1', words: 40 });
  assert.deepEqual(parseTags('run !ls now').tags, {});
});

test('parseTags leaves text untouched, indentation included (review M3)', () => {
  const code = 'fix this:\n    if (x) {\n        y()\n    }';
  assert.equal(parseTags(code).text, code);
  assert.equal(parseTags(`${code}\n!verbose`).text, `${code}\n`);
});
