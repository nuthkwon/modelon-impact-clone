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
  if (!workspaceId || !c) return { enabled: false, reason: 'No case selected', filename };
  // The server only holds a result file for a successful case (404 / 409 otherwise).
  switch (c.run_info.status) {
    case 'successful':
      return { enabled: true, filename };
    case 'not_started':
    case 'started':
      return { enabled: false, reason: 'The case has not finished yet', filename };
    case 'failed':
      return { enabled: false, reason: 'The case failed; there is no result to download', filename };
    case 'cancelled':
      return { enabled: false, reason: 'The case was cancelled; there is no result to download', filename };
    default:
      return { enabled: false, reason: 'There is no result to download for this case', filename };
  }
}
