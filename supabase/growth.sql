-- 1x6 Билды: пробная подписка и приглашения друзей
-- Запусти целиком в Supabase → SQL Editor → New query → Run (после premium.sql). Можно запускать повторно.

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
