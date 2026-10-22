/* Сетки героев Dota 2: редактор hero_grid_config.json, арт-сцены из точек, мастерская */
const GRIDS = (() => {
  // поле сетки в Доте — 1193×593; портреты в категории Дота сама подгоняет под её размер (71×94)
  const GW = 1193, GH = 593, PA = 71 / 94, PG = 2, LF = 13, SYM = 30, TW = 40, TH = 53, LBL = 18;
  const KEY = "ub-grid", esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ATTR = [["str", "Сила", "#e5533d"], ["agi", "Ловкость", "#3fbf5a"], ["int", "Интеллект", "#3d8fe5"], ["all", "Универсал", "#c99a3a"]];
  const ROLES = [["Carry", "Керри"], ["Support", "Поддержка"], ["Nuker", "Нюкеры"], ["Disabler", "Контроль"], ["Initiator", "Инициаторы"], ["Escape", "Мобильные"], ["Pusher", "Пушеры"], ["Durable", "Танки"]];
  const SCENES = [["marci", "Марси"], ["lina", "Лина"], ["crystalmaiden", "Кристал Мейден"], ["drowranger", "Дров Рейнджер"], ["templarassassin", "Темпларка"], ["queenofpain", "Королева Боли"], ["muerta", "Муэрта"], ["legioncommander", "Легион"], ["juggernaut", "Джаггернаут"], ["invoker", "Инвокер"], ["phantomassassin", "Фантомка"], ["hoodwink", "Худвинк"]];
  let H = [], HB = {}, FILE = null, cur = 0, sel = -1, selG = null, view = "edit", built = false, pane, stage, s = 1, pf = { q: "", a: "" };

  /* ---------- хранение ---------- */
  const blank = n => ({ config_name: n || "Моя сетка", categories: [] });
  function load(){ try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && Array.isArray(v.configs) && v.configs.length) { FILE = v; cur = Math.min(+v._cur || 0, v.configs.length - 1); return; } } catch(e) {} FILE = { version: 3, configs: [blank()] }; cur = 0; }
  let sT = 0; function save(){ clearTimeout(sT); sT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ ...FILE, _cur: cur })); } catch(e) { PROF.toast("Сетка слишком большая для памяти браузера — скачай файл, чтобы не потерять."); } }, 300); }
  const C = () => FILE.configs[cur];
  const r1 = v => Math.round((+v || 0) * 10) / 10;
  const isSym = k => !k.hero_ids.length && k.width <= SYM + 1 && k.height <= SYM + 1;
  const cleanCat = k => ({ category_name: String(k.category_name || ""), x_position: r1(k.x_position), y_position: r1(k.y_position), width: r1(k.width), height: r1(k.height), hero_ids: (k.hero_ids || []).map(Number).filter(Boolean) });
  const clean = f => ({ version: 3, configs: f.configs.map(c => ({ config_name: String(c.config_name || "Сетка"), categories: (c.categories || []).map(cleanCat) })) });
  // внутри редактора символы рисунка помечены группой _g, чтобы двигать его целиком (в файл не попадает)
  const keepG = f => ({ version: 3, configs: f.configs.map(c => ({ config_name: String(c.config_name || "Сетка"), categories: (c.categories || []).map(k => ({ ...cleanCat(k), ...(k._g ? { _g: k._g } : isSym(cleanCat(k)) ? { _g: "art" } : {}) })) })) });

  /* ---------- герои ---------- */
  async function heroes(){
    if (H.length) return H;
    const list = await D2.loadHeroes();
    H = (list || []).map(h => ({ id: +h.id, n: h.localized_name, a: h.primary_attr, r: h.roles || [], img: D2.img(h.img), wr: (+h.pub_win || 0) / Math.max(1, +h.pub_pick || 0), pick: +h.pub_pick || 0 })).sort((x, y) => x.n.localeCompare(y.n));
    HB = Object.fromEntries(H.map(h => [h.id, h])); return H;
  }
  // как Дота раскладывает портреты: самый крупный размер, при котором все влезают
  function fit(k){
    const n = k.hero_ids.length; if (!n) return null; let best = { tw: 0, cols: 1 };
    for (let cols = 1; cols <= n; cols++){ const rows = Math.ceil(n / cols), tw = Math.min((k.width - PG * (cols - 1)) / cols, ((k.height - PG * (rows - 1)) / rows) * PA); if (tw > best.tw) best = { tw, cols }; }
    best.tw = Math.max(4, best.tw); best.th = best.tw / PA; return best;
  }

  /* ---------- шаблоны ---------- */
  function stack(groups, cols){
    cols = cols || 1; const cw = (GW - (cols - 1) * 12) / cols, per = Math.max(1, Math.floor((cw + PG) / (TW + PG))); const out = [], ys = Array(cols).fill(0);
    groups.forEach(g => { const c = ys.indexOf(Math.min(...ys)), rows = Math.max(g.rows || 1, Math.ceil(g.ids.length / per)), h = rows * (TH + PG);
      out.push({ category_name: g.name, x_position: c * (cw + 12), y_position: ys[c] + LBL, width: cw, height: h, hero_ids: g.ids }); ys[c] += h + LBL + 8; });
    return out;
  }
  // распределение всех героев по позициям — по ролям из статистики
  function byPos(){ const P = [[], [], [], [], []];
    H.forEach(h => { const r = h.r; let i = r.includes("Support") ? (r.includes("Disabler") && !r.includes("Escape") ? 4 : 3) : r.includes("Carry") ? (r.includes("Nuker") && r.includes("Escape") ? 1 : 0) : r.includes("Initiator") || r.includes("Durable") ? 2 : r.includes("Nuker") ? 1 : 3; P[i].push(h.id); });
    return P; }
  let gid = 0; const newG = () => "g" + Date.now().toString(36) + (gid++);
  // левая колонка «1 POS … BAN» в рамке из символов, справа место под арт — как в арт-сетках
  function posLayout(fill, side){
    const P = fill ? byPos() : [[], [], [], [], []], out = [], g = newG(), x = side === "l" ? 584 : 66, w = 520, h = 74, step = 94, y0 = 16;
    ["1 POS", "2 POS", "3 POS", "4 POS", "5 POS", "BAN"].forEach((t, i) => { const y = y0 + i * step;
      out.push({ category_name: "", x_position: x, y_position: y, width: w, height: h, hero_ids: P[i] || [] });
      out.push({ category_name: t, x_position: x + w + 14, y_position: y + h / 2 - 9, width: SYM, height: SYM, hero_ids: [], _g: g }); });
    return out.concat(frame(x - 22, y0 - 12, w + 90, 5 * step + h + 24, "·", 9, g));
  }
  function frame(x, y, w, h, ch, gap, g){ const out = [], put = (px, py) => out.push({ category_name: ch, x_position: r1(px), y_position: r1(py), width: SYM, height: SYM, hero_ids: [], _g: g });
    for (let px = x; px <= x + w; px += gap){ put(px, y); put(px, y + h); } for (let py = y + gap; py < y + h; py += gap){ put(x, py); put(x + w, py); } return out; }
  const PRESETS = [
    { k: "posart", n: "Позиции + место под арт", d: "1–5 POS и BAN слева в рамке, справа — место под рисунок", f: () => posLayout(true) },
    { k: "attr", n: "По атрибутам", d: "Сила, ловкость, интеллект и универсалы — как в обычной Доте", f: () => stack(ATTR.map(a => ({ name: a[1], ids: H.filter(h => h.a === a[0]).map(h => h.id) }))) },
    { k: "roles", n: "По ролям", d: "Керри, саппорты, инициаторы, нюкеры — герой может быть в нескольких", f: () => stack(ROLES.map(r => ({ name: r[1], ids: H.filter(h => h.r.includes(r[0])).map(h => h.id) })), 2) },
    { k: "meta", n: "Мета по винрейту", d: "Сильные сейчас, средние и слабые — по свежей статистике", f: () => { const by = [...H].filter(h => h.pick > 0).sort((a, b) => b.wr - a.wr); return stack([["Сильные (52%+)", h => h.wr >= .52], ["Средние", h => h.wr >= .49 && h.wr < .52], ["Слабые (<49%)", h => h.wr < .49]].map(([n, t]) => ({ name: n, ids: by.filter(t).map(h => h.id) }))); } },
    { k: "abc", n: "По алфавиту", d: "Все герои A–Z одним блоком", f: () => stack([{ name: "Все герои", ids: H.map(h => h.id) }]) }
  ];

  /* ---------- арт: картинка → точки вдоль контуров ---------- */
  const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  // обрезка по содержимому: прозрачные поля рендеров не тратят место
  function trim(img){
    const w = Math.min(400, img.width), h = Math.round(img.height * w / img.width), c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, any = false; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 24){ any = true; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (!any || (x1 - x0 > w * .97 && y1 - y0 > h * .97)) return { img, sx: 0, sy: 0, sw: img.width, sh: img.height };
    const k = img.width / w; return { img, sx: x0 * k, sy: y0 * k, sw: (x1 - x0 + 1) * k, sh: (y1 - y0 + 1) * k };
  }
  function artCats(img0, o){
    // o: { x, y, w, h, mode: line|fill, step, thr, ch, inv }
    const T0 = img0.sw ? img0 : trim(img0), cr = o.crop || 1, T = { ...T0, sh: T0.sh * cr, sx: T0.sx + (cr < .5 ? T0.sw * .18 : 0), sw: cr < .5 ? T0.sw * .64 : T0.sw }, img = { width: T.sw, height: T.sh };
    const px = 1.5, cw = Math.max(8, Math.round(o.w / px)), chh = Math.max(8, Math.round(o.h / px));
    const sc = Math.min(cw / img.width, chh / img.height), iw = Math.round(img.width * sc), ih = Math.round(img.height * sc);
    const c = document.createElement("canvas"); c.width = cw; c.height = chh; const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#000"; g.fillRect(0, 0, cw, chh); const ox = Math.round((cw - iw) / 2), oy = Math.round(chh - ih); g.drawImage(T.img, T.sx, T.sy, T.sw, T.sh, ox, oy, iw, ih);
    const d = g.getImageData(0, 0, cw, chh).data, L = new Float32Array(cw * chh);
    for (let i = 0; i < L.length; i++){ let v = (.299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2]) / 255; L[i] = o.inv ? 1 - v : v; }
    const out = [], G = o.g || newG(), put = (x, y, ch) => out.push({ category_name: ch, x_position: r1(o.x + x * px), y_position: r1(o.y + y * px - 10), width: SYM, height: SYM, hero_ids: [], _g: G });
    if (o.mode === "fill"){
      const RAMP = " .:-=+*#%@", sx = Math.max(2, Math.round(o.step / px)), sy = Math.round(sx * 1.7);
      for (let y = oy; y < oy + ih; y += sy) for (let x = ox; x < ox + iw; x += sx){ const v = L[y * cw + x]; const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))]; if (ch !== " ") put(x, y, ch); }
      return out;
    }
    // размытие 3×3 и градиент Собеля
    const B = new Float32Array(L.length);
    for (let y = 1; y < chh - 1; y++) for (let x = 1; x < cw - 1; x++){ let sum = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) sum += L[(y + j) * cw + x + i]; B[y * cw + x] = sum / 9; }
    const M = new Float32Array(L.length); let mx = 0;
    for (let y = 1; y < chh - 1; y++) for (let x = 1; x < cw - 1; x++){ const p = (yy, xx) => B[yy * cw + xx];
      const gx = p(y - 1, x + 1) + 2 * p(y, x + 1) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y, x - 1) - p(y + 1, x - 1);
      const gy = p(y + 1, x - 1) + 2 * p(y + 1, x) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y - 1, x) - p(y - 1, x + 1);
      const m = Math.hypot(gx, gy); M[y * cw + x] = m; if (m > mx) mx = m; }
    const cand = []; const t = (o.thr || .2) * mx;
    for (let i = 0; i < M.length; i++) if (M[i] > t) cand.push(i);
    cand.sort((a, b) => M[b] - M[a]);
    // точки по сильным линиям, не ближе step друг к другу
    const st = o.step / px, cell = st, gw = Math.ceil(cw / cell) + 1, occ = new Map();
    for (const i of cand){ const x = i % cw, y = (i / cw) | 0, cx = (x / cell) | 0, cy = (y / cell) | 0; let ok = true;
      for (let j = -1; j <= 1 && ok; j++) for (let k = -1; k <= 1 && ok; k++){ const q = occ.get((cy + j) * gw + cx + k); if (q && q.some(([qx, qy]) => (qx - x) ** 2 + (qy - y) ** 2 < st * st)) ok = false; }
      if (!ok) continue; const key = cy * gw + cx; (occ.get(key) || occ.set(key, []).get(key)).push([x, y]);
      put(x, y, M[i] > mx * .55 && o.ch === "." ? "·" : o.ch || "."); if (out.length >= (o.max || 2600)) break; }
    return out;
  }
  // сцены для всех героев каталога: рисунок то справа, то слева, кадр по очереди — по пояс, во весь рост, лицо
  const ALLSC = () => (typeof HEROES !== "undefined" && HEROES.length ? HEROES.map(h => [h.slug, h.ru || h.en]) : SCENES);
  const CROPS = [[.58, "по пояс"], [1, "в полный рост"], [.34, "лицо"]];
  function sceneOf(i){ const L = ALLSC(), fav = SCENES.map(x => x[0]), order = [...SCENES, ...L.filter(x => !fav.includes(x[0]))]; const [slug, name] = order[i], c = CROPS[i % 3], side = (i >> 1) % 2 ? "l" : "r"; return { slug, name, crop: c[0], cn: c[1], side }; }
  async function sceneCfg(slug, name, crop, side){
    await heroes(); const img = await loadImg(`/hero/${slug}.webp`), left = side === "l";
    return { config_name: "Сцена: " + name, categories: posLayout(true, side).concat(artCats(img, { x: left ? 12 : 650, y: 8, w: 530, h: 580, mode: "line", step: 5, thr: .12, ch: ".", crop: crop || .58 })) };
  }

  /* ---------- разметка ---------- */
  function shell(){
    pane.innerHTML = `<div class="rkchips gr-subs"><button type="button" class="rkc" data-gv="edit">🛠 Редактор</button><button type="button" class="rkc" data-gv="shop">📚 Мастерская</button><button type="button" class="rkc" data-gv="help">❓ Как установить</button></div>
      <div id="grEdit"></div><div id="grShop" hidden></div><div id="grHelp" hidden></div>`;
    pane.querySelectorAll("[data-gv]").forEach(b => b.onclick = () => go(b.dataset.gv));
  }
  function go(v){ view = v; pane.querySelectorAll("[data-gv]").forEach(b => b.setAttribute("aria-pressed", b.dataset.gv === v));
    ["edit", "shop", "help"].forEach(k => document.getElementById("gr" + k[0].toUpperCase() + k.slice(1)).hidden = k !== v);
    if (v === "edit") editor(); else if (v === "shop") shop(); else help(); }

  /* ---------- редактор ---------- */
  function editor(){
    const el = document.getElementById("grEdit");
    if (!el.dataset.ready){ el.dataset.ready = "1";
      el.innerHTML = `<div class="gr-bar">
          <select id="grCfg" aria-label="Сетка"></select><input id="grCfgN" maxlength="40" aria-label="Название сетки" placeholder="Название сетки">
          <button type="button" class="gr-b" id="grNew" title="Новая пустая сетка">＋ Сетка</button><button type="button" class="gr-b" id="grDelC" title="Удалить эту сетку">🗑</button>
          <span class="gr-sp"></span>
          <button type="button" class="gr-b" id="grImp">⤓ Импорт</button><button type="button" class="gr-b" id="grLink">🔗 Ссылка</button><button type="button" class="gr-b" id="grPub">📤 В мастерскую</button><button type="button" class="gr-b gr-main" id="grDl">⬇ Скачать файл</button>
        </div>
        <div class="gr-tpl"><span>Шаблоны:</span>${PRESETS.map(p => `<button type="button" class="rkc" data-tp="${p.k}" title="${esc(p.d)}">${esc(p.n)}</button>`).join("")}<button type="button" class="rkc" data-tp="clear">Очистить</button></div>
        <div class="gr-wrap">
          <div class="gr-left">
            <div class="gr-tools"><button type="button" class="gr-b gr-art" id="grArt">🎨 Арт / сцена</button><button type="button" class="gr-b" id="grAdd">＋ Категория</button><button type="button" class="gr-b" id="grTxt">T Текст</button><span class="gr-sp"></span><span class="gr-stat" id="grCnt"></span></div>
            <div class="gr-stage" id="grStage" tabindex="0" aria-label="Сетка героев"><div class="gr-cv" id="grCv"></div></div>
            <div class="gr-hint">Перетаскивай категории, героев и рисунки. Клик по герою в списке — добавить в выбранную категорию, двойной клик по герою в сетке — убрать. Клик по точке рисунка выделяет весь рисунок. Стрелки двигают, Delete удаляет.</div>
            <div class="gr-insp" id="grInsp"></div>
          </div>
          <div class="gr-pal">
            <label class="d2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="grQ" placeholder="Найти героя" autocomplete="off"></label>
            <div class="gr-af">${[["", "Все"], ...ATTR.map(a => [a[0], a[1]])].map(a => `<button type="button" class="rkc" data-af="${a[0]}" aria-pressed="${a[0] === ""}">${a[1]}</button>`).join("")}</div>
            <div class="gr-ph" id="grPh"><div class="feed-sk"></div></div>
          </div>
        </div>`;
      stage = el.querySelector("#grStage");
      el.querySelector("#grCfg").onchange = e => { cur = +e.target.value; sel = -1; selG = null; save(); draw(); };
      el.querySelector("#grCfgN").oninput = e => { C().config_name = e.target.value || "Сетка"; save(); cfgList(); };
      el.querySelector("#grNew").onclick = () => { FILE.configs.push(blank("Сетка " + (FILE.configs.length + 1))); cur = FILE.configs.length - 1; sel = -1; selG = null; save(); draw(); };
      el.querySelector("#grDelC").onclick = () => { if (!confirmIn(el.querySelector("#grDelC"), "Точно удалить?")) return; FILE.configs.splice(cur, 1); if (!FILE.configs.length) FILE.configs.push(blank()); cur = Math.max(0, cur - 1); sel = -1; selG = null; save(); draw(); };
      el.querySelector("#grAdd").onclick = () => addCat();
      el.querySelector("#grTxt").onclick = () => { C().categories.push({ category_name: "Текст", x_position: 640, y_position: 20, width: SYM, height: SYM, hero_ids: [] }); sel = C().categories.length - 1; selG = null; save(); draw(); const n = document.getElementById("grN"); if (n){ n.focus(); n.select(); } };
      el.querySelector("#grDl").onclick = download;
      el.querySelector("#grImp").onclick = importer;
      el.querySelector("#grArt").onclick = () => artist();
      el.querySelector("#grLink").onclick = shareLink;
      el.querySelector("#grPub").onclick = publish;
      el.querySelectorAll("[data-tp]").forEach(b => b.onclick = async () => { await heroes(); if (b.dataset.tp === "clear"){ if (!confirmIn(b, "Точно?")) return; C().categories = []; }
        else { const p = PRESETS.find(x => x.k === b.dataset.tp); C().categories = p.f(); if (/^(Моя сетка|Сетка)/.test(C().config_name)) C().config_name = p.n; } sel = -1; selG = null; save(); draw(); });
      el.querySelector("#grQ").oninput = e => { pf.q = e.target.value.trim().toLowerCase(); palette(); };
      el.querySelectorAll("[data-af]").forEach(b => b.onclick = () => { pf.a = b.dataset.af; el.querySelectorAll("[data-af]").forEach(x => x.setAttribute("aria-pressed", x === b)); palette(); });
      stage.addEventListener("pointerdown", onDown);
      stage.addEventListener("dblclick", e => { const t = e.target.closest(".gr-t"); if (t){ const k = +t.closest(".gr-cat").dataset.i; C().categories[k].hero_ids.splice(+t.dataset.n, 1); save(); draw(); } });
      stage.addEventListener("keydown", onKey);
      new ResizeObserver(() => draw(true)).observe(stage);
      heroes().then(() => { palette(); draw(); }).catch(() => { document.getElementById("grPh").innerHTML = `<div class="gempty">Не удалось загрузить героев. Попробуй позже.</div>`; });
    }
    draw();
  }
  function onKey(e){
    if (e.target.tagName === "INPUT") return; const st = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    const list = selG ? C().categories.filter(k => k._g === selG) : sel >= 0 ? [C().categories[sel]] : []; if (!list.length) return;
    if (e.key === "Delete" || e.key === "Backspace"){ delSel(); e.preventDefault(); }
    if (mv){ list.forEach(k => { k.x_position += mv[0]; k.y_position += mv[1]; }); save(); draw(true); e.preventDefault(); }
  }
  function delSel(){ if (selG){ C().categories = C().categories.filter(k => k._g !== selG); selG = null; } else if (sel >= 0) C().categories.splice(sel, 1); sel = -1; save(); draw(); }
  function confirmIn(b, t){ if (b.dataset.sure === "1"){ b.dataset.sure = ""; b.textContent = b.dataset.txt; return true; } b.dataset.txt = b.textContent; b.dataset.sure = "1"; b.textContent = t; setTimeout(() => { if (b.dataset.sure === "1"){ b.dataset.sure = ""; b.textContent = b.dataset.txt; } }, 2500); return false; }
  function cfgList(){ const sc = document.getElementById("grCfg"); if (!sc) return; sc.innerHTML = FILE.configs.map((c, i) => `<option value="${i}"${i === cur ? " selected" : ""}>${esc(c.config_name)}</option>`).join(""); }
  function addCat(){ const cs = C().categories; cs.push({ category_name: "Новая категория", x_position: 20, y_position: 30, width: 6 * (TW + PG), height: TH + PG, hero_ids: [] }); sel = cs.length - 1; selG = null; save(); draw(); stage.focus({ preventScroll: true }); }

  function catHTML(k, i){
    const on = i === sel || (selG && k._g === selG), sym = isSym(k);
    let inner = "";
    if (k.hero_ids.length){ const f = fit(k); inner = `<div class="gr-ts" style="gap:${PG * s}px;grid-template-columns:repeat(${f.cols},${f.tw * s}px)">${k.hero_ids.map((id, n) => { const h = HB[id]; return `<i class="gr-t" data-n="${n}" data-id="${id}" title="${esc(h ? h.n : id)}" style="width:${f.tw * s}px;height:${f.th * s}px">${h ? `<img alt="" src="${esc(h.img)}" loading="lazy" draggable="false">` : ""}</i>`; }).join("")}</div>`; }
    return `<div class="gr-cat${on ? " on" : ""}${sym ? " sym" : ""}${k._g ? " grp" : ""}${!k.hero_ids.length && !sym ? " zone" : ""}" data-i="${i}" style="left:${k.x_position * s}px;top:${k.y_position * s}px;width:${k.width * s}px;height:${k.height * s}px">${k.category_name ? `<div class="gr-lb" style="font-size:${LF * s}px">${esc(k.category_name)}</div>` : ""}${inner}${i === sel && !sym ? `<b class="gr-rs" title="Размер"></b>` : ""}</div>`;
  }
  function draw(soft){
    if (!stage || !FILE) return; const cv = document.getElementById("grCv"), cs = C().categories;
    s = stage.clientWidth / GW; cv.style.height = GH * s + "px"; stage.style.setProperty("--s", s);
    if (!soft){ cfgList(); const n = document.getElementById("grCfgN"); if (n && document.activeElement !== n) n.value = C().config_name; }
    cv.innerHTML = cs.map(catHTML).join("") + (selG ? gbox() : "");
    const cn = document.getElementById("grCnt"); if (cn){ const sy = cs.filter(isSym).length; cn.innerHTML = `Категорий: <b>${cs.length}</b> · символов: <b>${sy}</b>${cs.length > 2600 ? ' · <span class="gr-warn">много — Дота может подтормаживать</span>' : ""}`; }
    if (!soft){ insp(); palMarks(); }
  }
  function gbounds(g){ const ks = C().categories.filter(k => k._g === g); if (!ks.length) return null; const x0 = Math.min(...ks.map(k => k.x_position)), y0 = Math.min(...ks.map(k => k.y_position)), x1 = Math.max(...ks.map(k => k.x_position + 8)), y1 = Math.max(...ks.map(k => k.y_position + 16)); return { x0, y0, x1, y1, n: ks.length }; }
  function gbox(){ const b = gbounds(selG); return b ? `<div class="gr-gbox" style="left:${b.x0 * s}px;top:${b.y0 * s}px;width:${(b.x1 - b.x0) * s}px;height:${(b.y1 - b.y0) * s}px"></div>` : ""; }
  function insp(){
    const el = document.getElementById("grInsp"); if (!el) return; const cs = C().categories;
    if (selG){ const b = gbounds(selG); if (!b){ selG = null; return insp(); }
      el.innerHTML = `<div class="gr-row"><b>Рисунок</b><span class="gr-stat">${b.n} символов</span><span class="gr-sp"></span><button type="button" class="gr-b" data-gs=".9">− Меньше</button><button type="button" class="gr-b" data-gs="1.1">＋ Больше</button><button type="button" class="gr-b" id="grGM">⇋ Отразить</button><button type="button" class="gr-b" id="grGD">⧉ Копия</button><button type="button" class="gr-b gr-red" id="grGX">Удалить рисунок</button></div>`;
      el.querySelectorAll("[data-gs]").forEach(x => x.onclick = () => { const f = +x.dataset.gs; cs.filter(k => k._g === selG).forEach(k => { k.x_position = r1(b.x0 + (k.x_position - b.x0) * f); k.y_position = r1(b.y0 + (k.y_position - b.y0) * f); }); save(); draw(); });
      el.querySelector("#grGM").onclick = () => { cs.filter(k => k._g === selG).forEach(k => { k.x_position = r1(b.x1 - (k.x_position - b.x0) - 8); }); save(); draw(); };
      el.querySelector("#grGD").onclick = () => { const g = newG(); cs.filter(k => k._g === selG).forEach(k => cs.push({ ...k, hero_ids: [], x_position: k.x_position + 30, y_position: k.y_position + 20, _g: g })); selG = g; save(); draw(); };
      el.querySelector("#grGX").onclick = delSel; return; }
    const k = cs[sel];
    if (!k){ const uniq = new Set(cs.flatMap(x => x.hero_ids)).size; el.innerHTML = `<div class="gr-stat">Героев расставлено: <b>${uniq}</b>${H.length ? ` из ${H.length}` : ""}. Выбери категорию, чтобы настроить её.</div>`; return; }
    const sym = isSym(k);
    el.innerHTML = `<div class="gr-row"><input id="grN" maxlength="120" value="${esc(k.category_name)}" placeholder="${sym ? "Текст" : "Название категории (можно пустое)"}" aria-label="Название">
      ${(sym ? ["x_position|X", "y_position|Y"] : ["x_position|X", "y_position|Y", "width|Ш", "height|В"]).map(f => { const [p, l] = f.split("|"); return `<label class="gr-num">${l}<input type="number" data-f="${p}" value="${Math.round(k[p])}"></label>`; }).join("")}</div>
      <div class="gr-row">${sym ? "" : `<button type="button" class="gr-b" id="grFrm" title="Обвести категорию рамкой из символов">▢ Рамка</button><select id="grFrC" aria-label="Символ рамки"><option>·</option><option>.</option><option>*</option><option>#</option><option>+</option><option>:</option></select><button type="button" class="gr-b" id="grClr">Убрать героев</button>`}<button type="button" class="gr-b" id="grDup">⧉ Копия</button><button type="button" class="gr-b gr-red" id="grDel">Удалить</button>
      <span class="gr-stat">${sym ? "Текст и символы — это пустые категории: Дота пишет их название поверх сетки." : `Героев: <b>${k.hero_ids.length}</b>`}</span></div>`;
    el.querySelector("#grN").oninput = e => { k.category_name = e.target.value; save(); draw(true); };
    el.querySelectorAll("[data-f]").forEach(i => i.oninput = () => { const v = +i.value; if (!isNaN(v)){ k[i.dataset.f] = Math.max(/^(w|h)/.test(i.dataset.f) ? 10 : -50, v); save(); draw(true); } });
    const fr = el.querySelector("#grFrm"); if (fr) fr.onclick = () => { const g = newG(); cs.push(...frame(k.x_position - 12, k.y_position - 12, k.width + 24, k.height + 18, el.querySelector("#grFrC").value, 9, g)); selG = g; sel = -1; save(); draw(); };
    const cl = el.querySelector("#grClr"); if (cl) cl.onclick = () => { k.hero_ids = []; save(); draw(); };
    el.querySelector("#grDup").onclick = () => { cs.push({ ...k, _g: undefined, hero_ids: [...k.hero_ids], x_position: k.x_position + 20, y_position: k.y_position + 20 }); sel = cs.length - 1; save(); draw(); };
    el.querySelector("#grDel").onclick = delSel;
  }
  function palette(){
    const el = document.getElementById("grPh"); if (!el || !H.length) return;
    const list = H.filter(h => (!pf.a || h.a === pf.a) && (!pf.q || h.n.toLowerCase().includes(pf.q)));
    el.innerHTML = list.length ? list.map(h => `<i class="gr-p" data-id="${h.id}" title="${esc(h.n)}"><img alt="" src="${esc(h.img)}" loading="lazy" draggable="false"><span>${esc(h.n)}</span></i>`).join("") : `<div class="gempty">Никого не нашли</div>`;
    el.onpointerdown = onDown; palMarks();
  }
  function palMarks(){ const used = new Set(C().categories.flatMap(k => k.hero_ids)); document.querySelectorAll("#grPh .gr-p").forEach(p => p.classList.toggle("used", used.has(+p.dataset.id))); }

  /* ---------- перетаскивание ---------- */
  let D = null;
  function onDown(e){
    if (e.button > 0) return;
    const rs = e.target.closest(".gr-rs"), t = e.target.closest(".gr-t"), p = e.target.closest(".gr-p"), cat = e.target.closest(".gr-cat"), gb = e.target.closest(".gr-gbox");
    if (p){ D = { kind: "hero", id: +p.dataset.id, from: null, x0: e.clientX, y0: e.clientY, moved: false }; }
    else if (t){ D = { kind: "hero", id: +t.dataset.id, from: [+cat.dataset.i, +t.dataset.n], x0: e.clientX, y0: e.clientY, moved: false }; }
    else if (rs){ const k = C().categories[sel]; D = { kind: "rs", k, w0: k.width, h0: k.height, x0: e.clientX, y0: e.clientY }; }
    else if (gb || (cat && C().categories[+cat.dataset.i]._g)){ const g = gb ? selG : C().categories[+cat.dataset.i]._g; if (selG !== g){ selG = g; sel = -1; draw(); }
      const ks = C().categories.map((k, i) => [k, i]).filter(([k]) => k._g === g); D = { kind: "grp", ks: ks.map(([k, i]) => [k, i, k.x_position, k.y_position]), x0: e.clientX, y0: e.clientY }; }
    else if (cat){ const i = +cat.dataset.i; if (sel !== i || selG){ sel = i; selG = null; draw(); } const k = C().categories[i]; D = { kind: "mv", k, kx: k.x_position, ky: k.y_position, x0: e.clientX, y0: e.clientY }; }
    else { if (sel !== -1 || selG){ sel = -1; selG = null; draw(); } return; }
    e.preventDefault(); stage.focus({ preventScroll: true });
    addEventListener("pointermove", onMove); addEventListener("pointerup", onUp, { once: true });
  }
  function onMove(e){
    if (!D) return; const dx = (e.clientX - D.x0) / s, dy = (e.clientY - D.y0) / s;
    if (D.kind === "mv"){ D.k.x_position = Math.round(D.kx + dx); D.k.y_position = Math.round(D.ky + dy); const el = stage.querySelector(`.gr-cat[data-i="${sel}"]`); if (el){ el.style.left = D.k.x_position * s + "px"; el.style.top = D.k.y_position * s + "px"; } }
    else if (D.kind === "grp"){ const cv = document.getElementById("grCv"); D.ks.forEach(([k, i, x, y]) => { k.x_position = r1(x + dx); k.y_position = r1(y + dy); const el = cv.children[i]; if (el){ el.style.left = k.x_position * s + "px"; el.style.top = k.y_position * s + "px"; } }); const gb = cv.querySelector(".gr-gbox"); if (gb) gb.style.transform = `translate(${dx * s}px, ${dy * s}px)`; }
    else if (D.kind === "rs"){ D.k.width = Math.max(20, Math.round(D.w0 + dx)); D.k.height = Math.max(20, Math.round(D.h0 + dy)); draw(true); }
    else if (D.kind === "hero"){
      if (!D.moved && Math.hypot(e.clientX - D.x0, e.clientY - D.y0) < 6) return;
      if (!D.moved){ D.moved = true; const h = HB[D.id]; D.g = document.createElement("div"); D.g.className = "gr-ghost"; D.g.innerHTML = h ? `<img alt="" src="${esc(h.img)}">` : ""; document.body.appendChild(D.g); }
      D.g.style.transform = `translate(${e.clientX - 25}px, ${e.clientY - 33}px)`;
      stage.querySelectorAll(".gr-cat.drop").forEach(x => x.classList.remove("drop")); const c = catAt(e); if (c) c.classList.add("drop");
    }
  }
  function catAt(e){ return document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList && x.classList.contains("gr-cat") && !x.classList.contains("sym")) || null; }
  function onUp(e){
    removeEventListener("pointermove", onMove); const d = D; D = null; if (!d) return;
    if (d.kind === "hero"){
      if (d.g) d.g.remove(); stage.querySelectorAll(".gr-cat.drop").forEach(x => x.classList.remove("drop"));
      const cs = C().categories;
      if (!d.moved){ if (!d.from){ if (sel < 0 || isSym(cs[sel])){ const z = cs.map((k, i) => i).filter(i => !isSym(cs[i])); if (!z.length) addCat(); sel = z.length ? z[0] : cs.length - 1; selG = null; } const k = cs[sel], at = k.hero_ids.indexOf(d.id); if (at >= 0) k.hero_ids.splice(at, 1); else k.hero_ids.push(d.id); save(); draw(); } return; }
      const c = catAt(e), ti = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList && x.classList.contains("gr-t")) || null;
      if (d.from) cs[d.from[0]].hero_ids.splice(d.from[1], 1);
      if (c){ const k = cs[+c.dataset.i]; let pos = k.hero_ids.length;
        if (ti && ti.closest(".gr-cat") === c){ pos = +ti.dataset.n; if (d.from && d.from[0] === +c.dataset.i && d.from[1] < pos) pos--; const r = ti.getBoundingClientRect(); if (e.clientX > r.left + r.width / 2) pos++; }
        const ex = k.hero_ids.indexOf(d.id); if (ex >= 0){ k.hero_ids.splice(ex, 1); if (ex < pos) pos--; }
        k.hero_ids.splice(Math.max(0, pos), 0, d.id); sel = +c.dataset.i; selG = null; }
      save(); draw();
    } else { save(); draw(); }
  }

  /* ---------- окно «Арт / сцена» ---------- */
  function artist(){
    const H1 = (typeof HEROES !== "undefined" ? HEROES : []).map(h => [h.slug, h.ru || h.en]).sort((a, b) => a[1].localeCompare(b[1], "ru"));
    const [b, close] = modal(`<h3>Арт из точек</h3><p class="gr-mut">Рисунок собирается из точек вдоль контуров — как в арт-сетках. Возьми героя или загрузи любую картинку: аниме, персонажа, мем. Лучше всего выходят картинки на однотонном фоне.</p>
      <div class="gr-src"><label class="btn btn-ghost gr-file">📂 Своя картинка<input type="file" accept="image/*" hidden></label><select id="grHs" aria-label="Герой"><option value="">…или герой Доты</option>${H1.map(h => `<option value="${h[0]}">${esc(h[1])}</option>`).join("")}</select></div>
      <canvas class="gr-pv" id="grPv" width="1193" height="593"></canvas>
      <div class="gr-arow">
        <label>Стиль <select id="grMd"><option value="line">Контур точками</option><option value="fill">Заливка символами</option></select></label>
        <label>Символ <select id="grCh"><option>.</option><option>·</option><option>*</option><option>+</option><option>o</option><option>#</option></select></label>
        <label>Кадр <select id="grCr"><option value="1">Весь рост</option><option value=".58">По пояс</option><option value=".34">Лицо</option></select></label>
        <label>Где <select id="grWh"><option value="r">Справа</option><option value="l">Слева</option><option value="c">По центру</option><option value="a">Весь экран</option></select></label>
        <label>Размер <input type="range" id="grSz" min="30" max="100" value="100"></label>
        <label>Плотность <input type="range" id="grSt" min="30" max="110" value="50"></label>
        <label>Детали <input type="range" id="grTh" min="4" max="50" value="12"></label>
        <label class="gr-chk"><input type="checkbox" id="grInv"> Инверсия</label>
      </div>
      <div class="gr-acts"><span class="gr-mut" id="grAn">Выбери картинку или героя</span><label class="gr-chk"><input type="checkbox" id="grPA"> + позиции 1–5 слева</label><button type="button" class="btn btn-primary" id="grAG" disabled>Добавить в сетку</button></div>`);
    let img = null, cats = [];
    const pv = b.querySelector("#grPv"), g = pv.getContext("2d");
    const box = () => { const z = +b.querySelector("#grSz").value / 100, wh = b.querySelector("#grWh").value, w = (wh === "a" ? GW : wh === "c" ? 700 : 540) * z, h = (GH - 16) * z;
      const x = wh === "r" ? GW - w - 10 : wh === "l" ? 10 : (GW - w) / 2; return { x, y: GH - h - 6, w, h }; };
    const render = () => {
      g.fillStyle = "#0e1a1c"; g.fillRect(0, 0, GW, GH); const gr = g.createRadialGradient(GW / 2, GH * .4, 50, GW / 2, GH / 2, GW * .7); gr.addColorStop(0, "rgba(40,70,72,.35)"); gr.addColorStop(1, "rgba(0,0,0,.5)"); g.fillStyle = gr; g.fillRect(0, 0, GW, GH);
      const bg = b.querySelector("#grPA").checked ? posLayout(false) : C().categories;
      paint(g, bg, 1, .45);
      if (!img){ cats = []; b.querySelector("#grAG").disabled = true; return; }
      const o = box(); cats = artCats(img, { ...o, mode: b.querySelector("#grMd").value, step: +b.querySelector("#grSt").value / 10, thr: +b.querySelector("#grTh").value / 100, ch: b.querySelector("#grCh").value, inv: b.querySelector("#grInv").checked, crop: +b.querySelector("#grCr").value });
      paint(g, cats, 1, 1); const tot = cats.length + (b.querySelector("#grPA").checked ? 0 : C().categories.length);
      b.querySelector("#grAn").innerHTML = `Точек: <b>${cats.length}</b> · всего категорий станет: ${tot}${tot > 2600 ? ' — <span class="gr-warn">много, уменьши плотность</span>' : ""}`; b.querySelector("#grAG").disabled = !cats.length; };
    let rt = 0; const later = () => { clearTimeout(rt); rt = setTimeout(render, 60); };
    b.querySelector("input[type=file]").onchange = e => { const f = e.target.files[0]; if (!f) return; loadImg(URL.createObjectURL(f)).then(i => { img = trim(i); b.querySelector("#grHs").value = ""; render(); }); };
    b.querySelector("#grHs").onchange = e => { if (!e.target.value) return; loadImg(`/hero/${e.target.value}.webp`).then(i => { img = trim(i); render(); }); };
    ["#grMd", "#grCh", "#grCr", "#grWh", "#grSz", "#grSt", "#grTh", "#grInv", "#grPA"].forEach(q => b.querySelector(q).oninput = later);
    b.querySelector("#grAG").onclick = async () => { await heroes(); if (b.querySelector("#grPA").checked) C().categories = posLayout(true); C().categories.push(...cats); sel = -1; selG = cats[0]._g; save(); draw(); close(); PROF.toast(`Рисунок добавлен: <b>${cats.length}</b> точек. Его можно двигать мышкой целиком.`); };
    render();
  }
  // общий рисовальщик для превью и миниатюр
  function paint(g, cs, sc, alpha){
    g.save(); g.globalAlpha = alpha; g.textBaseline = "top";
    cs.forEach(k => { const x = k.x_position * sc, y = k.y_position * sc;
      if (k.hero_ids.length){ const f = fit(k); k.hero_ids.forEach((id, n) => { const h = HB[id], a = ATTR.find(z => h && z[0] === h.a); g.fillStyle = a ? a[2] : "#667"; g.globalAlpha = alpha * .7; g.fillRect(x + (n % f.cols) * (f.tw + PG) * sc, y + Math.floor(n / f.cols) * (f.th + PG) * sc, f.tw * sc, f.th * sc); }); g.globalAlpha = alpha; }
      else if (!isSym(k)){ g.strokeStyle = "rgba(255,255,255,.18)"; g.strokeRect(x, y, k.width * sc, k.height * sc); }
      if (k.category_name){ g.fillStyle = "rgba(235,240,240,.92)"; g.font = `600 ${Math.max(2, LF * sc)}px "Segoe UI", sans-serif`; g.fillText(k.category_name, x, y); } });
    g.restore();
  }

  /* ---------- файл ---------- */
  function fileText(f){ return JSON.stringify(clean(f || FILE), null, "\t"); }
  function saveFile(f){ const b = new Blob([fileText(f)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "hero_grid_config.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  function download(){ saveFile();
    PROF.toast(`Файл скачан. Положи его в папку Steam → userdata → <b>твой ID</b> → 570 → remote → cfg (с заменой) при закрытой Доте. <a href="#" id="grHowT">Подробнее</a>`, "", 7000);
    setTimeout(() => { const l = document.getElementById("grHowT"); if (l) l.onclick = ev => { ev.preventDefault(); go("help"); }; }, 50); }
  function parse(txt){ const v = JSON.parse(txt); if (v && Array.isArray(v.configs)) return v; if (v && Array.isArray(v.categories)) return { version: 3, configs: [v] }; throw new Error("bad"); }
  function modal(html){ const m = document.createElement("div"); m.className = "gr-mod"; m.innerHTML = `<div class="gr-box" role="dialog" aria-modal="true"><button type="button" class="gr-x" aria-label="Закрыть">✕</button>${html}</div>`; document.body.appendChild(m);
    const esc2 = e => { if (e.key === "Escape") close(); }, close = () => { m.remove(); removeEventListener("keydown", esc2); };
    m.querySelector(".gr-x").onclick = close; m.onclick = e => { if (e.target === m) close(); }; addEventListener("keydown", esc2); return [m.querySelector(".gr-box"), close]; }
  function importer(){
    const [b, close] = modal(`<h3>Импорт сетки</h3><p class="gr-mut">Выбери свой <b>hero_grid_config.json</b> из папки Доты или вставь текст файла. Все сетки из файла добавятся в редактор — при скачивании они сохранятся вместе с новой.</p>
      <label class="btn btn-ghost gr-file">📂 Выбрать файл<input type="file" accept=".json,application/json" hidden></label><textarea id="grTx" rows="7" placeholder='{"version":3,"configs":[...]}'></textarea>
      <div class="gr-acts"><label class="gr-chk"><input type="checkbox" id="grRep"> Заменить всё, что есть в редакторе</label><button type="button" class="btn btn-primary" id="grGo">Импортировать</button></div><div class="gr-err" id="grErr"></div>`);
    const go2 = txt => { try { const f = parse(txt); const add = keepG(f).configs; if (b.querySelector("#grRep").checked) { FILE.configs = add; cur = 0; } else { FILE.configs.push(...add); cur = FILE.configs.length - add.length; } sel = -1; selG = null; save(); draw(); close(); PROF.toast(`Добавлено сеток: <b>${add.length}</b>`); } catch(e) { b.querySelector("#grErr").textContent = "Это не похоже на файл сетки Доты (hero_grid_config.json)."; } };
    b.querySelector("input[type=file]").onchange = e => { const f = e.target.files[0]; if (f) f.text().then(go2); };
    b.querySelector("#grGo").onclick = () => go2(b.querySelector("#grTx").value);
  }

  /* ---------- ссылка ---------- */
  const b64 = u8 => { let s2 = ""; for (let i = 0; i < u8.length; i += 8192) s2 += String.fromCharCode(...u8.subarray(i, i + 8192)); return btoa(s2).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64 = s2 => Uint8Array.from(atob(s2.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  async function pack(obj){ const data = new TextEncoder().encode(JSON.stringify(obj)); if (!window.CompressionStream) return "j" + b64(data);
    const cs = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw")); return "z" + b64(new Uint8Array(await new Response(cs).arrayBuffer())); }
  async function unpack(str){ const raw = unb64(str.slice(1)); if (str[0] === "j") return JSON.parse(new TextDecoder().decode(raw));
    const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")); return JSON.parse(await new Response(ds).text()); }
  async function shareLink(){
    const one = clean({ configs: [C()] }).configs[0]; const code = await pack(one), url = `${location.origin}/?grid=${code}#grids`;
    if (url.length > 60000){ PROF.toast("Сетка слишком большая для ссылки — опубликуй её в мастерской или скачай файл."); return; }
    try { await navigator.clipboard.writeText(url); PROF.toast("Ссылка на сетку скопирована 🔗"); } catch(e) { modal(`<h3>Ссылка на сетку</h3><textarea rows="4" readonly>${esc(url)}</textarea>`); }
  }
  async function fromLink(){ const q = new URLSearchParams(location.search).get("grid"); if (!q) return false;
    try { const c = await unpack(q); const f = keepG({ configs: [c] }); FILE.configs.push(f.configs[0]); cur = FILE.configs.length - 1; sel = -1; save(); PROF.toast(`Сетка «${esc(f.configs[0].config_name)}» добавлена в редактор`); } catch(e) {}
    try { const u = new URL(location.href); u.searchParams.delete("grid"); history.replaceState(null, "", u.pathname + u.search + "#grids"); } catch(e) {}
    return true; }

  /* ---------- мастерская ---------- */
  const SBT = () => (PROF.rt && PROF.rt()) || null;
  let shopSort = "new", shopQ = "";
  function thumb(cfg){
    const c = document.createElement("canvas"), W = 420, sc = W / GW; c.width = W; c.height = Math.round(GH * sc);
    const g = c.getContext("2d"); g.fillStyle = "#0e1a1c"; g.fillRect(0, 0, c.width, c.height);
    const cs = cfg.categories || []; paint(g, cs.filter(k => !isSym(k)), sc, 1);
    g.fillStyle = "rgba(235,240,240,.9)"; cs.filter(isSym).forEach(k => { const n = Math.max(1, k.category_name.trim().length); g.fillRect(k.x_position * sc + 1, k.y_position * sc + 9 * sc, Math.max(.8, n > 1 ? n * 5 * sc : .9), .9); });
    return c.toDataURL("image/png");
  }
  async function shop(){
    const el = document.getElementById("grShop"); await heroes().catch(() => {});
    el.innerHTML = `<div class="gr-shead"><div class="rkchips">${[["new", "Новые"], ["top", "Популярные"]].map(x => `<button type="button" class="rkc" data-ss="${x[0]}" aria-pressed="${x[0] === shopSort}">${x[1]}</button>`).join("")}</div>
      <label class="d2-search gr-sq"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="grSQ" placeholder="Название или автор" value="${esc(shopQ)}"></label></div>
      <h3 class="gr-h3">Сетки игроков</h3><div class="gr-cards" id="grUsr"><div class="feed-sk"></div></div>
      <h3 class="gr-h3">Арт-сцены от Aegis</h3><p class="gr-mut">Позиции 1–5 в рамке и герой, нарисованный точками. Свою сцену — с любой картинкой — собери в редакторе: «🎨 Арт / сцена».</p><div class="gr-cards" id="grScn"><div class="feed-sk"></div></div><button type="button" class="btn btn-ghost gr-more" id="grMore" hidden>Ещё сцены</button>
      <h3 class="gr-h3">Обычные сетки</h3><div class="gr-cards" id="grPre"></div>`;
    el.querySelectorAll("[data-ss]").forEach(b => b.onclick = () => { shopSort = b.dataset.ss; shop(); });
    let qt = 0; el.querySelector("#grSQ").oninput = e => { clearTimeout(qt); qt = setTimeout(() => { shopQ = e.target.value.trim(); users(); }, 300); };
    const pre = PRESETS.map(p => ({ name: p.n, nick: "Aegis", d: p.d, data: { config_name: p.n, categories: H.length ? p.f() : [] } }));
    const pb = el.querySelector("#grPre"); pb.innerHTML = pre.map(card).join(""); bindCards(pb, pre);
    users();
    const sc = [], box = el.querySelector("#grScn"), more = el.querySelector("#grMore"), total = ALLSC().length; let next = 0;
    const batch = async () => { more.hidden = true; const end = Math.min(total, next + 12);
      for (; next < end; next++){ const q = sceneOf(next); try { sc.push({ name: "Сцена: " + q.name, nick: "Aegis", d: q.cn, data: await sceneCfg(q.slug, q.name, q.crop, q.side) }); } catch(e) {} if (!box.isConnected) return; }
      box.innerHTML = sc.map(card).join(""); bindCards(box, sc); more.hidden = next >= total; more.textContent = `Ещё сцены (${total - next})`; };
    more.onclick = batch; batch();
  }
  function card(g){ const cs = g.data.categories || [], sy = cs.filter(isSym).length; return `<div class="gr-card"><div class="gr-th"><img alt="" src="${thumb(g.data)}"></div><div class="gr-ci"><b>${esc(g.name)}</b><small>${esc(g.nick || "")}${g.d ? " · " + esc(g.d) : ""}</small>
    <small class="gr-meta">Категорий: ${cs.length}${sy ? ` · символов: ${sy}` : ""}${g.likes != null ? ` · ❤ ${g.likes} · ⬇ ${g.downloads || 0}` : ""}</small>
    <div class="gr-ca"><button type="button" class="gr-b" data-a="open">✏ В редактор</button><button type="button" class="gr-b" data-a="dl">⬇ Файл</button>${g.id ? `<button type="button" class="gr-b" data-a="like">❤</button>` : ""}${g.mine ? `<button type="button" class="gr-b gr-red" data-a="del">Удалить</button>` : ""}</div></div></div>`; }
  function bindCards(box, list){
    box.querySelectorAll(".gr-card").forEach((c, i) => c.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { const g = list[i], a = b.dataset.a, sb = SBT();
      if (a === "open"){ FILE.configs.push(keepG({ configs: [{ ...g.data, config_name: g.name }] }).configs[0]); cur = FILE.configs.length - 1; sel = -1; selG = null; save(); go("edit"); PROF.toast(`«${esc(g.name)}» открыта в редакторе`); if (g.id && sb) sb.rpc("grid_dl", { gid: g.id }).then(() => {}, () => {}); }
      if (a === "dl"){ saveFile({ version: 3, configs: [{ ...g.data, config_name: g.name }] }); if (g.id && sb) sb.rpc("grid_dl", { gid: g.id }).then(() => {}, () => {}); }
      if (a === "like"){ const u = PROF.user(); if (!u){ PROF.open(); return; } const r = await sb.from("grid_likes").insert({ grid_id: g.id }); if (r.error){ await sb.from("grid_likes").delete().eq("grid_id", g.id).eq("user_id", u.id); } users(); }
      if (a === "del"){ if (!confirmIn(b, "Точно?")) return; await sb.from("grids").delete().eq("id", g.id); users(); }
    }));
  }
  async function users(){
    const box = document.getElementById("grUsr"); if (!box) return; const sb = SBT();
    if (!sb){ box.innerHTML = `<div class="gempty">Мастерская работает на основном сайте.</div>`; return; }
    let q = sb.from("grids").select("id,user_id,nick,name,data,likes,downloads,created_at").limit(48).order(shopSort === "top" ? "likes" : "created_at", { ascending: false });
    if (shopQ) q = q.or(`name.ilike.%${shopQ.replace(/[%,()]/g, "")}%,nick.ilike.%${shopQ.replace(/[%,()]/g, "")}%`);
    const { data, error } = await q;
    if (error){ box.innerHTML = `<div class="gempty">Мастерская скоро откроется. А пока делись сеткой по ссылке 🔗</div>`; return; }
    if (!data.length){ box.innerHTML = `<div class="gempty">Пока пусто — опубликуй свою сетку первым: «📤 В мастерскую» в редакторе.</div>`; return; }
    const u = PROF.user(), list = data.map(r => ({ id: r.id, name: r.name, nick: r.nick, data: r.data, likes: r.likes, downloads: r.downloads, mine: u && u.id === r.user_id }));
    box.innerHTML = list.map(card).join(""); bindCards(box, list);
  }
  async function publish(){
    const sb = SBT(), u = PROF.user(); if (!sb){ PROF.toast("Публикация работает на основном сайте."); return; } if (!u){ PROF.open(); return; }
    const c = clean({ configs: [C()] }).configs[0]; if (!c.categories.length){ PROF.toast("Сетка пустая — добавь категории и героев."); return; }
    const [b, close] = modal(`<h3>Опубликовать в мастерской</h3><p class="gr-mut">Сетку увидят все: её можно будет открыть в редакторе и скачать.</p><input id="grPN" maxlength="60" value="${esc(c.config_name)}" placeholder="Название"><div class="gr-acts"><span></span><button type="button" class="btn btn-primary" id="grPG">Опубликовать</button></div><div class="gr-err" id="grPE"></div>`);
    b.querySelector("#grPG").onclick = async () => { const name = b.querySelector("#grPN").value.trim() || c.config_name; b.querySelector("#grPG").disabled = true;
      const { error } = await sb.from("grids").insert({ name, nick: PROF.me() || "Игрок", data: { ...c, config_name: name } });
      if (error){ b.querySelector("#grPE").textContent = /relation|does not exist|schema/i.test(error.message || "") ? "Мастерская ещё не включена на сервере." : "Не получилось опубликовать: " + error.message; b.querySelector("#grPG").disabled = false; return; }
      close(); PROF.toast("Сетка опубликована 🎉"); shopSort = "new"; go("shop"); };
  }

  /* ---------- как установить ---------- */
  function help(){
    document.getElementById("grHelp").innerHTML = `<div class="gr-help"><ol>
      <li><b>Собери сетку</b> в редакторе или возьми готовую в мастерской и нажми <b>«⬇ Скачать файл»</b> — скачается <code>hero_grid_config.json</code>.</li>
      <li><b>Закрой Доту</b> полностью — иначе она перезапишет файл при выходе.</li>
      <li>Открой папку <code>Steam\\userdata\\&lt;твой ID&gt;\\570\\remote\\cfg\\</code>. Обычно Steam лежит в <code>C:\\Program Files (x86)\\Steam</code>. Если папок с цифрами несколько — твой ID это Friend Code из профиля Steam.</li>
      <li>Положи скачанный файл туда <b>с заменой</b>. Хочешь сохранить старые сетки — сначала импортируй свой старый файл в редактор (кнопка «⤓ Импорт»), тогда все сетки окажутся в одном файле.</li>
      <li>Запусти Доту → выбор героя → иконка сетки справа сверху → выбери свою сетку в списке.</li></ol>
      <p class="gr-mut">Не появилась? Выключи на время замены Steam Cloud для Dota 2 (Свойства → Общие) и проверь, что файл называется ровно <code>hero_grid_config.json</code>. Арт-сетки с тысячами точек Дота открывает пару секунд — это нормально.</p></div>`;
  }

  /* ---------- вход ---------- */
  async function open(){
    pane = document.getElementById("grPane"); if (!pane) return;
    if (!built){ built = true; load(); await fromLink(); shell(); }
    go(view);
  }
  setTimeout(() => { if (new URLSearchParams(location.search).get("grid") && typeof setTab === "function") setTab("grids");
    else if (typeof curTab !== "undefined" && curTab === "grids") open(); }, 0);
  return { open };
})();
