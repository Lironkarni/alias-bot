const crypto = require('crypto');

/**
 * מאמת את ה-initData שמגיע מ-Telegram Mini App בצד השרת.
 * ראה: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * מחזיר { user, authDate } אם תקין, או null אם לא.
 */
function validateInitData(initData, botToken, maxAgeSeconds = 24 * 60 * 60) {
  if (!initData || !botToken) return null;

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  if (!hash) return null;
  urlParams.delete('hash');

  const pairs = [];
  for (const [key, value] of urlParams.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const authDate = parseInt(urlParams.get('auth_date'), 10);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > maxAgeSeconds) return null;

  let user = null;
  const userJson = urlParams.get('user');
  if (userJson) {
    try {
      user = JSON.parse(userJson);
    } catch (e) {
      return null;
    }
  }

  return { user, authDate };
}

module.exports = { validateInitData };
