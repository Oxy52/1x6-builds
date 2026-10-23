-- Запасная копия ответов OpenDota (пишет и читает только сервер /api/dota, у браузера доступа нет)
create table if not exists public.api_cache (k text primary key, body text not null, at timestamptz not null default now());
alter table public.api_cache enable row level security;
