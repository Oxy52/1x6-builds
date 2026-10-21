// Прокси к открытому API OpenDota с кешем на Vercel (все посетители делят один запрос).
//   GET /api/dota?q=heroStats
//   GET /api/dota?q=items                      -> предметы (название, картинка, цена, компоненты, характеристики)
//   GET /api/dota?q=itemIds                    -> id -> ключ предмета
//   GET /api/dota?q=abilities                  -> способности героев (для Custom Hero Chaos)
//   GET /api/dota?q=itemPopularity&hero=1      -> популярные предметы по стадиям игры
//   GET /api/dota?q=itemTimings&hero=1         -> винрейт предметов по времени покупки
//   GET /api/dota?q=laneRoles&hero=1           -> винрейт по линиям
//   GET /api/dota?q=matchups&hero=1            -> против каких героев
//   GET /api/dota?q=search&name=Miracle        -> поиск игроков по нику
//   GET /api/dota?q=player|wl|recent|pheroes&id=86745912 -> профиль игрока, победы/поражения, последние матчи, герои
//   GET /api/dota?q=rank&n=1..8                -> иконка ранга
// Необязательно: OPENDOTA_API_KEY на Vercel — повышает лимиты OpenDota.
const BASE = "https://api.opendota.com/api";
const KEY = process.env.OPENDOTA_API_KEY || "";
const UA = { Accept: "application/json", "User-Agent": "1x6-builds (+https://1x6-eta.vercel.app)" };

const ROUTES = {
  heroStats: () => "/heroStats",
  items: () => "/constants/items",
  itemIds: () => "/constants/item_ids",
  itemPopularity: p => `/heroes/${p.hero}/itemPopularity`,
  itemTimings: p => `/scenarios/itemTimings?hero_id=${p.hero}`,
  laneRoles: p => `/scenarios/laneRoles?hero_id=${p.hero}`,
  matchups: p => `/heroes/${p.hero}/matchups`,
  search: p => `/search?q=${encodeURIComponent(p.name)}`,
  player: p => `/players/${p.id}`,
  wl: p => `/players/${p.id}/wl`,
  recent: p => `/players/${p.id}/recentMatches`,
  pheroes: p => `/players/${p.id}/heroes`
};
const NEEDS_HERO = new Set(["itemPopularity", "itemTimings", "laneRoles", "matchups"]);
const NEEDS_ID = new Set(["player", "wl", "recent", "pheroes"]);
const TTL = { items: 86400, itemIds: 86400, abilities: 86400, search: 600, player: 300, wl: 300, recent: 300, pheroes: 600 };

const withKey = url => KEY ? url + (url.includes("?") ? "&" : "?") + "api_key=" + encodeURIComponent(KEY) : url;
async function od(path) {
  const r = await fetch(withKey(BASE + path), { signal: AbortSignal.timeout(9000), headers: UA });
  if (!r.ok) { const e = new Error("upstream"); e.status = r.status; throw e; }
  return r.text();
}
const clean = s => String(s || "").replace(/<[^>]+>/g, "").replace(/%[a-z_]+%%?/gi, "").replace(/\s+/g, " ").trim();

function slimItems(text) {
  const j = JSON.parse(text), slim = {};
  const attr = a => { if (!a) return ""; const v = Array.isArray(a.value) ? a.value.join("/") : a.value;
    if (a.display) return String(a.display).replace("{value}", v); return [a.header, v, a.footer].filter(x => x != null && x !== "").join(" ").replace(/\s+/g, " ").trim(); };
  for (const k of Object.keys(j)) { const it = j[k] || {};
    slim[k] = { dname: it.dname || k, img: it.img || "", cost: it.cost || 0, comp: Array.isArray(it.components) ? it.components : null,
      attr: Array.isArray(it.attrib) ? it.attrib.map(attr).filter(s => /[A-Za-z]/.test(s)).slice(0, 8) : [], cd: it.cd || 0, mc: it.mc || 0 }; }
  return JSON.stringify(slim);
}
function slimHeroes(text) {
  const keep = ["id", "name", "localized_name", "primary_attr", "attack_type", "roles", "img", "icon", "turbo_picks", "turbo_wins", "pro_pick", "pro_win", "pro_ban", "pub_pick", "pub_win"];
  for (let i = 1; i <= 8; i++) keep.push(i + "_pick", i + "_win");
  return JSON.stringify(JSON.parse(text).map(h => Object.fromEntries(keep.filter(k => k in h).map(k => [k, h[k]]))));
}
async function abilities() {
  const [ha, ab] = await Promise.all([od("/constants/hero_abilities"), od("/constants/abilities")]);
  const heroes = JSON.parse(ha), all = JSON.parse(ab), out = [];
  for (const hk of Object.keys(heroes)) {
    const list = (heroes[hk] && heroes[hk].abilities) || [];
    for (const k of list) {
      if (!k || /generic_hidden|_empty|^special_bonus/.test(k)) continue;
      const a = all[k]; if (!a || !a.dname) continue;
      const first = v => { const s = Array.isArray(v) ? v[0] : String(v == null ? "" : v).split(/[\s/]+/)[0]; const n = parseFloat(s); return isFinite(n) ? n : 0; };
      const beh = (Array.isArray(a.behavior) ? a.behavior : [a.behavior]).filter(Boolean).map(String);
      out.push({ k, n: a.dname, i: a.img || "", h: hk.replace("npc_dota_hero_", ""), d: clean(a.desc).slice(0, 260),
        t: a.dmg_type ? String(a.dmg_type).slice(0, 1) : undefined, b: beh.length ? beh : undefined, cd: first(a.cd) || undefined, mc: first(a.mc) || undefined });
    }
  }
  return JSON.stringify(out);
}

module.exports = async (req, res) => {
  const p = req.query || {}, q = String(p.q || "");
  const fail = (code, err) => { res.setHeader("Cache-Control", "public, s-maxage=30"); return res.status(code).json({ error: err }); };
  if (q === "rank") {
    if (!/^[1-8]$/.test(String(p.n || ""))) return fail(400, "bad_rank");
    try {
      const r = await fetch(`https://www.opendota.com/assets/images/dota2/rank_icons/rank_icon_${p.n}.png`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return res.status(502).end();
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=2592000, s-maxage=2592000, immutable");
      return res.status(200).send(Buffer.from(await r.arrayBuffer()));
    } catch (e) { return res.status(502).end(); }
  }
  if (q !== "abilities" && !ROUTES[q]) return fail(400, "bad_query");
  if (NEEDS_HERO.has(q) && !/^\d{1,3}$/.test(String(p.hero || ""))) return fail(400, "bad_hero");
  if (NEEDS_ID.has(q) && !/^\d{1,12}$/.test(String(p.id || ""))) return fail(400, "bad_id");
  if (q === "search" && !(String(p.name || "").trim().length >= 2 && String(p.name).length <= 40)) return fail(400, "bad_name");
  try {
    let out;
    if (q === "abilities") out = await abilities();
    else {
      const text = await od(ROUTES[q]({ hero: p.hero, id: p.id, name: String(p.name || "").trim() }));
      try { out = q === "items" ? slimItems(text) : q === "heroStats" ? slimHeroes(text) : q === "search" ? JSON.stringify(JSON.parse(text).slice(0, 20)) : text; }
      catch (e) { out = text; }
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const ttl = TTL[q] || 21600;
    res.setHeader("Cache-Control", `public, max-age=${Math.min(600, ttl)}, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`);
    return res.status(200).send(out);
  } catch (e) {
    return fail(502, e.status ? "upstream_" + e.status : "upstream_unreachable");
  }
};
