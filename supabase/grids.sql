-- Aegis: мастерская сеток героев Dota 2
-- Запусти целиком в Supabase → SQL Editor → New query → Run. Можно запускать повторно.

create table if not exists public.grids (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nick text not null default 'Игрок' check (char_length(nick) <= 40),
  name text not null check (char_length(name) between 1 and 60),
  data jsonb not null check (octet_length(data::text) < 600000),
  likes int not null default 0,
  downloads int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists grids_new_idx on public.grids (created_at desc);
create index if not exists grids_top_idx on public.grids (likes desc);
alter table public.grids enable row level security;
drop policy if exists "grids read" on public.grids;
create policy "grids read" on public.grids for select to anon, authenticated using (true);
drop policy if exists "grids insert own" on public.grids;
create policy "grids insert own" on public.grids for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "grids delete own" on public.grids;
create policy "grids delete own" on public.grids for delete to authenticated using (user_id = (select auth.uid()));

create table if not exists public.grid_likes (
  grid_id bigint not null references public.grids(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (grid_id, user_id)
);
alter table public.grid_likes enable row level security;
drop policy if exists "grid likes read" on public.grid_likes;
create policy "grid likes read" on public.grid_likes for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "grid likes add" on public.grid_likes;
create policy "grid likes add" on public.grid_likes for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "grid likes remove" on public.grid_likes;
create policy "grid likes remove" on public.grid_likes for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.grid_likes_count() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.grids set likes = (select count(*) from public.grid_likes where grid_id = coalesce(new.grid_id, old.grid_id)) where id = coalesce(new.grid_id, old.grid_id);
  return null;
end; $$;
drop trigger if exists grid_likes_count on public.grid_likes;
create trigger grid_likes_count after insert or delete on public.grid_likes for each row execute function public.grid_likes_count();

create or replace function public.grid_dl(gid bigint) returns void language sql security definer set search_path = public as $$
  update public.grids set downloads = downloads + 1 where id = gid;
$$;
grant execute on function public.grid_dl(bigint) to anon, authenticated;
