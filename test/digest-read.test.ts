import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const dirs: string[] = [];
function tmpRuns(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28')!;

  it('names the night from the file, not from `at`', () => {
    expect(night.night).toBe('2026-10-28');
    expect(night.empty).toBe(false);
  });

  it('gives 5 jobs, sorted by job', () => {
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('builds each row', () => {
    const row = (job: string) => night.rows.find((r) => r.job === job);
    expect(row('digest/render')).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
    });
    expect(row('fixtures/refresh')).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503', owner: 'rook' });
    expect(row('lane/sync')).toEqual({
      job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(row('notes/backup')).toMatchObject({ runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
    expect(row('rig/rotate-logs')).toMatchObject({ runs: 1, retries: 0, lastStatus: 'ok', lastError: null, owner: 'lane-07' });
  });

  it('counts 1 bad line, recovered, never merged into lane/sync', () => {
    expect(night.badLines).toBe(1);
    expect(night.unreadable).toEqual([{ line: 16, at: '2026-10-29T05:59:58+01:00', job: 'lane/sy' }]);
  });

  it('counts readable lines by status', () => {
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight on runs/2026-10-27.jsonl', () => {
  it('counts 7 ok and no bad lines', () => {
    const night = readNight('runs', '2026-10-27')!;
    expect(night.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
    expect(night.badLines).toBe(0);
  });
});

describe('readNight edge cases', () => {
  it('returns null for a missing file', () => {
    expect(readNight(tmpRuns({}), '2026-10-30')).toBeNull();
  });

  it('returns null for a night that is not a date', () => {
    expect(readNight('runs', '../package')).toBeNull();
  });

  it('tells an empty file apart from a missing one', () => {
    const dir = tmpRuns({ '2026-10-30.jsonl': '', '2026-10-31.jsonl': '\n  \n\n' });
    for (const n of ['2026-10-30', '2026-10-31']) {
      const night = readNight(dir, n);
      expect(night).not.toBeNull();
      expect(night).toMatchObject({ empty: true, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    }
  });

  it('counts wrong shapes as unreadable, never throws', () => {
    const lines = [
      '{"at":"2026-10-30T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '{"job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-10-30T01:00:00+01:00","status":"ok","owner":"x"}',
      '{"at":"2026-10-30T01:00:00+01:00","job":"a","status":"weird","owner":"x"}',
      '{"at":"2026-10-30T01:00:00+01:00","job":"a","status":"ok","owner":7}',
      '{"at":"not a time","job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-10-30T01:00:00+01:00","job":"a","status":"ok"}',
      '[1,2]',
      'garbage',
      '',
    ];
    const night = readNight(tmpRuns({ '2026-10-30.jsonl': lines.join('\n') + '\n' }), '2026-10-30')!;
    expect(night.rows).toHaveLength(1);
    expect(night.rows[0]!.runs).toBe(1);
    expect(night.badLines).toBe(8);
    expect(night.unreadable.map((u) => u.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(night.unreadable[1]).toEqual({ line: 3, at: '2026-10-30T01:00:00+01:00', job: null });
    expect(night.unreadable[7]).toEqual({ line: 9, at: null, job: null });
  });

  it('orders by parsed instant across offsets, keeps `at` as logged', () => {
    const lines = [
      '{"at":"2026-10-30T02:30:00+01:00","job":"j","status":"retry","owner":"b","error":"late"}',
      '{"at":"2026-10-30T00:00:00Z","job":"j","status":"ok","owner":"a","error":"early"}',
      '{"at":"2026-10-30T02:00:00+01:00","job":"j","status":"fail","owner":"c","error":"mid"}',
      '{"at":"2026-10-30T03:00:00+02:00","job":"j","status":"ok","owner":"d"}',
    ];
    const night = readNight(tmpRuns({ '2026-10-30.jsonl': lines.join('\n') }), '2026-10-30')!;
    // Instants: 00:00Z, 01:00Z (+02 line), 01:00Z (+01 02:00), 01:30Z
    expect(night.rows[0]).toEqual({
      job: 'j', owner: 'b', runs: 4, retries: 1, lastStatus: 'retry', lastError: 'late',
      firstAt: '2026-10-30T00:00:00Z', lastAt: '2026-10-30T02:30:00+01:00',
    });
  });

  it('keeps the latest error even when the last status is ok', () => {
    const lines = [
      '{"at":"2026-10-30T01:00:00+01:00","job":"j","status":"retry","owner":"a","error":"boom"}',
      '{"at":"2026-10-30T01:05:00+01:00","job":"j","status":"ok","owner":"a"}',
    ];
    const night = readNight(tmpRuns({ '2026-10-30.jsonl': lines.join('\r\n') + '\r\n' }), '2026-10-30')!;
    expect(night.rows[0]).toMatchObject({ lastStatus: 'ok', lastError: 'boom', runs: 2 });
    expect(night.badLines).toBe(0);
  });
});
