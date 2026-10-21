-- 1x6 Билды: обновление — чат поддержки + пробная подписка + приглашения друзей
-- Запусти целиком в Supabase → SQL Editor → New query → Run. Можно запускать повторно.


-- владелец сайта (профиль Oxy) — админ: видит все обращения и отвечает
insert into public.admins (user_id) values ('cea5467a-22bb-4791-9416-0c1b6576cada') on conflict do nothing;

create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,   -- чей это диалог
  sender text not null check (sender in ('user', 'admin')),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  read boolean not null default false,                                  -- прочитано второй стороной
  created_at timestamptz not null default now()
);
create index if not exists support_user_idx on public.support_messages (user_id, created_at);
create index if not exists support_unread_idx on public.support_messages (sender, read) where not read;
alter table public.support_messages enable row level security;

drop policy if exists "support read own or admin" on public.support_messages;
drop policy if exists "support user writes" on public.support_messages;
drop policy if exists "support admin writes" on public.support_messages;
create policy "support read own or admin" on public.support_messages for select to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());
create policy "support user writes" on public.support_messages for insert to authenticated
  with check ((select auth.uid()) = user_id and sender = 'user' and not read);
create policy "support admin writes" on public.support_messages for insert to authenticated
  with check (public.is_admin() and sender = 'admin' and not read);

-- антиспам для игроков: не больше 5 сообщений в минуту и 60 в сутки
create or replace function public.support_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sender = 'user' then
    if (select count(*) from public.support_messages where user_id = new.user_id and sender = 'user' and created_at > now() - interval '1 minute') >= 5 then raise exception 'rate_limit_minute'; end if;
    if (select count(*) from public.support_messages where user_id = new.user_id and sender = 'user' and created_at > now() - interval '1 day') >= 60 then raise exception 'rate_limit_day'; end if;
  end if;
  new.created_at := now();
  return new;
end; $$;
drop trigger if exists support_rate_limit on public.support_messages;
create trigger support_rate_limit before insert on public.support_messages for each row execute function public.support_rate_limit();

-- отметить прочитанным: игрок читает ответы админа в своём диалоге, админ — сообщения игрока
create or replace function public.support_mark_read(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.is_admin() and p_user is not null and p_user <> auth.uid() then
    update public.support_messages set read = true where user_id = p_user and sender = 'user' and not read;
  else
    update public.support_messages set read = true where user_id = auth.uid() and sender = 'admin' and not read;
  end if;
end; $$;
revoke all on function public.support_mark_read(uuid) from public, anon;
grant execute on function public.support_mark_read(uuid) to authenticated;

-- список диалогов для админа
create or replace view public.support_threads with (security_invoker = true) as
  select m.user_id,
         max(m.created_at) as last_at,
         (array_agg(m.body order by m.created_at desc))[1] as last_body,
         (array_agg(m.sender order by m.created_at desc))[1] as last_sender,
         count(*) filter (where m.sender = 'user' and not m.read) as unread,
         count(*) as total,
         p.nick, p.avatar, p.frame
  from public.support_messages m
  left join public.profiles p on p.id = m.user_id
  group by m.user_id, p.nick, p.avatar, p.frame;
grant select on public.support_threads to authenticated;

-- мгновенная доставка сообщений (Realtime)
do $$ begin
  alter publication supabase_realtime add table public.support_messages;
exception when duplicate_object then null; when undefined_object then null; end $$;


-- ---------- 3 дня 1x6+ бесплатно (один раз на аккаунт) ----------
create or replace function public.claim_trial()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); u timestamptz;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.payments where user_id = uid) or exists (select 1 from public.subscriptions where user_id = uid) then
    raise exception 'trial_used';
  end if;
  insert into public.payments (id, user_id, provider, plan, days) values ('trial:' || uid, uid, 'trial', 'trial', 3);
  insert into public.subscriptions (user_id, until, plan) values (uid, now() + interval '3 days', 'trial') returning until into u;
  return json_build_object('until', u);
end; $$;
revoke all on function public.claim_trial() from public, anon;
grant execute on function public.claim_trial() to authenticated;

-- ---------- приглашения: друг +50 опыта, ты +100, за каждых 3 друзей — неделя 1x6+ ----------
create table if not exists public.referrals (
  invitee uuid primary key references auth.users(id) on delete cascade,
  inviter uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists referrals_inviter_idx on public.referrals (inviter);
alter table public.referrals enable row level security;
drop policy if exists "referrals own" on public.referrals;
create policy "referrals own" on public.referrals for select to authenticated
  using ((select auth.uid()) in (inviter, invitee));

create or replace function public.claim_ref(p_inviter uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int; u timestamptz;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_inviter is null or p_inviter = uid then raise exception 'bad_inviter'; end if;
  if not exists (select 1 from public.profiles where id = p_inviter) then raise exception 'bad_inviter'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'no_profile'; end if;
  -- засчитываем только новые аккаунты (зарегистрированы не раньше чем 3 дня назад)
  if (select created_at from auth.users where id = uid) < now() - interval '3 days' then raise exception 'too_old'; end if;
  if exists (select 1 from public.referrals where invitee = uid) then raise exception 'already'; end if;
  insert into public.referrals (invitee, inviter) values (uid, p_inviter);
  insert into public.user_stats (user_id) values (uid), (p_inviter) on conflict do nothing;
  update public.user_stats set xp = xp + 50, updated_at = now() where user_id = uid;
  update public.user_stats set xp = xp + 100, updated_at = now() where user_id = p_inviter;
  select count(*) into n from public.referrals where inviter = p_inviter;
  if n % 3 = 0 then
    insert into public.payments (id, user_id, provider, plan, days) values ('ref:' || p_inviter || ':' || n, p_inviter, 'referral', 'ref', 7) on conflict do nothing;
    insert into public.subscriptions as s (user_id, until, plan) values (p_inviter, now() + interval '7 days', 'ref')
      on conflict (user_id) do update set until = greatest(s.until, now()) + interval '7 days', updated_at = now()
      returning until into u;
  end if;
  return json_build_object('status', 'ok', 'inviter_total', n);
end; $$;
revoke all on function public.claim_ref(uuid) from public, anon;
grant execute on function public.claim_ref(uuid) to authenticated;
