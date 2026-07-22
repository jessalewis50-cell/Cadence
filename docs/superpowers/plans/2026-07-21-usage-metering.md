# AI Usage Metering & Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce monthly AI cost allowances per plan across both apps, with per-call cost logging, a user-facing "AI credits" meter, and manually-grantable top-up credits (no Stripe).

**Architecture:** A `cost_microdollars` column on `usage_events` records the estimated Anthropic cost of every call ($/MTok == microdollars/token, so cost = Σ tokens×rate). One Cadence lib module (`src/lib/aiBudget.ts`) owns pricing, allowances, billing-period math, meter computation, and the combined entitlement+budget gate `checkAiAccess()`; every Cadence AI route calls it, notes-app's serverless function mirrors it (as it already mirrors entitlements). A `credit_grants` table holds top-ups (server-written, expire at period end). `/api/usage` endpoints in both apps feed small "AI credits: N% used" UI meters.

**Tech Stack:** Supabase (Postgres/RLS), Next.js routes, Vercel serverless, Deno edge function, vitest.

## Global Constraints

- Prices (microdollars/token): sonnet-4-6 = in 3 / out 15 / cacheRead 0.3 / cacheWrite 3.75; haiku-4-5 = 1 / 5 / 0.1 / 1.25. Unknown model → sonnet rates (fail-expensive).
- Allowances (microdollars/period): almanac_pro 3,000,000; cadence_pro 3,000,000; cadence_plus 8,000,000; free 0. A user holding multiple plans gets the SUM (one shared spend pool per user across both apps).
- Top-up grants: $3 purchase → 1,500,000 µ$; $5 purchase → 3,000,000 µ$. No purchase flow yet — manual SQL inserts; grants expire at period end (`expires_at`).
- Billing period: `[current_period_end - 1 month, current_period_end)`; when `current_period_end` is null → current UTC calendar month.
- Limit response: HTTP 402, body `{ error, code: "limit_reached", feature, used_microdollars, budget_microdollars, resets_at }`.
- Agent loop: budget checked ONCE per user message; every Anthropic call in the loop is logged with cost. Overshoot ≤ one message's cost (~$0.05–0.15) — acceptable.
- Race window: two concurrent requests can both pass the check → overshoot ≤ one call's cost. Acceptable at this scale; no locking.
- PAUSE before applying the migration (user pastes SQL in dashboard).
- Old usage rows have null cost → excluded from sums (they predate metering; only this month's nulls matter and there are few).

---

### Task 1: Migration — cost column + credit_grants

**Files:** Create `cadence/supabase/migrations/20260721000002_usage_cost_credit_grants.sql`

```sql
-- Metering: estimated cost per AI call, and top-up credit grants.
-- cost_microdollars: 1 microdollar = $0.000001; $/MTok == microdollars/token.
-- Rows from before metering keep null cost and are excluded from sums.

alter table public.usage_events
  add column if not exists cost_microdollars bigint;

-- Top-up credits. Server/SQL-written only. A grant applies until expires_at
-- (set to the end of the billing period it was purchased in).
create table if not exists public.credit_grants (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  amount_microdollars bigint not null check (amount_microdollars > 0),
  reason              text,
  granted_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  stripe_payment_id   text
);

create index if not exists credit_grants_user_idx on public.credit_grants (user_id, expires_at);

alter table public.credit_grants enable row level security;
-- No client policies: deny-by-default. Server reads/writes via service role.
```

Steps: write file → PAUSE for user to apply → verify via REST (`credit_grants` 200/empty with anon; `usage_events?select=cost_microdollars` 200) → commit.

### Task 2: `src/lib/aiBudget.ts` + unit tests (TDD)

**Interfaces produced:**
- `estimateCostMicrodollars(model: string, u: TokenUsage): number` (ceil; TokenUsage = {input_tokens, output_tokens, cache_read_tokens, cache_write_tokens})
- `planAllowanceMicrodollars(plans: string[]): number`
- `billingPeriod(profile: ProfileRow | null, now?: Date): { start: Date; end: Date }`
- `computeMeter(service, userId, profile, now?): Promise<Meter>` — Meter = {allowance_microdollars, credit_microdollars, budget_microdollars, used_microdollars, remaining_microdollars, percent_used, resets_at}
- `checkAiAccess(supabase, service, userId, feature, now?): Promise<{ok:true; meter} | {ok:false; status:403|402; body}>` — 403 = upgradeRequiredBody (existing), 402 = limitReachedBody
- `limitReachedBody(feature, meter)` — friendly copy: "You've used all your AI credits for this period — they reset on {Mon D}. Top-ups coming soon."

Tests (`aiBudget.test.ts`): sonnet cost math incl. cache tokens + ceil; haiku rates; unknown model falls back to sonnet; allowance sums for plan combos (free 0, single 3M, both singles 6M, plus 8M); period from null profile = calendar month UTC; period from set current_period_end; meter math (used vs budget, percent, remaining clamps ≥0 display); limit body shape. Mock supabase for computeMeter via a stub with canned rows.

Steps: failing tests → implement → `npx vitest run` → `npx tsc --noEmit` → commit.

### Task 3: Wire Cadence routes to the shared gate + cost logging

**`/api/agent/route.ts`:**
- Replace the entitlement block with:
```ts
  const service = createServiceClient();
  const access = await checkAiAccess(supabase, service, user.id, "cadence_ai");
  if (!access.ok) return Response.json(access.body, { status: access.status });
```
  (service client already created later in the file — hoist/reuse one instance.)
- In `logUsage`, add `cost_microdollars: estimateCostMicrodollars(model, {...usage-mapped fields})` to the insert.

**`/api/ai/schedule/route.ts`:**
- Same gate replacement (needs `createServiceClient` import).
- THIS ROUTE CURRENTLY LOGS NOTHING — after the `anthropic.messages.create` call, insert a usage_events row: user_id, app "cadence", model "claude-sonnet-4-6", token fields from `message.usage`, cost via estimate. Best-effort (console.warn on failure).

**UI (limit state):** In AgentChat + WeeklyGoalsForm error branches, extend the `upgrade_required` mapping: `code === "limit_reached"` → show server's `error` string verbatim (it's already friendly copy).

Steps: edits → tsc + vitest → commit.

### Task 4: Nightly-insights edge function

Read `supabase/functions/nightly-insights/index.ts`. Add per-user: (a) skip users whose meter has no remaining budget (compute via same math — small inline mirror or shared SQL), (b) after each Haiku call, insert usage_events row with app "cadence", model, tokens, cost (haiku rates). Keep the function deployable standalone (Deno; can't import src/lib — mirror the tiny price constants with a sync-comment, same pattern as notes-app).

### Task 5: Almanac serverless mirror + cost logging

**`api/anthropic.js`:**
- Extend the profile check into the full gate: after entitlement passes, compute meter (usage sum + grants sum via service client, same period math mirrored in JS) and return 402 `limit_reached` body when spent ≥ budget.
- In `logUsage`, compute `cost_microdollars` (sonnet rates; model is always claude-sonnet-4-6) and include in the insert. Streaming path already accumulates usage — works unchanged.

**`api/usage.js` (new):** GET endpoint, same auth pattern as anthropic.js (bearer token → getUser), returns the meter JSON for the caller.

**`src/aiClient.js`:** `parseErrorResponse` treats `code === "limit_reached"` like `upgrade_required` (verbatim message, non-retryable). App.js OCR path: same extension of the existing upgrade_required branch.

Steps: edits → `npx react-scripts build` → commit.

### Task 6: Cadence `/api/usage` + meter UI in both apps

**Cadence:** `src/app/api/usage/route.ts` GET → auth user → computeMeter → JSON. New `src/components/usage/UsageMeter.tsx` (client): fetches /api/usage, renders one line + thin progress bar in Cadence's tokens (bg-panel/border-line/text-faint classes): "AI credits · 62% used — resets Aug 1" + subtle "Get more credits" button (title="Top-ups coming soon: $3 → $1.50, $5 → $3.00 of credits"; no-op). Free user (budget 0): "AI features are part of Cadence Pro". Mount it in the agent page near AgentChat.

**Almanac:** small `UsageMeter` function component inside App.js (matches its in-file component style), fetched via authHeaders() from /api/usage, rendered at the sidebar bottom for signed-in users; same copy; "Get more credits" no-op button with same title text. Guest mode: hidden.

Steps: build both, screenshot-check styles roughly match, commit.

### Task 7: Docs + user test workflow

- Update `docs/billing-stripe-phase.md`: top-up checkout ($3/$5 one-time payments → 1.5M/3M µ$ grants written by webhook into credit_grants with stripe_payment_id + expires_at = current_period_end).
- Deliver to user (chat): plan-flip SQL recap, limit-simulation SQL (insert fake high-cost usage row), credit-grant SQL, Anthropic Console spend-limit instructions.

## Self-Review

- Spec 1 → Tasks 2/3/4/5 (one pattern: checkAiAccess in Cadence lib, mirrored in notes-app; schedule logging fixed; nightly-insights included). Spec 2 → Task 3 + Global Constraints (once-per-message check, overshoot documented). Spec 3 → Tasks 1/7 (credit_grants + manual insert). Spec 4 → Task 6 (+ limit copy in Tasks 3/5). Spec 5 → Task 2 tests + Task 7 (simulation + Anthropic spend cap). Tradeoffs (race, overshoot) → Global Constraints, explained to user at handoff. ✓
- Types consistent: Meter/TokenUsage defined once in Task 2, consumed by 3/5/6. ✓
