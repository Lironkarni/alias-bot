const { v4: uuidv4 } = require('uuid');
const { getWordPool, nextDifficulty, DIFFICULTY_LABELS } = require('./words');

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

  createGame(chatId, host, { isPremium = false } = {}) {
    const game = {
      chatId,
      hostId: host.id,
      hostName: displayName(host),
      status: 'lobby', // lobby | playing | finished
      difficulty: 'easy',
      isPremium,
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
      turnWords: [], // { word, result: 'correct' | 'skipped' | 'incomplete' } - לתור הנוכחי
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
    lines.push(`🎯 רמת קושי: ${DIFFICULTY_LABELS[game.difficulty]}`);
    lines.push(`מנהל המשחק: ${game.hostName}`);
    return lines.join('\n');
  }

  lobbyKeyboard(game) {
    const rows = [[{ text: '✋ הצטרף למשחק', callback_data: 'join' }]];

    if (game.isPremium) {
      rows.push([
        { text: `🎯 קושי: ${DIFFICULTY_LABELS[game.difficulty]} (מנהל בלבד)`, callback_data: 'cycle_difficulty' },
      ]);
    }

    rows.push([{ text: '▶️ התחל משחק', callback_data: 'start_game' }]);
    return { inline_keyboard: rows };
  }

  cycleDifficulty(chatId, requesterId) {
    const game = this.games.get(chatId);
    if (!game || game.status !== 'lobby') return { error: 'invalid_state' };
    if (requesterId !== game.hostId) return { error: 'not_host' };
    if (!game.isPremium) return { error: 'premium_required' };
    game.difficulty = nextDifficulty(game.difficulty);
    return { ok: true, game };
  }

  // ---------- התחלת משחק וחלוקה לקבוצות ----------

  startGame(chatId) {
    const game = this.games.get(chatId);
    if (!game) return { error: 'no_game' };
    if (game.status !== 'lobby') return { error: 'already_started' };
    if (game.players.length < 4) return { error: 'not_enough_players' };
    if (!game.isPremium) game.difficulty = 'easy';

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
    return `🎭 המשחק מתחיל! (קושי: ${DIFFICULTY_LABELS[game.difficulty]})\n\n🔵 קבוצה 1: ${t1}\n🔴 קבוצה 2: ${t2}`;
  }

  // ---------- ניהול שחקנים ----------

  playersListText(game) {
    const lines = ['👥 רשימת משתתפים:', ''];
    if (game.status === 'playing') {
      lines.push('🔵 קבוצה 1:');
      game.team1.forEach((p, i) => lines.push(`${i + 1}. ${p.name}${game.currentPlayer && game.currentPlayer.id === p.id ? ' 🎤' : ''}`));
      lines.push('');
      lines.push('🔴 קבוצה 2:');
      game.team2.forEach((p, i) => lines.push(`${i + 1}. ${p.name}${game.currentPlayer && game.currentPlayer.id === p.id ? ' 🎤' : ''}`));
    } else {
      game.players.forEach((p, i) => lines.push(`${i + 1}. ${p.name}`));
    }
    lines.push('');
    lines.push('מנהל המשחק יכול להסיר שחקן בלחיצה על הכפתור המתאים:');
    return lines.join('\n');
  }

  playersKeyboard(game) {
    const list = game.status === 'playing' ? game.players : game.players;
    return {
      inline_keyboard: list.map((p) => [{ text: `❌ הסר את ${p.name}`, callback_data: `remove_player:${p.id}` }]),
    };
  }

  joinMidGame(chatId, user) {
    const game = this.games.get(chatId);
    if (!game) return { error: 'no_game' };
    if (game.players.some((p) => p.id === user.id)) return { error: 'already_joined' };

    const player = { id: user.id, name: displayName(user) };
    game.players.push(player);

    if (game.status === 'lobby') return { ok: true, phase: 'lobby' };

    if (game.status === 'playing') {
      const targetKey = game.team1.length <= game.team2.length ? 'team1' : 'team2';
      game[targetKey].push(player);
      return { ok: true, phase: 'playing', team: targetKey === 'team1' ? 1 : 2 };
    }

    return { error: 'invalid_state' };
  }

  removePlayer(chatId, targetUserId, requesterId) {
    const game = this.games.get(chatId);
    if (!game) return { error: 'no_game' };
    if (requesterId !== game.hostId) return { error: 'not_host' };

    if (game.status === 'lobby') {
      const before = game.players.length;
      game.players = game.players.filter((p) => p.id !== targetUserId);
      if (game.players.length === before) return { error: 'not_found' };
      return { ok: true };
    }

    if (game.status === 'playing') {
      let removed = false;
      let wasCurrent = false;

      for (const teamKey of ['team1', 'team2']) {
        const idx = game[teamKey].findIndex((p) => p.id === targetUserId);
        if (idx === -1) continue;
        game[teamKey].splice(idx, 1);
        removed = true;

        const idxField = teamKey === 'team1' ? 'team1Idx' : 'team2Idx';
        if (game[teamKey].length === 0) {
          game[idxField] = 0;
        } else if (idx <= game[idxField]) {
          game[idxField] = ((game[idxField] - 1) + game[teamKey].length) % game[teamKey].length;
        }
        break;
      }

      if (!removed) return { error: 'not_found' };

      game.players = game.players.filter((p) => p.id !== targetUserId);

      if (game.currentPlayer && game.currentPlayer.id === targetUserId) wasCurrent = true;
      return { ok: true, wasCurrent };
    }

    return { error: 'invalid_state' };
  }

  // ---------- סגירת משחק ----------

  closeGame(chatId, requesterId) {
    const game = this.games.get(chatId);
    if (!game) return { error: 'no_game' };
    if (requesterId !== game.hostId) return { error: 'not_host' };

    clearTimeout(game.turnTimeout);
    if (game.currentTurnToken) {
      this.io.to(game.currentTurnToken).emit('turn_ended', { turnScore: game.turnScore, reason: 'game_closed' });
      this.turnTokens.delete(game.currentTurnToken);
    }
    this.games.delete(chatId);
    return { ok: true };
  }

  // ---------- ניהול תורות ----------

  async startTurn(chatId) {
    const game = this.games.get(chatId);
    if (!game || game.status !== 'playing') return;

    let teamArr = game.currentTeam === 1 ? game.team1 : game.team2;
    if (teamArr.length === 0) {
      // הקבוצה הנוכחית התרוקנה משחקנים - עוברים לקבוצה השנייה
      game.currentTeam = game.currentTeam === 1 ? 2 : 1;
      teamArr = game.currentTeam === 1 ? game.team1 : game.team2;
      if (teamArr.length === 0) {
        await this.bot.telegram.sendMessage(chatId, 'אין מספיק שחקנים כדי להמשיך את המשחק. המשחק הופסק.');
        this.games.delete(chatId);
        return;
      }
    }

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
    game.turnWords = [];

    const teamEmoji = game.currentTeam === 1 ? '🔵' : '🔴';
    const text =
      `${teamEmoji} התור של קבוצה ${game.currentTeam}\n` +
      `🎤 המסביר: ${player.name}\n\n` +
      `לחצו על הכפתור כדי לפתוח את מסך המשחק.\n` +
      `רק ${player.name} יוכל לראות את המילים - הזהות מאומתת בשרת.`;

    const miniAppUrl = `https://t.me/${this.botUsername}/${this.miniAppShortName}?startapp=${token}`;

    await this.bot.telegram.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎮 פתח מסך משחק', url: miniAppUrl }],
          [{ text: '⏭ דלג על התור (מנהל בלבד)', callback_data: 'skip_turn' }],
        ],
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
      this._concludeTurn(game.chatId, 'timeout').catch((err) => console.error('endTurn error', err));
    }, TURN_SECONDS * 1000);
  }

  _pickWord(game) {
    const pool = getWordPool(game.difficulty);
    const available = pool.filter((w) => !game.usedWords.has(w));
    const source = available.length > 0 ? available : pool; // אם נגמרו המילים, מתחילים סבב חדש
    if (available.length === 0) game.usedWords.clear();
    const word = source[Math.floor(Math.random() * source.length)];
    game.usedWords.add(word);
    return word;
  }

  handleCorrect(game) {
    if (!game.turnActive) return null;
    if (game.currentWord) game.turnWords.push({ word: game.currentWord, result: 'correct' });
    game.turnScore += 1;
    game.currentWord = this._pickWord(game);
    return { word: game.currentWord, turnScore: game.turnScore };
  }

  handleSkip(game) {
    if (!game.turnActive) return null;
    if (game.currentWord) game.turnWords.push({ word: game.currentWord, result: 'skipped' });
    game.currentWord = this._pickWord(game);
    return { word: game.currentWord, turnScore: game.turnScore };
  }

  // תור נגמר עם הזמן (נקרא אוטומטית מהטיימר)
  async endTurn(chatId) {
    return this._concludeTurn(chatId, 'timeout');
  }

  // מנהל המשחק דילג ידנית על התור (לחיצה על "דלג על התור", או הסרת המסביר הנוכחי)
  async forceEndTurnByHost(chatId) {
    return this._concludeTurn(chatId, 'host_skip');
  }

  async _concludeTurn(chatId, reason) {
    const game = this.games.get(chatId);
    if (!game || game.status !== 'playing') return;
    if (!game.currentTurnToken) return; // כבר טופל

    clearTimeout(game.turnTimeout);
    const wasActive = game.turnActive;
    if (wasActive && game.currentWord) {
      game.turnWords.push({ word: game.currentWord, result: 'incomplete' });
    }
    game.currentWord = null;
    game.turnActive = false;

    const team = game.currentTeam;
    const gained = game.turnScore;
    if (team === 1) game.scores.team1 += gained;
    else game.scores.team2 += gained;

    this.io.to(game.currentTurnToken).emit('turn_ended', { turnScore: gained, reason });
    this.turnTokens.delete(game.currentTurnToken);
    game.currentTurnToken = null;

    const teamEmoji = team === 1 ? '🔵' : '🔴';
    const intro =
      reason === 'host_skip'
        ? `⏭ מנהל המשחק דילג על התור של ${teamEmoji} קבוצה ${team}.`
        : `⏱ הזמן נגמר! ${teamEmoji} קבוצה ${team} צברה ${gained} נקודות בתור הזה.`;

    const summary = this._wordsSummaryText(game.turnWords);

    await this.bot.telegram.sendMessage(
      chatId,
      [intro, summary, '', `🔵 קבוצה 1: ${game.scores.team1} נקודות`, `🔴 קבוצה 2: ${game.scores.team2} נקודות`]
        .filter(Boolean)
        .join('\n')
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
      if (game.team1.length > 0) game.team1Idx = (game.team1Idx + 1) % game.team1.length;
      if (game.team2.length > 0) game.team2Idx = (game.team2Idx + 1) % game.team2.length;
    }

    setTimeout(() => {
      this.startTurn(chatId).catch((err) => console.error('startTurn error', err));
    }, 2500);
  }

  _wordsSummaryText(turnWords) {
    if (!turnWords || turnWords.length === 0) return 'לא הספיקו להגיע למילה בתור הזה.';
    const correct = turnWords.filter((w) => w.result === 'correct').map((w) => w.word);
    const skipped = turnWords.filter((w) => w.result === 'skipped').map((w) => w.word);
    const incomplete = turnWords.filter((w) => w.result === 'incomplete').map((w) => w.word);
    const lines = [];
    if (correct.length) lines.push(`✅ נוחשו (${correct.length}): ${correct.join(', ')}`);
    if (skipped.length) lines.push(`⏭ דולגו (${skipped.length}): ${skipped.join(', ')}`);
    if (incomplete.length) lines.push(`⏳ באמצע: ${incomplete.join(', ')}`);
    return lines.join('\n');
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
