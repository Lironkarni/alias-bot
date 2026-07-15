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
