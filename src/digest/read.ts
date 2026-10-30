// Reader for the night's run log (plan.md § 1). Parses at the edge: bad lines are counted and
// kept as far as they go, never thrown.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunLine, RunStatus, StatusCounts, UnreadableLine } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

type Parsed = { ok: true; run: RunLine } | { ok: false; bad: UnreadableLine };

const isStatus = (v: unknown): v is RunStatus => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);

/** Recover a string field from a raw line, even if the line is cut short inside the value. */
function recover(raw: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(raw);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1] ?? null;
  }
}

export function parseLine(raw: string, line: number): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, bad: { line, at: recover(raw, 'at'), job: recover(raw, 'job') } };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, bad: { line, at: null, job: null } };
  }
  const o = value as Record<string, unknown>;
  const at = typeof o.at === 'string' ? o.at : null;
  const job = typeof o.job === 'string' ? o.job : null;
  const owner = o.owner;
  const error = o.error;
  const readable =
    at !== null &&
    !Number.isNaN(Date.parse(at)) &&
    job !== null &&
    job !== '' &&
    isStatus(o.status) &&
    (typeof owner === 'string' || owner === null) &&
    (error === undefined || error === null || typeof error === 'string');
  if (!readable) return { ok: false, bad: { line, at, job } };
  return {
    ok: true,
    run: { line, at, job, status: o.status as RunStatus, owner: owner as string | null, error: (error as string | undefined) ?? null },
  };
}

/** Order by parsed instant; ties keep file order. */
const byInstant = (a: RunLine, b: RunLine): number => Date.parse(a.at) - Date.parse(b.at) || a.line - b.line;

export function toRows(runs: RunLine[]): DigestRow[] {
  const byJob = new Map<string, RunLine[]>();
  for (const run of runs) {
    const list = byJob.get(run.job);
    if (list) list.push(run);
    else byJob.set(run.job, [run]);
  }
  const rows: DigestRow[] = [];
  for (const [job, list] of byJob) {
    const sorted = [...list].sort(byInstant);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const withError = sorted.filter((r) => r.error !== null);
    rows.push({
      job,
      owner: last.owner,
      runs: sorted.length,
      retries: sorted.filter((r) => r.status === 'retry').length,
      lastStatus: last.status,
      lastError: withError.length ? withError[withError.length - 1]!.error : null,
      firstAt: first.at,
      lastAt: last.at,
    });
  }
  return rows.sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
}

export function parseNight(night: string, text: string): Night {
  const lines = text.split('\n');
  // The empty string after the final newline is not a line.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const runs: RunLine[] = [];
  const unreadable: UnreadableLine[] = [];
  let nonBlank = 0;
  lines.forEach((rawLine, i) => {
    const raw = rawLine.replace(/\r$/, '');
    if (raw.trim() === '') return;
    nonBlank++;
    const p = parseLine(raw, i + 1);
    if (p.ok) runs.push(p.run);
    else unreadable.push(p.bad);
  });
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  for (const r of runs) counts[r.status]++;
  return { night, rows: toRows(runs), badLines: unreadable.length, unreadable, counts, empty: nonBlank === 0 };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null;
    throw e;
  }
  return parseNight(night, text);
};
