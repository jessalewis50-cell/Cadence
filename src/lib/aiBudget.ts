// AI usage metering: model pricing, plan allowances, billing periods, and the
// combined entitlement + budget gate used by every AI endpoint.
// notes-app/api/anthropic.js and supabase/functions/nightly-insights mirror
// the pricing/period math (keep the three in sync).
//
// Units: 1 microdollar = $0.000001. Price per MTok == microdollars per token,
// so cost = tokens x rate with no unit conversion.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveEntitlements,
  upgradeRequiredBody,
  type Entitlements,
  type ProfileRow,
} from "./entitlements";

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-4-6":          { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5":           { input: 1, output: 5,  cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-haiku-4-5-20251001":  { input: 1, output: 5,  cacheRead: 0.1, cacheWrite: 1.25 },
};

// Unknown models bill at our most expensive known rate — a new model must be
// added here before it can be under-billed.
const FALLBACK_PRICE = MODEL_PRICES["claude-sonnet-4-6"];

export function estimateCostMicrodollars(model: string, u: TokenUsage): number {
  const p = MODEL_PRICES[model] ?? FALLBACK_PRICE;
  return Math.ceil(
    u.input_tokens * p.input +
    u.output_tokens * p.output +
    u.cache_read_tokens * p.cacheRead +
    u.cache_write_tokens * p.cacheWrite
  );
}

// Monthly allowance of underlying AI cost per plan. A user holding several
// plans gets the sum — one shared spend pool across both apps.
export const PLAN_ALLOWANCES_MICRODOLLARS: Record<string, number> = {
  almanac_pro:  3_000_000, // $3
  cadence_pro:  3_000_000, // $3
  cadence_plus: 8_000_000, // $8, shared across both apps
};

export function planAllowanceMicrodollars(plans: string[]): number {
  return plans.reduce((sum, p) => sum + (PLAN_ALLOWANCES_MICRODOLLARS[p] ?? 0), 0);
}

// No Stripe yet: null current_period_end means the current UTC calendar month.
// With a real period end, the period is the month leading up to it.
export function billingPeriod(
  profile: ProfileRow | null,
  now: Date = new Date()
): { start: Date; end: Date } {
  if (profile?.current_period_end) {
    const end = new Date(profile.current_period_end);
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    return { start, end };
  }
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export type Meter = {
  allowance_microdollars: number;
  credit_microdollars: number;
  budget_microdollars: number;
  used_microdollars: number;
  remaining_microdollars: number;
  percent_used: number; // 0-100 of budget; 100 when budget is 0
  resets_at: string;    // ISO timestamp
};

// Sums this period's spend and unexpired credit grants. Row counts are tiny at
// this scale (dozens of AI calls/user/month), so summing client-side is fine.
export async function computeMeter(
  service: SupabaseClient,
  userId: string,
  profile: ProfileRow | null,
  now: Date = new Date()
): Promise<Meter> {
  const { start, end } = billingPeriod(profile, now);
  const allowance = planAllowanceMicrodollars(profile?.plans ?? []);

  const [{ data: usageRows, error: usageErr }, { data: grantRows, error: grantErr }] =
    await Promise.all([
      service
        .from("usage_events")
        .select("cost_microdollars")
        .eq("user_id", userId)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString()),
      service
        .from("credit_grants")
        .select("amount_microdollars")
        .eq("user_id", userId)
        .gt("expires_at", now.toISOString()),
    ]);
  if (usageErr) console.warn("usage sum failed:", usageErr.message);
  if (grantErr) console.warn("credit sum failed:", grantErr.message);

  const used = (usageRows ?? []).reduce(
    (s, r) => s + (r.cost_microdollars ?? 0), 0);
  const credits = (grantRows ?? []).reduce(
    (s, r) => s + (r.amount_microdollars ?? 0), 0);
  const budget = allowance + credits;

  return {
    allowance_microdollars: allowance,
    credit_microdollars: credits,
    budget_microdollars: budget,
    used_microdollars: used,
    remaining_microdollars: Math.max(0, budget - used),
    percent_used: budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 100,
    resets_at: end.toISOString(),
  };
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function limitReachedBody(feature: "cadence_ai" | "almanac_ai", meter: Meter) {
  return {
    error:
      `You've used all your AI credits for this period — they reset on ` +
      `${shortDate(meter.resets_at)}. Top-ups are coming soon.`,
    code: "limit_reached" as const,
    feature,
    used_microdollars: meter.used_microdollars,
    budget_microdollars: meter.budget_microdollars,
    resets_at: meter.resets_at,
  };
}

export type AiAccess =
  | { ok: true; meter: Meter; entitlements: Entitlements }
  | { ok: false; status: 403 | 402; body: Record<string, unknown> };

// The one gate every AI endpoint calls before contacting Anthropic:
// (a) entitlement, (b) budget. Checked once per user request — an agent tool
// loop may overshoot by at most one message's cost, which is acceptable.
export async function checkAiAccess(
  supabase: SupabaseClient, // caller's RLS client (reads own profile)
  service: SupabaseClient,  // service-role client (usage_events / credit_grants)
  userId: string,
  feature: "cadence_ai" | "almanac_ai",
  now: Date = new Date()
): Promise<AiAccess> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("plans, subscription_status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) console.warn("profiles read failed:", error.message);

  const ents = deriveEntitlements(error ? null : profile, now);
  const entitled = feature === "cadence_ai" ? ents.cadenceAI : ents.almanacAI;
  if (!entitled) return { ok: false, status: 403, body: upgradeRequiredBody(feature) };

  const meter = await computeMeter(service, userId, profile ?? null, now);
  if (meter.used_microdollars >= meter.budget_microdollars) {
    return { ok: false, status: 402, body: limitReachedBody(feature, meter) };
  }
  return { ok: true, meter, entitlements: ents };
}
