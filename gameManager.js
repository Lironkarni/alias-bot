const { v4: uuidv4 } = require('uuid');
const WORDS = require('./words');

const TURN_SECONDS = 60;
const WIN_SCORE = 30;
const TURN_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 דקות לפתוח את הקישור

class GameManager {
  /**
   * @param {import('telegraf').Telegraf} bot
   * @param {import('socket.io').Server} io
   * @param {{botUsername: string, miniAppShortName: string}} opts
   */
  constructor(bot, io, opts) {
    this.bot = bot;
    this.io = io;
    this.botUsername = opts.botUsername;
    this.miniAppShortName = opts.miniAppShortName;

    this.games = new Map(); // chatId -> game state
    this.turnTokens = new Map(); // token -> { chatId, expectedUserId }
  }

  getGame(chatId) {
    return this.games.get(chatId);
  }

  // ---------- שלב הלובי ----------

  createGame(chatId, host) {
    const game = {
      chatId,
      hostId: host.id,
      hostName: displayName(host),
      status: 'lobby', // lobby | playing | finished
      players: [], // { id, name } לפי סדר הצטרפות
      lobbyMessageId: null,
      team1: [],
      team2: [],
      team1Idx: 0,
      team2Idx: 0,
      currentTeam: 1,
      scores: { team1: 0, team2: 0 },
      currentTurnToken: null,
      currentPlayer: null,
      turnActive: false,
      turnScore: 0,
      currentWord: null,
      usedWords: new Set(),
      turnTimeout: null,
    };
    this.games.set(chatId, game);
    return game;
  }

  addPlayer(chatId, user) {
    const game = this.games.get(chatId);
    if (!game || game.status !== 'lobby') return null;
    if (game.players.some((p) => p.id === user.id)) return game; // כבר בפנים
    game.players.push({ id: user.id, name: displayName(user) });
    return game;
  }

  lobbyText(game) {
    const lines = ['🎭 ברוכים הבאים למשחק אליאס!', ''];
    if (game.players.length === 0) {
      lines.push('אף אחד עוד לא הצטרף.');
    } else {
      lines.push('משתתפים:');
      game.players.forEach((p, i) => lines.push(`${i + 1}. ${p.name}`));
    }
    lines.push('');
    lines.push(`מנהל המשחק: ${game.hostName}`);
    return lines.join('\n');
  }

  lobbyKeyboard() {
    return {
      inline_keyboard: [
        [{ text: '✋ הצטרף למשחק', callback_data: 'join' }],
        [{ text: '▶️ התחל משחק', callback_data: 'start_game' }],
      ],
    };
  }

  // ---------- התחלת משחק וחלוקה לקבוצות ----------

  startGame(chatId) {
    const game = this.games.get(chatId);
    if (!game) return { error: 'no_game' };
    if (game.status !== 'lobby') return { error: 'already_started' };
    if (game.players.length < 4) return { error: 'not_enough_players' };

    const shuffled = shuffle(game.players);
    game.team1 = [];
    game.team2 = [];
    shuffled.forEach((p, i) => {
      if (i % 2 === 0) game.team1.push(p);
      else game.team2.push(p);
    });

    game.status = 'playing';
    game.currentTeam = 1;
    game.team1Idx = 0;
    game.team2Idx = 0;
    game.scores = { team1: 0, team2: 0 };

    return { game };
  }

  teamsText(game) {
    const t1 = game.team1.map((p) => p.name).join(', ');
    const t2 = game.team2.map((p) => p.name).join(', ');
    return `🎭 המשחק מתחיל!\n\n🔵 קבוצה 1: ${t1}\n🔴 קבוצה 2: ${t2}`;
  }

  // ---------- ניהול תורות ----------

  async startTurn(chatId) {
    const game = this.games.get(chatId);
    if (!game || game.status !== 'playing') return;

    const teamArr = game.currentTeam === 1 ? game.team1 : game.team2;
    const idx = game.currentTeam === 1 ? game.team1Idx : game.team2Idx;
    const player = teamArr[idx % teamArr.length];

    const token = uuidv4();
    this.turnTokens.set(token, {
      chatId,
      expectedUserId: player.id,
      expiresAt: Date.now() + TURN_TOKEN_TTL_MS,
    });

    game.currentTurnToken = token;
    game.currentPlayer = player;
    game.turnActive = false;
    game.turnScore = 0;
    game.currentWord = null;

    const teamEmoji = game.currentTeam === 1 ? '🔵' : '🔴';
    const text =
      `${teamEmoji} התור של קבוצה ${game.currentTeam}\n` +
      `🎤 המסביר: ${player.name}\n\n` +
      `לחצו על הכפתור כדי לפתוח את מסך המשחק.\n` +
      `רק ${player.name} יוכל לראות את המילים - הזהות מאומתת בשרת.`;

    const miniAppUrl = `https://t.me/${this.botUsername}/${this.miniAppShortName}?startapp=${token}`;

    await this.bot.telegram.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: '🎮 פתח מסך משחק', url: miniAppUrl }]],
      },
    });
  }

  // מאמת את הבקשה שמגיעה מה-Mini App ומחזיר את הקונטקסט שלה, או שגיאה
  resolveTurnToken(token, userId) {
    const entry = this.turnTokens.get(token);
    if (!entry) return { error: 'invalid_token' };
    if (entry.expiresAt < Date.now()) {
      this.turnTokens.delete(token);
      return { error: 'expired' };
    }
    const game = this.games.get(entry.chatId);
    if (!game || game.status !== 'playing') return { error: 'no_game' };
    if (game.currentTurnToken !== token) return { error: 'stale_turn' };
    if (entry.expectedUserId !== userId) return { error: 'wrong_user' };
    return { game, entry };
  }

  // נקרא כאשר השחקן פותח בפועל את מסך המשחק - זה הרגע שבו הטיימר מתחיל
  beginTurnIfNeeded(game) {
    if (game.turnActive) return;
    game.turnActive = true;
    game.currentWord = this._pickWord(game);
    game.turnEndTime = Date.now() + TURN_SECONDS * 1000;

    game.turnTimeout = setTimeout(() => {
      this.endTurn(game.chatId).catch((err) => console.error('endTurn error', err));
    }, TURN_SECONDS * 1000);
  }

  _pickWord(game) {
    const available = WORDS.filter((w) => !game.usedWords.has(w));
    const pool = available.length > 0 ? available : WORDS; // אם נגמרו המילים, מתחילים סבב חדש
    if (available.length === 0) game.usedWords.clear();
    const word = pool[Math.floor(Math.random() * pool.length)];
    game.usedWords.add(word);
    return word;
  }

  handleCorrect(game) {
    if (!game.turnActive) return null;
    game.turnScore += 1;
    game.currentWord = this._pickWord(game);
    return { word: game.currentWord, turnScore: game.turnScore };
  }

  handleSkip(game) {
    if (!game.turnActive) return null;
    game.currentWord = this._pickWord(game);
    return { word: game.currentWord, turnScore: game.turnScore };
  }

  async endTurn(chatId) {
    const game = this.games.get(chatId);
    if (!game || game.status !== 'playing') return;
    if (!game.turnActive) return; // כבר טופל

    game.turnActive = false;
    clearTimeout(game.turnTimeout);

    const team = game.currentTeam;
    const gained = game.turnScore;
    if (team === 1) game.scores.team1 += gained;
    else game.scores.team2 += gained;

    // מודיעים למסך המשחק שהתור נגמר (נועל כפתורים בצד הלקוח)
    this.io.to(game.currentTurnToken).emit('turn_ended', { turnScore: gained });
    this.turnTokens.delete(game.currentTurnToken);
    game.currentTurnToken = null;

    const teamEmoji = team === 1 ? '🔵' : '🔴';
    await this.bot.telegram.sendMessage(
      chatId,
      `⏱ הזמן נגמר! ${teamEmoji} קבוצה ${team} צברה ${gained} נקודות בתור הזה.\n\n` +
        `🔵 קבוצה 1: ${game.scores.team1} נקודות\n` +
        `🔴 קבוצה 2: ${game.scores.team2} נקודות`
    );

    if (game.scores.team1 >= WIN_SCORE || game.scores.team2 >= WIN_SCORE) {
      await this._finishGame(game);
      return;
    }

    // קידום התור: אם עכשיו סיימה קבוצה 2 - עוברים לשחקן הבא בשתי הקבוצות
    if (team === 1) {
      game.currentTeam = 2;
    } else {
      game.currentTeam = 1;
      game.team1Idx = (game.team1Idx + 1) % game.team1.length;
      game.team2Idx = (game.team2Idx + 1) % game.team2.length;
    }

    setTimeout(() => {
      this.startTurn(chatId).catch((err) => console.error('startTurn error', err));
    }, 2500);
  }

  async _finishGame(game) {
    game.status = 'finished';
    const winner = game.scores.team1 >= WIN_SCORE ? 1 : 2;
    const emoji = winner === 1 ? '🔵' : '🔴';
    await this.bot.telegram.sendMessage(
      game.chatId,
      `🏆 קבוצה ${winner} ניצחה! ${emoji}\n\n` +
        `🔵 קבוצה 1: ${game.scores.team1} נקודות\n` +
        `🔴 קבוצה 2: ${game.scores.team2} נקודות\n\n` +
        `כדי לשחק שוב, שלחו /start`
    );
    this.games.delete(game.chatId);
  }
}

function displayName(user) {
  if (user.username) return user.first_name ? `${user.first_name} (@${user.username})` : `@${user.username}`;
  return user.first_name || 'שחקן';
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = GameManager;
