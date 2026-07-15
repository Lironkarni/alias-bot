const test = require('node:test');
const assert = require('node:assert/strict');

const { WORDS, PREMIUM_EASY_WORDS, MEDIUM_WORDS, HARD_WORDS, getWordPool } = require('./words');

test('each difficulty contains only unique words', () => {
  for (const pool of [WORDS, PREMIUM_EASY_WORDS, MEDIUM_WORDS, HARD_WORDS]) {
    assert.equal(pool.length, new Set(pool).size);
  }
});

test('words do not overlap between difficulty levels', () => {
  const allWords = [...PREMIUM_EASY_WORDS, ...MEDIUM_WORDS, ...HARD_WORDS];
  assert.equal(allWords.length, new Set(allWords).size);
});

test('expanded pools contain a useful amount of content', () => {
  assert.equal(WORDS.length, 500);
  assert.ok(PREMIUM_EASY_WORDS.length > WORDS.length);
  assert.ok(MEDIUM_WORDS.length >= 600);
  assert.ok(HARD_WORDS.length >= 220);
});

test('free groups get exactly 500 easy words while premium gets the expanded easy pool', () => {
  assert.equal(getWordPool('easy', false), WORDS);
  assert.equal(getWordPool('easy', true), PREMIUM_EASY_WORDS);
  assert.equal(getWordPool('medium', true), MEDIUM_WORDS);
  assert.equal(getWordPool('hard', true), HARD_WORDS);
});

test('requested batch is assigned to medium without duplicating basic words', () => {
  for (const word of ['אולר', 'אקרובטיקה', 'ארכיטקטורה', 'גאווה', 'דיאלוג', 'השראה', 'יוגה', 'מאזניים']) {
    assert.ok(MEDIUM_WORDS.includes(word), `missing medium word: ${word}`);
  }

  for (const duplicate of ['אופניים', 'אמבולנס', 'בקבוק', 'גשר', 'כלב', 'כיסא']) {
    assert.ok(!MEDIUM_WORDS.includes(duplicate), `duplicate leaked into medium: ${duplicate}`);
  }
});

test('new no-obvious-opposite words are available only in premium pools', () => {
  for (const word of ['חמסה', 'חצוצרה', 'כינור', 'צוללת']) {
    assert.ok(PREMIUM_EASY_WORDS.includes(word), `missing premium easy word: ${word}`);
    assert.ok(!WORDS.includes(word), `premium easy word leaked into free pool: ${word}`);
  }

  for (const word of ['בומרנג', 'דיבוב', 'הולוגרמה', 'היפנוזה', 'טלפתיה', 'רובוטיקה']) {
    assert.ok(MEDIUM_WORDS.includes(word), `missing premium medium word: ${word}`);
  }

  for (const word of ['אבסורד', 'אפקט פלסבו', 'פרדוקס', 'תורת הכאוס', 'קניין רוחני']) {
    assert.ok(HARD_WORDS.includes(word), `missing premium hard word: ${word}`);
  }
});
