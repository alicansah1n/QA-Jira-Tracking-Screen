import { doc, mention, paragraph, text } from "@/lib/jira/adf/build";
import type { IssueRow, UserLite } from "@/domain/issues/row";

export const DEV_REQUEST_PROPERTY = "qa-assistant.devRequest";
export const COMMENT_MARKER_PROPERTY = "qa-assistant";

export type DevRequestEligibility =
  | { eligible: true; developers: UserLite[] }
  | { eligible: false; reason: "has-component" | "has-comment" | "no-developer" | "no-field" };

/**
 * Kural: component'i ve yorumu olmayan maddede, Developer alanındaki kişiye bilgi talebi gönderilir.
 * Developer alanı eşlenmemişse ya da boşsa gönderilemez (kimi etiketleyeceğimizi bilmeyiz).
 */
export function devRequestEligibility(row: IssueRow, developerFieldMapped: boolean): DevRequestEligibility {
  if (row.components.length > 0) return { eligible: false, reason: "has-component" };
  if (row.commentCount > 0) return { eligible: false, reason: "has-comment" };
  if (!developerFieldMapped) return { eligible: false, reason: "no-field" };
  if (row.developers.length === 0) return { eligible: false, reason: "no-developer" };
  return { eligible: true, developers: row.developers };
}

export const ELIGIBILITY_LABELS: Record<Exclude<DevRequestEligibility, { eligible: true }>["reason"], string> = {
  "has-component": "Component girilmiş",
  "has-comment": "Maddede yorum var",
  "no-developer": "Developer alanı boş",
  "no-field": "Developer alanı eşlenmemiş",
};

export const DEV_REQUEST_BODY =
  "Bu maddede yapılan geliştirme hakkında kısaca bilgi verebilir misiniz? Ayrıca geliştirmenin test ortamında olduğunu doğrulayabilir misiniz? Teşekkürler.";

/** Sabit şablon: madde içeriği metne hiç girmez (enjeksiyon riski yok). */
export function devRequestText(developers: readonly UserLite[]): string {
  const names = developers.map((d) => `@${d.displayName}`).join(", ");
  return `Merhaba ${names}, ${DEV_REQUEST_BODY}`;
}

export function devRequestAdf(developers: readonly UserLite[]) {
  const mentions = developers.flatMap((d, i) => (i === 0 ? [mention(d.accountId, d.displayName)] : [text(", "), mention(d.accountId, d.displayName)]));
  return doc(
    paragraph(text("Merhaba "), ...mentions, text(",")),
    paragraph(
      text("Bu maddede yapılan geliştirme hakkında kısaca bilgi verebilir misiniz? Ayrıca geliştirmenin "),
      text("test ortamında", [{ type: "strong" }]),
      text(" olduğunu doğrulayabilir misiniz?"),
    ),
    paragraph(text("Teşekkürler.")),
  );
}
