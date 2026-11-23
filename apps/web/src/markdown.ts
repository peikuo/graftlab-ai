// A small Markdown renderer for the Studio's own documents (Output_Docs). It knows the subset the Studio writes:
// headings, paragraphs, bullet and numbered lists (nested by indentation), task boxes, tables, block quotes,
// fenced code, **bold**, *italic* and `code`. Every text is HTML-escaped before any markup is added, so document
// text (which can quote repository files) can never inject markup.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  const parts = s.split(/(`[^`]*`)/g);
  return parts
    .map((p) => {
      if (p.startsWith("`") && p.endsWith("`") && p.length >= 2) return `<code>${esc(p.slice(1, -1))}</code>`;
      return esc(p)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    })
    .join("");
}

interface ListItem {
  indent: number;
  ordered: boolean;
  text: string;
}

function renderList(items: ListItem[]): string {
  let html = "";
  const stack: { indent: number; tag: string }[] = [];
  for (const it of items) {
    while (stack.length && it.indent < stack.at(-1)!.indent) html += `</li></${stack.pop()!.tag}>`;
    const want = it.ordered ? "ol" : "ul";
    if (stack.length && stack.at(-1)!.indent === it.indent && stack.at(-1)!.tag !== want) html += `</li></${stack.pop()!.tag}>`;
    const top = stack.at(-1);
    if (!top || it.indent > top.indent) {
      const tag = it.ordered ? "ol" : "ul";
      stack.push({ indent: it.indent, tag });
      html += `<${tag}>`;
    } else html += "</li>";
    const box = /^\[( |x)\]\s+/.exec(it.text);
    html += box ? `<li class="task"><span class="box" aria-hidden="true">${box[1] === "x" ? "☑" : "☐"}</span> ${inline(it.text.slice(box[0].length))}` : `<li>${inline(it.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop()!.tag}>`;
  return html;
}

function renderTable(rows: string[]): string {
  const cells = (r: string) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const [head, , ...body] = rows;
  return `<table><thead><tr>${cells(head!).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++;
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const n = h[1]!.length;
      out.push(`<h${n}>${inline(h[2]!)}</h${n}>`);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) q.push(lines[i++]!.replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1]!)) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(lines[i++]!);
      out.push(renderTable(rows));
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]!)!;
        items.push({ indent: m[1]!.length, ordered: /\d/.test(m[2]!), text: m[3]! });
        i++;
      }
      out.push(renderList(items));
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|>|```|\s*([-*]|\d+\.)\s+|\s*\|)/.test(lines[i]!)) para.push(lines[i++]!);
    if (para.length === 0) para.push(lines[i++]!);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}
