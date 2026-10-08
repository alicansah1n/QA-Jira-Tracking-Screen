import type { AdfNode } from "./to-markdown";

/**
 * ADF (Atlassian Document Format) üreticileri. Yorumlar her zaman metin düğümleriyle kurulur;
 * kullanıcıdan ya da Jira'dan gelen metin işaretleme olarak yorumlanmaz (enjeksiyon yok).
 */
export type Inline = AdfNode;

export const text = (value: string, marks?: AdfNode["marks"]): Inline => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
export const strong = (value: string): Inline => text(value, [{ type: "strong" }]);
export const mention = (accountId: string, displayName: string): Inline => ({
  type: "mention",
  attrs: { id: accountId, text: `@${displayName}` },
});

/** Yalnızca http/https bağlantılar link olur; diğerleri düz metin kalır. */
export function link(label: string, href: string): Inline {
  try {
    const url = new URL(href);
    if (url.protocol === "https:" || url.protocol === "http:") return text(label, [{ type: "link", attrs: { href: url.toString() } }]);
  } catch {
    // geçersiz adres → düz metin
  }
  return text(label);
}

export const paragraph = (...content: Inline[]): AdfNode => ({
  type: "paragraph",
  content: content.filter((n) => n.type !== "text" || (n.text ?? "") !== ""),
});

export const bulletList = (items: Inline[][]): AdfNode => ({
  type: "bulletList",
  content: items.map((inline) => ({ type: "listItem", content: [paragraph(...inline)] })),
});

export const heading = (level: 1 | 2 | 3 | 4 | 5 | 6, value: string): AdfNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});

export const doc = (...content: AdfNode[]): AdfNode & { version: 1 } => ({ type: "doc", version: 1, content });

/** Çok satırlı düz metni (kullanıcının düzenlediği yorum) paragraflara böler. */
export function plainTextToAdf(value: string): AdfNode & { version: 1 } {
  const paragraphs = value
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const content: Inline[] = [];
      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: "hardBreak" });
        if (line) content.push(text(line));
      });
      return { type: "paragraph", content } satisfies AdfNode;
    });
  return doc(...(paragraphs.length ? paragraphs : [paragraph()]));
}
