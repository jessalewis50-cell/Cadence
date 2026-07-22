# Cadence Agent ↔ Almanac Notes Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadence's AI agent can search/read/create/append the user's Almanac notes — cadence_plus only — with clean text conversion, bounded token usage, and subtle UI surfacing.

**Architecture:** Two new lib modules keep the route thin and testable: `noteText.ts` (Quill HTML ↔ readable text, snippets) and `agentNotes.ts` (tool definitions, executor against the user's RLS client, prompt sections, `notesToolsFor(entitlements)` gating helper). The agent route appends notes tools + prompt section only when `entitlements.almanacIntegration` is true; `checkAiAccess` is extended to return entitlements so no second profile read is needed. Note actions ride the existing `changes[]` channel; AgentChat renders 📝-prefixed entries as faint sub-lines.

**Tech Stack:** Next.js route handlers, Supabase (existing RLS on notes/folders — the agent operates as the user, so isolation is automatic), vitest.

## Global Constraints

- Tools: `search_notes` (also covers listing), `get_note`, `create_note`, `append_to_note`. NO delete tool.
- Gate: tools + prompt section present only for `almanacIntegration` (cadence_plus). Without it, one prompt line: mention Plus if the user asks about notes; never pretend to access notes.
- Token bounds: search returns ≤20 results with ≤160-char snippets; get_note text truncated at 8,000 chars with a marker; prompt instructs snippets-first, fetch only 1–3 notes.
- Conversion: model always sees readable text; writes store Quill-renderable HTML (`<p>` lines, `<p><br></p>` blanks, `<ul><li>` for "- " lines, entities escaped).
- Safety (system prompt): creating/appending on request is fine; bulk edits across many notes require chat confirmation first (mirrors block-tool pattern).
- Headline flows: (1) read this week's notes → plan next week around action items; (2) create a summary note of the week; (3) find notes on a topic → schedule deep work blocks from them.
- Limitation to document: Almanac has no realtime — Cadence-created notes appear on next Almanac load.

---

### Task 1: `src/lib/noteText.ts` + tests (TDD)

Produces: `quillHtmlToText(html): string`, `textToQuillHtml(text): string`, `htmlSnippet(html, max=160): string`.
- HTML→text: `<p>`/`<h1-6>`/`<div>` → lines; `<br>` → newline; `<li>` → "- " line; strip other tags; decode `&amp; &lt; &gt; &nbsp; &quot; &#39;`; collapse `<p><br></p>` to blank line; trim trailing whitespace.
- text→HTML: escape `& < >`; consecutive "- " lines → `<ul><li>…</li></ul>`; blank line → `<p><br></p>`; other lines → `<p>…</p>`.
- Round-trip tests: `quillHtmlToText(textToQuillHtml(t)) === t` for prose, blank lines, lists, HTML-special chars; and Quill-shaped HTML → text → HTML preserves visible text.

### Task 2: `src/lib/agentNotes.ts` + tests

Produces:
- `NOTES_TOOLS: Anthropic.Tool[]` — the 4 defs with prescriptive descriptions (when to call, snippet-first guidance inline).
- `notesToolsFor(ents: Entitlements): Anthropic.Tool[]` — `ents.almanacIntegration ? NOTES_TOOLS : []`.
- `NOTES_PROMPT_SECTION` / `NO_NOTES_PROMPT_LINE` strings.
- `executeNotesTool(name, input, supabase, userId): Promise<{content; isError?; change?} | null>` — null when name isn't a notes tool.
  - search_notes: {query?, folder?, updated_within_days?, limit?≤20}; ilike title/content; returns id/title/folder/updated_at/snippet lines.
  - get_note: {note_id}; text (truncated 8k) + title/folder/updated; change "📝 Read note: {title}".
  - create_note: {title, content, folder_name?}; folder resolved case-insensitively, created if missing; change "📝 Created note: {title}".
  - append_to_note: {note_id, content}; existing HTML + `<p><br></p>` + new HTML; bumps updated_at; change "📝 Updated note: {title}".
Tests: gating (plus vs pro entitlements fixtures), executor happy paths + errors via a tiny supabase stub, no delete tool exported.

### Task 3: `checkAiAccess` returns entitlements

`aiBudget.ts` ok-branch → `{ ok: true; meter; entitlements }`. Update its uses (agent + schedule routes ignore or use; agent uses). Existing tests untouched (shape is additive); add one assertion.

### Task 4: Route wiring

- Gate block captures `access.entitlements`.
- `const requestTools = [...tools, ...notesToolsFor(ents)]`; pass to every `anthropic.messages.create`.
- `buildSystemPrompt(..., notesEnabled)` appends NOTES_PROMPT_SECTION or NO_NOTES_PROMPT_LINE.
- `executeTool` first tries `executeNotesTool` (guarded: only reachable when tools were offered; harmless otherwise).

### Task 5: AgentChat UI

Response already carries `changes`. Extend Message with `notes?: string[]`; on success filter `changes` for entries starting with "📝" and render under the agent bubble as `text-faint text-[12px]` lines. (Block changes stay unsurfaced — schedule UI is their confirmation.)

### Task 6: Verify + ship

tsc, vitest (all), commit, push (no migration this phase — RLS and tables already exist). Manual headline-flow test checklist for the user.

## Self-Review
Spec 1→Tasks 2/4 (list covered by search with no query). 2→Tasks 2/3/4. 3→prompt text in Task 2 tuned to the three flows. 4→Global bounds + prompt guidance, explained in handoff. 5→Task 5 + realtime limitation documented. 6→Tasks 1/2 tests. No delete tool anywhere. ✓
