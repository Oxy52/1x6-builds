-- 1x6 Билды: уровни, ежедневный бонус, рамки и оценки билдов
-- Запусти целиком в Supabase → SQL Editor → New query → Run
-- (сначала должны быть выполнены setup.sql и runner.sql)

-- ---------- опыт и серия заходов ----------
create table if not exists public.user_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp int not null default 0 check (xp >= 0),
  streak int not null default 0,
  best_streak int not null default 0,
  last_day date,
  updated_at timestamptz not null default now()
);
alter table public.user_stats enable row level security;
drop policy if exists "stats readable" on public.user_stats;
create policy "stats readable" on public.user_stats for select using (true);
-- писать напрямую нельзя: только через функции ниже

create table if not exists public.xp_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null,
  n int not null default 0,
  primary key (user_id, day, kind)
);
alter table public.xp_daily enable row level security;
-- без политик: доступ только из функций

-- ежедневный бонус: +20 опыта и ещё +5 за каждый день серии (до 7)
create or replace function public.claim_daily()
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Europe/Kyiv')::date;
  r public.user_stats;
  gained int := 0;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  insert into public.user_stats (user_id) values (uid) on conflict do nothing;
  select * into r from public.user_stats where user_id = uid for update;
  if r.last_day is distinct from today then
    if r.last_day = today - 1 then r.streak := r.streak + 1; else r.streak := 1; end if;
    gained := 20 + 5 * least(r.streak, 7);
    update public.user_stats
      set xp = xp + gained, streak = r.streak, best_streak = greatest(best_streak, r.streak), last_day = today, updated_at = now()
      where user_id = uid returning * into r;
  end if;
  return json_build_object('xp', r.xp, 'streak', r.streak, 'best_streak', r.best_streak, 'gained', gained);
end; $$;

-- опыт за действия, с дневным лимитом на каждое действие
create or replace function public.grant_xp(p_kind text)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Europe/Kyiv')::date;
  amt int; cap int; cnt int; total int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  case p_kind
    when 'hero' then amt := 2; cap := 15;
    when 'quiz' then amt := 5; cap := 20;
    when 'run'  then amt := 5; cap := 10;
    when 'vote' then amt := 3; cap := 20;
    when 'fav'  then amt := 3; cap := 10;
    else raise exception 'bad_kind';
  end case;
  insert into public.user_stats (user_id) values (uid) on conflict do nothing;
  insert into public.xp_daily as d (user_id, day, kind, n) values (uid, today, p_kind, 1)
    on conflict (user_id, day, kind) do update set n = d.n + 1
    returning n into cnt;
  if cnt > cap then
    select xp into total from public.user_stats where user_id = uid;
    return json_build_object('xp', total, 'gained', 0);
  end if;
  update public.user_stats set xp = xp + amt, updated_at = now() where user_id = uid returning xp into total;
  return json_build_object('xp', total, 'gained', amt);
end; $$;

revoke all on function public.claim_daily() from public, anon;
revoke all on function public.grant_xp(text) from public, anon;
grant execute on function public.claim_daily() to authenticated;
grant execute on function public.grant_xp(text) to authenticated;

-- ---------- рамка аватарки в профиле ----------
alter table public.profiles add column if not exists frame text not null default '';
alter table public.profiles drop constraint if exists profiles_frame_len;
alter table public.profiles add constraint profiles_frame_len check (char_length(frame) <= 20);

-- топ раннера теперь с рамкой и опытом
drop view if exists public.runner_top;
create view public.runner_top with (security_invoker = true) as
  select s.user_id, s.best, s.games, p.nick, p.avatar, p.frame, coalesce(u.xp, 0) as xp
  from public.runner_scores s
  join public.profiles p on p.id = s.user_id
  left join public.user_stats u on u.user_id = s.user_id
  where s.best > 0
  order by s.best desc
  limit 100;
grant select on public.runner_top to anon, authenticated;

-- ---------- оценки билдов ----------
create table if not exists public.build_votes (
  user_id uuid not null references auth.users(id) on delete cascade,
  hero text not null check (char_length(hero) <= 40),
  k text not null check (char_length(k) <= 4),
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (user_id, hero, k)
);
alter table public.build_votes enable row level security;
drop policy if exists "votes readable" on public.build_votes;
drop policy if exists "votes insert own" on public.build_votes;
drop policy if exists "votes update own" on public.build_votes;
drop policy if exists "votes delete own" on public.build_votes;
create policy "votes readable" on public.build_votes for select using (true);
create policy "votes insert own" on public.build_votes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "votes update own" on public.build_votes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "votes delete own" on public.build_votes for delete to authenticated using ((select auth.uid()) = user_id);

create or replace view public.build_scores with (security_invoker = true) as
  select hero, k,
         count(*) filter (where vote = 1)  as up,
         count(*) filter (where vote = -1) as down
  from public.build_votes
  group by hero, k;
grant select on public.build_scores to anon, authenticated;
