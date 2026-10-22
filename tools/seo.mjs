// SEO: отдельные страницы сборок героев (/heroes/<slug>), список /heroes, свежие /dota2 и /chc из index.html, sitemap.xml
// Запуск: node tools/seo.mjs из корня репозитория или из папки над ним (перезапускать после правок index.html)
import fs from "fs";
const R = fs.existsSync("1x6-builds/index.html") ? "1x6-builds/" : "", SITE = "https://1x6-eta.vercel.app";
const idx = fs.readFileSync(R + "index.html", "utf8").replace(/\r\n/g, "\n");
const lit = name => { const a = idx.indexOf(`const ${name} = `); if (a < 0) throw new Error(name); let i = idx.indexOf("=", a) + 1;
  const open = idx[idx.indexOf(idx.slice(i).trim()[0], i)], close = open === "[" ? "]" : "}"; let d = 0, j = idx.indexOf(open, i);
  for (let k = j; k < idx.length; k++) { const c = idx[k]; if (c === open) d++; else if (c === close && --d === 0) return eval("(" + idx.slice(j, k + 1) + ")"); } };
const HEROES = lit("HEROES"), BUILDS = lit("BUILDS"), THEME = lit("THEME"), ARCANA = lit("ARCANA"), STAGES = lit("STAGES");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const good = h => { const B = BUILDS[h.slug] || {}; return Object.keys(B).sort((a, b) => a - b).filter(k => !B[k].e); };
const today = new Date().toISOString().slice(0, 10);

// ---------- 1) /dota2 и /chc — копии главной со своими мета-тегами и стартовой вкладкой ----------
for (const f of ["dota2.html", "chc.html"]) {
  const old = fs.readFileSync(R + f, "utf8").replace(/\r\n/g, "\n").split("\n"), out = idx.split("\n");
  const pats = [/^<title>/, /^<meta name="description"/, /^<link rel="canonical"/, /property="og:url"/, /property="og:title"/, /property="og:description"/, /property="og:image"/, /name="twitter:title"/, /name="twitter:description"/, /name="twitter:image"/];
  for (const p of pats) { const o = old.find(l => p.test(l)), n = out.findIndex(l => p.test(l)); if (o && n >= 0) out[n] = o; }
  const st = old.find(l => l.includes("window.START_TAB")), ld = out.findIndex(l => l.startsWith('<script type="application/ld+json">'));
  if (st && ld >= 0) out.splice(ld + 1, out[ld + 1] === "" ? 1 : 0, st);
  fs.writeFileSync(R + f, out.join("\n"));
}

// ---------- 2) страницы героев ----------
const CSS = `:root{--bg:#08080b;--fg:#f1f1f5;--muted:#9a9aab;--line:rgba(255,255,255,.09);--soft:#121218}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(900px 500px at 85% -10%,color-mix(in srgb,var(--c1) 22%,transparent),transparent 70%),var(--bg);color:var(--fg);font:16px/1.55 Manrope,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.w{max-width:1000px;margin:0 auto;padding:0 16px}
header{display:flex;align-items:center;gap:12px;padding:14px 0}header a.logo{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:800}
.mark{display:block;width:34px;height:34px}.mark svg,.mark img{width:100%;height:100%;display:block;object-fit:contain}
header .go{margin-left:auto;padding:9px 16px;border-radius:99px;background:#fff;color:#111;font-weight:700;text-decoration:none;font-size:14px}
.bc{font-size:13px;color:var(--muted);margin:6px 0 18px}.bc a{color:var(--muted)}
.hero{display:grid;grid-template-columns:260px 1fr;gap:24px;align-items:center;padding:20px;border-radius:22px;border:1px solid var(--line);background:linear-gradient(135deg,color-mix(in srgb,var(--c1) 18%,transparent),color-mix(in srgb,var(--c2) 60%,transparent))}
.hero img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:16px}
h1{font-size:clamp(28px,5vw,44px);line-height:1.1;margin:0 0 10px;letter-spacing:-1px}.sub{color:var(--muted);margin:0 0 14px}
.tags{display:flex;flex-wrap:wrap;gap:6px}.tags span{font-size:12.5px;font-weight:700;padding:4px 10px;border-radius:99px;background:rgba(255,255,255,.07);border:1px solid var(--line)}
.tags .arc{color:#f3c35a;border-color:rgba(243,195,90,.45)}
.cta{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:99px;background:linear-gradient(90deg,var(--c1),#4a60e8);color:#fff;font-weight:800;text-decoration:none}
h2{font-size:22px;margin:34px 0 12px}
.v{border:1px solid var(--line);border-radius:18px;background:var(--soft);padding:14px;margin-bottom:14px}.v h3{margin:0 0 10px;font-size:17px}
.b{display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:stretch}
.st{display:grid;grid-template-rows:repeat(4,1fr);gap:0}.st div{display:flex;flex-direction:column;justify-content:center;font-size:13px;font-weight:700}.st small{color:var(--muted);font-weight:500}
.sp{position:relative;overflow:hidden;border-radius:10px;aspect-ratio:1000/432}.sp img{position:absolute;left:0;top:0;width:118.4%;height:auto}
.tips{color:#cfcfda}.tips li{margin:4px 0}
.all{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.all a{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:12px;border:1px solid var(--line);background:var(--soft);text-decoration:none;font-size:13.5px;font-weight:700;min-width:0}
.all a img{width:30px;height:30px;border-radius:8px;object-fit:cover;flex:none}.all a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
footer{color:var(--muted);font-size:13px;padding:36px 0 40px;text-align:center}
@media(max-width:700px){.hero{grid-template-columns:1fr}.hero img{max-width:240px;margin:0 auto;display:block}.b{grid-template-columns:78px 1fr}.st div{font-size:11px}}`;
const head = (title, desc, url, img, ld, c1, c2) => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#08080b">
<meta property="og:type" content="article"><meta property="og:site_name" content="Aegis"><meta property="og:locale" content="ru_RU">
<meta property="og:url" content="${url}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>:root{--c1:${c1};--c2:${c2}}${CSS}</style>
</head>`;
const top = `<header class="w"><a class="logo" href="/"><span class="mark lg"><img src="/logo.png" alt="" width="64" height="64"></span><span>Aegis</span></a><a class="go" href="/">Открыть сайт</a></header>`;
const allList = cur => `<div class="all">${HEROES.map(h => `<a href="/heroes/${h.slug}"${h.slug === cur ? ' aria-current="page"' : ""}><img src="/face/${h.slug}.webp" alt="" loading="lazy" width="30" height="30"><span>${esc(h.en)}</span></a>`).join("")}</div>`;
const foot = `<footer class="w">Aegis · неофициальный каталог сборок для кастомки Dota 1×6. Арт героев и предметов — Valve.<br><a href="/">Главная</a> · <a href="/heroes">Все герои</a> · <a href="/chc">Custom Hero Chaos</a> · <a href="/dota2">Мета Dota 2</a></footer>`;
fs.mkdirSync(R + "heroes", { recursive: true });
const urls = [];
for (const h of HEROES) {
  const ks = good(h), arc = ARCANA[h.slug], [elem, c1, c2] = THEME[h.slug] || ["", "#e8564a", "#1a1a22"];
  if (!ks.length) continue;
  const url = `${SITE}/heroes/${h.slug}`;
  const title = `${h.en} (${h.ru}) — сборка Dota 1x6 | Aegis`;
  const desc = `Сборка ${h.en} (${h.ru}) для кастомки Dota 1x6: ${ks.length} ${ks.length === 1 ? "вариант" : ks.length < 5 ? "варианта" : "вариантов"} предметов по этапам игры — начало, ранняя, середина и поздняя.${arc ? ` Аркана: ${arc}.` : ""}`;
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "Article", headline: `Сборка ${h.en} для Dota 1x6`, inLanguage: "ru", image: `${SITE}/hero/${h.slug}.webp`, dateModified: today, author: { "@type": "Organization", name: "Aegis" }, mainEntityOfPage: url },
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Aegis", item: SITE + "/" }, { "@type": "ListItem", position: 2, name: "Герои", item: SITE + "/heroes" }, { "@type": "ListItem", position: 3, name: h.en, item: url }] }] };
  const vars = ks.map((k, i) => `<section class="v"><h3>Вариант ${i + 1}</h3><div class="b"><div class="st">${STAGES.map(s => `<div>${s[0]}<small>${s[1]}</small></div>`).join("")}</div>
    <div class="sp"><img src="/build/${h.slug}-${k}.webp" alt="Сборка ${esc(h.en)} для Dota 1x6, вариант ${i + 1}: предметы по этапам игры" loading="${i ? "lazy" : "eager"}" width="1184" height="542"></div></div></section>`).join("\n");
  const html = `${head(title, desc, url, `${SITE}/hero/${h.slug}.webp`, ld, c1, c2)}
<body>
${top}
<main class="w">
<nav class="bc"><a href="/">Aegis</a> › <a href="/heroes">Герои</a> › ${esc(h.en)}</nav>
<div class="hero"><img src="/hero/${h.slug}.webp" alt="${esc(h.en)} — ${esc(h.ru)}" width="300" height="400">
<div><h1>Сборка ${esc(h.en)} для Dota 1x6</h1><p class="sub">${esc(h.ru)} · ${ks.length} ${ks.length === 1 ? "вариант сборки" : ks.length < 5 ? "варианта сборки" : "вариантов сборки"} · предметы по этапам игры</p>
<div class="tags"><span>Dota 1x6</span><span>${esc(h.ru)}</span>${arc ? `<span class="arc">✦ Аркана: ${esc(arc)}</span>` : ""}</div>
<a class="cta" href="/?h=${h.slug}">Открыть сборку на сайте →</a></div></div>
<h2>Сборки ${esc(h.en)}: что собирать по этапам</h2>
${vars}
<h2>Как играть ${esc(h.en)} в 1x6</h2>
<ul class="tips"><li><b>Начало игры (~4 мин)</b> — стартовые предметы, чтобы спокойно пережить первые волны.</li><li><b>Ранняя игра (~12 мин)</b> — предметы, от которых зависит, как быстро ${esc(h.en)} начнёт фармить и драться.</li><li><b>Середина (~25 мин)</b> — основа сборки: с ней герой забирает драки.</li><li><b>Поздняя игра (31+ мин)</b> — финальные предметы под затяжные бои.</li></ul>
<p class="sub">На сайте у каждого героя живая анимация, рулетка билдов, избранное и мини-игры. <a href="/?h=${h.slug}">Открыть ${esc(h.en)} на Aegis</a>.</p>
<h2>Сборки других героев Dota 1x6</h2>
${allList(h.slug)}
</main>
${foot}
</body>
</html>
`;
  fs.writeFileSync(R + `heroes/${h.slug}.html`, html);
  urls.push(`/heroes/${h.slug}`);
}
// список героев
{
  const url = SITE + "/heroes", title = "Все сборки героев Dota 1x6 — 54 героя | Aegis", desc = "Сборки всех 54 героев кастомки Dota 1x6: предметы по этапам игры, несколько вариантов на героя и арканы. Выбери героя.";
  const ld = { "@context": "https://schema.org", "@type": "CollectionPage", name: "Сборки героев Dota 1x6", url, inLanguage: "ru" };
  fs.writeFileSync(R + "heroes.html", `${head(title, desc, url, SITE + "/og/main.png", ld, "#e8564a", "#1a1a2e")}
<body>
${top}
<main class="w">
<nav class="bc"><a href="/">Aegis</a> › Герои</nav>
<h1>Сборки всех героев Dota 1x6</h1>
<p class="sub">54 героя кастомки Dota 1x6. У каждого — готовые сборки предметов по этапам игры: начало, ранняя, середина и поздняя. Герои с ✦ — с арканой.</p>
<div class="all" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">${HEROES.map(h => `<a href="/heroes/${h.slug}"><img src="/face/${h.slug}.webp" alt="" loading="lazy" width="30" height="30"><span>${esc(h.en)}${ARCANA[h.slug] ? " ✦" : ""}<br><small style="color:var(--muted);font-weight:500">${esc(h.ru)}</small></span></a>`).join("")}</div>
</main>
${foot}
</body>
</html>
`);
}
// ---------- 3) sitemap ----------
const u = (loc, f, p) => `  <url><loc>${SITE}${loc}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq><priority>${p}</priority></url>`;
fs.writeFileSync(R + "sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[u("/", "daily", "1.0"), u("/heroes", "weekly", "0.9"), u("/dota2", "daily", "0.9"), u("/chc", "weekly", "0.9"), ...urls.map(x => u(x, "weekly", "0.8")), u("/privacy", "yearly", "0.2")].join("\n")}
</urlset>
`);
console.log("heroes:", urls.length);
