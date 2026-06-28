"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Habit, HabitLog, FocusSession } from "@/lib/types";

interface Props {
  habits: Habit[];
  allLogs: HabitLog[];
  focusSessions: FocusSession[];
  isGuest: boolean;
}

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function getWeekDays(): Date[] {
  const today = new Date();
  const monday = new Date(today);
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(today.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtSecs(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function WeekView({ habits, allLogs, focusSessions, isGuest }: Props) {
  const supabase = createClient();
  const weekDays = getWeekDays();
  const todayStr = toDateStr(new Date());

  // Fetch this week's blocks counts per day (client-side for week view)
  const [blockCounts, setBlockCounts] = useState<Record<string, { total: number; done: number }>>({});

  useEffect(() => {
    if (isGuest) return;
    const weekStart = toDateStr(weekDays[0]);
    const weekEnd   = toDateStr(weekDays[6]);
    supabase
      .from("schedule_blocks")
      .select("day, done")
      .gte("day", weekStart)
      .lte("day", weekEnd)
      .then(({ data }) => {
        if (!data) return;
        const counts: Record<string, { total: number; done: number }> = {};
        for (const b of data) {
          if (!counts[b.day]) counts[b.day] = { total: 0, done: 0 };
          counts[b.day].total++;
          if (b.done) counts[b.day].done++;
        }
        setBlockCounts(counts);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  // Compute per-day habit completion
  function habitPct(dayStr: string) {
    if (habits.length === 0) return null;
    const done = allLogs.filter((l) => l.day === dayStr && l.completed).length;
    return Math.round((done / habits.length) * 100);
  }

  // Compute per-day focus time from focusSessions
  function focusSecsForDay(dayStr: string) {
    return focusSessions
      .filter((s) => s.started_at.startsWith(dayStr))
      .reduce((sum, s) => sum + s.actual_seconds, 0);
  }

  // Totals for week
  const weekStart = toDateStr(weekDays[0]);
  const weekEnd   = toDateStr(weekDays[6]);
  const weekLogs  = allLogs.filter((l) => l.day >= weekStart && l.day <= weekEnd && l.completed);
  const weekFocus = focusSessions.filter((s) => s.started_at >= weekDays[0].toISOString());
  const totalFocusSecs = weekFocus.reduce((s, x) => s + x.actual_seconds, 0);
  const completedSessions = weekFocus.filter((s) => s.completed).length;

  const activeDays = new Set(weekLogs.map((l) => l.day)).size;

  return (
    <div className="flex flex-col gap-5">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Focus time", value: totalFocusSecs > 0 ? fmtSecs(totalFocusSecs) : "—", sub: "this week" },
          { label: "Sessions done", value: String(completedSessions), sub: "completed" },
          { label: "Active days", value: String(activeDays), sub: "of 7" },
          { label: "Habit checks", value: String(weekLogs.length), sub: `of ${habits.length * 7} possible` },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-panel border border-line rounded-[16px] p-4">
            <p className="text-[11.5px] text-muted uppercase tracking-wider mb-1">{label}</p>
            <p className="font-grotesk font-semibold text-[22px] text-txt">{value}</p>
            <p className="text-[11px] text-faint mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Day-by-day grid */}
      <div className="bg-panel border border-line rounded-[18px] p-5">
        <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-4">This week</h2>
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((day, i) => {
            const dayStr  = toDateStr(day);
            const isToday = dayStr === todayStr;
            const isFuture = dayStr > todayStr;
            const pct   = habitPct(dayStr);
            const secs  = focusSecsForDay(dayStr);
            const bc    = blockCounts[dayStr];

            return (
              <div
                key={dayStr}
                className={`flex flex-col items-center gap-2 p-3 rounded-[14px] border transition-colors ${
                  isToday ? "border-violet/50 bg-violet/8" : "border-line"
                } ${isFuture ? "opacity-40" : ""}`}
              >
                <span className="text-[11px] text-muted font-medium uppercase tracking-wider">{DAY_LABELS[i]}</span>
                <span className={`font-grotesk font-semibold text-[18px] ${isToday ? "text-violet" : "text-txt"}`}>
                  {day.getDate()}
                </span>

                {/* Habit dot */}
                <div className="w-full">
                  {pct !== null && !isFuture ? (
                    <div className="w-full bg-ink rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-cadence-green transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : (
                    <div className="w-full bg-ink rounded-full h-1.5" />
                  )}
                  {pct !== null && !isFuture && (
                    <span className="text-[10px] text-faint">{pct}% habits</span>
                  )}
                </div>

                {/* Focus time */}
                {secs > 0 && (
                  <span className="text-[11px] text-violet font-medium">{fmtSecs(secs)}</span>
                )}

                {/* Blocks */}
                {bc && (
                  <span className="text-[10px] text-faint">{bc.done}/{bc.total} blocks</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Focus breakdown by mode */}
      {weekFocus.length > 0 && (
        <div className="bg-panel border border-line rounded-[18px] p-5">
          <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-4">Focus breakdown</h2>
          {(["focus", "short", "long"] as const).map((mode) => {
            const sessions = weekFocus.filter((s) => s.mode === mode);
            const secs = sessions.reduce((s, x) => s + x.actual_seconds, 0);
            const labels = { focus: "Focus sessions", short: "Short breaks", long: "Long breaks" };
            if (sessions.length === 0) return null;
            return (
              <div key={mode} className="flex items-center gap-3 mb-2">
                <span className="text-[13px] text-muted w-[120px] shrink-0">{labels[mode]}</span>
                <div className="flex-1 bg-ink rounded-full h-2">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-violet to-magenta"
                    style={{ width: `${Math.min(100, (secs / (totalFocusSecs || 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-[12px] text-txt tabular-nums w-14 text-right">{fmtSecs(secs)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
