-- Almanac (notes app) tables, moving into this shared Supabase project.
-- Almanac stays a separate frontend, but shares this project's auth users;
-- keeping its schema here keeps the whole shared database documented in
-- one migrations folder.
--
-- Schema reconstructed from notes-app/src/App.js queries:
--   folders: insert({ name, user_id }), ordered by created_at
--   notes:   insert({ title, content, user_id, folder_id }),
--            update({ title, content, updated_at }), ordered by updated_at desc
-- Handwriting strokes are never persisted to the database.

create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'New Folder',
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- The app deletes a folder's notes explicitly before deleting the folder;
  -- SET NULL is only a safety net (an orphaned note falls back to "All notes"
  -- rather than being destroyed by the database).
  folder_id  uuid references public.folders(id) on delete set null,
  title      text not null default 'Untitled',
  content    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists folders_user_idx        on public.folders (user_id);
create index if not exists notes_user_updated_idx  on public.notes (user_id, updated_at desc);
create index if not exists notes_folder_idx        on public.notes (folder_id);

alter table public.folders enable row level security;
alter table public.notes   enable row level security;

create policy "Users manage own folders"
  on public.folders
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own notes"
  on public.notes
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
