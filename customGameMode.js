const personalPremiumStore = require('./personalPremiumStore');
const customWordsStore = require('./customWordsStore');

function baseDisplayName(user) {
  if (user.username) return user.first_name ? `${user.first_name} (@${user.username})` : `@${user.username}`;
  return user.first_name || 'שחקן';
}

async function premiumHost(user) {
  const status = await personalPremiumStore.getSubscriptionStatus(user.id);
  if (!status.isPremium) return null;
  return { ...user, first_name: `🌟 ${baseDisplayName(user)} 🌟`, username: undefined, isPersonalPremium: true };
}

function installCustomGameMode(gameManager) {
  const originalPickWord = gameManager._pickWord.bind(gameManager);
  gameManager._pickWord = (game) => {
    if (game.wordMode !== 'custom') return originalPickWord(game);
    const pool = game.customWords || [];
    const available = pool.filter((word) => !game.usedWords.has(word));
    const source = available.length ? available : pool;
    if (!available.length) game.usedWords.clear();
    const word = source[Math.floor(Math.random() * source.length)];
    game.usedWords.add(word);
    return word;
  };

  const originalLobbyText = gameManager.lobbyText.bind(gameManager);
  gameManager.lobbyText = (game) => {
    const text = originalLobbyText(game);
    if (game.wordMode !== 'custom') return text;
    return text.replace('🎯 רמת קושי: קל', `📋 מצב משחק: מילים בהתאמה אישית\n📚 ${game.customWords.length} מילים במאגר`);
  };

  const originalTeamsText = gameManager.teamsText.bind(gameManager);
  gameManager.teamsText = (game) => {
    if (game.wordMode !== 'custom') return originalTeamsText(game);
    return originalTeamsText(game).replace('(קושי: קל)', `(מילים בהתאמה אישית: ${game.customWords.length})`);
  };

  const originalKeyboard = gameManager.lobbyKeyboard.bind(gameManager);
  gameManager.lobbyKeyboard = (game) => {
    const keyboard = originalKeyboard(game);
    if (game.wordMode !== 'custom') return keyboard;
    keyboard.inline_keyboard = keyboard.inline_keyboard.filter((row) => !row.some((button) => button.callback_data === 'cycle_difficulty'));
    return keyboard;
  };

  const originalCycle = gameManager.cycleDifficulty.bind(gameManager);
  gameManager.cycleDifficulty = (chatId, requesterId) => {
    const game = gameManager.getGame(chatId);
    if (game && game.wordMode === 'custom') return { error: 'custom_mode' };
    return originalCycle(chatId, requesterId);
  };
}

function createCustomGameStarter(gameManager) {
  return async function startCustomGame(ctx) {
    if (!['group','supergroup'].includes(ctx.chat.type)) return ctx.reply('את המשחק עם המאגר האישי פותחים בתוך קבוצה.');
    try {
      const host = await premiumHost(ctx.from);
      if (!host) return ctx.reply('📋 מצב מילים בהתאמה אישית זמין למשתמשי פרימיום אישי בלבד.');
      const words = await customWordsStore.listWords(ctx.from.id);
      if (words.length < customWordsStore.MIN_PLAY_WORDS) {
        return ctx.reply(`❌ כדי לשחק עם המאגר האישי יש להוסיף לפחות ${customWordsStore.MIN_PLAY_WORDS} מילים.\nכרגע יש לך ${words.length} מילים.`);
      }
      const existing = gameManager.getGame(ctx.chat.id);
      if (existing && existing.status !== 'finished') return ctx.reply('כבר יש משחק פעיל בקבוצה הזו.');
      const game = gameManager.createGame(ctx.chat.id, host, { isPremium: true });
      game.wordMode = 'custom';
      game.customWords = [...words];
      game.premiumSource = 'personal_custom';
      game.premiumActivatedBy = String(ctx.from.id);
      const sent = await ctx.reply(gameManager.lobbyText(game), { reply_markup: gameManager.lobbyKeyboard(game) });
      game.lobbyMessageId = sent.message_id;
    } catch (error) {
      console.error('Failed to start custom words game:', error);
      return ctx.reply('לא הצלחתי לפתוח את המשחק עם המאגר האישי כרגע.');
    }
  };
}
module.exports = { installCustomGameMode, createCustomGameStarter };
