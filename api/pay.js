// Подписка «1x6+»: создание оплаты и приём уведомлений об оплате.
//
//   GET  /api/pay?info            -> какие способы оплаты включены и цены
//   GET  /api/pay?setup=tg        -> подключить вебхук бота (один раз после деплоя)
//   POST /api/pay?trial           -> пробные 3 дня 1x6+, один раз на аккаунт (нужен вход)
//   POST /api/pay?create          -> { url } ссылка на оплату (нужен вход: Authorization: Bearer <токен Supabase>)
//   POST /api/pay?hook=tg|stripe|np -> уведомления от Telegram / Stripe / NOWPayments
//
// Переменные окружения на Vercel (Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN      — уже есть (вход через Telegram). Включает оплату звёздами ⭐
//   SUPABASE_SECRET_KEY     — уже есть
//   STRIPE_SECRET_KEY       — sk_live_... из Stripe → Developers → API keys. Включает карты / Google Pay / Apple Pay / PayPal
//   STRIPE_WEBHOOK_SECRET   — whsec_... из Stripe → Developers → Webhooks (адрес https://blazecrest.vercel.app/api/pay?hook=stripe, событие checkout.session.completed)
//   NOWPAYMENTS_API_KEY     — из NOWPayments → Settings → API keys. Включает крипту
//   NOWPAYMENTS_IPN_SECRET  — из NOWPayments → Settings → Payments → IPN secret key
const crypto = require("crypto");

const SITE = (process.env.SITE_URL || "https://blazecrest.vercel.app").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vsmjjlrgjyujaioknlkn.supabase.co";
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BOT = process.env.TELEGRAM_BOT_TOKEN || "";
const STRIPE = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WH = process.env.STRIPE_WEBHOOK_SECRET || "";
const NP = process.env.NOWPAYMENTS_API_KEY || "";
const NP_IPN = process.env.NOWPAYMENTS_IPN_SECRET || "";

const PLANS = {
  m1: { days: 30, title: "1 месяц", stars: 59, usd: 1.25, rub: 99 },
  m6: { days: 183, title: "6 месяцев", stars: 299, usd: 6.25, rub: 499 },
  y1: { days: 365, title: "1 год", stars: 499, usd: 9.99, rub: 799 }
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const enabled = () => ({ stars: Boolean(BOT && SECRET), card: Boolean(STRIPE && STRIPE_WH && SECRET), crypto: Boolean(NP && NP_IPN && SECRET) });
const tgSecret = () => crypto.createHmac("sha256", BOT).update("1x6-pay-webhook").digest("hex").slice(0, 48);
function adminHeaders() {
  const h = { "Content-Type": "application/json", apikey: SECRET };
  if (SECRET.startsWith("eyJ")) h.Authorization = "Bearer " + SECRET;
  return h;
}
function rawBody(req) {
  if (req.readableEnded) { const b = req.body; return Promise.resolve(Buffer.isBuffer(b) ? b : Buffer.from(typeof b === "string" ? b : JSON.stringify(b || {}))); }
  return new Promise((ok, bad) => { const ch = []; req.on("data", c => ch.push(c)); req.on("end", () => ok(Buffer.concat(ch))); req.on("error", bad); });
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}
async function siteUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SECRET, Authorization: "Bearer " + m[1] } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && UUID.test(u.id || "") ? u : null;
}
async function grant(uid, planKey, payId, provider, amount, currency) {
  const p = PLANS[planKey];
  if (!p || !UUID.test(uid || "")) throw new Error("bad_grant");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/grant_premium`, {
    method: "POST", headers: adminHeaders(),
    body: JSON.stringify({ p_user: uid, p_days: p.days, p_pay_id: payId, p_provider: provider, p_plan: planKey, p_amount: String(amount), p_currency: String(currency) })
  });
  if (!r.ok) throw new Error("grant_failed " + (await r.text()).slice(0, 200));
  return r.json();
}
const untilRu = iso => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Kyiv" });

// ---------- пробные 3 дня: только если у аккаунта ещё не было ни оплат, ни подписки ----------
async function trial(req, res) {
  if (!SECRET) return res.status(503).json({ error: "not_configured" });
  const user = await siteUser(req);
  if (!user) return res.status(401).json({ error: "login_required" });
  const q = async path => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: adminHeaders() }); if (!r.ok) throw new Error("db " + r.status); return r.json(); };
  const [pays, subs] = await Promise.all([q(`payments?select=id&user_id=eq.${user.id}&limit=1`), q(`subscriptions?select=user_id&user_id=eq.${user.id}&limit=1`)]);
  if (pays.length || subs.length) return res.status(409).json({ error: "trial_used" });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/grant_premium`, { method: "POST", headers: adminHeaders(),
    body: JSON.stringify({ p_user: user.id, p_days: 3, p_pay_id: "trial:" + user.id, p_provider: "trial", p_plan: "trial", p_amount: "0", p_currency: "" }) });
  if (!r.ok) throw new Error("grant_failed " + (await r.text()).slice(0, 200));
  const j = await r.json();
  if (j && j.status === "duplicate") return res.status(409).json({ error: "trial_used" });
  return res.status(200).json({ until: j && j.until });
}

// ---------- создание оплаты ----------
async function create(req, res, body) {
  const on = enabled(), plan = PLANS[body.plan], provider = body.provider;
  if (!plan) return res.status(400).json({ error: "bad_plan" });
  if (!on[provider]) return res.status(503).json({ error: "not_configured" });
  const user = await siteUser(req);
  if (!user) return res.status(401).json({ error: "login_required" });
  const back = `${SITE}/#premium`;

  if (provider === "stars") {
    const j = await tg("createInvoiceLink", {
      title: `1x6+ — ${plan.title}`, description: `Подписка 1x6+ на сайте Blazecrest на ${plan.title}: значок, рамки, опыт ×1.5, длинные посты и полная статистика.`,
      payload: `${user.id}:${body.plan}`, currency: "XTR", prices: [{ label: `1x6+ ${plan.title}`, amount: plan.stars }]
    });
    if (!j.ok) return res.status(502).json({ error: "tg_failed", detail: String(j.description || "").slice(0, 200) });
    return res.status(200).json({ url: j.result });
  }
  if (provider === "card") {
    const f = new URLSearchParams({
      mode: "payment", success_url: back + "-ok", cancel_url: back, client_reference_id: user.id,
      "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(Math.round(plan.usd * 100)),
      "line_items[0][price_data][product_data][name]": `1x6+ — ${plan.title}`,
      "metadata[uid]": user.id, "metadata[plan]": body.plan
    });
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: "Bearer " + STRIPE, "Content-Type": "application/x-www-form-urlencoded" }, body: f });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) return res.status(502).json({ error: "stripe_failed", detail: String((j.error && j.error.message) || "").slice(0, 200) });
    return res.status(200).json({ url: j.url });
  }
  if (provider === "crypto") {
    const r = await fetch("https://api.nowpayments.io/v1/invoice", {
      method: "POST", headers: { "x-api-key": NP, "Content-Type": "application/json" },
      body: JSON.stringify({ price_amount: plan.usd, price_currency: "usd", order_id: `${user.id}:${body.plan}:${Date.now()}`, order_description: `1x6+ — ${plan.title}`,
        ipn_callback_url: `${SITE}/api/pay?hook=np`, success_url: back + "-ok", cancel_url: back })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.invoice_url) return res.status(502).json({ error: "np_failed", detail: String(j.message || "").slice(0, 200) });
    return res.status(200).json({ url: j.invoice_url });
  }
  return res.status(400).json({ error: "bad_provider" });
}

// ---------- уведомления ----------
async function hookTg(req, res, body) {
  if (!BOT || !safeEq(req.headers["x-telegram-bot-api-secret-token"] || "", tgSecret())) return res.status(401).end();
  const pq = body.pre_checkout_query;
  if (pq) {
    const [uid, planKey] = String(pq.invoice_payload || "").split(":"), p = PLANS[planKey];
    const ok = Boolean(p && UUID.test(uid || "") && pq.currency === "XTR" && pq.total_amount === p.stars);
    await tg("answerPreCheckoutQuery", ok ? { pre_checkout_query_id: pq.id, ok: true } : { pre_checkout_query_id: pq.id, ok: false, error_message: "Счёт устарел — открой оплату на сайте ещё раз." });
    return res.status(200).end();
  }
  const msg = body.message;
  if (msg && msg.successful_payment) {
    const sp = msg.successful_payment, [uid, planKey] = String(sp.invoice_payload || "").split(":");
    try {
      const g = await grant(uid, planKey, "tg:" + sp.telegram_payment_charge_id, "stars", sp.total_amount, sp.currency);
      await tg("sendMessage", { chat_id: msg.chat.id, text: `👑 Подписка 1x6+ активна до ${untilRu(g.until)}!\nСпасибо, что поддерживаешь проект. Обнови сайт: ${SITE}` });
    } catch (e) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Оплата получена, но подписку не удалось включить автоматически. Напиши администратору канала — включим вручную." });
    }
    return res.status(200).end();
  }
  const lg = msg && msg.chat && msg.from && typeof msg.text === "string" && /^\/start login_([a-f0-9]{32})\s*$/.exec(msg.text);
  const nf = msg && msg.chat && typeof msg.text === "string" && /^\/start notify_([a-f0-9]{32})\s*$/.exec(msg.text);
  if (nf) {
    let ok = false; try { ok = await require("./_tglogin").linkNotify(nf[1], msg.chat.id); } catch (e) {}
    await tg("sendMessage", { chat_id: msg.chat.id, text: ok ? "🔔 Уведомления Blazecrest включены. Сюда будут приходить новые сообщения в поддержку." : "Ссылка устарела. Нажми «Уведомления в Telegram» на сайте ещё раз." });
    return res.status(200).end();
  }
  if (lg) {
    const L = require("./_tglogin");
    let ok = false;
    try { const th = await L.tokenFor(msg.from); ok = Boolean(th && await L.put(lg[1], th)); } catch (e) {}
    await tg("sendMessage", ok
      ? { chat_id: msg.chat.id, text: "✅ Вход в Blazecrest подтверждён!\nВернись на сайт — ты уже вошёл. Если вкладка закрыта, открой сайт и нажми «Войти через Telegram» ещё раз.", reply_markup: { inline_keyboard: [[{ text: "Открыть Blazecrest", url: SITE }]] } }
      : { chat_id: msg.chat.id, text: "Не получилось подтвердить вход. Вернись на сайт и нажми «Войти через Telegram» ещё раз." });
    return res.status(200).end();
  }
  if (msg && msg.chat && typeof msg.text === "string" && /^\/(paysupport|terms)/.test(msg.text)) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: "Подписка 1x6+ — цифровая услуга сайта Blazecrest: значок, рамки, бонусы опыта, длинные посты и полная статистика. Включается сразу после оплаты на выбранный срок, сама не продлевается.\nПроблема с оплатой или подпиской? Напиши администратору в канал: https://t.me/+swCyihkKvwU4NTBi — укажи ник на сайте и время оплаты." });
    return res.status(200).end();
  }
  if (msg && msg.chat && typeof msg.text === "string" && /^\/(start|premium|help)/.test(msg.text)) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: `Привет! Это бот сайта Blazecrest.\nСборки, мини-игры и рейтинг: ${SITE}\nПодписку 1x6+ можно оформить на сайте в профиле → «👑 1x6+».` });
  }
  return res.status(200).end();
}

async function hookStripe(req, res, raw) {
  const sig = String(req.headers["stripe-signature"] || ""), parts = {};
  sig.split(",").forEach(kv => { const [k, v] = kv.split("="); (parts[k] = parts[k] || []).push(v); });
  const t = parts.t && parts.t[0];
  if (!STRIPE_WH || !t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return res.status(400).end();
  const exp = crypto.createHmac("sha256", STRIPE_WH).update(`${t}.${raw.toString("utf8")}`).digest("hex");
  if (!(parts.v1 || []).some(v => safeEq(v, exp))) return res.status(400).end();
  const ev = JSON.parse(raw.toString("utf8"));
  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    const s = ev.data.object;
    if (s.payment_status === "paid" && s.metadata) {
      const p = PLANS[s.metadata.plan];
      if (p && s.amount_total >= Math.round(p.usd * 100)) await grant(s.metadata.uid, s.metadata.plan, "stripe:" + s.id, "card", s.amount_total / 100, s.currency);
    }
  }
  return res.status(200).json({ received: true });
}

function sortDeep(o) {
  if (Array.isArray(o)) return o.map(sortDeep);
  if (o && typeof o === "object") return Object.keys(o).sort().reduce((a, k) => (a[k] = sortDeep(o[k]), a), {});
  return o;
}
async function hookNp(req, res, body) {
  const exp = crypto.createHmac("sha512", NP_IPN).update(JSON.stringify(sortDeep(body))).digest("hex");
  if (!NP_IPN || !safeEq(req.headers["x-nowpayments-sig"] || "", exp)) return res.status(400).end();
  if (body.payment_status === "finished") {
    const [uid, planKey] = String(body.order_id || "").split(":"), p = PLANS[planKey];
    if (p && Number(body.price_amount) >= p.usd) await grant(uid, planKey, "np:" + body.payment_id, "crypto", body.price_amount, body.price_currency);
  }
  return res.status(200).end();
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const q = req.query || {};
  try {
    if (req.method === "GET") {
      if (q.setup === "tg") {
        if (!BOT) return res.status(503).json({ error: "not_configured" });
        const j = await tg("setWebhook", { url: `${SITE}/api/pay?hook=tg`, secret_token: tgSecret(), allowed_updates: ["message", "pre_checkout_query"] });
        return res.status(200).json({ ok: Boolean(j.ok), description: j.description || "" });
      }
      return res.status(200).json({ enabled: enabled(), plans: PLANS });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    const raw = await rawBody(req);
    if (q.hook === "stripe") return await hookStripe(req, res, raw);
    let body = {};
    try { body = JSON.parse(raw.toString("utf8") || "{}"); } catch (e) { return res.status(400).json({ error: "bad_json" }); }
    if (q.hook === "tg") return await hookTg(req, res, body);
    if (q.hook === "np") return await hookNp(req, res, body);
    if ("trial" in q) return await trial(req, res);
    return await create(req, res, body);
  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
};
module.exports.config = { api: { bodyParser: false } };
