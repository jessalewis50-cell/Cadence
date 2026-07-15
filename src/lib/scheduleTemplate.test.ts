import { describe, it, expect } from "vitest";
import { validateSlots, planTemplateStamping, planTemplateRebuild, reconcileSlotIds } from "@/lib/scheduleTemplate";
import type { BlockTemplate, TemplateSlot } from "@/lib/types";

const slot = (id: string, start: string, dur = 60): TemplateSlot =>
  ({ id, start_time: start, duration_minutes: dur });

const tpl = (slots: TemplateSlot[], over: Partial<BlockTemplate> = {}): BlockTemplate => ({
  id: "tpl-1", user_id: "u1", title: "Deep Work", category: "deep",
  activity: "deep work", duration_minutes: 60,
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

describe("reconcileSlotIds", () => {
  it("reuses the existing id when start_time matches, even if duration changed", () => {
    const existing = [slot("s1", "09:00", 60)];
    const result = reconcileSlotIds(existing, [{ start_time: "09:00", duration_minutes: 90 }]);
    expect(result).toEqual([{ id: "s1", start_time: "09:00", duration_minutes: 90 }]);
  });

  it("mints a fresh id for a start_time not present in the existing list", () => {
    const existing = [slot("s1", "09:00", 60)];
    const result = reconcileSlotIds(existing, [{ start_time: "13:00", duration_minutes: 30 }]);
    expect(result).toHaveLength(1);
    expect(result[0].id).not.toBe("s1");
    expect(result[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result[0]).toMatchObject({ start_time: "13:00", duration_minutes: 30 });
  });

  it("mints fresh ids for all slots when the existing list is empty", () => {
    const result = reconcileSlotIds([], [
      { start_time: "09:00", duration_minutes: 60 },
      { start_time: "13:00", duration_minutes: 30 },
    ]);
    expect(result).toHaveLength(2);
    expect(new Set(result.map(r => r.id)).size).toBe(2);
  });
});
