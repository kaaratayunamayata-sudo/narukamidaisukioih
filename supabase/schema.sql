-- Run this SQL in Supabase SQL Editor.
create table if not exists public.race_state (
  id integer primary key check (id = 1),
  state jsonb not null default '{"running":false,"paused":false,"winner":null}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.race_state (id, state)
values (1, '{"running":false,"paused":false,"winner":null}'::jsonb)
on conflict (id) do nothing;

alter table public.race_state enable row level security;
-- Public clients can read the shared race state. Only the Netlify function
-- uses the service-role key to write it.
drop policy if exists "race state readable by everyone" on public.race_state;
create policy "race state readable by everyone"
on public.race_state for select to anon, authenticated using (true);

-- Realtime broadcast and presence use Supabase Realtime channels.
-- The service role key is server-only and must never be placed in frontend files.
