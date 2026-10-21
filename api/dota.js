// Прокси к открытому API OpenDota с кешем на Vercel (все посетители делят один запрос).
//   GET /api/dota?q=heroStats
//   GET /api/dota?q=items                      -> предметы (название, картинка, цена, компоненты, характеристики)
//   GET /api/dota?q=itemIds                    -> id -> ключ предмета
//   GET /api/dota?q=abilities                  -> способности героев (для Custom Hero Chaos)
//   GET /api/dota?q=pros                       -> топ про-игроков за полгода (матчи, винрейт, KDA, GPM, команда, любимые герои)
//   GET /api/dota?q=builds&hero=1              -> разные сборки героя с винрейтом (по закупкам в про-матчах)
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
const NEEDS_HERO = new Set(["itemPopularity", "itemTimings", "laneRoles", "matchups", "builds"]);
const NEEDS_ID = new Set(["player", "wl", "recent", "pheroes"]);
const TTL = { items: 86400, itemIds: 86400, abilities: 86400, builds: 43200, pros: 21600, search: 600, player: 300, wl: 300, recent: 300, pheroes: 600 };

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
    const start = out.length;
    for (const k of list) {
      if (!k || /generic_hidden|_empty|^special_bonus/.test(k)) continue;
      const a = all[k]; if (!a || !a.dname) continue;
      const first = v => { const s = Array.isArray(v) ? v[0] : String(v == null ? "" : v).split(/[\s/]+/)[0]; const n = parseFloat(s); return isFinite(n) ? n : 0; };
      const beh = (Array.isArray(a.behavior) ? a.behavior : [a.behavior]).filter(Boolean).map(String);
      out.push({ k, n: a.dname, i: a.img || "", h: hk.replace("npc_dota_hero_", ""), d: clean(a.desc).slice(0, 260),
        t: a.dmg_type ? String(a.dmg_type).slice(0, 4) : undefined, b: beh.length ? beh : undefined, cd: first(a.cd) || undefined, mc: first(a.mc) || undefined });
    }
    // ультимейт — последняя активная способность героя (у неё есть перезарядка)
    for (let i = out.length - 1; i >= start; i--) { const o = out[i]; if (o.cd && !(o.b || []).some(x => /passive/i.test(x))) { o.u = 1; break; } }
  }
  return JSON.stringify(out);
}

// ---------- сборки: про-матчи с текущего патча, группируем по первым двум крупным предметам ----------
const PATCH_START = 1774310400; // 24.03.2026 — выход 7.41
const BOOTS = new Set("power_treads phase_boots arcane_boots tranquil_boots boots_of_bearing guardian_greaves travel_boots travel_boots_2".split(" "));
// дорогие компоненты — сами по себе это ещё не сборка
const PARTS = new Set("ultimate_orb demon_edge eagle reaver relic hyperstone mystic_staff kaya sange yasha soul_booster lesser_crit platemail talisman_of_evasion".split(" "));
const JUNK = "'tpscroll','tango','flask','clarity','ward_observer','ward_sentry','ward_dispenser','smoke_of_deceit','dust','enchanted_mango','faerie_fire','blood_grenade','aegis','cheese','refresher_shard'";
let ITEMS_C = null;
async function builds(hero) {
  if (!ITEMS_C) ITEMS_C = JSON.parse(await od("/constants/items"));
  const sql = since => `SELECT (SELECT string_agg((e->>'key')||':'||(e->>'time'), ' ' ORDER BY (e->>'time')::int) FROM unnest(pm.purchase_log) e WHERE (e->>'key') NOT LIKE 'recipe%' AND (e->>'key') NOT IN (${JUNK})) pl, pm.lane_role ln, ((pm.player_slot<128)=m.radiant_win) win FROM player_matches pm JOIN matches m USING(match_id) WHERE pm.hero_id=${hero} AND m.start_time > ${since} AND pm.purchase_log IS NOT NULL ORDER BY m.start_time DESC LIMIT 1500`;
  const run = async since => { const j = JSON.parse(await od("/explorer?sql=" + encodeURIComponent(sql(since)))); if (j.err) throw new Error(j.err); return j.rows || []; };
  let since = PATCH_START, rows = await run(since);
  if (rows.length < 40) { since = Math.floor(Date.now() / 1000) - 365 * 86400; rows = await run(since); }
  const cost = k => (ITEMS_C[k] && ITEMS_C[k].cost) || 0, comps = k => (ITEMS_C[k] && ITEMS_C[k].components) || [];
  const groups = {}; let n = 0;
  for (const r of rows) {
    const pl = String(r.pl || "").split(" ").filter(Boolean).map(x => { const i = x.lastIndexOf(":"); return { k: x.slice(0, i), t: +x.slice(i + 1) || 0 }; });
    if (!pl.length) continue; n++;
    const core = [], early = []; let boots = null;
    pl.forEach((p, i) => {
      if (BOOTS.has(p.k)) { if (!boots) boots = p.k; return; }
      const c = cost(p.k); if (p.k === "boots" || c < 400) return;
      if (pl.slice(i + 1).some(q => comps(q.k).includes(p.k))) return; // компонент, позже собранный во что-то большее
      if (c >= 2000 && !PARTS.has(p.k)) { if (!core.some(x => x.k === p.k)) core.push(p); }
      else if (c < 2000 && !core.length && !early.includes(p.k)) early.push(p.k);
    });
    if (core.length < 2) continue;
    const pair = core.slice(0, 2), key = pair.map(p => p.k).sort().join("+");
    const g = groups[key] || (groups[key] = { g: 0, w: 0, t: {}, ln: {}, boots: {}, early: {}, next: {} });
    g.g++; if (r.win) g.w++;
    pair.forEach(p => { const o = g.t[p.k] || (g.t[p.k] = [0, 0]); o[0] += p.t; o[1]++; });
    g.ln[r.ln] = (g.ln[r.ln] || 0) + 1;
    if (boots) g.boots[boots] = (g.boots[boots] || 0) + 1;
    early.slice(0, 4).forEach(e => g.early[e] = (g.early[e] || 0) + 1);
    core.slice(2, 6).forEach(c => { const o = g.next[c.k] || (g.next[c.k] = [0, 0]); o[0]++; if (r.win) o[1]++; });
  }
  const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k);
  const min = Math.max(5, Math.round(n * 0.03));
  const out = Object.values(groups).filter(g => g.g >= min).sort((a, b) => b.g - a.g).slice(0, 6).map(g => ({
    items: Object.entries(g.t).map(([k, o]) => [k, Math.round(o[0] / o[1] / 60)]).sort((a, b) => a[1] - b[1]),
    g: g.g, w: g.w, ln: +top(g.ln, 1)[0][0] || 0,
    boots: top(g.boots, 2).filter(x => x[1] >= g.g * 0.15),
    early: top(g.early, 3).filter(x => x[1] >= g.g * 0.2),
    next: Object.entries(g.next).filter(([, o]) => o[0] >= Math.max(2, g.g * 0.12)).sort((a, b) => b[1][0] - a[1][0]).slice(0, 4).map(([k, o]) => [k, o[0], o[1]])
  }));
  return JSON.stringify({ n, since, patch: since === PATCH_START, builds: out });
}

// ---------- топ про-игроков: про- и премиум-лиги за последние 180 дней ----------
async function pros() {
  const since = Math.floor(Date.now() / 1000) - 180 * 86400;
  const j = JSON.parse(await od("/explorer?sql=" + encodeURIComponent(`WITH pm AS (SELECT pm.account_id, pm.hero_id, pm.kills, pm.deaths, pm.assists, pm.gold_per_min, pm.lane_role, ((pm.player_slot<128)=m.radiant_win) win, m.start_time, CASE WHEN pm.player_slot<128 THEN m.radiant_team_id ELSE m.dire_team_id END tid FROM player_matches pm JOIN matches m USING(match_id) JOIN leagues l USING(leagueid) WHERE m.start_time > ${since} AND l.tier IN ('premium','professional')), agg AS (SELECT account_id, count(*) g, sum(win::int) w, round(avg(kills),1) k, round(avg(deaths),1) d, round(avg(assists),1) a, round(avg(gold_per_min)) gpm, mode() WITHIN GROUP (ORDER BY lane_role) ln, (array_agg(tid ORDER BY start_time DESC))[1] tid, max(start_time) lt FROM pm GROUP BY account_id HAVING count(*) >= 25), hh AS (SELECT account_id, hero_id, count(*) hg, sum(win::int) hw, row_number() OVER (PARTITION BY account_id ORDER BY count(*) DESC) rn FROM pm GROUP BY account_id, hero_id) SELECT agg.*, np.name, np.country_code cc, t.name team, t.tag, t.logo_url logo, (SELECT json_agg(json_build_array(hero_id, hg, hw) ORDER BY rn) FROM hh WHERE hh.account_id = agg.account_id AND rn <= 3) heroes FROM agg JOIN notable_players np USING(account_id) LEFT JOIN teams t ON t.team_id = agg.tid ORDER BY agg.g DESC LIMIT 400`)));
  if (j.err) throw new Error(j.err);
  return JSON.stringify((j.rows || []).map(r => ({ id: r.account_id, n: r.name, cc: r.cc || "", g: +r.g, w: +r.w, k: +r.k, d: +r.d, a: +r.a, gpm: +r.gpm, ln: +r.ln || 0,
    team: r.team || "", tag: r.tag || "", logo: r.logo || "", lt: +r.lt, h: r.heroes || [] })));
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
  if (q !== "abilities" && q !== "builds" && q !== "pros" && !ROUTES[q]) return fail(400, "bad_query");
  if (NEEDS_HERO.has(q) && !/^\d{1,3}$/.test(String(p.hero || ""))) return fail(400, "bad_hero");
  if (NEEDS_ID.has(q) && !/^\d{1,12}$/.test(String(p.id || ""))) return fail(400, "bad_id");
  if (q === "search" && !(String(p.name || "").trim().length >= 2 && String(p.name).length <= 40)) return fail(400, "bad_name");
  try {
    let out;
    if (q === "abilities") out = await abilities();
    else if (q === "builds") out = await builds(+p.hero);
    else if (q === "pros") out = await pros();
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
