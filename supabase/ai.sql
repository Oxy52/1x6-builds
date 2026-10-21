-- 1x6 Билды: лимиты AI-помощника (билды Custom Hero Chaos, AI-пикер)
-- Запусти целиком в Supabase → SQL Editor → New query → Run (после premium.sql). Можно запускать повторно.

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
