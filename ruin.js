/* «Кто заруинил?» — разбор проигранного матча Dota 2: кто сильнее всех потянул команду вниз.
   Данные — открытая статистика OpenDota через наш /api/dota (кеш на Vercel). Оценка — подсказка, а не приговор. */
const RUIN = (() => {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const mmss = t => { t = Math.max(0, Math.round(+t || 0)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
  const k1 = v => v >= 10000 ? (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(".0", "") + "k" : String(Math.round(v || 0));
  const pct = v => Math.round((v || 0) * 100) + "%";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let built = false, box, out, HS = [], HB = {}, cur = null, poll = 0, fieldStop = null, rot = 0;

  /* ---------- герои ---------- */
  async function heroes(){ if (HS.length) return; HS = (await D2.loadHeroes()) || []; HB = Object.fromEntries(HS.map(h => [h.id, h])); }
  const site = h => h && typeof HEROES !== "undefined" ? HEROES.find(x => norm(x.en) === norm(h.localized_name)) : null;
  const hname = id => { const h = HB[id]; if (!h) return "Герой #" + id; const s = site(h); return s ? s.ru : h.localized_name; };
  const hicon = id => { const h = HB[id]; return h ? D2.img(h.icon || h.img) : ""; };
  const himg = id => { const h = HB[id]; return h ? D2.img(h.img) : ""; };
  const hbust = id => { const s = site(HB[id]); return s ? `/bg/hd2/${s.slug}.webp` : himg(id); };
  const short = id => { const h = HB[id]; return h ? String(h.name || "").replace("npc_dota_hero_", "") : ""; };

  /* ---------- ввод: матч, профиль или ссылка ---------- */
  function parseInput(v){
    v = String(v || "").trim(); let m;
    if ((m = /(?:dotabuff\.com|opendota\.com|stratz\.com)\/matches\/(\d+)/i.exec(v))) return { match: m[1] };
    if ((m = /(?:dotabuff\.com|opendota\.com|stratz\.com)\/players\/(\d+)/i.exec(v))) return { player: m[1] };
    if ((m = /steamcommunity\.com\/profiles\/(\d{17})/i.exec(v))) return { player: String(BigInt(m[1]) - 76561197960265728n) };
    if (/steamcommunity\.com\/id\//i.test(v)) return { err: "Ссылка вида steamcommunity.com/id/… не подходит — открой профиль на Dotabuff или OpenDota и вставь ссылку оттуда, или вставь номер матча." };
    if (/^\d{17}$/.test(v)) return { player: String(BigInt(v) - 76561197960265728n) };
    if (/^\d{1,12}$/.test(v)) return +v > 4294967295 ? { match: v } : { player: v, maybeMatch: v };
    return { err: "Вставь номер матча (например 8012345678) или ссылку на матч / профиль с Dotabuff или OpenDota." };
  }
  const api = (q, id, bust) => fetch(`/api/dota?q=${q}&id=${id}${bust ? "&t=" + Date.now() : ""}`).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });

  /* ---------- разметка ---------- */
  function shell(){
    box.innerHTML = `<div class="ru-hero" id="ruHero">
        <canvas class="ru-f" aria-hidden="true"></canvas><img class="ru-art" alt="" aria-hidden="true"><img class="ru-art" alt="" aria-hidden="true">
        <div class="ru-in">
          <span class="ru-tag">Разбор матча</span>
          <h2>Кто заруинил?</h2>
          <p>Вставь номер проигранного матча — посчитаем, кто сильнее всех потянул команду вниз: фарм, смерти, участие в драках, урон и ключевые моменты.</p>
          <form class="ru-form" id="ruForm"><input id="ruQ" inputmode="numeric" autocomplete="off" placeholder="Номер матча или ссылка на профиль" aria-label="Номер матча или ссылка на профиль"><button type="submit" class="btn btn-primary">Анализировать</button></form>
          <small class="ru-hint">Номер матча — в Доте: Профиль → Последние матчи → матч, цифры вверху. Вставишь ссылку на профиль Dotabuff/OpenDota — покажем последние игры. В настройках Доты должна быть включена «Общедоступная история матчей».</small>
        </div>
      </div>
      <div id="ruOut" class="ru-out"></div>`;
    out = box.querySelector("#ruOut");
    box.querySelector("#ruForm").onsubmit = e => { e.preventDefault(); go(box.querySelector("#ruQ").value); };
    field(box.querySelector(".ru-f"));
    rotate();
  }
  // фон шапки — как на главной: пиксельное поле с искрами и большой герой, сменяется раз в 5 секунд
  function field(cv){
    const g = cv.getContext("2d"), still = matchMedia("(prefers-reduced-motion: reduce)").matches; let W = 0, H = 0, t = 0, sp = [], raf = 0, last = 0, col = [232, 86, 74];
    const spawn = any => ({ x: Math.floor(Math.random() * W / 4) * 4, y: any ? Math.random() * H : H + 8, s: 2 + Math.floor(Math.random() * 3) * 2, v: .3 + Math.random() * .7, p: Math.random() * 6.3, gold: Math.random() < .3 });
    const size = () => { const d = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; if (!W || !H) return; cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); sp = Array.from({ length: Math.round(W * H / 6000) }, () => spawn(true)); };
    const frame = () => { g.clearRect(0, 0, W, H); const [r, gg, b] = col, C = 14;
      for (let y = 0; y < Math.ceil(H / C); y++) for (let x = 0; x < Math.ceil(W / C); x++){ const w = Math.sin(x * .2 + t * .9) * Math.cos(y * .27 - t * .6) + Math.sin((x + y) * .1 - t * .4), a = Math.max(0, w) * .2 + .045 + (x / (W / C)) * .05; if (a < .06) continue; g.fillStyle = `rgba(${r},${gg},${b},${a.toFixed(3)})`; g.fillRect(x * C + 5, y * C + 5, 4, 4); }
      for (const q of sp){ q.y -= q.v; q.p += .08; if (q.y < -10) Object.assign(q, spawn(false)); const a = .45 + .4 * Math.sin(q.p); g.fillStyle = q.gold ? `rgba(243,195,90,${a.toFixed(3)})` : `rgba(${r},${gg},${b},${Math.min(1, a + .15).toFixed(3)})`; g.fillRect(q.x, Math.round(q.y / 2) * 2, q.s, q.s); } };
    const loop = ts => { raf = 0; if (!cv.isConnected || document.hidden || cv.closest("[hidden]")) return; if (ts - last > 33){ last = ts; t += .033; frame(); } raf = requestAnimationFrame(loop); };
    const go2 = () => { if (!raf && !still) raf = requestAnimationFrame(loop); };
    size(); frame(); go2(); new ResizeObserver(() => { size(); frame(); }).observe(cv); document.addEventListener("visibilitychange", go2);
    fieldStop = go2;
  }
  let artI = 0;
  function art(src, ruiner){
    const a = [...box.querySelectorAll(".ru-art")], nw = a[artI], old = a[1 - artI]; artI = 1 - artI;
    const im = new Image(); im.onload = () => { nw.src = src; nw.className = "ru-art on" + (ruiner ? " bad" : ""); old.className = "ru-art out"; }; im.src = src;
  }
  function rotate(){ clearInterval(rot); const pool = (typeof HEROES !== "undefined" ? HEROES : []).map(h => h.slug).sort(() => Math.random() - .5); let i = 0;
    const step = () => { if (!pool.length) return; art(`/bg/hd2/${pool[i++ % pool.length]}.webp`); }; step(); rot = setInterval(() => { if (!document.hidden && box.offsetParent) step(); }, 5000); }

  /* ---------- оценка ---------- */
  function analyze(m){
    const P = m.players.map((p, i) => ({ ...p, i, rad: p.player_slot < 128 })), lostRad = !m.rw;
    const team = r => P.filter(p => p.rad === r), L = team(lostRad), Wn = team(!lostRad);
    const prep = T => { const kills = T.reduce((a, p) => a + (p.kills || 0), 0), nw = T.reduce((a, p) => a + (p.net_worth || 0), 0), avgD = T.reduce((a, p) => a + (p.deaths || 0), 0) / Math.max(1, T.length);
      const byNw = [...T].sort((a, b) => (b.net_worth || 0) - (a.net_worth || 0));
      T.forEach(p => { p.core = byNw.indexOf(p) < 3; p.kp = ((p.kills || 0) + (p.assists || 0)) / Math.max(1, kills); p.nwShare = (p.net_worth || 0) / Math.max(1, nw); p.avgD = avgD;
        const b = p.bench || {}, keys = p.core ? ["gold_per_min", "xp_per_min", "hero_damage_per_min", "last_hits_per_min", "tower_damage", "kills_per_min"] : ["xp_per_min", "hero_damage_per_min", "kills_per_min", "gold_per_min"];
        const v = keys.map(k => b[k]).filter(x => x != null); p.perf = v.length ? v.reduce((a, x) => a + x, 0) / v.length : .5;
        const maxD = Math.max(6, avgD * 1.6), c1 = 1 - p.perf, c2 = Math.min(1, (p.deaths || 0) / maxD), c3 = 1 - Math.min(1, p.kp / .7);
        const c4 = p.core ? clamp(1 - p.nwShare / .25, 0, 1) : m.parsed ? 1 - Math.min(1, ((p.obs_placed || 0) + (p.sen_placed || 0)) / 12) : .3;
        p.c = [c1, c2, c3, c4]; p.harm = Math.round(100 * (.35 * c1 + .3 * c2 + .2 * c3 + .15 * c4)); }); return { kills, nw }; };
    const tl = prep(L), tw = prep(Wn);
    const rank = [...L].sort((a, b) => b.harm - a.harm), gap = rank[0].harm - (rank[1] ? rank[1].harm : 0);
    return { P, L, Wn, rank, conf: clamp(Math.round(55 + gap * 2.2), 51, 96), tl, tw, lostRad };
  }
  function why(p, m){
    const c = p.c, parts = [];
    const order = [0, 1, 2, 3].sort((a, b) => c[b] - c[a]);
    for (const k of order.slice(0, 2)){
      if (k === 0) parts.push(`сыграл хуже, чем ${pct(1 - p.perf)} игроков на этом герое`);
      if (k === 1) parts.push(`умер ${p.deaths} раз${p.deaths >= p.avgD * 1.3 ? " — больше всех в команде" : ""}`);
      if (k === 2) parts.push(`участвовал только в ${pct(p.kp)} убийств команды`);
      if (k === 3) parts.push(p.core ? `для кора слишком мало золота — ${pct(p.nwShare)} богатства команды` : `поставил всего ${(p.obs_placed || 0) + (p.sen_placed || 0)} вардов`);
    }
    return parts.join(", ") + ".";
  }
  function mistakes(p, m){
    const bad = [], good = [], b = p.bench || {}, dur = m.dur || 1;
    if ((p.deaths || 0) >= Math.max(7, p.avgD * 1.4)) bad.push(`Много смертей: ${p.deaths} (в среднем в команде ${p.avgD.toFixed(1)})`);
    if (p.kp < .45) bad.push(`Мало участия в драках: ${pct(p.kp)} убийств команды`);
    if (p.core && b.gold_per_min != null && b.gold_per_min < .35) bad.push(`Слабый фарм: GPM ${p.gold_per_min} — хуже, чем у ${pct(1 - b.gold_per_min)} игроков на этом герое`);
    if (b.hero_damage_per_min != null && b.hero_damage_per_min < .3) bad.push(`Мало урона по героям: ${k1(p.hero_damage)}`);
    if (p.core && (p.tower_damage || 0) < 800 && dur > 1500) bad.push(`Почти не бил строения: ${k1(p.tower_damage)} урона`);
    if (!p.core && m.parsed && (p.obs_placed || 0) + (p.sen_placed || 0) < 6 && dur > 1500) bad.push(`Мало вардов: ${p.obs_placed || 0} обсерверов и ${p.sen_placed || 0} сентри`);
    if (m.parsed && p.life_state_dead && p.life_state_dead / dur > .18) bad.push(`Провёл мёртвым ${pct(p.life_state_dead / dur)} игры`);
    if (p.kp >= .65) good.push(`Был почти во всех драках: ${pct(p.kp)}`);
    if (b.gold_per_min != null && b.gold_per_min >= .65) good.push(`Хороший фарм: GPM ${p.gold_per_min}`);
    if (b.hero_damage_per_min != null && b.hero_damage_per_min >= .65) good.push(`Много урона: ${k1(p.hero_damage)}`);
    if ((p.deaths || 0) <= 3) good.push(`Мало смертей: ${p.deaths}`);
    return { bad, good };
  }
  function moments(p, m, A){
    if (!m.parsed || !m.tf.length) return [];
    const out2 = [], mates = A.P.filter(x => x.rad === p.rad).map(x => x.i), foes = A.P.filter(x => x.rad !== p.rad), me = short(p.hero_id);
    m.tf.forEach(([st, en, , pl]) => { const s = pl[p.i]; if (!s) return; const td = mates.reduce((a, i) => a + ((pl[i] || [])[1] || 0), 0);
      if (s[0] > 0 && s[1] < td * .12) out2.push([st, -1, `Умер в драке и почти не нанёс урона (${k1(s[1])} из ${k1(td)} урона команды)`]);
      else if (s[0] > 0 && s[4] >= 1) out2.push([st, 1, `Умер, но забрал ${s[4]} ${s[4] === 1 ? "героя" : "героев"} и нанёс ${k1(s[1])} урона`]);
      else if (s[4] >= 2 || (td > 0 && s[1] >= td * .35 && s[1] > 2000)) out2.push([st, 1, `Сильная драка: ${s[4]} убийств, ${k1(s[1])} урона`]);
      else if (s[0] === 0 && s[1] === 0 && s[4] === 0 && td > 3000) out2.push([st, -1, `Команда дралась без него`]); });
    // смерти вне драк — по логам убийств врагов
    const inTf = t => m.tf.some(([st, en]) => t >= st - 6 && t <= en + 6);
    foes.forEach(f => (f.kl || []).forEach(([t, v]) => { if (v === me && !inTf(t)) out2.push([t, -1, `Умер вне драки — лёгкое золото врагу (${hname(f.hero_id)})`]); }));
    return out2.sort((a, b) => a[0] - b[0]).slice(0, 14);
  }

  /* ---------- вывод ---------- */
  const metric = (l, v) => `<div class="ru-m"><small>${l}</small><b>${v}</b></div>`;
  function card(p, m, A, main){
    const mk = mistakes(p, m), nm = p.personaname || "Аноним";
    return `<article class="ru-card${main ? " main" : ""}">
      <div class="ru-ch"><img class="ru-hi" alt="" src="${esc(main ? himg(p.hero_id) : hicon(p.hero_id))}"><div><span class="ru-lbl">${main ? "Главный руинер" : "Второе место"}</span><b translate="no">${esc(nm)}</b><small>${esc(hname(p.hero_id))} · ${p.core ? "кор" : "поддержка"}</small></div>
        <div class="ru-score"><b>${p.harm}</b><small>влияние на поражение</small></div></div>
      ${main ? `<p class="ru-why">По статистике сильнее всех потянул вниз: ${esc(why(p, m))} Уверенность модели — <b>${A.conf}%</b>.</p>` : ""}
      <div class="ru-ms">${metric("K / D / A", `${p.kills}/${p.deaths}/${p.assists}`)}${metric("GPM / XPM", `${p.gold_per_min} / ${p.xp_per_min}`)}${metric("Богатство", k1(p.net_worth))}${metric("Добито крипов", p.last_hits)}${metric("Участие в драках", pct(p.kp))}${metric("Урон по строениям", k1(p.tower_damage))}</div>
      ${mk.bad.length ? `<ul class="ru-l bad">${mk.bad.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${mk.good.length && main ? `<ul class="ru-l good">${mk.good.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </article>`;
  }
  function table(T, m, A, lost){
    const rows = (lost ? [...T].sort((a, b) => b.harm - a.harm) : T).map(p => `<tr${p.i === cur.me ? ' class="me"' : ""}><td class="ru-th"><img alt="" loading="lazy" src="${esc(hicon(p.hero_id))}"><span><b translate="no">${esc(p.personaname || "Аноним")}</b><small>${esc(hname(p.hero_id))}</small></span></td>
      <td>${p.kills}/${p.deaths}/${p.assists}</td><td>${p.gold_per_min}</td><td>${p.xp_per_min}</td><td>${k1(p.hero_damage)}</td><td>${k1(p.net_worth)}</td>${lost ? `<td><span class="ru-bar" style="--v:${p.harm}%"><i></i><b>${p.harm}</b></span></td>` : ""}</tr>`).join("");
    return `<div class="ru-tw"><table class="ru-t"><thead><tr><th>Игрок</th><th>K/D/A</th><th>GPM</th><th>XPM</th><th>Урон</th><th>Богатство</th>${lost ? "<th>Вред</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function render(m){
    const A = analyze(m), top = A.rank[0], sec = A.rank[1];
    cur.A = A; if (cur.acc != null){ const me = A.P.find(p => p.account_id === +cur.acc); cur.me = me ? me.i : -1; } else cur.me = -1;
    clearInterval(rot); art(hbust(top.hero_id), true);
    const gap = Math.abs((m.gold || []).slice(-1)[0] || 0), rosh = m.obj.filter(o => o[1] === "CHAT_MESSAGE_ROSHAN_KILL").length, bld = m.obj.filter(o => o[1] === "building_kill").length;
    const mo = moments(top, m, A);
    out.innerHTML = `
      <div class="ru-sum"><span>Матч <b translate="no">${m.id}</b></span><span>${mmss(m.dur)}</span><span>Победа: <b class="${m.rw ? "rad" : "dire"}">${m.rw ? "Свет" : "Тьма"}</b></span><span>${m.rs} : ${m.ds}</span></div>
      ${cur.me >= 0 ? `<p class="ru-you">${A.L.some(p => p.i === cur.me) ? (top.i === cur.me ? "😬 По статистике руинер — это ты. Бывает! Ниже — что пошло не так." : "Ты был в проигравшей команде — смотри, кто тебя подвёл 👇") : "Ты выиграл этот матч 🎉 Ниже — кто руинил у соперников."}</p>` : ""}
      <div class="ru-grid">${card(top, m, A, true)}${sec ? card(sec, m, A, false) : ""}</div>
      <h3 class="ru-h3">Матч в цифрах</h3>
      <div class="ru-nums">${metric("Длительность", mmss(m.dur))}${metric("Победила", m.rw ? "Свет" : "Тьма")}${metric("Разница в золоте", k1(gap))}${metric("Драк", m.parsed ? m.tf.length : "—")}${metric("Снесено строений", m.parsed ? bld : "—")}${metric("Рошанов", m.parsed ? rosh : "—")}</div>
      <h3 class="ru-h3">Ключевые моменты — ${esc(hname(top.hero_id))}</h3>
      ${m.parsed ? (mo.length ? `<ol class="ru-mo">${mo.map(([t, s, x]) => `<li class="${s > 0 ? "good" : "bad"}"><time>${mmss(t)}</time><i>${s > 0 ? "+" : "−"}</i><span>${esc(x)}</span></li>`).join("")}</ol>` : `<p class="gempty">Особых моментов не нашли.</p>`)
        : `<div class="ru-parse"><p>Реплей этого матча ещё не разобран — драки, смерти по таймингам и варды появятся после разбора. Обычно это занимает 1–3 минуты.</p><button type="button" class="btn btn-ghost" id="ruParse">Разобрать реплей</button></div>`}
      <h3 class="ru-h3">Проигравшие — ${A.lostRad ? "Свет" : "Тьма"}</h3>${table(A.L, m, A, true)}
      <h3 class="ru-h3">Победители — ${A.lostRad ? "Тьма" : "Свет"}</h3>${table(A.Wn, m, A, false)}
      <p class="db-note">Оценка — подсказка по статистике, а не приговор: она не видит, кто ошибся на драфте, кто отдал линию и кто кому кричал в микрофон. «Влияние на поражение» — 0–100, считается по сравнению с игроками на том же герое (бенчмарки OpenDota), смертям, участию в драках и богатству/вардам. Данные — <a href="https://www.opendota.com/matches/${m.id}" target="_blank" rel="noopener">OpenDota</a>.</p>`;
    const pb = out.querySelector("#ruParse"); if (pb) pb.onclick = () => parse(m.id, pb);
    try { localStorage.setItem("ub-ruin", String(m.id)); } catch(e) {}
  }
  async function parse(id, b){
    b.disabled = true; b.textContent = "Разбираем реплей…";
    try { await api("parse", id); } catch(e) {}
    let n = 0; clearInterval(poll);
    poll = setInterval(async () => { n++; try { const m = await api("ruin", id, true); if (m.parsed){ clearInterval(poll); if (cur && cur.id == id) render(m); return; } } catch(e) {}
      if (n >= 12){ clearInterval(poll); if (b.isConnected){ b.disabled = false; b.textContent = "Разобрать реплей"; PROF.toast("Реплей пока не разобран — попробуй через пару минут. Очень старые матчи разобрать нельзя."); } } }, 15000);
  }
  async function analyzeMatch(id, acc){
    clearInterval(poll); cur = { id, acc }; out.innerHTML = `<div class="feed-sk"></div><div class="feed-sk"></div>`;
    try { await heroes(); const m = await api("ruin", id); if (cur.id !== id) return;
      if (m && m.players && m.players.length && m.players.every(p => !p.hero_id)){ out.innerHTML = `<div class="gempty">Матч ещё идёт или данных пока нет. Попробуй после окончания игры.</div>`; return; }
      if (!m || !m.players || m.players.length < 10){ out.innerHTML = `<div class="gempty">В этом матче нет данных об игроках. Проверь номер.</div>`; return; }
      render(m); out.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch(e) { if (cur.id === id) out.innerHTML = `<div class="gempty">${String(e.message) === "404" ? "Матч не найден. Проверь номер." : "Не удалось загрузить матч. Попробуй ещё раз через минуту."}</div>`; }
  }
  async function recent(acc, maybeMatch){
    cur = { acc }; out.innerHTML = `<div class="feed-sk"></div>`;
    try { await heroes(); const list = await api("recent", acc);
      if (!Array.isArray(list) || !list.length){ if (maybeMatch) return analyzeMatch(maybeMatch); out.innerHTML = `<div class="gempty">У игрока нет открытых матчей. Включи в Доте «Общедоступная история матчей».</div>`; return; }
      out.innerHTML = `<h3 class="ru-h3">Последние матчи — выбери проигранный</h3><div class="ru-rec">${list.slice(0, 12).map(x => { const win = (x.player_slot < 128) === x.radiant_win;
        return `<button type="button" class="ru-r ${win ? "w" : "l"}" data-id="${x.match_id}"><img alt="" loading="lazy" src="${esc(hicon(x.hero_id))}"><span><b>${esc(hname(x.hero_id))}</b><small>${x.kills}/${x.deaths}/${x.assists} · ${mmss(x.duration)} · ${new Date(x.start_time * 1000).toLocaleDateString()}</small></span><em>${win ? "Победа" : "Поражение"}</em></button>`; }).join("")}</div>`;
      out.querySelectorAll(".ru-r").forEach(b => b.onclick = () => analyzeMatch(b.dataset.id, acc));
    } catch(e) { if (maybeMatch) return analyzeMatch(maybeMatch); out.innerHTML = `<div class="gempty">Не удалось загрузить профиль. Проверь ссылку.</div>`; }
  }
  function go(v){ const r = parseInput(v); if (r.err){ out.innerHTML = `<div class="gempty">${esc(r.err)}</div>`; return; } if (r.match) analyzeMatch(r.match); else recent(r.player, r.maybeMatch); }

  function open(){
    box = document.getElementById("ruinBox"); if (!box) return;
    if (!built){ built = true; shell(); const q = new URLSearchParams(location.search).get("match"); let last = ""; try { last = localStorage.getItem("ub-ruin") || ""; } catch(e) {}
      if (q && /^\d+$/.test(q)){ box.querySelector("#ruQ").value = q; analyzeMatch(q); } else if (last) box.querySelector("#ruQ").value = last; }
    else if (fieldStop) fieldStop();
  }
  setTimeout(() => { if (typeof curTab !== "undefined" && curTab === "ruin") open(); }, 0);
  return { open };
})();
