// Официальные новости Dota 2 из Steam (переводы делает сама Valve) + текущий патч.
//   GET /api/news?lang=ru  -> { checked, patch: { num, ts, major, majorTs }, items: [{ ts, t, x, img, url, cat }] }
//   GET /api/news?app=cs|deadlock&lang=ru -> то же для Counter-Strike 2 и Deadlock (без patch)
// Кеш на Vercel: все посетители делят один запрос, обновляется сам раз в полчаса.
const APPS = { dota: 570, cs: 730, deadlock: 1422450 };
const UA = { Accept: "application/json", "User-Agent": "1x6-builds (+https://1x6-eta.vercel.app)" };
// язык сайта -> язык Steam (белорусский и казахский Valve не переводит — берём русский)
const STEAM = { ru: "russian", uk: "ukrainian", en: "english", es: "spanish", pt: "brazilian", de: "german", pl: "polish", tr: "turkish",
  fr: "french", it: "italian", kk: "russian", be: "russian", nl: "dutch", zh: "schinese", ja: "japanese", ko: "koreana" };
// индексы языков Steam в localized_capsule_image
const LIDX = { english: 0, german: 1, french: 2, italian: 3, koreana: 4, spanish: 5, schinese: 6, russian: 8, japanese: 10, polish: 14, dutch: 16, turkish: 19, brazilian: 22, ukrainian: 26 };
// картинки лежат в папке группы Steam: её id = clan_steamid - 103582791429521408
const IMG = e => `https://clan.akamai.steamstatic.com/images/${Number(BigInt(e.clan_steamid || "103582791433224455") - 103582791429521408n)}/`;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// BBCode Steam -> короткий абзац текста: первые предложения, примерно до 420 символов
function summary(body) {
  const txt = String(body || "")
    .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, " ")
    .replace(/\{STEAM_CLAN_(LOC_)?IMAGE\}\/\S+/g, " ")
    .replace(/\[\/?(p|h\d|list|olist|\*|tr|td|th|table)\b[^\]]*\]/gi, "\n")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  let out = "";
  for (const s of txt.split(/(?<=[.!?。！？])\s+|\n+/)) {
    if (!s.trim()) continue;
    if (out && out.length + s.length > 420) break;
    out += (out ? " " : "") + s.trim();
  }
  return out.length > 480 ? out.slice(0, 470).replace(/\s+\S*$/, "") + "…" : out;
}

function pic(e, lang) {
  try {
    const j = JSON.parse(e.jsondata || "{}"), caps = j.localized_capsule_image || [];
    const f = caps[LIDX[lang]] || caps[0];
    if (f) return IMG(e) + f;
  } catch (err) { /* без картинки */ }
  const m = /\{STEAM_CLAN_(?:LOC_)?IMAGE\}\/\d+\/([\w.-]+\.(?:png|jpe?g|gif|webp))/i.exec(e.announcement_body?.body || "");
  return m ? IMG(e) + m[1] : "";
}

const PATCH = /\d\.\d{2}[a-z]?\b|patch|update|патч|обновлени|оновлен/i;

async function events(lang, APP) {
  const r = await fetch(`https://store.steampowered.com/events/ajaxgetpartnereventspageable/?clan_accountid=0&appid=${APP}&offset=0&count=15&l=${lang}`, { headers: UA });
  if (!r.ok) throw new Error("steam " + r.status);
  const d = await r.json();
  return (d.events || []).filter(e => e.announcement_body && !e.hidden).map(e => {
    const t = e.event_name || e.announcement_body.headline || "";
    return {
      ts: e.rtime32_start_time || e.announcement_body.posttime,
      t: esc(t),
      x: esc(summary(e.announcement_body.body)),
      img: pic(e, lang),
      url: `https://store.steampowered.com/news/app/${APP}/view/${e.announcement_body.gid}`,
      cat: [12, 14].includes(e.event_type) || PATCH.test(t) ? "patch" : "valve",
    };
  });
}

async function patch() {
  const r = await fetch("https://www.dota2.com/datafeed/patchnoteslist?language=english", { headers: UA });
  if (!r.ok) return null;
  const list = (await r.json()).patches || [];
  const last = list[list.length - 1], major = [...list].reverse().find(p => /^\d+\.\d+$/.test(p.patch_number));
  return last ? { num: last.patch_number, ts: last.patch_timestamp, major: major?.patch_number, majorTs: major?.patch_timestamp } : null;
}

module.exports = async (req, res) => {
  const lang = STEAM[String(req.query.lang || "ru")] || "english", app = APPS[String(req.query.app || "dota")] || 570;
  try {
    const [items, p] = await Promise.all([events(lang, app), app === 570 ? patch().catch(() => null) : null]);
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json({ checked: new Date().toISOString(), patch: p, items });
  } catch (err) {
    res.setHeader("Cache-Control", "public, s-maxage=120");
    res.status(502).json({ error: "steam unavailable" });
  }
};
