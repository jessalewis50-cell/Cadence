# TimeField — smart time input

**Date:** 2026-06-30
**Status:** Approved

## Problem

Block times are entered through `TimeCombobox`, a text field backed by a 30-minute-only
dropdown. Two problems:

1. Focusing the field keeps the existing value and appends new keystrokes to the end —
   the user must manually delete before retyping.
2. `to24h()` only parses fully-formed strings (`9:00 AM` / `09:00`), so partial typing
   produces no valid value, and the dropdown can't express any time off the 30-minute grid.

The component is duplicated verbatim in `BlocksView.tsx` and `Timeline.tsx`.

## Solution

One shared `src/components/ui/TimeField.tsx` replacing both copies. Keeps the current
styled look (dark field, violet focus ring, suggestion dropdown). Behaviour:

- **Focus → select-all.** First keystroke replaces the whole value (fixes the append bug).
- **While typing** → field holds raw text; suggestion dropdown filters; no reformatting
  mid-keystroke (cursor never jumps).
- **Commit on blur / Enter / pick** → parse loose input to canonical `HH:MM`, redisplay as
  12-hour (`9:15 AM`). Unparseable input reverts to the last valid value.
- **Any minute allowed.** The 30-minute grid is demoted to optional quick-pick suggestions.

## Parser: `parseTimeInput(raw): string | null`

Pure function in `src/lib/time.ts`. Returns canonical `"HH:MM"` (24h) or `null` if the
input is incomplete/ambiguous/invalid. Whitespace and case insensitive.

| Input | Result | Notes |
|-------|--------|-------|
| `9a` / `9 am` / `9:00am` | `09:00` | explicit AM |
| `9p` / `9pm` / `9:00 pm` | `21:00` | explicit PM |
| `915a` / `9:15 am` | `09:15` | minutes, AM |
| `230p` / `2:30pm` | `14:30` | minutes, PM |
| `1230a` / `12:30 am` | `00:30` | 12 AM = midnight |
| `12p` / `12:00pm` | `12:00` | 12 PM = noon |
| `13:30` / `1330` | `13:30` | hour 13–23, no meridian → accepted |
| `0015` / `00:30` | `00:15` / `00:30` | hour 00, no meridian → accepted |
| `2359` | `23:59` | 24-hour |
| `9` / `915` / `12` / `0600` / `09:00` | `null` | hour 1–12, no meridian → **rejected** |
| `25:00` / `9:75` / `abc` / `` | `null` | invalid |

**Rules**
- Strip spaces; detect trailing `a`/`am`/`p`/`pm`.
- Digits → split into hour/minute: 1–2 digits = hour only (`:00`); 3 digits = `Hmm`;
  4 digits = `HHmm`. Minute must be 0–59.
- **With meridian:** hour must be 1–12. Map 12 AM→0, 12 PM→12, PM adds 12 otherwise.
- **Without meridian:** accept only true 24-hour times — hour must be **13–23 or 00**.
  Any hour in 1–12 with no meridian → `null` (the "always require am/pm" rule).
  (`1330` ✓, `0015` ✓, `2359` ✓; `9` ✗, `0900` ✗, `12` ✗.)

## Component contract

```ts
function TimeField(props: {
  value: string;                 // canonical "HH:MM" or ""
  onChange: (v: string) => void; // emits canonical "HH:MM" on commit
  placeholder: string;
}): JSX.Element
```

- Internal `text` state for the in-progress string; `value` is the committed source of truth.
- Suggestions: reuse `buildTimeOptions()` (30-min grid) as quick-picks, filtered by the
  raw text. Picking one commits immediately.
- `onChange` fires only with a valid canonical value (or `""` when cleared), never with
  partial text.

## Out of scope

- No change to how blocks are stored or to `addMinutes` / end-time logic.
- `to24h` stays (used elsewhere); `parseTimeInput` is the new strict entry point.

## Testing

`parseTimeInput` is pure — TDD it against the table above with a one-off script (no test
framework in repo). Manual check of the two screens (template default start, custom block
start/end) for: select-on-focus, reject-and-revert on bad input, quick-pick still works.
