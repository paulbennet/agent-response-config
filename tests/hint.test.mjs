import assert from 'node:assert/strict';
import test from 'node:test';
import { deepMerge, loadDefaults, validate } from '../skills/response-config/scripts/lib/config.mjs';
import { emptyLedger } from '../skills/response-config/scripts/lib/core.mjs';
import { renderDigest, renderPromptHint, renderRules } from '../skills/response-config/scripts/lib/hint.mjs';

const cfg = (over = {}) => deepMerge(loadDefaults(), over);
const budget = (c) => Number(renderRules(c).match(/at most (\d+) words/)[1]);

test('each brevity level has its own default budget', () => {
  const n = ['low', 'medium', 'high', 'extreme'].map((level) => budget(cfg({ minimal: { level } })));
  assert.deepEqual(n, [150, 110, 80, 40]);
  assert.match(renderDigest(cfg({ minimal: { level: 'low' } })), /at most 150 prose words/);
});

test('an explicit maxWords wins over the level default', () => {
  assert.equal(budget(cfg({ minimal: { level: 'low', maxWords: 60 } })), 60);
  assert.deepEqual(validate({ minimal: { maxWords: null } }), []);
  assert.equal(validate({ minimal: { maxWords: 5 } }).length, 1);
});

test('a tight budget forbids unasked suggestions and questions', () => {
  const unasked = /Add no suggestions or questions the user did not ask for/;
  assert.match(renderRules(cfg({ minimal: { maxWords: 30 } })), unasked);
  assert.match(renderRules(cfg({ minimal: { level: 'extreme' } })), unasked);
  assert.doesNotMatch(renderRules(cfg()), unasked);
  assert.match(renderRules(cfg({ minimal: { maxWords: 30 } })), /30 words is a hard cap/);
  assert.match(renderDigest(cfg({ minimal: { maxWords: 30 } })), /at most 30 prose words with the items \(hard cap/);
  assert.doesNotMatch(renderDigest(cfg()), /hard cap/);
  assert.doesNotMatch(renderRules(cfg({ minimal: { maxWords: 30 }, structured: { on: false } })), /Add no/);
  assert.match(renderRules(cfg({ minimal: { maxWords: 30 }, structured: { sections: ['actions', 'questions'] } })), /Add no questions the user/);
});

test('choices go under Decisions; errors are quoted verbatim', () => {
  assert.match(renderRules(cfg()), /choice is theirs to make, put it under Decisions/);
  assert.doesNotMatch(renderRules(cfg({ structured: { sections: ['actions', 'questions'] } })), /under Decisions/);
  assert.match(renderRules(cfg()), /failing test output verbatim in a code block/);
});

test('Next IDs offers only the configured section types', () => {
  const c = cfg({ structured: { sections: ['actions', 'questions'] } });
  assert.match(renderPromptHint(c, emptyLedger('claude', 's')), /Next IDs: A1 Q1$/m);
  assert.match(renderPromptHint(cfg(), emptyLedger('claude', 's')), /Next IDs: A1 S1 Q1 D1$/m);
});
