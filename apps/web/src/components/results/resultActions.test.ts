import { describe, expect, it } from 'vitest';
import type { CaseDto } from '@impact/protocol';
import type { ResultEntry } from '../../store/types';
import { csvDownloadFor } from './resultActions';

const mkCase = (id: string, status: CaseDto['run_info']['status'], label = id): CaseDto => ({ id, run_info: { status }, meta: { label } }) as unknown as CaseDto;
const mkResult = (cases: CaseDto[], status: ResultEntry['status'] = 'successful'): ResultEntry =>
  ({ id: 'r1', name: 'Result1', className: 'M', createdAt: '', status, cases, startTime: 0, stopTime: 1 }) as ResultEntry;

describe('csvDownloadFor', () => {
  it('is enabled for a successful case and names the file after the result', () => {
    const d = csvDownloadFor(mkResult([mkCase('case_1', 'successful')]), 'case_1', 'ws');
    expect(d).toEqual({ enabled: true, filename: 'Result1.csv' });
  });

  it('is disabled with a reason when the selected case has no result', () => {
    const cases = [mkCase('case_1', 'successful'), mkCase('case_2', 'failed'), mkCase('case_3', 'cancelled'), mkCase('case_4', 'not_started'), mkCase('case_5', 'started')];
    const r = mkResult(cases, 'partial');
    expect(csvDownloadFor(r, 'case_1', 'ws')).toEqual({ enabled: true, filename: 'Result1_case_1.csv' });
    for (const id of ['case_2', 'case_3', 'case_4', 'case_5']) {
      const d = csvDownloadFor(r, id, 'ws');
      expect(d.enabled, id).toBe(false);
      expect(d.reason, id).toMatch(/result|finished/i);
      expect(d.filename).toBe(`Result1_${id}.csv`);
    }
    expect(csvDownloadFor(mkResult([mkCase('case_1', 'failed')], 'failed'), 'case_1', 'ws').enabled).toBe(false);
  });

  it('is disabled without a workspace or a case and uses the case label in the file name', () => {
    const r = mkResult([mkCase('case_1', 'successful', 'R=10'), mkCase('case_2', 'successful', 'R=20')]);
    expect(csvDownloadFor(r, 'case_2', 'ws')).toEqual({ enabled: true, filename: 'Result1_R=20.csv' });
    expect(csvDownloadFor(r, 'case_2', undefined).enabled).toBe(false);
    expect(csvDownloadFor(r, undefined, 'ws').enabled).toBe(false);
    expect(csvDownloadFor(r, 'case_9', 'ws').enabled).toBe(false);
  });
});
