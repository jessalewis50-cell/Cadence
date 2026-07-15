"use client";

import { useEffect, useState } from "react";
import type { ScheduleBlock } from "@/lib/types";
import { toDateStr, timeToMinutes } from "@/lib/time";
import { activityColor } from "@/lib/activity-colors";

interface Props {
  blocks: ScheduleBlock[];
}

interface ActivityRow {
  key: string;
  label: string;
  done: number;   // minutes already elapsed
  ahead: number;  // minutes still scheduled later today
  total: number;  // done + ahead
  color: string;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// e.g. 150 → "2.5h", 180 → "3h", 30 → "0.5h"
function formatHours(mins: number): string {
  const rounded = Math.round((mins / 60) * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

export default function TodayActivity({ blocks }: Props) {
  // `now` is null on the server and the first client render so hydration agrees
  // (everything reads as "still ahead"); the interval fills it in after mount
  // and re-renders roughly once a minute as the day progresses.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayStr = toDateStr(new Date());
  const todays = blocks.filter((b) => b.day === todayStr);

  // Before mount, treat "now" as earlier than any block so nothing reads as done.
  const nowMinutes = now ? now.getHours() * 60 + now.getMinutes() : -1;

  // Group today's blocks by activity, splitting each into done vs. still-ahead.
  const groups = new Map<string, ActivityRow>();
  for (const b of todays) {
    const key = b.activity?.trim().toLowerCase() || "other";
    const start = timeToMinutes(b.start_time);
    const end = timeToMinutes(b.end_time);
    const dur = Math.max(0, end - start);

    let done: number;
    let ahead: number;
    if (nowMinutes >= end) {
      done = dur;
      ahead = 0;
    } else if (nowMinutes <= start) {
      done = 0;
      ahead = dur;
    } else {
      done = nowMinutes - start;
      ahead = end - nowMinutes;
    }

    const row =
      groups.get(key) ??
      {
        key,
        label: key === "other" ? "Other" : titleCase(key),
        done: 0,
        ahead: 0,
        total: 0,
        color: activityColor(key),
      };
    row.done += done;
    row.ahead += ahead;
    row.total += dur;
    groups.set(key, row);
  }

  const rows = [...groups.values()].sort((a, b) => b.total - a.total);
  const maxTotal = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const totalDone = rows.reduce((s, r) => s + r.done, 0);
  const totalAhead = rows.reduce((s, r) => s + r.ahead, 0);

  return (
    <section className="bg-panel border border-line rounded-[18px] p-5">
      <h2 className="font-grotesk font-semibold text-[15px] tracking-wide text-txt mb-4">
        Today
      </h2>

      {rows.length === 0 ? (
        <p className="text-muted text-[13px] py-1">Nothing planned yet today.</p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-3">
                <span className="w-[88px] shrink-0 text-[13px] text-txt truncate">
                  {r.label}
                </span>
                <div className="flex-1 h-2.5 rounded-full bg-ink overflow-hidden">
                  <div
                    className="h-full flex"
                    style={{ width: `${maxTotal ? (r.total / maxTotal) * 100 : 0}%` }}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${r.total ? (r.done / r.total) * 100 : 0}%`,
                        backgroundColor: r.color,
                      }}
                    />
                    <div
                      className="h-full"
                      style={{
                        width: `${r.total ? (r.ahead / r.total) * 100 : 0}%`,
                        backgroundColor: r.color,
                        opacity: 0.35,
                      }}
                    />
                  </div>
                </div>
                <span className="w-[46px] shrink-0 text-right text-[11.5px] text-faint tabular-nums">
                  {formatHours(r.total)}
                </span>
              </div>
            ))}
          </div>

          {/* Legend + summary */}
          <div className="mt-4 pt-3 border-t border-line flex flex-col gap-2">
            <div className="flex items-center gap-4 text-[11px] text-faint">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-full bg-txt/70 inline-block" />
                done so far
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-full bg-txt/25 inline-block" />
                still ahead
              </span>
            </div>
            <p className="text-[12px] text-muted">
              {formatHours(totalDone)} done · {formatHours(totalAhead)} still ahead today
            </p>
          </div>
        </>
      )}
    </section>
  );
}
