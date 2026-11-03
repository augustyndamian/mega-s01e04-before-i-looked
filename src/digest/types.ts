// Contract of the morning digest (plan.md § 1). Section 2 builds against this file.
export type JobStatus = 'ok' | 'retry' | 'fail';

// One row per job in runs/<night>.jsonl.
export type DigestRow = {
  job: string;
  owner: string | null; // null in the log: keep the row, show it as "—"
  runs: number; // parsed lines for this job
  retries: number; // lines with status "retry"
  lastStatus: JobStatus; // status of the line with the latest `at`
  lastError: string | null; // `error` of the line with the latest `at`, if any
  firstAt: string; // keeps the offset from the log, never converted to UTC
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  badLines: number; // lines that did not parse; counted, never thrown
};

// null = no runs/<night>.jsonl on disk (the route answers 404).
// An empty file gives { rows: [], badLines: 0 } (the page says "nothing ran").
export type ReadNight = (runsDir: string, night: string) => Night | null;
