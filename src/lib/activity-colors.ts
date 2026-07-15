// Single source of truth for activity → bar color, harmonized with the app's
// design tokens (see globals.css @theme). Reuse this anywhere an activity needs
// a consistent color. Unknown activities get a stable color via a hash so the
// same label always maps to the same swatch.

const KNOWN: Record<string, string> = {
  "deep work": "#7c6cff", // violet
  exercise:    "#4ade80", // cadence-green
  reading:     "#a78bfa", // violet-soft
  planning:    "#f5b454", // amber
  admin:       "#e879c9", // magenta
  other:       "#8a8a9e", // muted
};

const FALLBACK = ["#7c6cff", "#4ade80", "#a78bfa", "#f5b454", "#e879c9"];

export function activityColor(activity: string | null | undefined): string {
  const key = (activity ?? "other").trim().toLowerCase();
  if (KNOWN[key]) return KNOWN[key];

  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
