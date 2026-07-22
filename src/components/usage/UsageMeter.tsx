"use client";

import { useEffect, useState } from "react";

type MeterResponse = {
  plans: string[];
  budget_microdollars: number;
  used_microdollars: number;
  percent_used: number;
  resets_at: string;
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Compact AI-credits meter shown near the AI features. Displays percent of
// the monthly budget used — never raw dollars or tokens.
export default function UsageMeter() {
  const [meter, setMeter] = useState<MeterResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setMeter(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!meter) return null;

  if (meter.budget_microdollars <= 0) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-faint px-1 pt-2">
        <span>AI features are part of Cadence Pro.</span>
      </div>
    );
  }

  const pct = meter.percent_used;
  const atLimit = pct >= 100;

  return (
    <div className="px-1 pt-2">
      <div className="flex items-center justify-between text-[12px] text-faint mb-1">
        <span className={atLimit ? "text-txt" : undefined}>
          AI credits · {pct}% used — resets {shortDate(meter.resets_at)}
        </span>
        <button
          type="button"
          className="text-violet hover:underline underline-offset-2"
          title="Top-ups coming soon: $3 → $1.50 of credits, $5 → $3.00 of credits"
        >
          Get more credits
        </button>
      </div>
      <div className="h-1 rounded-full bg-ink overflow-hidden">
        <div
          className={`h-full rounded-full ${atLimit ? "bg-red-400" : "bg-violet"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      {atLimit && (
        <p className="text-[12px] text-muted mt-1">
          You&apos;ve used all your AI credits for this period — they reset on{" "}
          {shortDate(meter.resets_at)}.
        </p>
      )}
    </div>
  );
}
