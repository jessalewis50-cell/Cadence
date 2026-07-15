import type { SupabaseClient } from "@supabase/supabase-js";
import { addMinutes, toDateStr, timeToMinutes } from "@/lib/time";
import type { BlockTemplate, ScheduleBlock, TemplateSlot } from "@/lib/types";

const DEFAULT_WEEKS_AHEAD = 4;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A schedule_blocks insert payload (row minus DB-generated fields). */
export type StampRow = Omit<ScheduleBlock, "id" | "created_at">;

const stampKey = (day: string, slotId: string) => `${day}|${slotId}`;

/**
 * Dates within the next `weeksAhead` weeks (starting today) that fall on one of
 * the template's recurrence days. Day encoding: 0 = Sunday … 6 = Saturday.
 */
export function matchingDatesForTemplate(
  recurrenceDays: number[],
  weeksAhead = DEFAULT_WEEKS_AHEAD
): Date[] {
  if (recurrenceDays.length === 0) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + weeksAhead * 7 - 1);

  const dates: Date[] = [];
  const cursor = new Date(today);
  while (cursor <= endDate) {
    if (recurrenceDays.includes(cursor.getDay())) dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/**
 * Validate a slot list: canonical HH:MM times, positive durations, and no
 * overlaps within the template. Returns an error message, or null if valid.
 */
export function validateSlots(slots: TemplateSlot[]): string | null {
  for (const s of slots) {
    if (!TIME_RE.test(s.start_time)) {
      return `Invalid slot start time "${s.start_time}" (expected HH:MM, 24-hour).`;
    }
    if (!Number.isFinite(s.duration_minutes) || s.duration_minutes <= 0) {
      return `Invalid slot duration ${s.duration_minutes} (must be a positive number of minutes).`;
    }
  }
  const sorted = [...slots].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = timeToMinutes(sorted[i - 1].start_time) + sorted[i - 1].duration_minutes;
    if (timeToMinutes(sorted[i].start_time) < prevEnd) {
      return `Slots overlap: ${sorted[i - 1].start_time} (${sorted[i - 1].duration_minutes} min) runs into ${sorted[i].start_time}.`;
    }
  }
  return null;
}

/**
 * Pure stamping plan: one row per (date x slot), skipping pairs that already
 * have a copy. Identity is (template_id, slot_id, day) — titles are never
 * matched, which is what allows several same-titled blocks on one day.
 */
export function planTemplateStamping(
  template: BlockTemplate,
  dates: Date[],
  existing: Array<{ day: string; slot_id?: string | null }>,
  userId: string
): StampRow[] {
  const slots = template.slots ?? [];
  if (slots.length === 0) return [];

  const taken = new Set(
    existing.filter((e) => e.slot_id).map((e) => stampKey(e.day, e.slot_id!))
  );

  const rows: StampRow[] = [];
  for (const d of dates) {
    const day = toDateStr(d);
    for (const s of slots) {
      if (taken.has(stampKey(day, s.id))) continue;
      rows.push({
        user_id:     userId,
        day,
        start_time:  s.start_time,
        end_time:    addMinutes(s.start_time, s.duration_minutes),
        title:       template.title,
        category:    template.category,
        activity:    template.activity ?? null,
        detail:      template.detail ?? null,
        position:    0,
        done:        false,
        source:      "template",
        template_id: template.id,
        slot_id:     s.id,
        customized:  false,
      });
    }
  }
  return rows;
}

/**
 * Pure rebuild plan for a template's upcoming copies:
 * - delete untagged (`!customized && !done`) copies,
 * - preserve customized/done copies and skip re-stamping their (day, slot) pair,
 * - preserved copies of deleted slots simply survive (self-governing).
 */
export function planTemplateRebuild(
  template: BlockTemplate,
  dates: Date[],
  existingUpcoming: Array<Pick<ScheduleBlock, "id" | "day" | "slot_id" | "customized" | "done">>,
  userId: string
): { deleteIds: string[]; inserts: StampRow[] } {
  const preserved = existingUpcoming.filter((b) => b.customized || b.done);
  const deleteIds = existingUpcoming.filter((b) => !b.customized && !b.done).map((b) => b.id);
  const inserts = planTemplateStamping(template, dates, preserved, userId);
  return { deleteIds, inserts };
}

/**
 * Create recurring schedule_blocks for a template's slots across the next
 * 4 weeks, deduped by (template_id, slot_id, day). Returns the rows created.
 *
 * This is the single source of truth for turning a saved block into calendar
 * entries — used by both the Blocks page (client) and the agent route (server).
 * It's a no-op unless the template has both recurrence_days and slots.
 */
export async function scheduleTemplateBlocks(
  supabase: SupabaseClient,
  template: BlockTemplate,
  userId: string
): Promise<ScheduleBlock[]> {
  if ((template.slots ?? []).length === 0) return [];

  const matchingDates = matchingDatesForTemplate(template.recurrence_days);
  if (matchingDates.length === 0) return [];

  const dateStrs = matchingDates.map(toDateStr);
  const { data: existing } = await supabase
    .from("schedule_blocks")
    .select("day, slot_id")
    .eq("user_id", userId)
    .eq("template_id", template.id)
    .in("day", dateStrs);

  const payload = planTemplateStamping(
    template,
    matchingDates,
    (existing ?? []) as Array<{ day: string; slot_id?: string | null }>,
    userId
  );
  if (payload.length === 0) return [];

  const { data: created } = await supabase
    .from("schedule_blocks")
    .insert(payload)
    .select();

  return (created as ScheduleBlock[]) ?? [];
}

/**
 * Reconcile an incoming slot list (no ids) against a template's existing
 * slots, reusing the existing slot's id when start_time matches (then
 * duration as tie-break is unnecessary — validateSlots guarantees distinct
 * start times within a list). New start times get fresh UUIDs.
 */
export function reconcileSlotIds(
  existing: TemplateSlot[],
  incoming: Array<{ start_time: string; duration_minutes: number }>
): TemplateSlot[] {
  const byStart = new Map(existing.map((s) => [s.start_time, s.id]));
  return incoming.map((s) => ({
    id: byStart.get(s.start_time) ?? crypto.randomUUID(),
    start_time: s.start_time,
    duration_minutes: s.duration_minutes,
  }));
}

/**
 * Rebuild a template's upcoming copies after the template changed: delete
 * untagged copies from today onward, re-stamp all slots x recurrence days,
 * and leave customized/done copies untouched (no duplicates beside them).
 */
export async function rebuildTemplateBlocks(
  supabase: SupabaseClient,
  template: BlockTemplate,
  userId: string
): Promise<{ deletedIds: string[]; created: ScheduleBlock[] }> {
  const todayStr = toDateStr(new Date());
  const { data: upcoming } = await supabase
    .from("schedule_blocks")
    .select("id, day, slot_id, customized, done")
    .eq("user_id", userId)
    .eq("template_id", template.id)
    .gte("day", todayStr);

  const dates = matchingDatesForTemplate(template.recurrence_days);
  const { deleteIds, inserts } = planTemplateRebuild(
    template,
    dates,
    (upcoming ?? []) as Array<Pick<ScheduleBlock, "id" | "day" | "slot_id" | "customized" | "done">>,
    userId
  );

  if (deleteIds.length > 0) {
    await supabase
      .from("schedule_blocks")
      .delete()
      .eq("user_id", userId)
      .in("id", deleteIds);
  }

  let created: ScheduleBlock[] = [];
  if (inserts.length > 0) {
    const { data } = await supabase.from("schedule_blocks").insert(inserts).select();
    created = (data as ScheduleBlock[]) ?? [];
  }
  return { deletedIds: deleteIds, created };
}
