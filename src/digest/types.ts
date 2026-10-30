// Types for the night's run log (plan.md § 1). Section 2 (page, JSON, board, route tests)
// builds against this file only; the reader lives in src/digest/read.ts.

/** A run's status as logged. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/** One readable line of `runs/<night>.jsonl`, after parsing at the edge. */
export type RunLine = {
  /** 1-based line number in the file. */
  line: number;
  /** Exactly as logged, offset included (e.g. `2026-10-29T01:30:00+01:00`). Never converted to UTC. */
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

/** One row per job. `null` fields render as `—`. */
export type DigestRow = {
  job: string;
  /** Owner of the job's latest line; `null` when logged as null. */
  owner: string | null;
  /** Number of lines for the job. */
  runs: number;
  /** Number of its `retry` lines. */
  retries: number;
  /** Status of its latest line (by parsed instant). */
  lastStatus: RunStatus;
  /** Latest `error` seen for the job, even if `lastStatus` is `ok`; `null` if none. */
  lastError: string | null;
  /** `at` of its earliest line, as logged. */
  firstAt: string;
  /** `at` of its latest line, as logged. */
  lastAt: string;
};

/**
 * A line that didn't parse, or parsed to the wrong shape. Kept for the page as far as it goes;
 * never a job row, never merged into another job. `null` fields render as `—`.
 */
export type UnreadableLine = {
  /** 1-based line number in the file. */
  line: number;
  /** `at` text recovered from the raw line, if any. */
  at: string | null;
  /** `job` text recovered from the raw line, if any, possibly cut short (e.g. `lane/sy`). */
  job: string | null;
};

/** Counts of readable lines by status, for the board (§ 2c). */
export type StatusCounts = Record<RunStatus, number>;

/** What `readNight` returns for a night whose file exists. */
export type Night = {
  /** The night, from the file name (`YYYY-MM-DD`), not from the dates in `at`. */
  night: string;
  /** One per job, sorted by job name. Same order for the page and the JSON. */
  rows: DigestRow[];
  /** Number of unreadable lines (= `unreadable.length`). */
  badLines: number;
  /** Unreadable lines, in file order. */
  unreadable: UnreadableLine[];
  /** Readable lines by status. */
  counts: StatusCounts;
  /** True when the file has no non-blank lines at all ("nothing ran", § 2a). */
  empty: boolean;
};

/**
 * Read `<runsDir>/<night>.jsonl`. Returns `null` when there is no file (404 in § 2a).
 * An empty file returns a `Night` with `empty: true`. Never throws on bad lines.
 */
export type ReadNight = (runsDir: string, night: string) => Night | null;
