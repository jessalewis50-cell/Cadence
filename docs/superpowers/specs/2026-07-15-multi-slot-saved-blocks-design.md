# Multi-slot saved blocks — design

**Date:** 2026-07-15
**Status:** Approved design, pending implementation plan

## Problem

A saved block (`block_templates` row) holds exactly one `default_start_time` and one
`duration_minutes`, so a routine that occurs several times a day — three deep-work
sessions, multiple breaks — requires separate saved blocks with distinct names
("Deep Work 1", "Deep Work 2", "Lunch break"). Stamping also dedupes calendar copies
by **title**, which makes multiple same-titled blocks on one day impossible.

## Goal

One saved block owns a **list of time slots** and appears that many times on each
recurrence day, every copy sharing the block's title. Individual copies stay
moveable day-to-day (by the user or the AI agent) without renaming, and the agent
can make both one-off (single day) and permanent (template-level) time changes.

## Decisions made during brainstorming

- Slots vary by **start time and duration only**. All copies share the template's
  title — no auto-numbering, no per-slot labels.
- **One slot list applies to every recurrence day** (no per-weekday slot variation).
  Day-specific differences are made on the calendar copies.
- One-off edits **tag the copy** (`customized = true`); template rebuilds
  **preserve tagged copies** rather than overwriting them.
- Storage is a **JSONB `slots` column** on `block_templates` (Approach A), not a
  child table. Rationale: templates are always fetched and edited as single rows by
  a single user; JSONB adds no new queries, joins, or RLS policies. The `customized`
  tag makes every dangling-slot state well-defined, so the lack of a slot-level FK
  costs nothing. `template_id` remains a real FK.

## 1. Schema & data model

`block_templates` gains:

```sql
slots jsonb not null default '[]'
-- [{"id":"<uuid>","start_time":"HH:MM","duration_minutes":<int>}, ...]
```

- Slot `id` is a UUID generated when the slot is added and stable for the slot's
  lifetime; stamped copies reference it.
- `default_start_time` is **dropped** (after migration below).
- `duration_minutes` is **kept**, redefined as the default duration used when
  adding a new slot in the UI or quick-dropping a slot-less template onto a day.

`schedule_blocks` gains:

```sql
slot_id    uuid    null,                      -- slot within the template (no FK; points into JSONB)
customized boolean not null default false     -- one-off tag
```

### Migration (single SQL file, in order)

1. Add `block_templates.slots`, `schedule_blocks.slot_id`, `schedule_blocks.customized`.
2. For each template with a non-null `default_start_time`, set
   `slots = [{id: gen_random_uuid(), start_time: default_start_time, duration_minutes}]`.
3. Backfill `schedule_blocks.slot_id` from the owning template's single migrated
   slot (join on `template_id`; unambiguous because step 2 creates exactly one slot
   per template). Existing blocks stay `customized = false`, so the next template
   edit rebuilds them — identical to current behavior.
4. Drop `block_templates.default_start_time`.

### TypeScript (`src/lib/types.ts`)

```ts
export interface TemplateSlot {
  id: string;
  start_time: string;       // "HH:MM"
  duration_minutes: number;
}
// BlockTemplate: + slots: TemplateSlot[];  – default_start_time
// ScheduleBlock: + slot_id?: string | null; + customized: boolean
```

## 2. Stamping & rebuild rules

**Stamping** (`scheduleTemplateBlocks` in `src/lib/scheduleTemplate.ts` — shared by
the Blocks page and the agent route): for each recurrence day in the next 4 weeks ×
each slot, insert one copy carrying the template's title/category/activity/detail,
the slot's `start_time`/`end_time`, `source: "template"`, `template_id`, `slot_id`,
`customized: false`. A template with no slots stamps nothing.

**Dedupe is by IDs, not titles:** skip a `(day, slot_id)` pair only if a copy with
the same `template_id + slot_id + day` already exists. (Replaces today's
same-title-same-day check; this is what permits multiple same-titled blocks per day.)

**Setting the tag:** any change to an individual stamped copy's times — UI edit or
agent `update_block`/`update_blocks` — sets `customized = true` on that row only.

**Rebuild** (on any change to a template's slots, recurrence days, or details):

1. Delete the template's copies for today onward **except** rows with
   `customized = true` or `done = true` (a completed session never vanishes mid-day).
2. Re-stamp all slots × recurrence days, skipping `(day, slot_id)` pairs that
   survived step 1 — no duplicates beside a moved or completed copy.
3. Surviving copies whose `slot_id` no longer exists in the template remain as-is
   (self-governing). Untagged copies of deleted slots are removed by step 1.

**Template deletion:** upcoming copies deleted by `template_id`, **except**
customized or done ones, which are preserved (hand-placed or already completed);
past copies kept with `template_id` nulled by the existing `ON DELETE SET NULL`.

## 3. UI (`src/components/blocks/BlocksView.tsx` + day views)

**Create/edit saved-block form** — the single start-time field becomes a slot list:

```
Times
  09:00   90 min   ✕
  13:00   90 min   ✕
  16:00   60 min   ✕
  + Add time
```

- Each row: existing `TimeField` for start + duration input + remove button.
- "+ Add time" appends a row pre-filled with the template's default duration.
- Rows kept sorted by start time. Title/category/activity/recurrence/detail
  fields unchanged.

**Saved-block card:** compact slot summary, e.g.
`Mon–Fri · 09:00·90m, 13:00·90m, 16:00·60m`.

**Add-to-day flow:** dropping a template on a day stamps **all** its slots for that
day (same ID-based dedupe). A slot-less template keeps current behavior: one block
at the next free time using the default duration.

**Day/week views:** copies are ordinary `schedule_blocks` rows — rendering, focus
timer, and done-toggling work unchanged. Two additions:

- Saving a time edit on a template-stamped block sets `customized = true`.
- A customized copy shows a subtle "edited" dot with tooltip
  *"Moved for this day — won't follow template changes."*

## 4. Agent tools (`src/app/api/agent/route.ts`)

- **`create_saved_block`:** `default_start_time` param replaced by
  `slots: [{start_time, duration_minutes}]`; server generates slot UUIDs.
  Auto-stamping after creation unchanged.
- **`update_saved_block` (new):** takes template ID plus any of title, category,
  activity, slots, recurrence_days, detail; persists and runs the Section 2
  rebuild. This is the permanent-change path (previously impossible — the agent
  had no template-edit tool).
- **`update_block` / `update_blocks`:** unchanged signatures; when the target has
  a `template_id` and its times change, the server sets `customized = true`.
  This is the one-off path.
- **Context given to the model:** blocks include `slot_id` and `customized`;
  the SAVED BLOCKS listing includes each template's `slots`.
- **System-prompt rule:** single-day requests ("push deep work back an hour
  today") → `update_block`, never the template; routine requests ("move deep work
  to mornings from now on") → `update_saved_block`; when ambiguous, ask the user.
- **Validation** (existing error-string pattern): unknown template ID; slot times
  not valid `HH:MM`; non-positive durations; overlapping slots within one
  template. Rejected with a message, nothing written.

## Error handling & edge cases

- Slot deleted while a customized copy exists → copy persists untouched (by design).
- Template deleted → customized + past copies persist; upcoming untagged copies removed.
- Guest mode (no Supabase user) keeps parity: same logic against local state in
  `BlocksView`, tags included.
- Overlapping slots are rejected at the template level (UI validation + agent
  validation); overlaps between different templates remain allowed, as today.

## Testing

- Extract stamping matrix and rebuild diff (delete set / skip set / insert set)
  as pure functions in `scheduleTemplate.ts`; unit-test without Supabase:
  multi-slot stamping, ID-based dedupe, customized/done preservation,
  deleted-slot cleanup, migration-shaped single-slot templates.
- End-to-end pass in the running app: create multi-slot block → verify stamped
  day; move one copy → edit template → verify moved copy survives and no
  duplicate appears; agent one-off vs permanent requests hit the right tool.

## Out of scope

- Per-slot labels or auto-numbering (explicitly declined).
- Per-weekday slot variation.
- Migrating slots to a child table (nothing in this design blocks it later).
