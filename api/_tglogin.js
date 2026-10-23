// Вход через бота Telegram (без виджета и без номера телефона).
// Сайт открывает t.me/<бот>?start=login_<nonce>; бот получает /start через вебхук (api/pay.js),
// создаёт одноразовый вход в Supabase и кладёт его в приватное хранилище; сайт забирает его по nonce.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vsmjjlrgjyujaioknlkn.supabase.co";
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "tglogin";
const TTL = 10 * 60 * 1000;
const NONCE = /^[a-f0-9]{32}$/;

function adminHeaders(extra) {
  const h = { apikey: SECRET, ...(extra || {}) };
  if (SECRET.startsWith("eyJ")) h.Authorization = "Bearer " + SECRET;
  return h;
}

async function tokenFor(from) {
  const tgId = String(from.id).replace(/\D/g, "");
  const email = `telegram-${tgId}@1x6-eta.vercel.app`; // тот же адрес, что и у старого входа: аккаунты сохраняются
  const meta = { provider: "telegram", telegram_id: tgId, full_name: [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 60), user_name: from.username || "" };
  const cr = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ email, email_confirm: true, user_metadata: meta }) });
  if (!cr.ok && cr.status !== 422 && cr.status !== 400) return null;
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: "POST", headers: adminHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ type: "magiclink", email }) });
  const j = await gl.json().catch(() => ({}));
  return (gl.ok && (j.hashed_token || (j.properties && j.properties.hashed_token))) || null;
}

const obj = n => `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${n}.json`;
async function ensureBucket() {
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { method: "POST", headers: adminHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) }).catch(() => {});
}
async function put(nonce, th, extra) {
  const body = JSON.stringify({ th, ...(extra || {}), exp: Date.now() + TTL });
  let r = await fetch(obj(nonce), { method: "POST", headers: adminHeaders({ "Content-Type": "application/json", "x-upsert": "true" }), body });
  if (!r.ok) { await ensureBucket(); r = await fetch(obj(nonce), { method: "POST", headers: adminHeaders({ "Content-Type": "application/json", "x-upsert": "true" }), body }); }
  return r.ok;
}
async function take(nonce, raw) {
  if (!NONCE.test(nonce || "")) return null;
  const r = await fetch(obj(nonce), { headers: adminHeaders() });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: adminHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: [nonce + ".json"] }) }).catch(() => {});
  if (!j || !(j.exp > Date.now())) return null;
  return raw ? j : j.th || null;
}

// включение уведомлений поддержки для админа: сайт кладёт uid под код, бот привязывает chat id
async function linkNotify(code, chatId) {
  const j = await take(code, true); if (!j || !j.uid) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${j.uid}`, { method: "PUT", headers: adminHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ app_metadata: { tg_notify: String(chatId) } }) });
  return r.ok;
}

module.exports = { NONCE, tokenFor, put, take, linkNotify };
