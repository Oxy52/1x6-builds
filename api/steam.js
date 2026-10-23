// Вход через Steam (OpenID 2.0) для Blazecrest.
// GET /api/steam?go=1  -> переход на официальную страницу входа Steam (steamcommunity.com)
// GET /api/steam?cb=1  -> Steam возвращает сюда: проверяем ответ у самого Steam, создаём/находим аккаунт
//                         и отправляем на сайт с одноразовым токеном входа в адресе (#steam=...)
// Сайт получает от Steam только Steam ID; ник и аватар берём из публичного профиля. Пароль и инвентарь не видим.
//
// Нужны те же переменные окружения, что и для Telegram: SUPABASE_SECRET_KEY (секрет), SUPABASE_URL (необязательно).
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vsmjjlrgjyujaioknlkn.supabase.co";
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const HOSTS = ["blazecrest.vercel.app", "1x6-eta.vercel.app"];
const OP = "https://steamcommunity.com/openid/login";
const NS = "http://specs.openid.net/auth/2.0";

function adminHeaders() {
  const h = { "Content-Type": "application/json", apikey: SECRET };
  if (SECRET.startsWith("eyJ")) h.Authorization = "Bearer " + SECRET;
  return h;
}
const siteOf = req => { const h = String(req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase(); return "https://" + (HOSTS.includes(h) ? h : HOSTS[0]); };
const back = (res, site, frag) => { res.setHeader("Location", `${site}/${frag}`); return res.status(302).end(); };
const cdata = (xml, tag) => { const m = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`).exec(xml) || new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml); return m ? m[1].trim() : ""; };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const q = req.query || {}, site = siteOf(req), cb = `${site}/api/steam?cb=1`;
  if (q.go) {
    const p = new URLSearchParams({ "openid.ns": NS, "openid.mode": "checkid_setup", "openid.return_to": cb, "openid.realm": site,
      "openid.identity": NS + "/identifier_select", "openid.claimed_id": NS + "/identifier_select" });
    res.setHeader("Location", `${OP}?${p}`); return res.status(302).end();
  }
  if (!q.cb) return res.status(400).json({ error: "bad_request" });
  if (!SECRET) return back(res, site, "#steam_err=off");
  try {
    // 1) спрашиваем у Steam, что ответ настоящий (подделать его без Steam нельзя)
    if (q["openid.mode"] !== "id_res" || !String(q["openid.return_to"] || "").startsWith(cb)) return back(res, site, "#steam_err=cancel");
    const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(String(q["openid.claimed_id"] || ""));
    if (!m) return back(res, site, "#steam_err=bad");
    const form = new URLSearchParams(); for (const k of Object.keys(q)) if (k.startsWith("openid.")) form.set(k, String(q[k])); form.set("openid.mode", "check_authentication");
    const v = await fetch(OP, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(), signal: AbortSignal.timeout(9000) });
    if (!/is_valid\s*:\s*true/.test(await v.text())) return back(res, site, "#steam_err=bad");
    const sid = m[1];
    // 2) публичный ник и аватар (без ключа API)
    let name = "", avatar = "";
    try { const x = await (await fetch(`https://steamcommunity.com/profiles/${sid}/?xml=1`, { signal: AbortSignal.timeout(6000) })).text(); name = cdata(x, "steamID").slice(0, 40); avatar = cdata(x, "avatarFull"); } catch (e) {}
    const email = `steam-${sid}@blazecrest.vercel.app`;
    const meta = { provider: "steam", steam_id: sid, full_name: name, user_name: name, avatar_url: /^https:\/\//.test(avatar) ? avatar : "" };
    // 3) аккаунт: создаём, если нет, и выдаём одноразовый вход (письмо не отправляется)
    const cr = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ email, email_confirm: true, user_metadata: meta }) });
    if (!cr.ok && cr.status !== 422 && cr.status !== 400) return back(res, site, "#steam_err=server");
    const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ type: "magiclink", email, data: meta }) });
    const j = await gl.json().catch(() => ({}));
    const th = j.hashed_token || (j.properties && j.properties.hashed_token);
    if (!gl.ok || !th) return back(res, site, "#steam_err=server");
    return back(res, site, `#steam=${encodeURIComponent(th)}`);
  } catch (e) {
    return back(res, site, "#steam_err=server");
  }
};
