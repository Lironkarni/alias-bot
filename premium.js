const GROUP_PICKER_REQUEST_ID = 1001;
const ACTIVE_MEMBER_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted']);

const PREMIUM_PACKAGES = {
  month: { code: 'month', label: 'חודש', price: 100, days: 30 },
  quarter: { code: 'quarter', label: '3 חודשים', price: 200, days: 90 },
  year: { code: 'year', label: 'שנה', price: 600, days: 365 },
};

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
      return showPremiumMenu(ctx);
    }

    if (!['group', 'supergroup'].includes(ctx.chat.type)) return;

    try {
      const group = await subscriptionStore.ensureGroup(ctx.chat);
      await sendPurchaseMenu(ctx.telegram, ctx.from.id, subscriptionStore, group);
      return ctx.reply('שלחתי לך בפרטי את תפריט הפרימיום של הקבוצה ✅');
    } catch (error) {
      console.error('Failed to send group premium menu privately:', error);
      const username = ctx.botInfo && ctx.botInfo.username;
      if (!username) return ctx.reply('פתחו קודם שיחה פרטית עם הבוט ואז נסו שוב.');

      return ctx.reply('כדי לרכוש פרימיום צריך לפתוח קודם שיחה פרטית עם הבוט:', {
        reply_markup: {
          inline_keyboard: [[{ text: '⭐ פתיחת ניהול פרימיום', url: `https://t.me/${username}?start=premium` }]],
        },
      });
    }
  });

  bot.on('chat_shared', async (ctx) => {
    if (ctx.chat.type !== 'private') return;

    const shared = ctx.message.chat_shared;
    if (!shared || shared.request_id !== GROUP_PICKER_REQUEST_ID) return;

    try {
      const telegramChat = await ctx.telegram.getChat(shared.chat_id);
      if (!['group', 'supergroup'].includes(telegramChat.type)) {
        return ctx.reply('אפשר לבחור רק קבוצה או קבוצת־על.');
      }

      const group = await subscriptionStore.ensureGroup(telegramChat);
      await ctx.reply('הקבוצה נבחרה ✅', { reply_markup: { remove_keyboard: true } });
      return await sendPurchaseMenu(ctx.telegram, ctx.from.id, subscriptionStore, group);
    } catch (error) {
      console.error('Failed to handle selected premium group:', error);
      return ctx.reply('לא הצלחנו לגשת לקבוצה שנבחרה. ודאו שהבוט עדיין נמצא בה.');
    }
  });

  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const parsed = parseInvoicePayload(query.invoice_payload);
    const selectedPackage = parsed && PREMIUM_PACKAGES[parsed.packageCode];

    if (
      !parsed ||
      !selectedPackage ||
      String(query.from.id) !== parsed.userId ||
      query.currency !== 'XTR' ||
      query.total_amount !== selectedPackage.price
    ) {
      return ctx.answerPreCheckoutQuery(false, 'פרטי התשלום אינם תקינים.');
    }

    try {
      await ctx.telegram.getChat(parsed.chatId);
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
    const selectedPackage = parsed && PREMIUM_PACKAGES[parsed.packageCode];

    if (
      !parsed ||
      !selectedPackage ||
      String(ctx.from.id) !== parsed.userId ||
      payment.currency !== 'XTR' ||
      payment.total_amount !== selectedPackage.price
    ) {
      console.error('Ignoring invalid successful premium payment payload');
      return;
    }

    try {
      const expiresAt = new Date(Date.now() + selectedPackage.days * 24 * 60 * 60 * 1000);
      const group = await subscriptionStore.activateSubscription({
        chatId: parsed.chatId,
        expiresAt,
        activatedBy: ctx.from.id,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        isRecurring: false,
      });

      await ctx.reply(
        `✅ התשלום התקבל!\n\nחבילת ${selectedPackage.label} לקבוצה „${group.title || parsed.chatId}” פעילה עד ${formatExpiry(expiresAt)}.`
      );

      await ctx.telegram
        .sendMessage(
          parsed.chatId,
          `⭐ מנוי הפרימיום של הקבוצה הופעל בהצלחה!\nחבילה: ${selectedPackage.label}\nבתוקף עד: ${formatExpiry(expiresAt)}`
        )
        .catch(() => {});
    } catch (error) {
      console.error('Failed to activate premium after payment:', error);
      await ctx.reply('התשלום התקבל, אך אירעה תקלה בהפעלת המנוי. נא לפנות לתמיכה.');
    }
  });
}

async function showPremiumMenu(ctx) {
  return ctx.reply(
    '⭐ ניהול מנוי פרימיום\n\nלחצו על הכפתור ובחרו קבוצה שבה אתם והבוט חברים:',
    groupPickerKeyboard()
  );
}

async function sendPurchaseMenu(telegram, userId, subscriptionStore, group) {
  const status = await subscriptionStore.getSubscriptionStatus(group.chatId);

  if (status.isPremium) {
    return telegram.sendMessage(
      userId,
      `⭐ לקבוצה „${group.title || group.chatId}” כבר יש מנוי פעיל.\n\nבתוקף עד: ${formatExpiry(status.expiresAt)}`
    );
  }

  const packageLinks = await Promise.all(
    Object.values(PREMIUM_PACKAGES).map(async (item) => {
      const payload = createInvoicePayload(group.chatId, userId, item.code);
      const url = await telegram.callApi('createInvoiceLink', {
        title: 'פרימיום אליאס',
        description: `חבילת ${item.label} לקבוצה „${group.title || group.chatId}”`,
        payload,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: `פרימיום — ${item.label}`, amount: item.price }],
      });
      return { item, url };
    })
  );

  const text =
    `⭐ פרימיום אליאס לקבוצה „${group.title || group.chatId}”\n\n` +
    'מה מקבלים?\n' +
    '✅ גישה למאגר המילים המלא\n' +
    '✅ רמות קושי בינוני וקשה\n' +
    '✅ מילים מאתגרות ומגוונות יותר\n' +
    '✅ פחות חזרות בין משחקים\n' +
    '✅ הפרימיום זמין לכל חברי הקבוצה\n\n' +
    'בחרו חבילה:';

  return telegram.sendMessage(userId, text, {
    reply_markup: {
      inline_keyboard: packageLinks.map(({ item, url }) => [
        { text: `⭐ ${item.label} — ${item.price}`, url },
      ]),
    },
  });
}

function groupPickerKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [
          {
            text: '👥 בחירת קבוצה',
            request_chat: {
              request_id: GROUP_PICKER_REQUEST_ID,
              chat_is_channel: false,
              bot_is_member: true,
              request_title: true,
            },
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

function createInvoicePayload(chatId, userId, packageCode) {
  return `premium:${String(chatId)}:${String(userId)}:${packageCode}`;
}

function parseInvoicePayload(payload) {
  const match = /^premium:(-?\d+):(\d+):(month|quarter|year)$/.exec(payload || '');
  if (!match) return null;
  return { chatId: match[1], userId: match[2], packageCode: match[3] };
}

function formatExpiry(date) {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

module.exports = {
  PREMIUM_PACKAGES,
  registerPremiumHandlers,
  showPremiumMenu,
  sendPurchaseMenu,
  createInvoicePayload,
  parseInvoicePayload,
};
