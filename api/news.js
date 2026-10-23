// Официальные новости Dota 2 из Steam (переводы делает сама Valve) + текущий патч.
//   GET /api/news?lang=ru  -> { checked, patch: { num, ts, major, majorTs }, items: [{ ts, t, x, img, url, cat }] }
//   GET /api/news?app=cs|deadlock&lang=ru -> то же для Counter-Strike 2 и Deadlock (без patch)
//   GET /api/news?app=cs&gid=<gid>&lang=ru -> одна новость с полным текстом (h — безопасный HTML)
// Кеш на Vercel: все посетители делят один запрос, обновляется сам раз в полчаса.
const APPS = { dota: 570, cs: 730, deadlock: 1422450 };
const UA = { Accept: "application/json", "User-Agent": "1x6-builds (+https://blazecrest.vercel.app)" };
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

// полный текст: BBCode Steam -> безопасный HTML (сначала экранируем, потом разрешаем только известные теги)
function full(e) {
  const img = f => `<img alt="" loading="lazy" src="${IMG(e)}${f}">`;
  let h = esc(String(e.announcement_body?.body || ""))
    .replace(/\[img(?:\s[^\]]*)?\]\{STEAM_CLAN_(?:LOC_)?IMAGE\}\/\d+\/([\w.-]+)\[\/img\]/gi, (_, f) => img(f))
    .replace(/\[img src=&quot;\{STEAM_CLAN_(?:LOC_)?IMAGE\}\/\d+\/([\w.-]+)&quot;[^\]]*\]\[\/img\]/gi, (_, f) => img(f))
    .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, "")
    .replace(/\[url=(?:&quot;)?(https?:\/\/[^\]\s]+?)(?:&quot;)?\]([\s\S]*?)\[\/url\]/gi, (_, u, t) => `<a href="${u}" target="_blank" rel="noopener nofollow">${t}</a>`)
    .replace(/\[previewyoutube=(?:&quot;)?([\w-]{6,20})[^\]]*\]\[\/previewyoutube\]/gi, (_, v) => `<a class="nyt" href="https://www.youtube.com/watch?v=${v}" target="_blank" rel="noopener">▶ YouTube</a>`)
    .replace(/\[(\/?)(b|i|u|h1|h2|h3|hr|ul|li)\]/gi, "<$1$2>")
    .replace(/\[(\/?)strike\]/gi, "<$1s>").replace(/\[(\/?)quote[^\]]*\]/gi, "<$1blockquote>")
    .replace(/\[list\]|\[olist\]/gi, "<ul>").replace(/\[\/list\]|\[\/olist\]/gi, "</ul>").replace(/\[\*\]/g, "<li>")
    .replace(/\[p[^\]]*\]/gi, "<p>").replace(/\[\/p\]/gi, "</p>")
    .replace(/\[[^\]]{1,40}\]/g, "")
    .replace(/\{STEAM_CLAN_(LOC_)?IMAGE\}\/\S+/g, "");
  h = h.replace(/\r/g, "").replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>").replace(/<p>\s*<\/p>/g, "").replace(/(<img [^>]*>)(<\/p>)?(<br>)+/g, "$1$2");
  return h.length > 60000 ? h.slice(0, 60000) : h;
}

const PATCH = /\d\.\d{2}[a-z]?\b|patch|update|патч|обновлени|оновлен/i;

async function events(lang, APP, withFull) {
  const r = await fetch(`https://store.steampowered.com/events/ajaxgetpartnereventspageable/?clan_accountid=0&appid=${APP}&offset=0&count=15&l=${lang}`, { headers: UA });
  if (!r.ok) throw new Error("steam " + r.status);
  const d = await r.json();
  return (d.events || []).filter(e => e.announcement_body && !e.hidden).map(e => {
    if (withFull && String(e.announcement_body.gid) !== withFull) return null;
    const t = e.event_name || e.announcement_body.headline || "";
    return {
      ts: e.rtime32_start_time || e.announcement_body.posttime,
      t: esc(t),
      x: esc(summary(e.announcement_body.body)),
      img: pic(e, lang),
      gid: String(e.announcement_body.gid),
      url: `https://store.steampowered.com/news/app/${APP}/view/${e.announcement_body.gid}`,
      cat: [12, 14].includes(e.event_type) || PATCH.test(t) ? "patch" : "valve",
      ...(withFull ? { h: full(e) } : {}),
    };
  }).filter(Boolean);
}

async function patch() {
  const r = await fetch("https://www.dota2.com/datafeed/patchnoteslist?language=english", { headers: UA });
  if (!r.ok) return null;
  const list = (await r.json()).patches || [];
  const last = list[list.length - 1], major = [...list].reverse().find(p => /^\d+\.\d+$/.test(p.patch_number));
  return last ? { num: last.patch_number, ts: last.patch_timestamp, major: major?.patch_number, majorTs: major?.patch_timestamp } : null;
}

// Telegram-канал Dota2.exe (t.me/dota2_exe_news): публичная веб-версия канала, обновление раз в час
const TGCH = { dota: "dota2_exe_news", cs: "cs2_exe_news", deadlock: "deadlocknews" };
const unent = t => String(t).replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const TGCAT = [["patch", /патч|обновлени|\bбаг|фикс|\b7\.\d\d|баланс|нерф|бафф|апдейт/i], ["events", /турнир|\bTI\b|интернешнл|international|мейджор|major|финал|плей-?офф|квалификац|групп[аы]|матч|рошан|riyadh|dreamleague|blast|pgl|esl|beyond|fissure|bo3|bo5|vs\.?/i],
  ["leaks", /датамайн|слив|утечк|в файлах|нашли в клиенте|инсайд/i], ["players", /состав|ростер|трансфер|игрок|кэрри|мидер|оффлейн|саппорт|стрим|\bmmr\b|ммр|ранг/i]];
async function tgNews(TG) {
  const r = await fetch(`https://t.me/s/${TG}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Blazecrest/1.0; +https://blazecrest.vercel.app)", "Accept-Language": "ru" } });
  if (!r.ok) throw new Error("tg " + r.status);
  const html = await r.text(), out = [];
  for (const ch of html.split('class="tgme_widget_message_wrap').slice(1)) {
    const id = (/data-post="[\w]+\/(\d+)"/.exec(ch) || [])[1]; if (!id) continue;
    const tm = (/<time[^>]*datetime="([^"]+)"/.exec(ch) || [])[1]; const ts = tm ? Math.floor(Date.parse(tm) / 1000) : 0;
    const m = /<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="tgme_widget_message_(?:footer|reply_markup|link_preview)|<\/div>)/.exec(ch);
    let raw = m ? m[1] : "";
    const txt = unent(raw.replace(/<br\s*\/?>/gi, "\n").replace(/<i class="emoji"[^>]*><b>([^<]*)<\/b><\/i>/g, "$1").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!txt || /реклама|erid|winline|1xbet|fonbet|бетбум|betboom|букмекер|ставк|промокод|казино|casino|депозит|пополнени|бонус к|забирай|переходи по ссылке/i.test(txt)) continue;
    const img = (/tgme_widget_message_(?:photo_wrap|video_thumb)[^>]*background-image:url\('(https:\/\/[^']+)'\)/.exec(ch) || [])[1] || "";
    const lines = txt.split("\n").map(x => x.trim()).filter(x => x && !/(Dota2|CS2)\.exe\s*\||розыгрыш|подписывайся|@dota2_exe|@cs2_exe|@deadlocknews/i.test(x));
    let t = lines[0], rest = lines.slice(1).join("\n");
    if (t.length > 110) { const cut = t.slice(0, 100).replace(/\s+\S*$/, ""); rest = t.slice(cut.length).trim() + (rest ? "\n" + rest : ""); t = cut + "…"; }
    const cat = (TGCAT.find(([, re]) => re.test(txt)) || ["community"])[0];
    out.push({ ts, t: esc(t), x: esc(rest || "").replace(/\n/g, "<br>"), img: /^https:\/\/cdn\d*\.(telesco\.pe|cdn-telegram\.org)\//.test(img) ? img : "", url: `https://t.me/${TG}/${id}`, post: +id, cat, src: "tg" });
  }
  return out.reverse().slice(0, 30);
}

module.exports = async (req, res) => {
  if (req.query.src === "tg") {
    try { const items = await tgNews(TGCH[String(req.query.ch || "dota")] || TGCH.dota); res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200"); return res.status(200).json({ checked: new Date().toISOString(), items }); }
    catch (e) { res.setHeader("Cache-Control", "public, s-maxage=300"); return res.status(502).json({ error: "tg unavailable" }); }
  }
  const lang = STEAM[String(req.query.lang || "ru")] || "english", app = APPS[String(req.query.app || "dota")] || 570;
  const gid = /^\d{5,25}$/.test(String(req.query.gid || "")) ? String(req.query.gid) : "";
  try {
    if (gid) {
      const [it] = await events(lang, app, gid);
      if (!it) { res.setHeader("Cache-Control", "public, s-maxage=300"); return res.status(404).json({ error: "not_found" }); }
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      return res.status(200).json(it);
    }
    const [items, p] = await Promise.all([events(lang, app), app === 570 ? patch().catch(() => null) : null]);
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json({ checked: new Date().toISOString(), patch: p, items });
  } catch (err) {
    res.setHeader("Cache-Control", "public, s-maxage=120");
    res.status(502).json({ error: "steam unavailable" });
  }
};
