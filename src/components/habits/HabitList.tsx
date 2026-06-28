"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Habit, HabitLog } from "@/lib/types";

interface Props {
  habits: Habit[];
  initialTodayLogs: HabitLog[];
  allLogs: HabitLog[];
  isGuest: boolean;
  userId: string | null;
}

function computeStreak(habitId: string, allLogs: HabitLog[], todayLogs: HabitLog[]): number {
  const isCheckedToday = todayLogs.some((l) => l.habit_id === habitId && l.completed);
  const loggedDays = new Set(
    allLogs.filter((l) => l.habit_id === habitId && l.completed).map((l) => l.day)
  );

  let streak = isCheckedToday ? 1 : 0;
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - 1); // start from yesterday

  for (let i = 0; i < 365; i++) {
    const dayStr = cursor.toISOString().split("T")[0];
    if (loggedDays.has(dayStr)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

export default function HabitList({ habits, initialTodayLogs, allLogs, isGuest, userId }: Props) {
  const [todayLogs, setTodayLogs] = useState<HabitLog[]>(initialTodayLogs);
  const supabase   = createClient();
  const todayStr   = new Date().toISOString().split("T")[0];

  const completedCount = todayLogs.filter((l) => l.completed).length;
  const donePct =
    habits.length > 0 ? Math.round((completedCount / habits.length) * 100) : 0;

  async function toggleHabit(habit: Habit) {
    const existing = todayLogs.find((l) => l.habit_id === habit.id && l.day === todayStr);

    if (existing) {
      // Uncheck — remove optimistically
      setTodayLogs((prev) => prev.filter((l) => l.id !== existing.id));
      if (!isGuest) {
        const { error } = await supabase
          .from("habit_logs")
          .delete()
          .eq("id", existing.id);
        if (error) {
          // Roll back
          setTodayLogs((prev) => [...prev, existing]);
        }
      }
    } else {
      // Check — add optimistically
      const optimistic: HabitLog = {
        id:        crypto.randomUUID(),
        user_id:   "guest",
        habit_id:  habit.id,
        day:       todayStr,
        completed: true,
      };
      setTodayLogs((prev) => [...prev, optimistic]);

      if (!isGuest) {
        const { data, error } = await supabase
          .from("habit_logs")
          .upsert(
            { user_id: userId!, habit_id: habit.id, day: todayStr, completed: true },
            { onConflict: "habit_id,day" }
          )
          .select()
          .single();

        if (!error && data) {
          setTodayLogs((prev) =>
            prev.map((l) => (l.id === optimistic.id ? (data as HabitLog) : l))
          );
        } else {
          // Roll back
          setTodayLogs((prev) => prev.filter((l) => l.id !== optimistic.id));
        }
      }
    }
  }

  return (
    <section className="bg-panel border border-line rounded-[18px] p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-grotesk font-semibold text-[15px] tracking-wide text-txt">
            Habits
          </h2>
          <p className="text-muted text-[12.5px] mt-0.5">Today · keep the streak alive</p>
        </div>
        <span className="font-grotesk font-semibold text-[22px] text-cadence-green tabular-nums">
          {donePct}%
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {habits.map((habit) => {
          const isChecked = todayLogs.some(
            (l) => l.habit_id === habit.id && l.completed
          );
          const streak = computeStreak(habit.id, allLogs, todayLogs);

          return (
            <button
              key={habit.id}
              onClick={() => toggleHabit(habit)}
              className="flex items-center gap-3 py-1 px-0.5 w-full text-left"
            >
              <div
                className={[
                  "w-[22px] h-[22px] rounded-[7px] border flex-shrink-0 grid place-items-center transition-colors",
                  isChecked
                    ? "bg-cadence-green border-cadence-green"
                    : "border-line",
                ].join(" ")}
              >
                {isChecked && (
                  <svg
                    width="13" height="13" viewBox="0 0 24 24"
                    fill="none" stroke="#0e0e14" strokeWidth="3.5"
                  >
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                )}
              </div>

              <span
                className={`flex-1 text-[14px] ${
                  isChecked ? "text-muted" : "text-txt"
                }`}
              >
                {habit.name}
              </span>

              <span className="text-[11.5px] text-faint tabular-nums">
                {streak > 0 ? `${streak}🔥` : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
