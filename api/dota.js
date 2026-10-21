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
  if (!ROUTES[q]) return res.status(400).json({ error: "bad_query" });
  if (NEEDS_HERO.has(q) && !/^\d{1,3}$/.test(hero)) return res.status(400).json({ error: "bad_hero" });
  let url = BASE + ROUTES[q](hero);
  if (KEY) url += (url.includes("?") ? "&" : "?") + "api_key=" + encodeURIComponent(KEY);
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "1x6-builds (+https://1x6-eta.vercel.app)" } });
    const text = await r.text();
    if (!r.ok) {
      res.setHeader("Cache-Control", "public, s-maxage=60");
      return res.status(502).json({ error: "upstream", status: r.status });
    }
    const long = q === "items" || q === "itemIds";
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", `public, max-age=600, s-maxage=${long ? 86400 : 21600}, stale-while-revalidate=86400`);
    return res.status(200).send(text);
  } catch (e) {
    return res.status(502).json({ error: "upstream_unreachable" });
  }
};
