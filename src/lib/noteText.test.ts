import { describe, it, expect } from "vitest";
import { quillHtmlToText, textToQuillHtml, htmlSnippet } from "./noteText";

describe("quillHtmlToText", () => {
  it("turns paragraphs into lines", () => {
    expect(quillHtmlToText("<p>Hello</p><p>World</p>")).toBe("Hello\nWorld");
  });

  it("treats Quill's empty paragraph as a blank line", () => {
    expect(quillHtmlToText("<p>One</p><p><br></p><p>Two</p>")).toBe("One\n\nTwo");
  });

  it("turns list items into dashed lines", () => {
    expect(quillHtmlToText("<ul><li>Buy milk</li><li>Call mom</li></ul>")).toBe(
      "- Buy milk\n- Call mom"
    );
  });

  it("strips inline formatting but keeps text", () => {
    expect(quillHtmlToText("<p><strong>Bold</strong> and <em>italic</em></p>")).toBe(
      "Bold and italic"
    );
  });

  it("decodes HTML entities", () => {
    expect(quillHtmlToText("<p>Fish &amp; chips &lt;3&nbsp;&quot;yum&quot;</p>")).toBe(
      'Fish & chips <3 "yum"'
    );
  });

  it("handles headers as lines", () => {
    expect(quillHtmlToText("<h1>Title</h1><p>Body</p>")).toBe("Title\nBody");
  });

  it("handles br inside paragraphs", () => {
    expect(quillHtmlToText("<p>line one<br>line two</p>")).toBe("line one\nline two");
  });

  it("returns empty string for empty content", () => {
    expect(quillHtmlToText("")).toBe("");
    expect(quillHtmlToText("<p><br></p>")).toBe("");
  });
});

describe("textToQuillHtml", () => {
  it("wraps lines in paragraphs", () => {
    expect(textToQuillHtml("Hello\nWorld")).toBe("<p>Hello</p><p>World</p>");
  });

  it("renders blank lines as empty paragraphs", () => {
    expect(textToQuillHtml("One\n\nTwo")).toBe("<p>One</p><p><br></p><p>Two</p>");
  });

  it("groups dashed lines into a list", () => {
    expect(textToQuillHtml("- Buy milk\n- Call mom")).toBe(
      "<ul><li>Buy milk</li><li>Call mom</li></ul>"
    );
  });

  it("escapes HTML-special characters", () => {
    expect(textToQuillHtml("a < b & c > d")).toBe("<p>a &lt; b &amp; c &gt; d</p>");
  });
});

describe("round-trips", () => {
  const texts = [
    "Just one line",
    "Two\nlines",
    "Para one\n\nPara two",
    "Intro\n- item one\n- item two\nOutro",
    'Symbols: & < > "quotes"',
  ];
  for (const t of texts) {
    it(`text -> html -> text preserves: ${JSON.stringify(t.slice(0, 30))}`, () => {
      expect(quillHtmlToText(textToQuillHtml(t))).toBe(t);
    });
  }

  it("quill html -> text -> html preserves visible text", () => {
    const quill =
      "<h2>Week plan</h2><p>Focus on <strong>shipping</strong>.</p><p><br></p><ul><li>Fix auth</li><li>Write tests</li></ul>";
    const once = quillHtmlToText(quill);
    const twice = quillHtmlToText(textToQuillHtml(once));
    expect(twice).toBe(once);
  });
});

describe("htmlSnippet", () => {
  it("collapses whitespace and truncates with ellipsis", () => {
    const html = "<p>" + "word ".repeat(100) + "</p>";
    const s = htmlSnippet(html, 50);
    expect(s.length).toBeLessThanOrEqual(51); // 50 + ellipsis char
    expect(s.endsWith("…")).toBe(true);
    expect(s).not.toContain("\n");
  });

  it("returns short content untouched", () => {
    expect(htmlSnippet("<p>Short note</p>", 160)).toBe("Short note");
  });
});
