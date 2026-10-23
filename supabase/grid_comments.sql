-- Aegis: комментарии к сеткам в мастерской
-- Запусти целиком в Supabase → SQL Editor → New query → Run. Можно запускать повторно.

create table if not exists public.grid_comments (
  id bigserial primary key,
  grid_id bigint not null references public.grids(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nick text not null default 'Игрок' check (char_length(nick) <= 40),
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists grid_comments_grid_idx on public.grid_comments (grid_id, created_at);
alter table public.grid_comments enable row level security;

drop policy if exists "grid comments read" on public.grid_comments;
create policy "grid comments read" on public.grid_comments for select to anon, authenticated using (true);

drop policy if exists "grid comments add" on public.grid_comments;
create policy "grid comments add" on public.grid_comments for insert to authenticated with check (user_id = (select auth.uid()));

-- удалить может автор комментария, автор сетки или админ сайта
drop policy if exists "grid comments delete" on public.grid_comments;
create policy "grid comments delete" on public.grid_comments for delete to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.grids g where g.id = grid_id and g.user_id = (select auth.uid()))
  or exists (select 1 from public.admins a where a.user_id = (select auth.uid()))
);

-- не больше 5 комментариев в минуту от одного человека (защита от спама)
create or replace function public.grid_comments_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.grid_comments where user_id = new.user_id and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'too_fast';
  end if;
  return new;
end; $$;
drop trigger if exists grid_comments_limit on public.grid_comments;
create trigger grid_comments_limit before insert on public.grid_comments for each row execute function public.grid_comments_limit();
