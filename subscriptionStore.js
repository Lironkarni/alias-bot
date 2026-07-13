const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const GROUP_KEY_PREFIX = 'alias:group:';
const GROUP_INDEX_KEY = 'alias:groups';

function isConfigured() {
  return Boolean(REST_URL && REST_TOKEN);
}

function groupKey(chatId) {
  return `${GROUP_KEY_PREFIX}${String(chatId)}`;
}

async function redis(command) {
  if (!isConfigured()) {
    throw new Error('Upstash Redis is not configured');
  }

  const response = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(`Upstash Redis request failed (${response.status})`);
  }

  const payload = await response.json();
  if (payload.error) throw new Error(`Upstash Redis error: ${payload.error}`);
  return payload.result;
}

async function getGroup(chatId) {
  const raw = await redis(['GET', groupKey(chatId)]);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid subscription record for group ${chatId}`);
  }
}

async function saveGroup(group) {
  const now = new Date().toISOString();
  const record = {
    ...group,
    chatId: String(group.chatId),
    updatedAt: now,
  };

  await redis(['SET', groupKey(record.chatId), JSON.stringify(record)]);
  await redis(['SADD', GROUP_INDEX_KEY, record.chatId]);
  return record;
}

async function ensureGroup(chat) {
  const chatId = String(chat.id);
  const existing = await getGroup(chatId);

  if (existing) {
    const title = chat.title || existing.title || null;
    if (title !== existing.title) return saveGroup({ ...existing, title });
    return existing;
  }

  const now = new Date().toISOString();
  return saveGroup({
    chatId,
    title: chat.title || null,
    subscriptionExpiresAt: null,
    subscriptionStatus: 'free',
    activatedBy: null,
    createdAt: now,
  });
}

async function setSubscriptionExpiry(chatId, expiresAt, activatedBy = null) {
  const existing = (await getGroup(chatId)) || {
    chatId: String(chatId),
    title: null,
    createdAt: new Date().toISOString(),
  };

  const expiry = expiresAt ? new Date(expiresAt) : null;
  if (expiry && Number.isNaN(expiry.getTime())) {
    throw new Error('Invalid subscription expiry date');
  }

  return saveGroup({
    ...existing,
    subscriptionExpiresAt: expiry ? expiry.toISOString() : null,
    subscriptionStatus: expiry && expiry.getTime() > Date.now() ? 'premium' : 'free',
    activatedBy: activatedBy ? String(activatedBy) : existing.activatedBy || null,
  });
}

async function listGroups() {
  const chatIds = (await redis(['SMEMBERS', GROUP_INDEX_KEY])) || [];
  const groups = await Promise.all(chatIds.map((chatId) => getGroup(chatId)));
  return groups.filter(Boolean);
}

async function activateSubscription({
  chatId,
  expiresAt,
  activatedBy,
  telegramPaymentChargeId,
  isRecurring = true,
}) {
  const existing = await getGroup(chatId);
  if (!existing) throw new Error('Group not found');

  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) throw new Error('Invalid subscription expiry date');

  if (
    existing.telegramPaymentChargeId &&
    existing.telegramPaymentChargeId === telegramPaymentChargeId &&
    existing.subscriptionExpiresAt === expiry.toISOString()
  ) {
    return existing;
  }

  return saveGroup({
    ...existing,
    subscriptionExpiresAt: expiry.toISOString(),
    subscriptionStatus: expiry.getTime() > Date.now() ? 'premium' : 'free',
    activatedBy: String(activatedBy),
    telegramPaymentChargeId,
    isRecurring: Boolean(isRecurring),
    lastPaymentAt: new Date().toISOString(),
  });
}

async function getSubscriptionStatus(chatId) {
  const group = await getGroup(chatId);
  if (!group) return { isPremium: false, expiresAt: null, group: null };

  const expiresAt = group.subscriptionExpiresAt ? new Date(group.subscriptionExpiresAt) : null;
  const isPremium = Boolean(expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > Date.now());
  return { isPremium, expiresAt, group };
}

module.exports = {
  isConfigured,
  ensureGroup,
  getGroup,
  listGroups,
  saveGroup,
  setSubscriptionExpiry,
  activateSubscription,
  getSubscriptionStatus,
};
