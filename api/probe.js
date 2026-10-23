// временная проверка источника матчей CS (удалить)
module.exports = async (req, res) => {
  const p = String(req.query.p || "");
  if (!/^\/api\/v\d\/[\w\/.\-?=&\[\]%,|]+$/.test(p)) return res.status(400).send("bad");
  try { const r = await fetch("https://api.bo3.gg" + p, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
    res.status(200).send(r.status + "\n" + (await r.text()).slice(0, +req.query.n || 8000)); } catch (e) { res.status(200).send("ERR " + e.message); }
};
