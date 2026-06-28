"use client";

import PomodoroTimer from "@/components/focus/PomodoroTimer";
import type { ScheduleBlock, FocusSession } from "@/lib/types";

interface Props {
  focusSessions: FocusSession[];
  todayBlocks: ScheduleBlock[];
  isGuest: boolean;
  userId: string | null;
}

function fmtSecs(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const x = s % 60;
  return `${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}

const MODE_LABELS: Record<string, string> = {
  focus: "Focus",
  short: "Short break",
  long:  "Long break",
};

const MODE_COLORS: Record<string, string> = {
  focus: "text-violet",
  short: "text-cadence-green",
  long:  "text-amber",
};

export default function FocusView({ focusSessions, todayBlocks, isGuest, userId }: Props) {
  const todayStr = new Date().toISOString().split("T")[0];
  const todaySessions = focusSessions.filter((s) => s.started_at.startsWith(todayStr));
  const focusSecs   = todaySessions.filter((s) => s.mode === "focus").reduce((a, s) => a + s.actual_seconds, 0);
  const completedCount = todaySessions.filter((s) => s.completed && s.mode === "focus").length;

  return (
    <div className="flex flex-col gap-5">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-panel border border-line rounded-[16px] p-4">
          <p className="text-[11.5px] text-muted uppercase tracking-wider mb-1">Today&apos;s focus</p>
          <p className="font-grotesk font-semibold text-[28px] text-violet">
            {focusSecs > 0 ? fmtSecs(focusSecs) : "—"}
          </p>
          <p className="text-[11px] text-faint">deep work time</p>
        </div>
        <div className="bg-panel border border-line rounded-[16px] p-4">
          <p className="text-[11.5px] text-muted uppercase tracking-wider mb-1">Sessions</p>
          <p className="font-grotesk font-semibold text-[28px] text-txt">{completedCount}</p>
          <p className="text-[11px] text-faint">completed today</p>
        </div>
        <div className="bg-panel border border-line rounded-[16px] p-4">
          <p className="text-[11.5px] text-muted uppercase tracking-wider mb-1">This week</p>
          <p className="font-grotesk font-semibold text-[28px] text-txt">
            {fmtSecs(focusSessions.filter((s) => s.mode === "focus").reduce((a, s) => a + s.actual_seconds, 0))}
          </p>
          <p className="text-[11px] text-faint">total focus time</p>
        </div>
      </div>

      {/* Timer + session log side-by-side */}
      <div className="grid grid-cols-[1fr_1.1fr] gap-5 items-start">
        <PomodoroTimer
          activeBlock={todayBlocks[0] ?? null}
          isGuest={isGuest}
          userId={userId}
        />

        {/* Today's session log */}
        <div className="bg-panel border border-line rounded-[18px] p-5">
          <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-1">Today&apos;s sessions</h2>
          <p className="text-muted text-[12.5px] mb-4">Sessions logged since midnight</p>

          {todaySessions.length === 0 ? (
            <p className="text-center text-faint text-[13px] py-6">No sessions yet — start the timer!</p>
          ) : (
            <div className="flex flex-col gap-2">
              {[...todaySessions].reverse().map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-2 border-b border-line last:border-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    s.completed ? "bg-cadence-green" : "bg-line"
                  }`} />
                  <div className="flex-1">
                    <span className={`text-[13px] font-medium ${MODE_COLORS[s.mode] ?? "text-txt"}`}>
                      {MODE_LABELS[s.mode] ?? s.mode}
                    </span>
                    {s.actual_seconds > 0 && (
                      <span className="text-[12px] text-muted ml-2">{fmt(s.actual_seconds)}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-faint tabular-nums">
                    {new Date(s.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {s.completed && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-cadence-green">
                      <path d="M20 6 9 17l-5-5"/>
                    </svg>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pomodoro technique guide */}
      <div className="bg-panel border border-line rounded-[18px] p-5">
        <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-4">The Pomodoro Technique</h2>
        <div className="grid grid-cols-4 gap-4 mb-5">
          {[
            { step: "1", label: "Pick a task", body: "Choose one focused task from your schedule. Clarity beats multitasking every time." },
            { step: "2", label: "Work 25 min", body: "Set the timer and work with full concentration. No notifications, no switching." },
            { step: "3", label: "Short break", body: "Take a 5-minute break. Stand up, breathe, hydrate. Let your mind consolidate." },
            { step: "4", label: "Long break", body: "After 4 pomodoros, take a 15–30 min break. Your brain needs recovery to sustain depth." },
          ].map(({ step, label, body }) => (
            <div key={step} className="bg-ink/50 rounded-[14px] p-4">
              <div className="w-7 h-7 rounded-full bg-violet/20 grid place-items-center mb-2">
                <span className="text-[11px] font-grotesk font-bold text-violet">{step}</span>
              </div>
              <p className="font-grotesk font-semibold text-[13px] text-txt mb-1">{label}</p>
              <p className="text-[12px] text-muted leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { title: "Why it works", body: "Timeboxing creates urgency. Knowing the timer ends in 25 minutes reduces procrastination and makes starting easier." },
            { title: "The science", body: "Working memory degrades over long sessions. Regular breaks restore attention and maintain cognitive performance throughout the day." },
            { title: "Pro tip", body: "Track interruptions. When you feel an urge to check something, write it down and return to it after the session ends." },
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
