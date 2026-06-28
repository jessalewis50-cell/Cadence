"use client";

import type { Habit, HabitLog, FocusSession } from "@/lib/types";

interface Props {
  habits: Habit[];
  allLogs: HabitLog[];
  focusSessions: FocusSession[];
}

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function fmtSecs(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const MONTH_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MonthView({ habits, allLogs, focusSessions }: Props) {
  const today = new Date();
  const todayStr = toDateStr(today);
  const year  = today.getFullYear();
  const month = today.getMonth();

  const monthName = today.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // Build calendar grid
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay(); // 0=Sun
  const totalCells = startPad + lastDay.getDate();
  const rows = Math.ceil(totalCells / 7);

  const cells: (Date | null)[] = Array.from({ length: rows * 7 }, (_, i) => {
    const dayNum = i - startPad + 1;
    if (dayNum < 1 || dayNum > lastDay.getDate()) return null;
    return new Date(year, month, dayNum);
  });

  // Per-day habit pct
  function habitPct(dayStr: string): number | null {
    if (habits.length === 0) return null;
    const done = allLogs.filter((l) => l.day === dayStr && l.completed).length;
    if (done === 0) return 0;
    return Math.round((done / habits.length) * 100);
  }

  function focusSecsForDay(dayStr: string) {
    return focusSessions
      .filter((s) => s.started_at.startsWith(dayStr))
      .reduce((sum, s) => sum + s.actual_seconds, 0);
  }

  // Monthly totals
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd   = toDateStr(lastDay);
  const monthLogs  = allLogs.filter((l) => l.day >= monthStart && l.day <= monthEnd && l.completed);
  const monthFocus = focusSessions.filter((s) => {
    const d = s.started_at.slice(0, 10);
    return d >= monthStart && d <= monthEnd;
  });
  const totalFocusSecs = monthFocus.reduce((s, x) => s + x.actual_seconds, 0);
  const activeDays = new Set(monthLogs.map((l) => l.day)).size;
  const completedSessions = monthFocus.filter((s) => s.completed).length;

  // Best streak calculation
  let bestStreak = 0;
  let curStreak  = 0;
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dayStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const hasLog = allLogs.some((l) => l.day === dayStr && l.completed);
    if (hasLog) {
      curStreak++;
      bestStreak = Math.max(bestStreak, curStreak);
    } else {
      curStreak = 0;
    }
  }

  function cellColor(pct: number | null, isFuture: boolean): string {
    if (isFuture || pct === null) return "";
    if (pct === 0) return "bg-ink";
    if (pct < 50) return "bg-violet/20";
    if (pct < 80) return "bg-violet/50";
    return "bg-violet";
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Focus time", value: totalFocusSecs > 0 ? fmtSecs(totalFocusSecs) : "—", sub: "this month" },
          { label: "Sessions done", value: String(completedSessions), sub: "completed" },
          { label: "Active days", value: String(activeDays), sub: `of ${lastDay.getDate()}` },
          { label: "Best streak", value: bestStreak > 0 ? `${bestStreak}d` : "—", sub: "consecutive days" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-panel border border-line rounded-[16px] p-4">
            <p className="text-[11.5px] text-muted uppercase tracking-wider mb-1">{label}</p>
            <p className="font-grotesk font-semibold text-[22px] text-txt">{value}</p>
            <p className="text-[11px] text-faint mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <div className="bg-panel border border-line rounded-[18px] p-5">
        <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-4">{monthName}</h2>

        {/* Legend */}
        <div className="flex items-center gap-4 mb-4 text-[11px] text-faint">
          <span>Habit completion:</span>
          {[
            { cls: "bg-ink", label: "0%" },
            { cls: "bg-violet/20", label: "1–49%" },
            { cls: "bg-violet/50", label: "50–79%" },
            { cls: "bg-violet", label: "80–100%" },
          ].map(({ cls, label }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-sm ${cls} border border-line`} />
              {label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {MONTH_DAY_LABELS.map((l) => (
            <div key={l} className="text-center text-[10.5px] text-faint font-medium py-1">{l}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} />;
            const dayStr   = toDateStr(day);
            const isToday  = dayStr === todayStr;
            const isFuture = dayStr > todayStr;
            const pct   = habitPct(dayStr);
            const secs  = focusSecsForDay(dayStr);

            return (
              <div
                key={dayStr}
                title={pct !== null && !isFuture ? `${pct}% habits${secs > 0 ? ` · ${fmtSecs(secs)} focus` : ""}` : undefined}
                className={[
                  "aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 relative transition-colors",
                  !isFuture && pct !== null ? cellColor(pct, isFuture) : "bg-ink/30",
                  isToday ? "ring-2 ring-violet ring-offset-1 ring-offset-panel" : "",
                  isFuture ? "opacity-30" : "",
                ].join(" ")}
              >
                <span className={`text-[11px] font-medium ${pct !== null && pct >= 80 && !isFuture ? "text-white" : "text-txt"}`}>
                  {day.getDate()}
                </span>
                {secs > 60 && !isFuture && (
                  <span className="w-1 h-1 rounded-full bg-magenta absolute bottom-1" />
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-faint mt-3">
          Purple dot = focus session recorded that day
        </p>
      </div>

      {/* Monthly habits breakdown */}
      {habits.length > 0 && (
        <div className="bg-panel border border-line rounded-[18px] p-5">
          <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-4">Habit performance</h2>
          <div className="flex flex-col gap-3">
            {habits.map((habit) => {
              const completedDays = new Set(
                monthLogs.filter((l) => l.habit_id === habit.id).map((l) => l.day)
              ).size;
              const pct = Math.round((completedDays / lastDay.getDate()) * 100);
              return (
                <div key={habit.id}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[13px] text-txt">{habit.name}</span>
                    <span className="text-[12px] text-muted tabular-nums">{completedDays}d · {pct}%</span>
                  </div>
                  <div className="h-1.5 bg-ink rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-linear-to-r from-violet to-magenta transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
