export type Category = "deep" | "body" | "break" | "admin";
export type TimerMode = "focus" | "short" | "long";

export interface ScheduleBlock {
  id: string;
  user_id: string;
  day: string;        // "YYYY-MM-DD"
  start_time: string; // "HH:MM"
  end_time: string;
  title: string;
  category: Category;
  activity?: string | null; // free-form label, e.g. "reading", "exercise"
  position: number;
  done: boolean;
  source?: "manual" | "ai" | "template";
  template_id?: string | null; // block_templates.id this copy was stamped from
  detail?: string | null;
  created_at: string;
}

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  activity?: string | null; // matches schedule blocks by activity; falls back to name
  position: number;
  archived: boolean;
  created_at: string;
}

export interface HabitLog {
  id: string;
  user_id: string;
  habit_id: string;
  day: string;
  completed: boolean;
}

export interface BlockTemplate {
  id: string;
  user_id: string;
  title: string;
  category: Category;
  activity?: string | null; // free-form label, e.g. "reading", "exercise"
  duration_minutes: number;
  default_start_time: string | null; // "HH:MM"
  recurrence_days: number[];          // 0=Sun 1=Mon … 6=Sat
  detail: string | null;
  position: number;
  created_at: string;
}

export interface FocusSession {
  id: string;
  user_id: string;
  block_id: string | null;
  mode: TimerMode;
  planned_seconds: number;
  actual_seconds: number;
  completed: boolean;
  started_at: string;
  ended_at: string | null;
}

export interface WeeklyGoal {
  id: string;
  user_id: string;
  week_start: string;    // "YYYY-MM-DD" (Monday)
  title: string;
  category: Category;
  detail: string | null;
  desired_sessions: number;
  time_preference: "morning" | "afternoon" | "evening" | "any" | null;
  priority: number;      // 1=high 2=medium 3=low
  position: number;
  created_at: string;
}

export interface DailyDebrief {
  id: string;
  user_id: string;
  day: string;
  mood: "great" | "okay" | "rough";
  note: string | null;
  planned_blocks: number;
  completed_blocks: number;
  completion_rate: number | null;
  created_at: string;
}

export interface DailyInsight {
  id: string;
  user_id: string;
  generated_at: string;
  insight: string;
  confidence: "low" | "medium" | "high" | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ScheduleCorrection {
  id: string;
  user_id: string;
  block_id: string | null;
  correction_type: "reschedule" | "delete" | "resize" | "retitle";
  original_start_time: string | null;
  new_start_time: string | null;
  original_duration_minutes: number | null;
  new_duration_minutes: number | null;
  created_at: string;
}
