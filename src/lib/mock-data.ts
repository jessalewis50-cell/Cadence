import type { ScheduleBlock, Habit, HabitLog, FocusSession, BlockTemplate } from "./types";

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateStr(d);
}

function daysAgoMs(n: number) {
  return Date.now() - n * 86_400_000;
}

export function getMockData() {
  const today = toDateStr(new Date());

  const blocks: ScheduleBlock[] = [
    { id: "b1", user_id: "guest", day: today, start_time: "09:00", end_time: "09:25", title: "Deep work — Build Better",       category: "deep",  activity: "deep work", position: 0, done: false, created_at: new Date().toISOString() },
    { id: "b2", user_id: "guest", day: today, start_time: "09:25", end_time: "09:30", title: "Short break",                    category: "break", position: 1, done: false, created_at: new Date().toISOString() },
    { id: "b3", user_id: "guest", day: today, start_time: "09:30", end_time: "10:15", title: "Cadence — auth + layout",        category: "deep",  activity: "deep work", position: 2, done: false, created_at: new Date().toISOString() },
    { id: "b4", user_id: "guest", day: today, start_time: "10:30", end_time: "11:00", title: "Strength + stretch",             category: "body",  activity: "exercise",  position: 3, done: false, created_at: new Date().toISOString() },
    { id: "b5", user_id: "guest", day: today, start_time: "11:15", end_time: "12:00", title: "Zoning-agent research",          category: "deep",  activity: "deep work", position: 4, done: false, created_at: new Date().toISOString() },
    { id: "b6", user_id: "guest", day: today, start_time: "13:00", end_time: "13:30", title: "Inbox + portfolio updates",      category: "admin", activity: "admin",     position: 5, done: false, created_at: new Date().toISOString() },
  ];

  const habits: Habit[] = [
    { id: "h1", user_id: "guest", name: "Exercise",   position: 0, archived: false, created_at: new Date().toISOString() },
    { id: "h2", user_id: "guest", name: "Deep work",  position: 1, archived: false, created_at: new Date().toISOString() },
    { id: "h3", user_id: "guest", name: "Reading",    position: 2, archived: false, created_at: new Date().toISOString() },
    { id: "h4", user_id: "guest", name: "Planning",   position: 3, archived: false, created_at: new Date().toISOString() },
    { id: "h5", user_id: "guest", name: "Admin",      position: 4, archived: false, created_at: new Date().toISOString() },
  ];

  // Seed past logs to produce realistic streaks: h1→6, h2→11, h3→3, h4→2, h5→8
  const streaks: Record<string, number> = { h1: 6, h2: 11, h3: 3, h4: 2, h5: 8 };
  const habitLogs: HabitLog[] = habits.flatMap((h) =>
    Array.from({ length: streaks[h.id] }, (_, i) => ({
      id: `${h.id}-log-${i}`,
      user_id: "guest",
      habit_id: h.id,
      day: daysAgo(i + 1), // past days only; today's log is added when user checks off
      completed: true,
    }))
  );

  // Past week focus sessions (for weekly progress bars)
  const focusSessions: FocusSession[] = [
    { id: "fs1", user_id: "guest", block_id: "b1", mode: "focus", planned_seconds: 1500, actual_seconds: 1500, completed: true,  started_at: new Date(daysAgoMs(1)).toISOString(), ended_at: new Date(daysAgoMs(1) + 1500_000).toISOString() },
    { id: "fs2", user_id: "guest", block_id: "b3", mode: "focus", planned_seconds: 1500, actual_seconds: 1500, completed: true,  started_at: new Date(daysAgoMs(2)).toISOString(), ended_at: new Date(daysAgoMs(2) + 1500_000).toISOString() },
    { id: "fs3", user_id: "guest", block_id: null, mode: "focus", planned_seconds: 1500, actual_seconds: 1200, completed: false, started_at: new Date(daysAgoMs(3)).toISOString(), ended_at: new Date(daysAgoMs(3) + 1200_000).toISOString() },
    { id: "fs4", user_id: "guest", block_id: null, mode: "focus", planned_seconds: 1500, actual_seconds: 1500, completed: true,  started_at: new Date(daysAgoMs(4)).toISOString(), ended_at: new Date(daysAgoMs(4) + 1500_000).toISOString() },
    { id: "fs5", user_id: "guest", block_id: null, mode: "focus", planned_seconds: 1500, actual_seconds: 1500, completed: true,  started_at: new Date(daysAgoMs(5)).toISOString(), ended_at: new Date(daysAgoMs(5) + 1500_000).toISOString() },
  ];

  const templates: BlockTemplate[] = [
    { id: "t1", user_id: "guest", title: "Morning deep work",   category: "deep",  duration_minutes: 90,  slots: [{ id: "t1-s1", start_time: "09:00", duration_minutes: 90 }], recurrence_days: [1,2,3,4,5],   position: 0, detail: null, created_at: new Date().toISOString() },
    { id: "t2", user_id: "guest", title: "Movement & stretch",  category: "body",  duration_minutes: 30,  slots: [{ id: "t2-s1", start_time: "07:30", duration_minutes: 30 }], recurrence_days: [1,2,3,4,5,6,0], position: 1, detail: null, created_at: new Date().toISOString() },
    { id: "t3", user_id: "guest", title: "Email & admin",       category: "admin", duration_minutes: 30,  slots: [{ id: "t3-s1", start_time: "11:00", duration_minutes: 30 }], recurrence_days: [1,3,5],         position: 2, detail: null, created_at: new Date().toISOString() },
    { id: "t4", user_id: "guest", title: "Lunch break",         category: "break", duration_minutes: 60,  slots: [{ id: "t4-s1", start_time: "12:30", duration_minutes: 60 }], recurrence_days: [1,2,3,4,5],    position: 3, detail: null, created_at: new Date().toISOString() },
    { id: "t5", user_id: "guest", title: "Afternoon focus",     category: "deep",  duration_minutes: 90,  slots: [{ id: "t5-s1", start_time: "14:00", duration_minutes: 90 }], recurrence_days: [1,2,4],         position: 4, detail: null, created_at: new Date().toISOString() },
  ];

  return { blocks, habits, habitLogs, focusSessions, templates };
}
