-- 1x6 Билды: рейтинг мини-игры «Раннер по линии»
-- Запусти целиком в Supabase → SQL Editor → New query → Run

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

create or replace view public.runner_top with (security_invoker = true) as
  select s.user_id, s.best, s.games, p.nick, p.avatar
  from public.runner_scores s
  join public.profiles p on p.id = s.user_id
  where s.best > 0
  order by s.best desc
  limit 100;
grant select on public.runner_top to anon, authenticated;
