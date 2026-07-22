// Almanac notes tools for the Cadence agent — cadence_plus only.
// The executor runs against the CALLER'S Supabase client, so Almanac's
// row-level security applies exactly as it does in the notes app itself.
// No delete tool exists by design.

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entitlements } from "./entitlements";
import { quillHtmlToText, textToQuillHtml, htmlSnippet } from "./noteText";

const SEARCH_LIMIT = 20;       // max results per search
const SNIPPET_CHARS = 160;     // preview length in search results
const NOTE_TEXT_CHARS = 8_000; // get_note content cap (~2-3k tokens)

export const NOTES_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_notes",
    description:
      "Search the user's Almanac notes. Call this FIRST whenever the user refers to their notes — " +
      "it returns titles, ids, and short snippets only (never full contents). Omit query to list " +
      "recent notes. Use updated_within_days for phrases like 'this week'. Then fetch only the " +
      "1-3 most relevant notes with get_note.",
    input_schema: {
      type: "object",
      properties: {
        query:               { type: "string", description: "Keywords matched against title and content. Omit to list recent notes." },
        folder:              { type: "string", description: "Only notes in this folder (by name, case-insensitive)." },
        updated_within_days: { type: "number", description: "Only notes updated in the last N days (e.g. 7 for 'this week')." },
        limit:               { type: "number", description: `Max results, up to ${SEARCH_LIMIT} (default 10).` },
      },
      required: [],
    },
  },
  {
    name: "get_note",
    description:
      "Read the full content of ONE note by id (from search_notes). Content is plain text; long " +
      "notes are truncated. Fetch only the notes you actually need — each one costs the user tokens.",
    input_schema: {
      type: "object",
      properties: {
        note_id: { type: "string", description: "The note's id, from search_notes results." },
      },
      required: ["note_id"],
    },
  },
  {
    name: "create_note",
    description:
      "Create a new note in the user's Almanac. Use plain text with newlines; lines starting with " +
      "\"- \" become bullet points. Optionally place it in a folder by name (created if it doesn't " +
      "exist). Use this when the user asks for a summary, debrief, or plan written to their notes.",
    input_schema: {
      type: "object",
      properties: {
        title:       { type: "string", description: "Short, specific note title." },
        content:     { type: "string", description: "Note body as plain text. \"- \" lines become bullets; blank lines separate paragraphs." },
        folder_name: { type: "string", description: "Optional folder to place the note in (created if missing)." },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "append_to_note",
    description:
      "Add content to the END of an existing note without changing what's already there. Use for " +
      "ongoing logs the user adds to over time (e.g. a weekly debrief note). Same plain-text " +
      "format as create_note.",
    input_schema: {
      type: "object",
      properties: {
        note_id: { type: "string", description: "The note's id, from search_notes results." },
        content: { type: "string", description: "Text to append. \"- \" lines become bullets." },
      },
      required: ["note_id", "content"],
    },
  },
];

// Tools are only offered to the model when the plan includes the integration.
export function notesToolsFor(ents: Entitlements): Anthropic.Tool[] {
  return ents.almanacIntegration ? NOTES_TOOLS : [];
}

export const NOTES_PROMPT_SECTION = `
ALMANAC NOTES:
You also have access to the user's Almanac notes (their separate notes app) through the notes tools.
- Use them for planning: e.g. read this week's notes to find action items before building next week's schedule, or find notes on a topic before scheduling deep work on it.
- ALWAYS search first (search_notes returns snippets only), then get_note on at most the 1-3 most relevant results. Never fetch notes you don't need — reading notes costs the user AI credits.
- Don't paste long note contents into your replies; summarize in a sentence or two.
- Writing notes: when the user asks for a summary, debrief, or plan saved to their notes, use create_note — or append_to_note to grow an existing log without overwriting it. Small, single-note writes the user asked for need no confirmation.
- Changes across MANY notes (or anything the user might not expect) follow the same rule as schedule restructures: summarize the plan in chat and get confirmation first.
- You cannot delete notes. If asked to delete one, say the user can do that in Almanac.
- Notes you create appear in Almanac the next time it loads.`;

export const NO_NOTES_PROMPT_LINE = `
NOTES: You do NOT have access to the user's Almanac notes on their current plan, and there are no notes tools — never claim to have read or written a note. If the user asks about their notes or wants notes integration, briefly mention it's included in the Cadence Plus plan.`;

export interface NotesExecResult {
  content: string;
  isError?: boolean;
  change?: string;
}

const NOTE_TOOL_NAMES = new Set(NOTES_TOOLS.map((t) => t.name));

// Returns null when `name` isn't a notes tool, so the caller can fall through
// to the block tools.
export async function executeNotesTool(
  name: string,
  rawInput: unknown,
  supabase: SupabaseClient,
  userId: string
): Promise<NotesExecResult | null> {
  if (!NOTE_TOOL_NAMES.has(name)) return null;
  const input = (rawInput ?? {}) as Record<string, unknown>;

  switch (name) {
    case "search_notes": {
      const limit = Math.min(SEARCH_LIMIT, Math.max(1, Number(input.limit ?? 10)));
      let q = supabase
        .from("notes")
        .select("id, title, content, folder_id, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(limit);
      const query = input.query ? String(input.query).trim() : "";
      if (query) {
        const like = `%${query.replace(/[%_]/g, "")}%`;
        q = q.or(`title.ilike.${like},content.ilike.${like}`);
      }
      if (input.updated_within_days) {
        const days = Math.max(1, Number(input.updated_within_days));
        const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
        q = q.gte("updated_at", cutoff);
      }

      // Resolve folder filter + folder names for display in one query.
      const { data: folders } = await supabase
        .from("folders")
        .select("id, name")
        .eq("user_id", userId);
      const folderName = new Map((folders ?? []).map((f) => [f.id, f.name]));
      if (input.folder) {
        const want = String(input.folder).trim().toLowerCase();
        const match = (folders ?? []).find((f) => f.name.toLowerCase() === want);
        if (!match) {
          return { content: `No folder named "${input.folder}". Folders: ${(folders ?? []).map((f) => f.name).join(", ") || "(none)"}` };
        }
        q = q.eq("folder_id", match.id);
      }

      const { data, error } = await q;
      if (error) return { content: `Search failed: ${error.message}`, isError: true };
      if (!data || data.length === 0) return { content: "No matching notes." };

      const lines = data.map((n) => {
        const folder = n.folder_id ? ` [${folderName.get(n.folder_id) ?? "folder"}]` : "";
        const updated = String(n.updated_at).slice(0, 10);
        return `- id=${n.id} "${n.title}"${folder} (updated ${updated}): ${htmlSnippet(n.content ?? "", SNIPPET_CHARS)}`;
      });
      return { content: `${data.length} note(s):\n${lines.join("\n")}` };
    }

    case "get_note": {
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, content, folder_id, updated_at")
        .eq("user_id", userId)
        .eq("id", String(input.note_id ?? ""))
        .maybeSingle();
      if (error) return { content: `Read failed: ${error.message}`, isError: true };
      if (!data) return { content: "Note not found.", isError: true };
      let text = quillHtmlToText(data.content ?? "");
      if (text.length > NOTE_TEXT_CHARS) {
        text = text.slice(0, NOTE_TEXT_CHARS) + "\n…[note truncated]";
      }
      return {
        content: `"${data.title}" (updated ${String(data.updated_at).slice(0, 10)}):\n${text || "(empty note)"}`,
        change: `📝 Read note: ${data.title}`,
      };
    }

    case "create_note": {
      const title = String(input.title ?? "").trim() || "Untitled";
      const html = textToQuillHtml(String(input.content ?? ""));

      let folderId: string | null = null;
      if (input.folder_name) {
        const want = String(input.folder_name).trim();
        const { data: folders } = await supabase
          .from("folders")
          .select("id, name")
          .eq("user_id", userId);
        const match = (folders ?? []).find(
          (f) => f.name.toLowerCase() === want.toLowerCase()
        );
        if (match) {
          folderId = match.id;
        } else {
          const { data: created, error: folderErr } = await supabase
            .from("folders")
            .insert({ name: want, user_id: userId })
            .select()
            .single();
          if (folderErr) return { content: `Couldn't create folder: ${folderErr.message}`, isError: true };
          folderId = created.id;
        }
      }

      const { data, error } = await supabase
        .from("notes")
        .insert({ title, content: html, user_id: userId, folder_id: folderId })
        .select("id, title")
        .single();
      if (error) return { content: `Create failed: ${error.message}`, isError: true };
      return {
        content: `Created note "${data.title}" (id=${data.id}).`,
        change: `📝 Created note: ${data.title}`,
      };
    }

    case "append_to_note": {
      const { data: existing, error: readErr } = await supabase
        .from("notes")
        .select("id, title, content")
        .eq("user_id", userId)
        .eq("id", String(input.note_id ?? ""))
        .maybeSingle();
      if (readErr) return { content: `Read failed: ${readErr.message}`, isError: true };
      if (!existing) return { content: "Note not found.", isError: true };

      const addition = textToQuillHtml(String(input.content ?? ""));
      if (!addition) return { content: "Nothing to append.", isError: true };
      const prior = existing.content ?? "";
      const merged = prior ? `${prior}<p><br></p>${addition}` : addition;

      const { error } = await supabase
        .from("notes")
        .update({ content: merged, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) return { content: `Append failed: ${error.message}`, isError: true };
      return {
        content: `Appended to "${existing.title}".`,
        change: `📝 Updated note: ${existing.title}`,
      };
    }
  }
  return null;
}
