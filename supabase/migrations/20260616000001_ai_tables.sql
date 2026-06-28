-- Add AI metadata columns to existing schedule_blocks table
alter table public.schedule_blocks
  add column if not exists source text check (source in ('manual', 'ai', 'template')) default 'manual',
  add column if not exists detail text;

-- Weekly goals: user's intentions for the week
create table if not exists public.weekly_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  week_start date not null,
  title text not null,
  category text not null default 'deep',
  detail text,
  desired_sessions integer not null default 1,
  time_preference text check (time_preference in ('morning', 'afternoon', 'evening', 'any')),
  priority integer not null default 2,
  position integer not null default 0,
  created_at timestamptz default now()
);
alter table public.weekly_goals enable row level security;
create policy "Users manage own goals" on public.weekly_goals
  for all using (auth.uid() = user_id);

-- Daily debriefs: end-of-day mood + completion rate
create table if not exists public.daily_debriefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  day date not null,
  mood text not null check (mood in ('great', 'okay', 'rough')),
  note text,
  planned_blocks integer not null default 0,
  completed_blocks integer not null default 0,
  completion_rate numeric(4,3),
  created_at timestamptz default now(),
  unique(user_id, day)
);
alter table public.daily_debriefs enable row level security;
create policy "Users manage own debriefs" on public.daily_debriefs
  for all using (auth.uid() = user_id);

-- Daily insights: AI-generated nightly insight (paid tier only)
create table if not exists public.daily_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  generated_at date not null,
  insight text not null,
  confidence text check (confidence in ('low', 'medium', 'high')),
  created_at timestamptz default now(),
  unique(user_id, generated_at)
);
alter table public.daily_insights enable row level security;
create policy "Users read own insights" on public.daily_insights
  for select using (auth.uid() = user_id);

-- Schedule corrections: records every user edit to AI-generated blocks (behavioral flywheel)
create table if not exists public.schedule_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  block_id uuid references public.schedule_blocks on delete cascade,
  correction_type text not null check (correction_type in ('reschedule', 'delete', 'resize', 'retitle')),
  original_start_time text,
  new_start_time text,
  original_duration_minutes integer,
  new_duration_minutes integer,
  created_at timestamptz default now()
);
alter table public.schedule_corrections enable row level security;
create policy "Users log own corrections" on public.schedule_corrections
  for all using (auth.uid() = user_id);
