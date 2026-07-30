const fs = require('fs');
const path = require('path');

const wordsPath = path.join(__dirname, '..', 'words.js');
const {
  WORDS,
  PREMIUM_EASY_WORDS,
  MEDIUM_WORDS,
  HARD_WORDS,
} = require(wordsPath);

function quote(word) {
  return `'${String(word).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function formatArray(name, words) {
  const perLine = 8;
  const lines = [];

  for (let i = 0; i < words.length; i += perLine) {
    lines.push(`  ${words.slice(i, i + perLine).map(quote).join(', ')},`);
  }

  return `const ${name} = [\n${lines.join('\n')}\n];`;
}

const premiumEasyExtraWords = PREMIUM_EASY_WORDS.slice(WORDS.length);

const output = `// מאגר המילים החינמי: בדיוק 500 מילים קלות\n${formatArray('WORDS', WORDS)}\n\n// השלמת המאגר הקל לקבוצות פרימיום: עוד 500 מילים\n${formatArray('PREMIUM_EASY_EXTRA_WORDS', premiumEasyExtraWords)}\n\n// מאגר מילים בינוניות לקבוצות פרימיום: בדיוק 1,000 מילים\n${formatArray('MEDIUM_WORDS', MEDIUM_WORDS)}\n\n// מאגר מילים קשות לקבוצות פרימיום: בדיוק 500 מילים\n${formatArray('HARD_WORDS', HARD_WORDS)}\n\nconst FREE_WORD_LIMIT = WORDS.length;\nconst PREMIUM_EASY_WORDS = [...WORDS, ...PREMIUM_EASY_EXTRA_WORDS];\n\nconst DIFFICULTY_LABELS = {\n  easy: 'קל',\n  medium: 'בינוני',\n  hard: 'קשה',\n};\n\nconst DIFFICULTY_ORDER = ['easy', 'medium', 'hard'];\n\nfunction getWordPool(difficulty, isPremium = false) {\n  if (difficulty === 'medium') return MEDIUM_WORDS;\n  if (difficulty === 'hard') return HARD_WORDS;\n  return isPremium ? PREMIUM_EASY_WORDS : WORDS;\n}\n\nfunction nextDifficulty(current) {\n  const idx = DIFFICULTY_ORDER.indexOf(current);\n  return DIFFICULTY_ORDER[(idx + 1) % DIFFICULTY_ORDER.length];\n}\n\nmodule.exports = {\n  WORDS,\n  PREMIUM_EASY_EXTRA_WORDS,\n  PREMIUM_EASY_WORDS,\n  MEDIUM_WORDS,\n  HARD_WORDS,\n  FREE_WORD_LIMIT,\n  DIFFICULTY_LABELS,\n  DIFFICULTY_ORDER,\n  getWordPool,\n  nextDifficulty,\n};\n`;

fs.writeFileSync(wordsPath, output, 'utf8');
console.log('Flattened word pools:', {
  freeEasy: WORDS.length,
  premiumEasyExtra: premiumEasyExtraWords.length,
  premiumEasyTotal: PREMIUM_EASY_WORDS.length,
  medium: MEDIUM_WORDS.length,
  hard: HARD_WORDS.length,
});
