-- 1x6 Билды: посты (как в Твиттере), лайки, ответы, админы
-- Запусти целиком в Supabase → SQL Editor → New query → Run
-- (после setup.sql, runner.sql и rewards.sql)

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
