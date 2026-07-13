const test = require('node:test');
const assert = require('node:assert/strict');

const { PREMIUM_PACKAGES, createInvoicePayload, parseInvoicePayload } = require('./premium');

test('defines the requested prepaid premium packages', () => {
  assert.deepEqual(PREMIUM_PACKAGES.month, {
    code: 'month',
    label: 'חודש',
    price: 100,
    days: 30,
  });
  assert.deepEqual(PREMIUM_PACKAGES.quarter, {
    code: 'quarter',
    label: '3 חודשים',
    price: 200,
    days: 90,
  });
  assert.deepEqual(PREMIUM_PACKAGES.year, {
    code: 'year',
    label: 'שנה',
    price: 600,
    days: 365,
  });
});

test('creates and parses a premium package invoice payload', () => {
  const payload = createInvoicePayload('-1001234567890', 987654321, 'quarter');

  assert.equal(payload, 'premium:-1001234567890:987654321:quarter');
  assert.deepEqual(parseInvoicePayload(payload), {
    chatId: '-1001234567890',
    userId: '987654321',
    packageCode: 'quarter',
  });
});

test('rejects malformed or injected invoice payloads', () => {
  assert.equal(parseInvoicePayload(''), null);
  assert.equal(parseInvoicePayload('premium:-1001:42'), null);
  assert.equal(parseInvoicePayload('premium:-1001:42:invalid'), null);
  assert.equal(parseInvoicePayload('premium:-1001:42:month:extra'), null);
  assert.equal(parseInvoicePayload('other:-1001:42:year'), null);
});
