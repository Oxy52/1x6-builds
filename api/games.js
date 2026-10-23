// CS2 и Deadlock: открытые источники без ключей, кеш на Vercel.
//   GET /api/games?q=csTeams                 -> рейтинг команд Valve (VRS): место, очки, команда, состав
//   GET /api/games?q=csTeam&p=<details path> -> последние матчи команды из отчёта Valve
//   GET /api/games?q=csMatches               -> матчи про-сцены (bo3.gg, тиры S и A): идут сейчас, скоро, прошедшие
//   GET /api/games?q=csMatch&s=<slug>        -> матч: карты, раунды, статистика игроков по картам
//   GET /api/games?q=csTeamM&n=<команда>     -> последние и ближайшие матчи команды (bo3.gg)
//   GET /api/games?q=dlMatches               -> Deadlock: матчи, которые идут сейчас, и недавние матчи высокого ранга
//   GET /api/games?q=dlMatch&id=<match id>   -> матч Deadlock: игроки, герои, K/D/A, души, урон, предметы, души по ходу игры
//   GET /api/games?q=dlHeroes&lang=ru        -> герои Deadlock: имя, картинки, винрейт, пикрейт
//   GET /api/games?q=dlItems&lang=ru         -> предметы магазина: id -> имя, картинка, слот, тир
//   GET /api/games?q=dlHero&id=1             -> сборка героя по статистике: основа и лучшие по винрейту
//   GET /api/games?q=dlOrder&id=1&lang=ru    -> самый частый порядок прокачки умений
//   GET /api/games?q=market&g=cs|dota&cat=<категория>&start=0 | &s=<поиск> -> цены скинов на Steam, Lis-skins, Skinport, Market.CSGO/Dota2, CS.money, CSFloat + курсы валют
// Новости CS2 и Deadlock: /api/news?app=cs|deadlock
const UA = { Accept: "application/json", "User-Agent": "1x6-builds (+https://blazecrest.vercel.app)" };
const VRS = "ValveSoftware/counter-strike_regional_standings";
const RAW = `https://raw.githubusercontent.com/${VRS}/main/live/`;
const DL = "https://api.deadlock-api.com/v1";
// язык сайта -> язык Valve в Deadlock (как в api/news.js)
const LNG = { ru: "russian", uk: "ukrainian", en: "english", es: "spanish", pt: "brazilian", de: "german", pl: "polish", tr: "turkish",
  fr: "french", it: "italian", kk: "russian", be: "russian", nl: "english", zh: "schinese", ja: "japanese", ko: "koreana" };
const TTL = { csTeams: 21600, csTeam: 21600, csMatches: 120, csMatch: 86400, img: 604800, csTeamM: 600, dlMatches: 120, dlMatch: 86400, dlHeroes: 21600, dlHero: 21600, dlOrder: 43200, dlItems: 86400, csMarket: 3600, market: 3600, lots: 1800 };

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

// ---------- Скины CS2 и Dota 2: одна вещь на разных площадках ----------
// Живые прайсы: Steam (поиск), Lis-skins, Skinport, Market.CSGO / Market.Dota2; раз в сутки — CS.money и CSFloat (сборник csgotrader.app).
const MEM = {};
const memo = (k, ttl, fn) => { const m = MEM[k]; if (m && Date.now() - m.t < ttl) return m.p; const p = fn(); MEM[k] = { t: Date.now(), p }; p.catch(() => { delete MEM[k]; }); return p; };
const num = v => { const x = parseFloat(v); return x > 0 ? x : null; };
const rates = () => memo("fx", 6 * 3600e3, async () => { const j = await get("https://open.er-api.com/v6/latest/USD"); return { usd: 1, uah: j.rates.UAH, rub: j.rates.RUB, eur: j.rates.EUR, t: j.time_last_update_unix }; });
const APP = { cs: 730, dota: 570 };
// каждая площадка: прайс (название -> {v: цена $, n: лотов, u: ссылка}) и ссылка поиска, если вещи в прайсе нет
const SRC = {
  lis: { name: "Lis-skins", d: "lis-skins.com", ttl: 30,
    load: g => get(`https://lis-skins.com/market_export_json/${g === "cs" ? "csgo" : "dota2"}.json`).then(a => new Map(a.map(x => [x.name, { v: num(x.price), n: x.count || 0, u: x.url }]))),
    search: (g, n) => `https://lis-skins.com/market/${g === "cs" ? "csgo" : "dota2"}/?query=${encodeURIComponent(n)}` },
  skinport: { name: "Skinport", d: "skinport.com", ttl: 30,
    load: g => fetch(`https://api.skinport.com/v1/items?app_id=${APP[g]}&currency=USD&tradable=0`, { headers: { ...UA, "Accept-Encoding": "br" }, signal: AbortSignal.timeout(20000) })
      .then(r => { if (!r.ok) throw new Error("skinport " + r.status); return r.json(); })
      .then(a => new Map(a.filter(x => x.min_price).map(x => [x.market_hash_name, { v: num(x.min_price), n: x.quantity || 0, u: x.market_page || x.item_page }]))),
    search: (g, n) => `https://skinport.com/${g === "cs" ? "market" : "dota2"}?search=${encodeURIComponent(n)}` },
  tm: { name: g => g === "cs" ? "Market.CSGO" : "Market.Dota2", d: g => g === "cs" ? "market.csgo.com" : "market.dota2.net", ttl: 30,
    load: g => get(`https://${g === "cs" ? "market.csgo.com" : "market.dota2.net"}/api/v2/prices/USD.json`).then(j => new Map((j.items || []).map(x => [x.market_hash_name, { v: num(x.price), n: +x.volume || 0 }]))),
    search: (g, n) => `https://${g === "cs" ? "market.csgo.com" : "market.dota2.net"}/en/?search=${encodeURIComponent(n)}` },
  csm: { name: "CS.money", d: "cs.money", ttl: 360, only: "cs", daily: true,
    load: () => get("https://prices.csgotrader.app/latest/csmoney.json").then(j => new Map(Object.entries(j).map(([k, x]) => [k, { v: num(x && x.price) }]))),
    search: (g, n) => `https://cs.money/market/buy/?search=${encodeURIComponent(n.replace(/ \([^)]*\)$/, ""))}` },
  csfloat: { name: "CSFloat", d: "csfloat.com", ttl: 360, only: "cs", daily: true,
    load: () => get("https://prices.csgotrader.app/latest/csfloat.json").then(j => new Map(Object.entries(j).map(([k, x]) => [k, { v: num(x && (x.price || (x.starting_at && x.starting_at.price))) }]))),
    search: (g, n) => `https://csfloat.com/search?market_hash_name=${encodeURIComponent(n)}` },
};
const price = (k, g) => memo(k + g, SRC[k].ttl * 60e3, () => SRC[k].load(g));
const CAT = {
  cs: { rifle: ["Type", "tag_CSGO_Type_Rifle"], sniper: ["Type", "tag_CSGO_Type_SniperRifle"], pistol: ["Type", "tag_CSGO_Type_Pistol"], knife: ["Type", "tag_CSGO_Type_Knife"],
    gloves: ["Type", "tag_Type_Hands"], smg: ["Type", "tag_CSGO_Type_SMG"], case: ["Type", "tag_CSGO_Type_WeaponCase"], sticker: ["Type", "tag_CSGO_Tool_Sticker"] },
  dota: { arcana: ["Rarity", "tag_Rarity_Arcana"], immortal: ["Rarity", "tag_Rarity_Immortal"], legendary: ["Rarity", "tag_Rarity_Legendary"], mythical: ["Rarity", "tag_Rarity_Mythical"],
    courier: ["Type", "tag_courier"], ward: ["Type", "tag_ward"], set: ["Type", "tag_bundle"], gem: ["Type", "tag_socket_gem"] } };
// качество: износ и StatTrak/Сувенир в CS2, Inscribed/Genuine/Exalted… в Dota 2 (фильтры Steam)
const QL = {
  cs: { fn: ["Exterior", "tag_WearCategory0"], mw: ["Exterior", "tag_WearCategory1"], ft: ["Exterior", "tag_WearCategory2"], ww: ["Exterior", "tag_WearCategory3"], bs: ["Exterior", "tag_WearCategory4"],
    st: ["Quality", "tag_strange"], sv: ["Quality", "tag_tournament"] },
  dota: { ins: ["Quality", "tag_strange"], gen: ["Quality", "tag_genuine"], exa: ["Quality", "tag_exalted"], unu: ["Quality", "tag_unusual"], aut: ["Quality", "tag_autographed"],
    cor: ["Quality", "tag_corrupted"], fro: ["Quality", "tag_frozen"], her: ["Quality", "tag_tournament"], eld: ["Quality", "tag_vintage"], inf: ["Quality", "tag_infused"] } };
// редкость из типа предмета Steam: ранг для сортировки и русское название
const RAR = [[/contraband/i, 10, "Контрабанда"], [/extraordinary/i, 8, "Экстраординарное"], [/covert/i, 7, "Тайное"], [/exotic/i, 6, "Экзотичное"], [/classified/i, 6, "Засекреченное"],
  [/remarkable/i, 5, "Примечательное"], [/restricted/i, 5, "Запрещённое"], [/high grade/i, 4, "Высшего класса"], [/mil-spec/i, 4, "Армейское"], [/industrial/i, 3, "Промышленное"],
  [/consumer/i, 2, "Ширпотреб"], [/base grade/i, 1, "Базового класса"],
  [/arcana/i, 9, "Аркана"], [/immortal/i, 8, "Бессмертное"], [/ancient/i, 7, "Древнее"], [/legendary/i, 6, "Легендарное"], [/mythical/i, 5, "Мифическое"], [/rare/i, 4, "Редкое"], [/uncommon/i, 3, "Необычное"], [/common/i, 2, "Обычное"]];
function rarity(type) { const t = String(type || ""); const x = RAR.find(([re]) => re.test(t)); return x ? { r: x[1] + (/★/.test(t) ? 1 : 0), rn: x[2] } : { r: 0, rn: "" }; }
const SORT = { pop: ["popular", "desc"], cheap: ["price", "asc"], exp: ["price", "desc"], name: ["name", "asc"], rar: ["popular", "desc"] };
async function market(g, cat, query, start, sort, ql) {
  if (!APP[g]) g = "cs";
  const app = APP[g], u = new URL("https://steamcommunity.com/market/search/render/");
  const so = SORT[sort] || SORT.pop;
  Object.entries({ appid: app, norender: 1, count: 10, start, sort_column: so[0], sort_dir: so[1], l: "english" }).forEach(([k, v]) => u.searchParams.set(k, v));
  const C = CAT[g], c = C[cat] || Object.values(C)[0];
  if (query) u.searchParams.set("query", query); else u.searchParams.append(`category_${app}_${c[0]}[]`, c[1]);
  const q2 = (QL[g] || {})[ql]; if (q2) u.searchParams.append(`category_${app}_${q2[0]}[]`, q2[1]);
  const keys = Object.keys(SRC).filter(k => !SRC[k].only || SRC[k].only === g);
  // площадка, которая не ответила, просто не показывается — остальные работают
  const [st, fx, ...maps] = await Promise.all([get(u.href), rates().catch(() => null), ...keys.map(k => price(k, g).catch(() => null))]);
  const val = (x, gg) => typeof x === "function" ? x(gg) : x;
  const items = (st.results || []).map(r => { const n = r.hash_name, ad = r.asset_description || {};
    const p = [{ k: "steam", name: "Steam", d: "steamcommunity.com", v: r.sell_price ? r.sell_price / 100 : null, n: r.sell_listings || 0, u: `https://steamcommunity.com/market/listings/${app}/${encodeURIComponent(n)}` }];
    keys.forEach((k, i) => { const m = maps[i]; if (!m) return; const x = m.get(n), S = SRC[k];
      p.push({ k, name: val(S.name, g), d: val(S.d, g), v: x ? x.v : null, n: x ? x.n || 0 : 0, u: (x && x.u) || S.search(g, n), daily: !!S.daily }); });
    return { n, ...rarity(ad.type), img: ad.icon_url ? `https://community.cloudflare.steamstatic.com/economy/image/${ad.icon_url}/160fx120f` : "", col: ad.name_color || "", p }; });
  return { g, fx, total: st.total_count || 0, items };
}

// лоты Steam одного предмета: что внутри — гемы и счётчики (Dota 2), наклейки, брелоки и флоат (CS2)
const unhtml = t => String(t || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
function sockets(html) {
  const out = [];
  for (const b of String(html).split('<div style="white-space: nowrap; padding: 3px;">').slice(1)) {
    const m = /<span style="(font-size: 18px[^"]*)">([^<]*)<\/span><br><span[^>]*>([^<]*)<\/span>/.exec(b); if (!m) continue;
    m[1] = (/color: (rgb\([\d, ]+\))/.exec(m[1]) || [])[1] || "";
    const ic = (/background-image: url\((https:\/\/[^)]+)\)/.exec(b) || [])[1] || "";
    const n = unhtml(m[2]), t = unhtml(m[3]); if (!n || /^Empty Socket$/i.test(n)) continue;
    out.push({ n, t, c: m[1] || "", ic: /^https:\/\/cdn\.(steamstatic|cloudflare\.steamstatic|fastly\.steamstatic)\.com\//.test(ic) ? ic : "" });
  }
  return out;
}
async function lots(g, name) {
  if (!APP[g]) g = "cs";
  const r = await fetch(`https://steamcommunity.com/market/listings/${APP[g]}/${encodeURIComponent(name)}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Blazecrest/1.0)", "Accept-Language": "en-US,en" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("steam " + r.status);
  const html = await r.text(), m = /<script type="application\/json" id="valve-ssr-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("no data");
  const qd = JSON.parse(JSON.parse(m[1]).renderContext.queryData), Q = k => (qd.queries.find(q => q.queryKey[0] === k) || {}).state || {};
  const page = ((Q("market_item_search").data || {}).pages || [])[0] || {};
  const schema = new Map((((qd.queries.find(q => q.queryKey[0] === "AssetPropertySchema") || {}).state || {}).data || {}).property_schemas?.map(x => [x.propertyid, x.name]) || []);
  const list = (page.listings || []).slice(0, 20).map(l => {
    const d = l.description || {}, gems = [], extra = [];
    for (const x of d.descriptions || []) {
      if (/padding: 3px;/.test(x.value || "")) { gems.push(...sockets(x.value)); continue; }
      const t = unhtml(x.value); if (/^(Sticker|Charm|Patch|Kills|Duels|Wins|Assists|Last Hits|Denies)\b[^:]*:/i.test(t)) extra.push(t.slice(0, 200));
    }
    for (const p of (l.asset && l.asset.asset_properties) || []) {
      const v = p.float_value != null ? Number(p.float_value) : p.int_value != null ? p.int_value : p.string_value; const nm = schema.get(p.propertyid) || "";
      if (v != null && nm) extra.push(`${nm}: ${typeof v === "number" && !Number.isInteger(v) ? v.toFixed(6) : v}`);
    }
    return { v: l.eCurrency === 1 ? (l.unPrice + l.unFee) / 100 : null, gems, extra };
  });
  return { g, n: name, total: page.total_count || list.length, url: `https://steamcommunity.com/market/listings/${APP[g]}/${encodeURIComponent(name)}`, items: list };
}

// ---------- матчи CS2: bo3.gg (открытое API их сайта, без ключа) ----------
const B3 = "https://api.bo3.gg/api/v1";
const b3 = path => get(B3 + path);
// картинки bo3.gg отдаём через свой сервер: у части зрителей их домен заблокирован
const px = u => /^https:\/\/files\.bo3\.gg\//.test(u || "") ? "/api/games?q=img&u=" + encodeURIComponent(u) : "";
const b3team = t => t ? { n: t.name, img: px(t.image_url), slug: t.slug } : { n: "TBD", img: "" };
const b3match = m => ({ s: m.slug, st: m.status === "current" ? "live" : m.status === "upcoming" ? "soon" : "done", d: m.start_date, bo: m.bo_type,
  a: { ...b3team(m.team1), sc: m.team1_score }, b: { ...b3team(m.team2), sc: m.team2_score }, w: m.winner_team_id ? (m.winner_team_id === m.team1_id ? 1 : 2) : 0,
  t: m.tournament ? { n: m.tournament.name, img: px(m.tournament.image_url) } : null, tier: m.tier });
const LIST = "&filter[matches.discipline_id][eq]=1&with=teams,tournament";

async function csMatches() {
  const [now, done] = await Promise.all([
    b3(`/matches?page[limit]=16&sort=start_date&filter[matches.status][in]=current,upcoming&filter[matches.tier][in]=s,a${LIST}`),
    b3(`/matches?page[limit]=30&sort=-start_date&filter[matches.status][in]=finished&filter[matches.tier][in]=s,a${LIST}`)]);
  const up = (now.results || []).map(b3match);
  return { live: up.filter(m => m.st === "live"), soon: up.filter(m => m.st === "soon").slice(0, 10), done: (done.results || []).map(b3match) };
}

// конец раунда -> коротко: bomb (взрыв), defuse, time (время вышло), kill (все убиты)
const END = r => /TargetBombed|Bomb(ed)?$/.test(r) ? "bomb" : /Defused/.test(r) ? "defuse" : /Saved/.test(r) ? "time" : "kill";
async function csMatch(slug) {
  if (!/^[\w-]{3,120}$/.test(slug)) throw Object.assign(new Error("bad slug"), { code: 400 });
  // with=tournament у одного матча отдаёт 500 — турнир сайт берёт из списка матчей
  const m = await b3(`/matches/${slug}?with=teams`), base = b3match(m);
  const games = ((await b3(`/games?filter[games.match_id][eq]=${m.id}&page[limit]=7`)).results || []).sort((a, b) => a.number - b.number);
  const side = n => n === m.team1?.name ? 1 : n === m.team2?.name ? 2 : 0;
  const maps = await Promise.all(games.map(async g => {
    const live = g.status !== "finished", ws = side(g.winner_clan_name);
    const [ps, gr] = await Promise.all([b3(`/games/${g.id}/players_stats?x=1`).catch(() => []), b3(`/games/${g.id}?with=players_stats`).catch(() => ({}))]);
    const sc = ws === 2 ? [g.loser_clan_score, g.winner_clan_score] : [g.winner_clan_score, g.loser_clan_score];
    return { n: g.number, map: String(g.map_name || "").replace(/^de_/, ""), live, w: live ? 0 : ws, sc,
      rounds: (gr.game_rounds || []).sort((a, b) => a.round_number - b.round_number).map(r => [side(r.winner_clan_name), END(r.end_reason || ""), r.winner_clan_side === "CT" ? "ct" : "t"]),
      players: (Array.isArray(ps) ? ps : []).map(x => ({ n: x.steam_profile?.player?.nickname || x.steam_profile?.nickname || "?", img: px(x.steam_profile?.player?.image_url),
        tm: side(x.clan_name), k: x.kills, d: x.death, a: x.assists, hs: x.headshots, fk: x.first_kills, fd: x.first_death, adr: Math.round(x.adr || 0),
        kast: Math.round((x.kast || 0) * 100), r: x.player_rating != null ? +(+x.player_rating).toFixed(2) : null, cl: x.clutches || 0 })) };
  }));
  return { ...base, maps, url: `https://bo3.gg/matches/${slug}`, _ttl: base.st === "done" ? 86400 : 60 };
}

// матчи команды из рейтинга Valve: ищем ту же команду на bo3.gg по названию
async function csTeamM(name) {
  name = String(name).slice(0, 60); if (name.length < 2) throw Object.assign(new Error("bad name"), { code: 400 });
  const f = "&filter[teams.discipline_id][eq]=1&page[limit]=5";
  let t = ((await b3(`/teams?filter[teams.name][eq]=${encodeURIComponent(name)}${f}`)).results || [])[0];
  if (!t) t = ((await b3(`/teams?filter[teams.slug][eq]=${encodeURIComponent(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}${f}`)).results || [])[0];
  if (!t) return { found: false, matches: [] };
  const r = await b3(`/matches?page[limit]=16&sort=-start_date&filter[matches.team_ids][overlap]=${t.id}${LIST}`);
  return { found: true, team: { n: t.name, img: px(t.image_url), rank: t.rank }, matches: (r.results || []).map(b3match) };
}

// ---------- матчи Deadlock (deadlock-api.com) ----------
const ranks = lang => memo("dlRanks" + lang, 864e5, () => get(`${DL}/assets/ranks?language=${lang}`));
// средний значок матча: десятки — ранг, единицы — ступень (114 = Этернус 4)
const badge = async (b, lang) => { if (!b) return null; const R = await ranks(lang).catch(() => []), t = Math.floor(b / 10), sub = b % 10, r = R.find(x => x.tier === t);
  return r ? { n: clean(r.name), sub, img: r.images?.[`small_subrank${sub}_webp`] || r.images?.small_subrank1_webp || r.images?.large_webp || "" } : null; };
async function names(ids) {
  ids = [...new Set(ids.filter(Boolean))]; if (!ids.length) return {};
  const r = await get(`${DL}/players/steam?${ids.map(i => "account_ids=" + i).join("&")}`).catch(() => []);
  return Object.fromEntries((Array.isArray(r) ? r : []).map(p => [p.account_id, { n: p.personaname, av: p.avatarmedium || p.avatar || "" }]));
}
// все герои, включая новых и тестовых (в матчах встречаются и они): id -> имя и иконка
const heroAll = lang => memo("dlHA" + lang, 6 * 36e5, async () => Object.fromEntries((await get(`${DL}/assets/heroes?language=${lang}`)).map(h => [h.id, { name: clean(h.name), img: h.images?.icon_image_small_webp || h.images?.icon_image_small || "" }])));
const pickH = (all, ids) => Object.fromEntries([...new Set(ids)].filter(i => all[i]).map(i => [i, all[i]]));
async function dlMatches(lang) {
  const [act, rec] = await Promise.all([get(`${DL}/matches/active`).catch(() => []),
    get(`${DL}/matches/metadata?include_info=true&include_player_info=true&include_player_kda=true&game_mode=normal&min_average_badge=100&min_duration_s=900&order_by=match_id&order_direction=desc&limit=24`).catch(() => [])]);
  const live = act.filter(m => m.game_mode === 1 && m.players?.length === 12).sort((a, b) => b.spectators - a.spectators || b.match_score - a.match_score).slice(0, 8)
    .map(m => ({ id: m.match_id, start: m.start_time, nw: [m.net_worth_team_0, m.net_worth_team_1], spec: m.spectators, ranked: m.match_mode === 4,
      h: [0, 1].map(t => m.players.filter(p => p.team === t).map(p => p.hero_id)) }));
  const done = await Promise.all(rec.map(async m => ({ id: m.match_id, start: Date.parse(m.start_time.replace(" ", "T") + "Z") / 1000, dur: m.duration_s, w: m.winning_team === "Team1" ? 1 : 0,
    rank: await badge(m.average_badge, lang), h: [0, 1].map(t => m.players.filter(p => p.team === "Team" + t).map(p => p.hero_id)),
    k: [0, 1].map(t => m.players.filter(p => p.team === "Team" + t).reduce((a, p) => a + (p.kills || 0), 0)) })));
  if (!live.length && !done.length) throw new Error("no matches");
  const all = await heroAll(lang).catch(() => ({}));
  return { live, done, H: pickH(all, [...live, ...done].flatMap(m => m.h.flat())) };
}
async function dlMatch(id, lang) {
  const d = await get(`${DL}/matches/${id}/metadata`), m = d.match_info || d;
  if (!m.players) throw new Error("no match");
  const [N, all] = await Promise.all([names(m.players.map(p => p.account_id)), heroAll(lang).catch(() => ({}))]);
  const last = p => (p.stats || [])[(p.stats || []).length - 1] || {};
  // души команд по ходу игры (для графика преимущества): плюс — команда 0, минус — команда 1
  const ts = (m.players[0]?.stats || []).map(s => s.time_stamp_s);
  const adv = ts.map((t, i) => [t, m.players.reduce((a, p) => a + (((p.stats || [])[i] || {}).net_worth || 0) * (p.team === 0 ? 1 : -1), 0)]);
  const players = m.players.map(p => { const s = last(p);
    return { acc: p.account_id, ...(N[p.account_id] || { n: "" }), hero: p.hero_id, tm: p.team, lane: p.assigned_lane, k: p.kills, d: p.deaths, a: p.assists,
      nw: p.net_worth, lh: p.last_hits, dn: p.denies, lvl: p.level, dmg: s.player_damage || 0, heal: s.player_healing || 0, obj: s.boss_damage || 0,
      items: (p.items || []).filter(i => !i.sold_time_s).map(i => [i.item_id, Math.round(i.game_time_s / 60)]), left: p.abandon_match_time_s || 0 }; });
  return { id: m.match_id, start: m.start_time, dur: m.duration_s, w: m.winning_team, rank: [await badge(m.average_badge_team0, lang), await badge(m.average_badge_team1, lang)],
    ranked: m.match_mode === 4, boss: [0, 1].map(t => (m.mid_boss || []).filter(b => b.team_claimed === t).length),
    obj: [0, 1].map(t => (m.objectives || []).filter(o => o.team !== t && o.destroyed_time_s > 0).length), adv: adv.length > 1 ? adv : [], players, H: pickH(all, players.map(p => p.hero)) };
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
  if (q === "img") { const u = String(req.query.u || "");
    if (!/^https:\/\/files\.bo3\.gg\/uploads\/[\w\/.-]+\.(webp|png|jpe?g)$/.test(u)) return fail(400, "bad_url");
    try { const r = await fetch(u, { headers: { "User-Agent": UA["User-Agent"] }, signal: AbortSignal.timeout(15000) }); if (!r.ok) return fail(404, "no_image");
      res.setHeader("Content-Type", r.headers.get("content-type") || "image/webp"); res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=2592000, immutable");
      return res.status(200).send(Buffer.from(await r.arrayBuffer())); } catch (e) { return fail(502, "upstream"); } }
  try {
    let out;
    if (q === "csTeams") out = await csTeams();
    else if (q === "csMatches") out = await csMatches();
    else if (q === "csTeam") out = await csTeam(String(req.query.p || ""));
    else if (q === "csMatch") out = await csMatch(String(req.query.s || ""));
    else if (q === "csTeamM") out = await csTeamM(String(req.query.n || ""));
    else if (q === "dlMatches") out = await dlMatches(lang);
    else if (q === "dlMatch") { const id = +req.query.id; if (!(id > 0 && id < 1e10)) return fail(400, "bad_id"); out = await dlMatch(id, lang); }
    else if (q === "dlHeroes") out = await dlHeroes(lang);
    else if (q === "dlItems") out = await dlItems(lang);
    else if (q === "csMarket" || q === "market") { const qs = String(req.query.s || "").trim().slice(0, 60), s0 = Math.max(0, Math.min(90, +req.query.start || 0)), start = s0 - s0 % 10;
      if (qs && qs.length < 2) return fail(400, "bad_query"); out = await market(q === "csMarket" ? "cs" : String(req.query.g || "cs"), String(req.query.cat || ""), qs, start, String(req.query.sort || "pop"), String(req.query.ql || "")); }
    else if (q === "lots") { const n = String(req.query.s || "").slice(0, 120); if (n.length < 2) return fail(400, "bad_query"); out = await lots(String(req.query.g || "cs"), n); }
    else { const id = +req.query.id; if (!(id > 0 && id < 1000)) return fail(400, "bad_id"); out = q === "dlOrder" ? await dlOrder(id, lang) : await dlHero(id); }
    const ttl = out && out._ttl || TTL[q]; if (out) delete out._ttl;
    res.setHeader("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl < 300 ? 60 : 86400}`);
    res.status(200).json(out);
  } catch (e) { fail(e.code === 400 ? 400 : 502, "upstream"); }
};
