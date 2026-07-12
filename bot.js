function registerBotHandlers(bot, gameManager) {
  bot.command('start', async (ctx) => {
    if (!['group', 'supergroup'].includes(ctx.chat.type)) {
      return ctx.reply('צריך להריץ את המשחק בתוך קבוצה, לא בצ׳אט פרטי.');
    }

    const chatId = ctx.chat.id;
    const existing = gameManager.getGame(chatId);
    if (existing && existing.status !== 'finished') {
      return ctx.reply('כבר יש משחק פעיל בקבוצה הזו. אפשר לחכות שיסתיים.');
    }

    const game = gameManager.createGame(chatId, ctx.from);
    const sent = await ctx.reply(gameManager.lobbyText(game), {
      reply_markup: gameManager.lobbyKeyboard(),
    });
    game.lobbyMessageId = sent.message_id;
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
        reply_markup: gameManager.lobbyKeyboard(),
      });
    } catch (e) {
      // עריכה יכולה להיכשל אם הטקסט זהה - לא נורא
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
}

module.exports = registerBotHandlers;
