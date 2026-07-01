"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";
import { to12h, addMinutes } from "@/lib/time";
import { CAT_COLORS, CAT_LABELS } from "@/lib/constants";
import TimeField from "@/components/ui/TimeField";
import type { ScheduleBlock, BlockTemplate, Category } from "@/lib/types";

interface Props {
  initialBlocks:   ScheduleBlock[];
  activeBlockId:   string | null;
  onFocus:         (id: string) => void;
  onBlocksChange?: (blocks: ScheduleBlock[]) => void;
  isGuest:         boolean;
  userId:          string | null;
}

interface Draft {
  start_time: string;
  end_time: string;
  title: string;
  category: Category;
  detail: string;
}

const EMPTY: Draft = { start_time: "", end_time: "", title: "", category: "deep", detail: "" };

type AddMode = null | "picker" | "saved" | "new";

function durationMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function nextStart(blocks: ScheduleBlock[]): string {
  if (blocks.length === 0) return "09:00";
  return [...blocks].sort((a, b) => a.end_time.localeCompare(b.end_time)).pop()!.end_time;
}

export default function Timeline({ initialBlocks, activeBlockId, onFocus, onBlocksChange, isGuest, userId }: Props) {
  const [blocks, setBlocks]       = useState<ScheduleBlock[]>(initialBlocks);
  const [addMode, setAddMode]     = useState<AddMode>(null);
  const [draft, setDraft]         = useState<Draft>(EMPTY);
  const [saving, setSaving]       = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [templates, setTemplates]           = useState<BlockTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const supabase = createClient();

  // Notify parent whenever blocks list changes (skip initial mount)
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    onBlocksChange?.(blocks);
  }, [blocks]); // eslint-disable-line react-hooks/exhaustive-deps

  const doneCount = blocks.filter((b) => b.done).length;

  // ── Fetch saved templates when picker opens ──────────────────────────────

  async function openSaved() {
    setAddMode("saved");
    if (templates.length > 0) return;
    setLoadingTemplates(true);
    const { data } = await supabase
      .from("block_templates")
      .select("*")
      .order("position");
    setTemplates((data ?? []) as BlockTemplate[]);
    setLoadingTemplates(false);
  }

  function closeAdd() {
    setAddMode(null);
    setDraft(EMPTY);
  }

  // ── Correction tracking (AI blocks only) ────────────────────────────────

  async function writeCorrection(
    block: ScheduleBlock,
    type: "reschedule" | "delete" | "resize" | "retitle",
    overrides: { new_start_time?: string; new_duration_minutes?: number } = {}
  ) {
    if (isGuest || block.source !== "ai") return;
    const origDur = durationMinutes(block.start_time, block.end_time);
    await supabase.from("schedule_corrections").insert({
      user_id:                   userId!,
      block_id:                  block.id,
      correction_type:           type,
      original_start_time:       block.start_time,
      new_start_time:            overrides.new_start_time ?? block.start_time,
      original_duration_minutes: origDur,
      new_duration_minutes:      overrides.new_duration_minutes ?? origDur,
    });
  }

  // ── Block actions ────────────────────────────────────────────────────────

  async function toggleDone(block: ScheduleBlock) {
    const next = { ...block, done: !block.done };
    setBlocks((prev) => prev.map((b) => (b.id === block.id ? next : b)));
    if (!isGuest) {
      await supabase.from("schedule_blocks").update({ done: next.done }).eq("id", block.id);
    }
  }

  async function deleteBlock(block: ScheduleBlock) {
    setBlocks((prev) => prev.filter((b) => b.id !== block.id));
    if (!isGuest) {
      await writeCorrection(block, "delete");
      await supabase.from("schedule_blocks").delete().eq("id", block.id);
    }
  }

  function startEdit(block: ScheduleBlock) {
    setEditingId(block.id);
    setEditDraft({
      start_time: block.start_time,
      end_time:   block.end_time,
      title:      block.title,
      category:   block.category,
      detail:     block.detail ?? "",
    });
  }

  async function saveEdit(e: React.FormEvent, block: ScheduleBlock) {
    e.preventDefault();
    if (!isGuest) {
      const timeChanged  = editDraft.start_time !== block.start_time || editDraft.end_time !== block.end_time;
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
      }).eq("id", block.id);
    }

    setBlocks((prev) => prev.map((b) =>
      b.id === block.id ? { ...b, ...editDraft, detail: editDraft.detail.trim() || null } : b
    ));
    setEditingId(null);
  }

  // ── Add block: custom form ───────────────────────────────────────────────

  async function addBlock(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const today  = new Date().toISOString().split("T")[0];
    const maxPos = blocks.reduce((m, b) => Math.max(m, b.position), -1);

    if (!isGuest) {
      const { data, error } = await supabase
        .from("schedule_blocks")
        .insert({
          user_id:    userId!,
          day:        today,
          start_time: draft.start_time,
          end_time:   draft.end_time,
          title:      draft.title,
          category:   draft.category,
          detail:     draft.detail.trim() || null,
          position:   maxPos + 1,
          source:     "manual",
        })
        .select()
        .single();
      setSaving(false);
      if (!error && data) {
        setBlocks((prev) => [...prev, data as ScheduleBlock].sort((a, b) => a.start_time.localeCompare(b.start_time)));
        closeAdd();
        return;
      }
    }

    const local: ScheduleBlock = {
      id:         crypto.randomUUID(),
      user_id:    "guest",
      day:        today,
      start_time: draft.start_time,
      end_time:   draft.end_time,
      title:      draft.title,
      category:   draft.category,
      detail:     draft.detail.trim() || null,
      position:   maxPos + 1,
      done:       false,
      source:     "manual",
      created_at: new Date().toISOString(),
    };
    setBlocks((prev) => [...prev, local].sort((a, b) => a.start_time.localeCompare(b.start_time)));
    closeAdd();
    setSaving(false);
  }

  // ── Add block: from template ─────────────────────────────────────────────

  async function addFromTemplate(tpl: BlockTemplate) {
    const today     = new Date().toISOString().split("T")[0];
    const maxPos    = blocks.reduce((m, b) => Math.max(m, b.position), -1);
    const startTime = tpl.default_start_time ?? nextStart(blocks);
    const endTime   = addMinutes(startTime, tpl.duration_minutes);

    const payload = {
      user_id:    userId ?? "guest",
      day:        today,
      start_time: startTime,
      end_time:   endTime,
      title:      tpl.title,
      category:   tpl.category,
      detail:     tpl.detail ?? null,
      position:   maxPos + 1,
      source:     "manual" as const,
      done:       false,
    };

    if (!isGuest) {
      const { data } = await supabase
        .from("schedule_blocks")
        .insert(payload)
        .select()
        .single();
      if (data) {
        setBlocks((prev) => [...prev, data as ScheduleBlock].sort((a, b) => a.start_time.localeCompare(b.start_time)));
      }
    } else {
      const local: ScheduleBlock = { ...payload, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      setBlocks((prev) => [...prev, local].sort((a, b) => a.start_time.localeCompare(b.start_time)));
    }
    closeAdd();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <section className="bg-panel border border-line rounded-[18px] p-5">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="font-grotesk font-semibold text-[15px] tracking-wide text-txt">
            Today&apos;s plan
          </h2>
          <p className="text-muted text-[12.5px] mt-0.5">
            Tap a block to focus it · {doneCount} of {blocks.length} done
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-4">
        {blocks.map((block) => {
          const isActive  = block.id === activeBlockId;
          const isEditing = block.id === editingId;

          if (isEditing) {
            return (
              <form
                key={block.id}
                onSubmit={(e) => saveEdit(e, block)}
                className="flex flex-col gap-2 border border-violet/40 rounded-[14px] p-3 bg-violet/5"
              >
                <div className="flex gap-2">
                  <TimeField
                    value={editDraft.start_time}
                    onChange={(v) => setEditDraft((d) => ({ ...d, start_time: v }))}
                    placeholder="Start"
                  />
                  <TimeField
                    value={editDraft.end_time}
                    onChange={(v) => setEditDraft((d) => ({ ...d, end_time: v }))}
                    placeholder="End"
                  />
                </div>
                <input
                  type="text"
                  required
                  value={editDraft.title}
                  onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                  className="bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm outline-none focus:border-violet transition-colors"
                />
                <textarea
                  placeholder="Notes (optional)"
                  value={editDraft.detail}
                  rows={2}
                  onChange={(e) => setEditDraft((d) => ({ ...d, detail: e.target.value }))}
                  className="bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 text-sm text-muted border border-line rounded-lg hover:border-violet transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-sm text-white bg-violet rounded-lg hover:bg-[#6a59f5] transition-colors"
                  >
                    Save
                  </button>
                </div>
              </form>
            );
          }

          return (
            <div
              key={block.id}
              onClick={() => onFocus(block.id)}
              className={[
                "grid grid-cols-[54px_1fr_auto] gap-3 items-center px-3 py-3 rounded-[14px] border cursor-pointer transition-colors",
                isActive ? "border-violet/50 bg-violet/10" : "border-transparent hover:bg-panel-2",
                block.done ? "opacity-50" : "",
              ].join(" ")}
            >
              <div className="font-grotesk text-[13px] text-muted tabular-nums leading-tight">
                {to12h(block.start_time)}
                <span className="block text-[11px] text-faint">{to12h(block.end_time)}</span>
              </div>

              <div>
                <div className={`font-semibold text-[14.5px] text-txt ${block.done ? "line-through" : ""}`}>
                  {block.title}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="w-2 h-2 rounded-full inline-block flex-shrink-0"
                    style={{ background: CAT_COLORS[block.category] }}
                  />
                  <span className="text-[11.5px] text-muted">{CAT_LABELS[block.category]}</span>
                  {block.source === "ai" && (
                    <span className="text-[10px] text-violet/60 font-medium">AI</span>
                  )}
                </div>
                {block.detail && (
                  <p className="text-[11.5px] text-faint mt-0.5 line-clamp-1">{block.detail}</p>
                )}
              </div>

              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => startEdit(block)}
                  className="w-[28px] h-[28px] rounded-lg border border-transparent text-faint grid place-items-center hover:border-line hover:text-txt transition-colors"
                  title="Edit"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>

                <button
                  onClick={() => toggleDone(block)}
                  className={[
                    "w-[34px] h-[34px] rounded-[10px] border grid place-items-center transition-colors",
                    isActive
                      ? "bg-violet border-violet text-white"
                      : "bg-ink border-line text-txt hover:border-violet hover:text-violet-soft",
                  ].join(" ")}
                  title={block.done ? "Unmark" : "Mark done"}
                >
                  {block.done ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6 9 17l-5-5"/>
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                <button
                  onClick={() => deleteBlock(block)}
                  className="w-[28px] h-[28px] rounded-lg border border-transparent text-faint grid place-items-center hover:border-line hover:text-magenta transition-colors"
                  title="Delete"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Add block area ─────────────────────────────────────────────── */}

      {addMode === null && (
        <button
          onClick={() => setAddMode("picker")}
          className="mt-3 w-full py-2 text-[13px] text-faint border border-dashed border-line rounded-[14px] hover:border-violet hover:text-violet-soft transition-colors"
        >
          + Add block
        </button>
      )}

      {addMode === "picker" && (
        <div className="mt-3 border border-line rounded-[14px] p-3 flex flex-col gap-2">
          <p className="text-[12px] text-muted mb-1">How do you want to add a block?</p>
          <div className="flex gap-2">
            <button
              onClick={openSaved}
              className="flex-1 py-2.5 text-[13px] font-medium border border-line rounded-[10px] text-txt hover:border-violet transition-colors flex items-center justify-center gap-1.5"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              Saved blocks
            </button>
            <button
              onClick={() => { setAddMode("new"); setDraft({ ...EMPTY, start_time: nextStart(blocks) }); }}
              className="flex-1 py-2.5 text-[13px] font-medium border border-line rounded-[10px] text-txt hover:border-violet transition-colors flex items-center justify-center gap-1.5"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              New block
            </button>
          </div>
          <button onClick={closeAdd} className="text-[12px] text-faint hover:text-txt transition-colors text-center mt-0.5">
            Cancel
          </button>
        </div>
      )}

      {addMode === "saved" && (
        <div className="mt-3 border border-line rounded-[14px] p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[12px] text-muted">Pick a saved block</p>
            <button onClick={() => setAddMode("picker")} className="text-[11px] text-faint hover:text-txt transition-colors">← Back</button>
          </div>
          {loadingTemplates ? (
            <p className="text-[12px] text-faint text-center py-3">Loading…</p>
          ) : templates.length === 0 ? (
            <div className="text-center py-3">
              <p className="text-[12px] text-faint mb-2">No saved blocks yet.</p>
              <button
                onClick={() => setAddMode("new")}
                className="text-[12px] text-violet hover:underline"
              >
                Create one now →
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => addFromTemplate(tpl)}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-[10px] border border-transparent hover:border-line hover:bg-panel-2 transition-colors text-left"
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CAT_COLORS[tpl.category] }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-txt truncate">{tpl.title}</p>
                    {tpl.detail && <p className="text-[11px] text-faint truncate">{tpl.detail}</p>}
                  </div>
                  <span className="text-[11px] text-faint flex-shrink-0">{tpl.duration_minutes} min</span>
                </button>
              ))}
            </div>
          )}
          <button onClick={closeAdd} className="text-[12px] text-faint hover:text-txt transition-colors text-center mt-0.5">
            Cancel
          </button>
        </div>
      )}

      {addMode === "new" && (
        <form onSubmit={addBlock} className="mt-3 flex flex-col gap-2 border border-line rounded-[14px] p-3">
          <div className="flex items-center justify-between mb-0.5">
            <p className="text-[12px] text-muted">New block</p>
            <button type="button" onClick={() => setAddMode("picker")} className="text-[11px] text-faint hover:text-txt transition-colors">← Back</button>
          </div>
          <input
            type="text"
            required
            autoFocus
            placeholder="What are you working on?"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            className="bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors"
          />
          <textarea
            placeholder="Notes (optional)"
            value={draft.detail}
            rows={2}
            onChange={(e) => setDraft((d) => ({ ...d, detail: e.target.value }))}
            className="bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors resize-none"
          />
          <div className="flex gap-2">
            <TimeField
              value={draft.start_time}
              onChange={(v) => setDraft((d) => ({ ...d, start_time: v }))}
              placeholder="Start"
            />
            <TimeField
              value={draft.end_time}
              onChange={(v) => setDraft((d) => ({ ...d, end_time: v }))}
              placeholder="End"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={closeAdd}
              className="px-3 py-1.5 text-sm text-muted border border-line rounded-lg hover:border-violet transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-sm text-white bg-violet rounded-lg hover:bg-[#6a59f5] transition-colors disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
