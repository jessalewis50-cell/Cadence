export function to12h(hhmm: string): string {
  if (!hhmm || !hhmm.includes(":")) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12    = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function to24h(display: string): string {
  const upper = display.toUpperCase().trim();
  const meridian = upper.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (meridian) {
    let h = parseInt(meridian[1]);
    const m = meridian[2];
    if (meridian[3] === "AM") { if (h === 12) h = 0; }
    else                      { if (h !== 12) h += 12; }
    return `${String(h).padStart(2, "0")}:${m}`;
  }
  const plain = upper.match(/^(\d{1,2}):(\d{2})$/);
  if (plain) return `${String(parseInt(plain[1])).padStart(2, "0")}:${plain[2]}`;
  return display;
}

/** Add `minutes` to a "HH:MM" string. Clamps at 23:30. */
export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total  = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Format a Date as "YYYY-MM-DD". */
export function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

export interface TimeOption { value: string; label: string; }

/** Build the 30-minute-interval time picker options for a full day. */
export function buildTimeOptions(): TimeOption[] {
  const opts: TimeOption[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const value  = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const period = h >= 12 ? "PM" : "AM";
      const h12    = h === 0 ? 12 : h > 12 ? h - 12 : h;
      opts.push({ value, label: `${h12}:${String(m).padStart(2, "0")} ${period}` });
    }
  }
  return opts;
}
