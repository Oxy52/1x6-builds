// Вход через Telegram для Blazecrest.
// GET  /api/telegram          -> { enabled, bot_id }  (публичные данные для кнопки)
// POST /api/telegram {user}   -> { token_hash }        (проверяет подпись Telegram и выдаёт одноразовый вход в Supabase)
// POST /api/telegram?act=link {user}  + Bearer JWT админа -> уведомления о новых сообщениях поддержки в Telegram
// POST /api/telegram?act=notify {id}  + Bearer JWT автора  -> бот пишет админам о новом сообщении в поддержку
//
// Переменные окружения на Vercel (Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN        — токен бота от @BotFather (секрет)
//   SUPABASE_SECRET_KEY       — secret / service_role ключ Supabase (секрет)
//   SUPABASE_URL              — необязательно, по умолчанию адрес проекта ниже
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://vsmjjlrgjyujaioknlkn.supabase.co";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const MAX_AGE = 24 * 60 * 60; // подпись Telegram действительна сутки

function adminHeaders() {
  const h = { "Content-Type": "application/json", apikey: SECRET };
  if (SECRET.startsWith("eyJ")) h.Authorization = "Bearer " + SECRET; // старый service_role JWT
  return h;
}

function verify(data) {
  if (!data || typeof data !== "object" || !data.hash || !data.id || !data.auth_date) return "bad_data";
  const { hash, ...rest } = data;
  const check = Object.keys(rest).filter(k => rest[k] !== undefined && rest[k] !== null && rest[k] !== "")
    .sort().map(k => `${k}=${rest[k]}`).join("\n");
  const secret = crypto.createHash("sha256").update(BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(calc, "hex"), b = Buffer.from(String(hash), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "bad_hash";
  if (Math.floor(Date.now() / 1000) - Number(data.auth_date) > MAX_AGE) return "expired";
  return null;
}

const SITE = (process.env.SITE_URL || "https://blazecrest.vercel.app").replace(/\/$/, "");
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_tJy3dl_kfNZXP6PXMqsQVQ_RUXqoPmn";
async function whoAmI(req) {
  const tok = String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); if (!tok) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUB, Authorization: "Bearer " + tok } });
  if (!r.ok) return null; const u = await r.json().catch(() => null); return u && u.id ? u : null;
}
const rest = (path, opt) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...(opt || {}), headers: { ...adminHeaders(), ...((opt || {}).headers || {}) } });
async function adminIds() { const r = await rest("admins?select=user_id"); const j = r.ok ? await r.json() : []; return (j || []).map(x => x.user_id); }
async function tgSend(chat, text) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) });
  return r.ok;
}
let BOTNAME = "";
async function botName() {
  if (BOTNAME) return BOTNAME;
  try { const j = await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(5000) })).json(); BOTNAME = (j.result && j.result.username) || ""; } catch (e) {}
  return BOTNAME;
}
const sent = new Set();
// уведомления поддержки: chat id админа хранится в app_metadata его аккаунта (без новых таблиц)
async function act(req, res, a, body) {
  const me = await whoAmI(req); if (!me) return res.status(401).json({ error: "login" });
  if (a === "link") {
    const admins = await adminIds(); if (!admins.includes(me.id)) return res.status(403).json({ error: "not_admin" });
    const err = verify(body && body.user); if (err) return res.status(401).json({ error: err });
    const chat = String(body.user.id).replace(/\D/g, "");
    const up = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${me.id}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ app_metadata: { tg_notify: chat } }) });
    if (!up.ok) return res.status(502).json({ error: "save_failed" });
    const ok = await tgSend(chat, "✅ Уведомления Blazecrest включены. Сюда будут приходить новые сообщения в поддержку.");
    return res.status(200).json({ ok: true, delivered: ok });
  }
  if (a === "notifycode") {
    const admins = await adminIds(); if (!admins.includes(me.id)) return res.status(403).json({ error: "not_admin" });
    const nonce = crypto.randomBytes(16).toString("hex");
    if (!await require("./_tglogin").put(nonce, null, { uid: me.id })) return res.status(502).json({ error: "save_failed" });
    return res.status(200).json({ nonce, bot: await botName() });
  }
  if (a === "notify") {
    const id = Number(body && body.id); if (!id || sent.has(id)) return res.status(200).json({ ok: true });
    const r = await rest(`support_messages?id=eq.${id}&select=id,user_id,sender,body,created_at`); const m = r.ok ? (await r.json())[0] : null;
    if (!m || m.user_id !== me.id || m.sender !== "user" || Date.now() - Date.parse(m.created_at) > 5 * 60e3) return res.status(200).json({ ok: false });
    sent.add(id);
    const pr = await rest(`profiles?id=eq.${me.id}&select=nick`); const nick = (pr.ok ? ((await pr.json())[0] || {}).nick : "") || (me.user_metadata && (me.user_metadata.full_name || me.user_metadata.user_name)) || "Игрок";
    const text = `💬 Новое сообщение в поддержку\nОт: ${nick}\n\n${String(m.body).slice(0, 3000)}\n\nОтветить: ${SITE}/?support=1`;
    let n = 0;
    for (const aid of await adminIds()) {
      const u = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${aid}`, { headers: adminHeaders() }); const j = u.ok ? await u.json() : null;
      const chat = j && j.app_metadata && j.app_metadata.tg_notify; if (chat && await tgSend(chat, text)) n++;
    }
    return res.status(200).json({ ok: true, sent: n });
  }
  return res.status(400).json({ error: "bad_act" });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const enabled = Boolean(BOT_TOKEN && SECRET);
  if (req.method === "GET") {
    const q = req.query || {};
    if (q.poll) {
      if (!enabled) return res.status(503).json({ error: "not_configured" });
      const th = await require("./_tglogin").take(String(q.poll)).catch(() => null);
      return res.status(200).json(th ? { token_hash: th } : { wait: true });
    }
    return res.status(200).json({ enabled, bot_id: enabled ? BOT_TOKEN.split(":")[0] : null, bot: enabled ? await botName() : null });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!enabled) return res.status(503).json({ error: "not_configured" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const a = String((req.query || {}).act || "");
  if (a) { try { return await act(req, res, a, body); } catch (e) { return res.status(500).json({ error: "server_error" }); } }
  const user = body && body.user;
  const err = verify(user);
  if (err) return res.status(401).json({ error: err });

  const tgId = String(user.id).replace(/\D/g, "");
  const email = `telegram-${tgId}@1x6-eta.vercel.app`;
  const meta = {
    provider: "telegram",
    telegram_id: tgId,
    full_name: [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 60),
    user_name: user.username || "",
    avatar_url: /^https:\/\//.test(user.photo_url || "") ? user.photo_url : ""
  };

  try {
    // 1) создаём пользователя (если уже есть — Supabase вернёт ошибку, это нормально)
    const cr = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: adminHeaders(),
      body: JSON.stringify({ email, email_confirm: true, user_metadata: meta })
    });
    if (!cr.ok && cr.status !== 422 && cr.status !== 400) {
      const t = await cr.text();
      return res.status(502).json({ error: "create_failed", detail: t.slice(0, 200) });
    }
    // 2) одноразовый токен входа (письмо не отправляется)
    const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST", headers: adminHeaders(),
      body: JSON.stringify({ type: "magiclink", email, data: meta })
    });
    const j = await gl.json().catch(() => ({}));
    const token_hash = j.hashed_token || (j.properties && j.properties.hashed_token);
    if (!gl.ok || !token_hash) return res.status(502).json({ error: "link_failed", detail: JSON.stringify(j).slice(0, 200) });
    return res.status(200).json({ token_hash });
  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
};
