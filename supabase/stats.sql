-- 1x6 Билды: статистика в духе Dotabuff — история матчей, забеги Арены, мета героев
-- Запусти целиком в Supabase → SQL Editor → New query → Run (после rating.sql). Можно запускать повторно.

-- ================= ЗАБЕГИ АРЕНЫ =================
create table if not exists public.arena_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  hero text not null check (hero ~ '^[a-z_]{2,30}$'),
  arcana boolean not null default false,
  score int not null check (score >= 0),
  ms int not null,
  kills int not null default 0,
  lvl int not null default 1,
  roshan int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists arena_runs_user_idx on public.arena_runs (user_id, created_at desc);
create index if not exists arena_runs_hero_idx on public.arena_runs (hero, created_at desc);
alter table public.arena_runs enable row level security;
drop policy if exists "arena runs readable" on public.arena_runs;
create policy "arena runs readable" on public.arena_runs for select using (true);
-- писать напрямую нельзя: только через функцию

create or replace function public.submit_arena_run(p_hero text, p_arc boolean, p_score int, p_ms int, p_kills int, p_lvl int, p_rosh int)
returns int language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); result int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_score < 0 or p_ms < 500 or p_ms > 3600000 or p_score > (p_ms / 1000.0) * 120 + 200 then raise exception 'invalid_score'; end if;
  if p_hero is null or p_hero !~ '^[a-z_]{2,30}$' then raise exception 'bad_hero'; end if;
  if (select count(*) from public.arena_runs where user_id = uid and created_at > now() - interval '1 hour') >= 120 then raise exception 'rate_limit'; end if;
  insert into public.arena_runs (user_id, hero, arcana, score, ms, kills, lvl, roshan)
  values (uid, p_hero, coalesce(p_arc, false), p_score, p_ms, greatest(0, least(coalesce(p_kills, 0), 100000)), greatest(1, least(coalesce(p_lvl, 1), 999)), greatest(0, least(coalesce(p_rosh, 0), 99)));
  insert into public.runner_scores as s (user_id, best, games, updated_at)
  values (uid, p_score, 1, now())
  on conflict (user_id) do update
    set games = s.games + 1, best = greatest(s.best, excluded.best),
        updated_at = case when excluded.best > s.best then now() else s.updated_at end
  returning best into result;
  return result;
end; $$;
revoke all on function public.submit_arena_run(text, boolean, int, int, int, int, int) from public, anon;
grant execute on function public.submit_arena_run(text, boolean, int, int, int, int, int) to authenticated;

-- мета героев Арены за 30 дней
create or replace view public.arena_hero_stats with (security_invoker = true) as
  select hero, count(*)::int as games, count(distinct user_id)::int as players,
         round(avg(score))::int as avg_score, max(score) as best, round(avg(kills))::int as avg_kills,
         round(100.0 * avg(case when arcana then 1 else 0 end))::int as arc_pct
  from public.arena_runs where created_at > now() - interval '30 days' group by hero;
grant select on public.arena_hero_stats to anon, authenticated;

-- ================= ИСТОРИЯ ДУЭЛЕЙ =================
alter table public.duel_matches add column if not exists winner uuid;
alter table public.duel_matches add column if not exists turns int;
alter table public.duel_matches add column if not exists cards0 text[];
alter table public.duel_matches add column if not exists cards1 text[];
alter table public.duel_matches add column if not exists mmr0 int;
alter table public.duel_matches add column if not exists mmr1 int;
create index if not exists duel_matches_p0_idx on public.duel_matches (p0, created_at desc);
create index if not exists duel_matches_p1_idx on public.duel_matches (p1, created_at desc);
drop policy if exists "finished matches readable" on public.duel_matches;
create policy "finished matches readable" on public.duel_matches for select using (done);

-- чистим список карт: только латиница, без повторов, не больше 30
create or replace function public.clean_cards(c text[]) returns text[] language sql immutable as $$
  select coalesce((select array_agg(distinct x) from (select x from unnest(c) x where x ~ '^[a-z_]{2,30}$' limit 30) t), '{}');
$$;

drop function if exists public.duel_report(text, uuid, uuid);
create or replace function public.duel_report(p_match text, p_opp uuid, p_winner uuid, p_turns int default null, p_cards text[] default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); a uuid; b uuid; m public.duel_matches; ra int; rb int; ea float; sa int; da int; mine int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_opp is null or p_opp = uid then raise exception 'bad_opponent'; end if;
  if p_winner <> uid and p_winner <> p_opp then raise exception 'bad_winner'; end if;
  a := least(uid, p_opp); b := greatest(uid, p_opp);
  insert into public.duel_matches (id, p0, p1) values (p_match, a, b) on conflict (id) do nothing;
  select * into m from public.duel_matches where id = p_match for update;
  if m.p0 <> a or m.p1 <> b then raise exception 'mismatch'; end if;
  if not m.done then
    if uid = a then update public.duel_matches set claim0 = p_winner, cards0 = public.clean_cards(p_cards) where id = p_match returning * into m;
    else update public.duel_matches set claim1 = p_winner, cards1 = public.clean_cards(p_cards) where id = p_match returning * into m; end if;
    if p_turns between 1 and 500 then update public.duel_matches set turns = greatest(coalesce(turns, 0), p_turns) where id = p_match returning * into m; end if;
    if m.claim0 is not null and m.claim1 is not null then
      insert into public.duel_ratings (user_id) values (a), (b) on conflict do nothing;
      if m.claim0 <> m.claim1 then
        update public.duel_matches set done = true, delta = 0,
          mmr0 = (select mmr from public.duel_ratings where user_id = a), mmr1 = (select mmr from public.duel_ratings where user_id = b) where id = p_match;
        return json_build_object('status', 'dispute');
      end if;
      if (select count(*) from public.duel_matches where p0 = a and p1 = b and done and delta > 0 and created_at > now() - interval '1 day') >= 5 then
        update public.duel_matches set done = true, delta = 0, winner = m.claim0,
          mmr0 = (select mmr from public.duel_ratings where user_id = a), mmr1 = (select mmr from public.duel_ratings where user_id = b) where id = p_match;
        return json_build_object('status', 'limit');
      end if;
      select mmr into ra from public.duel_ratings where user_id = a for update;
      select mmr into rb from public.duel_ratings where user_id = b for update;
      ea := 1.0 / (1.0 + power(10.0, (rb - ra) / 400.0));
      sa := case when m.claim0 = a then 1 else 0 end;
      da := greatest(5, least(45, round(abs(32 * (sa - ea)))::int));
      if sa = 1 then
        update public.duel_ratings set mmr = mmr + da, wins = wins + 1, updated_at = now() where user_id = a;
        update public.duel_ratings set mmr = greatest(0, mmr - da), losses = losses + 1, updated_at = now() where user_id = b;
      else
        update public.duel_ratings set mmr = greatest(0, mmr - da), losses = losses + 1, updated_at = now() where user_id = a;
        update public.duel_ratings set mmr = mmr + da, wins = wins + 1, updated_at = now() where user_id = b;
      end if;
      update public.duel_matches set done = true, delta = da, winner = m.claim0,
        mmr0 = (select mmr from public.duel_ratings where user_id = a), mmr1 = (select mmr from public.duel_ratings where user_id = b)
        where id = p_match returning * into m;
    else
      return json_build_object('status', 'pending');
    end if;
  end if;
  select mmr into mine from public.duel_ratings where user_id = uid;
  return json_build_object('status', case when coalesce(m.delta, 0) = 0 then 'unrated' else 'done' end,
    'delta', case when m.claim0 = uid then m.delta else -m.delta end, 'mmr', mine);
end; $$;
revoke all on function public.duel_report(text, uuid, uuid, int, text[]) from public, anon;
grant execute on function public.duel_report(text, uuid, uuid, int, text[]) to authenticated;

-- лента матчей с никами обоих игроков
create or replace view public.duel_history with (security_invoker = true) as
  select m.id, m.created_at, m.p0, m.p1, m.winner, m.delta, m.turns, m.cards0, m.cards1, m.mmr0, m.mmr1,
         a.nick as nick0, a.avatar as av0, a.frame as fr0, b.nick as nick1, b.avatar as av1, b.frame as fr1
  from public.duel_matches m
  left join public.profiles a on a.id = m.p0
  left join public.profiles b on b.id = m.p1
  where m.done;
grant select on public.duel_history to anon, authenticated;

-- винрейт карт-героев в дуэлях за 30 дней
create or replace view public.duel_card_stats with (security_invoker = true) as
  select card, count(*)::int as games, sum(case when won then 1 else 0 end)::int as wins
  from (
    select c.card, m.winner = m.p0 as won from public.duel_matches m, unnest(m.cards0) as c(card)
      where m.done and m.winner is not null and m.created_at > now() - interval '30 days'
    union all
    select c.card, m.winner = m.p1 as won from public.duel_matches m, unnest(m.cards1) as c(card)
      where m.done and m.winner is not null and m.created_at > now() - interval '30 days'
  ) t group by card;
grant select on public.duel_card_stats to anon, authenticated;
