import type { JiraField, JiraStatus } from "@/lib/jira/schemas";
import type { FieldRef, FieldSpec, StatusRef } from "./schema";

export type FieldCandidate = FieldRef & {
  type: string;
  exactName: boolean;
  typeMatches: boolean;
};

export type FieldDiscovery = {
  candidates: FieldCandidate[];
  /** Yalnızca tek bir kesin eşleşme varsa önerilir; belirsizlikte kullanıcı seçer. */
  suggestion?: FieldRef;
};

const normalize = (s: string) => s.trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");

function fieldType(field: JiraField): string {
  const schema = field.schema;
  if (!schema) return "unknown";
  return schema.type === "array" && schema.items ? `array<${schema.items}>` : schema.type;
}

function typeMatches(field: JiraField, spec: FieldSpec): boolean {
  const schema = field.schema;
  if (!schema) return false;
  if (!spec.types.includes(schema.type)) return false;
  // Çoklu alanlar yalnızca kullanıcı listesiyse kabul edilir.
  return schema.type !== "array" || schema.items === "user";
}

/** Jira alan listesinden, spec'e uyan alanları puanlayarak döndürür. */
export function discoverField(fields: readonly JiraField[], spec: FieldSpec): FieldDiscovery {
  const wanted = spec.names.map(normalize);
  const candidates = fields
    .filter((f) => f.custom)
    .map((f): FieldCandidate | undefined => {
      const name = normalize(f.name);
      const exactName = wanted.includes(name);
      const partial = wanted.some((w) => name.includes(w) || w.includes(name));
      if (!exactName && !partial) return undefined;
      return { id: f.id, name: f.name, type: fieldType(f), exactName, typeMatches: typeMatches(f, spec) };
    })
    .filter((c): c is FieldCandidate => c !== undefined)
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, "tr"));

  const certain = candidates.filter((c) => c.exactName && c.typeMatches);
  const only = certain.length === 1 ? certain[0] : undefined;
  return { candidates, suggestion: only ? { id: only.id, name: only.name } : undefined };
}

const score = (c: FieldCandidate) => (c.exactName ? 2 : 0) + (c.typeMatches ? 1 : 0);

/** Statü adına göre tek bir kesin eşleşme varsa önerir. */
export function suggestStatus(statuses: readonly JiraStatus[], names: readonly string[]): StatusRef | undefined {
  const wanted = names.map(normalize);
  const matches = statuses.filter((s) => wanted.includes(normalize(s.name)));
  const only = matches.length === 1 ? matches[0] : undefined;
  return only ? { id: only.id, name: only.name } : undefined;
}

/** Adında "test" geçen ve tamamlanmamış statüler, "testte" statüsü adayı olarak önerilir. */
export function suggestInTestStatuses(statuses: readonly JiraStatus[]): StatusRef[] {
  return statuses
    .filter((s) => /test/i.test(s.name) && s.statusCategory?.key !== "done")
    .map((s) => ({ id: s.id, name: s.name }));
}
