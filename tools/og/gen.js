const { chromium } = require('playwright');
const R='file:///home/claude/1x6-builds/';
const C=[
 {f:'main',t:'Dota 2, CS2 и Deadlock<br>в одном месте',s:'Сборки, мета, скины, сетки героев и мини-игры',p:['Dota 1x6','Мета Dota 2','Скины CS2','Deadlock'],a:['bg/hd2/juggernaut.webp','bg/hcs/7.webp','bg/hdl/9.webp'],g:'#e8564a',g2:'#5b3fd1'},
 {f:'dota2',t:'Мета Dota 2<br>по статистике',s:'Винрейт по рангам и ролям, сборки, контрпики, профили',p:['Все герои','Пикер','Топ MMR','Кто заруинил?'],a:['bg/hd2/invoker.webp'],g:'#e8564a',g2:'#b8641e'},
 {f:'chc',t:'Custom Hero Chaos<br>готовые билды',s:'Лучшие способности и предметы для каждого героя',p:['Билды','Способности','Сетки'],a:['bg/hd2/pudge.webp'],g:'#c0392b',g2:'#7b2fbf'},
 {f:'cs',t:'Counter-Strike 2<br>цены скинов',s:'Сравнение маркетов, новости, рейтинг команд',p:['Скины','Избранное','Новости'],a:['bg/hcs/3.webp'],g:'#d98a1c',g2:'#1f5fbf'},
 {f:'deadlock',t:'Deadlock<br>герои и сборки',s:'Прокачка по статистике, предметы, новости',p:['Герои','Сборки','Новости'],a:['bg/hdl/3.webp'],g:'#2f9e7a',g2:'#6a3fd1'},
];
const html=c=>`<!doctype html><html><head><meta charset=utf8><style>
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;overflow:hidden;font-family:Inter;color:#fff;background:#0b0b10;position:relative}
.bg{position:absolute;inset:0;background:radial-gradient(900px 600px at 0% 0%,${c.g}ee,transparent 65%),radial-gradient(800px 600px at 100% 100%,${c.g2}dd,transparent 65%)}
.art{position:absolute;right:-20px;bottom:0;height:630px;display:flex;align-items:flex-end;gap:0}
.art img{height:${c.a.length>1?360:600}px;object-fit:contain;margin-left:${c.a.length>1?-150:0}px;-webkit-mask-image:linear-gradient(90deg,transparent,#000 35%);filter:drop-shadow(0 0 40px #0008)}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#0b0b10c0 0%,#0b0b1088 50%,transparent 78%)}
.w{position:absolute;left:70px;top:64px;right:70px}
.br{display:flex;align-items:center;gap:22px}.br img{width:120px;height:120px}
.n{font-size:46px;font-weight:900;letter-spacing:5px;background:linear-gradient(90deg,#ffd77a,#f3a23a,#e8564a);-webkit-background-clip:text;color:transparent}
.u{font-size:24px;color:#ffffffaa;margin-top:4px;font-weight:500}
h1{font-size:74px;line-height:1.05;font-weight:800;margin-top:66px;letter-spacing:-1px;text-shadow:0 4px 30px #0009}
p{font-size:28px;color:#ffffffcc;margin-top:18px}
.ch{display:flex;gap:12px;margin-top:40px}.ch span{border:2px solid #ffffff55;background:#00000066;border-radius:999px;padding:8px 20px;font-size:22px;font-weight:600}
</style></head><body><div class=bg></div><div class=art>${c.a.map(x=>`<img src="${R+x}">`).join('')}</div><div class=fade></div>
<div class=w><div class=br><img src="${R}logo.png"><div><div class=n>BLAZECREST</div><div class=u>blazecrest.vercel.app</div></div></div>
<h1>${c.t}</h1><p>${c.s}</p><div class=ch>${c.p.map(x=>`<span>${x}</span>`).join('')}</div></div></body></html>`;
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1200,height:630}});
for(const c of C){require('fs').writeFileSync(require('os').tmpdir()+'/og_t.html',html(c));await p.goto('file://'+require('os').tmpdir()+'/og_t.html',{waitUntil:'load'});await p.waitForTimeout(300);await p.screenshot({path:`/home/claude/1x6-builds/og/${c.f}.png`});}
await b.close();})();
