// CS2 и Deadlock: открытые источники без ключей, кеш на Vercel.
//   GET /api/games?q=csTeams                 -> рейтинг команд Valve (VRS): место, очки, команда, состав
//   GET /api/games?q=csTeam&p=<details path> -> последние матчи команды из отчёта Valve
//   GET /api/games?q=csMatches               -> последние матчи топ-16 команд
//   GET /api/games?q=dlHeroes&lang=ru        -> герои Deadlock: имя, картинки, винрейт, пикрейт
//   GET /api/games?q=dlItems&lang=ru         -> предметы магазина: id -> имя, картинка, слот, тир
//   GET /api/games?q=dlHero&id=1             -> сборка героя по статистике: основа и лучшие по винрейту
//   GET /api/games?q=dlOrder&id=1&lang=ru    -> самый частый порядок прокачки умений
//   GET /api/games?q=csMarket&cat=rifle|sniper|pistol|knife|gloves|smg&start=0 | &s=<поиск> -> цены скинов: Steam Market, Lis-skins (+ ссылка на CS.money), курсы валют
// Новости CS2 и Deadlock: /api/news?app=cs|deadlock
const UA = { Accept: "application/json", "User-Agent": "1x6-builds (+https://1x6-eta.vercel.app)" };
const VRS = "ValveSoftware/counter-strike_regional_standings";
const RAW = `https://raw.githubusercontent.com/${VRS}/main/live/`;
const DL = "https://api.deadlock-api.com/v1";
// язык сайта -> язык Valve в Deadlock (как в api/news.js)
const LNG = { ru: "russian", uk: "ukrainian", en: "english", es: "spanish", pt: "brazilian", de: "german", pl: "polish", tr: "turkish",
  fr: "french", it: "italian", kk: "russian", be: "russian", nl: "english", zh: "schinese", ja: "japanese", ko: "koreana" };
const TTL = { csTeams: 21600, csTeam: 21600, csMatches: 21600, dlHeroes: 21600, dlHero: 21600, dlOrder: 43200, dlItems: 86400, csMarket: 3600 };

async function get(url, type = "json") {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(url + " " + r.status);
  return type === "json" ? r.json() : r.text();
}

// строки markdown-таблицы -> массив ячеек
// в некоторых переводах Valve имена с разметкой вида #|mp|#Abrams
const clean = s => String(s || "").replace(/#\|[^|]*\|#/g, "").trim();
const rows = md => md.split("\n").filter(l => /^\|\s*\d/.test(l)).map(l => l.split("|").slice(1, -1).map(c => c.trim()));

async function csTeams() {
  const y = new Date().getUTCFullYear();
  let files = [];
  for (const yy of [y, y - 1]) {
    try { files = (await get(`https://api.github.com/repos/${VRS}/contents/live/${yy}`)).map(f => f.name).filter(n => /^standings_global_\d{4}_\d\d_\d\d\.md$/.test(n)).map(n => yy + "/" + n); } catch (e) { files = []; }
    if (files.length) break;
  }
  const last = files.sort().pop(); if (!last) throw new Error("no standings");
  const md = await get(RAW + last, "text");
  const date = last.match(/(\d{4})_(\d\d)_(\d\d)/).slice(1).join("-");
  const teams = rows(md).slice(0, 60).map(c => ({ n: +c[0], pts: +c[1], team: c[2], roster: c[3].split(",").map(s => s.trim()).filter(Boolean),
    p: last.slice(0, 4) + "/" + ((c[4] || "").match(/\((details\/[^)]+\.md)\)/) || [])[1] }));
  return { date, teams };
}

async function csTeam(p) {
  if (!/^\d{4}\/details\/\d{4}_\d\d_\d\d\/[\w.-]+\.md$/.test(p)) throw Object.assign(new Error("bad path"), { code: 400 });
  const md = await get(RAW + p, "text");
  // таблица матчей: Match Played | Match ID | Date | Opponent | W/L | ...
  const i = md.indexOf("| Match Played");
  const matches = i < 0 ? [] : rows(md.slice(i)).filter(c => c.length > 5 && /^\d{4}-\d\d-\d\d$/.test(c[2])).map(c => ({ d: c[2], vs: c[3], w: /^w/i.test(c[4]) }))
    .sort((a, b) => b.d.localeCompare(a.d)).slice(0, 25);
  return { matches };
}

// последние матчи топ-16 команд из их отчётов, без повторов (матч есть в отчётах обеих команд)
async function csMatches() {
  const { date, teams } = await csTeams();
  const lists = await Promise.all(teams.slice(0, 16).map(t => csTeam(t.p).then(r => r.matches.map(m => ({ ...m, team: t.team }))).catch(() => [])));
  const seen = new Set(), out = [];
  for (const m of lists.flat().sort((a, b) => b.d.localeCompare(a.d))) {
    const k = m.d + "|" + [m.team, m.vs].sort().join("|"); if (seen.has(k)) continue; seen.add(k);
    out.push({ d: m.d, a: m.team, b: m.vs, win: m.w ? m.team : m.vs });
  }
  return { date, matches: out.slice(0, 40) };
}

// ---------- CS2: сравнение цен скинов (Steam Market + Lis-skins; у CS.money нет открытого API — только ссылка) ----------
const MEM = {};
const memo = (k, ttl, fn) => { const m = MEM[k]; if (m && Date.now() - m.t < ttl) return m.p; const p = fn(); MEM[k] = { t: Date.now(), p }; p.catch(() => { delete MEM[k]; }); return p; };
// прайс Lis-skins (официальная выгрузка, ~5 МБ): название -> цена в $, ссылка, сколько лотов
const lisMap = () => memo("lis", 30 * 60e3, async () => new Map((await get("https://lis-skins.com/market_export_json/csgo.json")).map(x => [x.name, x])));
const rates = () => memo("fx", 6 * 3600e3, async () => { const j = await get("https://open.er-api.com/v6/latest/USD"); return { usd: 1, uah: j.rates.UAH, rub: j.rates.RUB, eur: j.rates.EUR, t: j.time_last_update_unix }; });
const CAT = { rifle: "tag_CSGO_Type_Rifle", sniper: "tag_CSGO_Type_SniperRifle", pistol: "tag_CSGO_Type_Pistol", knife: "tag_CSGO_Type_Knife", gloves: "tag_Type_Hands", smg: "tag_CSGO_Type_SMG" };
async function csMarket(cat, query, start) {
  const u = new URL("https://steamcommunity.com/market/search/render/");
  Object.entries({ appid: 730, norender: 1, count: 10, start, sort_column: "popular", sort_dir: "desc" }).forEach(([k, v]) => u.searchParams.set(k, v));
  if (query) u.searchParams.set("query", query); else u.searchParams.append("category_730_Type[]", CAT[cat] || CAT.rifle);
  const [st, lis, fx] = await Promise.all([get(u.href), lisMap().catch(() => new Map()), rates().catch(() => null)]);
  const items = (st.results || []).map(r => { const l = lis.get(r.hash_name); const ad = r.asset_description || {};
    return { n: r.hash_name, img: ad.icon_url ? `https://community.cloudflare.steamstatic.com/economy/image/${ad.icon_url}/160fx120f` : "", col: ad.name_color || "",
      steam: r.sell_price ? r.sell_price / 100 : null, steamN: r.sell_listings || 0, steamUrl: `https://steamcommunity.com/market/listings/730/${encodeURIComponent(r.hash_name)}`,
      lis: l ? l.price : null, lisN: l ? l.count : 0, lisUrl: l ? l.url : `https://lis-skins.com/market/csgo/?query=${encodeURIComponent(r.hash_name)}`,
      csmUrl: `https://cs.money/market/buy/?search=${encodeURIComponent(r.hash_name.replace(/ \([^)]*\)$/, ""))}` }; });
  return { fx, total: st.total_count || 0, items };
}

async function dlHeroes(lang) {
  const [hs, st] = await Promise.all([get(`${DL}/assets/heroes?only_active=true&language=${lang}`), get(`${DL}/analytics/hero-stats`)]);
  const tot = st.reduce((a, x) => a + x.matches, 0) || 1, S = new Map(st.map(x => [x.hero_id, x]));
  return hs.filter(h => h.player_selectable && !h.disabled && !h.in_development).map(h => { const s = S.get(h.id) || {};
    return { id: h.id, name: clean(h.name), img: h.images?.icon_image_small_webp || h.images?.icon_image_small || "", card: h.images?.icon_hero_card_webp || h.images?.icon_hero_card || "",
      wr: s.matches ? +(s.wins / s.matches * 100).toFixed(1) : null, pick: s.matches ? +(s.matches / tot * 1200).toFixed(1) : null, m: s.matches || 0 }; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// все предметы магазина на языке сайта — отдельно и с долгим кешем (это 2 МБ у источника)
async function dlItems(lang) {
  const items = await get(`${DL}/assets/items/by-type/upgrade?language=${lang}`);
  return Object.fromEntries(items.filter(i => i.shopable).map(i => [i.id, { name: clean(i.name), img: i.shop_image_webp || i.shop_image || i.image_webp || i.image || "", slot: i.item_slot_type, tier: i.item_tier }]));
}

// сборка героя по статистике: основа и лучшие предметы по тирам
async function dlHero(id) {
  const [ist, hs] = await Promise.all([get(`${DL}/analytics/item-stats?hero_id=${id}&min_matches=300`), get(`${DL}/analytics/hero-stats`).catch(() => [])]);
  // доля — от всех матчей героя (если статистика героя недоступна — от самого частого предмета)
  const tot = (hs.find(x => x.hero_id === id) || {}).matches || Math.max(...ist.map(x => x.matches), 1);
  const all = ist.map(x => ({ id: x.item_id, wr: +(x.wins / x.matches * 100).toFixed(1), pick: Math.round(x.matches / tot * 100), t: Math.round(x.avg_buy_time_s / 60) }));
  const core = all.filter(i => i.pick >= 30).sort((a, b) => a.t - b.t).slice(0, 12);
  const best = all.filter(i => i.pick >= 4).sort((a, b) => b.wr - a.wr);
  return { core, best };
}

// самый частый порядок прокачки умений (у источника медленный запрос — отдельно, чтобы предметы показывались сразу)
async function dlOrder(id, lang) {
  const [ao, hero, hs] = await Promise.all([get(`${DL}/analytics/ability-order-stats?hero_id=${id}&min_matches=200`), get(`${DL}/assets/heroes/${id}?language=${lang}`), get(`${DL}/analytics/hero-stats`).catch(() => [])]);
  const tot = (hs.find(x => x.hero_id === id) || {}).matches || 1;
  const top = [...ao].filter(o => (o.abilities || []).length >= 10).sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses))[0];
  const sig = hero ? ["signature1", "signature2", "signature3", "signature4"].map(k => hero.items?.[k]).filter(Boolean) : [];
  const ab = (await Promise.all(sig.map(c => get(`${DL}/assets/items/${c}?language=${lang}`).catch(() => null)))).filter(Boolean)
    .map((a, i) => ({ id: a.id, n: i + 1, name: clean(a.name), img: a.image_webp || a.image || "" }));
  const order = top ? { steps: top.abilities.slice(0, 16), wr: +(top.wins / (top.wins + top.losses) * 100).toFixed(1), share: Math.round((top.wins + top.losses) / tot * 100) } : null;
  return { order: ab.length ? order : null, abil: ab };
}

module.exports = async (req, res) => {
  const q = String(req.query.q || ""), lang = LNG[String(req.query.lang || "ru")] || "english";
  const fail = (code, error) => { res.setHeader("Cache-Control", "public, s-maxage=60"); res.status(code).json({ error }); };
  if (!TTL[q]) return fail(400, "bad_query");
  try {
    let out;
    if (q === "csTeams") out = await csTeams();
    else if (q === "csMatches") out = await csMatches();
    else if (q === "csTeam") out = await csTeam(String(req.query.p || ""));
    else if (q === "dlHeroes") out = await dlHeroes(lang);
    else if (q === "dlItems") out = await dlItems(lang);
    else if (q === "csMarket") { const qs = String(req.query.s || "").trim().slice(0, 60), start = Math.min(90, Math.max(0, +req.query.start || 0) - (+req.query.start || 0) % 10);
      if (qs && qs.length < 2) return fail(400, "bad_query"); out = await csMarket(String(req.query.cat || "rifle"), qs, start); }
    else { const id = +req.query.id; if (!(id > 0 && id < 1000)) return fail(400, "bad_id"); out = q === "dlOrder" ? await dlOrder(id, lang) : await dlHero(id); }
    res.setHeader("Cache-Control", `public, s-maxage=${TTL[q]}, stale-while-revalidate=86400`);
    res.status(200).json(out);
  } catch (e) { fail(e.code === 400 ? 400 : 502, "upstream"); }
};
