const PROMOTION_INTERVAL = 2;

const GROUP_PROMOTION_TEXT =
  'רוצים לשדרג את המשחק?\n\n' +
  'פרימיום לקבוצה כולל מאגר מילים גדול יותר, רמות קושי נוספות והטבות לכל חברי הקבוצה.\n\n' +
  'לחצו /premium לפרטים.';

const PERSONAL_PROMOTION_TEXT =
  'רוצים לשדרג את חוויית המשחק?\n\n' +
  'פרימיום אישי כולל משחק פרימיום בכל קבוצה, סטטיסטיקות אישיות ומאגר מילים פרטי.\n\n' +
  'לחצו /premium לפרטים.';

function installPremiumPromotions(gameManager) {
  const freeGameCounts = new Map();
  const premiumGameCounts = new Map();
  const originalFinishGame = gameManager._finishGame.bind(gameManager);

  gameManager._finishGame = async (game, winner) => {
    const isPremiumGame = Boolean(game && game.isPremium);
    const chatId = game && game.chatId;

    // מנטרל את הפרסומת הישנה של GameManager במשחקים חינמיים.
    if (!isPremiumGame && chatId != null && gameManager.freeGamesCompleted) {
      gameManager.freeGamesCompleted.set(chatId, 0);
    }

    const result = await originalFinishGame(game, winner);
    if (chatId == null) return result;

    if (isPremiumGame) {
      const completed = (premiumGameCounts.get(chatId) || 0) + 1;
      premiumGameCounts.set(chatId, completed);

      if (completed % PROMOTION_INTERVAL === 0) {
        await gameManager.bot.telegram.sendMessage(chatId, PERSONAL_PROMOTION_TEXT);
      }
      return result;
    }

    const completed = (freeGameCounts.get(chatId) || 0) + 1;
    freeGameCounts.set(chatId, completed);

    if (completed % PROMOTION_INTERVAL === 0) {
      await gameManager.bot.telegram.sendMessage(chatId, GROUP_PROMOTION_TEXT);
    }

    return result;
  };
}

module.exports = {
  installPremiumPromotions,
  GROUP_PROMOTION_TEXT,
  PERSONAL_PROMOTION_TEXT,
};
