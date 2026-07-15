import type { SupabaseClient } from "@supabase/supabase-js";
import { addMinutes, toDateStr } from "@/lib/time";
import type { BlockTemplate, ScheduleBlock } from "@/lib/types";

const DEFAULT_WEEKS_AHEAD = 4;

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
 * Create recurring schedule_blocks for a template across the next 4 weeks,
 * skipping days that already have a block with the same title (dedupe), and
 * marking each created block `source: "template"`. Returns the rows created.
 *
 * This is the single source of truth for turning a saved block into calendar
 * entries — used by both the Blocks page (client) and the agent route (server).
 * It's a no-op unless the template has both `recurrence_days` and a
 * `default_start_time` (without a start time the block can't be placed).
 */
export async function scheduleTemplateBlocks(
  supabase: SupabaseClient,
  template: BlockTemplate,
  userId: string
): Promise<ScheduleBlock[]> {
  if (!template.default_start_time) return [];

  const matchingDates = matchingDatesForTemplate(template.recurrence_days);
  if (matchingDates.length === 0) return [];

  const dateStrs = matchingDates.map(toDateStr);

  // Skip days that already have a block with this title so we don't duplicate.
  const { data: existing } = await supabase
    .from("schedule_blocks")
    .select("day")
    .eq("user_id", userId)
    .eq("title", template.title)
    .in("day", dateStrs);

  const existingDays = new Set((existing ?? []).map((b: { day: string }) => b.day));
  const toCreate = matchingDates.filter((d) => !existingDays.has(toDateStr(d)));
  if (toCreate.length === 0) return [];

  const payload = toCreate.map((d) => ({
    user_id: userId,
    day: toDateStr(d),
    start_time: template.default_start_time!,
    end_time: addMinutes(template.default_start_time!, template.duration_minutes),
    title: template.title,
    category: template.category,
    activity: template.activity ?? null,
    detail: template.detail ?? null,
    position: 0,
    done: false,
    source: "template" as const,
    template_id: template.id,
  }));

  const { data: created } = await supabase
    .from("schedule_blocks")
    .insert(payload)
    .select();

  return (created as ScheduleBlock[]) ?? [];
}
