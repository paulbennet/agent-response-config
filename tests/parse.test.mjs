import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAssistantItems, parseTags, parseUserReplies, stripFences,
} from '../skills/response-config/scripts/lib/parse.mjs';

test('parseAssistantItems reads bullets and plain IDs, ignores code fences', () => {
  const text = ['Done.', 'Actions', '- A1 Run tests', '* **Q2:** Keep flag? (yes/no)', '3. D1 Pick (a) x (b) y', '```', '- A9 inside code', '```', 'S4 bare line'].join('\n');
  const items = parseAssistantItems(text);
  assert.deepEqual(items.map((i) => `${i.type}${i.n}`), ['A1', 'Q2', 'D1', 'S4']);
  assert.equal(items[1].text, 'Keep flag? (yes/no)');
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

test('parseTags strips known tags only', () => {
  const { text, tags } = parseTags('explain this !verbose !level=c1 !words=40 and !important');
  assert.equal(text, 'explain this and !important');
  assert.deepEqual(tags, { verbose: true, level: 'C1', words: 40 });
  assert.deepEqual(parseTags('run !ls now').tags, {});
});
