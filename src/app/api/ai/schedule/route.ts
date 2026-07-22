import { createClient, createServiceClient } from "@/lib/supabase-server";
import { getEntitlements, upgradeRequiredBody } from "@/lib/entitlements";
import { checkAiAccess, estimateCostMicrodollars } from "@/lib/aiBudget";
import Anthropic from "@anthropic-ai/sdk";
import { toDateStr } from "@/lib/time";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateStr(d);
}

function buildPrompt(
  goals: unknown[],
  debriefs: unknown[],
  blocks: unknown[],
  corrections: unknown[],
  weekStart: string
): string {
  const hasHistory = debriefs.length > 0 || corrections.length > 0;

  const coldStartNote = hasHistory
    ? ""
    : `\nNo behavioral history yet. Use these defaults: deep work in the morning (9am–12pm), ` +
      `body blocks before noon or after 3pm, admin midday, breaks between deep work sessions.`;

  return `You are a personal scheduling assistant. Generate a weekly block schedule based on the user's goals.

Week starting: ${weekStart}${coldStartNote}

GOALS FOR THIS WEEK:
${JSON.stringify(goals, null, 2)}

${hasHistory ? `RECENT BEHAVIOR (last 28 days of debriefs):
${JSON.stringify(debriefs, null, 2)}

RECENT SCHEDULE (last 28 days of blocks grouped for pattern recognition):
${JSON.stringify(blocks, null, 2)}

RECENT CORRECTIONS (what the user changed from AI-generated schedules):
${JSON.stringify(corrections, null, 2)}` : ""}

INSTRUCTIONS:
- Generate blocks for Mon–Sun of the week starting ${weekStart}
- Each goal specifies desired_sessions (how many blocks), time_preference, priority, and category
- Schedule higher priority goals first and in their preferred time slots
- Use the goal's time_preference to pick start times: morning=8am–12pm, afternoon=12pm–5pm, evening=5pm–9pm
- Deep work blocks should be 90 minutes; body/movement blocks 45–60 min; admin 30–60 min; breaks 15–30 min
- Spread sessions across different days when desired_sessions > 1
- Avoid scheduling more than 2 deep work blocks per day
- Make block titles specific using the goal title and detail (e.g. "Deep work — auth module: password reset")
- If behavioral data exists, avoid time slots the user consistently skips or corrects

Return ONLY a valid JSON array. No explanation, no markdown, no code fences.
Each item: { "title": string, "category": "deep"|"body"|"break"|"admin", "day": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM", "detail": string }`;
}

export async function POST(request: Request) {
  // 1. Auth check — session required before any Claude call
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Feature gate — entitlement + monthly budget, before any Claude call
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ? createServiceClient() : null;
  if (service) {
    const access = await checkAiAccess(supabase, service, user.id, "cadence_ai");
    if (!access.ok) return Response.json(access.body, { status: access.status });
  } else {
    const entitlements = await getEntitlements(supabase, user.id);
    if (!entitlements.cadenceAI) {
      return Response.json(upgradeRequiredBody("cadence_ai"), { status: 403 });
    }
  }

  // 3. Parse request body
  const body = await request.json().catch(() => null);
  if (!body?.goals || !Array.isArray(body.goals) || !body.weekStart) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { goals, weekStart } = body as { goals: unknown[]; weekStart: string };

  // 4. Save goals to DB (upsert by deleting old ones for this week, then inserting)
  await supabase.from("weekly_goals").delete()
    .eq("user_id", user.id)
    .eq("week_start", weekStart);

  const goalsToInsert = (goals as Array<Record<string, unknown>>).map((g, i) => ({
    user_id:          user.id,
    week_start:       weekStart,
    title:            String(g.title ?? ""),
    category:         String(g.category ?? "deep"),
    detail:           g.detail ? String(g.detail) : null,
    desired_sessions: Number(g.desired_sessions ?? 1),
    time_preference:  g.time_preference ? String(g.time_preference) : null,
    priority:         Number(g.priority ?? 2),
    position:         i,
  }));

  if (goalsToInsert.filter((g) => g.title).length > 0) {
    await supabase.from("weekly_goals").insert(goalsToInsert.filter((g) => g.title));
  }

  // 5. Fetch behavioral context in parallel
  const cutoff28 = daysAgoStr(28);
  const cutoff14 = daysAgoStr(14);

  const [debriefsRes, blocksRes, correctionsRes] = await Promise.all([
    supabase.from("daily_debriefs").select("day,mood,completion_rate")
      .eq("user_id", user.id).gte("day", cutoff28).order("day"),
    supabase.from("schedule_blocks").select("day,category,start_time,end_time,done,title")
      .eq("user_id", user.id).gte("day", cutoff28).order("day"),
    supabase.from("schedule_corrections").select("correction_type,original_start_time,new_start_time,created_at")
      .eq("user_id", user.id).gte("created_at", cutoff14 + "T00:00:00Z").order("created_at"),
  ]);

  // 6. Build prompt and call Claude
  const prompt = buildPrompt(
    goalsToInsert.filter((g) => g.title),
    debriefsRes.data ?? [],
    blocksRes.data ?? [],
    correctionsRes.data ?? [],
    weekStart
  );

  let responseText: string;
  try {
    const message = await anthropic.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 4096,
      messages:   [{ role: "user", content: prompt }],
    });
    // Best-effort usage logging — must never fail the user's request.
    if (service) {
      const tokens = {
        input_tokens:       message.usage.input_tokens ?? 0,
        output_tokens:      message.usage.output_tokens ?? 0,
        cache_read_tokens:  message.usage.cache_read_input_tokens ?? 0,
        cache_write_tokens: message.usage.cache_creation_input_tokens ?? 0,
      };
      // Awaited: a detached promise can be dropped when the serverless
      // function freezes after responding.
      await service
        .from("usage_events")
        .insert({
          user_id: user.id,
          app: "cadence",
          model: "claude-sonnet-4-6",
          ...tokens,
          cost_microdollars: estimateCostMicrodollars("claude-sonnet-4-6", tokens),
        })
        .then(
          ({ error }) => { if (error) console.warn("usage_events insert failed:", error.message); },
          (e) => { console.warn("usage_events insert threw:", e); }
        );
    }
    const content = message.content[0];
    if (content.type !== "text") throw new Error("Unexpected response type");
    responseText = content.text.trim();
  } catch {
    return Response.json(
      { error: "Schedule generation failed. Please try again." },
      { status: 503 }
    );
  }

  // 7. Parse and validate the JSON response
  let proposedBlocks: Array<{
    title: string;
    category: string;
    day: string;
    start_time: string;
    end_time: string;
    detail?: string;
  }>;

  try {
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    proposedBlocks = JSON.parse(cleaned);
    if (!Array.isArray(proposedBlocks)) throw new Error("Not an array");
  } catch {
    return Response.json(
      { error: "AI returned an unreadable schedule. Please try again." },
      { status: 422 }
    );
  }

  // 8. Delete existing AI blocks for this week and insert new ones
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = toDateStr(weekEnd);

  await supabase.from("schedule_blocks")
    .delete()
    .eq("user_id", user.id)
    .eq("source", "ai")
    .gte("day", weekStart)
    .lte("day", weekEndStr);

  const validCategories = new Set(["deep", "body", "break", "admin"]);
  const blocksToInsert = proposedBlocks
    .filter((b) => b.title && b.day && b.start_time && b.end_time && validCategories.has(b.category))
    .map((b, i) => ({
      user_id:    user.id,
      day:        b.day,
      start_time: b.start_time,
      end_time:   b.end_time,
      title:      b.title,
      category:   b.category,
      detail:     b.detail ?? null,
      source:     "ai",
      position:   i,
      done:       false,
    }));

  const { data: insertedBlocks, error: insertError } = await supabase
    .from("schedule_blocks")
    .insert(blocksToInsert)
    .select();

  if (insertError) {
    return Response.json(
      { error: "Failed to save schedule. Please try again." },
      { status: 500 }
    );
  }

  return Response.json({ blocks: insertedBlocks });
}
