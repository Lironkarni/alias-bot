require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Telegraf } = require('telegraf');
const { Server } = require('socket.io');

const registerBotHandlers = require('./bot');
const GameManager = require('./gameManager');
const { validateInitData } = require('./telegramAuth');

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const MINIAPP_SHORTNAME = process.env.MINIAPP_SHORTNAME || 'play';
const PUBLIC_URL = process.env.PUBLIC_URL;
const PORT = process.env.PORT || 3000;
const USE_WEBHOOK = process.env.USE_WEBHOOK === 'true';

if (!BOT_TOKEN || !BOT_USERNAME) {
  console.error('חסר BOT_TOKEN או BOT_USERNAME בקובץ .env');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const bot = new Telegraf(BOT_TOKEN);
const gameManager = new GameManager(bot, io, { botUsername: BOT_USERNAME, miniAppShortName: MINIAPP_SHORTNAME });

registerBotHandlers(bot, gameManager);

// ---------- Socket.io: תקשורת עם ה-Mini App ----------

io.on('connection', (socket) => {
  let ctx = null; // { game, entry, userId }

  socket.on('join_turn', ({ initData, token }) => {
    const auth = validateInitData(initData, BOT_TOKEN);
    if (!auth || !auth.user) {
      socket.emit('error_msg', { error: 'auth_failed', message: 'אימות המשתמש נכשל.' });
      return;
    }

    const resolved = gameManager.resolveTurnToken(token, auth.user.id);
    if (resolved.error) {
      const messages = {
        invalid_token: 'הקישור אינו תקין.',
        expired: 'הקישור פג תוקף.',
        no_game: 'אין משחק פעיל כרגע.',
        stale_turn: 'התור הזה כבר לא פעיל.',
        wrong_user: 'זה לא התור שלך במשחק!',
      };
      socket.emit('error_msg', { error: resolved.error, message: messages[resolved.error] || 'שגיאה.' });
      return;
    }

    const { game } = resolved;
    ctx = { game, userId: auth.user.id, token };
    socket.join(token);

    gameManager.beginTurnIfNeeded(game);

    socket.emit('state', {
      teamNumber: game.currentTeam,
      playerName: game.currentPlayer.name,
      word: game.currentWord,
      turnScore: game.turnScore,
      turnEndTime: game.turnEndTime,
      active: game.turnActive,
    });
  });

  socket.on('correct', () => {
    if (!ctx) return;
    const result = gameManager.handleCorrect(ctx.game);
    if (result) io.to(ctx.token).emit('word', result);
  });

  socket.on('skip', () => {
    if (!ctx) return;
    const result = gameManager.handleSkip(ctx.game);
    if (result) io.to(ctx.token).emit('word', result);
  });
});

// ---------- הפעלת הבוט: webhook או polling ----------

async function start() {
  server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

  if (USE_WEBHOOK) {
    if (!PUBLIC_URL) {
      console.error('USE_WEBHOOK=true אבל לא הוגדר PUBLIC_URL');
      process.exit(1);
    }
    const webhookPath = `/telegraf/${BOT_TOKEN}`;
    app.use(bot.webhookCallback(webhookPath));
    await bot.telegram.setWebhook(`${PUBLIC_URL}${webhookPath}`);
    console.log('Bot running via webhook:', `${PUBLIC_URL}${webhookPath}`);
  } else {
    await bot.telegram.deleteWebhook().catch(() => {});
    bot.launch();
    console.log('Bot running via long polling');
  }
}

start();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
