create table if not exists public.block_templates (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  title              text not null,
  category           text not null check (category in ('deep', 'body', 'break', 'admin')),
  duration_minutes   integer not null default 60,
  default_start_time text,   -- "HH:MM" or null
  recurrence_days    integer[] not null default '{}',
  position           integer not null default 0,
  created_at         timestamptz not null default now()
);

alter table public.block_templates enable row level security;

create policy "Users manage own templates"
  on public.block_templates
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
