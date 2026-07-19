const test = require('node:test');
const assert = require('node:assert/strict');

const GameManager = require('./gameManager');

function createManager() {
  return new GameManager(
    { telegram: { sendMessage: async () => {} } },
    { to: () => ({ emit: () => {} }) },
    { botUsername: 'AliasBot', miniAppShortName: 'play' }
  );
}

test('game host can close an active game', () => {
  const manager = createManager();
  manager.createGame(-1001, { id: 10, first_name: 'Host' });

  assert.deepEqual(manager.closeGame(-1001, 10), { ok: true });
  assert.equal(manager.getGame(-1001), undefined);
});

test('group administrator can close a game opened by somebody else', () => {
  const manager = createManager();
  manager.createGame(-1001, { id: 10, first_name: 'Host' });

  assert.deepEqual(manager.closeGame(-1001, 20, { isGroupAdmin: true }), { ok: true });
  assert.equal(manager.getGame(-1001), undefined);
});

test('regular group member cannot close somebody else’s game', () => {
  const manager = createManager();
  manager.createGame(-1001, { id: 10, first_name: 'Host' });

  assert.deepEqual(manager.closeGame(-1001, 20), { error: 'not_host' });
  assert.ok(manager.getGame(-1001));
});

test('team 1 reaching 30 waits until team 2 has played the same number of turns', () => {
  const manager = createManager();
  const game = manager.createGame(-1001, { id: 10, first_name: 'Host' });
  game.scores = { team1: 30, team2: 24 };
  game.completedTurns = { team1: 5, team2: 4 };

  assert.equal(manager._getGameOutcome(game), null);

  game.completedTurns.team2 = 5;
  assert.deepEqual(manager._getGameOutcome(game), { winner: 1 });
});

test('team 2 can win after both teams have played the same number of turns', () => {
  const manager = createManager();
  const game = manager.createGame(-1001, { id: 10, first_name: 'Host' });
  game.scores = { team1: 29, team2: 32 };
  game.completedTurns = { team1: 5, team2: 5 };

  assert.deepEqual(manager._getGameOutcome(game), { winner: 2 });
});

test('a tie at or above 30 starts another full overtime round', () => {
  const manager = createManager();
  const game = manager.createGame(-1001, { id: 10, first_name: 'Host' });
  game.scores = { team1: 31, team2: 31 };
  game.completedTurns = { team1: 6, team2: 6 };

  assert.deepEqual(manager._getGameOutcome(game), { overtime: true });

  game.completedTurns.team1 += 1;
  game.scores.team1 += 2;
  assert.equal(manager._getGameOutcome(game), null);

  game.completedTurns.team2 += 1;
  game.scores.team2 += 1;
  assert.deepEqual(manager._getGameOutcome(game), { winner: 1 });
});

test('skip penalty is premium-only and cannot reduce the current turn below zero', () => {
  const manager = createManager();
  const freeGame = manager.createGame(-1001, { id: 10, first_name: 'Host' });
  assert.deepEqual(manager.toggleSkipPenalty(-1001, 10), { error: 'premium_required' });

  const game = manager.createGame(-1002, { id: 10, first_name: 'Host' }, { isPremium: true });
  assert.equal(manager.toggleSkipPenalty(-1002, 10).game.skipPenaltyEnabled, true);
  game.turnActive = true;
  game.currentWord = 'בדיקה';
  game.turnScore = 1;

  assert.equal(manager.handleSkip(game).turnScore, 0);
  assert.equal(manager.handleSkip(game).turnScore, 0);
});
