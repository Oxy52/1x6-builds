// Своя иконка тега ника (подписка 1x6+): проверка на 18+ и загрузка в хранилище.
//   POST /api/tagicon  { png: "<base64 PNG до 128×128>" }  (нужен вход: Authorization: Bearer <токен Supabase>)
//   -> { ok: true, v } | { error: "nsfw" | "login_required" | "premium_required" | "bad_image" | ... }
// Проверка: нейросеть NSFW.js прямо на сервере (бесплатно, без ключей); если на Vercel задан ANTHROPIC_API_KEY —
// дополнительно смотрит Claude (ловит то, что NSFW.js не умеет: свастики, кровь, наркотики).
// Сам браузер записать tag.png не может — это запрещено правилами хранилища, пишет только этот сервер.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vsmjjlrgjyujaioknlkn.supabase.co";
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const AKEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.AI_MODEL || "claude-haiku-5-5";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminHeaders(extra) {
  const h = { apikey: SECRET, ...extra };
  if (SECRET.startsWith("eyJ")) h.Authorization = "Bearer " + SECRET;
  return h;
}
async function siteUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SECRET, Authorization: "Bearer " + m[1] } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && UUID.test(u.id || "") ? u : null;
}
async function premium(uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_premium`, { method: "POST", headers: adminHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ p_user: uid }) });
  return r.ok && (await r.json()) === true;
}

// модель грузится один раз на экземпляр функции
let MODEL_P = null;
const nsfwModel = () => MODEL_P || (MODEL_P = (async () => { const tf = require("@tensorflow/tfjs"), nsfw = require("nsfwjs"); await tf.ready(); return { tf, m: await nsfw.load("MobileNetV2") }; })().catch(e => { MODEL_P = null; throw e; }));

async function nsfwCheck(png) {
  const { tf, m } = await nsfwModel();
  // прозрачные места кладём на серый фон, иначе модель видит чёрное
  const px = new Uint8Array(png.width * png.height * 3);
  for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) { const a = png.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) px[j + c] = Math.round(png.data[i + c] * a + 128 * (1 - a)); }
  const img = tf.tensor3d(px, [png.height, png.width, 3]);
  try {
    const p = Object.fromEntries((await m.classify(img, 5)).map(x => [x.className, x.probability]));
    return { bad: (p.Porn || 0) >= 0.35 || (p.Hentai || 0) >= 0.45 || (p.Sexy || 0) >= 0.6, p };
  } finally { img.dispose(); }
}

async function claudeCheck(b64) {
  if (!AKEY) return { bad: false, skipped: true };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 10, system: "Ты модератор игрового сайта. Тебе показывают маленькую иконку для значка рядом с ником. Ответь одним словом: BAD — если на ней нагота, секс, порно, кровь и жестокость, нацистская или другая символика ненависти, наркотики или оскорбление; иначе OK.",
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }, { type: "text", text: "OK или BAD?" }] }] })
  });
  const j = await r.json().catch(() => ({}));
  const t = ((j.content || [])[0] || {}).text || "";
  return { bad: /BAD/i.test(t), skipped: !r.ok };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" && req.query.selftest === "1") { try { const t = Date.now(), fs = require("fs"), path = require("path");
    const png = require("pngjs").PNG.sync.read(fs.readFileSync(path.join(process.cwd(), "games", "cs-tag.png"))); const r = await nsfwCheck(png); return res.status(200).json({ ms: Date.now() - t, ...r }); } catch (e) { return res.status(500).json({ error: String(e.message).slice(0, 200) }); } } // ВРЕМЕННО
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!SECRET) return res.status(503).json({ error: "not_configured" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const b64 = body && typeof body.png === "string" ? body.png.replace(/^data:image\/png;base64,/, "") : "";
  if (!b64 || b64.length > 200000) return res.status(400).json({ error: "bad_image" });
  try {
    const user = await siteUser(req);
    if (!user) return res.status(401).json({ error: "login_required" });
    if (!(await premium(user.id))) return res.status(403).json({ error: "premium_required" });
    const buf = Buffer.from(b64, "base64");
    let png; try { png = require("pngjs").PNG.sync.read(buf); } catch (e) { return res.status(400).json({ error: "bad_image" }); }
    if (png.width > 128 || png.height > 128 || png.width < 8 || png.height < 8) return res.status(400).json({ error: "bad_image" });
    const [a, b] = await Promise.all([nsfwCheck(png), claudeCheck(b64).catch(() => ({ bad: false, skipped: true }))]);
    if (a.bad || b.bad) return res.status(422).json({ error: "nsfw" });
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/media/${user.id}/tag.png`, {
      method: "POST", headers: adminHeaders({ "Content-Type": "image/png", "x-upsert": "true", "cache-control": "604800" }), body: buf });
    if (!up.ok) return res.status(502).json({ error: "upload_failed" });
    return res.status(200).json({ ok: true, v: Date.now().toString(36).slice(-6), ai: !b.skipped });
  } catch (e) {
    return res.status(502).json({ error: "check_failed" });
  }
};
