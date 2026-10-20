-- 1x6 Билды: рейтинг (MMR) онлайн-дуэлей и топы
-- Запусти целиком в Supabase → SQL Editor → New query → Run
-- (после setup.sql, runner.sql, rewards.sql, social.sql)

create table if not exists public.duel_ratings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mmr int not null default 1000,
  wins int not null default 0,
  losses int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.duel_ratings enable row level security;
drop policy if exists "ratings readable" on public.duel_ratings;
create policy "ratings readable" on public.duel_ratings for select using (true);

create table if not exists public.duel_matches (
  id text primary key check (char_length(id) <= 40),
  p0 uuid not null, p1 uuid not null,
  claim0 uuid, claim1 uuid,
  done boolean not null default false,
  delta int,
  created_at timestamptz not null default now()
);
alter table public.duel_matches enable row level security;
-- без политик: только через функцию

-- каждый игрок сообщает победителя; MMR меняется, только когда оба сказали одно и то же
create or replace function public.duel_report(p_match text, p_opp uuid, p_winner uuid)
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
    if uid = a then update public.duel_matches set claim0 = p_winner where id = p_match returning * into m;
    else update public.duel_matches set claim1 = p_winner where id = p_match returning * into m; end if;
    if m.claim0 is not null and m.claim1 is not null then
      if m.claim0 <> m.claim1 then
        update public.duel_matches set done = true, delta = 0 where id = p_match;
        return json_build_object('status', 'dispute');
      end if;
      if (select count(*) from public.duel_matches where p0 = a and p1 = b and done and delta > 0 and created_at > now() - interval '1 day') >= 5 then
        update public.duel_matches set done = true, delta = 0 where id = p_match;
        return json_build_object('status', 'limit');
      end if;
      insert into public.duel_ratings (user_id) values (a), (b) on conflict do nothing;
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
      update public.duel_matches set done = true, delta = da where id = p_match returning * into m;
    else
      return json_build_object('status', 'pending');
    end if;
  end if;
  select mmr into mine from public.duel_ratings where user_id = uid;
  return json_build_object('status', case when coalesce(m.delta, 0) = 0 then 'unrated' else 'done' end,
    'delta', case when m.claim0 = uid then m.delta else -m.delta end, 'mmr', mine);
end; $$;
revoke all on function public.duel_report(text, uuid, uuid) from public, anon;
grant execute on function public.duel_report(text, uuid, uuid) to authenticated;

-- топы
create or replace view public.duel_top with (security_invoker = true) as
  select r.user_id, r.mmr, r.wins, r.losses, p.nick, p.avatar, p.frame
  from public.duel_ratings r join public.profiles p on p.id = r.user_id
  where r.wins + r.losses > 0 order by r.mmr desc limit 100;
create or replace view public.level_top with (security_invoker = true) as
  select s.user_id, s.xp, s.best_streak, p.nick, p.avatar, p.frame
  from public.user_stats s join public.profiles p on p.id = s.user_id
  where s.xp > 0 order by s.xp desc limit 100;
grant select on public.duel_top, public.level_top to anon, authenticated;
