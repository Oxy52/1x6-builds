// Вход через Telegram для 1x6 Билды.
// GET  /api/telegram          -> { enabled, bot_id }  (публичные данные для кнопки)
// POST /api/telegram {user}   -> { token_hash }        (проверяет подпись Telegram и выдаёт одноразовый вход в Supabase)
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

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const enabled = Boolean(BOT_TOKEN && SECRET);
  if (req.method === "GET") {
    return res.status(200).json({ enabled, bot_id: enabled ? BOT_TOKEN.split(":")[0] : null });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!enabled) return res.status(503).json({ error: "not_configured" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
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
