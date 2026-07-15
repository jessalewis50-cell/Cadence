"use client";

import type { Habit, ScheduleBlock } from "@/lib/types";
import { toDateStr } from "@/lib/time";

interface Props {
  habits: Habit[];
  // Elapsed-or-not blocks for the current week. Completion and the weekly time
  // summary are both inferred from these — no manual check-off.
  weekBlocks: ScheduleBlock[];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

const normalize = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// A block is "elapsed" once its end time has passed: any past day, or today
// once the current time is at/after its end.
function isElapsed(block: ScheduleBlock, todayStr: string, nowMinutes: number): boolean {
  if (block.day < todayStr) return true;
  if (block.day > todayStr) return false;
  return timeToMinutes(block.end_time) <= nowMinutes;
}

function blockMinutes(b: ScheduleBlock): number {
  return Math.max(0, timeToMinutes(b.end_time) - timeToMinutes(b.start_time));
}

// e.g. 270 → "4.5h", 180 → "3h", 30 → "0.5h"
function formatHours(mins: number): string {
  const rounded = Math.round((mins / 60) * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

export default function HabitList({ habits, weekBlocks }: Props) {
  const now = new Date();
  const todayStr = toDateStr(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Current week, Sunday-start — matches the "This week" bars.
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekStartStr = toDateStr(weekStart);

  // Elapsed blocks this week that carry an activity label.
  const elapsedWeek = weekBlocks.filter(
    (b) => b.activity && b.day >= weekStartStr && isElapsed(b, todayStr, nowMinutes)
  );

  const stats = habits.map((habit) => {
    // Match on the habit's explicit activity label, falling back to its name.
    const key = normalize(habit.activity || habit.name);
    const matches = elapsedWeek.filter((b) => normalize(b.activity) === key);
    const minutes = matches.reduce((sum, b) => sum + blockMinutes(b), 0);
    const doneToday = matches.some((b) => b.day === todayStr);
    return { habit, minutes, doneToday };
  });

  const completedCount = stats.filter((s) => s.doneToday).length;
  const donePct =
    habits.length > 0 ? Math.round((completedCount / habits.length) * 100) : 0;

  return (
    <section className="bg-panel border border-line rounded-[18px] p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-grotesk font-semibold text-[15px] tracking-wide text-txt">
            Habits
          </h2>
          <p className="text-muted text-[12.5px] mt-0.5">Today · tracked from your schedule</p>
        </div>
        <span className="font-grotesk font-semibold text-[22px] text-cadence-green tabular-nums">
          {donePct}%
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {stats.map(({ habit, minutes, doneToday }) => (
          <div key={habit.id} className="flex items-center gap-3 py-1 px-0.5">
            <div
              className={[
                "w-[22px] h-[22px] rounded-[7px] border flex-shrink-0 grid place-items-center transition-colors",
                doneToday ? "bg-cadence-green border-cadence-green" : "border-line",
              ].join(" ")}
              aria-label={doneToday ? "Done today" : "Not yet done today"}
            >
              {doneToday && (
                <svg
                  width="13" height="13" viewBox="0 0 24 24"
                  fill="none" stroke="#0e0e14" strokeWidth="3.5"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </div>

            <span className={`flex-1 text-[14px] ${doneToday ? "text-muted" : "text-txt"}`}>
              {habit.name}
            </span>

            <span className="text-[11.5px] text-faint tabular-nums">
              {minutes > 0 ? formatHours(minutes) : "—"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
