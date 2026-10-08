import { describe, expect, it } from "vitest";
import { adfToMarkdown, type AdfNode } from "@/lib/jira/adf/to-markdown";

const doc = (...content: AdfNode[]): AdfNode => ({ type: "doc", content });
const p = (...content: AdfNode[]): AdfNode => ({ type: "paragraph", content });
const t = (text: string, marks?: AdfNode["marks"]): AdfNode => ({ type: "text", text, marks });

describe("adfToMarkdown", () => {
  it("boş ve düz metin girdileri", () => {
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown(undefined)).toBe("");
    expect(adfToMarkdown("düz metin")).toBe("düz metin");
    expect(adfToMarkdown(42)).toBe("");
  });

  it("paragraf, başlık ve işaretler", () => {
    const md = adfToMarkdown(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [t("Kabul Kriterleri")] },
        p(t("Kalın", [{ type: "strong" }]), t(" ve "), t("kod", [{ type: "code" }]), t(" "), t("link", [{ type: "link", attrs: { href: "https://x.y" } }])),
      ),
    );
    expect(md).toBe("## Kabul Kriterleri\n\n**Kalın** ve `kod` [link](https://x.y)");
  });

  it("iç içe listeler", () => {
    const md = adfToMarkdown(
      doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p(t("Bir")),
              { type: "orderedList", content: [{ type: "listItem", content: [p(t("Alt"))] }] },
            ],
          },
          { type: "listItem", content: [p(t("İki"))] },
        ],
      }),
    );
    expect(md).toBe("- Bir\n  1. Alt\n- İki");
  });

  it("mention, kod bloğu ve tablo", () => {
    const md = adfToMarkdown(
      doc(
        p({ type: "mention", attrs: { id: "abc", text: "@Ayşe" } }, t(" bakar mısın")),
        { type: "codeBlock", attrs: { language: "sql" }, content: [t("select 1")] },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("Alan"))] }, { type: "tableHeader", content: [p(t("Değer"))] }] },
            { type: "tableRow", content: [{ type: "tableCell", content: [p(t("a|b"))] }, { type: "tableCell", content: [p(t("1"))] }] },
          ],
        },
      ),
    );
    expect(md).toBe("@Ayşe bakar mısın\n\n```sql\nselect 1\n```\n\n| Alan | Değer |\n| --- | --- |\n| a\\|b | 1 |");
  });

  it("bilinmeyen düğümlerde içeriği kaybetmez", () => {
    expect(adfToMarkdown(doc({ type: "yeniTip", content: [p(t("içerik"))] }))).toBe("içerik");
  });
});

describe("adfToMarkdown — gerçek dünya yapıları", () => {
  it("yalnızca satır içi düğüm taşıyan bilinmeyen kapsayıcıyı tek satırda tutar", () => {
    const md = adfToMarkdown(
      doc({
        type: "decisionList",
        content: [{ type: "decisionItem", content: [t("Use "), t("bold", [{ type: "strong" }]), t(" here")] }],
      }),
    );
    expect(md).toBe("Use **bold** here");
  });

  it("iç içe görev listesini girintili ve durumuyla korur", () => {
    const md = adfToMarkdown(
      doc({
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { state: "TODO" }, content: [t("ana")] },
          { type: "taskList", content: [{ type: "taskItem", attrs: { state: "DONE" }, content: [t("alt")] }] },
        ],
      }),
    );
    expect(md).toBe("- [ ] ana\n  - [x] alt");
  });

  it("liste öğesindeki çok satırlı kod bloğunun tüm satırlarını hizalar", () => {
    const md = adfToMarkdown(
      doc({
        type: "bulletList",
        content: [{ type: "listItem", content: [p(t("a")), { type: "codeBlock", content: [t("x\ny")] }] }],
      }),
    );
    expect(md).toBe("- a\n  ```\n  x\n  y\n  ```");
  });
});
