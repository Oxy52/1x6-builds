-- Стиль ника (шрифт, эффект, цвет) и анимированные аватарки/баннеры — только для подписчиков 1x6+
alter table public.profiles add column if not exists name_style text not null default '';
alter table public.profiles drop constraint if exists profiles_name_style_len;
alter table public.profiles add constraint profiles_name_style_len check (char_length(name_style) <= 40);

create or replace function public.premium_profile_extras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_premium(new.id) then
    new.name_style := '';
    if new.avatar ~ '^anim:' or new.avatar ~* '^url:.*\.(gif|webp)$' then new.avatar := ''; end if;
    if new.banner ~ '^anim:' or new.banner ~* '^url:.*\.(gif|webp)$' then new.banner := 'grad'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists profiles_premium_extras on public.profiles;
create trigger profiles_premium_extras before insert or update of avatar, banner, name_style on public.profiles
  for each row execute function public.premium_profile_extras();

-- v2: тег до 12 символов (и по-русски), мат и 18+ в стиле ника сбрасываются; иконку тега пишет только сервер (/api/tagicon проверяет её на 18+)
alter table public.profiles drop constraint if exists profiles_name_style_len;
alter table public.profiles add constraint profiles_name_style_len check (char_length(name_style) <= 64);

create or replace function public.premium_profile_extras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_premium(new.id) then
    new.name_style := '';
    if new.avatar ~ '^anim:' or new.avatar ~* '^url:.*\.(gif|webp)$' then new.avatar := ''; end if;
    if new.banner ~ '^anim:' or new.banner ~* '^url:.*\.(gif|webp)$' then new.banner := 'grad'; end if;
  end if;
  if new.name_style ~* '(х[уy][йиеёяю]|п[иі1]зд|[её]б[аaлуи]|бля|муд[аи]к|пид[оа]р|гандон|шлюх|залуп|fuck|shit|bitch|porn|n[i1]gg|fag|cunt|dick|pussy|hitler|nazi|sex)' then new.name_style := ''; end if;
  return new;
end; $$;

drop policy if exists "media upload own folder" on storage.objects;
drop policy if exists "media update own folder" on storage.objects;
create policy "media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text and storage.filename(name) <> 'tag.png');
create policy "media update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text and storage.filename(name) <> 'tag.png');
