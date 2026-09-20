const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { classifyParents, mapCommodities } = require('../server/scrapCommodity');
const { validDate } = require('../server/routes/productionScrap');
const derive = import('../mrp-planner/src/scrap/deriveScrapData.js');
const filters = { startDate: '2026-01-01', endDate: '2026-01-31', commodity: '', warehouse: '', stockCode: '' };
const row = overrides => ({ date: '2026-01-15', commodity: 'RSB', mappingStatus: 'Mapped', stockCode: 'TEST-A', warehouse: 'B-SCR01', sourceWarehouse: 'B-WIP01', destinationWarehouse: 'B-SCR01', scrapQty: 10, unitCost: 5, totalCost: 50, uom: 'EA', ...overrides });
const regRow = overrides => row({ warehouse: 'B-REG01', destinationWarehouse: 'B-REG01', ...overrides });
const parent = parentPart => ({ parentPart, description: '', route: '0', qtyPer: 1 });

test('commodity classification preserves all parents and explicit confidence', () => {
  assert.equal(classifyParents([]).mappingStatus, 'Unmapped');
  assert.equal(classifyParents([parent('CONVERTER')]).commodity, 'Unmapped');
  const unique = classifyParents([parent('A-16450'), parent('B-16451')]);
  assert.equal(unique.commodity, 'Side Step');
  assert.equal(unique.mappingStatus, 'Mapped');
  assert.equal(unique.parents.length, 2);
  const incomplete = classifyParents([parent('A-12606'), parent('CONVERTER')]);
  assert.equal(incomplete.mappingStatus, 'Incomplete Coverage');
  assert.equal(incomplete.commodity, 'Thermoforming');
  assert.equal(incomplete.unclassifiedParentCount, 1);
  const ambiguous = classifyParents([parent('A-16450'), parent('B-17775')]);
  assert.equal(ambiguous.commodity, 'Ambiguous');
  assert.equal(ambiguous.mappingStatus, 'Ambiguous');
  assert.equal(ambiguous.candidateCommodities.length, 2);
  assert.equal(classifyParents([parent('A-12606'), parent('B-13036')]).mappingStatus, 'Mapped');
  assert.equal(classifyParents([parent('A-29140')]).commodity, 'Box Rail');
});

test('confirmed totals and monthly target exclude REG; outbound REG is activity, not reversal', async () => {
  const { deriveScrapData } = await derive;
  const data = deriveScrapData([row(), row({ scrapQty: -2, totalCost: -10 }), regRow({ totalCost: 900000 }),
    regRow({ sourceWarehouse: 'B-REG01', destinationWarehouse: 'B-WIP01', scrapQty: -4, totalCost: -20 })], filters);
  assert.equal(data.confirmed.totalValue, 40);
  assert.equal(data.confirmed.totalQty, 8);
  assert.equal(data.target.monthly, 400000);
  assert.equal(data.target.variance, -399960);
  assert.equal(data.reg.totalValue, 900020);
  assert.equal(data.reg.totalQty, 14);
  assert.equal(data.reg.directions['REG → WIP'].value, 20);
  assert.equal(data.reg.rows[1].direction, 'REG → WIP');
  assert.equal(data.totalCost, undefined);
  for (const set of [data.confirmed, data.reg]) for (const key of ['daily', 'monthly', 'stocks', 'commodities']) assert.equal(set[key].reduce((sum, item) => sum + item.cost, 0), set.totalValue);
});

test('all date/commodity/warehouse/stock filters intersect and irrelevant targets are suppressed', async () => {
  const { deriveScrapData } = await derive;
  const rows = [row(), regRow({ stockCode: 'Reg-X', date: '2026-01-31', commodity: 'Unmapped', mappingStatus: 'Unmapped' }), regRow({ date: '2026-02-01' })];
  const data = deriveScrapData(rows, { ...filters, startDate: '2026-01-31', commodity: 'Unmapped', warehouse: 'B-REG01', stockCode: ' reg-x ' });
  assert.equal(data.reg.rows.length, 1);
  assert.equal(data.confirmed.rows.length, 0);
  assert.equal(data.target.variance, null);
  assert.equal(data.reg.daily.length, 1);
  assert.equal(deriveScrapData(rows, { ...filters, warehouse: 'B-SCR01' }).reg.rows.length, 0);
  assert.equal(deriveScrapData(rows, { ...filters, commodity: 'Ambiguous' }).confirmed.rows.length, 0);
  assert.equal(deriveScrapData([], filters).confirmed.totalValue, 0);
});

test('confidence labels, missing cost and mixed units remain visible', async () => {
  const { deriveScrapData } = await derive;
  const data = deriveScrapData([row({ mappingStatus: 'Incomplete Coverage' }), row({ commodity: 'Unmapped', mappingStatus: 'Unmapped', unitCost: null, totalCost: null, uom: 'KG' }), row({ commodity: 'Ambiguous', mappingStatus: 'Ambiguous' })], filters);
  assert.equal(data.confirmed.missingCostCount, 1);
  assert.equal(data.target.variance, null);
  assert.equal(data.confirmed.statuses['Incomplete Coverage'], 1);
  assert.ok(data.confirmed.commodities.some(item => item.label.includes('Incomplete Coverage')));
  assert.ok(data.confirmed.commodities.some(item => item.label === 'Unmapped'));
  assert.ok(data.confirmed.commodities.some(item => item.label === 'Ambiguous'));
  assert.deepEqual(data.confirmed.uoms, ['EA', 'KG']);
});

test('calendar-month target reference is explicit for partial and multiple months', async () => {
  const { deriveScrapData } = await derive;
  const data = deriveScrapData([row()], { ...filters, endDate: '2026-02-03' });
  assert.equal(data.target.months, 2);
  assert.equal(data.target.periodReference, 800000);
  assert.equal(data.target.variance, -799950);
  assert.equal(data.confirmed.daily.length, 34);
});

test('BOM fan-out cannot duplicate events or fabricate 121046 REG transfers', () => {
  const mapped = mapCommodities([regRow({ stockCode: '121152' })], [{ stockCode: '121152', parentPart: 'A-16450' }, { stockCode: '121152', parentPart: 'B-17775' }]);
  assert.equal(mapped.data.length, 1);
  assert.equal(mapped.data[0].commodity, 'Ambiguous');
  assert.equal(mapped.mappings['121152'].parents.length, 2);
  assert.ok(!mapped.data.some(row => row.stockCode === '121046'));
});

test('investigated 4510-row fixture preserves confirmed total and produces separate gross REG activity', async () => {
  const raw = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../diagnostics/production-scrap/cohort.json')));
  const rows = raw.map(item => row({ date: item.EntryDate, stockCode: item.StockCode.trim(), warehouse: item.Warehouse.trim() === 'B-WIP01' ? item.NewWarehouse.trim() : item.Warehouse.trim(),
    sourceWarehouse: item.Warehouse.trim(), destinationWarehouse: item.NewWarehouse.trim(), scrapQty: item.Warehouse.trim() === 'B-WIP01' ? -item.TrnQty : item.TrnQty,
    totalCost: item.Warehouse.trim() === 'B-WIP01' ? -item.QtyTimesUnitCost : item.QtyTimesUnitCost, unitCost: item.UnitCost, uom: item.StockUom }));
  const { deriveScrapData } = await derive;
  const data = deriveScrapData(rows, { ...filters, endDate: '2026-09-07' });
  assert.equal(rows.length, 4510);
  assert.equal(data.confirmed.rows.length, 3083);
  assert.ok(Math.abs(data.confirmed.totalValue - 4170539.31783) < 0.00001);
  assert.equal(data.confirmed.totalQty, 43625);
  assert.equal(data.reg.rows.length, 1427);
  assert.ok(Math.abs(data.reg.totalValue - 7522470.30272) < 0.00001);
  assert.equal(data.reg.directions['REG → WIP'].count, 355);
  assert.ok(!data.reg.rows.some(row => row.stockCode === '121046'));
});

test('endpoint uses SELECT queries with bound dates and rejects writes/invalid ranges', async () => {
  for (const value of ['2026-02-30', "2026-01-01'; DROP TABLE x;--", '', undefined]) assert.equal(validDate(value), false);
  const db = require('../server/db'), original = db.query, calls = [];
  db.query = async (query, parameters) => { calls.push({ query, parameters }); return query.includes('BomStructure') ? [] : [row(), regRow()]; };
  const server = require('../server/server').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/syspro/production-scrap';
  try {
    const response = await fetch(url + '?startDate=2026-01-01&endDate=2026-01-31');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const payload = await response.json();
    assert.equal(payload.count, 2);
    assert.equal(payload.data[0].mappingStatus, 'Unmapped');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].parameters[0].value.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.ok(calls.every(call => !/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(call.query)));
    for (const range of ['startDate=2026-02-30&endDate=2026-03-01', 'startDate=2026-03-01&endDate=2026-01-01', 'startDate=2000-01-01&endDate=2026-01-01']) assert.equal((await fetch(url + '?' + range)).status, 400);
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
    const missing = await fetch(url + '-missing');
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type'), /application\/json/);
    assert.equal((await missing.json()).success, false);
    db.query = async () => { throw new Error('Test offline'); };
    assert.equal((await fetch(url + '?startDate=2026-01-01&endDate=2026-01-31')).status, 503);
  } finally { db.query = original; await new Promise(resolve => server.close(resolve)); }
});

test('frontend rejects HTML and malformed JSON; commodity options include both warehouses, not statuses', async () => {
  const { readProductionScrap, commodityOptions } = await import('../mrp-planner/src/scrap/productionScrapApi.js');
  await assert.rejects(readProductionScrap(new Response('<!DOCTYPE html><html></html>', { status: 404, headers: { 'Content-Type': 'text/html' } })), /HTTP 404/);
  await assert.rejects(readProductionScrap(new Response('<!DOCTYPE html>', { headers: { 'Content-Type': 'application/json' } })));
  await assert.rejects(readProductionScrap(Response.json({ success: false, error: 'offline' }, { status: 503 })), /offline/);
  await assert.rejects(readProductionScrap(Response.json({ success: true, data: {} })), /Invalid response shape/);
  const rows = [row(), regRow({ commodity: 'Side Step' }), regRow({ commodity: 'Thermoforming', mappingStatus: 'Incomplete Coverage' }), row({ commodity: 'Box Rail' })];
  const payload = await readProductionScrap(Response.json({ success: true, data: rows }));
  assert.deepEqual(commodityOptions(payload.data), ['Ambiguous', 'Box Rail', 'RSB', 'Side Step', 'Thermoforming', 'Unmapped']);
  assert.deepEqual(commodityOptions([]), ['Ambiguous', 'Unmapped']);
  const { deriveScrapData } = await derive;
  for (const warehouse of ['B-SCR01', 'B-REG01']) {
    for (const commodity of commodityOptions(rows)) {
      const data = deriveScrapData(rows, { ...filters, warehouse, commodity });
      const result = warehouse === 'B-SCR01' ? data.confirmed : data.reg;
      assert.equal(result.rows.length, rows.filter(row => row.warehouse === warehouse && row.commodity === commodity).length);
      for (const chart of ['daily', 'monthly', 'commodities', 'stocks']) assert.equal(result[chart].reduce((sum, item) => sum + item.cost, 0), result.totalValue);
    }
  }
});

