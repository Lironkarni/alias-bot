const PREMIUM_PRICE_STARS = 100;
const SUBSCRIPTION_PERIOD_SECONDS = 30 * 24 * 60 * 60;
const ACTIVE_MEMBER_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted']);

function registerPremiumHandlers(bot, subscriptionStore) {
  bot.on('my_chat_member', async (ctx, next) => {
    const chat = ctx.myChatMember && ctx.myChatMember.chat;
    const status = ctx.myChatMember && ctx.myChatMember.new_chat_member.status;

    if (
      chat &&
      ['group', 'supergroup'].includes(chat.type) &&
      ACTIVE_MEMBER_STATUSES.has(status) &&
      subscriptionStore.isConfigured()
    ) {
      await subscriptionStore.ensureGroup(chat).catch((error) => {
        console.error('Failed to register group after bot membership update:', error);
      });
    }

    return next();
  });

  bot.command('premium', async (ctx) => {
    if (!subscriptionStore.isConfigured()) {
      return ctx.reply('בסיס הנתונים עדיין לא הוגדר בשרת.');
    }

    if (ctx.chat.type === 'private') {
      return showPremiumMenu(ctx, subscriptionStore);
    }

    if (!['group', 'supergroup'].includes(ctx.chat.type)) return;

    try {
      await subscriptionStore.ensureGroup(ctx.chat);
      await ctx.telegram.sendMessage(
        ctx.from.id,
        '⭐ ניהול מנוי פרימיום\n\nבחרו קבוצה כדי לראות את מצב המנוי שלה:',
        await buildGroupsKeyboard(ctx, subscriptionStore)
      );
      return ctx.reply('שלחתי לך הודעה פרטית עם אפשרויות הפרימיום ✅');
    } catch (error) {
      console.error('Failed to open premium menu in private chat:', error);
      const username = ctx.botInfo && ctx.botInfo.username;
      if (!username) return ctx.reply('פתחו קודם שיחה פרטית עם הבוט ואז נסו שוב.');

      return ctx.reply('כדי לנהל מנוי צריך לפתוח קודם שיחה פרטית עם הבוט:', {
        reply_markup: {
          inline_keyboard: [[{ text: '⭐ פתיחת ניהול פרימיום', url: `https://t.me/${username}?start=premium` }]],
        },
      });
    }
  });

  bot.action(/^premium_group:(-?\d+)$/, async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.answerCbQuery('ניהול המנוי זמין בצ׳אט הפרטי בלבד.', { show_alert: true });
    }

    const chatId = ctx.match[1];

    try {
      const allowed = await userCanAccessGroup(ctx, chatId);
      if (!allowed) {
        return ctx.answerCbQuery('הקבוצה כבר לא זמינה עבורך.', { show_alert: true });
      }

      const status = await subscriptionStore.getSubscriptionStatus(chatId);
      if (!status.group) {
        return ctx.answerCbQuery('הקבוצה לא נמצאה.', { show_alert: true });
      }

      await ctx.answerCbQuery();

      if (status.isPremium) {
        return ctx.reply(
          `⭐ לקבוצה „${status.group.title || chatId}” כבר יש מנוי פעיל.\n\nבתוקף עד: ${formatExpiry(status.expiresAt)}`
        );
      }

      const payload = createInvoicePayload(chatId, ctx.from.id);
      await ctx.telegram.callApi('sendInvoice', {
        chat_id: ctx.from.id,
        title: 'פרימיום אליאס',
        description: `מנוי פרימיום חודשי לקבוצה „${status.group.title || chatId}”`,
        payload,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: 'מנוי חודשי', amount: PREMIUM_PRICE_STARS }],
        subscription_period: SUBSCRIPTION_PERIOD_SECONDS,
      });
    } catch (error) {
      console.error('Failed to create premium invoice:', error);
      await ctx.answerCbQuery().catch(() => {});
      return ctx.reply('לא הצלחנו ליצור את התשלום כרגע. נסו שוב מאוחר יותר.');
    }
  });

  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const parsed = parseInvoicePayload(query.invoice_payload);

    if (
      !parsed ||
      String(query.from.id) !== parsed.userId ||
      query.currency !== 'XTR' ||
      query.total_amount !== PREMIUM_PRICE_STARS
    ) {
      return ctx.answerPreCheckoutQuery(false, 'פרטי התשלום אינם תקינים.');
    }

    try {
      const allowed = await userCanAccessGroup(ctx, parsed.chatId);
      if (!allowed) {
        return ctx.answerPreCheckoutQuery(false, 'אין לך יותר גישה לקבוצה שנבחרה.');
      }

      const status = await subscriptionStore.getSubscriptionStatus(parsed.chatId);
      if (!status.group) {
        return ctx.answerPreCheckoutQuery(false, 'הקבוצה לא נמצאה.');
      }
      if (status.isPremium) {
        return ctx.answerPreCheckoutQuery(false, 'לקבוצה כבר יש מנוי פרימיום פעיל.');
      }

      return ctx.answerPreCheckoutQuery(true);
    } catch (error) {
      console.error('Premium pre-checkout validation failed:', error);
      return ctx.answerPreCheckoutQuery(false, 'לא ניתן לאמת את המנוי כרגע. נסו שוב.');
    }
  });

  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const parsed = parseInvoicePayload(payment.invoice_payload);

    if (
      !parsed ||
      String(ctx.from.id) !== parsed.userId ||
      payment.currency !== 'XTR' ||
      payment.total_amount !== PREMIUM_PRICE_STARS
    ) {
      console.error('Ignoring invalid successful premium payment payload');
      return;
    }

    try {
      const expiresAt = payment.subscription_expiration_date
        ? new Date(payment.subscription_expiration_date * 1000)
        : new Date(Date.now() + SUBSCRIPTION_PERIOD_SECONDS * 1000);

      const group = await subscriptionStore.activateSubscription({
        chatId: parsed.chatId,
        expiresAt,
        activatedBy: ctx.from.id,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        isRecurring: Boolean(payment.is_recurring),
      });

      await ctx.reply(
        `✅ התשלום התקבל!\n\nהמנוי לקבוצה „${group.title || parsed.chatId}” פעיל עד ${formatExpiry(expiresAt)}.`
      );

      await ctx.telegram
        .sendMessage(
          parsed.chatId,
          `⭐ מנוי הפרימיום של הקבוצה הופעל בהצלחה!\nבתוקף עד: ${formatExpiry(expiresAt)}`
        )
        .catch(() => {});
    } catch (error) {
      console.error('Failed to activate premium after payment:', error);
      await ctx.reply('התשלום התקבל, אך אירעה תקלה בהפעלת המנוי. נא לפנות לתמיכה.');
    }
  });
}

async function showPremiumMenu(ctx, subscriptionStore) {
  try {
    const keyboard = await buildGroupsKeyboard(ctx, subscriptionStore);
    if (!keyboard.reply_markup.inline_keyboard.length) {
      return ctx.reply(
        'לא מצאתי קבוצות משותפות. הוסיפו את הבוט לקבוצה, הפעילו שם /start או /premium ואז נסו שוב.'
      );
    }

    return ctx.reply('⭐ ניהול מנוי פרימיום\n\nבחרו קבוצה:', keyboard);
  } catch (error) {
    console.error('Failed to load premium groups:', error);
    return ctx.reply('לא הצלחנו לטעון את הקבוצות כרגע. נסו שוב מאוחר יותר.');
  }
}

async function buildGroupsKeyboard(ctx, subscriptionStore) {
  const groups = await subscriptionStore.listGroups();
  const rows = [];

  for (const group of groups) {
    if (!(await userCanAccessGroup(ctx, group.chatId))) continue;

    const status = await subscriptionStore.getSubscriptionStatus(group.chatId);
    const prefix = status.isPremium ? '⭐' : '🆓';
    const title = truncate(group.title || group.chatId, 40);
    rows.push([{ text: `${prefix} ${title}`, callback_data: `premium_group:${group.chatId}` }]);
  }

  return { reply_markup: { inline_keyboard: rows } };
}

async function userCanAccessGroup(ctx, chatId) {
  try {
    const member = await ctx.telegram.getChatMember(chatId, ctx.from.id);
    return ACTIVE_MEMBER_STATUSES.has(member.status);
  } catch (error) {
    return false;
  }
}

function createInvoicePayload(chatId, userId) {
  return `premium:${String(chatId)}:${String(userId)}`;
}

function parseInvoicePayload(payload) {
  const match = /^premium:(-?\d+):(\d+)$/.exec(payload || '');
  if (!match) return null;
  return { chatId: match[1], userId: match[2] };
}

function formatExpiry(date) {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

function truncate(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

module.exports = {
  registerPremiumHandlers,
  showPremiumMenu,
  createInvoicePayload,
  parseInvoicePayload,
};
