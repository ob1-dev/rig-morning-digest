import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { readNight } from '../src/digest/read.js';

it('serves the night as readNight returns it', async () => {
  const config = loadConfig();
  const res = await createApp(config).request('/api/digest/2026-10-28');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(JSON.parse(JSON.stringify(readNight(config.runsDir, '2026-10-28'))));
});

it('404s for a missing night', async () => {
  const res = await createApp().request('/api/digest/2020-01-01');
  expect(res.status).toBe(404);
});
