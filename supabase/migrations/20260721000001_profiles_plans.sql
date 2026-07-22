-- Plan/entitlement foundation (no payment processing yet).
-- One profile row per auth user, auto-created on signup. plans is the set of
-- held plan slugs — a user may hold almanac_pro and cadence_pro at once;
-- free is the empty set. Stripe columns exist now (all null) so the future
-- billing phase is purely additive. Plan fields are server-written only.

create table if not exists public.profiles (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  plans               text[] not null default '{}',
  subscription_status text,
  current_period_end  timestamptz,
  stripe_customer_id  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint profiles_plans_valid
    check (plans <@ array['almanac_pro','cadence_pro','cadence_plus'])
);

alter table public.profiles enable row level security;

-- Clients may read their own profile. There are deliberately no insert/
-- update/delete policies: client writes are denied by default, and the
-- server (service role) bypasses RLS.
create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

-- Every new auth user gets a free profile automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: existing users get a free profile.
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;
