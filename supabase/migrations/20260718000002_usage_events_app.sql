-- Now that Almanac and Cadence share this project, tag each usage row with
-- the product that generated it. Both servers set this explicitly
-- ('almanac' or 'cadence'); rows from before this migration all came from
-- Cadence, so backfill them.

alter table public.usage_events
  add column if not exists app text;

update public.usage_events set app = 'cadence' where app is null;
