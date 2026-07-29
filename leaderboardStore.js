const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const LEADERBOARD_KEY_PREFIX = 'alias:leaderboard:';

function isConfigured() {
  return Boolean(REST_URL && REST_TOKEN);
}

function leaderboardKey(chatId) {
  return `${LEADERBOARD_KEY_PREFIX}${String(chatId)}`;
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

function emptyLeaderboard(chatId) {
  return {
    chatId: String(chatId),
    gamesCompleted: 0,
    players: {},
    updatedAt: null,
  };
}

async function getLeaderboard(chatId) {
  const raw = await redis(['GET', leaderboardKey(chatId)]);
  if (!raw) return emptyLeaderboard(chatId);

  try {
    const parsed = JSON.parse(raw);
    return {
      ...emptyLeaderboard(chatId),
      ...parsed,
      players: parsed.players || {},
    };
  } catch (error) {
    throw new Error(`Invalid leaderboard record for group ${chatId}`);
  }
}

async function saveLeaderboard(record) {
  const saved = {
    ...record,
    chatId: String(record.chatId),
    updatedAt: new Date().toISOString(),
  };
  await redis(['SET', leaderboardKey(saved.chatId), JSON.stringify(saved)]);
  return saved;
}

async function recordCompletedGame(chatId, participants, winners) {
  const record = await getLeaderboard(chatId);
  const now = new Date().toISOString();
  const winnerIds = new Set(winners.map((player) => String(player.id)));
  const uniqueParticipants = new Map();

  for (const player of participants) {
    if (!player || player.id == null) continue;
    uniqueParticipants.set(String(player.id), player);
  }

  record.gamesCompleted += 1;

  for (const [userId, player] of uniqueParticipants) {
    const existing = record.players[userId] || {
      userId,
      displayName: player.name || 'שחקן',
      wins: 0,
      gamesPlayed: 0,
      lastWinAt: null,
      updatedAt: null,
    };

    existing.displayName = player.name || existing.displayName || 'שחקן';
    existing.gamesPlayed += 1;
    existing.updatedAt = now;

    if (winnerIds.has(userId)) {
      existing.wins += 1;
      existing.lastWinAt = now;
    }

    record.players[userId] = existing;
  }

  return saveLeaderboard(record);
}

function rankedPlayers(record, limit = 10) {
  return Object.values(record.players || {})
    .filter((player) => Number(player.wins) > 0)
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const aReached = a.lastWinAt || '9999-12-31T23:59:59.999Z';
      const bReached = b.lastWinAt || '9999-12-31T23:59:59.999Z';
      if (aReached !== bReached) return aReached.localeCompare(bReached);
      return String(a.userId).localeCompare(String(b.userId));
    })
    .slice(0, limit);
}

module.exports = {
  isConfigured,
  getLeaderboard,
  recordCompletedGame,
  rankedPlayers,
};
