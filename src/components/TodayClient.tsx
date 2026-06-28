"use client";

import { useState, useEffect } from "react";
import Timeline from "@/components/schedule/Timeline";
import PomodoroTimer from "@/components/focus/PomodoroTimer";
import HabitList from "@/components/habits/HabitList";
import WeeklyBars from "@/components/progress/WeeklyBars";
import WeekView from "@/components/week/WeekView";
import MonthView from "@/components/month/MonthView";
import DebriefModal from "@/components/debrief/DebriefModal";
import type { ScheduleBlock, Habit, HabitLog, FocusSession, DailyInsight } from "@/lib/types";
import { toDateStr } from "@/lib/time";

interface Props {
  initialBlocks: ScheduleBlock[];
  habits: Habit[];
  initialTodayLogs: HabitLog[];
  allLogs: HabitLog[];
  focusSessions: FocusSession[];
  isGuest: boolean;
  userId: string | null;
  period: string;
  todayInsight: DailyInsight | null;
  hasDebrief: boolean;
}

function computeBars(
  habits: Habit[],
  allLogs: HabitLog[],
  focusSessions: FocusSession[]
): { label: string; pct: number }[] {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = toDateStr(weekStart);

  const weekLogs = allLogs.filter((l) => l.day >= weekStartStr && l.completed);
  const dayOfWeek = new Date().getDay();
  const daysElapsed = Math.max(1, dayOfWeek + 1);
  const habitsPct =
    habits.length > 0
      ? Math.min(100, Math.round((weekLogs.length / (habits.length * daysElapsed)) * 100))
      : 0;

  const weekSessions = focusSessions.filter(
    (s) => s.started_at >= weekStart.toISOString()
  );
  const totalPlanned = weekSessions.reduce((s, x) => s + x.planned_seconds, 0);
  const totalActual  = weekSessions.reduce((s, x) => s + x.actual_seconds, 0);
  const focusPct     =
    totalPlanned > 0
      ? Math.min(100, Math.round((totalActual / totalPlanned) * 100))
      : 0;

  const completedSessions = weekSessions.filter((s) => s.completed).length;
  const deepWorkPct =
    weekSessions.length > 0
      ? Math.round((completedSessions / weekSessions.length) * 100)
      : 0;

  const uniqueDays = new Set(weekLogs.map((l) => l.day)).size;
  const consistencyPct = Math.min(100, Math.round((uniqueDays / 7) * 100));

  return [
    { label: "Habits",      pct: habitsPct },
    { label: "Deep work",   pct: deepWorkPct },
    { label: "Focus time",  pct: focusPct },
    { label: "Consistency", pct: consistencyPct },
  ];
}

function shouldShowDebrief(blocks: ScheduleBlock[]): boolean {
  if (blocks.length === 0) return false;
  const allDone = blocks.every((b) => b.done);
  if (allDone) return true;
  const hour = new Date().getHours();
  const hasUncompleted = blocks.some((b) => !b.done);
  return hour >= 17 && !hasUncompleted;
}

export default function TodayClient({
  initialBlocks,
  habits,
  initialTodayLogs,
  allLogs,
  focusSessions,
  isGuest,
  userId,
  period,
  todayInsight,
  hasDebrief,
}: Props) {
  const [blocks, setBlocks]           = useState<ScheduleBlock[]>(initialBlocks);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(
    initialBlocks[0]?.id ?? null
  );
  const [showDebrief, setShowDebrief] = useState(false);

  const activeBlock =
    blocks.find((b) => b.id === activeBlockId) ??
    blocks[0] ??
    null;

  const bars = computeBars(habits, allLogs, focusSessions);
  const todayStr = toDateStr(new Date());

  // Check debrief trigger once on mount, and once per minute after 5pm
  useEffect(() => {
    if (isGuest || hasDebrief || !userId) return;
    const check = () => {
      if (shouldShowDebrief(blocks)) setShowDebrief(true);
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [blocks, isGuest, hasDebrief, userId]);

  if (period === "week") {
    return (
      <WeekView
        habits={habits}
        allLogs={allLogs}
        focusSessions={focusSessions}
        isGuest={isGuest}
      />
    );
  }

  if (period === "month") {
    return (
      <MonthView
        habits={habits}
        allLogs={allLogs}
        focusSessions={focusSessions}
      />
    );
  }

  return (
    <>
      {showDebrief && userId && (
        <DebriefModal
          todayBlocks={blocks}
          todayStr={todayStr}
          userId={userId}
          onDismiss={() => setShowDebrief(false)}
        />
      )}

      <div className="flex flex-col gap-[22px]">
        {todayInsight && (
          <div className="bg-panel border border-violet/20 rounded-[16px] px-5 py-4 flex items-start gap-3">
            <span className="text-violet text-[18px] flex-shrink-0">✦</span>
            <div>
              <p className="text-[12px] text-violet/70 font-medium uppercase tracking-wide mb-1">
                Today&apos;s insight
              </p>
              <p className="text-[14px] text-txt leading-relaxed">{todayInsight.insight}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[1.15fr_0.95fr] gap-[22px] items-start">
          <Timeline
            initialBlocks={initialBlocks}
            activeBlockId={activeBlockId}
            onFocus={setActiveBlockId}
            onBlocksChange={setBlocks}
            isGuest={isGuest}
            userId={userId}
          />

          <div className="flex flex-col gap-[22px]">
            <div className="grid grid-cols-2 gap-[22px] items-start">
              <PomodoroTimer
                activeBlock={activeBlock}
                todayBlocks={blocks}
                isGuest={isGuest}
                userId={userId}
              />
              <WeeklyBars bars={bars} />
            </div>
            <HabitList
              habits={habits}
              initialTodayLogs={initialTodayLogs}
              allLogs={allLogs}
              isGuest={isGuest}
              userId={userId}
            />
          </div>
        </div>
      </div>
    </>
  );
}
