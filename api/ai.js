// AI-помощник сайта: билды для Custom Hero Chaos и объяснение пиков.
//   GET  /api/ai?info  -> { enabled }
//   POST /api/ai       -> { kind: "chc" | "pick", ... }   (нужен вход: Authorization: Bearer <токен Supabase>)
//
// Переменные окружения на Vercel:
//   ANTHROPIC_API_KEY   — ключ из console.anthropic.com (секрет). Без него AI-кнопки показывают «скоро».
//   AI_MODEL            — необязательно, по умолчанию claude-haiku-5-5
//   SUPABASE_SECRET_KEY — уже есть (лимиты запросов)
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vsmjjlrgjyujaioknlkn.supabase.co";
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const AKEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.AI_MODEL || "claude-haiku-5-5";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminHeaders() {
  const h = { "Content-Type": "application/json", apikey: SECRET };
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
async function take(uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_take`, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ p_user: uid }) });
  if (!r.ok) throw new Error("limits_unavailable");
  return Number(await r.json());
}
const str = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
const list = (v, max, n) => (Array.isArray(v) ? v : []).map(x => str(x, n)).filter(Boolean).slice(0, max);

const SYS_CHC = `Ты — опытный игрок и тренер кастомки Dota 2 «Custom Hero Chaos» (CHC). В CHC игроки выбирают героя, а способности получают из случайных выпадений; раунды PvE с крипами и боссами чередуются с PvP-дуэлями, золото и опыт растут быстро, стакающиеся пассивки и сильные комбо способностей решают игру.
Тебе дают героя (может быть не указан) и способности, которые выпали игроку. Придумай лучший билд именно под эту комбинацию: как способности работают вместе, что качать первым, какие предметы собирать и как играть.
Отвечай по-русски, коротко и по делу, без воды. Названия способностей и предметов пиши как в игре (английские).
Ответ — строго один JSON-объект без markdown и пояснений вокруг, по схеме:
{"title":"короткое название билда","idea":"1–2 предложения: в чём сила комбинации","priority":[{"ability":"название","why":"зачем и когда качать"}],"items":{"start":["ключ"],"early":["ключ"],"core":["ключ"],"late":["ключ"]},"tips":["совет по игре"],"weak":"против чего билд слаб","reroll":"какую способность поменять при реролле и на что"}
В items используй внутренние ключи предметов Dota 2 (например black_king_bar, ultimate_scepter, aghanims_shard, octarine_core, travel_boots, satanic). В каждой стадии 2–5 предметов. priority — все выпавшие способности по порядку прокачки. tips — 3–5 пунктов.`;

const SYS_PICK = `Ты — аналитик драфтов Dota 2. Тебе дают союзников, врагов, роль игрока и список героев-кандидатов с оценкой из статистики (чем выше, тем лучше герой против этих врагов). Выбери лучший пик для игрока и объясни почему: против кого он хорош, как сочетается с союзниками, что собирать. Отвечай по-русски, коротко.
Ответ — строго один JSON-объект без markdown по схеме:
{"best":"имя героя из кандидатов","why":"2–3 предложения","alts":[{"hero":"имя","why":"1 предложение"}],"plan":"как играть и что собирать в этой игре, 2–3 предложения","avoid":"кого из кандидатов лучше не брать и почему (1 предложение)"}
alts — 2 героя из кандидатов.`;

function parseJSON(text) {
  const t = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("bad_ai_json");
  return JSON.parse(t.slice(s, e + 1));
}
async function ask(system, user) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(50000),
    headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error("ai_failed"); e.detail = (j.error && j.error.message) || r.status; throw e; }
  return parseJSON((j.content || []).filter(c => c.type === "text").map(c => c.text).join(""));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const enabled = Boolean(AKEY && SECRET);
  if (req.method === "GET") return res.status(200).json({ enabled });
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!enabled) return res.status(503).json({ error: "not_configured" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "bad_request" });
  try {
    const user = await siteUser(req);
    if (!user) return res.status(401).json({ error: "login_required" });
    let system, prompt;
    if (body.kind === "chc") {
      const abil = list(body.abilities, 8, 60);
      if (abil.length < 2) return res.status(400).json({ error: "need_abilities" });
      system = SYS_CHC;
      prompt = `Герой: ${str(body.hero, 40) || "не указан"}\nВыпавшие способности: ${abil.join(", ")}${str(body.note, 200) ? "\nПожелание игрока: " + str(body.note, 200) : ""}`;
    } else if (body.kind === "pick") {
      const allies = list(body.allies, 4, 40), enemies = list(body.enemies, 5, 40), cands = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 10).map(c => `${str(c && c.hero, 40)} (оценка ${Number(c && c.score) ? Number(c.score).toFixed(1) : "?"})`);
      if (!enemies.length || cands.length < 3) return res.status(400).json({ error: "need_draft" });
      system = SYS_PICK;
      prompt = `Роль игрока: ${str(body.role, 30) || "любая"}\nСоюзники: ${allies.join(", ") || "пока никого"}\nВраги: ${enemies.join(", ")}\nКандидаты: ${cands.join("; ")}`;
    } else return res.status(400).json({ error: "bad_kind" });
    const left = await take(user.id);
    if (left < 0) return res.status(429).json({ error: "limit" });
    const result = await ask(system, prompt);
    return res.status(200).json({ result, left });
  } catch (e) {
    return res.status(502).json({ error: e.message === "limits_unavailable" ? "limits_unavailable" : "ai_failed" });
  }
};
module.exports.config = { maxDuration: 60 };
