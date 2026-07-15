# Multi-Slot Saved Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one saved block (block template) own multiple time slots per day, stamp all of them onto recurrence days under a single shared title, and let one-off day tweaks (user or AI) survive template rebuilds via a `customized` tag.

**Architecture:** A JSONB `slots` column on `block_templates` (array of `{id, start_time, duration_minutes}` with stable UUIDs) replaces `default_start_time`. `schedule_blocks` gains `slot_id` + `customized`. Pure planning functions in `src/lib/scheduleTemplate.ts` compute what to stamp/delete (unit-tested with vitest); thin async wrappers apply them via Supabase. The Blocks page, Today timeline, and the agent route all consume the same planners. Dedupe moves from title-matching to `(template_id, slot_id, day)` matching.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict, Supabase (Postgres + RLS), Anthropic SDK tool loop, vitest (new devDependency).

**Spec:** `docs/superpowers/specs/2026-07-15-multi-slot-saved-blocks-design.md`

## Global Constraints

- All clock times are canonical `"HH:MM"` 24-hour strings (TimeField already emits these; validation regex `^([01]\d|2[0-3]):[0-5]\d$`).
- Day encoding everywhere: `0=Sun 1=Mon … 6=Sat`.
- Slot IDs are UUIDs generated once (via `crypto.randomUUID()`) when a slot is added, and never regenerated for an existing slot the user is editing in the UI. (The agent's `update_saved_block` replaces the whole slot list, so it regenerates IDs — acceptable because rebuild re-stamps untagged copies anyway.)
- Titles are NEVER used for matching/dedupe after this plan — only `template_id` + `slot_id`.
- `block_templates.duration_minutes` is kept, redefined as "default duration" (for new slot rows in the UI and slot-less quick-drops).
- Guest mode (no Supabase) must keep behavior parity using the same pure planners against local state.
- Do NOT rename localStorage keys, the repo, or the npm package.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Windows dev machine: run commands via PowerShell from `C:\Users\jessa\cadence`.
- The new SQL migration is written in Task 2 but only APPLIED to Supabase in Task 7 (final verification). Local dev/typecheck never needs the live DB.

---

### Task 1: Vitest test infrastructure

**Files:**
- Modify: `package.json` (add devDependency + `test` script)
- Create: `vitest.config.ts`
- Test: `src/lib/time.test.ts` (smoke test proving the runner + alias work)

**Interfaces:**
- Consumes: existing `src/lib/time.ts` exports (`addMinutes`, `parseTimeInput`).
- Produces: `npm test` runs vitest; `@/` alias resolves to `src/` inside tests. Later tasks put tests next to the code as `src/**/*.test.ts`.

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: `vitest` appears under `devDependencies` in `package.json`, lockfile updated, exit code 0.

- [ ] **Step 2: Add the test script**

In `package.json`, change the `scripts` block to:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    // Mirror the "@/*" path alias from tsconfig.json so library code under
    // test can keep its normal imports.
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 4: Write the smoke test**

Create `src/lib/time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { addMinutes, parseTimeInput } from "@/lib/time";

describe("time helpers (vitest smoke test)", () => {
  it("addMinutes adds within a day", () => {
    expect(addMinutes("09:00", 90)).toBe("10:30");
  });

  it("parseTimeInput canonicalizes meridian input", () => {
    expect(parseTimeInput("9a")).toBe("09:00");
    expect(parseTimeInput("230p")).toBe("14:30");
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: `2 passed` (both tests green), exit code 0.

- [ ] **Step 6: Verify the app still builds**

Run: `npm run build`
Expected: `✓ Compiled successfully`, no type errors.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json vitest.config.ts src/lib/time.test.ts
git commit -m @'
Add vitest test infrastructure with @/ alias

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Migration SQL + type additions

**Files:**
- Create: `supabase/migrations/20260715000001_template_slots.sql`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/mock-data.ts:59-63` (guest templates gain `slots`)

**Interfaces:**
- Produces: `TemplateSlot { id: string; start_time: string; duration_minutes: number }` exported from `@/lib/types`; `BlockTemplate.slots?: TemplateSlot[]` (optional during the transition — Task 7 makes it required); `ScheduleBlock.slot_id?: string | null` and `ScheduleBlock.customized?: boolean`. Every later task consumes these exact names.
- Note: `default_start_time` stays in the TS type until Task 7 so each intermediate commit compiles; the SQL migration (unapplied until Task 7) already drops the column.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260715000001_template_slots.sql`:

```sql
-- Multi-slot saved blocks: a template owns a LIST of time slots (JSONB) and
-- each stamped calendar copy records which slot it came from plus a
-- `customized` tag that lets one-off day tweaks survive template rebuilds.
-- See docs/superpowers/specs/2026-07-15-multi-slot-saved-blocks-design.md.

alter table public.block_templates
  add column if not exists slots jsonb not null default '[]';

alter table public.schedule_blocks
  add column if not exists slot_id uuid;

alter table public.schedule_blocks
  add column if not exists customized boolean not null default false;

-- Convert each template's old single default_start_time into a one-slot list.
update public.block_templates
set slots = jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'start_time', default_start_time,
      'duration_minutes', duration_minutes))
where default_start_time is not null
  and slots = '[]'::jsonb;

-- Point existing stamped copies at their template's single migrated slot.
-- Unambiguous: the update above creates exactly one slot per template.
update public.schedule_blocks b
set slot_id = (t.slots->0->>'id')::uuid
from public.block_templates t
where b.template_id = t.id
  and b.slot_id is null
  and jsonb_array_length(t.slots) > 0;

-- Superseded by slots.
alter table public.block_templates
  drop column if exists default_start_time;
```

- [ ] **Step 2: Update `src/lib/types.ts`**

Add above the `BlockTemplate` interface:

```ts
export interface TemplateSlot {
  id: string;                // stable UUID, generated when the slot is added
  start_time: string;        // "HH:MM"
  duration_minutes: number;
}
```

In `ScheduleBlock`, after the existing `template_id` line, add:

```ts
  slot_id?: string | null;   // which TemplateSlot this copy was stamped from
  customized?: boolean;      // one-off tag: edited copies survive template rebuilds
```

In `BlockTemplate`, after `duration_minutes` (leave `default_start_time` in place for now — removed in Task 7), add:

```ts
  slots?: TemplateSlot[];    // occurrences per recurrence day; optional until all writers set it (Task 7 makes it required)
```

Also update the comment on `duration_minutes` to:

```ts
  duration_minutes: number;  // default duration for new slots / slot-less quick-drops
```

- [ ] **Step 3: Update guest mock templates**

In `src/lib/mock-data.ts:59-63`, add a `slots` array to each of the five templates, converting its `default_start_time`/`duration_minutes` (keep the existing fields too for now). Use fixed IDs so guest sessions are deterministic:

```ts
    { id: "t1", user_id: "guest", title: "Morning deep work",   category: "deep",  duration_minutes: 90,  default_start_time: "09:00", slots: [{ id: "t1-s1", start_time: "09:00", duration_minutes: 90 }], recurrence_days: [1,2,3,4,5],   position: 0, detail: null, created_at: new Date().toISOString() },
    { id: "t2", user_id: "guest", title: "Movement & stretch",  category: "body",  duration_minutes: 30,  default_start_time: "07:30", slots: [{ id: "t2-s1", start_time: "07:30", duration_minutes: 30 }], recurrence_days: [1,2,3,4,5,6,0], position: 1, detail: null, created_at: new Date().toISOString() },
    { id: "t3", user_id: "guest", title: "Email & admin",       category: "admin", duration_minutes: 30,  default_start_time: "11:00", slots: [{ id: "t3-s1", start_time: "11:00", duration_minutes: 30 }], recurrence_days: [1,3,5],         position: 2, detail: null, created_at: new Date().toISOString() },
    { id: "t4", user_id: "guest", title: "Lunch break",         category: "break", duration_minutes: 60,  default_start_time: "12:30", slots: [{ id: "t4-s1", start_time: "12:30", duration_minutes: 60 }], recurrence_days: [1,2,3,4,5],    position: 3, detail: null, created_at: new Date().toISOString() },
    { id: "t5", user_id: "guest", title: "Afternoon focus",     category: "deep",  duration_minutes: 90,  default_start_time: "14:00", slots: [{ id: "t5-s1", start_time: "14:00", duration_minutes: 90 }], recurrence_days: [1,2,4],         position: 4, detail: null, created_at: new Date().toISOString() },
```

(Mock slot IDs are readable strings, not UUIDs — that's fine, `slot_id` matching is string equality in app code; only the Postgres column is uuid-typed and mock data never reaches Postgres.)

- [ ] **Step 4: Verify build + tests**

Run: `npm run build` then `npm test`
Expected: build compiles, 2 tests pass. (No behavior change yet — nothing reads `slots`.)

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20260715000001_template_slots.sql src/lib/types.ts src/lib/mock-data.ts
git commit -m @'
Add slots schema: migration, TemplateSlot type, slot_id/customized on blocks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: Pure planning functions + slot-aware scheduling library (TDD)

**Files:**
- Modify: `src/lib/scheduleTemplate.ts` (add pure functions; rewrite `scheduleTemplateBlocks`; add `rebuildTemplateBlocks`)
- Test: `src/lib/scheduleTemplate.test.ts`

**Interfaces:**
- Consumes: `TemplateSlot`, `BlockTemplate`, `ScheduleBlock` from Task 2; `addMinutes`, `toDateStr`, `timeToMinutes` from `@/lib/time`.
- Produces (exact exports later tasks call):

```ts
export type StampRow = Omit<ScheduleBlock, "id" | "created_at">;
export function validateSlots(slots: TemplateSlot[]): string | null;
export function planTemplateStamping(
  template: BlockTemplate,
  dates: Date[],
  existing: Array<{ day: string; slot_id?: string | null }>,
  userId: string
): StampRow[];
export function planTemplateRebuild(
  template: BlockTemplate,
  dates: Date[],
  existingUpcoming: Array<Pick<ScheduleBlock, "id" | "day" | "slot_id" | "customized" | "done">>,
  userId: string
): { deleteIds: string[]; inserts: StampRow[] };
export async function scheduleTemplateBlocks(supabase, template, userId): Promise<ScheduleBlock[]>; // signature unchanged, now slot-aware
export async function rebuildTemplateBlocks(supabase, template, userId): Promise<{ deletedIds: string[]; created: ScheduleBlock[] }>;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/scheduleTemplate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateSlots, planTemplateStamping, planTemplateRebuild } from "@/lib/scheduleTemplate";
import type { BlockTemplate, TemplateSlot } from "@/lib/types";

const slot = (id: string, start: string, dur = 60): TemplateSlot =>
  ({ id, start_time: start, duration_minutes: dur });

const tpl = (slots: TemplateSlot[], over: Partial<BlockTemplate> = {}): BlockTemplate => ({
  id: "tpl-1", user_id: "u1", title: "Deep Work", category: "deep",
  activity: "deep work", duration_minutes: 60, default_start_time: null,
  recurrence_days: [1, 2, 3, 4, 5], detail: null, position: 0,
  created_at: "2026-07-15T00:00:00Z", slots, ...over,
});

// Midday avoids UTC date-shift in toDateStr (which uses toISOString).
const d = (s: string) => new Date(`${s}T12:00:00`);

describe("validateSlots", () => {
  it("accepts a valid multi-slot list", () => {
    expect(validateSlots([slot("a", "09:00", 90), slot("b", "13:00", 90)])).toBeNull();
  });

  it("rejects non-canonical times", () => {
    expect(validateSlots([slot("a", "9:00")])).toMatch(/Invalid slot start time/);
    expect(validateSlots([slot("a", "25:00")])).toMatch(/Invalid slot start time/);
    expect(validateSlots([slot("a", "")])).toMatch(/Invalid slot start time/);
  });

  it("rejects non-positive durations", () => {
    expect(validateSlots([slot("a", "09:00", 0)])).toMatch(/Invalid slot duration/);
    expect(validateSlots([slot("a", "09:00", -30)])).toMatch(/Invalid slot duration/);
  });

  it("rejects overlapping slots regardless of input order", () => {
    expect(validateSlots([slot("b", "10:00", 60), slot("a", "09:00", 90)])).toMatch(/overlap/i);
  });

  it("accepts back-to-back slots (end == next start)", () => {
    expect(validateSlots([slot("a", "09:00", 60), slot("b", "10:00", 60)])).toBeNull();
  });
});

describe("planTemplateStamping", () => {
  it("stamps every slot on every date with shared title and correct end times", () => {
    const t = tpl([slot("s1", "09:00", 90), slot("s2", "13:00", 60)]);
    const rows = planTemplateStamping(t, [d("2026-07-20"), d("2026-07-21")], [], "u1");
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map(r => r.title))).toEqual(new Set(["Deep Work"]));
    const s1Mon = rows.find(r => r.day === "2026-07-20" && r.slot_id === "s1")!;
    expect(s1Mon.start_time).toBe("09:00");
    expect(s1Mon.end_time).toBe("10:30");
    expect(s1Mon.customized).toBe(false);
    expect(s1Mon.source).toBe("template");
    expect(s1Mon.template_id).toBe("tpl-1");
  });

  it("dedupes by (day, slot_id), not title", () => {
    const t = tpl([slot("s1", "09:00"), slot("s2", "13:00")]);
    const rows = planTemplateStamping(
      t, [d("2026-07-20")],
      [{ day: "2026-07-20", slot_id: "s1" }],
      "u1"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].slot_id).toBe("s2");
  });

  it("stamps nothing for a slot-less template", () => {
    expect(planTemplateStamping(tpl([]), [d("2026-07-20")], [], "u1")).toHaveLength(0);
  });
});

describe("planTemplateRebuild", () => {
  const t = tpl([slot("s1", "09:00", 90), slot("s2", "13:00", 60)]);
  const existing = [
    { id: "b1", day: "2026-07-20", slot_id: "s1",  customized: false, done: false }, // plain copy → delete
    { id: "b2", day: "2026-07-20", slot_id: "s2",  customized: true,  done: false }, // moved → preserve, don't re-stamp
    { id: "b3", day: "2026-07-21", slot_id: "s1",  customized: false, done: true  }, // completed → preserve, don't re-stamp
    { id: "b4", day: "2026-07-21", slot_id: "old", customized: true,  done: false }, // moved copy of deleted slot → preserve
    { id: "b5", day: "2026-07-22", slot_id: "old", customized: false, done: false }, // stale copy of deleted slot → delete
  ];

  it("deletes only untagged, not-done copies", () => {
    const { deleteIds } = planTemplateRebuild(t, [d("2026-07-20"), d("2026-07-21")], existing, "u1");
    expect(deleteIds.sort()).toEqual(["b1", "b5"]);
  });

  it("re-stamps all slots x dates except pairs covered by preserved copies", () => {
    const { inserts } = planTemplateRebuild(t, [d("2026-07-20"), d("2026-07-21")], existing, "u1");
    const keys = inserts.map(r => `${r.day}|${r.slot_id}`).sort();
    // 2 dates x 2 slots = 4, minus (07-20,s2) preserved-customized and (07-21,s1) preserved-done.
    expect(keys).toEqual(["2026-07-20|s1", "2026-07-21|s2"]);
  });

  it("with recurrence removed (no dates) deletes untagged copies and inserts nothing", () => {
    const { deleteIds, inserts } = planTemplateRebuild(t, [], existing, "u1");
    expect(deleteIds.sort()).toEqual(["b1", "b5"]);
    expect(inserts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `scheduleTemplate.test.ts` errors with "does not provide an export named 'validateSlots'" (or similar). The `time.test.ts` smoke tests still pass.

- [ ] **Step 3: Implement in `src/lib/scheduleTemplate.ts`**

Replace the whole file with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { addMinutes, toDateStr, timeToMinutes } from "@/lib/time";
import type { BlockTemplate, ScheduleBlock, TemplateSlot } from "@/lib/types";

const DEFAULT_WEEKS_AHEAD = 4;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A schedule_blocks insert payload (row minus DB-generated fields). */
export type StampRow = Omit<ScheduleBlock, "id" | "created_at">;

const stampKey = (day: string, slotId: string) => `${day}|${slotId}`;

/**
 * Dates within the next `weeksAhead` weeks (starting today) that fall on one of
 * the template's recurrence days. Day encoding: 0 = Sunday … 6 = Saturday.
 */
export function matchingDatesForTemplate(
  recurrenceDays: number[],
  weeksAhead = DEFAULT_WEEKS_AHEAD
): Date[] {
  if (recurrenceDays.length === 0) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + weeksAhead * 7 - 1);

  const dates: Date[] = [];
  const cursor = new Date(today);
  while (cursor <= endDate) {
    if (recurrenceDays.includes(cursor.getDay())) dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/**
 * Validate a slot list: canonical HH:MM times, positive durations, and no
 * overlaps within the template. Returns an error message, or null if valid.
 */
export function validateSlots(slots: TemplateSlot[]): string | null {
  for (const s of slots) {
    if (!TIME_RE.test(s.start_time)) {
      return `Invalid slot start time "${s.start_time}" (expected HH:MM, 24-hour).`;
    }
    if (!Number.isFinite(s.duration_minutes) || s.duration_minutes <= 0) {
      return `Invalid slot duration ${s.duration_minutes} (must be a positive number of minutes).`;
    }
  }
  const sorted = [...slots].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = timeToMinutes(sorted[i - 1].start_time) + sorted[i - 1].duration_minutes;
    if (timeToMinutes(sorted[i].start_time) < prevEnd) {
      return `Slots overlap: ${sorted[i - 1].start_time} (${sorted[i - 1].duration_minutes} min) runs into ${sorted[i].start_time}.`;
    }
  }
  return null;
}

/**
 * Pure stamping plan: one row per (date x slot), skipping pairs that already
 * have a copy. Identity is (template_id, slot_id, day) — titles are never
 * matched, which is what allows several same-titled blocks on one day.
 */
export function planTemplateStamping(
  template: BlockTemplate,
  dates: Date[],
  existing: Array<{ day: string; slot_id?: string | null }>,
  userId: string
): StampRow[] {
  const slots = template.slots ?? [];
  if (slots.length === 0) return [];

  const taken = new Set(
    existing.filter((e) => e.slot_id).map((e) => stampKey(e.day, e.slot_id!))
  );

  const rows: StampRow[] = [];
  for (const d of dates) {
    const day = toDateStr(d);
    for (const s of slots) {
      if (taken.has(stampKey(day, s.id))) continue;
      rows.push({
        user_id:     userId,
        day,
        start_time:  s.start_time,
        end_time:    addMinutes(s.start_time, s.duration_minutes),
        title:       template.title,
        category:    template.category,
        activity:    template.activity ?? null,
        detail:      template.detail ?? null,
        position:    0,
        done:        false,
        source:      "template",
        template_id: template.id,
        slot_id:     s.id,
        customized:  false,
      });
    }
  }
  return rows;
}

/**
 * Pure rebuild plan for a template's upcoming copies:
 * - delete untagged (`!customized && !done`) copies,
 * - preserve customized/done copies and skip re-stamping their (day, slot) pair,
 * - preserved copies of deleted slots simply survive (self-governing).
 */
export function planTemplateRebuild(
  template: BlockTemplate,
  dates: Date[],
  existingUpcoming: Array<Pick<ScheduleBlock, "id" | "day" | "slot_id" | "customized" | "done">>,
  userId: string
): { deleteIds: string[]; inserts: StampRow[] } {
  const preserved = existingUpcoming.filter((b) => b.customized || b.done);
  const deleteIds = existingUpcoming.filter((b) => !b.customized && !b.done).map((b) => b.id);
  const inserts = planTemplateStamping(template, dates, preserved, userId);
  return { deleteIds, inserts };
}

/**
 * Create recurring schedule_blocks for a template's slots across the next
 * 4 weeks, deduped by (template_id, slot_id, day). Returns the rows created.
 *
 * This is the single source of truth for turning a saved block into calendar
 * entries — used by both the Blocks page (client) and the agent route (server).
 * It's a no-op unless the template has both recurrence_days and slots.
 */
export async function scheduleTemplateBlocks(
  supabase: SupabaseClient,
  template: BlockTemplate,
  userId: string
): Promise<ScheduleBlock[]> {
  if ((template.slots ?? []).length === 0) return [];

  const matchingDates = matchingDatesForTemplate(template.recurrence_days);
  if (matchingDates.length === 0) return [];

  const dateStrs = matchingDates.map(toDateStr);
  const { data: existing } = await supabase
    .from("schedule_blocks")
    .select("day, slot_id")
    .eq("user_id", userId)
    .eq("template_id", template.id)
    .in("day", dateStrs);

  const payload = planTemplateStamping(
    template,
    matchingDates,
    (existing ?? []) as Array<{ day: string; slot_id?: string | null }>,
    userId
  );
  if (payload.length === 0) return [];

  const { data: created } = await supabase
    .from("schedule_blocks")
    .insert(payload)
    .select();

  return (created as ScheduleBlock[]) ?? [];
}

/**
 * Rebuild a template's upcoming copies after the template changed: delete
 * untagged copies from today onward, re-stamp all slots x recurrence days,
 * and leave customized/done copies untouched (no duplicates beside them).
 */
export async function rebuildTemplateBlocks(
  supabase: SupabaseClient,
  template: BlockTemplate,
  userId: string
): Promise<{ deletedIds: string[]; created: ScheduleBlock[] }> {
  const todayStr = toDateStr(new Date());
  const { data: upcoming } = await supabase
    .from("schedule_blocks")
    .select("id, day, slot_id, customized, done")
    .eq("user_id", userId)
    .eq("template_id", template.id)
    .gte("day", todayStr);

  const dates = matchingDatesForTemplate(template.recurrence_days);
  const { deleteIds, inserts } = planTemplateRebuild(
    template,
    dates,
    (upcoming ?? []) as Array<Pick<ScheduleBlock, "id" | "day" | "slot_id" | "customized" | "done">>,
    userId
  );

  if (deleteIds.length > 0) {
    await supabase
      .from("schedule_blocks")
      .delete()
      .eq("user_id", userId)
      .in("id", deleteIds);
  }

  let created: ScheduleBlock[] = [];
  if (inserts.length > 0) {
    const { data } = await supabase.from("schedule_blocks").insert(inserts).select();
    created = (data as ScheduleBlock[]) ?? [];
  }
  return { deletedIds: deleteIds, created };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass (time smoke tests + the new suites: 5 validateSlots, 3 planTemplateStamping, 3 planTemplateRebuild).

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: compiles. NOTE: `BlocksView.tsx:373` (`autoScheduleTemplate`) still checks `tpl.default_start_time` and calls `scheduleTemplateBlocks` — that compiles (signature unchanged) and is corrected in Task 4. Callers passing templates without `slots` now stamp nothing via the shared function; the UI still writes `default_start_time`, so freshly created templates won't auto-schedule until Task 4 lands. Acceptable mid-plan state; do not ship between Tasks 3 and 4.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/scheduleTemplate.ts src/lib/scheduleTemplate.test.ts
git commit -m @'
Add slot-aware stamping/rebuild planners with unit tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: BlocksView — slot editor UI + slot-aware CRUD and stamping

**Files:**
- Modify: `src/components/blocks/BlocksView.tsx`

**Interfaces:**
- Consumes: `validateSlots`, `planTemplateStamping`, `planTemplateRebuild`, `rebuildTemplateBlocks`, `scheduleTemplateBlocks`, `matchingDatesForTemplate` from `@/lib/scheduleTemplate`; `timeToMinutes` from `@/lib/time`; `TemplateSlot` from `@/lib/types`.
- Produces: templates written to DB/local state always include `slots: TemplateSlot[]` and never write `default_start_time`.

- [ ] **Step 1: Update imports and draft types**

At the top of `BlocksView.tsx`, change the imports to:

```ts
import { to12h, addMinutes, toDateStr, timeToMinutes } from "@/lib/time";
import {
  scheduleTemplateBlocks, matchingDatesForTemplate,
  planTemplateStamping, planTemplateRebuild, rebuildTemplateBlocks,
  validateSlots,
} from "@/lib/scheduleTemplate";
import type { BlockTemplate, ScheduleBlock, Category, TemplateSlot } from "@/lib/types";
```

Replace the `TplDraft` interface and `EMPTY_TPL` (lines 54-65) with:

```ts
interface TplDraft {
  title: string;
  category: Category;
  duration_minutes: number;   // default duration for new slot rows / slot-less drop-ins
  slots: TemplateSlot[];
  recurrence_days: number[];
  detail: string;
}
const EMPTY_TPL: TplDraft = {
  title: "", category: "deep", duration_minutes: 60,
  slots: [], recurrence_days: [], detail: "",
};
```

- [ ] **Step 2: Add the SlotListEditor component**

Add above `export default function BlocksView(...)`:

```tsx
// ── Slot list editor ─────────────────────────────────────────────────────────
// Rows are shown in draft order while editing (sorting mid-typing would make
// rows jump); the save handlers sort by start time before persisting.

function SlotListEditor({ slots, defaultDuration, onChange }: {
  slots: TemplateSlot[];
  defaultDuration: number;
  onChange: (slots: TemplateSlot[]) => void;
}) {
  return (
    <div>
      <label className="text-[11.5px] text-muted block mb-1">
        Times — the block appears once per time, every repeat day
      </label>
      <div className="flex flex-col gap-1.5">
        {slots.map((slot, i) => (
          <div key={slot.id} className="flex gap-2 items-center">
            <div className="flex-1">
              <TimeField
                value={slot.start_time}
                onChange={v => onChange(slots.map((s, j) => j === i ? { ...s, start_time: v } : s))}
                placeholder="e.g. 9:00 AM"
              />
            </div>
            <input
              type="number" min="5" max="480" step="5" required
              value={slot.duration_minutes}
              onChange={e => onChange(slots.map((s, j) => j === i ? { ...s, duration_minutes: Number(e.target.value) } : s))}
              className="w-24 bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm outline-none focus:border-violet"
              title="Duration (minutes)"
            />
            <button type="button" onClick={() => onChange(slots.filter((_, j) => j !== i))}
              className="text-faint hover:text-magenta transition-colors" title="Remove time">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        ))}
        <button type="button"
          onClick={() => onChange([...slots, { id: crypto.randomUUID(), start_time: "", duration_minutes: defaultDuration }])}
          className="self-start text-[11.5px] text-violet hover:underline">
          + Add time
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `saveTemplate` (slot validation + insert)**

Replace the whole `saveTemplate` function with:

```ts
  async function saveTemplate(e: React.FormEvent) {
    e.preventDefault();
    setTplSaving(true);
    setTplError(null);

    const slots = [...tplDraft.slots].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
    const slotErr = validateSlots(slots);
    if (slotErr) { setTplError(slotErr); setTplSaving(false); return; }

    const maxPos = templates.reduce((m, t) => Math.max(m, t.position), -1);

    if (!isGuest) {
      const { data, error } = await supabase
        .from("block_templates")
        .insert({
          user_id: userId!,
          title: tplDraft.title,
          category: tplDraft.category,
          duration_minutes: tplDraft.duration_minutes,
          slots,
          recurrence_days: tplDraft.recurrence_days,
          detail: tplDraft.detail.trim() || null,
          position: maxPos + 1,
        })
        .select()
        .single();
      setTplSaving(false);
      if (error) {
        console.error("block_templates insert error:", error);
        setTplError(error.message);
        return;
      }
      if (data) {
        const saved = data as BlockTemplate;
        setTemplates(prev => [...prev, saved]);
        setTplDraft(EMPTY_TPL);
        setShowTplForm(false);
        autoScheduleTemplate(saved);
      }
      return;
    }
    // Guest
    const guestTpl: BlockTemplate = {
      id: crypto.randomUUID(), user_id: "guest", ...tplDraft, slots,
      detail: tplDraft.detail.trim() || null,
      position: maxPos + 1, created_at: new Date().toISOString(),
    };
    setTemplates(prev => [...prev, guestTpl]);
    setTplDraft(EMPTY_TPL);
    setShowTplForm(false);
    setTplSaving(false);
    autoScheduleTemplate(guestTpl);
  }
```

- [ ] **Step 4: Update `startEditTpl` and rewrite `updateTemplate` (preserve-aware rebuild)**

`startEditTpl` becomes:

```ts
  function startEditTpl(tpl: BlockTemplate) {
    setEditingTplId(tpl.id);
    setEditTplDraft({
      title:            tpl.title,
      category:         tpl.category,
      duration_minutes: tpl.duration_minutes,
      slots:            (tpl.slots ?? []).map(s => ({ ...s })),
      recurrence_days:  tpl.recurrence_days,
      detail:           tpl.detail ?? "",
    });
    setEditTplError(null);
  }
```

Replace the whole `updateTemplate` function with:

```ts
  async function updateTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTplId) return;

    const original = templates.find(t => t.id === editingTplId);
    if (!original) return;

    const slots = [...editTplDraft.slots].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
    const slotErr = validateSlots(slots);
    if (slotErr) { setEditTplError(slotErr); return; }

    const updatedTpl: BlockTemplate = {
      ...original,
      ...editTplDraft,
      slots,
      detail: editTplDraft.detail.trim() || null,
    };

    // A recurring edit propagates to the calendar; confirm before rewriting
    // upcoming days. Also covers making a template recurring / non-recurring.
    const affectsCalendar =
      original.recurrence_days.length > 0 || updatedTpl.recurrence_days.length > 0;
    if (
      affectsCalendar &&
      !window.confirm(`Update '${updatedTpl.title}' on all upcoming days? Copies you've moved or completed are kept; past days stay unchanged.`)
    ) {
      return;
    }

    setEditTplSaving(true);
    setEditTplError(null);

    if (!isGuest) {
      const { error } = await supabase
        .from("block_templates")
        .update({
          title:            editTplDraft.title,
          category:         editTplDraft.category,
          duration_minutes: editTplDraft.duration_minutes,
          slots,
          recurrence_days:  editTplDraft.recurrence_days,
          detail:           editTplDraft.detail.trim() || null,
        })
        .eq("id", editingTplId);
      if (error) {
        console.error("block_templates update error:", error);
        setEditTplError(error.message);
        setEditTplSaving(false);
        return;
      }
    }

    setTemplates(prev => prev.map(t => t.id === editingTplId ? updatedTpl : t));
    setEditingTplId(null);
    setEditTplSaving(false);

    // Rebuild this template's UPCOMING copies so today-onward matches the new
    // slots and days. Customized and completed copies are preserved; past
    // copies untouched.
    if (affectsCalendar) {
      const currentWeekStrs = new Set(getWeekDays(weekOffset).map(d => toDateStr(d)));

      if (!isGuest) {
        const { deletedIds, created } = await rebuildTemplateBlocks(supabase, updatedTpl, userId!);
        const deleted = new Set(deletedIds);
        setDayBlocks(prev => {
          const next: Record<string, ScheduleBlock[]> = {};
          for (const [day, blocks] of Object.entries(prev)) {
            next[day] = blocks.filter(b => !deleted.has(b.id));
          }
          for (const b of created) {
            if (!currentWeekStrs.has(b.day)) continue;
            next[b.day] = [...(next[b.day] ?? []), b].sort((a, c) => a.start_time.localeCompare(c.start_time));
          }
          return next;
        });
        return;
      }

      // Guest: run the same rebuild plan against local state.
      setDayBlocks(prev => {
        const upcoming = Object.entries(prev).flatMap(([day, bs]) =>
          day >= todayStr ? bs.filter(b => b.template_id === updatedTpl.id) : []
        );
        const { deleteIds, inserts } = planTemplateRebuild(
          updatedTpl, matchingDatesForTemplate(updatedTpl.recurrence_days), upcoming, "guest"
        );
        const del = new Set(deleteIds);
        const next: Record<string, ScheduleBlock[]> = {};
        for (const [day, bs] of Object.entries(prev)) {
          next[day] = bs.filter(b => !del.has(b.id));
        }
        for (const row of inserts) {
          if (!currentWeekStrs.has(row.day)) continue;
          const local: ScheduleBlock = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() };
          next[row.day] = [...(next[row.day] ?? []), local].sort((a, c) => a.start_time.localeCompare(c.start_time));
        }
        return next;
      });
    }
  }
```

- [ ] **Step 5: Preserve customized/done copies in `deleteTemplate`**

In `deleteTemplate`, change the confirm message for repeating templates to:

```ts
    const message = repeating
      ? `Delete '${tpl.title}'? Upcoming copies are removed from your calendar, except ones you've moved or completed. Past days will be kept. This can't be undone.`
      : `Delete '${tpl.title}'? This can't be undone.`;
```

Change the local-state filter to keep customized/done copies:

```ts
    setDayBlocks(prev => {
      const next: Record<string, ScheduleBlock[]> = {};
      for (const [day, blocks] of Object.entries(prev)) {
        next[day] = day >= todayStr
          ? blocks.filter(b => b.template_id !== id || b.customized || b.done)
          : blocks;
      }
      return next;
    });
```

And the DB delete gains two filters:

```ts
      await supabase
        .from("schedule_blocks")
        .delete()
        .eq("user_id", userId!)
        .eq("template_id", id)
        .eq("customized", false)
        .eq("done", false)
        .gte("day", todayStr);
```

- [ ] **Step 6: Rewrite `addTemplateToDay` (stamp all slots for that day)**

```ts
  async function addTemplateToDay(template: BlockTemplate, dayStr: string) {
    const existing = dayBlocks[dayStr] ?? [];
    const maxPos   = existing.reduce((m, b) => Math.max(m, b.position), -1);
    const slots    = template.slots ?? [];

    let rows: Omit<ScheduleBlock, "id" | "created_at">[];
    if (slots.length > 0) {
      // Stamp every slot onto this day, skipping (day, slot) pairs already present.
      rows = planTemplateStamping(template, [new Date(`${dayStr}T12:00:00`)], existing, userId ?? "guest")
        .map((r, i) => ({ ...r, position: maxPos + 1 + i }));
    } else {
      // Slot-less template: one block at the next free time, default duration.
      const startTime = nextStartTime(existing);
      rows = [{
        user_id: userId ?? "guest",
        day: dayStr,
        start_time: startTime,
        end_time: addMinutes(startTime, template.duration_minutes),
        title: template.title,
        category: template.category,
        position: maxPos + 1,
        done: false,
        source: "template" as const,
        template_id: template.id,
      }];
    }

    if (rows.length === 0) { setAddingTo(null); return; } // every slot already on this day

    if (!isGuest) {
      const { data, error } = await supabase
        .from("schedule_blocks").insert(rows).select();
      if (!error && data) {
        setDayBlocks(prev => ({ ...prev, [dayStr]: [...(prev[dayStr] ?? []), ...(data as ScheduleBlock[])].sort((a, b) => a.start_time.localeCompare(b.start_time)) }));
      }
    } else {
      const locals: ScheduleBlock[] = rows.map(r => ({ ...r, id: crypto.randomUUID(), created_at: new Date().toISOString() }));
      setDayBlocks(prev => ({ ...prev, [dayStr]: [...(prev[dayStr] ?? []), ...locals].sort((a, b) => a.start_time.localeCompare(b.start_time)) }));
    }
    setAddingTo(null);
  }
```

- [ ] **Step 7: Rewrite `autoScheduleTemplate` (guest path uses the planner)**

```ts
  async function autoScheduleTemplate(tpl: BlockTemplate) {
    if (tpl.recurrence_days.length === 0 || (tpl.slots ?? []).length === 0) return;

    if (!isGuest) {
      // Shared logic: creates the recurring blocks (slot-aware, ID-deduped).
      const created = await scheduleTemplateBlocks(supabase, tpl, userId!);
      if (created.length === 0) return;

      const currentWeekStrs = new Set(getWeekDays(weekOffset).map(d => toDateStr(d)));
      const inView = created.filter(b => currentWeekStrs.has(b.day));
      if (inView.length > 0) {
        setDayBlocks(prev => {
          const next = { ...prev };
          for (const b of inView) {
            next[b.day] = [...(next[b.day] ?? []), b].sort((a, c) => a.start_time.localeCompare(c.start_time));
          }
          return next;
        });
      }
      return;
    }

    // Guest: no DB — only reflect the currently visible week in local state.
    // Functional update so dedupe reads the freshest state (matters when this
    // runs right after an update clears the old copies).
    const currentWeekStrs = new Set(getWeekDays(weekOffset).map(d => toDateStr(d)));
    setDayBlocks(prev => {
      const dates = matchingDatesForTemplate(tpl.recurrence_days)
        .filter(d => currentWeekStrs.has(toDateStr(d)));
      const existing = dates.flatMap(d =>
        (prev[toDateStr(d)] ?? []).filter(b => b.template_id === tpl.id)
      );
      const rows = planTemplateStamping(tpl, dates, existing, "guest");
      const next = { ...prev };
      for (const row of rows) {
        const local: ScheduleBlock = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() };
        next[row.day] = [...(next[row.day] ?? []), local].sort((a, c) => a.start_time.localeCompare(c.start_time));
      }
      return next;
    });
  }
```

- [ ] **Step 8: Rewrite `scheduleWeek` (slot-aware, ID-deduped)**

```ts
  async function scheduleWeek() {
    const created: ScheduleBlock[] = [];
    for (const day of weekDays) {
      const dayStr = toDateStr(day);
      const dayNum = day.getDay(); // 0=Sun
      for (const tpl of templates) {
        if (!tpl.recurrence_days.includes(dayNum)) continue;
        const existing = [...(dayBlocks[dayStr] ?? []), ...created.filter(b => b.day === dayStr)];
        const maxPos   = existing.reduce((m, b) => Math.max(m, b.position), -1);
        const slots    = tpl.slots ?? [];

        let rows: Omit<ScheduleBlock, "id" | "created_at">[];
        if (slots.length > 0) {
          rows = planTemplateStamping(tpl, [day], existing, userId ?? "guest")
            .map((r, i) => ({ ...r, position: maxPos + 1 + i }));
        } else {
          if (existing.some(b => b.template_id === tpl.id)) continue; // already there
          const startTime = nextStartTime(existing);
          rows = [{ user_id: userId ?? "guest", day: dayStr, start_time: startTime, end_time: addMinutes(startTime, tpl.duration_minutes), title: tpl.title, category: tpl.category, position: maxPos + 1, done: false, source: "template" as const, template_id: tpl.id }];
        }

        for (const row of rows) {
          if (!isGuest) {
            const { data } = await supabase.from("schedule_blocks").insert(row).select().single();
            if (data) created.push(data as ScheduleBlock);
          } else {
            created.push({ ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() });
          }
        }
      }
    }
    if (created.length > 0) {
      setDayBlocks(prev => {
        const next = { ...prev };
        for (const b of created) {
          next[b.day] = [...(next[b.day] ?? []), b].sort((a, c) => a.start_time.localeCompare(c.start_time));
        }
        return next;
      });
    }
  }
```

- [ ] **Step 9: Replace the form fields (both create and edit forms)**

In the NEW-template form, replace the two-column `Duration (minutes)` / `Default start time (optional)` row (the `div.flex.gap-2.items-center` containing both, around lines 503-521) with:

```tsx
            <div className="flex gap-2 items-start">
              <div className="w-40">
                <label className="text-[11.5px] text-muted block mb-1">Default duration (min)</label>
                <input
                  type="number" min="5" max="480" step="5" required
                  value={tplDraft.duration_minutes}
                  onChange={e => setTplDraft(d => ({ ...d, duration_minutes: Number(e.target.value) }))}
                  className="w-full bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm outline-none focus:border-violet"
                />
              </div>
              <div className="flex-1">
                <SlotListEditor
                  slots={tplDraft.slots}
                  defaultDuration={tplDraft.duration_minutes}
                  onChange={slots => setTplDraft(d => ({ ...d, slots }))}
                />
              </div>
            </div>
```

In the EDIT form, replace the matching `Duration (min)` / `Default start (optional)` row (around lines 579-596) with the identical structure bound to `editTplDraft`/`setEditTplDraft`:

```tsx
                    <div className="flex gap-2 items-start">
                      <div className="w-40">
                        <label className="text-[11.5px] text-muted block mb-1">Default duration (min)</label>
                        <input type="number" min="5" max="480" step="5" required
                          value={editTplDraft.duration_minutes}
                          onChange={e => setEditTplDraft(d => ({ ...d, duration_minutes: Number(e.target.value) }))}
                          className="w-full bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm outline-none focus:border-violet"
                        />
                      </div>
                      <div className="flex-1">
                        <SlotListEditor
                          slots={editTplDraft.slots}
                          defaultDuration={editTplDraft.duration_minutes}
                          onChange={slots => setEditTplDraft(d => ({ ...d, slots }))}
                        />
                      </div>
                    </div>
```

- [ ] **Step 10: Replace the saved-block card time summary**

Replace the card's duration/time line (lines 653-658):

```tsx
                  <div className="flex items-center gap-2 text-[11.5px] text-muted flex-wrap">
                    {(tpl.slots ?? []).length === 0 ? (
                      <span>{tpl.duration_minutes} min</span>
                    ) : (
                      <span>
                        {(tpl.slots ?? []).map(s => `${to12h(s.start_time)} · ${s.duration_minutes}m`).join(", ")}
                      </span>
                    )}
                  </div>
```

- [ ] **Step 11: Verify build + tests, then check the page**

Run: `npm test` then `npm run build`
Expected: all tests pass; build compiles with no references to `tplDraft.default_start_time` remaining in this file (`grep -n "default_start_time" src/components/blocks/BlocksView.tsx` returns nothing).

Manual spot-check (guest mode works without env keys): `npm run dev`, open http://localhost:3000/blocks → "+ New block" shows the Times list; adding two times to a saved block and enabling repeat days stamps both copies onto each matching day in the week grid.

- [ ] **Step 12: Commit**

```powershell
git add src/components/blocks/BlocksView.tsx
git commit -m @'
BlocksView: multi-slot editor, slot-aware stamping and preserve-aware rebuild

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 5: Today timeline — customized tag on edit + slot-aware quick-add + edited dot

**Files:**
- Modify: `src/components/schedule/Timeline.tsx`

**Interfaces:**
- Consumes: `ScheduleBlock.customized` / `slot_id` (Task 2), `BlockTemplate.slots` (Task 2).
- Produces: any time edit to a template-stamped block writes `customized: true` (DB + local state).

- [ ] **Step 1: Rewrite `saveEdit` to set the tag**

Replace `saveEdit` (lines 130-160) with:

```ts
  async function saveEdit(e: React.FormEvent, block: ScheduleBlock) {
    e.preventDefault();
    const timeChanged =
      editDraft.start_time !== block.start_time || editDraft.end_time !== block.end_time;
    // A one-off time change to a template copy tags it so template rebuilds
    // leave it alone from now on.
    const markCustomized = Boolean(block.template_id) && timeChanged;

    if (!isGuest) {
      const titleChanged = editDraft.title !== block.title;

      if (timeChanged) {
        const newDur  = durationMinutes(editDraft.start_time, editDraft.end_time);
        const origDur = durationMinutes(block.start_time, block.end_time);
        if (editDraft.start_time !== block.start_time) {
          await writeCorrection(block, "reschedule", { new_start_time: editDraft.start_time, new_duration_minutes: newDur });
        } else if (newDur !== origDur) {
          await writeCorrection(block, "resize", { new_duration_minutes: newDur });
        }
      }
      if (titleChanged) await writeCorrection(block, "retitle");

      await supabase.from("schedule_blocks").update({
        start_time: editDraft.start_time,
        end_time:   editDraft.end_time,
        title:      editDraft.title,
        category:   editDraft.category,
        detail:     editDraft.detail.trim() || null,
        ...(markCustomized ? { customized: true } : {}),
      }).eq("id", block.id);
    }

    setBlocks((prev) => prev.map((b) =>
      b.id === block.id
        ? { ...b, ...editDraft, detail: editDraft.detail.trim() || null, customized: markCustomized ? true : b.customized }
        : b
    ));
    setEditingId(null);
  }
```

- [ ] **Step 2: Slot-aware `addFromTemplate`**

In `addFromTemplate` (lines 215-248), replace the two time lines:

```ts
    const startTime = tpl.default_start_time ?? nextStart(blocks);
    const endTime   = addMinutes(startTime, tpl.duration_minutes);
```

with:

```ts
    // Today's quick-add intentionally places ONE block (the first slot's shape),
    // not the whole slot list — the Blocks page is where full days are stamped.
    const firstSlot = (tpl.slots ?? [])[0];
    const startTime = firstSlot?.start_time ?? nextStart(blocks);
    const endTime   = addMinutes(startTime, firstSlot?.duration_minutes ?? tpl.duration_minutes);
```

- [ ] **Step 3: Add the "edited" dot to customized copies**

In the block-row JSX where the time range renders (near `{to12h(block.start_time)}`, around line 333), add immediately after the time text element:

```tsx
                {block.customized && block.template_id && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-violet inline-block ml-1.5 align-middle flex-shrink-0"
                    title="Moved for this day — won't follow template changes."
                  />
                )}
```

(Read the surrounding JSX first and place it so it sits inline beside the time without breaking the row layout; match the row's existing spacing utilities.)

- [ ] **Step 4: Verify build + behavior**

Run: `npm test` then `npm run build`
Expected: pass/compile; `grep -n "default_start_time" src/components/schedule/Timeline.tsx` returns nothing.

Manual spot-check in guest mode: on the Today page, edit a template-stamped block's start time → the violet dot appears on the row.

- [ ] **Step 5: Commit**

```powershell
git add src/components/schedule/Timeline.tsx
git commit -m @'
Timeline: tag one-off edits to template copies as customized, show edited dot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 6: Agent route — slots in create_saved_block, new update_saved_block, customized on one-off edits

**Files:**
- Modify: `src/app/api/agent/route.ts`

**Interfaces:**
- Consumes: `validateSlots`, `rebuildTemplateBlocks`, `scheduleTemplateBlocks` from `@/lib/scheduleTemplate`; `TemplateSlot` from `@/lib/types`.
- Produces: tools `create_saved_block` (with `slots`), `update_saved_block` (new); `update_block`/`update_blocks` set `customized: true` on time changes to template copies.

- [ ] **Step 1: Update imports**

```ts
import { scheduleTemplateBlocks, rebuildTemplateBlocks, validateSlots } from "@/lib/scheduleTemplate";
import type { ScheduleBlock, BlockTemplate, TemplateSlot } from "@/lib/types";
```

- [ ] **Step 2: Replace the `create_saved_block` tool definition** (lines 162-186)

```ts
  {
    name: "create_saved_block",
    description:
      "Save a reusable block template (a \"saved block\"), used for recurring routines. " +
      "A saved block can occur MULTIPLE times per day via `slots` — each slot is one occurrence " +
      "(start_time + duration_minutes) and every copy shares the block's title. If recurrence_days " +
      "and at least one slot are provided, the routine is automatically placed on the calendar for " +
      "the next 4 weeks — do NOT also create individual blocks for those days, that would duplicate them.",
    input_schema: {
      type: "object",
      properties: {
        title:            { type: "string" },
        category:         { type: "string", enum: ["deep", "body", "break", "admin"] },
        duration_minutes: { type: "integer", description: "Default length in minutes (used when a slot omits its own)" },
        slots: {
          type: "array",
          description: "Occurrences per recurrence day. E.g. three deep-work sessions = three slots.",
          items: {
            type: "object",
            properties: {
              start_time:       { type: "string", description: "HH:MM (24h)" },
              duration_minutes: { type: "integer", description: "Length of this occurrence in minutes" },
            },
            required: ["start_time"],
          },
        },
        recurrence_days: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 6 },
          description: "Days it recurs, 0=Sun … 6=Sat",
        },
        activity: { type: "string", description: "Short activity label" },
        detail:   { type: "string" },
      },
      required: ["title", "category", "duration_minutes"],
    },
  },
```

- [ ] **Step 3: Add the `update_saved_block` tool definition** (insert right after `create_saved_block` in the `tools` array)

```ts
  {
    name: "update_saved_block",
    description:
      "Update a saved block (routine template) by id — a PERMANENT routine change. Only include the " +
      "fields to change; `slots` REPLACES the full slot list. Changing slots or recurrence_days rebuilds " +
      "the calendar for the next 4 weeks; copies the user moved for a single day (customized) and " +
      "completed copies are preserved. For a single-day time change use update_block instead.",
    input_schema: {
      type: "object",
      properties: {
        template_id: { type: "string" },
        title:       { type: "string" },
        category:    { type: "string", enum: ["deep", "body", "break", "admin"] },
        activity:    { type: "string" },
        detail:      { type: "string" },
        recurrence_days: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 6 },
          description: "Days it recurs, 0=Sun … 6=Sat",
        },
        slots: {
          type: "array",
          description: "REPLACES the full slot list. Each slot is one occurrence per recurrence day.",
          items: {
            type: "object",
            properties: {
              start_time:       { type: "string", description: "HH:MM (24h)" },
              duration_minutes: { type: "integer" },
            },
            required: ["start_time", "duration_minutes"],
          },
        },
      },
      required: ["template_id"],
    },
  },
```

- [ ] **Step 4: Rewrite the `create_saved_block` handler** (lines 503-549)

```ts
    case "create_saved_block": {
      const category = String(input.category ?? "");
      if (!CATEGORIES.has(category)) {
        return { content: `Invalid category "${category}".`, isError: true };
      }
      const recurrence = Array.isArray(input.recurrence_days)
        ? (input.recurrence_days as unknown[]).map(Number).filter((n) => n >= 0 && n <= 6)
        : [];

      const defaultDuration = Number(input.duration_minutes ?? 60);
      const rawSlots = Array.isArray(input.slots) ? (input.slots as Record<string, unknown>[]) : [];
      const slots: TemplateSlot[] = rawSlots.map((s) => ({
        id:               crypto.randomUUID(),
        start_time:       String(s.start_time ?? ""),
        duration_minutes: Number(s.duration_minutes ?? defaultDuration),
      }));
      const slotErr = validateSlots(slots);
      if (slotErr) return { content: slotErr, isError: true };

      const { data, error } = await supabase
        .from("block_templates")
        .insert({
          user_id:          userId,
          title:            String(input.title ?? ""),
          category,
          duration_minutes: defaultDuration,
          slots,
          recurrence_days:  recurrence,
          activity:         input.activity ? String(input.activity) : null,
          detail:           input.detail ? String(input.detail) : null,
          position:         0,
        })
        .select()
        .single();

      if (error) return { content: `Failed to save block: ${error.message}`, isError: true };

      // If it's a recurring routine, fill the calendar the same way the Blocks
      // page does — one shared code path, so no duplicated one-off blocks.
      const template = data as BlockTemplate;
      let scheduled = 0;
      try {
        const created = await scheduleTemplateBlocks(supabase, template, userId);
        scheduled = created.length;
      } catch (e) {
        console.warn("scheduleTemplateBlocks failed:", e);
      }

      const change =
        scheduled > 0
          ? `Saved routine "${template.title}" and scheduled ${scheduled} block${scheduled === 1 ? "" : "s"}`
          : `Saved block "${template.title}"`;
      return {
        content: `Saved block template ${template.id}; scheduled ${scheduled} recurring block(s).`,
        change,
      };
    }
```

- [ ] **Step 5: Add the `update_saved_block` handler** (new case, right after `create_saved_block`)

```ts
    case "update_saved_block": {
      const templateId = String(input.template_id ?? "");
      const { data: existingTpl, error: tplErr } = await supabase
        .from("block_templates")
        .select("*")
        .eq("id", templateId)
        .eq("user_id", userId)
        .single<BlockTemplate>();
      if (tplErr || !existingTpl) {
        return { content: `Saved block ${templateId} not found.`, isError: true };
      }

      const updates: Record<string, unknown> = {};
      if (input.title !== undefined)    updates.title = String(input.title);
      if (input.activity !== undefined) updates.activity = String(input.activity);
      if (input.detail !== undefined)   updates.detail = String(input.detail);
      if (input.category !== undefined) {
        if (!CATEGORIES.has(String(input.category))) {
          return { content: `Invalid category "${input.category}".`, isError: true };
        }
        updates.category = String(input.category);
      }
      if (input.recurrence_days !== undefined) {
        updates.recurrence_days = Array.isArray(input.recurrence_days)
          ? (input.recurrence_days as unknown[]).map(Number).filter((n) => n >= 0 && n <= 6)
          : [];
      }
      if (input.slots !== undefined) {
        const rawSlots = Array.isArray(input.slots) ? (input.slots as Record<string, unknown>[]) : [];
        const slots: TemplateSlot[] = rawSlots.map((s) => ({
          id:               crypto.randomUUID(),
          start_time:       String(s.start_time ?? ""),
          duration_minutes: Number(s.duration_minutes ?? existingTpl.duration_minutes),
        }));
        const slotErr = validateSlots(slots);
        if (slotErr) return { content: slotErr, isError: true };
        updates.slots = slots;
      }
      if (Object.keys(updates).length === 0) {
        return { content: "No changes provided.", isError: true };
      }

      const { data: updatedRow, error: updErr } = await supabase
        .from("block_templates")
        .update(updates)
        .eq("id", templateId)
        .eq("user_id", userId)
        .select()
        .single();
      if (updErr || !updatedRow) {
        return { content: `Failed to update saved block: ${updErr?.message ?? "unknown error"}`, isError: true };
      }

      const updatedTpl = updatedRow as BlockTemplate;
      const { deletedIds, created } = await rebuildTemplateBlocks(supabase, updatedTpl, userId);
      return {
        content:
          `Updated saved block ${templateId}; rebuilt upcoming calendar ` +
          `(removed ${deletedIds.length}, added ${created.length}). ` +
          `Customized and completed copies were preserved as-is.`,
        change: `Updated routine "${updatedTpl.title}"`,
      };
    }
```

- [ ] **Step 6: Tag one-off edits in `update_block` and `update_blocks`**

In `update_block`, after the `updates.done` line (route.ts line ~337) and before the category check, add:

```ts
      // A one-off time change to a template copy tags it so template rebuilds
      // leave it alone from now on.
      const movesTimes =
        updates.day !== undefined || updates.start_time !== undefined || updates.end_time !== undefined;
      if (existing.template_id && movesTimes) updates.customized = true;
```

In `update_blocks`, inside the per-item loop, after its `if (u.done !== undefined)` line, add the same four lines (referencing that loop's `existing` and `updates` variables).

- [ ] **Step 7: Update the system prompt**

In `buildSystemPrompt`, replace the three RECURRING bullets (route.ts lines 254-258, from `- RECURRING routine vs ONE-OFF event` through the one-off-event bullet) with:

```
- RECURRING routine vs ONE-OFF event — choose the right tool:
  • Recurring ("every day", "daily", "each weekday", "on Mondays and Wednesdays", "my usual morning routine"): use create_saved_block. Set recurrence_days to the days it repeats, plus one slot per daily occurrence (start_time + duration_minutes). The saved block automatically fills the calendar for the next 4 weeks — do NOT also create individual one-off blocks for those days, that would duplicate them.
  • A routine that happens SEVERAL times a day (e.g. three deep-work sessions, two breaks) is ONE saved block with SEVERAL slots — never several saved blocks with numbered or renamed titles. All copies share the block's title.
  • Day encoding for recurrence_days: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday. "weekdays" = [1,2,3,4,5]; "every day"/"daily" = [0,1,2,3,4,5,6].
  • A recurring saved block MUST include recurrence_days and at least one slot, or it won't appear on the calendar.
  • One-off event ("dentist Thursday at 3pm"): use create_block for a single block, as before.
- ONE-DAY change vs PERMANENT routine change:
  • "Push my deep work back an hour today" → update_block / update_blocks on that day's blocks. This marks them customized: they stop following the saved block from then on.
  • "Move my deep work to mornings from now on" → update_saved_block. It rebuilds upcoming days but preserves copies the user customized or completed.
  • If the request is ambiguous about one day vs always, ask before changing anything.
```

Also update the `source` explainer line (route.ts line 235) to mention the tag — replace it with:

```
Each block has a "source": "manual" = the user created it by hand, "ai" = you created it, "template" = generated from a recurring saved block. Treat any source that is not "ai" or "template" as a manual block. A block with "customized": true is a template copy the user deliberately moved for that day — treat it like a manual block and do not "fix" its times back to the template.
```

- [ ] **Step 8: Verify build + tests**

Run: `npm test` then `npm run build`
Expected: pass/compile. `grep -n "default_start_time" src/app/api/agent/route.ts` returns nothing.

- [ ] **Step 9: Commit**

```powershell
git add src/app/api/agent/route.ts
git commit -m @'
Agent: slot-aware saved blocks, update_saved_block tool, customized tagging

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 7: Retire default_start_time, apply migration, end-to-end verification

**Files:**
- Modify: `src/lib/types.ts` (drop `default_start_time`, make `slots` required)
- Modify: `src/lib/mock-data.ts` (drop the `default_start_time` fields)

**Interfaces:**
- Produces: final types — `BlockTemplate.slots: TemplateSlot[]` (required), no `default_start_time` anywhere in `src/`.

- [ ] **Step 1: Tighten the types**

In `src/lib/types.ts` `BlockTemplate`: delete the `default_start_time` line entirely, and change the slots line to:

```ts
  slots: TemplateSlot[];     // occurrences per recurrence day; every copy shares the title
```

- [ ] **Step 2: Clean mock data**

In `src/lib/mock-data.ts:59-63`, delete the five `default_start_time: "…",` fields (keep the `slots` arrays added in Task 2).

- [ ] **Step 3: Sweep for stragglers**

Run: `grep -rn "default_start_time" src/`
Expected: no output. (Tasks 4-6 already cleaned BlocksView, Timeline, and the agent route; the test file's `tpl()` helper set it to `null` — remove that property from the helper too.)

Remove `default_start_time: null,` from the `tpl()` helper in `src/lib/scheduleTemplate.test.ts`.

- [ ] **Step 4: Full verification**

Run: `npm test` then `npm run build`
Expected: all tests pass; build compiles clean.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/types.ts src/lib/mock-data.ts src/lib/scheduleTemplate.test.ts
git commit -m @'
Retire default_start_time; slots is now the only template time source

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

- [ ] **Step 6: Apply the migration to Supabase**

Run: `npx supabase db push` (or paste `supabase/migrations/20260715000001_template_slots.sql` into the Supabase dashboard SQL editor if the CLI isn't linked).
Expected: migration applies without error; existing templates show a one-element `slots` array; existing template blocks have `slot_id` backfilled.

- [ ] **Step 7: End-to-end manual QA (signed-in app)**

Run `npm run dev` and verify against the running app:

1. Edit an existing saved block → the Times list shows its one migrated slot.
2. Add a second time to a "Deep Work"-style block → both copies appear on each repeat day, same title, correct times.
3. Move ONE copy on the Today page → violet "edited" dot appears.
4. Edit the saved block's slot times again → the moved copy stays put; no duplicate appears beside it; other copies follow the new times.
5. Agent chat: "push today's deep work back an hour" → only today's copies move (and gain the dot); "make my deep work 9am and 2pm every weekday" → the saved block's slots change, upcoming days rebuild.
6. Mark a copy done, edit the template → the done copy survives.

- [ ] **Step 8: Push**

```powershell
git push
```
Expected: all task commits land on `origin/master`.

---

## Self-review notes (already applied)

- Spec coverage: schema/migration (Task 2), stamping + ID dedupe + rebuild rules (Task 3), UI slot editor/card/add-to-day/edited dot (Tasks 4-5), agent tools + prompt (Task 6), validation (Tasks 3/6), guest parity (Tasks 4-5), testing (Tasks 1/3, QA in 7), template deletion preserving customized/done (Task 4 Step 5).
- Deliberate deviations from spec wording, both noted inline: Today-page quick-add places one block (first slot) rather than stamping all slots — the Blocks page owns full-day stamping; `ScheduleBlock.customized` is optional in TS (DB default supplies it; guest rows treat undefined as false).
- Mid-plan caveat: between Tasks 3 and 4, newly created templates won't auto-schedule (UI still writes `default_start_time`, planner reads `slots`). Flagged in Task 3 Step 5; do not deploy mid-plan.
