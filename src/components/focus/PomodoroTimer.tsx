"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { ScheduleBlock, TimerMode } from "@/lib/types";

// r=88 in a 200×200 viewBox
const CIRC = 2 * Math.PI * 88;

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const x = s % 60;
  return `${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function nowSeconds(): number {
  const n = new Date();
  return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
}

// ── Day-plan types ────────────────────────────────────────────────────────────

interface Segment {
  label:   string;
  start:   string; // "HH:MM"
  end:     string;
  type:    "block" | "break";
  detail?: string | null;
  done?:   boolean;
}

function buildSegments(blocks: ScheduleBlock[]): Segment[] {
  const sorted = [...blocks]
    .filter((b) => b.start_time && b.end_time)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const segs: Segment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    segs.push({ label: b.title, start: b.start_time, end: b.end_time, type: "block", detail: b.detail, done: b.done });
    if (i < sorted.length - 1 && sorted[i + 1].start_time > b.end_time) {
      segs.push({ label: "Break", start: b.end_time, end: sorted[i + 1].start_time, type: "break" });
    }
  }
  return segs;
}

function currentSegIdx(segs: Segment[]): number {
  const now = nowSeconds();
  for (let i = 0; i < segs.length; i++) {
    const s = toMinutes(segs[i].start) * 60;
    const e = toMinutes(segs[i].end) * 60;
    if (now >= s && now < e) return i;
  }
  if (segs.length > 0 && now < toMinutes(segs[0].start) * 60) return -1;
  return segs.length; // past end
}

function segRemaining(seg: Segment): number {
  const endSec = toMinutes(seg.end) * 60;
  return Math.max(0, endSec - nowSeconds());
}

function segTotal(seg: Segment): number {
  return (toMinutes(seg.end) - toMinutes(seg.start)) * 60;
}

function to12h(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ── Ring SVG ─────────────────────────────────────────────────────────────────

function Ring({ remaining, total, running, center }: {
  remaining: number;
  total: number;
  running: boolean;
  center: React.ReactNode;
}) {
  const offset = total > 0 ? CIRC * (1 - remaining / total) : 0;
  return (
    <div className="relative w-full max-w-[200px] mx-auto aspect-square my-1">
      <svg viewBox="0 0 200 200" className="w-full h-full" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="100" cy="100" r="88" stroke="#2a2a38" strokeWidth="10" fill="none"/>
        <circle
          cx="100" cy="100" r="88"
          stroke="url(#timerGrad)"
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          style={{ transition: running ? "stroke-dashoffset 1s linear" : "none" }}
        />
        <defs>
          <linearGradient id="timerGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c6cff"/>
            <stop offset="1" stopColor="#e879c9"/>
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3">
        {center}
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  activeBlock:  ScheduleBlock | null;
  todayBlocks?: ScheduleBlock[];
  isGuest:      boolean;
  userId:       string | null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PomodoroTimer({ activeBlock, todayBlocks = [], isGuest, userId }: Props) {
  const [appMode, setAppMode] = useState<"pomodoro" | "dayplan">("dayplan");

  return (
    <section className="bg-panel border border-line rounded-[18px] p-4 flex flex-col">
      {/* Top-level mode selector */}
      <div className="flex gap-1 bg-ink border border-line rounded-[10px] p-1 mb-4">
        <button
          onClick={() => setAppMode("dayplan")}
          className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
            appMode === "dayplan" ? "bg-panel-2 text-txt" : "text-muted hover:text-txt"
          }`}
        >
          Today&apos;s plan
        </button>
        <button
          onClick={() => setAppMode("pomodoro")}
          className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
            appMode === "pomodoro" ? "bg-panel-2 text-txt" : "text-muted hover:text-txt"
          }`}
        >
          Focus timer
        </button>
      </div>

      {appMode === "pomodoro" ? (
        <PomodoroMode activeBlock={activeBlock} isGuest={isGuest} userId={userId} />
      ) : (
        <DayPlanMode blocks={todayBlocks} />
      )}
    </section>
  );
}

// ── Pomodoro mode ─────────────────────────────────────────────────────────────

function PomodoroMode({ activeBlock, isGuest, userId }: {
  activeBlock: ScheduleBlock | null;
  isGuest: boolean;
  userId: string | null;
}) {
  const supabase = createClient();

  const [shortBreakMins, setShortBreakMins] = useState(5);
  const [longBreakMins, setLongBreakMins]   = useState(15);
  const [showSettings, setShowSettings]     = useState(false);
  const [settingShort, setSettingShort]     = useState("5");
  const [settingLong, setSettingLong]       = useState("15");

  const modes = [
    { mode: "focus" as TimerMode, label: "Focus",       seconds: 25 * 60 },
    { mode: "short" as TimerMode, label: "Short break", seconds: shortBreakMins * 60 },
    { mode: "long"  as TimerMode, label: "Long break",  seconds: longBreakMins * 60 },
  ];

  const [modeIdx,   setModeIdx]   = useState(0);
  const [total,     setTotal]     = useState(modes[0].seconds);
  const [remaining, setRemaining] = useState(modes[0].seconds);
  const [running,   setRunning]   = useState(false);
  const [done,      setDone]      = useState(false);

  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;

  const saveSession = useCallback(async (actualSeconds: number, completed: boolean) => {
    if (!isGuest && sessionIdRef.current) {
      await supabase.from("focus_sessions").update({
        actual_seconds: actualSeconds,
        completed,
        ended_at: new Date().toISOString(),
      }).eq("id", sessionIdRef.current);
      sessionIdRef.current = null;
    }
  }, [isGuest, supabase]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const elapsed = total - remainingRef.current;
      if (elapsed > 0) saveSession(elapsed, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    if (running) return;
    if (!isGuest && userId) {
      const { data } = await supabase.from("focus_sessions").insert({
        user_id: userId, block_id: activeBlock?.id ?? null,
        mode: modes[modeIdx].mode, planned_seconds: total, actual_seconds: 0,
      }).select("id").single();
      if (data) sessionIdRef.current = data.id;
    }
    setRunning(true); setDone(false);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) { clearInterval(intervalRef.current!); setRunning(false); setDone(true); saveSession(total, true); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  async function pause() {
    if (!running) return;
    clearInterval(intervalRef.current!); setRunning(false);
    await saveSession(total - remainingRef.current, false);
  }

  async function reset() {
    clearInterval(intervalRef.current!);
    const elapsed = total - remainingRef.current;
    if (elapsed > 0) await saveSession(elapsed, false);
    setRunning(false); setDone(false); setRemaining(total);
  }

  function switchMode(idx: number) {
    if (running) return;
    clearInterval(intervalRef.current!); sessionIdRef.current = null;
    setModeIdx(idx);
    const secs = modes[idx].seconds;
    setTotal(secs); setRemaining(secs); setRunning(false); setDone(false);
  }

  function applySettings() {
    const s = Math.max(1, Math.min(60, parseInt(settingShort) || 5));
    const l = Math.max(1, Math.min(120, parseInt(settingLong) || 15));
    setShortBreakMins(s); setLongBreakMins(l);
    setSettingShort(String(s)); setSettingLong(String(l));
    if (modeIdx === 1) { setTotal(s * 60); setRemaining(s * 60); }
    if (modeIdx === 2) { setTotal(l * 60); setRemaining(l * 60); }
    setShowSettings(false);
  }

  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex items-center gap-2 w-full justify-center mb-4">
        <div className="flex gap-1 bg-ink border border-line rounded-[10px] p-1">
          {modes.map((m, idx) => (
            <button key={m.mode} onClick={() => switchMode(idx)}
              className={`px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium transition-colors ${modeIdx === idx ? "bg-panel-2 text-txt" : "text-muted hover:text-txt"}`}>
              {m.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setShowSettings((v) => !v); setSettingShort(String(shortBreakMins)); setSettingLong(String(longBreakMins)); }}
          className="w-7 h-7 rounded-lg border border-transparent text-faint grid place-items-center hover:border-line hover:text-txt transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>

      {showSettings && (
        <div className="w-full mb-4 bg-ink border border-line rounded-[12px] p-4 text-left">
          <p className="text-[11px] font-medium text-muted mb-3 uppercase tracking-wider">Break durations</p>
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="text-[11.5px] text-muted block mb-1">Short (min)</span>
              <input type="number" min="1" max="60" value={settingShort}
                onChange={(e) => setSettingShort(e.target.value)}
                className="w-full bg-panel border border-line rounded-lg px-2 py-1.5 text-txt text-sm outline-none focus:border-violet transition-colors"/>
            </label>
            <label className="flex-1">
              <span className="text-[11.5px] text-muted block mb-1">Long (min)</span>
              <input type="number" min="1" max="120" value={settingLong}
                onChange={(e) => setSettingLong(e.target.value)}
                className="w-full bg-panel border border-line rounded-lg px-2 py-1.5 text-txt text-sm outline-none focus:border-violet transition-colors"/>
            </label>
          </div>
          <div className="flex gap-2 mt-3 justify-end">
            <button onClick={() => setShowSettings(false)}
              className="px-3 py-1 text-sm text-muted border border-line rounded-lg hover:border-violet transition-colors">Cancel</button>
            <button onClick={applySettings}
              className="px-3 py-1 text-sm text-white bg-violet rounded-lg hover:bg-[#6a59f5] transition-colors">Save</button>
          </div>
        </div>
      )}

      <Ring
        remaining={remaining} total={total} running={running}
        center={
          <>
            <span className="font-grotesk font-semibold text-[40px] tabular-nums text-txt leading-none">
              {fmt(remaining)}
            </span>
            {activeBlock && (
              <span className="text-muted text-[11px] leading-tight line-clamp-2 text-center">
                {activeBlock.title}
              </span>
            )}
          </>
        }
      />

      <div className="flex gap-2 mt-4">
        <button onClick={running ? pause : start}
          className="flex items-center justify-center gap-2 min-w-[100px] px-4 py-2 bg-violet text-white font-grotesk font-semibold text-[13px] rounded-xl hover:bg-[#6a59f5] transition-colors">
          {running ? (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Pause</>
          ) : done ? "Done! ✓" : (
            <><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>{remaining < total ? "Resume" : "Start"}</>
          )}
        </button>
        <button onClick={reset}
          className="px-4 py-2 border border-line bg-ink text-txt font-semibold text-[13px] rounded-xl hover:border-violet transition-colors">
          Reset
        </button>
      </div>

      {done && (
        <p className="mt-2.5 text-cadence-green text-[12.5px] font-medium animate-pulse">
          Session complete — take a break!
        </p>
      )}
    </div>
  );
}

// ── Day-plan mode ─────────────────────────────────────────────────────────────

function DayPlanMode({ blocks }: { blocks: ScheduleBlock[] }) {
  const segs = buildSegments(blocks);
  const [tick, setTick] = useState(0);

  // Re-render every second to keep timer accurate
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (segs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-6 gap-2">
        <p className="text-muted text-[13px]">No blocks scheduled today.</p>
        <p className="text-faint text-[12px]">Add blocks to Today&apos;s plan to use this timer.</p>
      </div>
    );
  }

  const idx      = currentSegIdx(segs);
  const isActive = idx >= 0 && idx < segs.length;
  const isBefore = idx === -1;
  const isAfter  = idx >= segs.length;

  const currentSeg   = isActive ? segs[idx] : null;
  const remaining    = currentSeg ? segRemaining(currentSeg) : 0;
  const total        = currentSeg ? segTotal(currentSeg) : 1;
  const isBreak      = currentSeg?.type === "break";

  // Before first block: show countdown to start
  const minsToStart  = isBefore
    ? Math.max(0, Math.ceil((toMinutes(segs[0].start) * 60 - nowSeconds()) / 60))
    : 0;

  return (
    <div className="flex flex-col items-center text-center">
      {/* Ring */}
      {isActive ? (
        <Ring
          remaining={remaining} total={total} running={!isBreak}
          center={
            <>
              <span className={`font-grotesk font-semibold text-[36px] tabular-nums leading-none ${isBreak ? "text-muted" : "text-txt"}`}>
                {fmt(remaining)}
              </span>
              <span className={`text-[11px] font-medium mt-0.5 line-clamp-2 leading-tight ${isBreak ? "text-faint" : "text-violet"}`}>
                {isBreak ? "Break" : currentSeg!.label}
              </span>
            </>
          }
        />
      ) : isBefore ? (
        <div className="w-full max-w-[200px] mx-auto aspect-square my-1 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-line rounded-full">
          <span className="font-grotesk font-semibold text-[32px] tabular-nums text-muted leading-none">{minsToStart}m</span>
          <span className="text-[11px] text-faint">until start</span>
        </div>
      ) : (
        <div className="w-full max-w-[200px] mx-auto aspect-square my-1 flex flex-col items-center justify-center gap-1 border-2 border-line rounded-full bg-ink">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
          <span className="text-[12px] text-cadence-green font-medium">Day complete</span>
        </div>
      )}

      {/* Day progress bar */}
      {segs.length > 0 && (
        <div className="w-full mt-3 mb-1">
          <div className="flex justify-between text-[10px] text-faint mb-1">
            <span>{to12h(segs[0].start)}</span>
            <span>{to12h(segs[segs.length - 1].end)}</span>
          </div>
          <div className="h-1.5 bg-ink rounded-full overflow-hidden">
            {(() => {
              const dayStart = toMinutes(segs[0].start) * 60;
              const dayEnd   = toMinutes(segs[segs.length - 1].end) * 60;
              const pct = isAfter ? 100
                : isBefore ? 0
                : Math.min(100, Math.round(((nowSeconds() - dayStart) / (dayEnd - dayStart)) * 100));
              return (
                <div className="h-full rounded-full bg-linear-to-r from-violet to-magenta transition-[width] duration-1000"
                  style={{ width: `${pct}%` }} />
              );
            })()}
          </div>
        </div>
      )}

      {/* Segment list */}
      <div className="w-full mt-3 flex flex-col gap-1 max-h-[220px] overflow-y-auto">
        {segs.map((seg, i) => {
          const isPast    = isAfter || (isActive && i < idx);
          const isCurrent = isActive && i === idx;
          const isFuture  = isBefore || (isActive && i > idx);

          return (
            <div key={i} className={[
              "flex items-start gap-2 px-2 py-1.5 rounded-[10px] text-left transition-colors",
              isCurrent ? "bg-violet/10 border border-violet/30" : "border border-transparent",
            ].join(" ")}>
              {/* Status icon */}
              <div className="flex-shrink-0 mt-0.5">
                {isPast || seg.done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                ) : isCurrent ? (
                  <div className="w-3 h-3 rounded-full bg-violet animate-pulse" />
                ) : seg.type === "break" ? (
                  <div className="w-3 h-3 rounded-full border border-faint" />
                ) : (
                  <div className="w-3 h-3 rounded-full border border-muted" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={`text-[12px] font-medium leading-tight truncate ${
                  isPast ? "text-faint line-through" : isCurrent ? "text-txt" : seg.type === "break" ? "text-faint" : "text-muted"
                }`}>
                  {seg.label}
                </p>
                <p className="text-[10.5px] text-faint">
                  {to12h(seg.start)} – {to12h(seg.end)}
                </p>
              </div>

              {/* Remaining for current */}
              {isCurrent && (
                <span className="text-[11px] text-violet font-medium flex-shrink-0 tabular-nums">
                  {fmt(remaining)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
