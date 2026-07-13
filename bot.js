const { DIFFICULTY_LABELS } = require('./words');
const subscriptionStore = require('./subscriptionStore');

function registerBotHandlers(bot, gameManager) {
  bot.command('start', async (ctx) => {
    if (!['group', 'supergroup'].includes(ctx.chat.type)) {
      return ctx.reply('צריך להריץ את המשחק בתוך קבוצה, לא בצ׳אט פרטי.');
    }

    const chatId = ctx.chat.id;

    if (subscriptionStore.isConfigured()) {
      try {
        await subscriptionStore.ensureGroup(ctx.chat);
      } catch (error) {
        console.error('Failed to save group in Redis:', error);
      }
    }

    const existing = gameManager.getGame(chatId);
    if (existing && existing.status !== 'finished') {
      return ctx.reply('כבר יש משחק פעיל בקבוצה הזו. אפשר לסגור אותו עם /endgame (מנהל המשחק) או לחכות שיסתיים.');
    }

    const game = gameManager.createGame(chatId, ctx.from);
    const sent = await ctx.reply(gameManager.lobbyText(game), {
      reply_markup: gameManager.lobbyKeyboard(game),
    });
    game.lobbyMessageId = sent.message_id;
  });

  bot.command('endgame', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = gameManager.getGame(chatId);
    if (!game) return ctx.reply('אין משחק פעיל כרגע.');

    const result = gameManager.closeGame(chatId, ctx.from.id);
    if (result.error === 'not_host') {
      return ctx.reply('רק מי ששלח /start (מנהל המשחק) יכול לסגור את המשחק.');
    }
    return ctx.reply('🛑 המשחק הופסק ע"י מנהל המשחק. כדי להתחיל משחק חדש שלחו /start.');
  });

  bot.command('subscription', async (ctx) => {
    if (!['group', 'supergroup'].includes(ctx.chat.type)) {
      return ctx.reply('את מצב המנוי ניתן לבדוק מתוך הקבוצה.');
    }

    if (!subscriptionStore.isConfigured()) {
      return ctx.reply('בסיס הנתונים עדיין לא הוגדר בשרת.');
    }

    try {
      await subscriptionStore.ensureGroup(ctx.chat);
      const status = await subscriptionStore.getSubscriptionStatus(ctx.chat.id);

      if (!status.isPremium) {
        return ctx.reply('🆓 הקבוצה משתמשת כרגע בגרסה החינמית.');
      }

      const expiry = new Intl.DateTimeFormat('he-IL', {
        timeZone: 'Asia/Jerusalem',
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(status.expiresAt);

      return ctx.reply(`⭐ לקבוצה יש מנוי פרימיום פעיל עד ${expiry}.`);
    } catch (error) {
      console.error('Failed to read subscription from Redis:', error);
      return ctx.reply('לא הצלחנו לבדוק את מצב המנוי כרגע. נסו שוב מאוחר יותר.');
    }
  });

  bot.command('players', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = gameManager.getGame(chatId);
    if (!game) return ctx.reply('אין משחק פעיל כרגע.');

    const keyboard = gameManager.playersKeyboard(game);
    return ctx.reply(gameManager.playersListText(game), {
      reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined,
    });
  });

  bot.command('join', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = gameManager.getGame(chatId);
    if (!game) return ctx.reply('אין משחק פעיל כרגע. אפשר להתחיל אחד עם /start.');

    const result = gameManager.joinMidGame(chatId, ctx.from);
    if (result.error === 'already_joined') return ctx.reply('כבר הצטרפת למשחק! 🙂');
    if (result.error) return ctx.reply('לא ניתן להצטרף כרגע.');

    if (result.phase === 'lobby') {
      try {
        await ctx.telegram.editMessageText(chatId, game.lobbyMessageId, undefined, gameManager.lobbyText(game), {
          reply_markup: gameManager.lobbyKeyboard(game),
        });
      } catch (e) {
        // אפשר להתעלם אם העריכה נכשלת
      }
      return;
    }

    const teamEmoji = result.team === 1 ? '🔵' : '🔴';
    return ctx.reply(`✋ ${teamEmoji} ${ctx.from.first_name || 'שחקן'} הצטרף/ה למשחק ותשתתף בקבוצה ${result.team} מהתור הבא שלה!`);
  });

  bot.action('join', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = gameManager.getGame(chatId);
    if (!game || game.status !== 'lobby') {
      return ctx.answerCbQuery('אין לובי פעיל כרגע.', { show_alert: true });
    }

    gameManager.addPlayer(chatId, ctx.from);
    await ctx.answerCbQuery('הצטרפת למשחק!');

    try {
      await ctx.telegram.editMessageText(chatId, game.lobbyMessageId, undefined, gameManager.lobbyText(game), {
        reply_markup: gameManager.lobbyKeyboard(game),
      });
    } catch (e) {
      // עריכה יכולה להיכשל אם הטקסט זהה - לא נורא
    }
  });

  bot.action('cycle_difficulty', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = gameManager.getGame(chatId);
    if (!game || game.status !== 'lobby') {
      return ctx.answerCbQuery('אי אפשר לשנות קושי כרגע.', { show_alert: true });
    }

    const result = gameManager.cycleDifficulty(chatId, ctx.from.id);
    if (result.error === 'not_host') {
      return ctx.answerCbQuery('רק מנהל המשחק יכול לשנות את רמת הקושי.', { show_alert: true });
    }

    await ctx.answerCbQuery(`רמת קושי: ${DIFFICULTY_LABELS[result.game.difficulty]}`);
    try {
      await ctx.telegram.editMessageText(chatId, game.lobbyMessageId, undefined, gameManager.lobbyText(game), {
        reply_markup: gameManager.lobbyKeyboard(game),
      });
    } catch (e) {
      // לא נורא
    }
  });

  bot.action('start_game', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = gameManager.getGame(chatId);
    if (!game || game.status !== 'lobby') {
      return ctx.answerCbQuery('אין לובי פעיל כרגע.', { show_alert: true });
    }

    if (ctx.from.id !== game.hostId) {
      return ctx.answerCbQuery('רק מי ששלח /start יכול להתחיל את המשחק.', { show_alert: true });
    }

    const result = gameManager.startGame(chatId);
    if (result.error === 'not_enough_players') {
      return ctx.answerCbQuery('צריך לפחות 4 משתתפים כדי להתחיל.', { show_alert: true });
    }
    if (result.error) {
      return ctx.answerCbQuery('לא ניתן להתחיל כרגע.', { show_alert: true });
    }

    await ctx.answerCbQuery('המשחק מתחיל!');
    try {
      await ctx.telegram.editMessageText(chatId, game.lobbyMessageId, undefined, gameManager.teamsText(game));
    } catch (e) {
      await ctx.reply(gameManager.teamsText(game));
    }

    await gameManager.startTurn(chatId);
  });

  bot.action('skip_turn', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = gameManager.getGame(chatId);
    if (!game || game.status !== 'playing') {
      return ctx.answerCbQuery('אין תור פעיל כרגע.', { show_alert: true });
    }
    if (ctx.from.id !== game.hostId) {
      return ctx.answerCbQuery('רק מנהל המשחק יכול לדלג על תור.', { show_alert: true });
    }
    if (!game.currentTurnToken) {
      return ctx.answerCbQuery('התור כבר הסתיים.', { show_alert: true });
    }

    await ctx.answerCbQuery('התור דולג.');
    await gameManager.forceEndTurnByHost(chatId);
  });

  bot.action(/^remove_player:(\d+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const game = gameManager.getGame(chatId);
    if (!game) return ctx.answerCbQuery('אין משחק פעיל כרגע.', { show_alert: true });

    const targetId = parseInt(ctx.match[1], 10);
    const result = gameManager.removePlayer(chatId, targetId, ctx.from.id);

    if (result.error === 'not_host') {
      return ctx.answerCbQuery('רק מנהל המשחק יכול להסיר שחקנים.', { show_alert: true });
    }
    if (result.error === 'not_found') {
      return ctx.answerCbQuery('השחקן כבר לא ברשימה.', { show_alert: true });
    }
    if (result.error) {
      return ctx.answerCbQuery('לא ניתן להסיר כרגע.', { show_alert: true });
    }

    await ctx.answerCbQuery('השחקן הוסר.');

    try {
      const keyboard = gameManager.playersKeyboard(game);
      await ctx.editMessageText(gameManager.playersListText(game), {
        reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined,
      });
    } catch (e) {
      // לא נורא
    }

    if (game.status === 'lobby') {
      try {
        await ctx.telegram.editMessageText(chatId, game.lobbyMessageId, undefined, gameManager.lobbyText(game), {
          reply_markup: gameManager.lobbyKeyboard(game),
        });
      } catch (e) {
        // לא נורא
      }
    }

    if (result.wasCurrent) {
      await ctx.telegram.sendMessage(chatId, '⏭ השחקן שהיה בתור הוסר מהמשחק - עוברים לתור הבא.');
      await gameManager.forceEndTurnByHost(chatId);
    }
  });
}

module.exports = registerBotHandlers;
