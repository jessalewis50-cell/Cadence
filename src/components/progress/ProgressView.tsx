"use client";

import type { Habit, HabitLog, FocusSession, ScheduleBlock } from "@/lib/types";

interface Props {
  habits: Habit[];
  allLogs: HabitLog[];
  focusSessions: FocusSession[];
  todayBlocks: ScheduleBlock[];
}

function fmtSecs(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

export default function ProgressView({ habits, allLogs, focusSessions, todayBlocks }: Props) {
  const todayStr = toDateStr(new Date());

  // Week metrics
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = toDateStr(weekStart);

  const weekLogs  = allLogs.filter((l) => l.day >= weekStartStr && l.completed);
  const weekSessions = focusSessions.filter((s) => s.started_at >= weekStart.toISOString());
  const focusSecs = weekSessions.filter((s) => s.mode === "focus").reduce((a, s) => a + s.actual_seconds, 0);
  const completedSessions = weekSessions.filter((s) => s.completed && s.mode === "focus").length;

  const dayOfWeek   = new Date().getDay();
  const daysElapsed = Math.max(1, dayOfWeek === 0 ? 7 : dayOfWeek);
  const habitsPct   = habits.length > 0
    ? Math.min(100, Math.round((weekLogs.length / (habits.length * daysElapsed)) * 100))
    : 0;

  const totalPlanned = weekSessions.reduce((a, s) => a + s.planned_seconds, 0);
  const totalActual  = weekSessions.reduce((a, s) => a + s.actual_seconds, 0);
  const focusPct     = totalPlanned > 0 ? Math.min(100, Math.round((totalActual / totalPlanned) * 100)) : 0;
  const deepWorkPct  = weekSessions.length > 0 ? Math.round((completedSessions / weekSessions.length) * 100) : 0;
  const activeDays   = new Set(weekLogs.map((l) => l.day)).size;
  const consistencyPct = Math.min(100, Math.round((activeDays / 7) * 100));

  const todayLogs    = allLogs.filter((l) => l.day === todayStr && l.completed);
  const todayDone    = todayBlocks.filter((b) => b.done).length;

  // Build 7-day trend data
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const ds = toDateStr(d);
    const dayLogs   = allLogs.filter((l) => l.day === ds && l.completed);
    const dayFocus  = focusSessions.filter((s) => s.started_at.startsWith(ds) && s.mode === "focus");
    const habitDone = habits.length > 0 ? Math.round((dayLogs.length / habits.length) * 100) : 0;
    const focSecs   = dayFocus.reduce((a, s) => a + s.actual_seconds, 0);
    return { ds, label: d.toLocaleDateString(undefined, { weekday: "short" }), habitDone, focSecs };
  });

  const maxFocusSecs = Math.max(...last7.map((d) => d.focSecs), 1);

  const bars = [
    { label: "Habits", pct: habitsPct, color: "from-cadence-green to-cadence-green" },
    { label: "Deep work sessions", pct: deepWorkPct, color: "from-violet to-magenta" },
    { label: "Focus time vs planned", pct: focusPct, color: "from-violet to-magenta" },
    { label: "Consistency", pct: consistencyPct, color: "from-amber to-amber" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Key metrics */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Habits today", value: `${todayLogs.length}/${habits.length}`, sub: "completed" },
          { label: "Blocks today", value: `${todayDone}/${todayBlocks.length}`, sub: "done" },
          { label: "Focus this week", value: focusSecs > 0 ? fmtSecs(focusSecs) : "—", sub: "deep work" },
          { label: "Week consistency", value: `${consistencyPct}%`, sub: `${activeDays} of 7 days active` },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-panel border border-line rounded-[16px] p-4">
            <p className="text-[11.5px] text-muted uppercase tracking-wider mb-1">{label}</p>
            <p className="font-grotesk font-semibold text-[22px] text-txt">{value}</p>
            <p className="text-[11px] text-faint mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Weekly progress bars */}
      <div className="bg-panel border border-line rounded-[18px] p-5">
        <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-1">This week</h2>
        <p className="text-muted text-[12.5px] mb-5">Progress resets each Sunday</p>
        <div className="flex flex-col gap-4">
          {bars.map(({ label, pct, color }) => (
            <div key={label}>
              <div className="flex justify-between mb-1.5">
                <span className="text-[13px] text-txt">{label}</span>
                <span className="text-[13px] font-grotesk font-semibold text-txt tabular-nums">{pct}%</span>
              </div>
              <div className="h-2 bg-ink rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full bg-linear-to-r ${color} transition-all duration-700`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 7-day trends */}
      <div className="grid grid-cols-2 gap-5">
        {/* Habit completion trend */}
        <div className="bg-panel border border-line rounded-[18px] p-5">
          <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-4">Habit completion — 7 days</h2>
          <div className="flex items-end gap-2 h-[100px]">
            {last7.map(({ ds, label, habitDone }) => {
              const isFuture = ds > todayStr;
              return (
                <div key={ds} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: "80px" }}>
                    <div
                      title={`${habitDone}%`}
                      className={`w-full rounded-t-md transition-all ${
                        isFuture ? "bg-ink/30" : "bg-cadence-green/70"
                      }`}
                      style={{ height: isFuture ? "4px" : `${Math.max(4, habitDone * 0.8)}px` }}
                    />
                  </div>
                  <span className="text-[10px] text-faint">{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Focus time trend */}
        <div className="bg-panel border border-line rounded-[18px] p-5">
          <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-4">Focus time — 7 days</h2>
          <div className="flex items-end gap-2 h-[100px]">
            {last7.map(({ ds, label, focSecs }) => {
              const isFuture = ds > todayStr;
              const barH = isFuture ? 4 : Math.max(4, (focSecs / maxFocusSecs) * 80);
              return (
                <div key={ds} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: "80px" }}>
                    <div
                      title={focSecs > 0 ? fmtSecs(focSecs) : "0"}
                      className={`w-full rounded-t-md transition-all ${isFuture ? "bg-ink/30" : "bg-violet/60"}`}
                      style={{ height: `${barH}px` }}
                    />
                  </div>
                  <span className="text-[10px] text-faint">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="bg-panel border border-line rounded-[18px] p-5">
        <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-4">Insights & benchmarks</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              title: "Deep work target",
              body: "Knowledge workers performing at peak level typically log 3–4 hours of deep, distraction-free work per day. Protect your best hours.",
            },
            {
              title: "Habit stacking",
              body: "Research shows it takes 66 days on average to form a habit — not 21. Consistency matters more than streaks. Show up even on hard days.",
            },
            {
              title: "Review weekly",
              body: "High performers use a weekly review to close loops, celebrate wins, and set next-week intentions. 15 minutes every Sunday pays dividends.",
            },
          ].map(({ title, body }) => (
            <div key={title} className="bg-ink/50 rounded-[14px] p-4">
              <p className="font-grotesk font-semibold text-[13px] text-violet mb-1.5">{title}</p>
              <p className="text-[12.5px] text-muted leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
