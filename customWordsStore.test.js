const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWord, MAX_WORDS, MIN_PLAY_WORDS } = require('./customWordsStore');

test('custom word limits are configured', () => {
  assert.equal(MAX_WORDS, 500);
  assert.equal(MIN_PLAY_WORDS, 60);
});

test('accepts normal Hebrew words and phrases', () => {
  assert.deepEqual(validateWord('  יום   הולדת  '), { ok: true, word: 'יום הולדת' });
  assert.equal(validateWord('כוס').ok, true);
  assert.equal(validateWord('ערוץ 12').ok, true);
});

test('rejects invalid custom words', () => {
  assert.equal(validateWord('א').ok, false);
  assert.equal(validateWord('א'.repeat(31)).ok, false);
  assert.equal(validateWord('כלב 🐶').ok, false);
  assert.equal(validateWord('שלום!!!').ok, false);
  assert.equal(validateWord('fuck').ok, false);
});
