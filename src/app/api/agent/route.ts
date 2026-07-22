import { createClient, createServiceClient } from "@/lib/supabase-server";
import { getEntitlements, upgradeRequiredBody } from "@/lib/entitlements";
import { checkAiAccess, estimateCostMicrodollars } from "@/lib/aiBudget";
import Anthropic from "@anthropic-ai/sdk";
import { toDateStr } from "@/lib/time";
import { scheduleTemplateBlocks, rebuildTemplateBlocks, validateSlots, reconcileSlotIds } from "@/lib/scheduleTemplate";
import type { ScheduleBlock, BlockTemplate, TemplateSlot } from "@/lib/types";

// Runs only on the server. The Anthropic key never leaves this process — it is
// read from the environment and is not exposed to the browser.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const CATEGORIES = new Set(["deep", "body", "break", "admin"]);
// High enough that a full day's worth of blocks (morning through bedtime, plus
// any recurring saved blocks) can all be created without the loop cutting off.
const MAX_TOOL_ITERATIONS = 16;

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Current week, Monday→Sunday (weekly_goals.week_start is a Monday).
function currentWeekBounds(): { start: string; end: string } {
  const d = new Date();
  const day = d.getDay(); // 0=Sun … 6=Sat
  const monday = new Date(d);
  monday.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: toDateStr(monday), end: toDateStr(sunday) };
}

// ---- Tool definitions the model can call ---------------------------------

const tools: Anthropic.Tool[] = [
  {
    name: "create_block",
    description:
      "Add a new block to the user's schedule. Created blocks are always marked as AI-generated. " +
      "Provide a short free-form activity label describing the kind of activity (e.g. \"reading\", \"exercise\", \"deep work\").",
    input_schema: {
      type: "object",
      properties: {
        day:        { type: "string", description: "Date, YYYY-MM-DD" },
        start_time: { type: "string", description: "Start time, HH:MM (24h)" },
        end_time:   { type: "string", description: "End time, HH:MM (24h)" },
        title:      { type: "string", description: "Specific, human-readable block title" },
        category:   { type: "string", enum: ["deep", "body", "break", "admin"] },
        activity:   { type: "string", description: "Short activity label, e.g. \"reading\", \"exercise\"" },
        detail:     { type: "string", description: "Optional longer note" },
      },
      required: ["day", "start_time", "end_time", "title", "category", "activity"],
    },
  },
  {
    name: "update_block",
    description:
      "Modify an existing block by id. Only include the fields you want to change. " +
      "Use this to move (start_time), resize (end_time), or retitle (title) a block.",
    input_schema: {
      type: "object",
      properties: {
        block_id:   { type: "string" },
        day:        { type: "string", description: "YYYY-MM-DD" },
        start_time: { type: "string", description: "HH:MM" },
        end_time:   { type: "string", description: "HH:MM" },
        title:      { type: "string" },
        category:   { type: "string", enum: ["deep", "body", "break", "admin"] },
        activity:   { type: "string" },
        detail:     { type: "string" },
        done:       { type: "boolean" },
      },
      required: ["block_id"],
    },
  },
  {
    name: "delete_block",
    description: "Delete an existing block by id.",
    input_schema: {
      type: "object",
      properties: { block_id: { type: "string" } },
      required: ["block_id"],
    },
  },
  {
    name: "create_blocks",
    description:
      "Add MULTIPLE blocks at once, inserted in a single operation. Prefer this over create_block " +
      "whenever you're adding more than one block. Each block is marked AI-generated; give each a " +
      "short activity label.",
    input_schema: {
      type: "object",
      properties: {
        blocks: {
          type: "array",
          description: "The blocks to create.",
          items: {
            type: "object",
            properties: {
              day:        { type: "string", description: "Date, YYYY-MM-DD" },
              start_time: { type: "string", description: "Start time, HH:MM (24h)" },
              end_time:   { type: "string", description: "End time, HH:MM (24h)" },
              title:      { type: "string", description: "Specific, human-readable block title" },
              category:   { type: "string", enum: ["deep", "body", "break", "admin"] },
              activity:   { type: "string", description: "Short activity label, e.g. \"reading\", \"exercise\"" },
              detail:     { type: "string", description: "Optional longer note" },
            },
            required: ["day", "start_time", "end_time", "title", "category", "activity"],
          },
        },
      },
      required: ["blocks"],
    },
  },
  {
    name: "update_blocks",
    description:
      "Modify MULTIPLE existing blocks at once. Each item is { block_id, ...only the fields to change }. " +
      "Prefer this over update_block whenever you're changing more than one block.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          description: "One entry per block to change.",
          items: {
            type: "object",
            properties: {
              block_id:   { type: "string" },
              day:        { type: "string", description: "YYYY-MM-DD" },
              start_time: { type: "string", description: "HH:MM" },
              end_time:   { type: "string", description: "HH:MM" },
              title:      { type: "string" },
              category:   { type: "string", enum: ["deep", "body", "break", "admin"] },
              activity:   { type: "string" },
              detail:     { type: "string" },
              done:       { type: "boolean" },
            },
            required: ["block_id"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "delete_blocks",
    description:
      "Delete MULTIPLE blocks by id at once, removed in a single operation. Prefer this over " +
      "delete_block whenever you're removing more than one block.",
    input_schema: {
      type: "object",
      properties: {
        block_ids: {
          type: "array",
          items: { type: "string" },
          description: "Ids of the blocks to delete.",
        },
      },
      required: ["block_ids"],
    },
  },
  {
    name: "create_saved_block",
    description:
      "Save a reusable block template (a \"saved block\"), used for recurring routines. " +
      "A saved block can occur MULTIPLE times per day via `slots` — each slot is one occurrence " +
      "(start_time + duration_minutes) and every copy shares the block's title. If recurrence_days " +
      "and at least one slot are provided, the routine is automatically placed on the calendar for " +
      "the next 4 weeks — do NOT also create individual blocks for those days, that would duplicate them.",
    input_schema: {
      type: "object",
      properties: {
        title:            { type: "string" },
        category:         { type: "string", enum: ["deep", "body", "break", "admin"] },
        duration_minutes: { type: "integer", description: "Default length in minutes (used when a slot omits its own)" },
        slots: {
          type: "array",
          description: "Occurrences per recurrence day. E.g. three deep-work sessions = three slots.",
          items: {
            type: "object",
            properties: {
              start_time:       { type: "string", description: "HH:MM (24h)" },
              duration_minutes: { type: "integer", description: "Length of this occurrence in minutes" },
            },
            required: ["start_time"],
          },
        },
        recurrence_days: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 6 },
          description: "Days it recurs, 0=Sun … 6=Sat",
        },
        activity: { type: "string", description: "Short activity label" },
        detail:   { type: "string" },
      },
      required: ["title", "category", "duration_minutes"],
    },
  },
  {
    name: "update_saved_block",
    description:
      "Update a saved block (routine template) by id — a PERMANENT routine change. Only include the " +
      "fields to change; `slots` REPLACES the full slot list. Changing slots or recurrence_days rebuilds " +
      "the calendar for the next 4 weeks; copies the user moved for a single day (customized) and " +
      "completed copies are preserved. For a single-day time change use update_block instead.",
    input_schema: {
      type: "object",
      properties: {
        template_id: { type: "string" },
        title:       { type: "string" },
        category:    { type: "string", enum: ["deep", "body", "break", "admin"] },
        activity:    { type: "string" },
        detail:      { type: "string" },
        recurrence_days: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 6 },
          description: "Days it recurs, 0=Sun … 6=Sat",
        },
        slots: {
          type: "array",
          description: "REPLACES the full slot list. Each slot is one occurrence per recurrence day.",
          items: {
            type: "object",
            properties: {
              start_time:       { type: "string", description: "HH:MM (24h)" },
              duration_minutes: { type: "integer" },
            },
            required: ["start_time", "duration_minutes"],
          },
        },
      },
      required: ["template_id"],
    },
  },
  {
    name: "set_weekly_goal",
    description: "Create or add a weekly goal for the user for a given week.",
    input_schema: {
      type: "object",
      properties: {
        title:            { type: "string" },
        category:         { type: "string", enum: ["deep", "body", "break", "admin"] },
        detail:           { type: "string" },
        desired_sessions: { type: "integer", description: "How many blocks/sessions this week" },
        time_preference:  { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
        priority:         { type: "integer", description: "1=high, 2=medium, 3=low" },
        week_start:       { type: "string", description: "Monday of the week, YYYY-MM-DD. Defaults to the current week." },
      },
      required: ["title", "category"],
    },
  },
  {
    name: "set_block_activity",
    description:
      "Set the free-form activity label on an existing block (does not change its title or times).",
    input_schema: {
      type: "object",
      properties: {
        block_id: { type: "string" },
        activity: { type: "string", description: "Short activity label, e.g. \"reading\"" },
      },
      required: ["block_id", "activity"],
    },
  },
];

function buildSystemPrompt(
  blocks: ScheduleBlock[],
  goals: unknown[],
  templates: unknown[],
  weekStart: string,
  weekEnd: string
): string {
  return `You are Cadence, a personal productivity assistant embedded in the user's daily planner. \
You help the user plan and adjust their day by reasoning about their existing schedule, goals, and saved blocks, \
then carrying out changes through the provided tools.

Today is ${toDateStr(new Date())}. The current week runs ${weekStart} (Mon) to ${weekEnd} (Sun).

THIS WEEK'S SCHEDULE (existing blocks):
${JSON.stringify(blocks, null, 2)}

Each block has a "source": "manual" = the user created it by hand, "ai" = you created it, "template" = generated from a recurring saved block. Treat any source that is not "ai" or "template" as a manual block. A block with "customized": true is a template copy the user deliberately moved for that day — treat it like a manual block and do not "fix" its times back to the template.

WEEKLY GOALS:
${JSON.stringify(goals, null, 2)}

SAVED BLOCKS (templates):
${JSON.stringify(templates, null, 2)}

GUIDELINES:
- To change the schedule, call the tools — do not just describe changes in prose. The tools are the only way changes take effect.
- CLASSIFY THE REQUEST before acting:
  • If it only ADDS a small number of blocks (roughly 1–3) and deletes or replaces nothing, just do it — no confirmation needed.
  • If it would DELETE or REPLACE any existing block, or change several blocks at once (e.g. "restructure my week"), do NOT call any write tools yet. First reply in the chat with a SHORT summary of the plan (not a list of every block) and ask the user to confirm. Only after the user confirms in a following message may you apply the plan, using the batch tools.
- MANUAL BLOCKS during a restructure (a block whose source is not "ai" or "template"):
  • Identify any manual blocks that fall inside the window you're about to restructure.
  • In your proposal, explicitly name those manual blocks and ask whether to keep or remove them — do not decide silently either way.
  • If the user KEEPS a manual block, treat it as FIXED and immovable: do not place any block that overlaps it. Where a recurring or AI block you're scheduling would overlap a kept manual block, shorten that block to fit around it, or skip it if there's no room left. Do NOT move the manual block, and do NOT shift the rest of the day to compensate, unless the user explicitly asks for that.
  • If the user REMOVES them, proceed normally.
- When a request needs more than one calendar change, decide the full set of changes first, then apply them in a single batch using create_blocks / update_blocks / delete_blocks. Do NOT call the single-block tools repeatedly. Use single-block tools only for a genuine one-off change.
- RECURRING routine vs ONE-OFF event — choose the right tool:
  • Recurring ("every day", "daily", "each weekday", "on Mondays and Wednesdays", "my usual morning routine"): use create_saved_block. Set recurrence_days to the days it repeats, plus one slot per daily occurrence (start_time + duration_minutes). The saved block automatically fills the calendar for the next 4 weeks — do NOT also create individual one-off blocks for those days, that would duplicate them.
  • A routine that happens SEVERAL times a day (e.g. three deep-work sessions, two breaks) is ONE saved block with SEVERAL slots — never several saved blocks with numbered or renamed titles. All copies share the block's title.
  • Day encoding for recurrence_days: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday. "weekdays" = [1,2,3,4,5]; "every day"/"daily" = [0,1,2,3,4,5,6].
  • A recurring saved block MUST include recurrence_days and at least one slot, or it won't appear on the calendar.
  • One-off event ("dentist Thursday at 3pm"): use create_block for a single block, as before.
- ONE-DAY change vs PERMANENT routine change:
  • "Push my deep work back an hour today" → update_block / update_blocks on that day's blocks. This marks them customized: they stop following the saved block from then on.
  • "Move my deep work to mornings from now on" → update_saved_block. It rebuilds upcoming days but preserves copies the user customized or completed.
  • If the request is ambiguous about one day vs always, ask before changing anything.
- WHEN BUILDING A FULL DAILY ROUTINE (the user describes their whole day):
  • FIRST outline the ENTIRE day from wake-up to bedtime — in your reasoning, map every block start-to-end — BEFORE creating any blocks. Do not start placing blocks until the whole day is mapped, so no part of the day (especially the evening) gets dropped.
  • Honor every explicit time the user gives, exactly: wake-up, start times, work hours, activity durations, and bedtime. Whatever hours the user states are the hours to use.
  • Cover the WHOLE day the user described, including everything AFTER work — e.g. an evening workout, personal-project or job-application time, reading, and a bedtime. The end of the day is the part most easily dropped; make sure it is all there.
  • Create the blocks the user asked for, with sensible titles. Don't invent major activities the user never mentioned, but do include the normal supporting blocks they described (a get-ready or breakfast block, meals, commute, etc.).
  • For a recurring routine, create recurring saved blocks (create_saved_block with recurrence_days) for the days the user specified — not individual one-off blocks per date. If the user doesn't say which days, briefly ask (every day vs weekdays) before building.
- Every block you create is automatically recorded as AI-generated; you must supply an appropriate short "activity" label for each.
- Prefer editing an existing block (update_block) over deleting and recreating when the user is adjusting one.
- Reference existing blocks by their id (shown in THIS WEEK'S SCHEDULE above) when moving, resizing, retitling, or deleting them.
- Deep work blocks are typically 90 min; body/movement 45–60; admin 30–60; breaks 15–30. Avoid overlaps.
- After making changes, reply with a single short, natural sentence summarizing what you did (e.g. "Done — added your weekday morning routine."). Do not list the individual changes; the updated schedule is the confirmation.`;
}

// ---- Tool execution ------------------------------------------------------

interface ExecResult {
  content: string;   // fed back to the model
  isError?: boolean;
  change?: string;   // human-readable summary for the client
}

async function executeTool(
  name: string,
  rawInput: unknown,
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  weekStart: string
): Promise<ExecResult> {
  const input = (rawInput ?? {}) as Record<string, unknown>;

  switch (name) {
    case "create_block": {
      const category = String(input.category ?? "");
      if (!CATEGORIES.has(category)) {
        return { content: `Invalid category "${category}".`, isError: true };
      }
      const { data, error } = await supabase
        .from("schedule_blocks")
        .insert({
          user_id:    userId,
          day:        String(input.day ?? ""),
          start_time: String(input.start_time ?? ""),
          end_time:   String(input.end_time ?? ""),
          title:      String(input.title ?? ""),
          category,
          activity:   String(input.activity ?? ""),
          detail:     input.detail ? String(input.detail) : null,
          source:     "ai",
          done:       false,
          position:   0,
        })
        .select()
        .single();

      if (error) return { content: `Failed to create block: ${error.message}`, isError: true };
      return {
        content: `Created block ${data.id}.`,
        change:  `Added "${data.title}" (${data.activity}) on ${data.day} ${data.start_time}–${data.end_time}`,
      };
    }

    case "update_block": {
      const blockId = String(input.block_id ?? "");
      const { data: existing, error: fetchErr } = await supabase
        .from("schedule_blocks")
        .select("*")
        .eq("id", blockId)
        .eq("user_id", userId)
        .single<ScheduleBlock>();

      if (fetchErr || !existing) {
        return { content: `Block ${blockId} not found.`, isError: true };
      }

      const updates: Record<string, unknown> = {};
      for (const field of ["day", "start_time", "end_time", "title", "category", "activity", "detail"] as const) {
        if (input[field] !== undefined) updates[field] = input[field];
      }
      if (input.done !== undefined) updates.done = Boolean(input.done);

      // A one-off time change to a template copy tags it so template rebuilds
      // leave it alone from now on. Only an actual change to the value counts —
      // re-sending the same day/time shouldn't tag the copy as customized.
      const movesTimes =
        (updates.day !== undefined && updates.day !== existing.day) ||
        (updates.start_time !== undefined && updates.start_time !== existing.start_time) ||
        (updates.end_time !== undefined && updates.end_time !== existing.end_time);
      if (existing.template_id && movesTimes) updates.customized = true;
      if (updates.category && !CATEGORIES.has(String(updates.category))) {
        return { content: `Invalid category "${updates.category}".`, isError: true };
      }

      const { error: updErr } = await supabase
        .from("schedule_blocks")
        .update(updates)
        .eq("id", blockId)
        .eq("user_id", userId);

      if (updErr) return { content: `Failed to update block: ${updErr.message}`, isError: true };

      // If the user is correcting an AI-generated block, log it as a learning signal.
      if (existing.source === "ai") {
        await logCorrections(supabase, userId, existing, input);
      }

      return { content: `Updated block ${blockId}.`, change: `Updated "${existing.title}"` };
    }

    case "delete_block": {
      const blockId = String(input.block_id ?? "");
      const { data: existing } = await supabase
        .from("schedule_blocks")
        .select("*")
        .eq("id", blockId)
        .eq("user_id", userId)
        .single<ScheduleBlock>();

      if (!existing) return { content: `Block ${blockId} not found.`, isError: true };

      if (existing.source === "ai") {
        await supabase.from("schedule_corrections").insert({
          user_id:         userId,
          block_id:        blockId,
          correction_type: "delete",
        });
      }

      const { error } = await supabase
        .from("schedule_blocks")
        .delete()
        .eq("id", blockId)
        .eq("user_id", userId);

      if (error) return { content: `Failed to delete block: ${error.message}`, isError: true };
      return { content: `Deleted block ${blockId}.`, change: `Deleted "${existing.title}"` };
    }

    case "create_blocks": {
      const rawBlocks = Array.isArray(input.blocks) ? (input.blocks as Record<string, unknown>[]) : [];
      if (rawBlocks.length === 0) return { content: "No blocks provided.", isError: true };

      const rows = [];
      for (const rb of rawBlocks) {
        const category = String(rb.category ?? "");
        if (!CATEGORIES.has(category)) {
          return { content: `Invalid category "${category}".`, isError: true };
        }
        rows.push({
          user_id:    userId,
          day:        String(rb.day ?? ""),
          start_time: String(rb.start_time ?? ""),
          end_time:   String(rb.end_time ?? ""),
          title:      String(rb.title ?? ""),
          category,
          activity:   String(rb.activity ?? ""),
          detail:     rb.detail ? String(rb.detail) : null,
          source:     "ai" as const,
          done:       false,
          position:   0,
        });
      }

      // One bulk insert for the whole batch.
      const { data, error } = await supabase.from("schedule_blocks").insert(rows).select();
      if (error) return { content: `Failed to create blocks: ${error.message}`, isError: true };

      const n = data?.length ?? 0;
      return { content: `Created ${n} block(s).`, change: `Added ${n} block${n === 1 ? "" : "s"}` };
    }

    case "update_blocks": {
      const items = Array.isArray(input.updates) ? (input.updates as Record<string, unknown>[]) : [];
      if (items.length === 0) return { content: "No updates provided.", isError: true };

      const ids = items.map((u) => String(u.block_id ?? "")).filter(Boolean);

      // Fetch the affected rows once — for correction logging and to ignore ids
      // that don't belong to this user.
      const { data: existingRows } = await supabase
        .from("schedule_blocks")
        .select("*")
        .eq("user_id", userId)
        .in("id", ids);
      const byId = new Map<string, ScheduleBlock>(
        ((existingRows as ScheduleBlock[] | null) ?? []).map((b) => [b.id, b])
      );

      // Per-row update (rows may get different values). Server-side only — no
      // extra round trips to the model.
      let updated = 0;
      for (const u of items) {
        const blockId = String(u.block_id ?? "");
        const existing = byId.get(blockId);
        if (!existing) continue;

        const updates: Record<string, unknown> = {};
        for (const field of ["day", "start_time", "end_time", "title", "category", "activity", "detail"] as const) {
          if (u[field] !== undefined) updates[field] = u[field];
        }
        if (u.done !== undefined) updates.done = Boolean(u.done);

        // A one-off time change to a template copy tags it so template rebuilds
        // leave it alone from now on. Only an actual change to the value counts —
        // re-sending the same day/time shouldn't tag the copy as customized.
        const movesTimes =
          (updates.day !== undefined && updates.day !== existing.day) ||
          (updates.start_time !== undefined && updates.start_time !== existing.start_time) ||
          (updates.end_time !== undefined && updates.end_time !== existing.end_time);
        if (existing.template_id && movesTimes) updates.customized = true;
        if (updates.category && !CATEGORIES.has(String(updates.category))) {
          return { content: `Invalid category "${updates.category}".`, isError: true };
        }
        if (Object.keys(updates).length === 0) continue;

        const { error: updErr } = await supabase
          .from("schedule_blocks")
          .update(updates)
          .eq("id", blockId)
          .eq("user_id", userId);
        if (updErr) return { content: `Failed to update block ${blockId}: ${updErr.message}`, isError: true };

        if (existing.source === "ai") {
          await logCorrections(supabase, userId, existing, u);
        }
        updated++;
      }

      return { content: `Updated ${updated} block(s).`, change: `Updated ${updated} block${updated === 1 ? "" : "s"}` };
    }

    case "delete_blocks": {
      const ids = Array.isArray(input.block_ids)
        ? (input.block_ids as unknown[]).map(String).filter(Boolean)
        : [];
      if (ids.length === 0) return { content: "No block ids provided.", isError: true };

      // Log a correction for each AI-generated block being removed.
      const { data: existingRows } = await supabase
        .from("schedule_blocks")
        .select("id, source")
        .eq("user_id", userId)
        .in("id", ids);
      const aiIds = ((existingRows as { id: string; source: string | null }[] | null) ?? [])
        .filter((b) => b.source === "ai")
        .map((b) => b.id);
      if (aiIds.length > 0) {
        await supabase.from("schedule_corrections").insert(
          aiIds.map((id) => ({ user_id: userId, block_id: id, correction_type: "delete" }))
        );
      }

      // One bulk delete for the whole batch.
      const { error } = await supabase
        .from("schedule_blocks")
        .delete()
        .eq("user_id", userId)
        .in("id", ids);
      if (error) return { content: `Failed to delete blocks: ${error.message}`, isError: true };

      return { content: `Deleted ${ids.length} block(s).`, change: `Deleted ${ids.length} block${ids.length === 1 ? "" : "s"}` };
    }

    case "create_saved_block": {
      const category = String(input.category ?? "");
      if (!CATEGORIES.has(category)) {
        return { content: `Invalid category "${category}".`, isError: true };
      }
      const recurrence = Array.isArray(input.recurrence_days)
        ? (input.recurrence_days as unknown[]).map(Number).filter((n) => n >= 0 && n <= 6)
        : [];

      const defaultDuration = Number(input.duration_minutes ?? 60);
      const rawSlots = Array.isArray(input.slots) ? (input.slots as Record<string, unknown>[]) : [];
      const slots: TemplateSlot[] = rawSlots.map((s) => ({
        id:               crypto.randomUUID(),
        start_time:       String(s.start_time ?? ""),
        duration_minutes: Number(s.duration_minutes ?? defaultDuration),
      }));
      const slotErr = validateSlots(slots);
      if (slotErr) return { content: slotErr, isError: true };

      const { data, error } = await supabase
        .from("block_templates")
        .insert({
          user_id:          userId,
          title:            String(input.title ?? ""),
          category,
          duration_minutes: defaultDuration,
          slots,
          recurrence_days:  recurrence,
          activity:         input.activity ? String(input.activity) : null,
          detail:           input.detail ? String(input.detail) : null,
          position:         0,
        })
        .select()
        .single();

      if (error) return { content: `Failed to save block: ${error.message}`, isError: true };

      // If it's a recurring routine, fill the calendar the same way the Blocks
      // page does — one shared code path, so no duplicated one-off blocks.
      const template = data as BlockTemplate;
      let scheduled = 0;
      try {
        const created = await scheduleTemplateBlocks(supabase, template, userId);
        scheduled = created.length;
      } catch (e) {
        console.warn("scheduleTemplateBlocks failed:", e);
      }

      const change =
        scheduled > 0
          ? `Saved routine "${template.title}" and scheduled ${scheduled} block${scheduled === 1 ? "" : "s"}`
          : `Saved block "${template.title}"`;
      return {
        content: `Saved block template ${template.id}; scheduled ${scheduled} recurring block(s).`,
        change,
      };
    }

    case "update_saved_block": {
      const templateId = String(input.template_id ?? "");
      const { data: existingTpl, error: tplErr } = await supabase
        .from("block_templates")
        .select("*")
        .eq("id", templateId)
        .eq("user_id", userId)
        .single<BlockTemplate>();
      if (tplErr || !existingTpl) {
        return { content: `Saved block ${templateId} not found.`, isError: true };
      }

      const updates: Record<string, unknown> = {};
      if (input.title !== undefined)    updates.title = String(input.title);
      if (input.activity !== undefined) updates.activity = String(input.activity);
      if (input.detail !== undefined)   updates.detail = String(input.detail);
      if (input.category !== undefined) {
        if (!CATEGORIES.has(String(input.category))) {
          return { content: `Invalid category "${input.category}".`, isError: true };
        }
        updates.category = String(input.category);
      }
      if (input.recurrence_days !== undefined) {
        updates.recurrence_days = Array.isArray(input.recurrence_days)
          ? (input.recurrence_days as unknown[]).map(Number).filter((n) => n >= 0 && n <= 6)
          : [];
      }
      if (input.slots !== undefined) {
        const rawSlots = Array.isArray(input.slots) ? (input.slots as Record<string, unknown>[]) : [];
        const incoming = rawSlots.map((s) => ({
          start_time:       String(s.start_time ?? ""),
          duration_minutes: Number(s.duration_minutes ?? existingTpl.duration_minutes),
        }));
        // Reuse existing slot ids for matching start times so preserved
        // customized/done copies still line up with the rebuilt slot list
        // instead of getting duplicated beside them.
        const slots = reconcileSlotIds(existingTpl.slots ?? [], incoming);
        const slotErr = validateSlots(slots);
        if (slotErr) return { content: slotErr, isError: true };
        updates.slots = slots;
      }
      if (Object.keys(updates).length === 0) {
        return { content: "No changes provided.", isError: true };
      }

      const { data: updatedRow, error: updErr } = await supabase
        .from("block_templates")
        .update(updates)
        .eq("id", templateId)
        .eq("user_id", userId)
        .select()
        .single();
      if (updErr || !updatedRow) {
        return { content: `Failed to update saved block: ${updErr?.message ?? "unknown error"}`, isError: true };
      }

      const updatedTpl = updatedRow as BlockTemplate;

      // Only rebuild the calendar when the template actually recurs (before or
      // after this update) — for a non-recurring template, rebuilding would
      // delete untagged upcoming copies and insert nothing, destroying
      // hand-placed copies on e.g. a plain rename.
      const affectsCalendar =
        existingTpl.recurrence_days.length > 0 || updatedTpl.recurrence_days.length > 0;
      if (!affectsCalendar) {
        return {
          content: `Updated saved block ${templateId}.`,
          change: `Updated routine "${updatedTpl.title}"`,
        };
      }

      const { deletedIds, created } = await rebuildTemplateBlocks(supabase, updatedTpl, userId);
      return {
        content:
          `Updated saved block ${templateId}; rebuilt upcoming calendar ` +
          `(removed ${deletedIds.length}, added ${created.length}). ` +
          `Customized and completed copies were preserved as-is.`,
        change: `Updated routine "${updatedTpl.title}"`,
      };
    }

    case "set_weekly_goal": {
      const category = String(input.category ?? "");
      if (!CATEGORIES.has(category)) {
        return { content: `Invalid category "${category}".`, isError: true };
      }
      const { data, error } = await supabase
        .from("weekly_goals")
        .insert({
          user_id:          userId,
          week_start:       input.week_start ? String(input.week_start) : weekStart,
          title:            String(input.title ?? ""),
          category,
          detail:           input.detail ? String(input.detail) : null,
          desired_sessions: Number(input.desired_sessions ?? 1),
          time_preference:  input.time_preference ? String(input.time_preference) : null,
          priority:         Number(input.priority ?? 2),
          position:         0,
        })
        .select()
        .single();

      if (error) return { content: `Failed to set goal: ${error.message}`, isError: true };
      return { content: `Set weekly goal ${data.id}.`, change: `Set goal "${data.title}"` };
    }

    case "set_block_activity": {
      const blockId = String(input.block_id ?? "");
      const activity = String(input.activity ?? "");
      const { data, error } = await supabase
        .from("schedule_blocks")
        .update({ activity })
        .eq("id", blockId)
        .eq("user_id", userId)
        .select()
        .single();

      if (error || !data) return { content: `Block ${blockId} not found.`, isError: true };
      return { content: `Set activity on block ${blockId}.`, change: `Labeled "${data.title}" as "${activity}"` };
    }

    default:
      return { content: `Unknown tool: ${name}`, isError: true };
  }
}

// Detect and record how the user corrected an AI-made block.
async function logCorrections(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  existing: ScheduleBlock,
  input: Record<string, unknown>
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const base = { user_id: userId, block_id: existing.id };

  const newStart = input.start_time !== undefined ? String(input.start_time) : existing.start_time;

  if (input.start_time !== undefined && String(input.start_time) !== existing.start_time) {
    rows.push({
      ...base,
      correction_type:     "reschedule",
      original_start_time: existing.start_time,
      new_start_time:      String(input.start_time),
    });
  }

  if (input.end_time !== undefined) {
    const originalDuration = timeToMinutes(existing.end_time) - timeToMinutes(existing.start_time);
    const newDuration      = timeToMinutes(String(input.end_time)) - timeToMinutes(newStart);
    if (newDuration !== originalDuration) {
      rows.push({
        ...base,
        correction_type:           "resize",
        original_duration_minutes: originalDuration,
        new_duration_minutes:      newDuration,
      });
    }
  }

  if (input.title !== undefined && String(input.title) !== existing.title) {
    rows.push({ ...base, correction_type: "retitle" });
  }

  if (rows.length > 0) {
    await supabase.from("schedule_corrections").insert(rows);
  }
}

// ---- Route handler -------------------------------------------------------

export async function POST(request: Request) {
  // 1. Auth — the user id comes from the session, never trusted from the client.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Feature gate — entitlement + monthly budget, checked once per user
  //    message. The tool loop below may make several Anthropic calls, so a
  //    message that starts under the limit can finish slightly over it; the
  //    overshoot is bounded by one message's cost and is acceptable.
  const gateService = process.env.SUPABASE_SERVICE_ROLE_KEY ? createServiceClient() : null;
  if (gateService) {
    const access = await checkAiAccess(supabase, gateService, user.id, "cadence_ai");
    if (!access.ok) return Response.json(access.body, { status: access.status });
  } else {
    const entitlements = await getEntitlements(supabase, user.id);
    if (!entitlements.cadenceAI) {
      return Response.json(upgradeRequiredBody("cadence_ai"), { status: 403 });
    }
  }

  // 3. Parse the conversation history.
  const body = await request.json().catch(() => null);
  if (!body?.messages || !Array.isArray(body.messages)) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const conversation: Anthropic.MessageParam[] = [];
  for (const m of body.messages as unknown[]) {
    const msg = m as { role?: unknown; content?: unknown };
    if ((msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string") {
      conversation.push({ role: msg.role, content: msg.content });
    }
  }
  // The Messages API requires the first message to be from the user; drop any
  // leading assistant turns (e.g. a client-side welcome bubble).
  while (conversation.length > 0 && conversation[0].role === "assistant") {
    conversation.shift();
  }
  if (conversation.length === 0 || conversation[conversation.length - 1].role !== "user") {
    return Response.json({ error: "Conversation must end with a user message" }, { status: 400 });
  }
  const lastUserMessage = conversation[conversation.length - 1].content as string;

  // 4. Load the user's current context.
  const { start: weekStart, end: weekEnd } = currentWeekBounds();
  const [blocksRes, goalsRes, templatesRes] = await Promise.all([
    supabase.from("schedule_blocks")
      .select("*")
      .eq("user_id", user.id)
      .gte("day", weekStart)
      .lte("day", weekEnd)
      .order("day").order("start_time"),
    supabase.from("weekly_goals")
      .select("*")
      .eq("user_id", user.id)
      .eq("week_start", weekStart)
      .order("priority"),
    supabase.from("block_templates")
      .select("*")
      .eq("user_id", user.id)
      .order("position"),
  ]);

  const systemPrompt = buildSystemPrompt(
    (blocksRes.data as ScheduleBlock[]) ?? [],
    goalsRes.data ?? [],
    templatesRes.data ?? [],
    weekStart,
    weekEnd
  );

  // Best-effort per-call usage logging via the service role (bypasses RLS).
  // Failures are swallowed and never block or delay the chat response.
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ? createServiceClient() : null;
  const usageInserts: PromiseLike<unknown>[] = [];
  const logUsage = (model: string, usage: Anthropic.Usage) => {
    if (!service) return;
    usageInserts.push(
      service
        .from("usage_events")
        .insert({
          user_id:            user.id,
          app:                "cadence",
          model,
          input_tokens:       usage.input_tokens ?? 0,
          output_tokens:      usage.output_tokens ?? 0,
          cache_read_tokens:  usage.cache_read_input_tokens ?? 0,
          cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
          cost_microdollars:  estimateCostMicrodollars(model, {
            input_tokens:       usage.input_tokens ?? 0,
            output_tokens:      usage.output_tokens ?? 0,
            cache_read_tokens:  usage.cache_read_input_tokens ?? 0,
            cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
          }),
        })
        .then(
          ({ error }) => { if (error) console.warn("usage_events insert failed:", error.message); },
          (e) => { console.warn("usage_events insert threw:", e); }
        )
    );
  };

  // 5. Run the tool-use loop: the model proposes structured actions, we execute
  //    them against Supabase and feed the results back until it stops.
  const changes: string[] = [];
  let replyText = "";

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const message = await anthropic.messages.create({
        model:      "claude-sonnet-4-6",
        // Enough headroom to outline a full day and emit all its tool calls in
        // one turn without truncation (non-streaming, so kept well under limits).
        max_tokens: 8192,
        system:     systemPrompt,
        tools,
        messages:   conversation,
      });

      // Record usage for every call, including each round trip's second call.
      logUsage(message.model, message.usage);

      if (message.stop_reason === "tool_use") {
        conversation.push({ role: "assistant", content: message.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of message.content) {
          if (block.type === "tool_use") {
            const result = await executeTool(block.name, block.input, supabase, user.id, weekStart);
            if (result.change) changes.push(result.change);
            toolResults.push({
              type:         "tool_result",
              tool_use_id:  block.id,
              content:      result.content,
              is_error:     result.isError,
            });
          }
        }
        conversation.push({ role: "user", content: toolResults });
        continue;
      }

      // Terminal turn — collect the assistant's text reply.
      replyText = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }
  } catch {
    await Promise.allSettled(usageInserts); // flush any usage recorded before the failure
    return Response.json(
      { error: "The assistant is unavailable right now. Please try again." },
      { status: 503 }
    );
  }

  if (!replyText) {
    replyText = changes.length > 0 ? "Done." : "I wasn't able to respond just now.";
  }

  // 6. Persist both sides of the exchange, and flush any pending usage logs.
  await Promise.all([
    supabase.from("chat_messages").insert([
      { user_id: user.id, role: "user",      content: lastUserMessage },
      { user_id: user.id, role: "assistant", content: replyText },
    ]),
    Promise.allSettled(usageInserts),
  ]);

  return Response.json({ reply: replyText, changes });
}
