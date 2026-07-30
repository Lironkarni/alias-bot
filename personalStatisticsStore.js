const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const SUMMARY_PREFIX = 'alias:personal-stats:summary:';
const WORDS_PREFIX = 'alias:personal-stats:words:';

function isConfigured() {
  return Boolean(REST_URL && REST_TOKEN);
}

async function redis(command) {
  if (!isConfigured()) throw new Error('Upstash Redis is not configured');
  const response = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Upstash Redis request failed (${response.status})`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Upstash Redis error: ${payload.error}`);
  return payload.result;
}

function summaryKey(userId) {
  return `${SUMMARY_PREFIX}${String(userId)}`;
}

function wordsKey(userId, result, difficulty) {
  return `${WORDS_PREFIX}${String(userId)}:${result}:${difficulty}`;
}

async function recordWordResult(userId, difficulty, word, result) {
  if (!isConfigured() || !userId || !word) return;
  if (!['correct', 'skipped', 'incomplete'].includes(result)) return;

  const key = summaryKey(userId);
  await redis(['HINCRBY', key, 'revealedWords', 1]);
  const field = result === 'correct' ? 'successfulWords' : result === 'skipped' ? 'skippedWords' : 'unfinishedWords';
  await redis(['HINCRBY', key, field, 1]);

  if (result === 'correct' || result === 'skipped') {
    await redis(['HINCRBY', wordsKey(userId, result, difficulty), word, 1]);
  }
}

async function recordCompletedGame(participants, winners) {
  if (!isConfigured()) return;
  const winnerIds = new Set((winners || []).map((player) => String(player.id)));
  const unique = new Set();

  for (const player of participants || []) {
    if (!player || player.id == null) continue;
    const userId = String(player.id);
    if (unique.has(userId)) continue;
    unique.add(userId);
    await redis(['HINCRBY', summaryKey(userId), 'gamesPlayed', 1]);
    if (winnerIds.has(userId)) await redis(['HINCRBY', summaryKey(userId), 'wins', 1]);
  }
}

function pairsToWordList(raw) {
  if (!Array.isArray(raw)) return [];
  const result = [];
  for (let i = 0; i < raw.length; i += 2) {
    result.push({ word: raw[i], count: Number(raw[i + 1]) || 0 });
  }
  return result.sort((a, b) => a.word.localeCompare(b.word, 'he'));
}

async function readHash(key) {
  return (await redis(['HGETALL', key])) || [];
}

function hashPairsToObject(raw) {
  const obj = {};
  for (let i = 0; i < raw.length; i += 2) obj[raw[i]] = Number(raw[i + 1]) || 0;
  return obj;
}

async function getStatistics(userId) {
  const summary = hashPairsToObject(await readHash(summaryKey(userId)));
  const difficulties = ['easy', 'medium', 'hard'];
  const successfulWords = {};
  const skippedWords = {};

  for (const difficulty of difficulties) {
    successfulWords[difficulty] = pairsToWordList(await readHash(wordsKey(userId, 'correct', difficulty)));
    skippedWords[difficulty] = pairsToWordList(await readHash(wordsKey(userId, 'skipped', difficulty)));
  }

  const revealedWords = summary.revealedWords || 0;
  const successfulCount = summary.successfulWords || 0;
  const gamesPlayed = summary.gamesPlayed || 0;
  const wins = summary.wins || 0;

  return {
    summary: {
      revealedWords,
      successfulWords: successfulCount,
      skippedWords: summary.skippedWords || 0,
      unfinishedWords: summary.unfinishedWords || 0,
      wordSuccessRate: revealedWords ? Number(((successfulCount / revealedWords) * 100).toFixed(1)) : 0,
      gamesPlayed,
      wins,
      winRate: gamesPlayed ? Number(((wins / gamesPlayed) * 100).toFixed(1)) : 0,
    },
    successfulWords,
    skippedWords,
  };
}

module.exports = {
  isConfigured,
  recordWordResult,
  recordCompletedGame,
  getStatistics,
};