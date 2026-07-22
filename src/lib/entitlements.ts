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

export function deriveEntitlements(
  profile: ProfileRow | null,
  now: Date = new Date()
): Entitlements {
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
// A missing row (user predating the profiles trigger) is free.
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
