"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { ScheduleBlock } from "@/lib/types";

type Mood = "great" | "okay" | "rough";

interface Props {
  todayBlocks: ScheduleBlock[];
  todayStr: string;
  userId: string;
  onDismiss: () => void;
}

const MOOD_OPTIONS: { value: Mood; label: string; emoji: string }[] = [
  { value: "great", label: "Great",  emoji: "🙌" },
  { value: "okay",  label: "Okay",   emoji: "👍" },
  { value: "rough", label: "Rough",  emoji: "😓" },
];

export default function DebriefModal({ todayBlocks, todayStr, userId, onDismiss }: Props) {
  const [mood, setMood]   = useState<Mood | null>(null);
  const [note, setNote]   = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone]   = useState(false);
  const supabase = createClient();

  const completed = todayBlocks.filter((b) => b.done).length;
  const planned   = todayBlocks.length;
  const rate      = planned > 0 ? Math.round((completed / planned) * 1000) / 1000 : null;

  async function submit() {
    if (!mood) return;
    setSaving(true);
    await supabase.from("daily_debriefs").upsert({
      user_id:         userId,
      day:             todayStr,
      mood,
      note:            note.trim() || null,
      planned_blocks:  planned,
      completed_blocks: completed,
      completion_rate: rate,
    }, { onConflict: "user_id,day" });
    setSaving(false);
    setDone(true);
    setTimeout(onDismiss, 1200);
  }

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center p-4 pointer-events-none">
        <div className="bg-panel border border-line rounded-[20px] p-6 w-full max-w-sm pointer-events-auto text-center">
          <p className="text-[15px] font-semibold text-txt">Logged ✓</p>
          <p className="text-[13px] text-muted mt-1">See you tomorrow.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/40">
      <div className="bg-panel border border-line rounded-[20px] p-6 w-full max-w-sm flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-grotesk font-semibold text-[16px] text-txt">End of day</h2>
            <p className="text-muted text-[13px] mt-0.5">
              {completed} of {planned} blocks done
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="text-faint hover:text-txt transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div>
          <p className="text-[12.5px] text-muted mb-2">How did today feel?</p>
          <div className="flex gap-2">
            {MOOD_OPTIONS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMood(m.value)}
                className={`flex-1 py-2.5 rounded-[12px] border text-[13px] font-medium transition-colors flex flex-col items-center gap-1 ${
                  mood === m.value
                    ? "border-violet bg-violet/10 text-violet"
                    : "border-line text-muted hover:border-violet/50 hover:text-txt"
                }`}
              >
                <span className="text-[18px]">{m.emoji}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <textarea
          placeholder="Anything to note? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={280}
          className="w-full bg-ink border border-line rounded-[12px] px-3 py-2 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors resize-none"
        />

        <div className="flex gap-2">
          <button
            onClick={onDismiss}
            className="flex-1 py-2 text-[13px] text-muted border border-line rounded-[12px] hover:border-violet transition-colors"
          >
            Skip
          </button>
          <button
            onClick={submit}
            disabled={!mood || saving}
            className="flex-1 py-2 text-[13px] font-semibold text-white bg-violet rounded-[12px] hover:bg-[#6a59f5] transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Log it"}
          </button>
        </div>
      </div>
    </div>
  );
}
