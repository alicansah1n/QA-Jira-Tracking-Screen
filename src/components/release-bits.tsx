import { CalendarClock, CalendarX2, CalendarCheck2, CalendarOff } from "lucide-react";
import type { ReleaseSummary } from "@/domain/releases/service";
import { formatDate } from "@/lib/format";
import { Badge, SegmentBar } from "./ui";

/** Release'in tarih durumu: gecikmiş / yaklaşıyor / planlı / tarihsiz. */
export function TimingBadge({ release }: { release: Pick<ReleaseSummary, "timing" | "daysToRelease" | "releaseDate"> }) {
  const d = release.daysToRelease ?? 0;
  switch (release.timing) {
    case "overdue":
      return (
        <Badge tone="danger">
          <CalendarX2 className="size-3.5" /> {Math.abs(d)} gün gecikti
        </Badge>
      );
    case "soon":
      return (
        <Badge tone="warning">
          <CalendarClock className="size-3.5" /> {d === 0 ? "Bugün" : d === 1 ? "Yarın" : `${d} gün kaldı`}
        </Badge>
      );
    case "scheduled":
      return (
        <Badge tone="neutral">
          <CalendarCheck2 className="size-3.5" /> {formatDate(release.releaseDate)}
        </Badge>
      );
    default:
      return (
        <Badge tone="neutral">
          <CalendarOff className="size-3.5" /> Tarih yok
        </Badge>
      );
  }
}

export function ReleaseProgress({ counts }: { counts: ReleaseSummary["counts"] }) {
  return (
    <SegmentBar
      total={counts.total}
      segments={[
        { label: "Tamamlanan", value: counts.done, className: "bg-success" },
        { label: "Devam eden", value: counts.inProgress, className: "bg-info" },
        { label: "Başlanmamış", value: counts.todo, className: "bg-subtle/60" },
      ]}
    />
  );
}
