import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, JobStatus, Night, ReadNight } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly JobStatus[] = ['ok', 'retry', 'fail'];

// One parsed line of runs/<night>.jsonl.
type RunLine = {
  at: string;
  atMs: number;
  job: string;
  status: JobStatus;
  owner: string | null;
  error: string | null;
};

function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

// Parse one line at the edge. Returns null for anything we can't trust.
function parseLine(text: string): RunLine | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const { at, job, status, owner, error } = obj;
  if (typeof at !== 'string' || typeof job !== 'string' || job === '') return null;
  const atMs = Date.parse(at);
  if (Number.isNaN(atMs)) return null;
  if (!isJobStatus(status)) return null;

  return {
    at,
    atMs,
    job,
    status,
    owner: typeof owner === 'string' ? owner : null,
    error: typeof error === 'string' ? error : null,
  };
}

function readFileOrNull(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const text = readFileOrNull(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  let badLines = 0;
  const byJob = new Map<string, { row: DigestRow; firstMs: number; lastMs: number }>();

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const run = parseLine(line);
    if (run === null) {
      badLines += 1;
      continue;
    }

    const entry = byJob.get(run.job);
    if (entry === undefined) {
      byJob.set(run.job, {
        row: {
          job: run.job,
          owner: run.owner,
          runs: 1,
          retries: run.status === 'retry' ? 1 : 0,
          lastStatus: run.status,
          lastError: run.error,
          firstAt: run.at,
          lastAt: run.at,
        },
        firstMs: run.atMs,
        lastMs: run.atMs,
      });
      continue;
    }

    const { row } = entry;
    row.runs += 1;
    if (run.status === 'retry') row.retries += 1;
    if (run.atMs < entry.firstMs) {
      entry.firstMs = run.atMs;
      row.firstAt = run.at;
    }
    // >= so that on a tie the later line in the file wins.
    if (run.atMs >= entry.lastMs) {
      entry.lastMs = run.atMs;
      row.lastAt = run.at;
      row.lastStatus = run.status;
      row.lastError = run.error;
      row.owner = run.owner;
    }
  }

  const rows = [...byJob.values()]
    .map((entry) => entry.row)
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));

  return { night, rows, badLines } satisfies Night;
};
