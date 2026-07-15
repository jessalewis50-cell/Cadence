-- Optional free-form activity label for a habit. Lets a habit's display name
-- (e.g. "Read 15 min") differ from the activity it matches on the schedule
-- (e.g. "reading"). When null, matching falls back to the habit name.
alter table public.habits
  add column if not exists activity text;
