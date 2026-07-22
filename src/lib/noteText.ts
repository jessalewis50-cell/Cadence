// Conversion between Almanac's stored note format (Quill editor HTML — see
// notes-app/src/App.js, which persists quill.root.innerHTML) and the clean
// readable text the Cadence agent sees. Writes must produce HTML that Quill
// renders faithfully: <p> per line, <p><br></p> for blank lines, <ul><li> for
// bullet lists, entities escaped.

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Quill HTML -> readable plain text. Block elements become lines; list items
// become "- " lines; inline tags are stripped; entities decoded.
export function quillHtmlToText(html: string): string {
  if (!html) return "";
  let s = html;
  // Normalize breaks first so "<p>a<br>b</p>" splits into two lines.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // List items -> dashed lines.
  s = s.replace(/<li[^>]*>/gi, "- ").replace(/<\/li>/gi, "\n");
  // Ends of block elements terminate a line. (</ul>/</ol> excluded — the last
  // </li> already emitted the newline.)
  s = s.replace(/<\/(p|h[1-6]|div|blockquote)>/gi, "\n");
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // Collapse the artifacts: trailing spaces per line, >2 consecutive newlines
  // (an empty <p><br></p> yields exactly one blank line).
  const lines = s.split("\n").map((l) => l.replace(/\s+$/g, ""));
  // Drop leading/trailing blank lines, collapse runs of 2+ blanks to one.
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

// Plain text -> Quill HTML. Consecutive "- " lines group into one <ul>.
export function textToQuillHtml(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  const parts: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      parts.push(`<ul>${listItems.map((li) => `<li>${li}</li>`).join("")}</ul>`);
      listItems = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith("- ")) {
      listItems.push(escapeHtml(line.slice(2)));
      continue;
    }
    flushList();
    if (line === "") {
      parts.push("<p><br></p>");
    } else {
      parts.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  flushList();
  return parts.join("");
}

// One-line preview for search results: text content, whitespace collapsed,
// truncated with an ellipsis.
export function htmlSnippet(html: string, max = 160): string {
  const text = quillHtmlToText(html).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}
