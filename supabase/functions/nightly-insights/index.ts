import Anthropic from "npm:@anthropic-ai/sdk@^0.104.2";

const WARN_AT  = 100;
const STOP_AT  = 150;

const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")!;
const anthropicKey   = Deno.env.get("ANTHROPIC_API_KEY")!;

const anthropic = new Anthropic({ apiKey: anthropicKey });

// ── Metering (mirrors src/lib/aiBudget.ts — keep in sync) ────────────────────
// Haiku 4.5 microdollars/token; allowances per plan; calendar-month fallback.
const HAIKU_PRICE = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
const PLAN_ALLOWANCES: Record<string, number> = {
  almanac_pro: 3_000_000,
  cadence_pro: 3_000_000,
  cadence_plus: 8_000_000,
};

type ProfileRow = {
  user_id: string;
  plans: string[];
  subscription_status: string | null;
  current_period_end: string | null;
};

function hasCadenceAI(p: ProfileRow, now: Date): boolean {
  if (!p.plans.includes("cadence_pro") && !p.plans.includes("cadence_plus")) return false;
  const s = p.subscription_status;
  if (s !== null && s !== "active" && s !== "trialing") return false;
  const end = p.current_period_end
    ? new Date(p.current_period_end)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return end.getTime() > now.getTime();
}

function billingPeriod(p: ProfileRow, now: Date): { start: Date; end: Date } {
  if (p.current_period_end) {
    const end = new Date(p.current_period_end);
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    return { start, end };
  }
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

async function hasBudgetLeft(p: ProfileRow, now: Date): Promise<boolean> {
  const { start, end } = billingPeriod(p, now);
  const allowance = p.plans.reduce((s, plan) => s + (PLAN_ALLOWANCES[plan] ?? 0), 0);
  const [usageRes, grantsRes] = await Promise.all([
    supabaseFetch(
      `usage_events?user_id=eq.${p.user_id}&created_at=gte.${start.toISOString()}` +
      `&created_at=lt.${end.toISOString()}&select=cost_microdollars`
    ),
    supabaseFetch(
      `credit_grants?user_id=eq.${p.user_id}&expires_at=gt.${now.toISOString()}` +
      `&select=amount_microdollars`
    ),
  ]);
  const usage = await usageRes.json();
  const grants = await grantsRes.json();
  const used = (Array.isArray(usage) ? usage : []).reduce(
    (s: number, r: { cost_microdollars: number | null }) => s + (r.cost_microdollars ?? 0), 0);
  const credits = (Array.isArray(grants) ? grants : []).reduce(
    (s: number, r: { amount_microdollars: number }) => s + (r.amount_microdollars ?? 0), 0);
  return used < allowance + credits;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function supabaseFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      "apikey":        serviceRoleKey,
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type":  "application/json",
      "Prefer":        "return=minimal",
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

async function generateInsightForUser(userId: string): Promise<string | null> {
  const cutoff = daysAgoStr(14);

  const [debriefsRes, blocksRes, correctionsRes] = await Promise.all([
    supabaseFetch(`daily_debriefs?user_id=eq.${userId}&day=gte.${cutoff}&order=day.desc`),
    supabaseFetch(`schedule_blocks?user_id=eq.${userId}&day=gte.${cutoff}&order=day.desc&select=day,category,title,done`),
    supabaseFetch(`schedule_corrections?user_id=eq.${userId}&created_at=gte.${cutoff}T00:00:00Z&select=correction_type,original_start_time,new_start_time`),
  ]);

  const debriefs   = await debriefsRes.json();
  const blocks     = await blocksRes.json();
  const corrections = await correctionsRes.json();

  if (!Array.isArray(debriefs) || debriefs.length === 0) return null;

  const prompt = `You are a personal productivity coach. Based on the user's last 14 days of data, write one short, specific, actionable insight (1-2 sentences max). Be encouraging but concrete — point to a pattern you actually see in the data.

RECENT DEBRIEFS (mood + completion rate):
${JSON.stringify(debriefs.slice(0, 14))}

RECENT BLOCKS:
${JSON.stringify(blocks.slice(0, 50))}

RECENT CORRECTIONS (how they edited AI schedules):
${JSON.stringify(corrections.slice(0, 20))}

Today is ${todayStr()}. Write the insight directly, no preamble.`;

  const message = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 150,
    messages:   [{ role: "user", content: prompt }],
  });

  // Best-effort usage + cost logging (mirrors the app routes).
  try {
    const u = message.usage;
    const tokens = {
      input_tokens:       u.input_tokens ?? 0,
      output_tokens:      u.output_tokens ?? 0,
      cache_read_tokens:  u.cache_read_input_tokens ?? 0,
      cache_write_tokens: u.cache_creation_input_tokens ?? 0,
    };
    const cost = Math.ceil(
      tokens.input_tokens * HAIKU_PRICE.input +
      tokens.output_tokens * HAIKU_PRICE.output +
      tokens.cache_read_tokens * HAIKU_PRICE.cacheRead +
      tokens.cache_write_tokens * HAIKU_PRICE.cacheWrite
    );
    await supabaseFetch("usage_events", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        app: "cadence",
        model: "claude-haiku-4-5-20251001",
        ...tokens,
        cost_microdollars: cost,
      }),
    });
  } catch (e) {
    console.warn(`[nightly-insights] usage log failed for ${userId}:`, e);
  }

  const content = message.content[0];
  return content.type === "text" ? content.text.trim() : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Fetch users entitled to Cadence AI (profiles-based plans, not the retired
  // is_ai_enabled metadata flag), then drop anyone whose budget is spent.
  const now = new Date();
  const profilesRes = await supabaseFetch(
    `profiles?or=(plans.cs.{cadence_pro},plans.cs.{cadence_plus})` +
    `&select=user_id,plans,subscription_status,current_period_end`
  );
  const profiles: ProfileRow[] = await profilesRes.json();

  const paidUsers: Array<{ id: string }> = [];
  for (const p of (Array.isArray(profiles) ? profiles : [])) {
    if (!hasCadenceAI(p, now)) continue;
    if (!(await hasBudgetLeft(p, now))) {
      console.log(`[nightly-insights] Skipped ${p.user_id} — AI budget spent`);
      continue;
    }
    paidUsers.push({ id: p.user_id });
  }

  const userCount = paidUsers.length;
  console.log(`[nightly-insights] ${userCount} paid users`);

  if (userCount >= STOP_AT) {
    console.warn(`[nightly-insights] STOP: ${userCount} users >= ${STOP_AT} limit. Add batching before continuing.`);
    return Response.json({ skipped: true, reason: "user_count_limit", count: userCount });
  }

  if (userCount >= WARN_AT) {
    console.warn(`[nightly-insights] WARNING: ${userCount} users approaching limit of ${STOP_AT}. Plan batching soon.`);
  }

  const today = todayStr();
  let succeeded = 0;
  let failed = 0;

  for (const user of paidUsers) {
    try {
      const insight = await generateInsightForUser(user.id);
      if (!insight) {
        console.log(`[nightly-insights] Skipped ${user.id} — no behavioral data`);
        continue;
      }

      await supabaseFetch("daily_insights", {
        method:  "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
        body:    JSON.stringify({
          user_id:      user.id,
          generated_at: today,
          insight,
        }),
      });

      succeeded++;
    } catch (err) {
      console.error(`[nightly-insights] Failed for user ${user.id}:`, err);
      failed++;
    }
  }

  console.log(`[nightly-insights] Done: ${succeeded} succeeded, ${failed} failed`);
  return Response.json({ succeeded, failed, total: userCount });
});
