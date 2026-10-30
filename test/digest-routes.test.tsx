import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Routes under test: GET /digest/:night (page, § 2a) and GET /api/digest/:night (JSON, § 2b).
// Runs against a temp runsDir; the real runs/ is read-only and never touched here.

let runsDir: string;

const good = [
  '{"at":"2026-10-28T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"ops","error":null}',
  '{"at":"2026-10-28T01:10:00+01:00","job":"lane/backup","status":"retry","owner":"ops","error":"timeout"}',
  '{"at":"2026-10-28T01:20:00+01:00","job":"lane/backup","status":"ok","owner":"ops","error":null}',
].join('\n') + '\n';

const bad = [
  '{"at":"2026-10-29T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"ops","error":null}',
  '{"at":"2026-10-29T01:05:00+01:00","job":"lane/sy',
].join('\n') + '\n';

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(join(runsDir, '2026-10-28.jsonl'), good);
  writeFileSync(join(runsDir, '2026-10-29.jsonl'), bad);
  writeFileSync(join(runsDir, '2026-10-30.jsonl'), '');
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

const config = () => ({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

describe('GET /digest/:night (page)', () => {
  it('200 for a good night, with one row per job and the at strings as logged', async () => {
    const res = await createApp(config()).request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('digest 2026-10-28');
    expect(html).toContain('lane/sync');
    expect(html).toContain('lane/backup');
    expect(html).toContain('2026-10-28T01:10:00+01:00');
    expect(html).toContain('timeout');
  });

  it('404 for a night with no file', async () => {
    const res = await createApp(config()).request('/digest/2026-01-01');
    expect(res.status).toBe(404);
  });

  it('404 for a night that is not YYYY-MM-DD', async () => {
    const res = await createApp(config()).request('/digest/yesterday');
    expect(res.status).toBe(404);
  });

  it('empty night renders "nothing ran"', async () => {
    const res = await createApp(config()).request('/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('a night with a bad line shows it under "lines that could not be read"', async () => {
    const res = await createApp(config()).request('/digest/2026-10-29');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('lines that could not be read');
    expect(html).toContain('lane/sy');
    expect(html).toContain('2026-10-29T01:05:00+01:00');
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('200 with the Night object for a good night', async () => {
    const res = await createApp(config()).request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: { job: string }[]; badLines: number; empty: boolean };
    expect(body.night).toBe('2026-10-28');
    expect(body.rows.map((r) => r.job)).toEqual(['lane/backup', 'lane/sync']);
    expect(body.badLines).toBe(0);
    expect(body.empty).toBe(false);
  });

  it('404 with { error, night } for a night with no file', async () => {
    const res = await createApp(config()).request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night', night: '2026-01-01' });
  });

  it('404 for a night that is not YYYY-MM-DD', async () => {
    const res = await createApp(config()).request('/api/digest/yesterday');
    expect(res.status).toBe(404);
  });

  it('empty night answers empty: true', async () => {
    const res = await createApp(config()).request('/api/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { empty: boolean }).empty).toBe(true);
  });

  it('a night with a bad line answers badLines 1', async () => {
    const res = await createApp(config()).request('/api/digest/2026-10-29');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { badLines: number }).badLines).toBe(1);
  });
});
