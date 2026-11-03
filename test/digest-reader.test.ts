import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/', () => {
  it('reads 2026-10-28: 5 jobs, 1 bad line', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night).not.toBeNull();
    if (night === null) return;

    expect(night.night).toBe('2026-10-28');
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);

    const byJob = new Map(night.rows.map((r) => [r.job, r]));
    expect(byJob.get('fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(byJob.get('digest/render')?.owner).toBeNull();
    expect(byJob.get('notes/backup')).toMatchObject({
      owner: 'lane-07',
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
    expect(byJob.get('lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('reads 2026-10-27 cleanly', () => {
    const night = readNight('runs', '2026-10-27');
    expect(night?.badLines).toBe(0);
    expect(night?.rows.map((r) => r.job)).toEqual([
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.rows.find((r) => r.job === 'lane/sync')?.runs).toBe(4);
  });

  it('returns null for a night with no file', () => {
    expect(readNight('runs', '1999-01-01')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight('runs', '../runs/2026-10-28')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
    expect(readNight('runs', '')).toBeNull();
  });
});

describe('readNight on a temp dir', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('an empty file gives no rows and no bad lines', () => {
    writeFileSync(join(dir, '2026-11-01.jsonl'), '');
    expect(readNight(dir, '2026-11-01')).toEqual({ night: '2026-11-01', rows: [], badLines: 0 });
  });

  it('counts a bad line but not a blank one', () => {
    const lines = [
      '{"at":"2026-11-01T23:00:00+01:00","job":"a","status":"ok","owner":"rook"}',
      '',
      '   ',
      'not json',
      '{"at":"2026-11-01T23:05:00+01:00","job":"a","status":"ok","owner":"rook"}',
    ];
    writeFileSync(join(dir, '2026-11-01.jsonl'), lines.join('\n') + '\n');
    const night = readNight(dir, '2026-11-01');
    expect(night?.badLines).toBe(1);
    expect(night?.rows).toHaveLength(1);
    expect(night?.rows[0]?.runs).toBe(2);
  });

  it('counts missing job/at and unknown status as bad', () => {
    const lines = [
      '{"job":"a","status":"ok","owner":null}',
      '{"at":"2026-11-01T23:00:00+01:00","status":"ok","owner":null}',
      '{"at":"2026-11-01T23:00:00+01:00","job":"a","status":"skipped","owner":null}',
      '[1,2]',
    ];
    writeFileSync(join(dir, '2026-11-01.jsonl'), lines.join('\n'));
    expect(readNight(dir, '2026-11-01')).toEqual({ night: '2026-11-01', rows: [], badLines: 4 });
  });

  it('picks the last line by instant across offsets, keeping the offsets', () => {
    const lines = [
      // 23:30Z: the latest instant, even though it is earlier in the file
      '{"at":"2026-11-02T00:30:00+01:00","job":"a","status":"fail","owner":"late","error":"boom"}',
      // 23:00Z
      '{"at":"2026-11-01T23:00:00+00:00","job":"a","status":"ok","owner":"early"}',
      // 22:00Z: the earliest instant
      '{"at":"2026-11-01T17:00:00-05:00","job":"a","status":"retry","owner":"earliest"}',
    ];
    writeFileSync(join(dir, '2026-11-01.jsonl'), lines.join('\n'));
    const row = readNight(dir, '2026-11-01')?.rows[0];
    expect(row).toEqual({
      job: 'a',
      owner: 'late',
      runs: 3,
      retries: 1,
      lastStatus: 'fail',
      lastError: 'boom',
      firstAt: '2026-11-01T17:00:00-05:00',
      lastAt: '2026-11-02T00:30:00+01:00',
    });
  });

  it('on a tie for the latest instant, the later line in the file wins', () => {
    const lines = [
      '{"at":"2026-11-01T23:00:00+00:00","job":"a","status":"fail","owner":"first","error":"x"}',
      '{"at":"2026-11-02T00:00:00+01:00","job":"a","status":"ok","owner":"second"}',
    ];
    writeFileSync(join(dir, '2026-11-01.jsonl'), lines.join('\n'));
    const row = readNight(dir, '2026-11-01')?.rows[0];
    expect(row).toMatchObject({
      owner: 'second',
      lastStatus: 'ok',
      lastError: null,
      lastAt: '2026-11-02T00:00:00+01:00',
    });
  });
});
