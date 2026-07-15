-- Per-user Anthropic API usage log. Written only by the server via the service
-- role (which bypasses RLS); clients have no access.
create table if not exists public.usage_events (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users on delete cascade,
  created_at         timestamptz default now(),
  model              text,
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer default 0,
  cache_write_tokens integer default 0
);

alter table public.usage_events enable row level security;

-- Block all client (anon / authenticated) reads and writes. The server uses the
-- service role, which bypasses RLS and is unaffected by this policy.
create policy "No client access to usage_events"
  on public.usage_events
  for all
  using (false)
  with check (false);
