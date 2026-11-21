const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeSupabase } = require('../test-support/fakeSupabase');
const calendarRoutes = require('../src/routes/calendar');

const SEASON = {
  id: 'season-1',
  name: 'Season 1 - 1969',
  start_real_time: '2026-11-16T00:00:00.000Z',
  epoch_game_date: '1969-07-20',
  time_scale_multiplier: 52.142857,
  status: 'ACTIVE',
};

async function startServer(client, now) {
  const app = express();
  app.use(express.json());
  app.use('/api/calendar', calendarRoutes(client, { now }));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

test('calendar maps one real week to one ACD year', async () => {
  const { client } = createFakeSupabase({ seasons: [SEASON] });
  const fixedNow = new Date('2026-11-23T00:00:00.000Z');
  const { server, baseUrl } = await startServer(client, () => fixedNow);

  try {
    const response = await fetch(`${baseUrl}/api/calendar`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.conversion.acdYear, 1970);
    assert.ok(
      Math.abs(new Date(body.gameNow).getTime() - new Date('1970-07-20T00:00:00.000Z').getTime())
        < 5000,
    );
    assert.ok(Math.abs(body.conversion.gameDaysPerRealWeek - 365) < 1e-3);
    assert.ok(Math.abs(body.conversion.realWeekEqualsAcdYears - 1) < 1e-6);
    assert.ok(Math.abs(body.conversion.realDaysPerGameYear - 7) < 1e-3);
    assert.equal(body.conversion.acdYear, 1970);
    assert.ok(body.conversion.acdYearProgress > 0.5 && body.conversion.acdYearProgress < 0.6);
    assert.ok(new Date(body.conversion.acdYearStartRealAt) < fixedNow);
    assert.ok(new Date(body.conversion.acdYearEndRealAt) > fixedNow);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('calendar advances the ACD date as real time passes', async () => {
  const { client } = createFakeSupabase({ seasons: [SEASON] });
  const fixedNow = new Date('2026-11-30T00:00:00.000Z');
  const { server, baseUrl } = await startServer(client, () => fixedNow);

  try {
    const response = await fetch(`${baseUrl}/api/calendar`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.conversion.acdYear, 1971);
    assert.ok(
      Math.abs(new Date(body.gameNow).getTime() - new Date('1971-07-20T00:00:00.000Z').getTime())
        < 5000,
    );
    assert.ok(body.conversion.acdYearProgress >= 0 && body.conversion.acdYearProgress <= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
