import Anthropic from "npm:@anthropic-ai/sdk@^0.104.2";

const WARN_AT  = 100;
const STOP_AT  = 150;

const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")!;
const anthropicKey   = Deno.env.get("ANTHROPIC_API_KEY")!;

const anthropic = new Anthropic({ apiKey: anthropicKey });

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

  const content = message.content[0];
  return content.type === "text" ? content.text.trim() : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Fetch all paid users (is_ai_enabled = true in raw_user_meta_data)
  const usersRes = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`,
    {
      headers: {
        "apikey":        serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
    }
  );

  const { users } = await usersRes.json();
  const paidUsers: Array<{ id: string }> = (users ?? []).filter(
    (u: { raw_user_meta_data?: { is_ai_enabled?: boolean } }) =>
      u.raw_user_meta_data?.is_ai_enabled === true
  );

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
