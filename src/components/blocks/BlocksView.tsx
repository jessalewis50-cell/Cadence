"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase-browser";
import { to12h, addMinutes, toDateStr, timeToMinutes } from "@/lib/time";
import {
  scheduleTemplateBlocks, matchingDatesForTemplate,
  planTemplateStamping, planTemplateRebuild, rebuildTemplateBlocks,
  validateSlots,
} from "@/lib/scheduleTemplate";
import { CAT_COLORS, CAT_LABELS } from "@/lib/constants";
import TimeField from "@/components/ui/TimeField";
import type { BlockTemplate, ScheduleBlock, Category, TemplateSlot } from "@/lib/types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL  = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getWeekDays(offsetWeeks: number): Date[] {
  const today  = new Date();
  const dayNum = today.getDay();
  const diff   = dayNum === 0 ? -6 : 1 - dayNum;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff + offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function groupByDay(blocks: ScheduleBlock[]): Record<string, ScheduleBlock[]> {
  const map: Record<string, ScheduleBlock[]> = {};
  for (const b of blocks) {
    (map[b.day] ??= []).push(b);
  }
  return map;
}

/** Next available start time for a day: latest end_time or "09:00" */
function nextStartTime(dayBlocks: ScheduleBlock[]): string {
  if (dayBlocks.length === 0) return "09:00";
  const sorted = [...dayBlocks].sort((a, b) => a.end_time.localeCompare(b.end_time));
  return sorted[sorted.length - 1].end_time;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  initialTemplates: BlockTemplate[];
  initialWeekBlocks: ScheduleBlock[];
  isGuest: boolean;
  userId: string | null;
}

// ── Template form state ───────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export default function BlocksView({ initialTemplates, initialWeekBlocks, isGuest, userId }: Props) {
  const supabase = createClient();

  // Templates
  const [templates, setTemplates] = useState<BlockTemplate[]>(initialTemplates);
  const [showTplForm, setShowTplForm] = useState(false);
  const [tplDraft, setTplDraft]       = useState<TplDraft>(EMPTY_TPL);
  const [tplSaving, setTplSaving]     = useState(false);
  const [tplError, setTplError]       = useState<string | null>(null);
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [editTplDraft, setEditTplDraft] = useState<TplDraft>(EMPTY_TPL);
  const [editTplSaving, setEditTplSaving] = useState(false);
  const [editTplError, setEditTplError]   = useState<string | null>(null);

  // Schedule builder
  const [weekOffset, setWeekOffset]   = useState(0);
  const weekDays = getWeekDays(weekOffset);
  const [dayBlocks, setDayBlocks]     = useState<Record<string, ScheduleBlock[]>>(groupByDay(initialWeekBlocks));
  const [loadingWeek, setLoadingWeek] = useState(false);

  // Inline "add block to day" state: { dayStr, mode: 'template'|'custom' }
  const [addingTo, setAddingTo] = useState<{ dayStr: string; mode: "template" | "custom" } | null>(null);
  const [customDraft, setCustomDraft] = useState({ title: "", start_time: "", end_time: "", category: "deep" as Category, detail: "" });

  const todayStr = toDateStr(new Date());

  // ── Week fetch on offset change ────────────────────────────────────────────

  useEffect(() => {
    if (isGuest) return;
    setLoadingWeek(true);
    const start = toDateStr(weekDays[0]);
    const end   = toDateStr(weekDays[6]);
    supabase
      .from("schedule_blocks")
      .select("*")
      .gte("day", start)
      .lte("day", end)
      .order("start_time")
      .then(({ data }) => {
        setDayBlocks(groupByDay(data ?? []));
        setLoadingWeek(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset, isGuest]);

  // ── Template CRUD ──────────────────────────────────────────────────────────

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

  async function deleteTemplate(id: string) {
    const tpl = templates.find(t => t.id === id);
    if (!tpl) return;

    const repeating = tpl.recurrence_days.length > 0;
    const message = repeating
      ? `Delete '${tpl.title}'? Upcoming copies are removed from your calendar, except ones you've moved or completed. Past days will be kept. This can't be undone.`
      : `Delete '${tpl.title}'? This can't be undone.`;
    if (!window.confirm(message)) return;

    // Remove the template itself.
    setTemplates(prev => prev.filter(t => t.id !== id));

    // Remove this template's upcoming calendar copies from local state so the
    // week view updates immediately. Matched by template_id on today-or-later
    // days; past days, customized/completed copies, and other templates'
    // blocks stay.
    setDayBlocks(prev => {
      const next: Record<string, ScheduleBlock[]> = {};
      for (const [day, blocks] of Object.entries(prev)) {
        next[day] = day >= todayStr
          ? blocks.filter(b => b.template_id !== id || b.customized || b.done)
          : blocks;
      }
      return next;
    });

    if (!isGuest) {
      // Delete the copies BEFORE the template: the template FK is ON DELETE
      // SET NULL, so deleting the template first nulls template_id on every
      // copy and this delete would match nothing, orphaning the copies.
      // Scope: only this template's upcoming, untagged copies — never past
      // history, never customized/completed copies, never other sources.
      await supabase
        .from("schedule_blocks")
        .delete()
        .eq("user_id", userId!)
        .eq("template_id", id)
        .eq("customized", false)
        .eq("done", false)
        .gte("day", todayStr);
      await supabase.from("block_templates").delete().eq("id", id);
    }
  }

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

  // ── Add template to a day ─────────────────────────────────────────────────

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

  // ── Add custom block to a day ─────────────────────────────────────────────

  async function addCustomToDay(e: React.FormEvent, dayStr: string) {
    e.preventDefault();
    const existing = dayBlocks[dayStr] ?? [];
    const maxPos   = existing.reduce((m, b) => Math.max(m, b.position), -1);
    const newBlock = {
      user_id: userId ?? "guest",
      day: dayStr,
      start_time: customDraft.start_time,
      end_time: customDraft.end_time,
      title: customDraft.title,
      category: customDraft.category,
      detail: customDraft.detail.trim() || null,
      position: maxPos + 1,
      done: false,
    };

    if (!isGuest) {
      const { data, error } = await supabase
        .from("schedule_blocks").insert(newBlock).select().single();
      if (!error && data) {
        setDayBlocks(prev => ({ ...prev, [dayStr]: [...(prev[dayStr] ?? []), data as ScheduleBlock].sort((a, b) => a.start_time.localeCompare(b.start_time)) }));
      }
    } else {
      const local: ScheduleBlock = { ...newBlock, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      setDayBlocks(prev => ({ ...prev, [dayStr]: [...(prev[dayStr] ?? []), local].sort((a, b) => a.start_time.localeCompare(b.start_time)) }));
    }
    setAddingTo(null);
    setCustomDraft({ title: "", start_time: "", end_time: "", category: "deep", detail: "" });
  }

  async function removeBlock(id: string, dayStr: string) {
    setDayBlocks(prev => ({ ...prev, [dayStr]: (prev[dayStr] ?? []).filter(b => b.id !== id) }));
    if (!isGuest) await supabase.from("schedule_blocks").delete().eq("id", id);
  }

  // ── Auto-schedule a template across 4 weeks ───────────────────────────────
  // Called whenever a template is created or updated with recurrence_days set.

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

  // ── "Schedule this week" — apply recurring templates ─────────────────────

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

  // ── Week label ─────────────────────────────────────────────────────────────

  const weekLabel = weekOffset === 0
    ? "This week"
    : weekOffset === 1
    ? "Next week"
    : weekOffset === -1
    ? "Last week"
    : `${weekDays[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">

      {/* ── Section 1: Template Library ─────────────────────────────── */}
      <section className="bg-panel border border-line rounded-[18px] p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-grotesk font-semibold text-[15px] text-txt">Saved blocks</h2>
            <p className="text-muted text-[12.5px] mt-0.5">Reusable templates you can drop into any day</p>
          </div>
          <button
            onClick={() => setShowTplForm(v => !v)}
            className="px-3 py-1.5 text-sm text-white bg-violet rounded-lg hover:bg-[#6a59f5] transition-colors"
          >
            + New block
          </button>
        </div>

        {/* New template form */}
        {showTplForm && (
          <form onSubmit={saveTemplate} className="mb-5 border border-line rounded-[14px] p-4 flex flex-col gap-3">
            <input
              type="text" required placeholder="Block title…" value={tplDraft.title}
              onChange={e => setTplDraft(d => ({ ...d, title: e.target.value }))}
              className="w-full bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors"
            />
            <textarea
              placeholder="Notes (optional)"
              value={tplDraft.detail}
              rows={2}
              onChange={e => setTplDraft(d => ({ ...d, detail: e.target.value }))}
              className="w-full bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors resize-none"
            />

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

            <div>
              <label className="text-[11.5px] text-muted block mb-2">Repeat on</label>
              <div className="flex gap-1.5">
                {[1,2,3,4,5,6,0].map(n => {
                  const on = tplDraft.recurrence_days.includes(n);
                  return (
                    <button
                      key={n} type="button"
                      onClick={() => setTplDraft(d => ({
                        ...d,
                        recurrence_days: on ? d.recurrence_days.filter(x => x !== n) : [...d.recurrence_days, n],
                      }))}
                      className={`w-8 h-8 rounded-lg text-[11px] font-semibold transition-colors ${on ? "bg-violet text-white" : "bg-ink border border-line text-muted hover:border-violet"}`}
                    >
                      {DAY_NAMES[n][0]}
                    </button>
                  );
                })}
              </div>
            </div>

            {tplError && (
              <p className="text-[12px] text-magenta">{tplError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowTplForm(false); setTplDraft(EMPTY_TPL); setTplError(null); }}
                className="px-3 py-1.5 text-sm text-muted border border-line rounded-lg hover:border-violet transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={tplSaving}
                className="px-3 py-1.5 text-sm text-white bg-violet rounded-lg hover:bg-[#6a59f5] transition-colors disabled:opacity-50">
                {tplSaving ? "Saving…" : "Save template"}
              </button>
            </div>
          </form>
        )}

        {templates.length === 0 ? (
          <p className="text-center text-faint text-[13px] py-6">No saved blocks yet — create your first one above.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {templates.map(tpl => {
              if (editingTplId === tpl.id) {
                return (
                  <form key={tpl.id} onSubmit={updateTemplate}
                    className="col-span-2 sm:col-span-3 border border-violet/40 rounded-[14px] p-4 flex flex-col gap-3 bg-violet/5">
                    <input
                      type="text" required placeholder="Block title…" value={editTplDraft.title}
                      onChange={e => setEditTplDraft(d => ({ ...d, title: e.target.value }))}
                      className="w-full bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors"
                    />
                    <textarea
                      placeholder="Notes (optional)" value={editTplDraft.detail} rows={2}
                      onChange={e => setEditTplDraft(d => ({ ...d, detail: e.target.value }))}
                      className="w-full bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors resize-none"
                    />
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
                    <div>
                      <label className="text-[11.5px] text-muted block mb-2">Repeat on</label>
                      <div className="flex gap-1.5">
                        {[1,2,3,4,5,6,0].map(n => {
                          const on = editTplDraft.recurrence_days.includes(n);
                          return (
                            <button key={n} type="button"
                              onClick={() => setEditTplDraft(d => ({
                                ...d,
                                recurrence_days: on ? d.recurrence_days.filter(x => x !== n) : [...d.recurrence_days, n],
                              }))}
                              className={`w-8 h-8 rounded-lg text-[11px] font-semibold transition-colors ${on ? "bg-violet text-white" : "bg-ink border border-line text-muted hover:border-violet"}`}
                            >{DAY_NAMES[n][0]}</button>
                          );
                        })}
                      </div>
                    </div>
                    {editTplError && <p className="text-[12px] text-magenta">{editTplError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => setEditingTplId(null)}
                        className="px-3 py-1.5 text-sm text-muted border border-line rounded-lg hover:border-violet transition-colors">
                        Cancel
                      </button>
                      <button type="submit" disabled={editTplSaving}
                        className="px-3 py-1.5 text-sm text-white bg-violet rounded-lg hover:bg-[#6a59f5] transition-colors disabled:opacity-50">
                        {editTplSaving ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </form>
                );
              }

              return (
                <div key={tpl.id} className="bg-ink border border-line rounded-[14px] p-3.5 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CAT_COLORS[tpl.category] }} />
                      <span className="font-grotesk font-semibold text-[13.5px] text-txt truncate">{tpl.title}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => startEditTpl(tpl)}
                        className="text-faint hover:text-txt transition-colors" title="Edit">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button onClick={() => deleteTemplate(tpl.id)}
                        className="text-faint hover:text-magenta transition-colors" title="Delete">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6 6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[11.5px] text-muted flex-wrap">
                    {(tpl.slots ?? []).length === 0 ? (
                      <span>{tpl.duration_minutes} min</span>
                    ) : (
                      <span>
                        {(tpl.slots ?? []).map(s => `${to12h(s.start_time)} · ${s.duration_minutes}m`).join(", ")}
                      </span>
                    )}
                  </div>

                  {tpl.detail && (
                    <p className="text-[11.5px] text-faint line-clamp-2">{tpl.detail}</p>
                  )}

                  {tpl.recurrence_days.length > 0 && (
                    <div className="flex gap-1">
                      {[1,2,3,4,5,6,0].map(n => (
                        <span key={n}
                          className={`w-5 h-5 rounded text-[9px] font-bold grid place-items-center ${tpl.recurrence_days.includes(n) ? "bg-violet/20 text-violet" : "bg-ink text-faint"}`}>
                          {DAY_NAMES[n][0]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Section 2: Schedule Builder ──────────────────────────────── */}
      <section className="bg-panel border border-line rounded-[18px] p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="font-grotesk font-semibold text-[15px] text-txt">Schedule builder</h2>
            <p className="text-muted text-[12.5px] mt-0.5">
              Plan your week · blocks added here appear on the Today page
            </p>
          </div>
          <div className="flex items-center gap-2">
            {templates.some(t => t.recurrence_days.length > 0) && (
              <button
                onClick={scheduleWeek}
                title="Auto-fill recurring templates for this week"
                className="px-3 py-1.5 text-[12.5px] text-violet border border-violet/30 rounded-lg hover:bg-violet/10 transition-colors"
              >
                Schedule this week
              </button>
            )}
            <div className="flex items-center gap-1 bg-ink border border-line rounded-lg px-1 py-1">
              <button onClick={() => setWeekOffset(w => w - 1)}
                className="w-7 h-7 rounded grid place-items-center text-muted hover:text-txt transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <button onClick={() => setWeekOffset(0)}
                className="px-2 text-[12.5px] font-medium text-txt min-w-[90px] text-center">
                {weekLabel}
              </button>
              <button onClick={() => setWeekOffset(w => w + 1)}
                className="w-7 h-7 rounded grid place-items-center text-muted hover:text-txt transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        </div>

        {loadingWeek ? (
          <div className="h-40 grid place-items-center text-faint text-sm">Loading…</div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map(day => {
              const dayStr   = toDateStr(day);
              const isToday  = dayStr === todayStr;
              const blocks   = (dayBlocks[dayStr] ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time));
              const isAddingHere = addingTo?.dayStr === dayStr;

              return (
                <div key={dayStr}
                  className={`flex flex-col rounded-[14px] border p-2.5 min-h-[340px] transition-colors ${isToday ? "border-violet/40 bg-violet/5" : "border-line"}`}>

                  {/* Day header */}
                  <div className="mb-2 text-center">
                    <p className="text-[10.5px] text-muted font-medium uppercase tracking-wide">{DAY_NAMES[day.getDay()]}</p>
                    <p className={`font-grotesk font-semibold text-[17px] ${isToday ? "text-violet" : "text-txt"}`}>
                      {day.getDate()}
                    </p>
                  </div>

                  {/* Blocks */}
                  <div className="flex flex-col gap-1 flex-1">
                    {blocks.map(b => (
                      <div key={b.id}
                        className={`group flex items-start gap-1.5 px-1.5 py-1 rounded-[8px] border border-transparent hover:border-line transition-colors ${b.done ? "opacity-40" : ""}`}>
                        <span className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: CAT_COLORS[b.category] }} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[11px] font-medium text-txt leading-tight truncate ${b.done ? "line-through" : ""}`}>{b.title}</p>
                          <p className="text-[10px] text-faint">
                            {to12h(b.start_time)}
                            {b.customized && b.template_id && (
                              <span
                                className="w-1 h-1 rounded-full bg-violet inline-block ml-1 align-middle flex-shrink-0"
                                title="Moved for this day — won't follow template changes."
                              />
                            )}
                          </p>
                        </div>
                        <button onClick={() => removeBlock(b.id, dayStr)}
                          className="opacity-0 group-hover:opacity-100 text-faint hover:text-magenta transition-all flex-shrink-0">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M18 6 6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add controls */}
                  {isAddingHere ? (
                    <div className="mt-1">
                      {addingTo.mode === "template" ? (
                        <div className="flex flex-col gap-1">
                          {templates.length === 0 ? (
                            <p className="text-[10px] text-faint text-center py-1">No templates yet</p>
                          ) : (
                            templates.map(tpl => (
                              <button key={tpl.id}
                                onClick={() => addTemplateToDay(tpl, dayStr)}
                                className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg hover:bg-panel-2 transition-colors text-left w-full">
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: CAT_COLORS[tpl.category] }} />
                                <span className="text-[11px] text-txt truncate">{tpl.title}</span>
                              </button>
                            ))
                          )}
                          <button onClick={() => setAddingTo({ dayStr, mode: "custom" })}
                            className="text-[10.5px] text-violet hover:underline mt-0.5">
                            Custom block →
                          </button>
                          <button onClick={() => setAddingTo(null)}
                            className="text-[10.5px] text-faint hover:text-txt mt-0.5">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <form onSubmit={e => addCustomToDay(e, dayStr)} className="flex flex-col gap-1.5">
                          <input
                            type="text" required autoFocus placeholder="Title…"
                            value={customDraft.title}
                            onChange={e => setCustomDraft(d => ({ ...d, title: e.target.value }))}
                            className="w-full bg-ink border border-line rounded-md px-1.5 py-1 text-[11px] text-txt placeholder:text-faint outline-none focus:border-violet"
                          />
                          <textarea
                            placeholder="Notes (optional)"
                            value={customDraft.detail}
                            rows={2}
                            onChange={e => setCustomDraft(d => ({ ...d, detail: e.target.value }))}
                            className="w-full bg-ink border border-line rounded-md px-1.5 py-1 text-[11px] text-txt placeholder:text-faint outline-none focus:border-violet resize-none"
                          />
                          <div className="flex gap-1">
                            <TimeField value={customDraft.start_time} onChange={v => setCustomDraft(d => ({ ...d, start_time: v }))} placeholder="Start" />
                            <TimeField value={customDraft.end_time}   onChange={v => setCustomDraft(d => ({ ...d, end_time: v }))}   placeholder="End" />
                          </div>
                          <div className="flex gap-1 mt-0.5">
                            <button type="submit"
                              className="flex-1 py-1 text-[10.5px] text-white bg-violet rounded-md hover:bg-[#6a59f5] transition-colors">
                              Add
                            </button>
                            <button type="button" onClick={() => setAddingTo(null)}
                              className="flex-1 py-1 text-[10.5px] text-muted border border-line rounded-md hover:border-violet transition-colors">
                              Cancel
                            </button>
                          </div>
                          {templates.length > 0 && (
                            <button type="button" onClick={() => setAddingTo({ dayStr, mode: "template" })}
                              className="text-[10.5px] text-violet hover:underline">
                              ← From template
                            </button>
                          )}
                        </form>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingTo({ dayStr, mode: templates.length > 0 ? "template" : "custom" }); setCustomDraft(d => ({ ...d, start_time: nextStartTime(blocks), end_time: "" })); }}
                      className="mt-1 w-full py-1 text-[11px] text-faint border border-dashed border-line rounded-[8px] hover:border-violet hover:text-violet transition-colors"
                    >
                      + Add
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-faint mt-4 text-center">
          Blocks added here are saved to your schedule and appear on the Today page automatically.
          <span className="mx-1">·</span>
          <button onClick={scheduleWeek} className="text-violet hover:underline">
            Schedule recurring blocks
          </button> fills this week from your saved templates.
        </p>
      </section>
    </div>
  );
}
