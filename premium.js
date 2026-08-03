const personalPremiumStore = require('./personalPremiumStore');

const GROUP_PICKER_REQUEST_ID = 1001;
const ACTIVE_MEMBER_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted']);

const PREMIUM_PACKAGES = {
  month: { code: 'month', label: 'חודש', price: 100, days: 30 },
  quarter: { code: 'quarter', label: '3 חודשים', price: 200, days: 90 },
  year: { code: 'year', label: 'שנה', price: 600, days: 365 },
};

const PERSONAL_PREMIUM_PACKAGES = {
  month: { code: 'month', label: 'חודש', price: 200, days: 30 },
  quarter: { code: 'quarter', label: '3 חודשים', price: 400, days: 90 },
  year: { code: 'year', label: 'שנה', price: 1200, days: 365 },
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
    if (!subscriptionStore.isConfigured() || !personalPremiumStore.isConfigured()) {
      return ctx.reply('בסיס הנתונים עדיין לא הוגדר בשרת.');
    }

    if (ctx.chat.type === 'private') return showPremiumMenu(ctx);
    if (!['group', 'supergroup'].includes(ctx.chat.type)) return;

    try {
      await ctx.telegram.sendMessage(ctx.from.id, premiumChoiceText(), premiumChoiceKeyboard());
      return ctx.reply('שלחתי לך בפרטי את תפריט הפרימיום ✅');
    } catch (error) {
      console.error('Failed to send premium menu privately:', error);
      const username = ctx.botInfo && ctx.botInfo.username;
      if (!username) return ctx.reply('פתחו קודם שיחה פרטית עם הבוט ואז נסו שוב.');

      return ctx.reply('כדי לנהל פרימיום צריך לפתוח קודם שיחה פרטית עם הבוט:', {
        reply_markup: {
          inline_keyboard: [[{ text: '⭐ פתיחת ניהול פרימיום', url: `https://t.me/${username}?start=premium` }]],
        },
      });
    }
  });

  bot.action('premium_group', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.reply(
      '⭐ פרימיום לקבוצה\n\nלחצו על הכפתור ובחרו קבוצה שבה אתם והבוט חברים:',
      groupPickerKeyboard()
    );
  });

  bot.action('premium_personal', async (ctx) => {
    await ctx.answerCbQuery();
    return sendPersonalPurchaseMenu(ctx.telegram, ctx.from.id);
  });

  bot.action('premium_back', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.editMessageText(premiumChoiceText(), premiumChoiceKeyboard()).catch(() =>
      ctx.reply(premiumChoiceText(), premiumChoiceKeyboard())
    );
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
      return sendPurchaseMenu(ctx.telegram, ctx.from.id, subscriptionStore, group);
    } catch (error) {
      console.error('Failed to handle selected premium group:', error);
      return ctx.reply('לא הצלחנו לגשת לקבוצה שנבחרה. ודאו שהבוט עדיין נמצא בה.');
    }
  });

  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const parsed = parseAnyInvoicePayload(query.invoice_payload);
    if (!parsed || String(query.from.id) !== parsed.userId || query.currency !== 'XTR') {
      return ctx.answerPreCheckoutQuery(false, 'פרטי התשלום אינם תקינים.');
    }

    if (parsed.type === 'personal') {
      const selectedPackage = PERSONAL_PREMIUM_PACKAGES[parsed.packageCode];
      if (!selectedPackage || query.total_amount !== selectedPackage.price) {
        return ctx.answerPreCheckoutQuery(false, 'פרטי התשלום אינם תקינים.');
      }
      const status = await personalPremiumStore.getSubscriptionStatus(parsed.userId);
      if (status.isPremium) {
        return ctx.answerPreCheckoutQuery(false, 'כבר יש לך מנוי פרימיום אישי פעיל.');
      }
      return ctx.answerPreCheckoutQuery(true);
    }

    const selectedPackage = PREMIUM_PACKAGES[parsed.packageCode];
    if (!selectedPackage || query.total_amount !== selectedPackage.price) {
      return ctx.answerPreCheckoutQuery(false, 'פרטי התשלום אינם תקינים.');
    }

    try {
      await ctx.telegram.getChat(parsed.chatId);
      const status = await subscriptionStore.getSubscriptionStatus(parsed.chatId);
      if (!status.group) return ctx.answerPreCheckoutQuery(false, 'הקבוצה לא נמצאה.');
      if (status.isPremium) return ctx.answerPreCheckoutQuery(false, 'לקבוצה כבר יש מנוי פרימיום פעיל.');
      return ctx.answerPreCheckoutQuery(true);
    } catch (error) {
      console.error('Premium pre-checkout validation failed:', error);
      return ctx.answerPreCheckoutQuery(false, 'לא ניתן לאמת את המנוי כרגע. נסו שוב.');
    }
  });

  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const parsed = parseAnyInvoicePayload(payment.invoice_payload);
    if (!parsed || String(ctx.from.id) !== parsed.userId || payment.currency !== 'XTR') {
      console.error('Ignoring invalid successful premium payment payload');
      return;
    }

    if (parsed.type === 'personal') {
      const selectedPackage = PERSONAL_PREMIUM_PACKAGES[parsed.packageCode];
      if (!selectedPackage || payment.total_amount !== selectedPackage.price) return;

      try {
        const expiresAt = new Date(Date.now() + selectedPackage.days * 24 * 60 * 60 * 1000);
        await personalPremiumStore.setSubscriptionExpiry(ctx.from.id, expiresAt, {
          packageCode: selectedPackage.code,
          paidStars: selectedPackage.price,
          telegramPaymentChargeId: payment.telegram_payment_charge_id,
          activatedAt: new Date().toISOString(),
        });
        return ctx.reply(
          `✅ התשלום התקבל!\n\n🌟 הפרימיום האישי שלך פעיל עד ${formatExpiry(expiresAt)}.`
        );
      } catch (error) {
        console.error('Failed to activate personal premium after payment:', error);
        return ctx.reply('התשלום התקבל, אך אירעה תקלה בהפעלת המנוי. נא לפנות לתמיכה.');
      }
    }

    const selectedPackage = PREMIUM_PACKAGES[parsed.packageCode];
    if (!selectedPackage || payment.total_amount !== selectedPackage.price) return;

    try {
      const expiresAt = new Date(Date.now() + selectedPackage.days * 24 * 60 * 60 * 1000);
      const group = await subscriptionStore.activateSubscription({
        chatId: parsed.chatId,
        expiresAt,
        activatedBy: ctx.from.id,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        packageCode: selectedPackage.code,
        paidStars: selectedPackage.price,
        isRecurring: false,
      });

      await ctx.reply(
        `✅ התשלום התקבל!\n\nחבילת ${selectedPackage.label} לקבוצה „${group.title || parsed.chatId}” פעילה עד ${formatExpiry(expiresAt)}.`
      );

      await ctx.telegram.sendMessage(
        parsed.chatId,
        `⭐ מנוי הפרימיום של הקבוצה הופעל בהצלחה!\nחבילה: ${selectedPackage.label}\nבתוקף עד: ${formatExpiry(expiresAt)}`
      ).catch(() => {});
    } catch (error) {
      console.error('Failed to activate premium after payment:', error);
      await ctx.reply('התשלום התקבל, אך אירעה תקלה בהפעלת המנוי. נא לפנות לתמיכה.');
    }
  });
}

function premiumChoiceText() {
  return '⭐ אליאס פרימיום\n\nבחרו את סוג המנוי:';
}

function premiumChoiceKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⭐ פרימיום לקבוצה', callback_data: 'premium_group' }],
        [{ text: '🌟 פרימיום אישי', callback_data: 'premium_personal' }],
      ],
    },
  };
}

async function showPremiumMenu(ctx) {
  return ctx.reply(premiumChoiceText(), premiumChoiceKeyboard());
}

async function sendPersonalPurchaseMenu(telegram, userId) {
  const status = await personalPremiumStore.getSubscriptionStatus(userId);
  if (status.isPremium) {
    const expiryText = status.expiresAt ? `\n\nבתוקף עד: ${formatExpiry(status.expiresAt)}` : '';
    return telegram.sendMessage(
      userId,
      `🌟 הפרימיום האישי שלך פעיל.${expiryText}`,
      { reply_markup: { inline_keyboard: [[{ text: '⬅️ חזרה', callback_data: 'premium_back' }]] } }
    );
  }

  const packageLinks = await Promise.all(
    Object.values(PERSONAL_PREMIUM_PACKAGES).map(async (item) => {
      const url = await telegram.callApi('createInvoiceLink', {
        title: 'אליאס פרימיום אישי',
        description: `מנוי אישי לתקופה של ${item.label}`,
        payload: createPersonalInvoicePayload(userId, item.code),
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: `פרימיום אישי — ${item.label}`, amount: item.price }],
      });
      return { item, url };
    })
  );

  const text =
    '🌟 אליאס פרימיום אישי\n\n' +
    'קבל הטבות אישיות בכל קבוצה שבה תשחק.\n\n' +
    '⭐ פתיחת משחק פרימיום בכל קבוצה.\n' +
    '🌟 שם מיוחד במשחק: 🌟 השם שלך 🌟\n' +
    '📊 סטטיסטיקות אישיות מפורטות.\n' +
    '📋 משחק עם מאגר מילים אישי משלך.';

  return telegram.sendMessage(userId, text, {
    reply_markup: {
      inline_keyboard: [
        ...packageLinks.map(({ item, url }) => [{ text: `⭐ ${item.label} — ${item.price}`, url }]),
        [{ text: '⬅️ חזרה', callback_data: 'premium_back' }],
      ],
    },
  });
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
    '✅ מצב משחק שבו דילוג מוריד נקודה מהתור\n' +
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
      keyboard: [[{
        text: '👥 בחירת קבוצה',
        request_chat: {
          request_id: GROUP_PICKER_REQUEST_ID,
          chat_is_channel: false,
          bot_is_member: true,
          request_title: true,
        },
      }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

function createInvoicePayload(chatId, userId, packageCode) {
  return `premium:${String(chatId)}:${String(userId)}:${packageCode}`;
}

function createPersonalInvoicePayload(userId, packageCode) {
  return `personal-premium:${String(userId)}:${packageCode}`;
}

function parseInvoicePayload(payload) {
  const match = /^premium:(-?\d+):(\d+):(month|quarter|year)$/.exec(payload || '');
  if (!match) return null;
  return { type: 'group', chatId: match[1], userId: match[2], packageCode: match[3] };
}

function parsePersonalInvoicePayload(payload) {
  const match = /^personal-premium:(\d+):(month|quarter|year)$/.exec(payload || '');
  if (!match) return null;
  return { type: 'personal', userId: match[1], packageCode: match[2] };
}

function parseAnyInvoicePayload(payload) {
  return parseInvoicePayload(payload) || parsePersonalInvoicePayload(payload);
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
  PERSONAL_PREMIUM_PACKAGES,
  registerPremiumHandlers,
  showPremiumMenu,
  sendPurchaseMenu,
  sendPersonalPurchaseMenu,
  createInvoicePayload,
  createPersonalInvoicePayload,
  parseInvoicePayload,
  parsePersonalInvoicePayload,
};
