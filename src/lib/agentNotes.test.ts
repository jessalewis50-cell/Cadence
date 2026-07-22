import { describe, it, expect } from "vitest";
import { NOTES_TOOLS, notesToolsFor, executeNotesTool } from "./agentNotes";
import { deriveEntitlements } from "./entitlements";

const NOW = new Date("2026-07-22T12:00:00Z");
const profile = (plans: string[]) => ({
  plans,
  subscription_status: null,
  current_period_end: null,
});

describe("notesToolsFor (entitlement gating)", () => {
  it("cadence_plus gets the notes tools", () => {
    const ents = deriveEntitlements(profile(["cadence_plus"]), NOW);
    expect(notesToolsFor(ents).map((t) => t.name)).toEqual([
      "search_notes",
      "get_note",
      "create_note",
      "append_to_note",
    ]);
  });

  it("cadence_pro does NOT get the notes tools", () => {
    const ents = deriveEntitlements(profile(["cadence_pro"]), NOW);
    expect(notesToolsFor(ents)).toEqual([]);
  });

  it("holding both single plans still does not grant integration", () => {
    const ents = deriveEntitlements(profile(["almanac_pro", "cadence_pro"]), NOW);
    expect(notesToolsFor(ents)).toEqual([]);
  });

  it("free gets nothing", () => {
    const ents = deriveEntitlements(profile([]), NOW);
    expect(notesToolsFor(ents)).toEqual([]);
  });
});

describe("tool surface", () => {
  it("has no delete tool", () => {
    expect(NOTES_TOOLS.some((t) => t.name.includes("delete"))).toBe(false);
  });
});

// ── Minimal supabase stub ────────────────────────────────────────────────────
// Chainable query builder that resolves to canned {data, error} per table.
type Result = { data: unknown; error: { message: string } | null };

function stubSupabase(results: Record<string, Result | Result[]>) {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const take = (table: string): Result => {
    const r = results[table];
    if (Array.isArray(r)) return r.shift() ?? { data: null, error: null };
    return r ?? { data: null, error: null };
  };
  const builder = (table: string) => {
    const result = take(table);
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ["select", "eq", "gte", "lt", "or", "order", "limit", "update", "insert"]) {
      b[m] = (payload?: unknown) => {
        calls.push({ table, op: m, payload });
        return chain();
      };
    }
    b.maybeSingle = () => Promise.resolve(result);
    b.single = () => Promise.resolve(result);
    // Awaiting the builder itself resolves the canned result (list queries).
    b.then = (onOk: (r: Result) => unknown) => Promise.resolve(result).then(onOk);
    return b;
  };
  return {
    client: { from: (table: string) => builder(table) },
    calls,
  };
}

describe("executeNotesTool", () => {
  it("returns null for non-notes tools", async () => {
    const { client } = stubSupabase({});
    const res = await executeNotesTool(
      "create_block", {}, client as never, "user-1");
    expect(res).toBeNull();
  });

  it("search_notes formats snippets and never returns full content", async () => {
    const { client } = stubSupabase({
      folders: { data: [{ id: "f1", name: "Work" }], error: null },
      notes: {
        data: [
          {
            id: "n1",
            title: "Sprint planning",
            content: "<p>" + "Long text. ".repeat(100) + "</p>",
            folder_id: "f1",
            updated_at: "2026-07-20T10:00:00Z",
          },
        ],
        error: null,
      },
    });
    const res = await executeNotesTool("search_notes", { query: "sprint" }, client as never, "user-1");
    expect(res?.isError).toBeFalsy();
    expect(res?.content).toContain('id=n1 "Sprint planning" [Work]');
    expect(res?.content).toContain("…"); // snippet truncated
    expect(res!.content.length).toBeLessThan(500);
  });

  it("get_note converts Quill HTML to text and reports a change line", async () => {
    const { client } = stubSupabase({
      notes: {
        data: {
          id: "n1",
          title: "Week debrief",
          content: "<p>Done:</p><ul><li>Shipped auth</li></ul>",
          folder_id: null,
          updated_at: "2026-07-21T10:00:00Z",
        },
        error: null,
      },
    });
    const res = await executeNotesTool("get_note", { note_id: "n1" }, client as never, "user-1");
    expect(res?.content).toContain("Done:\n- Shipped auth");
    expect(res?.change).toBe("📝 Read note: Week debrief");
  });

  it("get_note surfaces missing notes as errors", async () => {
    const { client } = stubSupabase({ notes: { data: null, error: null } });
    const res = await executeNotesTool("get_note", { note_id: "nope" }, client as never, "user-1");
    expect(res?.isError).toBe(true);
  });

  it("create_note stores Quill HTML and reports the created note", async () => {
    const { client, calls } = stubSupabase({
      notes: { data: { id: "n9", title: "Summary" }, error: null },
    });
    const res = await executeNotesTool(
      "create_note",
      { title: "Summary", content: "Line one\n- a bullet" },
      client as never,
      "user-1"
    );
    expect(res?.change).toBe("📝 Created note: Summary");
    const insert = calls.find((c) => c.table === "notes" && c.op === "insert");
    const row = insert?.payload as { content: string };
    expect(row.content).toBe("<p>Line one</p><ul><li>a bullet</li></ul>");
  });

  it("append_to_note preserves existing content and separates with a blank line", async () => {
    const { client, calls } = stubSupabase({
      notes: [
        { data: { id: "n1", title: "Log", content: "<p>old</p>" }, error: null },
        { data: null, error: null },
      ],
    });
    const res = await executeNotesTool(
      "append_to_note",
      { note_id: "n1", content: "new entry" },
      client as never,
      "user-1"
    );
    expect(res?.change).toBe("📝 Updated note: Log");
    const update = calls.find((c) => c.table === "notes" && c.op === "update");
    const row = update?.payload as { content: string };
    expect(row.content).toBe("<p>old</p><p><br></p><p>new entry</p>");
  });
});
