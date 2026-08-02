const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const PREFIX = 'alias:custom-words:';
const MAX_WORDS = 500;
const MIN_PLAY_WORDS = 60;

function isConfigured() { return Boolean(REST_URL && REST_TOKEN); }
function key(userId) { return `${PREFIX}${String(userId)}`; }
async function redis(command) {
  if (!isConfigured()) throw new Error('Upstash Redis is not configured');
  const response = await fetch(REST_URL, { method: 'POST', headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  if (!response.ok) throw new Error(`Upstash Redis request failed (${response.status})`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Upstash Redis error: ${payload.error}`);
  return payload.result;
}
function normalizeWord(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
const BLOCKED = new Set(['שרמוטה','קוקסינל','fuck','shit','bitch','motherfucker']);
function validateWord(value) {
  const word = normalizeWord(value);
  if (word.length < 2) return { ok: false, reason: 'קצרה מדי' };
  if (word.length > 30) return { ok: false, reason: 'ארוכה מדי' };
  if (!/^[\p{L}\p{N}\s׳״'"-]+$/u.test(word)) return { ok: false, reason: 'מכילה אימוג׳י או סימנים לא מותרים' };
  if (BLOCKED.has(word.toLocaleLowerCase('he'))) return { ok: false, reason: 'תוכן לא מאושר' };
  return { ok: true, word };
}
async function listWords(userId) {
  const words = (await redis(['SMEMBERS', key(userId)])) || [];
  return words.sort((a, b) => a.localeCompare(b, 'he'));
}
async function addWords(userId, inputWords) {
  const current = new Set(await listWords(userId));
  const added = [], duplicates = [], rejected = [];
  for (const raw of inputWords) {
    const result = validateWord(raw);
    if (!result.ok) { if (normalizeWord(raw)) rejected.push({ word: normalizeWord(raw), reason: result.reason }); continue; }
    if (current.has(result.word)) { duplicates.push(result.word); continue; }
    if (current.size >= MAX_WORDS) { rejected.push({ word: result.word, reason: 'המאגר מלא' }); continue; }
    await redis(['SADD', key(userId), result.word]);
    current.add(result.word); added.push(result.word);
  }
  return { added, duplicates, rejected, count: current.size };
}
async function removeWord(userId, word) { return Number(await redis(['SREM', key(userId), normalizeWord(word)])) > 0; }
async function clearWords(userId) { await redis(['DEL', key(userId)]); }
module.exports = { MAX_WORDS, MIN_PLAY_WORDS, isConfigured, validateWord, listWords, addWords, removeWord, clearWords };
