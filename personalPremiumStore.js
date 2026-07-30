const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const USER_KEY_PREFIX = 'alias:personal-premium:';

function isConfigured() {
  return Boolean(REST_URL && REST_TOKEN);
}

function userKey(userId) {
  return `${USER_KEY_PREFIX}${String(userId)}`;
}

function envPremiumUsers() {
  return new Set(
    String(process.env.PERSONAL_PREMIUM_USER_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

async function redis(command) {
  if (!isConfigured()) throw new Error('Upstash Redis is not configured');

  const response = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) throw new Error(`Upstash Redis request failed (${response.status})`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Upstash Redis error: ${payload.error}`);
  return payload.result;
}

async function getUser(userId) {
  if (!isConfigured()) return null;
  const raw = await redis(['GET', userKey(userId)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid personal premium record for user ${userId}`);
  }
}

async function saveUser(record) {
  const saved = {
    ...record,
    userId: String(record.userId),
    updatedAt: new Date().toISOString(),
  };
  await redis(['SET', userKey(saved.userId), JSON.stringify(saved)]);
  return saved;
}

async function setSubscriptionExpiry(userId, expiresAt, metadata = {}) {
  if (!isConfigured()) throw new Error('Upstash Redis is not configured');
  const existing = (await getUser(userId)) || {
    userId: String(userId),
    createdAt: new Date().toISOString(),
  };
  const expiry = expiresAt ? new Date(expiresAt) : null;
  if (expiry && Number.isNaN(expiry.getTime())) throw new Error('Invalid personal premium expiry date');

  return saveUser({
    ...existing,
    ...metadata,
    subscriptionExpiresAt: expiry ? expiry.toISOString() : null,
    subscriptionStatus: expiry && expiry.getTime() > Date.now() ? 'premium' : 'free',
  });
}

async function getSubscriptionStatus(userId) {
  const id = String(userId);
  if (envPremiumUsers().has(id)) {
    return { isPremium: true, expiresAt: null, source: 'environment', user: null };
  }

  const user = await getUser(id);
  if (!user) return { isPremium: false, expiresAt: null, source: 'redis', user: null };

  const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
  const isPremium = Boolean(expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > Date.now());
  return { isPremium, expiresAt, source: 'redis', user };
}

module.exports = {
  isConfigured,
  getUser,
  saveUser,
  setSubscriptionExpiry,
  getSubscriptionStatus,
};