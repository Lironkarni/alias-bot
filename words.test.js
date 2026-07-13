const test = require('node:test');
const assert = require('node:assert/strict');

const { WORDS, MEDIUM_WORDS, HARD_WORDS } = require('./words');

test('each difficulty contains only unique words', () => {
  for (const pool of [WORDS, MEDIUM_WORDS, HARD_WORDS]) {
    assert.equal(pool.length, new Set(pool).size);
  }
});

test('words do not overlap between difficulty levels', () => {
  const allWords = [...WORDS, ...MEDIUM_WORDS, ...HARD_WORDS];
  assert.equal(allWords.length, new Set(allWords).size);
});

test('expanded pools contain a useful amount of content', () => {
  assert.ok(WORDS.length >= 600);
  assert.ok(MEDIUM_WORDS.length >= 550);
  assert.ok(HARD_WORDS.length >= 165);
});

test('requested batch is assigned to medium without duplicating basic words', () => {
  for (const word of ['אולר', 'אקרובטיקה', 'ארכיטקטורה', 'גאווה', 'דיאלוג', 'השראה', 'יוגה', 'מאזניים']) {
    assert.ok(MEDIUM_WORDS.includes(word), `missing medium word: ${word}`);
  }

  for (const duplicate of ['אופניים', 'אמבולנס', 'בקבוק', 'גשר', 'כלב', 'כיסא']) {
    assert.ok(!MEDIUM_WORDS.includes(duplicate), `duplicate leaked into medium: ${duplicate}`);
  }
});
