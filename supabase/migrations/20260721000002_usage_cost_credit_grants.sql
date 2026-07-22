-- Metering: estimated cost per AI call, and top-up credit grants.
-- cost_microdollars: 1 microdollar = $0.000001; $/MTok == microdollars/token,
-- so cost = tokens x per-MTok rate with no unit conversion.
-- Rows from before metering keep null cost and are excluded from sums.

alter table public.usage_events
  add column if not exists cost_microdollars bigint;

-- Top-up credits. Server/SQL-written only. A grant applies until expires_at
-- (set to the end of the billing period it was purchased in). The future
-- Stripe phase records the payment id; manual test grants leave it null.
create table if not exists public.credit_grants (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  amount_microdollars bigint not null check (amount_microdollars > 0),
  reason              text,
  granted_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  stripe_payment_id   text
);

create index if not exists credit_grants_user_idx
  on public.credit_grants (user_id, expires_at);

alter table public.credit_grants enable row level security;
-- No client policies: deny-by-default. The server reads/writes via the
-- service role; users see their balance through the /api/usage endpoints.
