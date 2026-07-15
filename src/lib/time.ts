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

/**
 * Parse loose user time input into canonical "HH:MM" (24h), or null if it's
 * incomplete / ambiguous / invalid. Whitespace- and case-insensitive.
 *
 * Accepts: `9a`, `9 am`, `9:00am`, `915a`, `230p`, `12:30 am`, `1330`, `13:30`,
 * `0015`. Hours 1–12 REQUIRE a meridian (a/am/p/pm); bare input is accepted only
 * as a true 24-hour time (hour 13–23 or 00).
 */
export function parseTimeInput(raw: string): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/\s/g, "");
  if (!s) return null;

  let meridian: "am" | "pm" | null = null;
  let body = s;
  const mer = s.match(/(am|pm|a|p)$/);
  if (mer) {
    meridian = mer[1][0] === "a" ? "am" : "pm";
    body = s.slice(0, s.length - mer[1].length);
  }

  if (!/^\d{1,2}(:\d{1,2})?$|^\d{3,4}$/.test(body)) return null;

  let h: number, min: number;
  if (body.includes(":")) {
    const [hp, mp] = body.split(":");
    h = parseInt(hp, 10);
    min = parseInt(mp, 10);
  } else if (body.length <= 2) {
    h = parseInt(body, 10);
    min = 0;
  } else if (body.length === 3) {
    h = parseInt(body.slice(0, 1), 10);
    min = parseInt(body.slice(1), 10);
  } else {
    h = parseInt(body.slice(0, 2), 10);
    min = parseInt(body.slice(2), 10);
  }

  if (Number.isNaN(h) || Number.isNaN(min) || min > 59) return null;

  if (meridian) {
    if (h < 1 || h > 12) return null;
    if (meridian === "am") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else {
    // No meridian: only unambiguous 24-hour times (hour 13–23 or 00).
    if (h > 23) return null;
    if (h >= 1 && h <= 12) return null;
  }

  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
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

/** Minutes since midnight for a "HH:MM" string (e.g. "09:30" → 570). */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
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
