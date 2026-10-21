// Прокси к открытому API OpenDota с кешем на Vercel (все посетители делят один запрос раз в 6 часов).
//   GET /api/dota?q=heroStats
//   GET /api/dota?q=items                      -> constants/items (картинки, названия, цены)
//   GET /api/dota?q=itemIds                    -> constants/item_ids (id -> ключ предмета)
//   GET /api/dota?q=itemPopularity&hero=1      -> популярные предметы по стадиям игры
//   GET /api/dota?q=itemTimings&hero=1         -> винрейт предметов по времени покупки
//   GET /api/dota?q=laneRoles&hero=1           -> винрейт по линиям
//   GET /api/dota?q=matchups&hero=1            -> против каких героев
// Необязательно: OPENDOTA_API_KEY на Vercel — повышает лимиты OpenDota.
const BASE = "https://api.opendota.com/api";
const KEY = process.env.OPENDOTA_API_KEY || "";

const ROUTES = {
  heroStats: () => "/heroStats",
  items: () => "/constants/items",
  itemIds: () => "/constants/item_ids",
  itemPopularity: h => `/heroes/${h}/itemPopularity`,
  itemTimings: h => `/scenarios/itemTimings?hero_id=${h}`,
  laneRoles: h => `/scenarios/laneRoles?hero_id=${h}`,
  matchups: h => `/heroes/${h}/matchups`
};
const NEEDS_HERO = new Set(["itemPopularity", "itemTimings", "laneRoles", "matchups"]);

module.exports = async (req, res) => {
  const q = String((req.query && req.query.q) || ""), hero = String((req.query && req.query.hero) || "");
  if (req.query && req.query.ping !== undefined) {
    if (req.query.ping === "0") return res.status(200).json({ ok: true });
    const t0 = Date.now();
    try { const r = await fetch(BASE + (req.query.ping === "2" ? "/constants/item_ids" : "/heroStats"), { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json", "User-Agent": "1x6-builds (+https://1x6-eta.vercel.app)" } }); const t = await r.text();
      return res.status(200).json({ status: r.status, ms: Date.now() - t0, len: t.length, head: t.slice(0, 300) }); } catch (e) { return res.status(200).json({ error: String(e && e.message), ms: Date.now() - t0 }); }
  }
  if (q === "rank") {
    const n = String((req.query && req.query.n) || "");
    if (!/^[1-8]$/.test(n)) return res.status(400).json({ error: "bad_rank" });
    try {
      const r = await fetch(`https://www.opendota.com/assets/images/dota2/rank_icons/rank_icon_${n}.png`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return res.status(502).end();
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=2592000, s-maxage=2592000, immutable");
      return res.status(200).send(Buffer.from(await r.arrayBuffer()));
    } catch (e) { return res.status(502).end(); }
  }
  if (!ROUTES[q]) return res.status(400).json({ error: "bad_query" });
  if (NEEDS_HERO.has(q) && !/^\d{1,3}$/.test(hero)) return res.status(400).json({ error: "bad_hero" });
  let url = BASE + ROUTES[q](hero);
  if (KEY) url += (url.includes("?") ? "&" : "?") + "api_key=" + encodeURIComponent(KEY);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { Accept: "application/json", "User-Agent": "1x6-builds (+https://1x6-eta.vercel.app)" } });
    const text = await r.text();
    if (!r.ok) {
      res.setHeader("Cache-Control", "public, s-maxage=60");
      return res.status(502).json({ error: "upstream", status: r.status });
    }
    const long = q === "items" || q === "itemIds";
    let out = text;
    try {
      if (q === "items") {
        const j = JSON.parse(text), slim = {};
        const attr = a => { if (!a) return ""; const v = Array.isArray(a.value) ? a.value.join("/") : a.value;
          if (a.display) return String(a.display).replace("{value}", v); return [a.header, v, a.footer].filter(x => x != null && x !== "").join(" ").replace(/\s+/g, " ").trim(); };
        for (const k of Object.keys(j)) { const it = j[k] || {};
          slim[k] = { dname: it.dname || k, img: it.img || "", cost: it.cost || 0, comp: Array.isArray(it.components) ? it.components : null,
            attr: Array.isArray(it.attrib) ? it.attrib.map(attr).filter(Boolean).slice(0, 8) : [], cd: it.cd || 0, mc: it.mc || 0 }; }
        out = JSON.stringify(slim);
      } else if (q === "heroStats") {
        const keep = ["id", "name", "localized_name", "primary_attr", "attack_type", "roles", "img", "icon", "turbo_picks", "turbo_wins", "pro_pick", "pro_win", "pro_ban", "pub_pick", "pub_win"];
        for (let i = 1; i <= 8; i++) keep.push(i + "_pick", i + "_win");
        out = JSON.stringify(JSON.parse(text).map(h => Object.fromEntries(keep.filter(k => k in h).map(k => [k, h[k]]))));
      }
    } catch (e) { out = text; }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", `public, max-age=600, s-maxage=${long ? 86400 : 21600}, stale-while-revalidate=86400`);
    return res.status(200).send(out);
  } catch (e) {
    return res.status(502).json({ error: "upstream_unreachable" });
  }
};
