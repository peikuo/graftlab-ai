import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./markdown.ts";

describe("markdownToHtml", () => {
  it("renders the subset the Studio writes", () => {
    const html = markdownToHtml(
      [
        "# Product Backlog",
        "Based on Decision_Doc version 1.",
        "## S1 Tags (priority 1)",
        "**Demo point:** see `tags`",
        "- one",
        "  - nested",
        "- [ ] open box",
        "1. first",
        "| A | B |",
        "|---|---|",
        "| x | y |",
        "> Based on an older version",
      ].join("\n"),
    );
    expect(html).toContain("<h1>Product Backlog</h1>");
    expect(html).toContain("<p>Based on Decision_Doc version 1.</p>");
    expect(html).toContain("<strong>Demo point:</strong> see <code>tags</code>");
    expect(html).toContain("<ul><li>one<ul><li>nested</li></ul></li><li class=\"task\"><span class=\"box\" aria-hidden=\"true\">☐</span> open box</li></ul>");
    expect(html).toContain("<ol><li>first</li></ol>");
    expect(html).toContain("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table>");
    expect(html).toContain("<blockquote>Based on an older version</blockquote>");
  });

  it("escapes every text, also inside code and quotes from repository files", () => {
    const html = markdownToHtml('Run `<script>alert(1)</script>` and <img src=x onerror="x">\n- **<b>x</b>**');
    expect(html).not.toMatch(/<script|<img|<b>/);
    expect(html).toContain("&lt;script&gt;");
  });
});
