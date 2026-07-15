-- Add free-form "activity" label alongside the existing category (not a replacement).
-- e.g. "reading", "exercise", "hiking", "deep work". Nullable.
alter table public.schedule_blocks
  add column if not exists activity text;

alter table public.block_templates
  add column if not exists activity text;

-- Chat messages: conversation history between the user and the Cadence assistant
create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users on delete cascade not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz default now()
);
alter table public.chat_messages enable row level security;
create policy "Users manage own chat messages" on public.chat_messages
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
