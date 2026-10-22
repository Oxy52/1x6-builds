/* Сетки героев Dota 2: редактор hero_grid_config.json, готовые сетки, мастерская, арт из картинки */
const GRIDS = (() => {
  const GW = 1200, GH = 600, TW = 50, TH = 66, GAP = 3, LBL = 20, LF = 13;
  const KEY = "ub-grid", esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ATTR = [["str", "Сила", "#e5533d"], ["agi", "Ловкость", "#3fbf5a"], ["int", "Интеллект", "#3d8fe5"], ["all", "Универсал", "#c99a3a"]];
  const ROLES = [["Carry", "Керри"], ["Support", "Поддержка"], ["Nuker", "Нюкеры"], ["Disabler", "Контроль"], ["Initiator", "Инициаторы"], ["Escape", "Мобильные"], ["Pusher", "Пушеры"], ["Durable", "Танки"]];
  let H = [], HB = {}, FILE = null, cur = 0, sel = -1, view = "edit", built = false, pane, stage, s = 1, pf = { q: "", a: "" };

  /* ---------- хранение ---------- */
  const blank = n => ({ config_name: n || "Моя сетка", categories: [] });
  function load(){ try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && Array.isArray(v.configs) && v.configs.length) { FILE = v; cur = Math.min(+v._cur || 0, v.configs.length - 1); return; } } catch(e) {} FILE = { version: 3, configs: [blank()] }; cur = 0; }
  let sT = 0; function save(){ clearTimeout(sT); sT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ ...FILE, _cur: cur })); } catch(e) {} }, 250); }
  const C = () => FILE.configs[cur];
  const clean = f => ({ version: 3, configs: f.configs.map(c => ({ config_name: String(c.config_name || "Сетка"), categories: (c.categories || []).map(k => ({ category_name: String(k.category_name || ""), x_position: +(+k.x_position || 0).toFixed(1), y_position: +(+k.y_position || 0).toFixed(1), width: +(+k.width || 0).toFixed(1), height: +(+k.height || 0).toFixed(1), hero_ids: (k.hero_ids || []).map(Number).filter(Boolean) })) })) });

  /* ---------- герои ---------- */
  async function heroes(){
    if (H.length) return H;
    const list = await D2.loadHeroes();
    H = (list || []).map(h => ({ id: +h.id, n: h.localized_name, a: h.primary_attr, r: h.roles || [], img: D2.img(h.img), wr: (+h.pub_win || 0) / Math.max(1, +h.pub_pick || 0), pick: +h.pub_pick || 0 })).sort((x, y) => x.n.localeCompare(y.n));
    HB = Object.fromEntries(H.map(h => [h.id, h])); return H;
  }

  /* ---------- раскладка шаблонов ---------- */
  function stack(groups, cols){
    cols = cols || 1; const cw = (GW - (cols - 1) * 12) / cols, per = Math.max(1, Math.floor((cw + GAP) / (TW + GAP))); const out = [], ys = Array(cols).fill(0);
    groups.forEach(g => { const c = ys.indexOf(Math.min(...ys)), rows = Math.max(g.rows || 1, Math.ceil(g.ids.length / per)), h = rows * (TH + GAP) + 4;
      out.push({ category_name: g.name, x_position: c * (cw + 12), y_position: ys[c] + LBL, width: cw, height: h, hero_ids: g.ids }); ys[c] += h + LBL + 10; });
    return out;
  }
  const PRESETS = [
    { k: "attr", n: "По атрибутам", d: "Сила, ловкость, интеллект и универсалы — как в обычной Доте", f: () => stack(ATTR.map(a => ({ name: a[1], ids: H.filter(h => h.a === a[0]).map(h => h.id) }))) },
    { k: "roles", n: "По ролям", d: "Керри, саппорты, инициаторы, нюкеры — герой может быть в нескольких", f: () => stack(ROLES.map(r => ({ name: r[1], ids: H.filter(h => h.r.includes(r[0])).map(h => h.id) })), 2) },
    { k: "meta", n: "Мета по винрейту", d: "Сильные сейчас, средние и слабые — по свежей статистике публичных матчей", f: () => { const by = [...H].filter(h => h.pick > 0).sort((a, b) => b.wr - a.wr); return stack([["Сильные (52%+)", h => h.wr >= .52], ["Средние", h => h.wr >= .49 && h.wr < .52], ["Слабые (<49%)", h => h.wr < .49]].map(([n, t]) => ({ name: n, ids: by.filter(t).map(h => h.id) }))); } },
    { k: "pos", n: "Позиции 1–5", d: "Заготовка под пики: пять пустых линий и избранное — перетащи своих героев", f: () => stack(["Позиция 1 — керри", "Позиция 2 — мид", "Позиция 3 — оффлейн", "Позиция 4 — роумер", "Позиция 5 — саппорт", "Избранное"].map(n => ({ name: n, ids: [], rows: 2 })), 2) },
    { k: "abc", n: "По алфавиту", d: "Все герои A–Z одним блоком", f: () => stack([{ name: "Все герои", ids: H.map(h => h.id) }]) }
  ];

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
          <button type="button" class="gr-b" id="grImp">⤓ Импорт</button><button type="button" class="gr-b" id="grArt">🖼 Арт из картинки</button><button type="button" class="gr-b" id="grLink">🔗 Ссылка</button><button type="button" class="gr-b" id="grPub">📤 В мастерскую</button><button type="button" class="gr-b gr-main" id="grDl">⬇ Скачать файл</button>
        </div>
        <div class="gr-tpl"><span>Шаблоны:</span>${PRESETS.map(p => `<button type="button" class="rkc" data-tp="${p.k}" title="${esc(p.d)}">${esc(p.n)}</button>`).join("")}<button type="button" class="rkc" data-tp="clear">Очистить</button></div>
        <div class="gr-wrap">
          <div class="gr-left">
            <div class="gr-stage" id="grStage" tabindex="0" aria-label="Сетка героев"><div class="gr-cv" id="grCv"></div></div>
            <div class="gr-tools"><button type="button" class="gr-b" id="grAdd">＋ Категория</button><span class="gr-hint">Перетаскивай категории и героев. Клик по герою в списке — добавить в выбранную категорию, двойной клик по герою в сетке — убрать. Угол справа снизу — размер.</span></div>
            <div class="gr-insp" id="grInsp"></div>
          </div>
          <div class="gr-pal">
            <label class="d2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="grQ" placeholder="Найти героя" autocomplete="off"></label>
            <div class="gr-af">${[["", "Все"], ...ATTR.map(a => [a[0], a[1]])].map(a => `<button type="button" class="rkc" data-af="${a[0]}" aria-pressed="${a[0] === ""}">${a[1]}</button>`).join("")}</div>
            <div class="gr-ph" id="grPh"><div class="feed-sk"></div></div>
          </div>
        </div>`;
      stage = el.querySelector("#grStage");
      el.querySelector("#grCfg").onchange = e => { cur = +e.target.value; sel = -1; save(); draw(); };
      el.querySelector("#grCfgN").oninput = e => { C().config_name = e.target.value || "Сетка"; save(); cfgList(); };
      el.querySelector("#grNew").onclick = () => { FILE.configs.push(blank("Сетка " + (FILE.configs.length + 1))); cur = FILE.configs.length - 1; sel = -1; save(); draw(); };
      el.querySelector("#grDelC").onclick = () => { if (!confirmIn(el.querySelector("#grDelC"), "Точно удалить?")) return; FILE.configs.splice(cur, 1); if (!FILE.configs.length) FILE.configs.push(blank()); cur = Math.max(0, cur - 1); sel = -1; save(); draw(); };
      el.querySelector("#grAdd").onclick = () => addCat();
      el.querySelector("#grDl").onclick = download;
      el.querySelector("#grImp").onclick = importer;
      el.querySelector("#grArt").onclick = artist;
      el.querySelector("#grLink").onclick = shareLink;
      el.querySelector("#grPub").onclick = publish;
      el.querySelectorAll("[data-tp]").forEach(b => b.onclick = async () => { await heroes(); if (b.dataset.tp === "clear"){ if (!confirmIn(b, "Точно?")) return; C().categories = []; }
        else { const p = PRESETS.find(x => x.k === b.dataset.tp); C().categories = p.f(); if (C().config_name.startsWith("Моя сетка") || C().config_name.startsWith("Сетка")) C().config_name = p.n; } sel = -1; save(); draw(); });
      el.querySelector("#grQ").oninput = e => { pf.q = e.target.value.trim().toLowerCase(); palette(); };
      el.querySelectorAll("[data-af]").forEach(b => b.onclick = () => { pf.a = b.dataset.af; el.querySelectorAll("[data-af]").forEach(x => x.setAttribute("aria-pressed", x === b)); palette(); });
      stage.addEventListener("pointerdown", onDown);
      stage.addEventListener("dblclick", e => { const t = e.target.closest(".gr-t"); if (t){ const k = +t.closest(".gr-cat").dataset.i; C().categories[k].hero_ids.splice(+t.dataset.n, 1); save(); draw(); } });
      stage.addEventListener("keydown", e => { if (sel < 0) return; const k = C().categories[sel], st = e.shiftKey ? 10 : 1;
        if (e.key === "Delete" || e.key === "Backspace"){ if (e.target.tagName === "INPUT") return; C().categories.splice(sel, 1); sel = -1; save(); draw(); e.preventDefault(); }
        const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key]; if (mv){ k.x_position += mv[0]; k.y_position += mv[1]; save(); draw(); e.preventDefault(); } });
      new ResizeObserver(() => draw(true)).observe(stage);
      heroes().then(() => { palette(); draw(); }).catch(() => { document.getElementById("grPh").innerHTML = `<div class="gempty">Не удалось загрузить героев. Попробуй позже.</div>`; });
    }
    draw();
  }
  function confirmIn(b, t){ if (b.dataset.sure === "1"){ b.dataset.sure = ""; b.textContent = b.dataset.txt; return true; } b.dataset.txt = b.textContent; b.dataset.sure = "1"; b.textContent = t; setTimeout(() => { if (b.dataset.sure === "1"){ b.dataset.sure = ""; b.textContent = b.dataset.txt; } }, 2500); return false; }
  function cfgList(){ const sc = document.getElementById("grCfg"); if (!sc) return; sc.innerHTML = FILE.configs.map((c, i) => `<option value="${i}"${i === cur ? " selected" : ""}>${esc(c.config_name)}</option>`).join(""); }
  function addCat(){ const cs = C().categories, y = cs.reduce((m, k) => Math.max(m, k.y_position + k.height), 0); cs.push({ category_name: "Новая категория", x_position: 0, y_position: Math.min(y + LBL + 8, 2000), width: 4 * (TW + GAP) + 4, height: TH + GAP + 4, hero_ids: [] }); sel = cs.length - 1; save(); draw(); stage.focus({ preventScroll: true }); }

  function draw(soft){
    if (!stage || !FILE) return; const cv = document.getElementById("grCv"), cs = C().categories;
    s = stage.clientWidth / GW; const bottom = cs.reduce((m, k) => Math.max(m, k.y_position + k.height), 0);
    cv.style.height = Math.max(GH, bottom + 30) * s + "px"; stage.style.setProperty("--s", s);
    if (!soft){ cfgList(); const n = document.getElementById("grCfgN"); if (n && document.activeElement !== n) n.value = C().config_name; }
    const big = cs.length > 400;
    cv.innerHTML = cs.map((k, i) => { const art = !k.hero_ids.length && k.height < TH / 2;
      return `<div class="gr-cat${i === sel ? " on" : ""}${art ? " art" : ""}" data-i="${i}" style="left:${k.x_position * s}px;top:${k.y_position * s}px;width:${k.width * s}px;height:${k.height * s}px">
        <div class="gr-lb" style="font-size:${LF * s}px">${esc(k.category_name)}</div>
        ${big ? "" : `<div class="gr-ts">${k.hero_ids.map((id, n) => { const h = HB[id]; return `<i class="gr-t" data-n="${n}" data-id="${id}" title="${esc(h ? h.n : id)}" style="width:${TW * s}px;height:${TH * s}px;margin:0 ${GAP * s}px ${GAP * s}px 0">${h ? `<img alt="" src="${esc(h.img)}" loading="lazy" draggable="false">` : ""}</i>`; }).join("")}</div>`}
        ${i === sel ? `<b class="gr-rs" title="Размер"></b>` : ""}</div>`; }).join("");
    if (!soft){ insp(); palMarks(); }
  }
  function insp(){
    const el = document.getElementById("grInsp"); if (!el) return; const k = C().categories[sel];
    const tot = C().categories.length, uniq = new Set(C().categories.flatMap(x => x.hero_ids)).size;
    if (!k){ el.innerHTML = `<div class="gr-stat">Категорий: <b>${tot}</b> · героев расставлено: <b>${uniq}</b>${H.length ? ` из ${H.length}` : ""}</div>`; return; }
    el.innerHTML = `<div class="gr-row"><input id="grN" maxlength="60" value="${esc(k.category_name)}" placeholder="Название категории" aria-label="Название категории">
      ${["x_position|X", "y_position|Y", "width|Ш", "height|В"].map(f => { const [p, l] = f.split("|"); return `<label class="gr-num">${l}<input type="number" data-f="${p}" value="${Math.round(k[p])}"></label>`; }).join("")}
      <button type="button" class="gr-b" id="grFit" title="Подогнать высоту под героев">↕ Подогнать</button><button type="button" class="gr-b" id="grDup">⧉ Копия</button><button type="button" class="gr-b" id="grClr">Убрать героев</button><button type="button" class="gr-b gr-red" id="grDel">Удалить</button></div>
      <div class="gr-stat">Героев в категории: <b>${k.hero_ids.length}</b> · всего категорий: ${tot}</div>`;
    el.querySelector("#grN").oninput = e => { k.category_name = e.target.value; save(); draw(true); };
    el.querySelectorAll("[data-f]").forEach(i => i.oninput = () => { const v = +i.value; if (!isNaN(v)){ k[i.dataset.f] = Math.max(i.dataset.f.startsWith("w") || i.dataset.f.startsWith("h") ? 10 : -50, v); save(); draw(true); } });
    el.querySelector("#grFit").onclick = () => { const per = Math.max(1, Math.floor((k.width - 4 + GAP) / (TW + GAP))); k.height = Math.max(1, Math.ceil(k.hero_ids.length / per)) * (TH + GAP) + 4; save(); draw(); };
    el.querySelector("#grDup").onclick = () => { C().categories.push({ ...k, hero_ids: [...k.hero_ids], x_position: k.x_position + 20, y_position: k.y_position + 20 }); sel = C().categories.length - 1; save(); draw(); };
    el.querySelector("#grClr").onclick = () => { k.hero_ids = []; save(); draw(); };
    el.querySelector("#grDel").onclick = () => { C().categories.splice(sel, 1); sel = -1; save(); draw(); };
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
    const rs = e.target.closest(".gr-rs"), t = e.target.closest(".gr-t"), p = e.target.closest(".gr-p"), cat = e.target.closest(".gr-cat");
    if (p){ D = { kind: "hero", id: +p.dataset.id, from: null, x0: e.clientX, y0: e.clientY, moved: false }; }
    else if (t){ D = { kind: "hero", id: +t.dataset.id, from: [+cat.dataset.i, +t.dataset.n], x0: e.clientX, y0: e.clientY, moved: false }; }
    else if (rs){ const k = C().categories[sel]; D = { kind: "rs", k, w0: k.width, h0: k.height, x0: e.clientX, y0: e.clientY }; }
    else if (cat){ const i = +cat.dataset.i; if (sel !== i){ sel = i; draw(); } const k = C().categories[i]; D = { kind: "mv", k, kx: k.x_position, ky: k.y_position, x0: e.clientX, y0: e.clientY }; }
    else { if (sel !== -1){ sel = -1; draw(); } return; }
    e.preventDefault(); stage.focus({ preventScroll: true });
    addEventListener("pointermove", onMove); addEventListener("pointerup", onUp, { once: true });
  }
  const snap = v => Math.round(v);
  function onMove(e){
    if (!D) return; const dx = (e.clientX - D.x0) / s, dy = (e.clientY - D.y0) / s;
    if (D.kind === "mv"){ D.k.x_position = snap(D.kx + dx); D.k.y_position = snap(D.ky + dy); const el = stage.querySelector(`.gr-cat[data-i="${sel}"]`); if (el){ el.style.left = D.k.x_position * s + "px"; el.style.top = D.k.y_position * s + "px"; } }
    else if (D.kind === "rs"){ D.k.width = Math.max(TW + 8, snap(D.w0 + dx)); D.k.height = Math.max(8, snap(D.h0 + dy)); draw(true); }
    else if (D.kind === "hero"){
      if (!D.moved && Math.hypot(e.clientX - D.x0, e.clientY - D.y0) < 6) return;
      if (!D.moved){ D.moved = true; const h = HB[D.id]; D.g = document.createElement("div"); D.g.className = "gr-ghost"; D.g.innerHTML = h ? `<img alt="" src="${esc(h.img)}">` : ""; document.body.appendChild(D.g); }
      D.g.style.transform = `translate(${e.clientX - 25}px, ${e.clientY - 33}px)`;
      stage.querySelectorAll(".gr-cat.drop").forEach(x => x.classList.remove("drop")); const c = catAt(e); if (c) c.classList.add("drop");
    }
  }
  function catAt(e){ const els = document.elementsFromPoint(e.clientX, e.clientY); const c = els.find(x => x.classList && x.classList.contains("gr-cat")); return c || null; }
  function onUp(e){
    removeEventListener("pointermove", onMove); const d = D; D = null; if (!d) return;
    if (d.kind === "hero"){
      if (d.g) d.g.remove(); stage.querySelectorAll(".gr-cat.drop").forEach(x => x.classList.remove("drop"));
      const cs = C().categories;
      if (!d.moved){ if (!d.from){ if (sel < 0){ if (!cs.length) addCat(); else sel = cs.length - 1; } const k = cs[sel], at = k.hero_ids.indexOf(d.id); if (at >= 0) k.hero_ids.splice(at, 1); else k.hero_ids.push(d.id); save(); draw(); } return; }
      const c = catAt(e), ti = (document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList && x.classList.contains("gr-t")) || null);
      if (d.from) cs[d.from[0]].hero_ids.splice(d.from[1], 1);
      if (c){ const k = cs[+c.dataset.i]; let pos = k.hero_ids.length;
        if (ti && ti.closest(".gr-cat") === c){ pos = +ti.dataset.n; if (d.from && d.from[0] === +c.dataset.i && d.from[1] < pos) pos--; const r = ti.getBoundingClientRect(); if (e.clientX > r.left + r.width / 2) pos++; }
        const ex = k.hero_ids.indexOf(d.id); if (ex >= 0){ k.hero_ids.splice(ex, 1); if (ex < pos) pos--; }
        k.hero_ids.splice(Math.max(0, pos), 0, d.id); sel = +c.dataset.i; }
      save(); draw();
    } else { save(); draw(); }
  }

  /* ---------- файл ---------- */
  function fileText(f){ return JSON.stringify(clean(f || FILE), null, "\t"); }
  function download(){ const b = new Blob([fileText()], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "hero_grid_config.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    PROF.toast(`Файл скачан. Положи его в папку Steam → userdata → <b>твой ID</b> → 570 → remote → cfg (с заменой) при закрытой Доте. <a href="#" id="grHowT">Подробнее</a>`, "", 7000);
    setTimeout(() => { const l = document.getElementById("grHowT"); if (l) l.onclick = ev => { ev.preventDefault(); go("help"); }; }, 50); }
  function parse(txt){ const v = JSON.parse(txt); if (v && Array.isArray(v.configs)) return v; if (v && Array.isArray(v.categories)) return { version: 3, configs: [v] }; throw new Error("bad"); }
  function modal(html){ const m = document.createElement("div"); m.className = "gr-mod"; m.innerHTML = `<div class="gr-box" role="dialog" aria-modal="true"><button type="button" class="gr-x" aria-label="Закрыть">✕</button>${html}</div>`; document.body.appendChild(m);
    const close = () => m.remove(); m.querySelector(".gr-x").onclick = close; m.onclick = e => { if (e.target === m) close(); }; addEventListener("keydown", function k(e){ if (e.key === "Escape"){ close(); removeEventListener("keydown", k); } }); return [m.querySelector(".gr-box"), close]; }
  function importer(){
    const [b, close] = modal(`<h3>Импорт сетки</h3><p class="gr-mut">Выбери свой <b>hero_grid_config.json</b> из папки Доты или вставь текст файла. Все сетки из файла добавятся в редактор — при скачивании они сохранятся вместе с новой.</p>
      <label class="btn btn-ghost gr-file">📂 Выбрать файл<input type="file" accept=".json,application/json" hidden></label><textarea id="grTx" rows="7" placeholder='{"version":3,"configs":[...]}'></textarea>
      <div class="gr-acts"><label class="gr-chk"><input type="checkbox" id="grRep"> Заменить всё, что есть в редакторе</label><button type="button" class="btn btn-primary" id="grGo">Импортировать</button></div><div class="gr-err" id="grErr"></div>`);
    const go2 = txt => { try { const f = parse(txt); const add = clean(f).configs; if (b.querySelector("#grRep").checked) { FILE.configs = add; cur = 0; } else { FILE.configs.push(...add); cur = FILE.configs.length - add.length; } sel = -1; save(); draw(); close(); PROF.toast(`Добавлено сеток: <b>${add.length}</b>`); } catch(e) { b.querySelector("#grErr").textContent = "Это не похоже на файл сетки Доты (hero_grid_config.json)."; } };
    b.querySelector("input[type=file]").onchange = e => { const f = e.target.files[0]; if (f) f.text().then(go2); };
    b.querySelector("#grGo").onclick = () => go2(b.querySelector("#grTx").value);
  }

  /* ---------- ссылка ---------- */
  const b64 = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  async function pack(obj){ const data = new TextEncoder().encode(JSON.stringify(obj)); if (!window.CompressionStream) return "j" + b64(data);
    const cs = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw")); return "z" + b64(new Uint8Array(await new Response(cs).arrayBuffer())); }
  async function unpack(str){ const raw = unb64(str.slice(1)); if (str[0] === "j") return JSON.parse(new TextDecoder().decode(raw));
    const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")); return JSON.parse(await new Response(ds).text()); }
  async function shareLink(){
    const one = clean({ configs: [C()] }).configs[0]; const code = await pack(one), url = `${location.origin}/?grid=${code}#grids`;
    if (url.length > 60000){ PROF.toast("Сетка слишком большая для ссылки — скачай файл или опубликуй в мастерской."); return; }
    try { await navigator.clipboard.writeText(url); PROF.toast("Ссылка на сетку скопирована 🔗"); } catch(e) { modal(`<h3>Ссылка на сетку</h3><textarea rows="4" readonly>${esc(url)}</textarea>`); }
  }
  async function fromLink(){ const q = new URLSearchParams(location.search).get("grid"); if (!q) return false;
    try { const c = await unpack(q); const f = clean({ configs: [c] }); FILE.configs.push(f.configs[0]); cur = FILE.configs.length - 1; sel = -1; save(); PROF.toast(`Сетка «${esc(f.configs[0].config_name)}» добавлена в редактор`); } catch(e) {}
    try { const u = new URL(location.href); u.searchParams.delete("grid"); history.replaceState(null, "", u.pathname + u.search + "#grids"); } catch(e) {}
    return true; }

  /* ---------- арт из картинки ---------- */
  const SETS = { ascii: " .:-=+*#%@", blocks: " ░▒▓█", dots: " ·•●" };
  function artist(){
    const [b, close] = modal(`<h3>Арт из картинки</h3><p class="gr-mut">Картинка превращается в рисунок из символов — каждая буква становится отдельной пустой категорией, как в арт-сетках. Лучше всего выходят контрастные картинки и силуэты.</p>
      <label class="btn btn-ghost gr-file">📂 Выбрать картинку<input type="file" accept="image/*" hidden></label>
      <div class="gr-arow"><label>Ширина, символов <input type="range" id="grW" min="30" max="140" value="80"><b id="grWv">80</b></label>
      <label>Символы <select id="grSet"><option value="ascii">ASCII  .:-=+*#%@</option><option value="blocks">Блоки ░▒▓█</option><option value="dots">Точки ·•●</option></select></label>
      <label class="gr-chk"><input type="checkbox" id="grInv"> Инвертировать</label><label>Контраст <input type="range" id="grCt" min="50" max="250" value="120"></label></div>
      <pre class="gr-pre" id="grPre">Выбери картинку…</pre><div class="gr-acts"><span class="gr-mut" id="grCnt"></span><label class="gr-chk"><input type="checkbox" id="grKeep" checked> Оставить героев (арт сверху)</label><button type="button" class="btn btn-primary" id="grAG" disabled>Добавить в сетку</button></div>`);
    let img = null, rows = [];
    const render = () => { if (!img) return; const W = +b.querySelector("#grW").value; b.querySelector("#grWv").textContent = W;
      const ch = SETS[b.querySelector("#grSet").value], inv = b.querySelector("#grInv").checked, ct = +b.querySelector("#grCt").value / 100;
      const Hh = Math.max(1, Math.round(W * img.height / img.width * .5)), c = document.createElement("canvas"); c.width = W; c.height = Hh; const g = c.getContext("2d"); g.drawImage(img, 0, 0, W, Hh);
      const d = g.getImageData(0, 0, W, Hh).data; rows = [];
      for (let y = 0; y < Hh; y++){ let r = ""; for (let x = 0; x < W; x++){ const i = (y * W + x) * 4, a = d[i + 3] / 255; let v = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) / 255; v = a * v + (1 - a) * 0; v = Math.min(1, Math.max(0, (v - .5) * ct + .5)); if (inv) v = 1 - v; r += ch[Math.min(ch.length - 1, Math.floor(v * ch.length))]; } rows.push(r); }
      b.querySelector("#grPre").textContent = rows.join("\n"); const n = rows.join("").replace(/ /g, "").length; b.querySelector("#grCnt").textContent = `Символов: ${n}${n > 3000 ? " — многовато, Дота может подтормаживать" : ""}`; b.querySelector("#grAG").disabled = !n; };
    b.querySelector("input[type=file]").onchange = e => { const f = e.target.files[0]; if (!f) return; const u = URL.createObjectURL(f); img = new Image(); img.onload = render; img.src = u; };
    ["#grW", "#grSet", "#grInv", "#grCt"].forEach(q => b.querySelector(q).oninput = render);
    b.querySelector("#grAG").onclick = () => { const W = rows[0].length, cw = GW / W, chh = cw * 2, cats = [];
      rows.forEach((r, y) => [...r].forEach((c, x) => { if (c !== " ") cats.push({ category_name: c, x_position: +(x * cw).toFixed(1), y_position: +(y * chh).toFixed(1), width: +cw.toFixed(1), height: +(chh * .9).toFixed(1), hero_ids: [] }); }));
      if (!b.querySelector("#grKeep").checked) C().categories = []; C().categories.push(...cats); sel = -1; save(); draw(); close(); PROF.toast(`Арт добавлен: <b>${cats.length}</b> категорий`); };
  }

  /* ---------- мастерская ---------- */
  const SBT = () => (PROF.rt && PROF.rt()) || null;
  let shopSort = "new", shopQ = "";
  function thumb(cfg){
    const c = document.createElement("canvas"), W = 360, sc = W / GW, cs = cfg.categories || [], bot = Math.max(GH, cs.reduce((m, k) => Math.max(m, k.y_position + k.height), 0)); c.width = W; c.height = Math.min(260, Math.round(bot * sc));
    const g = c.getContext("2d"); g.fillStyle = "#0d0d12"; g.fillRect(0, 0, c.width, c.height);
    cs.forEach(k => { const x = k.x_position * sc, y = k.y_position * sc, w = k.width * sc, h = k.height * sc;
      if (!k.hero_ids.length && k.height >= TH / 2){ g.strokeStyle = "rgba(255,255,255,.18)"; g.strokeRect(x, y, w, h); g.fillStyle = "rgba(255,255,255,.6)"; g.font = `${Math.max(5, LF * sc)}px sans-serif`; g.fillText(k.category_name.slice(0, 30), x, y - 3); return; }
      if (!k.hero_ids.length){ g.fillStyle = "rgba(255,255,255,.85)"; g.font = `${Math.max(3, LF * sc)}px monospace`; g.fillText(k.category_name.slice(0, 40), x, y + LF * sc * .8); return; }
      g.fillStyle = "rgba(255,255,255,.55)"; g.font = `${Math.max(5, LF * sc)}px sans-serif`; g.fillText(k.category_name.slice(0, 30), x, y - 3);
      const per = Math.max(1, Math.floor((k.width + GAP) / (TW + GAP))); k.hero_ids.forEach((id, n) => { const h = HB[id], a = ATTR.find(z => h && z[0] === h.a); g.fillStyle = a ? a[2] : "#666"; g.globalAlpha = .75; g.fillRect(x + (n % per) * (TW + GAP) * sc, y + Math.floor(n / per) * (TH + GAP) * sc, TW * sc, TH * sc); g.globalAlpha = 1; }); });
    return c.toDataURL("image/png");
  }
  async function shop(){
    const el = document.getElementById("grShop"); await heroes().catch(() => {});
    el.innerHTML = `<div class="gr-shead"><div class="rkchips">${[["new", "Новые"], ["top", "Популярные"]].map(x => `<button type="button" class="rkc" data-ss="${x[0]}" aria-pressed="${x[0] === shopSort}">${x[1]}</button>`).join("")}</div>
      <label class="d2-search gr-sq"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="grSQ" placeholder="Название или автор" value="${esc(shopQ)}"></label></div>
      <h3 class="gr-h3">Готовые от Aegis</h3><div class="gr-cards">${PRESETS.map(p => card({ name: p.n, nick: "Aegis", d: p.d, data: { config_name: p.n, categories: H.length ? p.f() : [] }, preset: p.k })).join("")}</div>
      <h3 class="gr-h3">Сетки игроков</h3><div class="gr-cards" id="grUsr"><div class="feed-sk"></div><div class="feed-sk"></div></div>`;
    el.querySelectorAll("[data-ss]").forEach(b => b.onclick = () => { shopSort = b.dataset.ss; shop(); });
    let qt = 0; el.querySelector("#grSQ").oninput = e => { clearTimeout(qt); qt = setTimeout(() => { shopQ = e.target.value.trim(); users(); }, 300); };
    bindCards(el.querySelectorAll(".gr-cards")[0], PRESETS.map(p => ({ name: p.n, data: { config_name: p.n, categories: p.f() } })));
    users();
  }
  function card(g){ return `<div class="gr-card"><div class="gr-th"><img alt="" src="${thumb(g.data)}"></div><div class="gr-ci"><b>${esc(g.name)}</b><small>${esc(g.nick || "")}${g.d ? " · " + esc(g.d) : ""}</small>
    <small class="gr-meta">Категорий: ${(g.data.categories || []).length}${g.likes != null ? ` · ❤ ${g.likes} · ⬇ ${g.downloads || 0}` : ""}</small>
    <div class="gr-ca"><button type="button" class="gr-b" data-a="open">✏ В редактор</button><button type="button" class="gr-b" data-a="dl">⬇ Файл</button>${g.id ? `<button type="button" class="gr-b" data-a="like">❤</button>` : ""}${g.mine ? `<button type="button" class="gr-b gr-red" data-a="del">Удалить</button>` : ""}</div></div></div>`; }
  function bindCards(box, list){
    box.querySelectorAll(".gr-card").forEach((c, i) => c.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { const g = list[i], a = b.dataset.a, sb = SBT();
      if (a === "open"){ FILE.configs.push(clean({ configs: [{ ...g.data, config_name: g.name }] }).configs[0]); cur = FILE.configs.length - 1; sel = -1; save(); go("edit"); PROF.toast(`«${esc(g.name)}» открыта в редакторе`); if (g.id && sb) sb.rpc("grid_dl", { gid: g.id }).then(() => {}, () => {}); }
      if (a === "dl"){ const f = { version: 3, configs: [{ ...g.data, config_name: g.name }] }, bl = new Blob([fileText(f)], { type: "application/json" }), x = document.createElement("a"); x.href = URL.createObjectURL(bl); x.download = "hero_grid_config.json"; x.click(); if (g.id && sb) sb.rpc("grid_dl", { gid: g.id }).then(() => {}, () => {}); }
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
      <p class="gr-mut">Не появилась? Проверь, что в Steam выключена облачная синхронизация для Dota 2 на время замены (Свойства → Общие → Steam Cloud), и что файл называется ровно <code>hero_grid_config.json</code>.</p></div>`;
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
