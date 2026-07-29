const leaderboardStore = require('./leaderboardStore');

function formatPlayerName(player) {
  // בעתיד ניתן להוסיף כאן עיצוב מיוחד למשתמשי פרימיום אישיים.
  return player.displayName || 'שחקן';
}

function formatWins(count) {
  return count === 1 ? 'ניצחון אחד' : `${count} ניצחונות`;
}

function medalForPosition(position) {
  if (position === 1) return '🥇';
  if (position === 2) return '🥈';
  if (position === 3) return '🥉';
  return `${position}.`;
}

function registerLeaderboardHandlers(bot) {
  bot.command('leaderboard', async (ctx) => {
    if (!['group', 'supergroup'].includes(ctx.chat.type)) {
      return ctx.reply('את לוח הניצחונות ניתן להציג רק בתוך קבוצה.');
    }

    if (!leaderboardStore.isConfigured()) {
      return ctx.reply('לוח הניצחונות אינו זמין כרגע.');
    }

    try {
      const record = await leaderboardStore.getLeaderboard(ctx.chat.id);
      const topPlayers = leaderboardStore.rankedPlayers(record, 10);
      const requester = record.players[String(ctx.from.id)];
      const requesterWins = requester ? Number(requester.wins) || 0 : 0;
      const lines = ['🏆 לוח הניצחונות של הקבוצה', ''];

      if (topPlayers.length === 0) {
        lines.push('עדיין אין ניצחונות בקבוצה.');
      } else {
        topPlayers.forEach((player, index) => {
          const position = index + 1;
          lines.push(`${medalForPosition(position)} ${formatPlayerName(player)} — ${formatWins(player.wins)}`);
        });
      }

      lines.push('');
      lines.push(`🎮 משחקים ששוחקו בקבוצה: ${record.gamesCompleted || 0}`);
      lines.push(`👤 הניצחונות שלך: ${requesterWins}`);

      return ctx.reply(lines.join('\n'));
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
      return ctx.reply('לא הצלחתי לטעון את לוח הניצחונות כרגע. נסו שוב מאוחר יותר.');
    }
  });
}

function installCompletedGameTracking(gameManager) {
  const originalFinishGame = gameManager._finishGame.bind(gameManager);

  gameManager._finishGame = async (game, winner) => {
    const winningTeam = winner === 1 ? game.team1 : game.team2;

    if (leaderboardStore.isConfigured()) {
      try {
        await leaderboardStore.recordCompletedGame(game.chatId, game.players, winningTeam);
      } catch (error) {
        // תקלה בסטטיסטיקות לא צריכה למנוע את סיום המשחק או הכרזת המנצח.
        console.error('Failed to update leaderboard after completed game:', error);
      }
    }

    return originalFinishGame(game, winner);
  };
}

module.exports = {
  registerLeaderboardHandlers,
  installCompletedGameTracking,
  formatPlayerName,
};
