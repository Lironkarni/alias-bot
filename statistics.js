const personalPremiumStore = require('./personalPremiumStore');
const personalStatisticsStore = require('./personalStatisticsStore');
const { validateInitData } = require('./telegramAuth');

function fireAndForget(promise, label) {
  Promise.resolve(promise).catch((error) => console.error(label, error));
}

function statisticsKeyboard(publicUrl) {
  return {
    inline_keyboard: [[{
      text: '📊 פתח את הסטטיסטיקות שלי',
      web_app: { url: `${publicUrl.replace(/\/$/, '')}/statistics.html` },
    }]],
  };
}

function registerStatisticsHandlers(bot, { publicUrl }) {
  bot.command(['statistics', 'stats'], async (ctx) => {
    if (!publicUrl) return ctx.reply('מסך הסטטיסטיקות אינו זמין כרגע.');

    try {
      const subscription = await personalPremiumStore.getSubscriptionStatus(ctx.from.id);
      if (!subscription.isPremium) {
        return ctx.reply('📊 הסטטיסטיקות האישיות זמינות למשתמשי פרימיום אישי בלבד.');
      }

      if (ctx.chat.type === 'private') {
        return ctx.reply('📊 הסטטיסטיקות האישיות שלך', {
          reply_markup: statisticsKeyboard(publicUrl),
        });
      }

      try {
        await ctx.telegram.sendMessage(ctx.from.id, '📊 הסטטיסטיקות האישיות שלך', {
          reply_markup: statisticsKeyboard(publicUrl),
        });
        return ctx.reply('📩 שלחתי לך את הסטטיסטיקות האישיות בפרטי.');
      } catch (error) {
        return ctx.reply('כדי לפתוח את הסטטיסטיקות, היכנס קודם לבוט בפרטי ולחץ על Start.');
      }
    } catch (error) {
      console.error('Failed to open personal statistics:', error);
      return ctx.reply('לא הצלחתי לפתוח את הסטטיסטיקות כרגע. נסו שוב מאוחר יותר.');
    }
  });
}

function registerStatisticsApi(app, { botToken }) {
  app.post('/api/statistics', async (req, res) => {
    try {
      const auth = validateInitData(req.body && req.body.initData, botToken);
      if (!auth || !auth.user) return res.status(401).json({ error: 'auth_failed' });

      const subscription = await personalPremiumStore.getSubscriptionStatus(auth.user.id);
      if (!subscription.isPremium) return res.status(403).json({ error: 'personal_premium_required' });
      if (!personalStatisticsStore.isConfigured()) return res.status(503).json({ error: 'statistics_unavailable' });

      const statistics = await personalStatisticsStore.getStatistics(auth.user.id);
      return res.json({ ok: true, statistics });
    } catch (error) {
      console.error('Failed to load personal statistics API:', error);
      return res.status(500).json({ error: 'server_error' });
    }
  });
}

function installPersonalStatisticsTracking(gameManager) {
  const originalCorrect = gameManager.handleCorrect.bind(gameManager);
  gameManager.handleCorrect = (game) => {
    const event = game && game.turnActive && game.currentPlayer && game.currentWord
      ? { userId: game.currentPlayer.id, difficulty: game.difficulty, word: game.currentWord }
      : null;
    const result = originalCorrect(game);
    if (result && event) {
      fireAndForget(
        personalStatisticsStore.recordWordResult(event.userId, event.difficulty, event.word, 'correct'),
        'Failed to record successful word:'
      );
    }
    return result;
  };

  const originalSkip = gameManager.handleSkip.bind(gameManager);
  gameManager.handleSkip = (game) => {
    const event = game && game.turnActive && game.currentPlayer && game.currentWord
      ? { userId: game.currentPlayer.id, difficulty: game.difficulty, word: game.currentWord }
      : null;
    const result = originalSkip(game);
    if (result && event) {
      fireAndForget(
        personalStatisticsStore.recordWordResult(event.userId, event.difficulty, event.word, 'skipped'),
        'Failed to record skipped word:'
      );
    }
    return result;
  };

  const originalConcludeTurn = gameManager._concludeTurn.bind(gameManager);
  gameManager._concludeTurn = async (chatId, reason) => {
    const game = gameManager.getGame(chatId);
    const event = game && game.turnActive && game.currentTurnToken && game.currentPlayer && game.currentWord
      ? { userId: game.currentPlayer.id, difficulty: game.difficulty, word: game.currentWord }
      : null;
    const result = await originalConcludeTurn(chatId, reason);
    if (event) {
      fireAndForget(
        personalStatisticsStore.recordWordResult(event.userId, event.difficulty, event.word, 'incomplete'),
        'Failed to record unfinished word:'
      );
    }
    return result;
  };

  const originalCloseGame = gameManager.closeGame.bind(gameManager);
  gameManager.closeGame = (chatId, requesterId, options) => {
    const game = gameManager.getGame(chatId);
    const event = game && game.turnActive && game.currentPlayer && game.currentWord
      ? { userId: game.currentPlayer.id, difficulty: game.difficulty, word: game.currentWord }
      : null;
    const result = originalCloseGame(chatId, requesterId, options);
    if (result && result.ok && event) {
      fireAndForget(
        personalStatisticsStore.recordWordResult(event.userId, event.difficulty, event.word, 'incomplete'),
        'Failed to record unfinished word after closing game:'
      );
    }
    return result;
  };

  const originalFinishGame = gameManager._finishGame.bind(gameManager);
  gameManager._finishGame = async (game, winner) => {
    const winningTeam = winner === 1 ? game.team1 : game.team2;
    if (personalStatisticsStore.isConfigured()) {
      try {
        await personalStatisticsStore.recordCompletedGame(game.players, winningTeam);
      } catch (error) {
        console.error('Failed to update personal game statistics:', error);
      }
    }
    return originalFinishGame(game, winner);
  };
}

module.exports = {
  registerStatisticsHandlers,
  registerStatisticsApi,
  installPersonalStatisticsTracking,
};