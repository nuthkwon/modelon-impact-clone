/**
 * Pure helpers behind the SIMULATIONS tab's "…" menu (docs/UI_SPEC.md §6.5). Unit-tested in
 * resultActions.test.ts.
 */
import type { ResultEntry } from '../../store/types';

export interface CsvDownload {
  /** False when there is nothing to download; `reason` then explains why (shown as the item's tooltip). */
  enabled: boolean;
  reason?: string;
  /** `Result1.csv`, or `Result1_case_2.csv` for multi-case results. */
  filename: string;
}

/** State of "Download result (CSV)" for the selected case of a result. */
export function csvDownloadFor(r: ResultEntry, caseId: string | undefined, workspaceId: string | undefined): CsvDownload {
  const c = caseId ? r.cases.find((x) => x.id === caseId) : undefined;
  const filename = `${r.name}${r.cases.length > 1 && caseId ? `_${c?.meta?.label ?? caseId}` : ''}.csv`;
  if (!workspaceId || !caseId) return { enabled: false, reason: 'No case selected', filename };
  return { enabled: true, filename };
}
