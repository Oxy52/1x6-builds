-- 1x6 Билды: ВСЁ В ОДНОМ ФАЙЛЕ (профили, картинки, Арена, уровни, оценки, лента, рейтинг)
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
