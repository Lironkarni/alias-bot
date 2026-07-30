const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORDS,
  PREMIUM_EASY_WORDS,
  MEDIUM_WORDS,
  HARD_WORDS,
  getWordPool,
} = require('./words');

const pools = {
  freeEasy: WORDS,
  premiumEasy: PREMIUM_EASY_WORDS,
  medium: MEDIUM_WORDS,
  hard: HARD_WORDS,
};

test('word pools have the expected sizes', () => {
  assert.equal(pools.freeEasy.length, 500);
  assert.equal(pools.premiumEasy.length, 1000);
  assert.equal(pools.medium.length, 1000);
  assert.equal(pools.hard.length, 500);
});

test('every word pool contains only unique values', () => {
  for (const [name, pool] of Object.entries(pools)) {
    assert.equal(pool.length, new Set(pool).size, `${name} contains duplicates`);
  }
});

test('difficulty pools do not overlap', () => {
  const allPremiumWords = [
    ...pools.premiumEasy,
    ...pools.medium,
    ...pools.hard,
  ];

  assert.equal(allPremiumWords.length, 2500);
  assert.equal(new Set(allPremiumWords).size, 2500);
});

test('free easy pool is the first 500 words of the premium easy pool', () => {
  assert.deepEqual(pools.premiumEasy.slice(0, 500), pools.freeEasy);
});

test('getWordPool returns the correct pool', () => {
  assert.equal(getWordPool('easy', false), pools.freeEasy);
  assert.equal(getWordPool('easy', true), pools.premiumEasy);
  assert.equal(getWordPool('medium', true), pools.medium);
  assert.equal(getWordPool('hard', true), pools.hard);
});
