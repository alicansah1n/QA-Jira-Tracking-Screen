import type { ReactNode } from "react";
import type { IssueRow } from "@/domain/issues/row";
import { formatRelative } from "@/lib/format";
import { Avatar, cn, IssueKey, StatusPill } from "./ui";

/** Listelerde tek satırlık madde görünümü (tip ikonu, anahtar, özet, statü, kişiler). */
export function IssueLine({
  issue,
  jiraBaseUrl,
  badges,
  actions,
  leading,
  className,
}: {
  issue: IssueRow;
  jiraBaseUrl?: string;
  badges?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  className?: string;
}) {
  const href = jiraBaseUrl ? `${jiraBaseUrl}/browse/${encodeURIComponent(issue.key)}` : undefined;
  const people = issue.developers.length ? issue.developers : issue.assignee ? [issue.assignee] : [];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-surface-2/60", className)}>
      {leading}
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {issue.issueType?.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={issue.issueType.iconUrl} alt={issue.issueType.name} title={issue.issueType.name} width={16} height={16} className="mt-0.5 shrink-0" referrerPolicy="no-referrer" />
        ) : (
          <span className="mt-1 size-3 shrink-0 rounded-sm bg-surface-3" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <IssueKey value={issue.key} href={href} />
            <span className="text-xs text-subtle">·</span>
            <span className="text-xs text-muted">{issue.project.name || issue.project.key}</span>
            {badges}
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug">{issue.summary}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <StatusPill name={issue.status.name} category={issue.status.category} />
        {issue.priority?.iconUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={issue.priority.iconUrl} alt={issue.priority.name} title={`Öncelik: ${issue.priority.name}`} width={16} height={16} referrerPolicy="no-referrer" />
        )}
        <div className="flex -space-x-1.5" title={people.map((p) => p.displayName).join(", ")}>
          {people.slice(0, 3).map((p) => (
            <span key={p.accountId} className="rounded-full ring-2 ring-surface">
              <Avatar name={p.displayName} url={p.avatarUrl} size={24} />
            </span>
          ))}
        </div>
        <span className="hidden w-24 text-right text-xs text-subtle lg:inline" title={issue.updated}>
          {formatRelative(issue.updated)}
        </span>
        {actions}
      </div>
    </div>
  );
}
