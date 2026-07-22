# What the Stripe phase will touch

The entitlement foundation (2026-07) was built so billing is purely additive.
State lives in `public.profiles`; the plan → feature mapping lives in
`src/lib/entitlements.ts` (mirrored in `notes-app/api/anthropic.js`).

## Already in place, Stripe just fills it in

- `profiles.stripe_customer_id` — set when a customer is created at first checkout.
- `profiles.subscription_status` — webhook keeps it current (`active`,
  `trialing`, `past_due`, `canceled`). The entitlement logic already revokes
  on anything other than null/`active`/`trialing`.
- `profiles.current_period_end` — webhook writes the real period end each
  invoice. The "null = end of current calendar month" fallback in
  `deriveEntitlements` (and the notes-app mirror) becomes dead code once all
  paying rows have real values; keep it for free rows, it's harmless.
- `profiles.plans` — webhook maps Stripe subscription items → plan slugs.
  Simultaneous `almanac_pro` + `cadence_pro` = two subscription items (or two
  subscriptions) on one customer.

## New pieces the Stripe phase adds

1. **Stripe products/prices** — one product per plan slug; store the
   `price_id → plan slug` mapping next to `PLAN_GRANTS` in entitlements.ts.
2. **Webhook endpoint** (`/api/stripe/webhook` in Cadence) — the ONLY writer
   of plan fields, via service role. Handles `checkout.session.completed`,
   `customer.subscription.updated/deleted`, `invoice.paid/payment_failed`.
3. **Checkout + customer portal routes** — create checkout session (attach
   `user_id` in metadata so the webhook can find the profile row), portal for
   cancel/upgrade.
4. **Real pricing UI** — replace the "(Pricing coming soon.)" placeholder
   copy in `AgentChat.tsx`, `WeeklyGoalsForm.tsx`, and the notes-app error
   surfaces with links to the pricing/checkout page. Search for
   `upgrade_required` to find every surface.
5. **cadence_plus bundling rules** — decide upgrade path pricing (e.g. proration
   when combining almanac_pro + cadence_pro into cadence_plus).

## Testing hooks that carry over

- Plans can always be flipped manually via SQL (see the entitlements plan doc,
  Task 5) — works identically after Stripe, just gets overwritten by the next
  webhook event.
- Stripe test clocks can simulate period-end expiry against
  `current_period_end` revocation, which is already implemented and unit-tested.

## Explicitly NOT needed (already done)

- No schema migration (unless adding a `subscriptions` table for multi-period
  bookkeeping; profiles alone suffices for the current tier design).
- No changes to AI gate call sites — they read entitlements, not plans.
- No RLS changes — clients still never write plan fields.
