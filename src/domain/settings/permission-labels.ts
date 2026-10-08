import type { RequiredPermission } from "@/lib/jira/api";

export const PERMISSION_LABELS: Record<RequiredPermission, { label: string; neededFor: string }> = {
  BROWSE_PROJECTS: { label: "Projeyi görüntüleme", neededFor: "Tüm ekranlar" },
  TRANSITION_ISSUES: { label: "Statü değiştirme", neededFor: "Madde kapatma, release kapatma" },
  EDIT_ISSUES: { label: "Madde düzenleme", neededFor: "Test Assignee / StoryPointTest doldurma" },
  ADD_COMMENTS: { label: "Yorum ekleme", neededFor: "Developer'a bilgi talebi, test özeti" },
  DELETE_OWN_COMMENTS: { label: "Kendi yorumunu silme", neededFor: "Release kapatma geri alma" },
  CREATE_ATTACHMENTS: { label: "Ek yükleme", neededFor: "HTML test raporu" },
  ADMINISTER_PROJECTS: { label: "Proje yönetimi (versiyon)", neededFor: "Release'i kapatma" },
};
