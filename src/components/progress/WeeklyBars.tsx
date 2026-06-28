"use client";

interface Bar {
  label: string;
  pct: number;
}

interface Props {
  bars: Bar[];
}

export default function WeeklyBars({ bars }: Props) {
  return (
    <section className="bg-panel border border-line rounded-[18px] p-5">
      <h2 className="font-grotesk font-semibold text-[15px] tracking-wide text-txt">
        This week
      </h2>
      <p className="text-muted text-[12.5px] mt-0.5 mb-5">
        Completion across your focus areas
      </p>

      <div className="flex flex-col gap-4">
        {bars.map((bar) => (
          <div key={bar.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[13px] text-txt">{bar.label}</span>
              <span className="font-grotesk font-semibold text-[12.5px] text-muted">
                {bar.pct}%
              </span>
            </div>
            <div className="h-2 bg-ink rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-linear-to-r from-violet to-magenta transition-[width] duration-500"
                style={{ width: `${bar.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 14-day momentum sparkline */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-muted text-[13px]">14-day momentum</span>
          <span className="font-grotesk text-cadence-green text-[13px] font-semibold">
            ↑ trending up
          </span>
        </div>
        <svg
          viewBox="0 0 320 72"
          className="w-full h-[72px]"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(124,108,255,.45)"/>
              <stop offset="1" stopColor="rgba(124,108,255,0)"/>
            </linearGradient>
          </defs>
          <path
            d="M0,58 L24,55 L48,50 L72,52 L96,44 L120,46 L144,38 L168,34 L192,36 L216,28 L240,24 L264,26 L288,16 L320,10"
            fill="none"
            stroke="#a78bfa"
            strokeWidth="2.5"
          />
          <path
            d="M0,58 L24,55 L48,50 L72,52 L96,44 L120,46 L144,38 L168,34 L192,36 L216,28 L240,24 L264,26 L288,16 L320,10 L320,72 L0,72 Z"
            fill="url(#sparkFill)"
          />
        </svg>
      </div>
    </section>
  );
}
