const test = require('node:test');
const assert = require('node:assert/strict');

const { createInvoicePayload, parseInvoicePayload } = require('./premium');

test('creates and parses a premium invoice payload', () => {
  const payload = createInvoicePayload('-1001234567890', 987654321);

  assert.equal(payload, 'premium:-1001234567890:987654321');
  assert.deepEqual(parseInvoicePayload(payload), {
    chatId: '-1001234567890',
    userId: '987654321',
  });
});

test('rejects malformed or injected invoice payloads', () => {
  assert.equal(parseInvoicePayload(''), null);
  assert.equal(parseInvoicePayload('premium:group:user'), null);
  assert.equal(parseInvoicePayload('premium:-1001:42:extra'), null);
  assert.equal(parseInvoicePayload('other:-1001:42'), null);
});
