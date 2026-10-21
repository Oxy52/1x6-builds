-- 1x6 Билды: ВСЁ В ОДНОМ ФАЙЛЕ (профили, картинки, Арена, уровни, оценки, лента, рейтинг, статистика, подписка, AI)
-- Запусти целиком в Supabase → SQL Editor → New query → Run.
-- Файл можно запускать повторно: существующие таблицы и данные не удаляются.


-- ================= ПРОФИЛИ И КАРТИНКИ =================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nick text not null check (char_length(nick) between 2 and 20),
  status text not null default '' check (char_length(status) <= 40),
  avatar text not null default '',
  banner text not null default '',
  favs text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_nick_unique on public.profiles (lower(nick));

alter table public.profiles enable row level security;
drop policy if exists "profiles readable by everyone" on public.profiles;
drop policy if exists "users insert own profile" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;
drop policy if exists "users delete own profile" on public.profiles;
create policy "profiles readable by everyone" on public.profiles for select using (true);
create policy "users insert own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "users update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "users delete own profile" on public.profiles for delete to authenticated using ((select auth.uid()) = id);

-- хранилище аватарок и баннеров (до 2 МБ, только картинки)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "media upload own folder" on storage.objects;
drop policy if exists "media update own folder" on storage.objects;
drop policy if exists "media delete own folder" on storage.objects;
create policy "media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- чтение картинок (нужно для загрузки своих фото)
drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects for select using (bucket_id = 'media');


-- ================= ТОП АРЕНЫ =================
create table if not exists public.runner_scores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  best int not null default 0 check (best >= 0),
  games int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.runner_scores enable row level security;
drop policy if exists "runner scores readable" on public.runner_scores;
create policy "runner scores readable" on public.runner_scores for select using (true);
-- писать напрямую нельзя: только через функцию ниже

create or replace function public.submit_runner_score(p_score int, p_ms int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  -- защита от явной накрутки: очков не больше, чем можно набрать за это время
  if p_score < 0 or p_ms < 500 or p_ms > 3600000 or p_score > (p_ms / 1000.0) * 120 + 200 then
    raise exception 'invalid_score';
  end if;
  insert into public.runner_scores as s (user_id, best, games, updated_at)
  values (uid, p_score, 1, now())
  on conflict (user_id) do update
    set games = s.games + 1,
        best = greatest(s.best, excluded.best),
        updated_at = case when excluded.best > s.best then now() else s.updated_at end
  returning best into result;
  return result;
end;
$$;
revoke all on function public.submit_runner_score(int, int) from public, anon;
grant execute on function public.submit_runner_score(int, int) to authenticated;

drop view if exists public.runner_top cascade;
create view public.runner_top with (security_invoker = true) as
  select s.user_id, s.best, s.games, p.nick, p.avatar
  from public.runner_scores s
  join public.profiles p on p.id = s.user_id
  where s.best > 0
  order by s.best desc
  limit 100;
grant select on public.runner_top to anon, authenticated;


-- ================= УРОВНИ, БОНУСЫ, РАМКИ, ОЦЕНКИ БИЛДОВ =================
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


-- ================= ЛЕНТА, ЛАЙКИ, ОТВЕТЫ =================
-- ---------- админы (могут удалять любые посты) ----------
create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admins enable row level security;
drop policy if exists "admins readable" on public.admins;
create policy "admins readable" on public.admins for select using (true);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- посты ----------
create table if not exists public.posts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 280),
  image text check (image is null or image like 'https://vsmjjlrgjyujaioknlkn.supabase.co/storage/v1/object/public/media/%'),
  reply_to bigint references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_user_idx on public.posts (user_id, created_at desc);
create index if not exists posts_reply_idx on public.posts (reply_to, created_at);

alter table public.posts enable row level security;
drop policy if exists "posts readable" on public.posts;
drop policy if exists "posts insert own" on public.posts;
drop policy if exists "posts delete own or admin" on public.posts;
create policy "posts readable" on public.posts for select using (true);
create policy "posts insert own" on public.posts for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (select 1 from public.profiles where id = (select auth.uid())));
create policy "posts delete own or admin" on public.posts for delete to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

-- антиспам: не больше 3 постов в минуту и 40 в сутки
create or replace function public.posts_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'rate_limit_minute';
  end if;
  if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '1 day') >= 40 then
    raise exception 'rate_limit_day';
  end if;
  new.created_at := now();
  return new;
end; $$;
drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit before insert on public.posts for each row execute function public.posts_rate_limit();

-- ---------- лайки ----------
create table if not exists public.post_likes (
  post_id bigint not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_likes enable row level security;
drop policy if exists "likes readable" on public.post_likes;
drop policy if exists "likes insert own" on public.post_likes;
drop policy if exists "likes delete own" on public.post_likes;
create policy "likes readable" on public.post_likes for select using (true);
create policy "likes insert own" on public.post_likes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "likes delete own" on public.post_likes for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------- лента: пост + автор + счётчики ----------
create or replace view public.post_feed with (security_invoker = true) as
  select p.id, p.user_id, p.body, p.image, p.reply_to, p.created_at,
         pr.nick, pr.avatar, pr.frame, coalesce(us.xp, 0) as xp,
         (select count(*) from public.post_likes l where l.post_id = p.id) as likes,
         (select count(*) from public.posts r where r.reply_to = p.id) as replies
  from public.posts p
  join public.profiles pr on pr.id = p.user_id
  left join public.user_stats us on us.user_id = p.user_id;
grant select on public.post_feed to anon, authenticated;


-- ================= РЕЙТИНГ MMR ДУЭЛЕЙ =================
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


-- ================= СТАТИСТИКА (Dotabuff) =================

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


-- ================= ПОДПИСКА 1x6+ =================

-- ---------- кто подписан и до какого числа ----------
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  until timestamptz not null,
  plan text not null default '',
  since timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions readable" on public.subscriptions;
create policy "subscriptions readable" on public.subscriptions for select using (true);
-- писать может только сервер оплаты

-- ---------- журнал оплат (каждая оплата засчитывается один раз) ----------
create table if not exists public.payments (
  id text primary key check (char_length(id) <= 200),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  plan text not null,
  days int not null,
  amount text not null default '',
  currency text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
alter table public.payments enable row level security;
drop policy if exists "payments own" on public.payments;
create policy "payments own" on public.payments for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.is_premium(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscriptions where user_id = p_user and until > now());
$$;

-- выдаёт/продлевает подписку; вызывает только сервер (service_role)
create or replace function public.grant_premium(p_user uuid, p_days int, p_pay_id text, p_provider text, p_plan text, p_amount text, p_currency text)
returns json language plpgsql security definer set search_path = public as $$
declare u timestamptz;
begin
  if p_user is null or p_days is null or p_days < 1 or p_days > 800 then raise exception 'bad_args'; end if;
  begin
    insert into public.payments (id, user_id, provider, plan, days, amount, currency)
    values (p_pay_id, p_user, p_provider, coalesce(p_plan, ''), p_days, coalesce(p_amount, ''), coalesce(p_currency, ''));
  exception when unique_violation then
    select until into u from public.subscriptions where user_id = p_user;
    return json_build_object('status', 'duplicate', 'until', u);
  end;
  insert into public.subscriptions as s (user_id, until, plan)
  values (p_user, now() + make_interval(days => p_days), coalesce(p_plan, ''))
  on conflict (user_id) do update
    set until = greatest(s.until, now()) + make_interval(days => p_days), plan = excluded.plan, updated_at = now()
  returning until into u;
  return json_build_object('status', 'ok', 'until', u);
end; $$;
revoke all on function public.grant_premium(uuid, int, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.grant_premium(uuid, int, text, text, text, text, text) to service_role;

-- ---------- бонусы: опыт ×1.5, ежедневный бонус ×2 ----------
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
    if public.is_premium(uid) then gained := gained * 2; end if;
    update public.user_stats
      set xp = xp + gained, streak = r.streak, best_streak = greatest(best_streak, r.streak), last_day = today, updated_at = now()
      where user_id = uid returning * into r;
  end if;
  return json_build_object('xp', r.xp, 'streak', r.streak, 'best_streak', r.best_streak, 'gained', gained);
end; $$;

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
  if public.is_premium(uid) then amt := ceil(amt * 1.5)::int; end if;
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

-- ---------- посты: с подпиской до 1000 символов и 120 в сутки ----------
alter table public.posts drop constraint if exists posts_body_check;
alter table public.posts drop constraint if exists posts_body_len;
alter table public.posts add constraint posts_body_len check (char_length(trim(body)) between 1 and 1000);

create or replace function public.posts_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare prem boolean := public.is_premium(new.user_id);
begin
  if char_length(trim(new.body)) > (case when prem then 1000 else 280 end) then raise exception 'too_long'; end if;
  if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'rate_limit_minute';
  end if;
  if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '1 day') >= (case when prem then 120 else 40 end) then
    raise exception 'rate_limit_day';
  end if;
  new.created_at := now();
  return new;
end; $$;

-- ---------- рамки только для подписчиков ----------
create or replace function public.premium_frames() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.frame in ('crown', 'aegis', 'radiant') and not public.is_premium(new.id) then new.frame := ''; end if;
  return new;
end; $$;
drop trigger if exists profiles_premium_frames on public.profiles;
create trigger profiles_premium_frames before insert or update of frame on public.profiles
  for each row execute function public.premium_frames();


-- ================= AI-ПОМОЩНИК =================

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "ai usage own" on public.ai_usage;
create policy "ai usage own" on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);

-- списывает один запрос: 5 в день бесплатно, 40 в день с 1x6+. Возвращает остаток или -1, если лимит исчерпан.
create or replace function public.ai_take(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Kyiv')::date;
  lim int := case when public.is_premium(p_user) then 40 else 5 end;
  cur int;
begin
  insert into public.ai_usage (user_id, day, n) values (p_user, today, 0) on conflict do nothing;
  select n into cur from public.ai_usage where user_id = p_user and day = today for update;
  if cur >= lim then return -1; end if;
  update public.ai_usage set n = n + 1 where user_id = p_user and day = today;
  return lim - cur - 1;
end; $$;
revoke all on function public.ai_take(uuid) from public, anon, authenticated;
grant execute on function public.ai_take(uuid) to service_role;
