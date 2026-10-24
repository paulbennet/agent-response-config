import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAssistantItems, parseTags, parseUserReplies, stripFences,
} from '../skills/response-config/scripts/lib/parse.mjs';

const ids = (items) => items.map((i) => `${i.type}${i.n}${i.close ? `:${i.close}` : ''}`);

test('parseAssistantItems reads list items and ignores code fences', () => {
  const text = ['Done.', '- A1 Run tests', '* **Q2:** Keep flag? (yes/no)', '3. D1 Pick (a) x (b) y', '```', '- A9 inside code', '```'].join('\n');
  const items = parseAssistantItems(text);
  assert.deepEqual(ids(items), ['A1', 'Q2', 'D1']);
  assert.equal(items[1].text, 'Keep flag? (yes/no)');
});

test('parseAssistantItems accepts bare IDs only under a section heading', () => {
  const text = ['Actions', 'A1 Run tests', 'A2 Lint', '', 'Some prose.', 'S4 not an item here'].join('\n');
  assert.deepEqual(ids(parseAssistantItems(text)), ['A1', 'A2']);
  assert.deepEqual(ids(parseAssistantItems('**Questions:**\nQ3 Keep it? (yes/no)')), ['Q3']);
});

test('parseAssistantItems ignores prose and table rows that start with an ID-like token (review M1)', () => {
  const text = ['Q3 2026 revenue grew.', 'A4 paper is standard.', 'S3 bucket is public.', '| D1 | cell |'].join('\n');
  assert.deepEqual(parseAssistantItems(text), []);
});

test('parseAssistantItems reads closing lines (review M5)', () => {
  const text = ['- A2 done', '- Q1 (answered)', 'Resolved: S1, D2'].join('\n');
  assert.deepEqual(ids(parseAssistantItems(text)), ['A2:done', 'Q1:answered', 'S1:done', 'D2:done']);
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
