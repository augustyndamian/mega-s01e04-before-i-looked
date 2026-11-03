import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow } from '../src/digest/types.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

type DigestJson = { night: string; rows: DigestRow[]; badLines: number };

const JOBS_1028 = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs'];

describe('GET /digest/:night on runs/', () => {
  it('renders 2026-10-28 as a page with a table of every job', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<table');
    for (const job of JOBS_1028) expect(html).toContain(job);
  });

  it('marks 3 or more retries and a failed job', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    expect(html).toContain('retry x3');
    expect(html).toContain('fail');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await createApp(config).request('/digest/1999-01-01');
    expect(res.status).toBe(404);
  });

  it('answers 404 for a night that is not YYYY-MM-DD', async () => {
    const res = await createApp(config).request('/digest/not-a-night');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/digest/:night on runs/', () => {
  it('returns { night, rows, badLines } for 2026-10-28, sorted by job', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as DigestJson;
    expect(body.night).toBe('2026-10-28');
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(JOBS_1028);
    expect(body.rows.find((r) => r.job === 'fixtures/refresh')).toMatchObject({ retries: 3, lastStatus: 'ok' });
    expect(body.rows.find((r) => r.job === 'notes/backup')).toMatchObject({
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
    expect(body.rows.find((r) => r.job === 'digest/render')?.owner).toBeNull();
  });

  it('answers 404 with a JSON error for an unknown night', async () => {
    const res = await createApp(config).request('/api/digest/1999-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });

  it('answers 404 with a JSON error for a night that is not YYYY-MM-DD', async () => {
    const res = await createApp(config).request('/api/digest/not-a-night');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });
});

describe('page and JSON agree', () => {
  it('lists the jobs of 2026-10-28 in the same order', async () => {
    const app = createApp(config);
    const html = await (await app.request('/digest/2026-10-28')).text();
    const body = (await (await app.request('/api/digest/2026-10-28')).json()) as DigestJson;
    expect(body.rows.length).toBeGreaterThan(0);

    const positions = body.rows.map((r) => html.indexOf(r.job));
    for (const pos of positions) expect(pos).toBeGreaterThanOrEqual(0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('digest routes on a temp runs dir', () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
    app = createApp({ ...config, runsDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('an empty night: the page says nothing ran', async () => {
    writeFileSync(join(dir, '2026-11-01.jsonl'), '');
    const res = await app.request('/digest/2026-11-01');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('an empty night: the JSON has no rows and no bad lines', async () => {
    writeFileSync(join(dir, '2026-11-01.jsonl'), '');
    const res = await app.request('/api/digest/2026-11-01');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: '2026-11-01', rows: [], badLines: 0 });
  });

  it('a night with a bad line: the page still answers 200 with the good rows', async () => {
    const lines = [
      '{"at":"2026-11-01T23:00:00+01:00","job":"a/good","status":"ok","owner":"rook"}',
      'not json',
      '{"at":"2026-11-01T23:05:00+01:00","job":"b/good","status":"ok","owner":"rook"}',
    ];
    writeFileSync(join(dir, '2026-11-01.jsonl'), lines.join('\n') + '\n');
    const res = await app.request('/digest/2026-11-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('a/good');
    expect(html).toContain('b/good');
  });

  it('a night with a bad line: the JSON counts it and returns the good rows', async () => {
    const lines = [
      '{"at":"2026-11-01T23:00:00+01:00","job":"a/good","status":"ok","owner":"rook"}',
      'not json',
      '{"at":"2026-11-01T23:05:00+01:00","job":"b/good","status":"ok","owner":"rook"}',
    ];
    writeFileSync(join(dir, '2026-11-01.jsonl'), lines.join('\n') + '\n');
    const res = await app.request('/api/digest/2026-11-01');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.night).toBe('2026-11-01');
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['a/good', 'b/good']);
  });

  it('2 retries are not marked as retry x3', async () => {
    const lines = [
      '{"at":"2026-11-01T23:00:00+01:00","job":"a/flaky","status":"retry","owner":"rook","error":"x"}',
      '{"at":"2026-11-01T23:01:00+01:00","job":"a/flaky","status":"retry","owner":"rook","error":"x"}',
      '{"at":"2026-11-01T23:02:00+01:00","job":"a/flaky","status":"ok","owner":"rook"}',
    ];
    writeFileSync(join(dir, '2026-11-01.jsonl'), lines.join('\n') + '\n');
    const html = await (await app.request('/digest/2026-11-01')).text();
    expect(html).toContain('a/flaky');
    expect(html).not.toContain('retry x');
  });

  it('404 for a night with no file in the temp dir', async () => {
    expect((await app.request('/digest/2026-11-02')).status).toBe(404);
    const api = await app.request('/api/digest/2026-11-02');
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: 'no such night' });
  });
});
