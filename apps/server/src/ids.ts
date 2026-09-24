import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Short random id such as `ws_k3f9a2b7cd`. */
export function shortId(prefix: string, length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}${out}`;
}

export const newWorkspaceId = () => shortId('ws_');
export const newProjectId = () => shortId('prj_');
export const newContentId = () => shortId('cnt_');
export const newLibraryId = () => shortId('lib_');
export const newExperimentId = () => shortId('exp_');
export const newExecutableId = () => shortId('fmu_');
export const caseId = (index: number) => `case_${index}`;

/** Numeric suffix of a `case_N` id, used for ordering. */
export function caseIndex(id: string): number {
  const m = /^case_(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}
