# Entitlements Foundation (No Stripe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan/entitlement foundation across Cadence and Almanac — profiles table, server-side AI gates, friendly upgrade UI — with no payment processing.

**Architecture:** A `profiles` table (one row per shared-project auth user) holds a `plans text[]` set so `almanac_pro` + `cadence_pro` can be held simultaneously. One canonical plan→entitlement mapping lives in `cadence/src/lib/entitlements.ts`; `notes-app/api/anthropic.js` mirrors it (tiny, commented as a mirror). Every AI endpoint checks entitlements server-side before calling Anthropic and returns a structured `upgrade_required` 403 that both UIs render as a friendly paid-feature message.

**Tech Stack:** Supabase (Postgres/RLS/trigger), Next.js route handlers (Cadence), Vercel serverless function (Almanac), vitest.

## Global Constraints

- Plans: exactly `free` (absence of plans), `almanac_pro`, `cadence_pro`, `cadence_plus`.
- `cadence_plus` ⇒ cadence AI + almanac AI + almanac-integration entitlements.
- Stripe columns created now, left null: `stripe_customer_id`, `subscription_status`, `current_period_end`.
- Null `current_period_end` ⇒ treat as end of the current calendar month (UTC) in reading logic.
- RLS: users read own profile only; no client writes (service role/SQL only).
- 403 body shape everywhere: `{ "error": <human string>, "code": "upgrade_required", "feature": "cadence_ai"|"almanac_ai", "required_plans": [...] }`.
- PAUSE before applying the migration to the shared production DB (user runs SQL in dashboard).
- The old `user_metadata.is_ai_enabled` gate is removed, replaced by entitlements.

---

### Task 1: Profiles migration

**Files:**
- Create: `cadence/supabase/migrations/20260721000001_profiles_plans.sql`

**Interfaces:**
- Produces: `public.profiles` table (user_id PK, plans text[], subscription_status, current_period_end, stripe_customer_id, created_at, updated_at); auto-create trigger; backfill for existing users.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: PAUSE — user applies SQL in the shared project's SQL editor** (dashboard → project `jlkmbetirzgbdqmtubxt` → SQL Editor)

- [ ] **Step 3: Verify (read-only REST)**

Run: `curl -s -w "\nHTTP:%{http_code}" "$URL/rest/v1/profiles?select=user_id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"`
Expected: `[]` + HTTP:200 (RLS blocks anon), and with service key: 2 rows (both existing users backfilled).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260721000001_profiles_plans.sql
git commit -m "Add profiles table: plans, subscription fields, RLS, signup trigger"
```

### Task 2: Entitlement helper + unit tests (Cadence)

**Files:**
- Create: `cadence/src/lib/entitlements.ts`
- Test: `cadence/src/lib/entitlements.test.ts`

**Interfaces:**
- Produces: `type Entitlements = { cadenceAI: boolean; almanacAI: boolean; almanacIntegration: boolean }`, `deriveEntitlements(profile: ProfileRow | null, now?: Date): Entitlements`, `getEntitlements(supabase, userId, now?): Promise<Entitlements>`, `UPGRADE_REQUIRED` response-body builder `upgradeRequiredBody(feature: "cadence_ai" | "almanac_ai")`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { deriveEntitlements, upgradeRequiredBody } from "./entitlements";

const NOW = new Date("2026-07-21T12:00:00Z");
const profile = (overrides = {}) => ({
  plans: [], subscription_status: null, current_period_end: null, ...overrides,
});

describe("deriveEntitlements", () => {
  it("free (empty plans) has nothing", () => {
    expect(deriveEntitlements(profile(), NOW)).toEqual({
      cadenceAI: false, almanacAI: false, almanacIntegration: false,
    });
  });

  it("missing profile row has nothing", () => {
    expect(deriveEntitlements(null, NOW).cadenceAI).toBe(false);
  });

  it("almanac_pro grants almanac AI only", () => {
    const e = deriveEntitlements(profile({ plans: ["almanac_pro"] }), NOW);
    expect(e).toEqual({ cadenceAI: false, almanacAI: true, almanacIntegration: false });
  });

  it("cadence_pro grants cadence AI only", () => {
    const e = deriveEntitlements(profile({ plans: ["cadence_pro"] }), NOW);
    expect(e).toEqual({ cadenceAI: true, almanacAI: false, almanacIntegration: false });
  });

  it("almanac_pro + cadence_pro combine", () => {
    const e = deriveEntitlements(profile({ plans: ["almanac_pro", "cadence_pro"] }), NOW);
    expect(e).toEqual({ cadenceAI: true, almanacAI: true, almanacIntegration: false });
  });

  it("cadence_plus grants everything", () => {
    const e = deriveEntitlements(profile({ plans: ["cadence_plus"] }), NOW);
    expect(e).toEqual({ cadenceAI: true, almanacAI: true, almanacIntegration: true });
  });

  it("null current_period_end is valid through end of current month (UTC)", () => {
    const lastInstant = new Date("2026-07-31T23:59:59Z");
    expect(deriveEntitlements(profile({ plans: ["cadence_pro"] }), lastInstant).cadenceAI).toBe(true);
  });

  it("expired current_period_end revokes", () => {
    const e = deriveEntitlements(
      profile({ plans: ["cadence_pro"], current_period_end: "2026-07-01T00:00:00Z" }), NOW);
    expect(e.cadenceAI).toBe(false);
  });

  it("future current_period_end stays valid", () => {
    const e = deriveEntitlements(
      profile({ plans: ["cadence_pro"], current_period_end: "2026-09-01T00:00:00Z" }), NOW);
    expect(e.cadenceAI).toBe(true);
  });

  it("canceled/past_due status revokes; null and active/trialing do not", () => {
    expect(deriveEntitlements(profile({ plans: ["cadence_pro"], subscription_status: "canceled" }), NOW).cadenceAI).toBe(false);
    expect(deriveEntitlements(profile({ plans: ["cadence_pro"], subscription_status: "past_due" }), NOW).cadenceAI).toBe(false);
    expect(deriveEntitlements(profile({ plans: ["cadence_pro"], subscription_status: "active" }), NOW).cadenceAI).toBe(true);
    expect(deriveEntitlements(profile({ plans: ["cadence_pro"], subscription_status: "trialing" }), NOW).cadenceAI).toBe(true);
  });

  it("unknown plan slugs are ignored", () => {
    expect(deriveEntitlements(profile({ plans: ["enterprise"] }), NOW).cadenceAI).toBe(false);
  });
});

describe("upgradeRequiredBody", () => {
  it("names the plans that unlock the feature", () => {
    expect(upgradeRequiredBody("cadence_ai").required_plans).toEqual(["cadence_pro", "cadence_plus"]);
    expect(upgradeRequiredBody("almanac_ai").required_plans).toEqual(["almanac_pro", "cadence_plus"]);
    expect(upgradeRequiredBody("cadence_ai").code).toBe("upgrade_required");
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/entitlements.test.ts` → FAIL (module not found)

- [ ] **Step 3: Implement `entitlements.ts`**

```ts
// Single source of truth for plan → entitlement mapping.
// notes-app/api/anthropic.js mirrors deriveEntitlements for the Almanac
// serverless function — if the mapping changes, change it there too.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Plan = "almanac_pro" | "cadence_pro" | "cadence_plus";

export type ProfileRow = {
  plans: string[];
  subscription_status: string | null;
  current_period_end: string | null;
};

export type Entitlements = {
  cadenceAI: boolean;
  almanacAI: boolean;
  almanacIntegration: boolean;
};

const NONE: Entitlements = { cadenceAI: false, almanacAI: false, almanacIntegration: false };

const PLAN_GRANTS: Record<Plan, (keyof Entitlements)[]> = {
  almanac_pro:  ["almanacAI"],
  cadence_pro:  ["cadenceAI"],
  cadence_plus: ["cadenceAI", "almanacAI", "almanacIntegration"],
};

export const FEATURE_PLANS = {
  cadence_ai: ["cadence_pro", "cadence_plus"],
  almanac_ai: ["almanac_pro", "cadence_plus"],
} as const;

// No Stripe yet: null current_period_end means "valid through the end of the
// current calendar month" (UTC), and null subscription_status counts as active.
function endOfCurrentMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function deriveEntitlements(profile: ProfileRow | null, now: Date = new Date()): Entitlements {
  if (!profile || profile.plans.length === 0) return NONE;

  const status = profile.subscription_status;
  if (status !== null && status !== "active" && status !== "trialing") return NONE;

  const end = profile.current_period_end
    ? new Date(profile.current_period_end)
    : endOfCurrentMonthUTC(now);
  if (end.getTime() <= now.getTime()) return NONE;

  const out = { ...NONE };
  for (const plan of profile.plans) {
    for (const grant of PLAN_GRANTS[plan as Plan] ?? []) out[grant] = true;
  }
  return out;
}

// Reads the caller's profile under RLS (or any profile via service role).
// A missing row (user predating the profiles table trigger) is free.
export async function getEntitlements(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<Entitlements> {
  const { data, error } = await supabase
    .from("profiles")
    .select("plans, subscription_status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("profiles read failed:", error.message);
    return NONE; // fail closed — no paid calls on read errors
  }
  return deriveEntitlements(data, now);
}

export function upgradeRequiredBody(feature: keyof typeof FEATURE_PLANS) {
  const product = feature === "cadence_ai" ? "Cadence Pro" : "Almanac Pro";
  return {
    error: `This is a paid feature — it needs ${product} (or Cadence Plus).`,
    code: "upgrade_required" as const,
    feature,
    required_plans: [...FEATURE_PLANS[feature]],
  };
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/entitlements.test.ts` → PASS (13 tests)

- [ ] **Step 5: Commit** — `git add src/lib/entitlements.ts src/lib/entitlements.test.ts && git commit -m "Add entitlements module: plan→feature mapping with period fallback"`

### Task 3: Gate Cadence's AI routes + UI messages

**Files:**
- Modify: `cadence/src/app/api/agent/route.ts` (~line 806-815, the auth + is_ai_enabled section)
- Modify: `cadence/src/app/api/ai/schedule/route.ts` (lines 58-70)
- Modify: `cadence/src/components/agent/AgentChat.tsx` (error branch ~81-88)
- Modify: `cadence/src/components/goals/WeeklyGoalsForm.tsx` (error branch ~65-69)

**Interfaces:**
- Consumes: `getEntitlements`, `upgradeRequiredBody` from `@/lib/entitlements`.

- [ ] **Step 1: In both routes, replace the `is_ai_enabled` block**

In `agent/route.ts` and `ai/schedule/route.ts`, after the existing `if (!user) ... 401` guard, replace:

```ts
  const isAiEnabled = user.user_metadata?.is_ai_enabled === true;
  if (!isAiEnabled) {
    return Response.json({ error: "AI features not enabled for this account" }, { status: 403 });
  }
```

with:

```ts
  const entitlements = await getEntitlements(supabase, user.id);
  if (!entitlements.cadenceAI) {
    return Response.json(upgradeRequiredBody("cadence_ai"), { status: 403 });
  }
```

and add the import: `import { getEntitlements, upgradeRequiredBody } from "@/lib/entitlements";`

- [ ] **Step 2: AgentChat friendly message** — in the `!res.ok` branch, before the generic errText:

```ts
        const errText =
          data?.code === "upgrade_required"
            ? "The AI assistant is part of Cadence Pro. Your account is on the free plan — upgrading unlocks agent chat and AI scheduling. (Pricing coming soon.)"
            : (data && typeof data.error === "string" && data.error) ||
              "Something went wrong. Please try again.";
```

- [ ] **Step 3: WeeklyGoalsForm friendly message** — same pattern in its `!res.ok` branch:

```ts
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        body.code === "upgrade_required"
          ? "AI scheduling is part of Cadence Pro. Your account is on the free plan — upgrading unlocks it. (Pricing coming soon.)"
          : body.error ?? "Something went wrong. Try again."
      );
      return;
    }
```

- [ ] **Step 4: Typecheck + tests** — `npx tsc --noEmit && npx vitest run` → clean

- [ ] **Step 5: Commit** — `git commit -am "Gate AI routes on cadence entitlements; friendly upgrade messages"`

### Task 4: Gate Almanac's serverless function + UI messages

**Files:**
- Modify: `notes-app/api/anthropic.js` (add entitlement check after auth, ~line 119)
- Modify: `notes-app/src/aiClient.js` (parseErrorResponse: surface upgrade message, non-retryable)

**Interfaces:**
- Consumes: shared-project `profiles` table; existing `logUsage` service-client pattern.

- [ ] **Step 1: Add the mirrored check to `api/anthropic.js`** after the `getUser` 401 guard:

```js
// ── 1b. Entitlement check (mirrors cadence/src/lib/entitlements.ts) ────────
// Almanac AI requires almanac_pro or cadence_plus. No Stripe yet: null
// current_period_end = valid through end of current month (UTC); null
// status = active. Fail closed on read errors.
async function hasAlmanacAI(userId) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !SUPABASE_URL) return false;
  const service = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await service
    .from('profiles')
    .select('plans, subscription_status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return false;
  const status = data.subscription_status;
  if (status !== null && status !== 'active' && status !== 'trialing') return false;
  const now = new Date();
  const end = data.current_period_end
    ? new Date(data.current_period_end)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (end.getTime() <= now.getTime()) return false;
  return data.plans.includes('almanac_pro') || data.plans.includes('cadence_plus');
}
```

and in the handler after the 401 guard:

```js
  if (!(await hasAlmanacAI(user.id))) {
    return res.status(403).json({
      error: 'This is a paid feature — it needs Almanac Pro (or Cadence Plus).',
      code: 'upgrade_required',
      feature: 'almanac_ai',
      required_plans: ['almanac_pro', 'cadence_plus'],
    });
  }
```

- [ ] **Step 2: aiClient surfaces it nicely** — in `parseErrorResponse`, detect the code and return the friendly text verbatim (it already reads `data.error`); additionally ensure 403 is never retried (it isn't — only isRetryableStatus statuses retry). Change: keep `parseErrorResponse` but prefer `data.error` when `data.code === 'upgrade_required'` without the "AI request failed (403):" prefix:

```js
async function parseErrorResponse(response) {
  let detail = '';
  let code = null;
  try {
    const data = await response.json();
    detail = data?.error?.message || data?.error || '';
    code = data?.code || null;
  } catch {
    try { detail = await response.text(); } catch {}
  }
  if (code === 'upgrade_required' && detail) return detail; // friendly, no prefix
  return detail ? `AI request failed (${response.status}): ${detail}` : `AI request failed (HTTP ${response.status})`;
}
```

- [ ] **Step 3: Manual check** — `npm run build` in notes-app → compiles.

- [ ] **Step 4: Commit** — `git commit -am "Gate Anthropic proxy on almanac entitlement; friendly upgrade message"`

### Task 5: Test workflow (user-facing, no code)

- [ ] **Step 1: Document plan-flipping SQL** (run in shared project SQL editor; server-side, so RLS doesn't block):

```sql
-- See current state
select user_id, plans, subscription_status, current_period_end from profiles;

-- Flip your own account (user_id 19350b26-02a7-4312-9fd1-0f2b2fa0e99a):
update profiles set plans = '{}'                              where user_id = '19350b26-02a7-4312-9fd1-0f2b2fa0e99a'; -- free
update profiles set plans = '{almanac_pro}'                   where user_id = '19350b26-02a7-4312-9fd1-0f2b2fa0e99a';
update profiles set plans = '{cadence_pro}'                   where user_id = '19350b26-02a7-4312-9fd1-0f2b2fa0e99a';
update profiles set plans = '{almanac_pro,cadence_pro}'       where user_id = '19350b26-02a7-4312-9fd1-0f2b2fa0e99a';
update profiles set plans = '{cadence_plus}'                  where user_id = '19350b26-02a7-4312-9fd1-0f2b2fa0e99a';
```

- [ ] **Step 2: Throwaway free account** — sign up in Almanac as `jessalewis50+free@gmail.com` (Gmail delivers plus-aliases to the same inbox; Supabase treats it as a distinct user). Confirm via the email link; the trigger auto-creates its free profile. Never touch its plans row.

- [ ] **Step 3: Verify matrix** — free: both apps' AI blocked with friendly message; almanac_pro: Almanac AI works, Cadence blocked; cadence_pro: inverse; both/cadence_plus: everything works; usage_events keeps logging with correct app values.

### Task 6: Future-Stripe note

**Files:**
- Create: `cadence/docs/billing-stripe-phase.md`

- [ ] **Step 1: Write the note** (what Stripe phase touches: webhook → profiles writes of stripe_customer_id/subscription_status/current_period_end + plans; per-plan Stripe Products; checkout + portal pages replacing placeholder copy; remove end-of-month fallback once real period ends exist; the mirrored check in notes-app; test-clock testing).

- [ ] **Step 2: Commit** — `git add docs/billing-stripe-phase.md && git commit -m "Document what the Stripe phase will touch"`

## Self-Review

- Spec coverage: 1→Task 1, 2→Tasks 2+4, 3→Tasks 3+4, 4→Task 5, 5→Task 6. ✓
- No placeholders: all code shown in full. ✓ (Task 6 note content summarized in-plan; written fully at execution.)
- Type consistency: `deriveEntitlements(profile, now)`, `getEntitlements(supabase, userId, now)`, `upgradeRequiredBody(feature)` used consistently across Tasks 2–3; notes-app mirrors by value, not import. ✓
