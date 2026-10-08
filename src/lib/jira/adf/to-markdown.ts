/** Atlassian Document Format düğümü (yalnızca okunan kısımlar). */
export type AdfNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
};

const INLINE_TYPES = new Set(["text", "hardBreak", "mention", "emoji", "inlineCard", "status", "date", "inlineExtension"]);

function isNode(value: unknown): value is AdfNode {
  return typeof value === "object" && value !== null && typeof (value as AdfNode).type === "string";
}

const attr = (node: AdfNode, key: string): string => {
  const value = node.attrs?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

function inline(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(inlineNode).join("");
}

function inlineNode(node: AdfNode): string {
  switch (node.type) {
    case "text":
      return applyMarks(node.text ?? "", node.marks);
    case "hardBreak":
      return "  \n";
    case "mention":
      return attr(node, "text") || "@kullanıcı";
    case "emoji":
      return attr(node, "text") || attr(node, "shortName");
    case "inlineCard":
    case "blockCard":
      return attr(node, "url");
    case "status":
      return `[${attr(node, "text")}]`;
    case "date": {
      const ts = Number(attr(node, "timestamp"));
      return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString().slice(0, 10) : "";
    }
    default:
      return inline(node.content);
  }
}

function applyMarks(value: string, marks: AdfNode["marks"]): string {
  let out = value;
  for (const mark of marks ?? []) {
    if (mark.type === "code") out = `\`${out}\``;
    else if (mark.type === "strong") out = `**${out}**`;
    else if (mark.type === "em") out = `*${out}*`;
    else if (mark.type === "strike") out = `~~${out}~~`;
    else if (mark.type === "link" && typeof mark.attrs?.href === "string") out = `[${out}](${mark.attrs.href})`;
  }
  return out;
}

function block(node: AdfNode, depth: number): string {
  switch (node.type) {
    case "doc":
      return blocks(node.content, depth);
    case "paragraph":
      return inline(node.content);
    case "heading": {
      const level = Math.min(Math.max(Number(attr(node, "level")) || 1, 1), 6);
      return `${"#".repeat(level)} ${inline(node.content)}`;
    }
    case "bulletList":
      return list(node, depth, () => "-");
    case "orderedList": {
      const start = Number(attr(node, "order")) || 1;
      return list(node, depth, (i) => `${start + i}.`);
    }
    case "taskList":
      return (node.content ?? [])
        .map((item) =>
          // Görev listeleri iç içe görev listesi içerebilir.
          item.type === "taskList"
            ? block(item, depth + 1)
            : `${"  ".repeat(depth)}- [${attr(item, "state") === "DONE" ? "x" : " "}] ${inline(item.content)}`,
        )
        .join("\n");
    case "codeBlock":
      return `\`\`\`${attr(node, "language")}\n${(node.content ?? []).map((n) => n.text ?? "").join("")}\n\`\`\``;
    case "blockquote":
      return blocks(node.content, depth)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "panel":
      return `> **${attr(node, "panelType") || "not"}:** ${blocks(node.content, depth).replace(/\n/g, "\n> ")}`;
    case "rule":
      return "---";
    case "table":
      return table(node);
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return "[ek: görsel/dosya]";
    case "expand":
    case "nestedExpand":
      return [attr(node, "title") && `**${attr(node, "title")}**`, blocks(node.content, depth)].filter(Boolean).join("\n\n");
    default:
      if (!node.content) return inlineNode(node);
      // Bilinmeyen ama yalnızca satır içi düğüm taşıyan kapsayıcılar (ör. decisionItem) tek satırdır.
      return node.content.every((c) => INLINE_TYPES.has(c.type)) ? inline(node.content) : blocks(node.content, depth);
  }
}

function blocks(nodes: AdfNode[] | undefined, depth: number): string {
  return (nodes ?? [])
    .map((n) => block(n, depth))
    .filter((s) => s.trim() !== "")
    .join("\n\n");
}

function list(node: AdfNode, depth: number, marker: (i: number) => string): string {
  const indent = "  ".repeat(depth);
  return (node.content ?? [])
    .map((item, i) => {
      const [first, ...rest] = item.content ?? [];
      // Çok satırlı blokların (kod, alıntı) her satırı öğeye hizalanır; aksi halde liste bozulur.
      const align = (text: string) => text.replace(/\n/g, `\n${indent}  `);
      const head = first ? align(block(first, depth + 1)) : "";
      const tail = rest.map((child) => {
        const rendered = block(child, depth + 1);
        // İç içe listeler kendi girintisini taşır.
        return child.type.endsWith("List") ? rendered : `${indent}  ${align(rendered)}`;
      });
      return [`${indent}${marker(i)} ${head}`, ...tail].join("\n");
    })
    .join("\n");
}

function table(node: AdfNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => blocks(cell.content, 0).replace(/\n+/g, " ").replace(/\|/g, "\\|")),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  const [header, ...body] = rows.map(pad);
  return [`| ${header!.join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join(
    "\n",
  );
}

/** ADF belgesini Markdown'a çevirir. Düz metin ya da boş değerleri de kabul eder. */
export function adfToMarkdown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (!isNode(value)) return "";
  return block(value, 0).trim();
}
