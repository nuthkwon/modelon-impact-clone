/**
 * Module-level cache for `GET .../cases/:cid/result/meta` (variable kinds, units, descriptions),
 * keyed by `${resultId}/${caseId}`. Failures resolve to undefined so callers fall back to
 * name/trajectory-based classification.
 */
import { useEffect, useState } from 'react';
import type { CaseResultMetaResponse, CaseVariableMeta } from '@impact/protocol';
import { api } from '../../api/client';
import { useStore } from '../../store';

export type VariableMetaMap = Map<string, CaseVariableMeta>;

const pending = new Map<string, Promise<VariableMetaMap | undefined>>();
const resolved = new Map<string, VariableMetaMap | undefined>();

const keyOf = (resultId: string, caseId: string) => `${resultId}/${caseId}`;

export function getCaseMeta(wid: string, resultId: string, caseId: string): Promise<VariableMetaMap | undefined> {
  const key = keyOf(resultId, caseId);
  if (resolved.has(key)) return Promise.resolve(resolved.get(key));
  let p = pending.get(key);
  if (!p) {
    p = api.getCaseResultMeta(wid, resultId, caseId).then(
      (m: CaseResultMetaResponse) => {
        const map: VariableMetaMap = new Map(m.variables.map((v) => [v.name, v]));
        resolved.set(key, map);
        pending.delete(key);
        return map;
      },
      () => {
        resolved.set(key, undefined);
        pending.delete(key);
        return undefined;
      },
    );
    pending.set(key, p);
  }
  return p;
}

/** Synchronous lookup of already-loaded meta. */
export function peekCaseMeta(resultId?: string, caseId?: string): VariableMetaMap | undefined {
  if (!resultId || !caseId) return undefined;
  return resolved.get(keyOf(resultId, caseId));
}

/** Drops cached meta for a result (after deletion). */
export function forgetResultMeta(resultId: string): void {
  for (const k of [...resolved.keys()]) if (k.startsWith(`${resultId}/`)) resolved.delete(k);
  for (const k of [...pending.keys()]) if (k.startsWith(`${resultId}/`)) pending.delete(k);
}

/** Variable meta for a case, loaded once and shared; undefined while loading or when unavailable. */
export function useCaseMeta(resultId?: string, caseId?: string): VariableMetaMap | undefined {
  const wid = useStore((s) => s.workspaceId);
  const [meta, setMeta] = useState<VariableMetaMap | undefined>(() => peekCaseMeta(resultId, caseId));
  useEffect(() => {
    if (!wid || !resultId || !caseId) {
      setMeta(undefined);
      return;
    }
    const cached = peekCaseMeta(resultId, caseId);
    setMeta(cached);
    if (cached) return;
    let alive = true;
    void getCaseMeta(wid, resultId, caseId).then((m) => {
      if (alive) setMeta(m);
    });
    return () => {
      alive = false;
    };
  }, [wid, resultId, caseId]);
  return meta;
}

/** Display unit for a variable (`displayUnit` preferred), or undefined. */
export function unitOf(meta: VariableMetaMap | undefined, variable: string): string | undefined {
  const m = meta?.get(variable);
  return m?.displayUnit || m?.unit || undefined;
}
