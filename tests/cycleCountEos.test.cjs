const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveEosBalances } = require('../server/services/cycleCountEos');

const period = (overrides = {}) => ({
  stockCode: '120002', currentSoh: 50, currentPeriod: 8, periodOffset: 0,
  openingQty: 100, closingQty: 50, netQty: -50,
  unsupportedCount: 0, invalidTimeCount: 0, earliestMovement: '2026-11-02T08:00:00Z',
  morningAfterQty: -30, afternoonAfterQty: -20, nightAfterQty: -5,
  morningAfterCount: 3, afternoonAfterCount: 2, nightAfterCount: 1,
  fetchedAt: '2026-11-16T08:00:00Z', ...overrides,
});
const derive = (rows, date = '2026-11-13') => deriveEosBalances(date, ['120002'], rows);

test('reverses later movements instead of using current SOH and allocates night close to the next date', () => {
  const result = derive([period()]);
  assert.deepEqual(result.map((row) => row.expectedEosSoh), [80, 70, 55]);
  assert.deepEqual(result.map((row) => row.cutoffAt), ['2026-11-13T13:00:00.000Z', '2026-11-13T20:00:00.000Z', '2026-11-14T04:00:00.000Z']);
  assert.ok(result.every((row) => row.status === 'available'));
});

test('includes later financial periods when reconstructing a previous period', () => {
  const current = period({ earliestMovement: '2026-11-02T08:00:00Z', morningAfterQty: -50, afternoonAfterQty: -50, nightAfterQty: -50 });
  const previous = period({ periodOffset: 1, openingQty: 110, closingQty: 100, netQty: -10,
    earliestMovement: '2026-10-01T08:00:00Z', morningAfterQty: 20, afternoonAfterQty: 20, nightAfterQty: 20 });
  assert.deepEqual(derive([current, previous], '2026-10-15').map((row) => row.expectedEosSoh), [80, 80, 80]);
});

test('does not substitute current stock for future shift closes or unavailable history', () => {
  const currentDay = derive([period()], '2026-11-16');
  assert.ok(currentDay.every((row) => row.expectedEosSoh === null && row.reason.includes('not closed')));
  for (const change of [{ netQty: -49 }, { unsupportedCount: 1 }, { invalidTimeCount: 1 }, { openingQty: null }, { currentPeriod: 13 }]) {
    assert.ok(derive([period(change)]).every((row) => row.expectedEosSoh === null), JSON.stringify(change));
  }
  assert.ok(derive([period()], '2026-10-31').every((row) => row.expectedEosSoh === null));
  assert.ok(derive([]).every((row) => row.expectedEosSoh === null));
});

test('rejects an overlapping unreconciled period but permits fully covered recent history', () => {
  const previous = period({ periodOffset: 1, netQty: 999, earliestMovement: '2026-10-01T08:00:00Z', morningAfterCount: 0, afternoonAfterCount: 0, nightAfterCount: 0 });
  assert.ok(derive([period(), previous]).every((row) => row.status === 'available'));
  assert.equal(derive([period(), { ...previous, morningAfterCount: 1 }])[0].expectedEosSoh, null);
});

test('keeps a valid zero balance distinct from missing stock and handles year rollover', () => {
  assert.equal(derive([period({ morningAfterQty: 50 })])[0].expectedEosSoh, 0);
  const result = derive([period({ fetchedAt: '2027-01-02T08:00:00Z', earliestMovement: '2026-12-01T08:00:00Z' })], '2026-12-31');
  assert.equal(result[2].cutoffAt, '2027-01-01T04:00:00.000Z');
});

test('EOS route validates input and binds stock codes rather than inserting user text in SQL', async () => {
  const db = require('../server/db');
  const original = db.query;
  const calls = [];
  db.query = async (query, parameters) => { calls.push({ query, parameters }); return [period()]; };
  const app = require('express')();
  app.use(require('../server/routes/cycleCount'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const query of ['date=2026-02-30&stockCodes=120002', 'date=2026-11-13', 'date=2026-11-13&stockCodes=' + 'X'.repeat(31)]) {
      assert.equal((await fetch(`${base}/cycle-count/eos?${query}`)).status, 400);
    }
    assert.equal(calls.length, 0);
    const response = await fetch(`${base}/cycle-count/eos?date=2026-11-13&stockCodes=120002`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).data[0].expectedEosSoh, 80);
    assert.ok(calls[0].query.includes('@StockCode0'));
    assert.equal(calls[0].parameters[1].value, '120002');
    db.query = async () => { throw new Error('Synthetic SQL outage'); };
    assert.equal((await fetch(`${base}/cycle-count/eos?date=2026-11-13&stockCodes=120002`)).status, 503);
  } finally {
    db.query = original;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
