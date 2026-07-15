"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Habit, HabitLog } from "@/lib/types";

interface Props {
  initialHabits: Habit[];
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
  cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    const dayStr = cursor.toISOString().split("T")[0];
    if (loggedDays.has(dayStr)) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  return streak;
}

// Build last-N-days date strings for mini heatmap
function lastNDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days;
}

const HEATMAP_DAYS = lastNDays(14);

export default function HabitsView({ initialHabits, initialTodayLogs, allLogs, isGuest, userId }: Props) {
  const [habits, setHabits]     = useState<Habit[]>(initialHabits);
  const [todayLogs, setTodayLogs] = useState<HabitLog[]>(initialTodayLogs);
  const [newName, setNewName]   = useState("");
  const [newActivity, setNewActivity] = useState("");
  const [adding, setAdding]     = useState(false);
  const [saving, setSaving]     = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const supabase = createClient();
  const todayStr = new Date().toISOString().split("T")[0];

  const completedCount = todayLogs.filter((l) => l.completed).length;
  const donePct = habits.length > 0 ? Math.round((completedCount / habits.length) * 100) : 0;

  async function toggleHabit(habit: Habit) {
    const existing = todayLogs.find((l) => l.habit_id === habit.id && l.day === todayStr);
    if (existing) {
      setTodayLogs((prev) => prev.filter((l) => l.id !== existing.id));
      if (!isGuest) {
        const { error } = await supabase.from("habit_logs").delete().eq("id", existing.id);
        if (error) setTodayLogs((prev) => [...prev, existing]);
      }
    } else {
      const optimistic: HabitLog = {
        id: crypto.randomUUID(), user_id: "guest",
        habit_id: habit.id, day: todayStr, completed: true,
      };
      setTodayLogs((prev) => [...prev, optimistic]);
      if (!isGuest) {
        const { data, error } = await supabase
          .from("habit_logs")
          .upsert({ user_id: userId!, habit_id: habit.id, day: todayStr, completed: true }, { onConflict: "habit_id,day" })
          .select().single();
        if (!error && data) {
          setTodayLogs((prev) => prev.map((l) => (l.id === optimistic.id ? (data as HabitLog) : l)));
        } else {
          setTodayLogs((prev) => prev.filter((l) => l.id !== optimistic.id));
        }
      }
    }
  }

  async function addHabit(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    const maxPos = habits.reduce((m, h) => Math.max(m, h.position), -1);

    const activity = newActivity.trim() || null;

    if (!isGuest) {
      const { data, error } = await supabase
        .from("habits")
        .insert({
          user_id: userId!,
          name: newName.trim(),
          position: maxPos + 1,
          archived: false,
          ...(activity ? { activity } : {}),
        })
        .select().single();
      setSaving(false);
      if (!error && data) {
        setHabits((prev) => [...prev, data as Habit]);
        setNewName("");
        setNewActivity("");
        setAdding(false);
        return;
      }
    }
    // Guest path
    const local: Habit = {
      id: crypto.randomUUID(), user_id: "guest",
      name: newName.trim(), activity, position: maxPos + 1,
      archived: false, created_at: new Date().toISOString(),
    };
    setHabits((prev) => [...prev, local]);
    setNewName("");
    setNewActivity("");
    setAdding(false);
    setSaving(false);
  }

  async function saveActivity(habit: Habit) {
    const value = editValue.trim() || null;
    setEditingId(null);
    setHabits((prev) => prev.map((h) => (h.id === habit.id ? { ...h, activity: value } : h)));
    if (!isGuest) {
      await supabase.from("habits").update({ activity: value }).eq("id", habit.id);
    }
  }

  async function archiveHabit(id: string) {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    if (!isGuest) {
      await supabase.from("habits").update({ archived: true }).eq("id", id);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-panel border border-line rounded-[16px] p-4">
          <p className="text-[11.5px] text-muted uppercase tracking-wider mb-1">Today</p>
          <p className="font-grotesk font-semibold text-[28px] text-cadence-green">{donePct}%</p>
          <p className="text-[11px] text-faint">{completedCount} of {habits.length} done</p>
        </div>
        <div className="bg-panel border border-line rounded-[16px] p-4">
          <p className="text-[11.5px] text-muted uppercase tracking-wider mb-1">Active habits</p>
          <p className="font-grotesk font-semibold text-[28px] text-txt">{habits.length}</p>
          <p className="text-[11px] text-faint">tracked daily</p>
        </div>
        <div className="bg-panel border border-line rounded-[16px] p-4">
          <p className="text-[11.5px] text-muted uppercase tracking-wider mb-1">Best streak</p>
          <p className="font-grotesk font-semibold text-[28px] text-txt">
            {habits.length > 0
              ? Math.max(...habits.map((h) => computeStreak(h.id, allLogs, todayLogs))) + "d"
              : "—"}
          </p>
          <p className="text-[11px] text-faint">consecutive days</p>
        </div>
      </div>

      {/* Habit list */}
      <div className="bg-panel border border-line rounded-[18px] p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-grotesk font-semibold text-[15px] text-txt">Daily habits</h2>
            <p className="text-muted text-[12.5px] mt-0.5">Check off today&apos;s completions · streaks keep you accountable</p>
          </div>
          <button
            onClick={() => setAdding(true)}
            className="px-3 py-1.5 text-sm text-white bg-violet rounded-lg hover:bg-[#6a59f5] transition-colors"
          >
            + Add
          </button>
        </div>

        {adding && (
          <form onSubmit={addHabit} className="flex gap-2 mb-4 flex-wrap">
            <input
              type="text"
              autoFocus
              required
              placeholder="Habit name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 min-w-[140px] bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors"
            />
            <input
              type="text"
              placeholder="Activity to match (optional)…"
              value={newActivity}
              onChange={(e) => setNewActivity(e.target.value)}
              className="flex-1 min-w-[140px] bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors"
            />
            <button
              type="button"
              onClick={() => { setAdding(false); setNewName(""); }}
              className="px-3 py-1.5 text-sm text-muted border border-line rounded-lg hover:border-violet transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-sm text-white bg-violet rounded-lg hover:bg-[#6a59f5] transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </form>
        )}

        {habits.length === 0 && (
          <p className="text-center text-faint text-[13px] py-6">
            No habits yet — add your first one above.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {habits.map((habit) => {
            const isChecked = todayLogs.some((l) => l.habit_id === habit.id && l.completed);
            const streak    = computeStreak(habit.id, allLogs, todayLogs);
            const logSet    = new Set(
              allLogs.filter((l) => l.habit_id === habit.id && l.completed).map((l) => l.day)
            );
            if (todayLogs.some((l) => l.habit_id === habit.id && l.completed)) logSet.add(todayStr);

            return (
              <div key={habit.id} className="flex flex-col gap-2 pb-4 border-b border-line last:border-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleHabit(habit)}
                    className={[
                      "w-[22px] h-[22px] rounded-[7px] border flex-shrink-0 grid place-items-center transition-colors",
                      isChecked ? "bg-cadence-green border-cadence-green" : "border-line hover:border-cadence-green",
                    ].join(" ")}
                  >
                    {isChecked && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0e0e14" strokeWidth="3.5">
                        <path d="M20 6 9 17l-5-5"/>
                      </svg>
                    )}
                  </button>

                  <span className={`flex-1 text-[14px] ${isChecked ? "text-muted line-through" : "text-txt"}`}>
                    {habit.name}
                  </span>

                  <span className="text-[13px] tabular-nums text-faint">
                    {streak > 0 ? `${streak} 🔥` : "—"}
                  </span>

                  <button
                    onClick={() => archiveHabit(habit.id)}
                    title="Archive habit"
                    className="w-6 h-6 rounded-md grid place-items-center text-faint hover:text-magenta transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>

                {/* Activity this habit is matched by on the schedule */}
                <div className="ml-8 flex items-center gap-2">
                  <span className="text-[11px] text-faint">Matches activity:</span>
                  {editingId === habit.id ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveActivity(habit)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); saveActivity(habit); }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      placeholder="e.g. reading"
                      className="w-40 bg-ink border border-line rounded px-2 py-0.5 text-[11.5px] text-txt outline-none focus:border-violet transition-colors"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingId(habit.id); setEditValue(habit.activity ?? ""); }}
                      title="Set the schedule activity this habit is completed by"
                      className="text-[11.5px] text-violet/90 hover:text-violet transition-colors"
                    >
                      {habit.activity ? habit.activity : `${habit.name} (from name)`}
                    </button>
                  )}
                </div>

                {/* 14-day mini heatmap */}
                <div className="flex gap-1 ml-8">
                  {HEATMAP_DAYS.map((d) => {
                    const done    = logSet.has(d);
                    const isFuture = d > todayStr;
                    return (
                      <div
                        key={d}
                        title={d}
                        className={[
                          "w-4 h-4 rounded-[4px] transition-colors",
                          isFuture    ? "bg-ink/30" :
                          done        ? "bg-cadence-green" :
                                        "bg-ink",
                        ].join(" ")}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Habit formation tips */}
      <div className="bg-panel border border-line rounded-[18px] p-5">
        <h2 className="font-grotesk font-semibold text-[15px] text-txt mb-4">Building lasting habits</h2>
        <div className="grid grid-cols-2 gap-4">
          {[
            {
              title: "Make it obvious",
              body: "Place habit cues in plain sight. Pair a new habit with an existing one — \"After I pour my morning coffee, I will meditate for two minutes.\"",
            },
            {
              title: "Make it attractive",
              body: "Bundle habits you need to do with things you want to do. The anticipation of a reward is often enough to keep you going.",
            },
            {
              title: "Make it easy",
              body: "Reduce friction. Start with 2-minute versions of your habits. The goal is to show up consistently, not to be perfect.",
            },
            {
              title: "Make it satisfying",
              body: "Track your streaks. Don't break the chain — but if you miss a day, never miss twice. Progress is the best motivator.",
            },
          ].map(({ title, body }) => (
            <div key={title} className="bg-ink/50 rounded-[14px] p-4">
              <p className="font-grotesk font-semibold text-[13px] text-violet mb-1.5">{title}</p>
              <p className="text-[12.5px] text-muted leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-faint mt-3">Based on <em>Atomic Habits</em> by James Clear</p>
      </div>
    </div>
  );
}
