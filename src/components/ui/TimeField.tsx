"use client";

import { useState, useEffect, useRef } from "react";
import { to12h, parseTimeInput, buildTimeOptions } from "@/lib/time";

const TIME_OPTIONS = buildTimeOptions();

/**
 * Smart time input. Type loosely (`9a`, `230p`, `1330`); commits on blur / Enter /
 * pick. Focusing selects the whole value so the first keystroke replaces it. Invalid
 * or incomplete input reverts to the last valid value. Emits canonical "HH:MM" (or "").
 */
export default function TimeField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ? to12h(value) : "");
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectOnFocus = useRef(false);

  // When closed, mirror the committed value (this also performs the revert-on-invalid).
  useEffect(() => {
    if (!open) setText(value ? to12h(value) : "");
  }, [value, open]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open && listRef.current && value) {
      const active = listRef.current.querySelector(`[data-val="${value}"]`) as HTMLElement | null;
      active?.scrollIntoView({ block: "nearest" });
    }
  }, [open, value]);

  function commit() {
    const t = text.trim();
    if (!t) {
      onChange("");
      return;
    }
    const parsed = parseTimeInput(t);
    if (parsed) onChange(parsed);
    else setText(value ? to12h(value) : ""); // revert
  }

  const filtered = text
    ? TIME_OPTIONS.filter(
        (o) =>
          o.label.toLowerCase().startsWith(text.toLowerCase()) ||
          o.value.startsWith(text)
      )
    : TIME_OPTIONS;

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onMouseDown={() => {
          if (document.activeElement !== inputRef.current) selectOnFocus.current = true;
        }}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onMouseUp={(e) => {
          // Preserve the focus-time select-all against the click's caret placement.
          if (selectOnFocus.current) {
            e.preventDefault();
            selectOnFocus.current = false;
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            setOpen(false);
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            setText(value ? to12h(value) : "");
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        onBlur={() => {
          // Picking an option preventDefaults mousedown, so blur won't fire for it.
          commit();
          setOpen(false);
        }}
        className="w-full bg-ink border border-line rounded-lg px-2 py-1.5 text-txt text-sm outline-none focus:border-violet transition-colors"
      />
      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-30 top-full left-0 mt-1 w-full max-h-[180px] overflow-y-auto bg-panel border border-line rounded-lg shadow-xl"
        >
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              data-val={o.value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o.value);
                setText(o.label);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-panel-2 transition-colors ${
                o.value === value ? "text-violet font-medium" : "text-txt"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
