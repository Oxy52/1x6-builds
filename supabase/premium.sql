-- 1x6 Билды: подписка «1x6+»
-- Запусти целиком в Supabase → SQL Editor → New query → Run (после rewards.sql и social.sql). Можно запускать повторно.

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
