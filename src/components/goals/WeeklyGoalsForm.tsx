"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WeeklyGoal } from "@/lib/types";

interface GoalDraft {
  title: string;
  detail: string;
}

interface Props {
  existingGoals: WeeklyGoal[];
  weekStart: string;
}

export default function WeeklyGoalsForm({ existingGoals, weekStart }: Props) {
  const router = useRouter();
  const [goals, setGoals] = useState<GoalDraft[]>(
    existingGoals.length > 0
      ? existingGoals.map((g) => ({ title: g.title, detail: g.detail ?? "" }))
      : [{ title: "", detail: "" }]
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  function addGoal() {
    setGoals((prev) => [...prev, { title: "", detail: "" }]);
  }

  function removeGoal(i: number) {
    setGoals((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateGoal(i: number, patch: Partial<GoalDraft>) {
    setGoals((prev) => prev.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  }

  async function generate() {
    const filled = goals.filter((g) => g.title.trim());
    if (filled.length === 0) {
      setError("Add at least one goal before generating.");
      return;
    }
    setGenerating(true);
    setError(null);

    const payload = filled.map((g, i) => ({
      title:            g.title.trim(),
      detail:           g.detail.trim() || null,
      category:         "deep",
      time_preference:  "any",
      desired_sessions: 3,
      priority:         i === 0 ? 1 : 2,
    }));

    const res = await fetch("/api/ai/schedule", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ goals: payload, weekStart }),
    });

    setGenerating(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        body.code === "upgrade_required"
          ? "AI scheduling is part of Cadence Pro. Your account is on the free plan — upgrading unlocks it. (Pricing coming soon.)"
          : body.error ?? "Something went wrong. Try again."
      );
      return;
    }

    router.push("/today");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {goals.map((goal, i) => (
        <div key={i} className="bg-panel border border-line rounded-[16px] p-4 flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <span className="text-faint text-[13px] mt-2.5 w-4 shrink-0 text-center select-none">
              {i + 1}
            </span>
            <div className="flex flex-col gap-2 flex-1">
              <input
                type="text"
                placeholder="What do you want to accomplish?"
                value={goal.title}
                onChange={(e) => updateGoal(i, { title: e.target.value })}
                className="w-full bg-ink border border-line rounded-lg px-3 py-2 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors"
              />
              <textarea
                placeholder="Specific details (optional)"
                value={goal.detail}
                rows={2}
                onChange={(e) => updateGoal(i, { detail: e.target.value })}
                className="w-full bg-ink border border-line rounded-lg px-3 py-2 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors resize-none"
              />
            </div>
            {goals.length > 1 && (
              <button
                type="button"
                onClick={() => removeGoal(i)}
                className="mt-2 text-faint hover:text-magenta transition-colors"
                aria-label="Remove goal"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      ))}

      {error && (
        <p className="text-[13px] text-magenta text-center">{error}</p>
      )}

      <button
        type="button"
        onClick={generate}
        disabled={generating}
        className="py-3 text-[14px] font-semibold text-white bg-violet rounded-[14px] hover:bg-[#6a59f5] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {generating ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            Building your week…
          </span>
        ) : (
          "Generate my week"
        )}
      </button>
    </div>
  );
}
