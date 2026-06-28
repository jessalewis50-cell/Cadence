# TODOS

Deferred items from eng review. Each has enough context to pick up later.

---

## Extract `TimeCombobox` to a shared component

**What:** Move `TimeCombobox` (currently a local function copied in `Timeline.tsx` and `BlocksView.tsx`) to `src/components/ui/TimeCombobox.tsx` and import it everywhere it's used.

**Why:** The inline block edit form (added in this PR) will need it — without extraction, it becomes a third copy. Three copies of the same 80-line component is a future maintenance burden.

**Pros:** Single source of truth. Prop changes and bug fixes apply everywhere. Cleanly separates the shared UI primitive from the schedule logic.

**Cons:** Minor refactor cost (~30 min with CC). Needs to happen alongside or after the DRY refactor step.

**Context:** `TimeCombobox` appears in `src/components/schedule/Timeline.tsx` (local, lines ~41-168) and `src/components/blocks/BlocksView.tsx` (local, lines ~60-160). Both use the same `to12h`/`to24h` imports from `src/lib/time.ts`. The new inline edit form in Timeline.tsx will need this component.

**Depends on:** DRY refactor (Step 3 in build order) — `buildTimeOptions` should live in `src/lib/time.ts` first.

**Blocked by:** Nothing. Can be done as its own PR after core AI features ship.

---

## Success metric query: corrections per week

**What:** Add a way to measure the "< 3 manual corrections/week after Week 3" success criterion from the design doc.

**Why:** The criterion exists in the design doc but there's no mechanism to check it. After 3 weeks of using AI scheduling, you should be able to verify whether the behavioral flywheel is working.

**Pros:** Makes the success criterion measurable. Takes 5 minutes — it's just a Supabase query. Early detection if the AI isn't getting better over time.

**Cons:** Requires `schedule_corrections` table to be populated (which requires the AI scheduling + correction tracking to be working).

**Context:** The simplest implementation is a saved Supabase query in the dashboard:
```sql
select
  date_trunc('week', created_at) as week,
  count(*) as corrections
from schedule_corrections
where user_id = auth.uid()
group by week
order by week desc;
```
Or a `/stats` page showing corrections/week over time.

**Depends on:** schedule_corrections table being populated (core AI feature must ship first).

---

## Nightly insights user count guard: switch to cost-based threshold

**What:** Replace the hardcoded `warn at 100, stop at 150` user count guard in the nightly Edge Function with a token-budget-based threshold.

**Why:** The 150-user cutoff is arbitrary. The real constraint is the Supabase Edge Function 150-second timeout, which maps to `timeout_seconds / avg_seconds_per_user`. As Haiku API speeds change or as prompt sizes grow, 150 becomes wrong. A cost-based guard (estimated tokens per user × user count vs. daily budget) is more principled.

**Pros:** Self-correcting as API speeds and pricing change. Explicit about the real constraint (time/cost) rather than a proxy (user count).

**Cons:** Requires estimating tokens per user dynamically. More complex to implement. Low priority until scale matters.

**Context:** The nightly insights Edge Function loops over paid users sequentially. Each loop iteration calls Claude Haiku once. At ~1s/call, 150 calls = 150s = edge of timeout. The current guard stops at 150 users; a cost-based guard would compute `budget_seconds / (avg_haiku_latency_ms / 1000)` dynamically.

**Depends on:** Nightly Edge Function shipping. Revisit when paid user count approaches 50.
