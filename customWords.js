const personalPremiumStore = require('./personalPremiumStore');
const customWordsStore = require('./customWordsStore');
const { validateInitData } = require('./telegramAuth');

function keyboard(publicUrl) {
  return { inline_keyboard: [[{ text: '📋 ניהול מילים בהתאמה אישית', web_app: { url: `${publicUrl.replace(/\/$/, '')}/custom-words.html` } }]] };
}

function registerCustomWordsHandlers(bot, { publicUrl, botUsername, startCustomGame }) {
  bot.command('customwords', async (ctx) => {
    if (!publicUrl) return ctx.reply('מסך המילים האישיות אינו זמין כרגע.');
    const status = await personalPremiumStore.getSubscriptionStatus(ctx.from.id);
    if (!status.isPremium) return ctx.reply('📋 מילים בהתאמה אישית זמינות למשתמשי פרימיום אישי בלבד.');
    const options = { reply_markup: keyboard(publicUrl) };
    if (ctx.chat.type === 'private') return ctx.reply('📋 המאגר האישי שלך', options);
    try {
      await ctx.telegram.sendMessage(ctx.from.id, '📋 המאגר האישי שלך', options);
      return ctx.reply('📩 שלחתי לך את מסך ניהול המילים בפרטי.');
    } catch { return ctx.reply('כדי לפתוח את המאגר, היכנס קודם לבוט בפרטי ולחץ על Start.'); }
  });

  bot.command('customstart', (ctx) => startCustomGame(ctx));
  bot.start(async (ctx, next) => {
    if (ctx.startPayload === 'custom' && ['group','supergroup'].includes(ctx.chat.type)) return startCustomGame(ctx);
    return next();
  });
}

function registerCustomWordsApi(app, { botToken, botUsername }) {
  async function authPremium(req, res) {
    const auth = validateInitData(req.body && req.body.initData, botToken);
    if (!auth || !auth.user) { res.status(401).json({ error: 'auth_failed' }); return null; }
    const status = await personalPremiumStore.getSubscriptionStatus(auth.user.id);
    if (!status.isPremium) { res.status(403).json({ error: 'personal_premium_required' }); return null; }
    return auth.user;
  }
  app.post('/api/custom-words/list', async (req, res) => {
    try { const user = await authPremium(req, res); if (!user) return; const words = await customWordsStore.listWords(user.id); res.json({ ok:true, words, count:words.length, max:500, minToPlay:60, playUrl:`https://t.me/${botUsername}?startgroup=custom` }); }
    catch (error) { console.error(error); res.status(500).json({ error:'server_error' }); }
  });
  app.post('/api/custom-words/add', async (req, res) => {
    try { const user = await authPremium(req, res); if (!user) return; const raw = String(req.body.text || ''); const items = raw.split(/[\n,;]+/).map(v=>v.trim()).filter(Boolean); const result = await customWordsStore.addWords(user.id, items); res.json({ ok:true, ...result }); }
    catch (error) { console.error(error); res.status(500).json({ error:'server_error' }); }
  });
  app.post('/api/custom-words/remove', async (req, res) => {
    try { const user = await authPremium(req, res); if (!user) return; const removed = await customWordsStore.removeWord(user.id, req.body.word); const words = await customWordsStore.listWords(user.id); res.json({ ok:true, removed, count:words.length }); }
    catch (error) { console.error(error); res.status(500).json({ error:'server_error' }); }
  });
  app.post('/api/custom-words/clear', async (req, res) => {
    try { const user = await authPremium(req, res); if (!user) return; await customWordsStore.clearWords(user.id); res.json({ ok:true }); }
    catch (error) { console.error(error); res.status(500).json({ error:'server_error' }); }
  });
  app.post('/api/custom-words/export', async (req, res) => {
    try { const user = await authPremium(req, res); if (!user) return; const words = await customWordsStore.listWords(user.id); res.setHeader('Content-Type','text/plain; charset=utf-8'); res.setHeader('Content-Disposition','attachment; filename="alias-custom-words.txt"'); res.send(words.join('\n')); }
    catch (error) { console.error(error); res.status(500).send('server_error'); }
  });
}
module.exports = { registerCustomWordsHandlers, registerCustomWordsApi };
