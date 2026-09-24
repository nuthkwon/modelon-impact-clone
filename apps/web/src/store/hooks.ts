/**
 * React hooks layered on the store (the store itself never imports React).
 */
import { useEffect } from 'react';
import { useStore } from './index';

/**
 * Requests the trajectories of `variables` (plus `time`) of a result/case that are not cached yet.
 * The request is shared with every other caller (`ensureTrajectories` de-duplicates in-flight keys
 * and batches one request per result/case per render pass), so a list can call this once instead of
 * relying on `valueAt()`'s implicit fetch. Failed requests are not retried until the inputs change.
 */
export function useEnsureTrajectories(resultId: string | undefined, caseId: string | undefined, variables: readonly string[]): void {
  const ensureTrajectories = useStore((s) => s.ensureTrajectories);
  // A fresh array with the same names must not refetch, so the effect keys on the joined names.
  const signature = variables.join('\u0000');
  useEffect(() => {
    if (!resultId || !caseId || !signature) return;
    void ensureTrajectories(resultId, caseId, signature.split('\u0000')).catch(() => undefined);
  }, [ensureTrajectories, resultId, caseId, signature]);
}

export default useEnsureTrajectories;
