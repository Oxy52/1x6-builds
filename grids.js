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
  function load(){ load0(); snap0 = snapNow(); HIST = []; FUT = []; }
  function load0(){ try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && Array.isArray(v.configs) && v.configs.length) { FILE = v; cur = Math.min(+v._cur || 0, v.configs.length - 1); return; } } catch(e) {} FILE = { version: 3, configs: [blank()] }; cur = 0; }
  // отмена/повтор: снимки файла после каждой паузы в правках (быстрые правки сливаются в один шаг)
  let sT = 0, HIST = [], FUT = [], snap0 = null;
  const snapNow = () => JSON.stringify({ configs: FILE.configs, cur });
  function commit(){ clearTimeout(sT); sT = 0; if (D){ save(); return; } const sn = snapNow(); if (snap0 != null && sn !== snap0){ HIST.push(snap0); if (HIST.length > 60) HIST.shift(); FUT = []; } snap0 = sn;
    try { localStorage.setItem(KEY, JSON.stringify({ ...FILE, _cur: cur })); } catch(e) { PROF.toast("Сетка слишком большая для памяти браузера — скачай файл, чтобы не потерять."); } histBtns(); }
  function save(){ clearTimeout(sT); sT = setTimeout(commit, 350); }
  function histGo(back){ if (sT) commit(); const from = back ? HIST : FUT, to = back ? FUT : HIST; if (!from.length) return;
    to.push(snap0); snap0 = from.pop(); const v = JSON.parse(snap0); FILE.configs = v.configs; cur = Math.min(v.cur || 0, FILE.configs.length - 1); sel = -1; selG = null;
    try { localStorage.setItem(KEY, JSON.stringify({ ...FILE, _cur: cur })); } catch(e) {} draw(); histBtns(); }
  function histBtns(){ const u = document.getElementById("grUndo"), r = document.getElementById("grRedo"); if (u) u.disabled = !HIST.length; if (r) r.disabled = !FUT.length; }
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
    let op = true; for (let i = 3; i < d.length; i += 16) if (d[i] < 250){ op = false; break; }
    const ink = i => op ? (d[i] + d[i + 1] + d[i + 2]) / 3 < 225 : d[i + 3] > 24;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, any = false; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink((y * w + x) * 4)){ any = true; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (!any || (x1 - x0 > w * .97 && y1 - y0 > h * .97)) return { img, sx: 0, sy: 0, sw: img.width, sh: img.height };
    const k = img.width / w; return { img, sx: x0 * k, sy: y0 * k, sw: (x1 - x0 + 1) * k, sh: (y1 - y0 + 1) * k };
  }
  // плотный ASCII как в арт-сетках: строки символов, контуры — / \ | -, тени — . : = # % @
  function asciiCats(img0, o){
    const T0 = o.stretch ? { img: img0.img || img0, sx: 0, sy: 0, sw: (img0.img || img0).width, sh: (img0.img || img0).height } : img0.sw ? img0 : trim(img0), cr = o.crop || 1;
    const T = cr < 1 ? { ...T0, sh: T0.sh * cr, sx: T0.sx + (cr < .5 ? T0.sw * .18 : 0), sw: cr < .5 ? T0.sw * .64 : T0.sw } : T0;
    const CW = o.cw || 7, RH = o.rh || 12.5, W = Math.round(o.w), Hh = Math.round(o.h);
    const sc = o.stretch ? 1 : Math.min(W / T.sw, Hh / T.sh), iw = o.stretch ? W : Math.round(T.sw * sc), ih = o.stretch ? Hh : Math.round(T.sh * sc);
    const ox = Math.round((W - iw) / 2), oy = o.stretch ? 0 : Hh - ih;
    const c = document.createElement("canvas"); c.width = W; c.height = Hh; const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, Hh); g.drawImage(T.img, T.sx, T.sy, T.sw, T.sh, ox, oy, iw, ih);
    const d = g.getImageData(0, 0, W, Hh).data, L = new Float32Array(W * Hh); let mean = 0;
    for (let i = 0; i < L.length; i++){ L[i] = (.299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2]) / 255; mean += L[i]; }
    mean /= L.length; const inv = o.inv == null ? false : o.inv, RAW = L.slice();
    if (o.norm){ const sm = Array.from(L.filter((_, i) => !(i % 7))).sort((a, b) => a - b), lo = sm[Math.floor(sm.length * .03)], hi = sm[Math.floor(sm.length * .97)], k = 1 / Math.max(.05, hi - lo); for (let i = 0; i < L.length; i++) L[i] = Math.min(1, Math.max(0, (L[i] - lo) * k)); }
    if (inv) for (let i = 0; i < L.length; i++) L[i] = 1 - L[i];
    for (let k = 0; k < (o.blur || 0); k++){ const B = new Float32Array(L.length); for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++){ const i = y * W + x; B[i] = (L[i] * 4 + L[i - 1] + L[i + 1] + L[i - W] + L[i + W] + L[i - W - 1] + L[i - W + 1] + L[i + W - 1] + L[i + W + 1]) / 12; } L.set(B); }
    const gain = o.gain || 1, out = [], G = o.g || newG(), cols = Math.floor(W / CW), rows = Math.floor(Hh / RH), MAXR = o.run || 8;
    const RAMP = o.ramp || " .:-=+*#%@";
    for (let r = 0; r < rows; r++){
      let line = "";
      for (let q = 0; q < cols; q++){
        const x0 = Math.floor(q * CW), x1 = Math.floor((q + 1) * CW), y0 = Math.floor(r * RH), y1 = Math.floor((r + 1) * RH);
        let v = 0, n = 0, jxx = 0, jyy = 0, jxy = 0, rs = 0, rq = 0;
        for (let y = Math.max(1, y0); y < Math.min(Hh - 1, y1); y++) for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++){
          const i = y * W + x; v += L[i]; n++; rs += RAW[i]; rq += RAW[i] * RAW[i]; const gx = L[i + 1] - L[i - 1], gy = L[i + W] - L[i - W]; jxx += gx * gx; jyy += gy * gy; jxy += gx * gy; }
        if (!n){ line += " "; continue; }
        // ровный белый фон оставляем пустым
        { const m = rs / n; if (m > .9 && Math.sqrt(Math.max(0, rq / n - m * m)) < .06){ line += " "; continue; } }
        v = Math.min(1, v / n * gain); const e = Math.sqrt(jxx + jyy) / n * 6;
        let ch = " ";
        if (e > (o.edge || .18) && v > .06){
          // направление линии перпендикулярно градиенту; y вниз
          const th = .5 * Math.atan2(2 * jxy, jxx - jyy) + Math.PI / 2; let a = ((th * 180 / Math.PI) % 180 + 180) % 180;
          ch = a < 22.5 || a >= 157.5 ? "-" : a < 67.5 ? "\\" : a < 112.5 ? "|" : "/";
          if (v > .55) ch = ch === "|" ? "#" : ch === "-" ? "=" : ch;
        } else if (v > (o.thr || .12)) ch = RAMP[Math.min(RAMP.length - 1, 1 + Math.floor((v - (o.thr || .12)) / (1 - (o.thr || .12)) * (RAMP.length - 1)))];
        line += ch;
      }
      // строка → куски до MAXR символов (по одному куску — одна категория)
      let q = 0; while (q < line.length){ if (line[q] === " "){ q++; continue; } let e2 = q; while (e2 < line.length && e2 - q < MAXR && !(line[e2] === " " && line[e2 + 1] === " ")) e2++;
        const txt = line.slice(q, e2).replace(/\s+$/, ""); if (txt) out.push({ category_name: txt, x_position: r1(o.x + q * CW), y_position: r1(o.y + r * RH - 9), width: SYM, height: SYM, hero_ids: [], _g: G }); q = e2; }
    }
    return out;
  }
  // текст вразрядку (цитаты сверху, как в арт-сетках)
  function spaced(t, x, y, g){ return t.split("|").map((ln, i) => ({ category_name: [...ln.toUpperCase()].join(" "), x_position: x, y_position: y + i * 20, width: SYM, height: SYM, hero_ids: [], _g: g })); }
  function artCats(img0, o){
    if (o.mode === "ascii") return asciiCats(img0, o);
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
  // сцены в новом стиле: свой рисунок плотным ASCII + рамка-орнамент с героями + цитата
  const NEWSC = [
    { n: "Слёзы", t: "Dead inside, Аниме, Рамки", art: "a15", q: "ты всё ещё ждёшь,|что они вернутся?" }
  ];
  const chars = cs => cs.reduce((n, k) => n + (k.hero_ids.length ? 0 : k.category_name.replace(/\s/g, "").length), 0);
  async function newScene(d){
    await heroes(); const [art, fr] = await Promise.all([loadImg(`/grids-art/${d.art}.webp`), loadImg("/grids-art/a11.webp")]), g = newG(), g2 = newG();
    const top = [...H].filter(h => h.pick).sort((a, b) => b.pick - a.pick).slice(0, 12).map(h => h.id);
    const best = asciiCats(art, { x: 0, y: 2, w: 840, h: 590, g, stretch: true, inv: false, norm: true, cw: 5, rh: 9, gain: 1, thr: .3, edge: .2, blur: 1, run: 4 });
    const cats = best.concat(asciiCats(fr, { x: 866, y: 118, w: 320, h: 466, stretch: true, g: g2, inv: true, norm: true, cw: 5, rh: 9, gain: 1, thr: .35, edge: .25, run: 4, blur: 1, ramp: " .:-=+*" }))
      .concat(spaced(d.q, 872, 24, newG()));
    cats.push({ category_name: "", x_position: 906, y_position: 186, width: 240, height: 330, hero_ids: top });
    return { config_name: d.n, categories: cats };
  }
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
      el.innerHTML = `<div class="gr-name">
          <label class="gr-nm" title="Название сетки — так она будет называться в Доте"><span aria-hidden="true">✏️</span><input id="grCfgN" maxlength="40" aria-label="Название сетки" placeholder="Назови свою сетку"></label>
          <div class="gr-my"><select id="grCfg" aria-label="Мои сетки"></select><button type="button" class="gr-b" id="grNew" title="Новая пустая сетка">＋ Новая</button><button type="button" class="gr-b gr-ic" id="grDelC" title="Удалить эту сетку" aria-label="Удалить сетку">🗑</button></div>
        </div>
        <div class="gr-steps" id="grSteps"></div>
        <div class="gr-bar"><button type="button" class="rkc gr-howb" id="grHowB" hidden>❓ Как сделать сетку</button>
          <span class="gr-sp"></span>
          <button type="button" class="gr-b" id="grImp">⤓ Импорт</button><button type="button" class="gr-b" id="grLink">🔗 Ссылка</button><button type="button" class="gr-b" id="grPub">📤 В мастерскую</button><button type="button" class="gr-b gr-main" id="grDl">⬇ Скачать файл</button>
        </div>
        <div class="gr-tpl"><span>Шаблоны:</span>${PRESETS.map(p => `<button type="button" class="rkc" data-tp="${p.k}" title="${esc(p.d)}">${esc(p.n)}</button>`).join("")}<button type="button" class="rkc" data-tp="clear">Очистить</button></div>
        <div class="gr-wrap">
          <div class="gr-left">
            <div class="gr-tools"><button type="button" class="gr-b gr-art" id="grArt">🎨 Арт / сцена</button><button type="button" class="gr-b" id="grAdd">＋ Категория</button><button type="button" class="gr-b" id="grTxt">T Текст</button><span class="gr-seg"><button type="button" class="gr-b gr-ic" id="grUndo" title="Отменить (Ctrl+Z)" aria-label="Отменить" disabled>↶</button><button type="button" class="gr-b gr-ic" id="grRedo" title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить" disabled>↷</button></span><button type="button" class="gr-b gr-ic" id="grFull" title="Во весь экран" aria-label="Во весь экран" aria-pressed="false">⛶</button><span class="gr-sp"></span><span class="gr-stat" id="grCnt"></span></div>
            <div class="gr-stage" id="grStage" tabindex="0" aria-label="Сетка героев"><div class="gr-cv" id="grCv"></div><canvas class="gr-sym" id="grSym" aria-hidden="true"></canvas><canvas class="gr-sym" id="grSymS" aria-hidden="true"></canvas></div>
            <details class="gr-hint"><summary>Подсказки</summary>Перетаскивай категории, героев и рисунки. Клик по герою в списке — добавить в выбранную категорию, двойной клик по герою в сетке — убрать. Клик по точке рисунка выделяет весь рисунок. Стрелки двигают (с Shift — быстрее), Delete удаляет, Ctrl+Z — отменить.</details>
            <div class="gr-insp" id="grInsp"></div>
          </div>
          <div class="gr-pal">
            <label class="d2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="grQ" placeholder="Найти героя" autocomplete="off"></label>
            <div class="gr-af">${[["", "Все"], ...ATTR.map(a => [a[0], a[1]])].map(a => `<button type="button" class="rkc" data-af="${a[0]}" aria-pressed="${a[0] === ""}">${a[1]}</button>`).join("")}</div>
            <div class="gr-ph" id="grPh"><div class="feed-sk"></div></div>
          </div>
        </div>`;
      stage = el.querySelector("#grStage");
      el.querySelector("#grSteps").onclick = e => { const b = e.target.closest("[data-st]"); if (b) stepGo(+b.dataset.st); if (e.target.closest(".gr-shide")) stepsShow(false); };
      el.querySelector("#grHowB").onclick = () => stepsShow(true);
      el.querySelector("#grUndo").onclick = () => histGo(true); el.querySelector("#grRedo").onclick = () => histGo(false);
      el.querySelector("#grFull").onclick = e => { const on = el.classList.toggle("gr-full"); e.currentTarget.setAttribute("aria-pressed", on); document.documentElement.classList.toggle("gr-lock", on); };
      addEventListener("keydown", e => { if (el.offsetParent === null && !el.classList.contains("gr-full")) return;
        if (e.key === "Escape" && el.classList.contains("gr-full") && !document.querySelector(".gr-mod")){ el.querySelector("#grFull").click(); return; }
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector(".gr-mod")) return;
        if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z" || e.key === "я" || e.key === "Я")){ e.preventDefault(); histGo(!e.shiftKey); }
        else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "н")){ e.preventDefault(); histGo(false); } });
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
  /* ---------- пошаговая подсказка: 4 шага, отмечаются сами по мере работы ---------- */
  const STEPS = [["Выбери шаблон", "Готовая раскладка — или начни с пустой сетки и добавь категории сам"], ["Расставь героев", "Перетащи героя из списка в категорию. Клик по герою — добавить в выбранную категорию"], ["Добавь рисунок", "Необязательно: арт из точек — герой, аниме или своя картинка"], ["Скачай и установи", "Один файл — и сетка появится в Доте при выборе героя"]];
  function stepsShow(on){ try { localStorage.setItem("ub-grid-steps", on ? "1" : "0"); } catch(e) {} steps(); }
  function steps(){ const el = document.getElementById("grSteps"), hb = document.getElementById("grHowB"); if (!el || !FILE) return;
    let on = true; try { on = localStorage.getItem("ub-grid-steps") !== "0"; } catch(e) {} el.hidden = !on; if (hb) hb.hidden = on; if (!on) return;
    const cs = C().categories, dl = (() => { try { return localStorage.getItem("ub-grid-dl") === "1"; } catch(e) { return false; } })();
    const done = [cs.some(k => !isSym(k)), cs.some(k => k.hero_ids.length), cs.some(isSym), dl], nx = done.findIndex((d, i) => !d && i !== 2);
    el.innerHTML = `<div class="gr-sh"><b>Как сделать сетку</b><button type="button" class="gr-shide">Скрыть</button></div><div class="gr-sl">${STEPS.map((x, i) => `<button type="button" class="gr-st${done[i] ? " ok" : ""}${i === nx ? " now" : ""}" data-st="${i}"><i>${done[i] ? "✓" : i + 1}</i><span><b>${x[0]}</b><small>${x[1]}</small></span></button>`).join("")}</div>`; }
  function flash(q){ const t = document.querySelector(q); if (!t) return; t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.remove("gr-flash"); void t.offsetWidth; t.classList.add("gr-flash"); }
  function stepGo(i){ if (i === 0) flash(".gr-tpl"); else if (i === 1){ if (!C().categories.some(k => !isSym(k))) addCat(); flash(".gr-pal"); } else if (i === 2) artist(); else download(); }
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
    if (sym) return "";
    let inner = "";
    if (k.hero_ids.length){ const f = fit(k); inner = `<div class="gr-ts" style="gap:${PG * s}px;grid-template-columns:repeat(${f.cols},${f.tw * s}px)">${k.hero_ids.map((id, n) => { const h = HB[id]; return `<i class="gr-t" data-n="${n}" data-id="${id}" title="${esc(h ? h.n : id)}" style="width:${f.tw * s}px;height:${f.th * s}px">${h ? `<img alt="" src="${esc(h.img)}" loading="lazy" draggable="false">` : ""}</i>`; }).join("")}</div>`; }
    return `<div class="gr-cat${on ? " on" : ""}${sym ? " sym" : ""}${k._g ? " grp" : ""}${!k.hero_ids.length && !sym ? " zone" : ""}" data-i="${i}" style="left:${k.x_position * s}px;top:${k.y_position * s}px;width:${k.width * s}px;height:${k.height * s}px">${k.category_name ? `<div class="gr-lb" style="font-size:${LF * s}px">${esc(k.category_name)}</div>` : ""}${inner}${i === sel && !sym ? `<b class="gr-rs" title="Размер"></b>` : ""}</div>`;
  }
  function draw(soft){
    if (!stage || !FILE) return; const cv = document.getElementById("grCv"), cs = C().categories;
    s = stage.clientWidth / GW; cv.style.height = GH * s + "px"; stage.style.setProperty("--s", s);
    if (!soft){ cfgList(); const n = document.getElementById("grCfgN"); if (n && document.activeElement !== n) n.value = C().config_name; }
    cv.innerHTML = cs.map(catHTML).join("") + (selG ? gbox() : "");
    symDraw();
    const cn = document.getElementById("grCnt"); if (cn){ const sy = chars(cs.filter(isSym)); cn.innerHTML = `Категорий: <b>${cs.length}</b> · символов: <b>${sy}</b>${cs.length > 2600 ? ' · <span class="gr-warn">много — Дота может подтормаживать</span>' : ""}`; }
    if (!soft){ insp(); palMarks(); steps(); }
  }
  /* символы и рисунки — на canvas: тысячи точек без тысяч элементов страницы */
  const MW = new Map();
  let mctx = null; const mw = t => { let w = MW.get(t); if (w == null){ if (!mctx) mctx = document.createElement("canvas").getContext("2d"); mctx.font = `600 ${LF}px "Segoe UI", system-ui, sans-serif`; w = mctx.measureText(t).width; if (MW.size > 20000) MW.clear(); MW.set(t, w); } return w; };
  function symCanvas(id){ const c = document.getElementById(id); if (!c) return null; const dpr = Math.min(2, devicePixelRatio || 1), W = stage.clientWidth, Hh = GH * s;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(Hh * dpr)){ c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr); c.style.width = W + "px"; c.style.height = Hh + "px"; }
    const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh); g.textBaseline = "top"; g.font = `600 ${LF * s}px "Segoe UI", system-ui, sans-serif`; c.style.transform = ""; return g; }
  function symDraw(){
    const a = symCanvas("grSym"), b = symCanvas("grSymS"); if (!a || !b) return; const cs = C().categories;
    a.fillStyle = "rgba(235,240,240,.92)"; b.fillStyle = selG ? "#ffe08a" : "#f3c35a";
    for (let i = 0; i < cs.length; i++){ const k = cs[i]; if (!k.category_name || !isSym(k)) continue; const on = i === sel || (selG && k._g === selG);
      (on ? b : a).fillText(k.category_name, k.x_position * s, k.y_position * s); }
    if (sel >= 0 && cs[sel] && isSym(cs[sel])){ const k = cs[sel]; b.strokeStyle = "#f3c35a"; b.setLineDash([3, 3]); b.strokeRect(k.x_position * s - 3, k.y_position * s - 3, Math.max(8, mw(k.category_name) * s) + 6, LF * s + 6); }
  }
  // какой символ под пальцем: последний нарисованный сверху; мелкие точки ловим с запасом
  function symAt(e){ const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s, cs = C().categories, pad = 4 / s;
    for (let i = cs.length - 1; i >= 0; i--){ const k = cs[i]; if (!k.category_name || !isSym(k)) continue; const w = mw(k.category_name);
      if (x >= k.x_position - pad && x <= k.x_position + w + pad && y >= k.y_position - pad && y <= k.y_position + LF * 1.15 + pad) return i; }
    return -1; }
  function gbounds(g){ let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0; for (const k of C().categories) if (k._g === g){ n++; if (k.x_position < x0) x0 = k.x_position; if (k.y_position < y0) y0 = k.y_position; if (k.x_position + 8 > x1) x1 = k.x_position + 8; if (k.y_position + 16 > y1) y1 = k.y_position + 16; } return n ? { x0, y0, x1, y1, n } : null; }
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
    const rs = e.target.closest(".gr-rs"), t = e.target.closest(".gr-t"), p = e.target.closest(".gr-p"), gb = e.target.closest(".gr-gbox");
    let cat = e.target.closest(".gr-cat"), si = -1;
    if (!rs && !t && !p && !gb && stage.contains(e.target)){ si = symAt(e); if (si >= 0) cat = { dataset: { i: si } }; }
    if (p){ D = { kind: "hero", id: +p.dataset.id, from: null, x0: e.clientX, y0: e.clientY, moved: false }; }
    else if (t){ D = { kind: "hero", id: +t.dataset.id, from: [+cat.dataset.i, +t.dataset.n], x0: e.clientX, y0: e.clientY, moved: false }; }
    else if (rs){ const k = C().categories[sel]; D = { kind: "rs", k, w0: k.width, h0: k.height, x0: e.clientX, y0: e.clientY }; }
    else if (gb || (cat && C().categories[+cat.dataset.i]._g)){ const g = gb ? selG : C().categories[+cat.dataset.i]._g; if (selG !== g){ selG = g; sel = -1; draw(); }
      const ks = C().categories.map((k, i) => [k, i]).filter(([k]) => k._g === g); D = { kind: "grp", ks: ks.map(([k, i]) => [k, i, k.x_position, k.y_position]), x0: e.clientX, y0: e.clientY }; }
    else if (cat){ const i = +cat.dataset.i; if (sel !== i || selG){ sel = i; selG = null; draw(); } const k = C().categories[i]; D = { kind: "mv", k, sym: isSym(k), kx: k.x_position, ky: k.y_position, x0: e.clientX, y0: e.clientY }; }
    else { if (sel !== -1 || selG){ sel = -1; selG = null; draw(); } return; }
    e.preventDefault(); stage.focus({ preventScroll: true });
    addEventListener("pointermove", onMove); addEventListener("pointerup", onUp, { once: true });
  }
  // движение обрабатываем раз в кадр: на телефонах pointermove приходит чаще, чем экран успевает рисовать
  let mvE = null, mvR = 0;
  function onMove(e){ mvE = e; if (!mvR) mvR = requestAnimationFrame(() => { mvR = 0; if (mvE) move(mvE); }); }
  function move(e){
    if (!D) return; const dx = (e.clientX - D.x0) / s, dy = (e.clientY - D.y0) / s, sc = document.getElementById("grSymS");
    if (D.kind === "mv"){ D.k.x_position = Math.round(D.kx + dx); D.k.y_position = Math.round(D.ky + dy);
      if (D.sym){ if (sc) sc.style.transform = `translate(${(D.k.x_position - D.kx) * s}px, ${(D.k.y_position - D.ky) * s}px)`; }
      else { const el = stage.querySelector(`.gr-cat[data-i="${sel}"]`); if (el){ el.style.left = D.k.x_position * s + "px"; el.style.top = D.k.y_position * s + "px"; } } }
    else if (D.kind === "grp"){ const cv = document.getElementById("grCv"); D.ks.forEach(([k, i, x, y]) => { k.x_position = r1(x + dx); k.y_position = r1(y + dy); if (!isSym(k)){ const el = cv.querySelector(`.gr-cat[data-i="${i}"]`); if (el){ el.style.left = k.x_position * s + "px"; el.style.top = k.y_position * s + "px"; } } });
      const tr = `translate(${dx * s}px, ${dy * s}px)`, gb = cv.querySelector(".gr-gbox"); if (gb) gb.style.transform = tr; if (sc) sc.style.transform = tr; }
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
    removeEventListener("pointermove", onMove); if (mvR){ cancelAnimationFrame(mvR); mvR = 0; } if (mvE && D) move(e); mvE = null; const d = D; D = null; if (!d) return;
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
        <label>Стиль <select id="grMd"><option value="ascii">ASCII-арт (плотно)</option><option value="line">Контур точками</option><option value="fill">Заливка символами</option></select></label>
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
      const o = box(), md = b.querySelector("#grMd").value; cats = artCats(img, { ...o, mode: md, gain: md === "ascii" ? +b.querySelector("#grSt").value / 50 : 1, edge: md === "ascii" ? .5 - +b.querySelector("#grTh").value / 120 : 0, norm: md === "ascii", cw: md === "ascii" ? 5 : undefined, rh: md === "ascii" ? 9 : undefined, ...(md === "ascii" ? { blur: 1, run: 4 } : {}), step: +b.querySelector("#grSt").value / 10, thr: md === "ascii" ? .3 : +b.querySelector("#grTh").value / 100, ch: b.querySelector("#grCh").value, inv: b.querySelector("#grInv").checked, crop: +b.querySelector("#grCr").value });
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
  function download(){ saveFile(); try { localStorage.setItem("ub-grid-dl", "1"); } catch(e) {} steps();
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
  /* превью сетки — как в редакторе: тот же фон, портреты героев, подписи и символы настоящим шрифтом */
  const IMC = new Map(); const pimg = src => { let im = IMC.get(src); if (!im){ im = new Image(); im.decoding = "async"; im.src = src; IMC.set(src, im); } return im; };
  function drawCfg(cv, cfg, W){
    if (!cv || !W) return; const dpr = Math.min(2, devicePixelRatio || 1), sc = W / GW, Hh = Math.round(GH * sc); cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
    const g = cv.getContext("2d"); let t = 0;
    const run = () => { g.setTransform(dpr, 0, 0, dpr, 0, 0); let wait = [];
      const lg = g.createLinearGradient(0, 0, 0, Hh); lg.addColorStop(0, "#102022"); lg.addColorStop(1, "#0a1214"); g.fillStyle = lg; g.fillRect(0, 0, W, Hh);
      const rg = g.createRadialGradient(W / 2, Hh * .38, 4, W / 2, Hh * .38, W * .62); rg.addColorStop(0, "rgba(48,84,86,.38)"); rg.addColorStop(1, "rgba(48,84,86,0)"); g.fillStyle = rg; g.fillRect(0, 0, W, Hh);
      g.font = `600 ${LF * sc}px "Segoe UI", system-ui, sans-serif`;
      for (const k of cfg.categories || []){ const x = k.x_position * sc, y = k.y_position * sc, sym = isSym(k);
        if (k.hero_ids && k.hero_ids.length){ const f = fit(k);
          k.hero_ids.forEach((id, n) => { const tx = x + (n % f.cols) * (f.tw + PG) * sc, ty = y + Math.floor(n / f.cols) * (f.th + PG) * sc, tw = f.tw * sc, th = f.th * sc, h = HB[id], im = h && pimg(h.img);
            if (im && im.complete && im.naturalWidth){ const sw = Math.min(im.naturalWidth, im.naturalHeight * tw / th); g.drawImage(im, (im.naturalWidth - sw) / 2, 0, sw, im.naturalHeight, tx, ty, tw, th); }
            else { if (im) wait.push(im); const a = ATTR.find(z => h && z[0] === h.a); g.fillStyle = a ? a[2] : "#334"; g.globalAlpha = .55; g.fillRect(tx, ty, tw, th); g.globalAlpha = 1; } }); }
        else if (!sym){ g.setLineDash([3, 3]); g.strokeStyle = "rgba(255,255,255,.16)"; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, k.width * sc, k.height * sc); g.setLineDash([]); }
        if (k.category_name){ g.fillStyle = sym ? "rgba(235,240,240,.92)" : "rgba(255,255,255,.85)"; g.textBaseline = sym ? "top" : "bottom"; g.fillText(k.category_name, x, y); } }
      // портреты догружаются — перерисуем, когда придут
      if (wait.length){ const again = () => { clearTimeout(t); t = setTimeout(() => { if (cv.isConnected) run(); }, 150); }; [...new Set(wait)].forEach(im => im.addEventListener("load", again, { once: true })); } };
    run();
  }
  // карточек много (сцены по 18 тысяч точек) — рисуем только те, что видны
  const IO = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; IO.unobserve(e.target); const f = e.target._draw; if (f) f(); }), { rootMargin: "300px" }) : null;
  function lazyDraw(cv, cfg){ const f = () => drawCfg(cv, cfg, cv.parentElement.clientWidth || 420); if (IO){ cv._draw = f; IO.observe(cv); } else f(); }
  async function shop(){
    const el = document.getElementById("grShop"); await heroes().catch(() => {});
    el.innerHTML = `<div class="gr-ws"><div><span class="gr-wst">Мастерская</span><h3>Сетки от игроков сайта</h3><p>Публикуй свои сетки — их смогут открыть в редакторе, скачать и лайкнуть. Лучшие поднимаются в «Популярных».</p></div>
        <div class="gr-wsa"><button type="button" class="btn btn-primary" id="grWsPub">📤 Опубликовать свою сетку</button><small id="grWsN"></small></div></div>
      <div class="gr-shead"><div class="rkchips">${[["new", "Новые"], ["top", "Популярные"], ["dl", "Скачивают"], ["mine", "Мои"]].map(x => `<button type="button" class="rkc" data-ss="${x[0]}" aria-pressed="${x[0] === shopSort}">${x[1]}</button>`).join("")}</div>
      <label class="d2-search gr-sq"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="grSQ" placeholder="Название или автор" value="${esc(shopQ)}"></label></div>
      <h3 class="gr-h3">Сетки игроков</h3><div class="gr-cards" id="grUsr"><div class="feed-sk"></div></div>
      <h3 class="gr-h3">Новые арт-сетки</h3><div class="gr-cards" id="grNew2"><div class="feed-sk"></div></div>
      <h3 class="gr-h3">Арт-сцены от Aegis</h3><p class="gr-mut">Позиции 1–5 в рамке и герой, нарисованный точками. Свою сцену — с любой картинкой — собери в редакторе: «🎨 Арт / сцена».</p><div class="gr-cards" id="grScn"><div class="feed-sk"></div></div><button type="button" class="btn btn-ghost gr-more" id="grMore" hidden>Ещё сцены</button>
      <h3 class="gr-h3">Обычные сетки</h3><div class="gr-cards" id="grPre"></div>`;
    el.querySelectorAll("[data-ss]").forEach(b => b.onclick = () => { shopSort = b.dataset.ss; el.querySelectorAll("[data-ss]").forEach(x => x.setAttribute("aria-pressed", x === b)); users(); });
    el.querySelector("#grWsPub").onclick = () => { if (!C().categories.length){ PROF.toast("Сначала собери сетку в редакторе — потом опубликуй её здесь."); go("edit"); return; } publish(); };
    let qt = 0; el.querySelector("#grSQ").oninput = e => { clearTimeout(qt); qt = setTimeout(() => { shopQ = e.target.value.trim(); users(); }, 300); };
    const pre = PRESETS.map(p => ({ name: p.n, nick: "Aegis", d: p.d, data: { config_name: p.n, categories: H.length ? p.f() : [] } }));
    const pb = el.querySelector("#grPre"); pb.innerHTML = pre.map(card).join(""); bindCards(pb, pre);
    users();
    (async () => { const nb = el.querySelector("#grNew2"), ns = []; for (const d of NEWSC){ try { ns.push({ name: d.n, nick: "Aegis", d: d.t, data: await newScene(d) }); } catch(e) {} } if (!nb.isConnected) return; nb.innerHTML = ns.map(card).join(""); bindCards(nb, ns); })();
    const sc = [], box = el.querySelector("#grScn"), more = el.querySelector("#grMore"), total = ALLSC().length; let next = 0;
    const batch = async () => { more.hidden = true; const end = Math.min(total, next + 12);
      for (; next < end; next++){ const q = sceneOf(next); try { sc.push({ name: "Сцена: " + q.name, nick: "Aegis", d: q.cn, data: await sceneCfg(q.slug, q.name, q.crop, q.side) }); } catch(e) {} if (!box.isConnected) return; }
      box.innerHTML = sc.map(card).join(""); bindCards(box, sc); more.hidden = next >= total; more.textContent = `Ещё сцены (${total - next})`; };
    more.onclick = batch; batch();
  }
  function card(g){ const cs = g.data.categories || [], sy = chars(cs.filter(isSym)); return `<div class="gr-card"><button type="button" class="gr-th" data-a="view" aria-label="Посмотреть сетку"><canvas></canvas></button><div class="gr-ci"><b>${esc(g.name)}</b><small>${esc(g.nick || "")}${g.d ? " · " + esc(g.d) : ""}${g.at ? " · " + esc(g.at) : ""}</small>${g.data.descr ? `<p class="gr-ds">${esc(g.data.descr)}</p>` : ""}
    <small class="gr-meta">Категорий: ${cs.length}${sy ? ` · символов: ${sy}` : ""}${g.likes != null ? ` · ❤ ${g.likes} · ⬇ ${g.downloads || 0}` : ""}</small>
    <div class="gr-ca"><button type="button" class="gr-b" data-a="open">✏ В редактор</button><button type="button" class="gr-b" data-a="dl">⬇ Файл</button>${g.id ? `<button type="button" class="gr-b" data-a="com" aria-label="Комментарии">💬 ${g.cm || 0}</button>` : ""}${g.id ? `<button type="button" class="gr-b gr-like" data-a="like" aria-pressed="${!!g.liked}" aria-label="Нравится">${g.liked ? "❤️" : "🤍"} ${g.likes || 0}</button>` : ""}${g.mine ? `<button type="button" class="gr-b gr-red" data-a="del">Удалить</button>` : ""}</div></div></div>`; }
  function bindCards(box, list){
    box.querySelectorAll(".gr-card").forEach((c, i) => lazyDraw(c.querySelector(".gr-th canvas"), list[i].data));
    box.querySelectorAll(".gr-card").forEach((c, i) => c.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { const g = list[i], a = b.dataset.a, sb = SBT();
      if (a === "open"){ const nc = keepG({ configs: [{ ...g.data, config_name: g.name }] }).configs[0]; if (!g.id) nc._src = "aegis"; FILE.configs.push(nc); cur = FILE.configs.length - 1; sel = -1; selG = null; save(); go("edit"); PROF.toast(`«${esc(g.name)}» открыта в редакторе`); if (g.id && sb) sb.rpc("grid_dl", { gid: g.id }).then(() => {}, () => {}); }
      if (a === "view" || a === "com"){ const [mb, close2] = modal(`<h3>${esc(g.name)}</h3><p class="gr-mut">${esc(g.nick || "")}${g.data.descr ? " — " + esc(g.data.descr) : ""}</p><div class="gr-pvw"><canvas class="gr-pvi"></canvas></div><div class="gr-acts"><span class="gr-mut">Категорий: ${(g.data.categories || []).length}</span><span><button type="button" class="btn btn-ghost" id="grVO">✏ В редактор</button> <button type="button" class="btn btn-primary" id="grVD">⬇ Скачать файл</button></span></div>${g.id ? `<div class="gr-cm" id="grCm"><h4>Комментарии</h4><div class="gr-cml"><div class="feed-sk"></div></div><form class="gr-cmf"><input maxlength="500" placeholder="Напиши, как тебе сетка…" aria-label="Комментарий"><button type="submit" class="btn btn-primary">Отправить</button></form></div>` : ""}`);
        requestAnimationFrame(() => drawCfg(mb.querySelector(".gr-pvi"), g.data, mb.querySelector(".gr-pvw").clientWidth));
        if (g.id) comments(mb.querySelector("#grCm"), g, () => users()); if (a === "com") setTimeout(() => mb.querySelector("#grCm").scrollIntoView({ block: "start", behavior: "smooth" }), 80);
        mb.querySelector("#grVO").onclick = () => { close2(); c.querySelector('[data-a="open"]').click(); }; mb.querySelector("#grVD").onclick = () => { close2(); c.querySelector('[data-a="dl"]').click(); }; return; }
      if (a === "dl"){ saveFile({ version: 3, configs: [{ ...g.data, config_name: g.name }] }); if (g.id && sb) sb.rpc("grid_dl", { gid: g.id }).then(() => {}, () => {}); }
      if (a === "like"){ const u = PROF.user(); if (!u){ PROF.open(); return; } const r = await sb.from("grid_likes").insert({ grid_id: g.id }); if (r.error){ await sb.from("grid_likes").delete().eq("grid_id", g.id).eq("user_id", u.id); } users(); }
      if (a === "del"){ if (!confirmIn(b, "Точно?")) return; await sb.from("grids").delete().eq("id", g.id); users(); }
    }));
  }
  async function users(){
    const box = document.getElementById("grUsr"); if (!box) return; const sb = SBT();
    if (!sb){ box.innerHTML = `<div class="gempty">Мастерская работает на основном сайте.</div>`; return; }
    const u0 = PROF.user(); if (shopSort === "mine" && !u0){ box.innerHTML = `<div class="gempty">Войди, чтобы видеть свои публикации.</div>`; return; }
    let q = sb.from("grids").select("id,user_id,nick,name,data,likes,downloads,created_at", { count: "exact" }).limit(48).order(shopSort === "top" ? "likes" : shopSort === "dl" ? "downloads" : "created_at", { ascending: false });
    q = q.is("data->>kind", null); // строки-комментарии (см. comments) в списке сеток не показываем
    if (shopSort === "mine") q = q.eq("user_id", u0.id);
    if (shopQ) q = q.or(`name.ilike.%${shopQ.replace(/[%,()]/g, "")}%,nick.ilike.%${shopQ.replace(/[%,()]/g, "")}%`);
    const { data, error, count } = await q;
    if (error){ box.innerHTML = `<div class="gempty">Не удалось загрузить мастерскую. Обнови страницу через минуту.</div>`; return; }
    const wn = document.getElementById("grWsN"); if (wn && shopSort !== "mine" && !shopQ) wn.textContent = count ? `Опубликовано сеток: ${count}` : "Будь первым — опубликуй свою сетку!";
    if (!data.length){ box.innerHTML = `<div class="gempty">${shopSort === "mine" ? "Ты ещё ничего не публиковал." : shopQ ? "Ничего не нашли." : "Пока пусто — опубликуй свою сетку первым: «📤 Опубликовать свою сетку» выше."}</div>`; return; }
    const u = PROF.user(); let liked = new Set();
    if (u){ try { const r = await sb.from("grid_likes").select("grid_id").in("grid_id", data.map(x => x.id)); liked = new Set((r.data || []).map(x => x.grid_id)); } catch(e) {} }
    let cmN = {}; const ids = data.map(x => x.id);
    try { const r = await sb.from("grid_comments").select("grid_id").in("grid_id", ids).limit(2000); if (!r.error) (r.data || []).forEach(x => { cmN[x.grid_id] = (cmN[x.grid_id] || 0) + 1; }); } catch(e) {}
    try { const r = await sb.from("grids").select("data->>g").eq("data->>kind", "c").in("data->>g", ids.map(String)).limit(2000); if (!r.error) (r.data || []).forEach(x => { const k = +x.g; cmN[k] = (cmN[k] || 0) + 1; }); } catch(e) {}
    const ago = t => { const d = (Date.now() - Date.parse(t)) / 864e5; return d < 1 ? "сегодня" : d < 2 ? "вчера" : d < 30 ? Math.floor(d) + " дн. назад" : new Date(t).toLocaleDateString(); };
    await Promise.all(data.map(async r => { if (r.data && r.data.packed){ try { const v = await unpack(r.data.packed); r.data = { ...v, config_name: r.data.config_name, descr: r.data.descr }; } catch(e) { r.data = { config_name: r.name, categories: [] }; } } }));
    const list = data.map(r => ({ id: r.id, name: r.name, nick: r.nick, data: r.data, likes: r.likes, downloads: r.downloads, mine: u && u.id === r.user_id, liked: liked.has(r.id), at: ago(r.created_at), cm: cmN[r.id] || 0 }));
    box.innerHTML = list.map(card).join(""); bindCards(box, list);
  }
  /* комментарии к сетке */
  // Комментарии хранятся в таблице grid_comments, а пока её нет на сервере — отдельными строками в grids
  // (data.kind = "c", data.g = id сетки): так комментарии работают сразу, без настройки базы.
  async function comments(el, g, onChange){
    const sb = SBT(), list = el.querySelector(".gr-cml"), f = el.querySelector(".gr-cmf"), inp = f.querySelector("input");
    const when = t => { const d = (Date.now() - Date.parse(t)) / 6e4; return d < 1 ? "только что" : d < 60 ? Math.floor(d) + " мин" : d < 1440 ? Math.floor(d / 60) + " ч" : new Date(t).toLocaleDateString(); };
    let table = null; // "gc" — своя таблица есть, "g" — запасной вариант
    async function load(){
      const [a, b] = await Promise.all([
        sb.from("grid_comments").select("id,user_id,nick,body,created_at").eq("grid_id", g.id).order("created_at", { ascending: true }).limit(200),
        sb.from("grids").select("id,user_id,nick,data,created_at").eq("data->>kind", "c").eq("data->>g", String(g.id)).order("created_at", { ascending: true }).limit(200) ]);
      table = a.error ? "g" : "gc";
      const rows = [...(a.error ? [] : (a.data || []).map(c => ({ ...c, src: "gc" }))), ...(b.error ? [] : (b.data || []).map(c => ({ id: c.id, user_id: c.user_id, nick: c.nick, body: String((c.data || {}).body || ""), created_at: c.created_at, src: "g" })))]
        .sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
      if (a.error && b.error){ list.innerHTML = `<div class="gempty">Не удалось загрузить комментарии.</div>`; return; }
      const u = PROF.user();
      list.innerHTML = rows.length ? rows.map(c => `<div class="gr-c"><b translate="no">${esc(c.nick)}</b><span>${when(c.created_at)}</span>${u && (u.id === c.user_id || (g.mine && c.src === "gc")) ? `<button type="button" class="gr-cx" data-id="${c.id}" data-src="${c.src}" aria-label="Удалить">✕</button>` : ""}<p>${esc(c.body)}</p></div>`).join("") : `<div class="gempty">Пока без комментариев — будь первым.</div>`;
      list.scrollTop = list.scrollHeight;
      list.querySelectorAll(".gr-cx").forEach(bt => bt.onclick = async () => { await sb.from(bt.dataset.src === "gc" ? "grid_comments" : "grids").delete().eq("id", +bt.dataset.id); load(); onChange && onChange(); });
    }
    let lastAt = 0;
    f.onsubmit = async e => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; if (!PROF.user()){ PROF.open(); return; }
      if (Date.now() - lastAt < 8000){ PROF.toast("Слишком часто — подожди пару секунд."); return; }
      const bt = f.querySelector("button"); bt.disabled = true; const nick = String(PROF.me() || "Игрок").slice(0, 40), body = v.slice(0, 500);
      const { error } = table === "gc" ? await sb.from("grid_comments").insert({ grid_id: g.id, body, nick })
        : await sb.from("grids").insert({ name: "💬", nick, data: { kind: "c", g: String(g.id), body } });
      bt.disabled = false; if (error){ PROF.toast(/too_fast/.test(error.message || "") ? "Слишком часто — подожди минутку." : "Не получилось отправить комментарий."); return; }
      lastAt = Date.now(); inp.value = ""; load(); onChange && onChange(); };
    if (!sb){ list.innerHTML = `<div class="gempty">Комментарии работают на основном сайте.</div>`; f.hidden = true; return; }
    load();
  }
  async function publish(){
    const sb = SBT(), u = PROF.user(); if (!sb){ PROF.toast("Публикация работает на основном сайте."); return; } if (!u){ PROF.open(); return; }
    const c = clean({ configs: [C()] }).configs[0]; if (!c.categories.length){ PROF.toast("Сетка пустая — добавь категории и героев."); return; }
    // готовые сетки Aegis уже лежат в мастерской — публиковать их копию от своего имени нельзя
    if (C()._src === "aegis"){ const [b2, close2] = modal(`<div class="gr-no"><b>Эту сетку нельзя опубликовать</b><p>Это готовая сетка от <b>Aegis</b> — она уже есть на сайте в мастерской, и любой может её скачать. Опубликовать можно только сетку, которую ты собрал сам: начни с «＋ Новая» или с шаблона и добавь свой рисунок через «🎨 Арт / сцена».</p></div><div class="gr-acts"><span></span><button type="button" class="btn btn-primary" id="grNoOk">Понятно</button></div>`); b2.querySelector("#grNoOk").onclick = close2; return; }
    const [b, close] = modal(`<h3>Опубликовать в мастерской</h3><p class="gr-mut">Сетку увидят все: её можно будет открыть в редакторе, скачать и лайкнуть.</p><div class="gr-pvw"><canvas class="gr-pvi"></canvas></div><input id="grPN" maxlength="60" value="${esc(c.config_name)}" placeholder="Название"><textarea id="grPD" maxlength="200" rows="2" placeholder="Пара слов о сетке: для какой роли, что внутри (необязательно)"></textarea><p class="gr-mut">Без оскорблений и рекламы — такие сетки удаляем.</p><div class="gr-acts"><span></span><button type="button" class="btn btn-primary" id="grPG">Опубликовать</button></div><div class="gr-err" id="grPE"></div>`);
    requestAnimationFrame(() => drawCfg(b.querySelector(".gr-pvi"), c, b.querySelector(".gr-pvw").clientWidth));
    b.querySelector("#grPG").onclick = async () => { const name = b.querySelector("#grPN").value.trim() || c.config_name; b.querySelector("#grPG").disabled = true;
      const descr = b.querySelector("#grPD").value.trim().slice(0, 200);
      // большие арт-сетки (тысячи точек) не влезали в лимит сервера — храним их сжатыми, при показе распаковываем
      let data = { ...c, config_name: name, ...(descr ? { descr } : {}) };
      if (JSON.stringify(data).length > 150000){ try { data = { config_name: name, ...(descr ? { descr } : {}), n: c.categories.length, packed: await pack({ config_name: name, categories: c.categories }) }; } catch(e) {} }
      if (JSON.stringify(data).length > 590000){ b.querySelector("#grPE").textContent = "Сетка слишком большая даже в сжатом виде — уменьши плотность рисунка или удали лишние точки."; b.querySelector("#grPG").disabled = false; return; }
      const nick = String(PROF.me() || "Игрок").slice(0, 40);
      const { error } = await sb.from("grids").insert({ name: name.slice(0, 60), nick, data });
      if (error){ const m2 = error.message || ""; b.querySelector("#grPE").textContent = /does not exist|schema cache/i.test(m2) ? "Мастерская ещё не включена на сервере." : /row-level security|JWT|auth/i.test(m2) ? "Войди в аккаунт заново и попробуй ещё раз." : /check constraint/i.test(m2) ? "Сетка слишком большая или название слишком длинное." : "Не получилось опубликовать: " + m2; b.querySelector("#grPG").disabled = false; return; }
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
