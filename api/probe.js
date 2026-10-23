// временная проверка доступности источников матчей CS (удалить)
const U = [
  "https://api.bo3.gg/api/v1/matches?page[limit]=2&sort=-start_date&filter[matches.status][in]=finished&filter[matches.discipline_id][eq]=1&with=teams,tournament,games",
  "https://api.bo3.gg/api/v1/teams?page[limit]=1&filter[teams.slug][eq]=spirit",
];
module.exports = async (req, res) => {
  const i = Math.max(0, Math.min(U.length - 1, +req.query.i || 0));
  try { const r = await fetch(U[i], { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
    res.status(200).send(r.status + "\n" + (await r.text()).slice(0, 6000)); } catch (e) { res.status(200).send("ERR " + e.message); }
};
