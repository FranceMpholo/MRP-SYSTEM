const test = require('node:test');
const assert = require('node:assert/strict');
const { configuredWindows, normalizePostings } = require('../server/services/sheetAnalysisSystem');
const codes = ['120002', '121047', '120003'], ids = ['morning', 'afternoon', 'night'];
const date = '2026-11-18';
const rules = [{ shift: 'morning', start: '06:00', end: '15:00' }, { shift: 'afternoon', start: '15:00', end: '22:00' }, { shift: 'night', start: '22:00', end: '06:00' }];
const windows = configuredWindows(date, rules);
const countDay = () => ({ id: 'day', date, productionLine: 'thermoforming', warehouse: 'B-WIP01',
  items: codes.map((stockCode) => ({ stockCode, uom: 'Pcs', requiredEachShift: true })),
  shifts: ids.map((shift) => ({ shift, submittedAt: '2026-11-19T04:00:00Z' })),
  countRecords: ids.flatMap((shift, i) => codes.map((stockCode, n) => ({ id: `${shift}-${stockCode}`, shift, stockCode, warehouse: 'B-WIP01', physicalCount: i * 3 + n, countedAt: '2026-11-19T03:50:00Z' }))) });
const dc = 'N1WB-E40726-DC', cj = 'N1WB-E40726-CJ', rap = 'N1WB-E40726-CJ-RAP', bed = 'N1WB-E12606-SCP';
const bom = (parentStockCode, componentStockCode, extra = {}) => ({ parentStockCode, componentStockCode, qtyPer: 0.25, route: '0', parentUom: 'EA', componentUom: 'Pcs', factorUnitsVerified: true, qtyPerBasis: 'stocking', ...extra });
const boms = [bom(dc, '120002'), bom(cj, '120002'), bom(cj, rap, { qtyPer: 1, componentUom: 'EA', route: '2' }), bom(rap, '120003'), bom(bed, '120002', { qtyPer: 0.75 })];
const entry = (overrides = {}) => ({ stockCode: dc, description: 'Tailgate Ford - DC', stockUom: 'EA', warehouse: 'B-FIN01', newWarehouse: '', entryDate: date, trnTime: 14000000,
  trnYear: 2027, trnMonth: 8, journal: 1, journalEntry: 1, movementType: 'I', trnType: 'T', trnQty: 8, journalType: 'T', journalQty: 8,
  journalUom: 'EA', transferFlag: 'I', sourceWarehouseMin: 'B-WIP01', sourceWarehouseMax: 'B-WIP01', ...overrides });
const basePayload = (raw = []) => ({ date, windows, fetchedAt: '2026-11-23T10:00:00Z', stockCoverage: codes.map((stockCode) => ({ stockCode, warehouseExists: true, earliestEntryDate: '2025-01-01' })),
  data: ids.flatMap((shift, i) => codes.map((stockCode) => ({ stockCode, productionDate: date, shift, warehouse: 'B-WIP01', uom: stockCode === '121047' ? 'Ea' : 'Pcs',
    qtyReceived: { status: 'available', quantity: i * 10 }, totalIssue: { status: 'available', quantity: i + 1 } }))),
  postingData: { status: 'connected', rows: normalizePostings(raw, windows) }, movementEvidence: [] });
const transfer = (stockCode, destination, quantity, overrides = {}) => entry({ stockCode, stockUom: stockCode === '121047' ? 'Ea' : 'Pcs',
  journalUom: stockCode === '121047' ? 'Ea' : 'Pcs', warehouse: 'B-WIP01', newWarehouse: destination,
  transferFlag: 'O', trnQty: -quantity, journalQty: quantity, ...overrides });
let derive;
test.before(async () => { derive = await import('../mrp-planner/src/dashboard/deriveDailySheetAnalysis.js'); });

test('physical mode sums only three submitted complete scoped counts and retains confirmed zero', () => {
  const day = countDay(); day.countRecords.filter((row) => row.stockCode === '120002').forEach((row) => { row.physicalCount = 0; });
  const result = derive.dailyPhysicalCounts({ date, cycleCountDays: [day] });
  assert.deepEqual(result.map((row) => row.quantity), [0, 12, 15]);
  assert.equal(result[0].label, '3-shift count sum');
  assert.deepEqual(result[0].counts.map((row) => row.quantity), [0, 0, 0]);
  assert.ok(result.every((row) => row.complete));
});

test('drafts, missing shifts, legacy incompleteness, duplicates and other warehouses cannot approve a sum', () => {
  const changes = [
    (day) => { day.shifts[2].submittedAt = null; },
    (day) => { day.countRecords = day.countRecords.filter((row) => !(row.stockCode === '120002' && row.shift === 'night')); },
    (day) => { day.countRecords[0].physicalCount = null; },
    (day) => { day.countRecords.push({ ...day.countRecords[0] }); },
    (day) => { day.countRecords[0].warehouse = 'B-RAW01'; },
    (day) => { day.countRecords[0].location = 'OTHER'; },
    (day) => { day.shifts.push({ ...day.shifts[0] }); },
    (day) => { day.countRecords[0].physicalCount = -1; },
  ];
  for (const change of changes) { const day = countDay(); change(day); assert.equal(derive.dailyPhysicalCounts({ date, cycleCountDays: [day] })[0].quantity, null); }
  assert.ok(derive.dailyPhysicalCounts({ date, cycleCountDays: [countDay(), countDay()] }).every((row) => !row.complete));
  assert.ok(derive.dailyPhysicalCounts({ date: '2026-11-19', cycleCountDays: [countDay()] }).every((row) => !row.complete));
  const draft = countDay(); draft.shifts[2].submittedAt = null;
  const row = derive.dailyPhysicalCounts({ date, cycleCountDays: [draft] })[0];
  assert.equal(row.counts[2].quantity, 6); assert.equal(row.counts[2].included, false);
});

test('configured windows reject overlap and put next-day timestamps under the overnight start date', () => {
  assert.equal(windows[2].endAt, '2026-11-19T06:00:00+02:00');
  assert.throws(() => configuredWindows(date, [rules[0], rules[0], rules[2]]));
  assert.throws(() => configuredWindows(date, [{ ...rules[0], start: '05:00' }, rules[1], rules[2]]));
  const rows = [entry({ trnTime: 14595999 }), entry({ trnTime: 15000000, journalEntry: 2 }), entry({ trnTime: 22000000, journalEntry: 3 }), entry({ entryDate: '2026-11-19', trnTime: 5595999 }), entry({ entryDate: '2026-11-19', trnTime: 6000000 })];
  assert.deepEqual(normalizePostings(rows, windows).map((row) => row.shift), ['morning', 'afternoon', 'night', 'night']);
});

test('receipt copies are counted once while split receipts and signed reversals are retained', () => {
  const row = entry();
  const result = normalizePostings([row, { ...row }, entry({ trnTime: 14000001, journalEntry: 2 }), entry({ trnTime: 14000002, trnQty: -2, journalQty: -2 }), entry({ trnTime: 14000003, transferFlag: 'O', trnQty: -8 })], windows);
  assert.equal(result.length, 3); assert.equal(result.reduce((sum, item) => sum + item.quantity, 0), 14);
  const conflict = normalizePostings([row, entry({ trnQty: 9, journalQty: 9 })], windows);
  assert.equal(conflict[0].status, 'unavailable');
});

test('source, journal types, transfer signs, and units must be verified', () => {
  for (const change of [{ sourceWarehouseMin: '' }, { sourceWarehouseMax: 'OTHER' }, { journalQty: -8 }, { journalType: 'I' }, { trnType: 'R', journalType: 'R' }, { journalUom: 'KG' }]) assert.equal(normalizePostings([entry(change)], windows)[0].status, 'unavailable');
  assert.equal(normalizePostings([entry({ sourceWarehouseMin: 'B-RAW01', sourceWarehouseMax: 'B-RAW01' })], windows).length, 0);
});

test('DC and CJ-RAP identify different sheets; CJ alternatives stay unverified without merging routes', () => {
  assert.deepEqual(derive.sheetMapping(dc, boms).candidateSheets, ['120002']);
  assert.equal(derive.sheetMapping(dc, boms).status, 'verified');
  assert.deepEqual(derive.sheetMapping(rap, boms).candidateSheets, ['120003']);
  assert.equal(derive.sheetMapping(rap, boms).status, 'verified');
  assert.equal(derive.sheetMapping(cj, boms).status, 'mapping_unverified');
  assert.deepEqual(derive.sheetMapping(cj, boms).candidateSheets, ['120002', '120003']);
  assert.equal(derive.sheetMapping(dc, boms, false).status, 'mapping_unverified');
  assert.equal(derive.sheetMapping('UNKNOWN', boms).status, 'mapping_unverified');
  const cyclicIdentity = derive.sheetMapping(dc, [...boms, bom(dc, dc)]);
  assert.equal(cyclicIdentity.status, 'verified'); assert.ok(cyclicIdentity.warnings.some((warning) => /cycle/.test(warning)));
  assert.equal(derive.sheetMapping(dc, [bom(dc, '120002', { qtyPer: null })]).status, 'mapping_unverified');
  assert.equal(derive.sheetMapping(dc, [bom(dc, '120002', { structureOnDate: new Date('1900-01-01T00:00:00Z') })]).status, 'verified');
});

test('daily sheets sum all shifts and keep posted output in part units, independent of QtyPer or manual actuals', () => {
  const payload = basePayload([entry(), entry({ stockCode: bed, description: 'Lnr Ford Bedliner', trnTime: 16000000, trnQty: 20, journalQty: 20 }), entry({ stockCode: rap, description: 'Tailgate Ford CJ-RAP', trnTime: 23000000, trnQty: 4, journalQty: 4 })]);
  payload.tailgateData = { date, data: [{ stockCode: '120002', status: 'available', quantity: 8, uom: 'EA' }, { stockCode: '120003', status: 'available', quantity: 4, uom: 'EA' }] };
  payload.bedlinerData = { date, data: [{ stockCode: '120002', status: 'available', quantity: 20, uom: 'EA' }, { stockCode: '120003', status: 'available', quantity: 0, uom: 'EA' }] };
  const rows = derive.dailySystemSheets({ date, payload, boms, bomAvailable: true });
  assert.equal(rows[0].received.quantity, 30); assert.equal(rows[0].issued.quantity, 6);
  assert.equal(rows[0].bedliners.quantity, 20); assert.equal(rows[0].bedliners.uom, 'EA');
  assert.equal(rows[0].tailgates.quantity, 8); assert.equal(rows[2].tailgates.quantity, 4);
  assert.equal(rows[1].bedliners.status, 'unavailable'); // TPO has its own output row
  const unknown = derive.dailySystemSheets({ date, payload: basePayload([entry({ stockCode: cj, description: 'Tailgate Ford CJ' })]), boms, bomAvailable: true });
  assert.equal(unknown[0].tailgates.status, 'unavailable'); assert.equal(unknown[2].tailgates.status, 'unavailable');
  // Unproven FG transfers cannot substitute for the dedicated backflush result.
  assert.equal(unknown[0].tailgates.quantity, null);
});

test('each sheet uses its mapped scrap route, nets returns/reversals once and keeps issues separate', () => {
  for (const [stockCode, destination] of [['120002', 'B-REG01'], ['120003', 'B-REG01'], ['121047', 'B-SCR01']]) {
    const outbound = transfer(stockCode, destination, 10, { trnTime: 6000000 });
    const rows = [outbound, { ...outbound },
      transfer(stockCode, destination, 5, { trnTime: 15000000 }),
      transfer(stockCode, destination, 3, { entryDate: '2026-11-19', trnTime: 2000000 }),
      transfer(stockCode, destination, -2, { trnTime: 17000000 }), // signed reversal on original route
      transfer(stockCode, 'B-WIP01', 1, { warehouse: destination, trnTime: 18000000 }), // return source leg
      transfer(stockCode, 'B-WIP01', -10, { warehouse: destination, transferFlag: 'I' }), // companion incoming leg
      transfer(stockCode, destination === 'B-REG01' ? 'B-SCR01' : 'B-REG01', 100, { trnTime: 19000000 })];
    const result = derive.dailySystemSheets({ date, payload: basePayload(rows), boms, bomAvailable: true }).find((row) => row.stockCode === stockCode);
    assert.equal(result.scrapDestination, destination);
    assert.equal(result.scrap.status, 'available'); assert.equal(result.scrap.quantity, 15);
    assert.equal(result.scrapRows.length, 5); assert.equal(result.issued.quantity, 6);
    // Activity only on the other route proves a valid zero on this mapped route.
    const onlyOther = derive.dailySystemSheets({ date, payload: basePayload([rows.at(-1)]), boms, bomAvailable: true }).find((row) => row.stockCode === stockCode);
    assert.equal(onlyOther.scrap.status, 'available'); assert.equal(onlyOther.scrap.quantity, 0);
  }
});

test('scrap uses configured SAST boundaries including overnight, excluding the exact next-day cutoff', () => {
  for (const end of ['06:00', '05:30']) {
    const customRules = rules.map((rule) => rule.shift === 'night' ? { ...rule, end } : rule);
    const customWindows = configuredWindows(date, customRules);
    const cutoff = end === '06:00' ? 6000000 : 5300000, before = end === '06:00' ? 5595999 : 5295999;
    for (const [stockCode, destination] of [['120002', 'B-REG01'], ['120003', 'B-REG01'], ['121047', 'B-SCR01']]) {
      const raw = [transfer(stockCode, destination, 100, { trnTime: 5595999 }),
        transfer(stockCode, destination, 1, { trnTime: 6000000 }),
        transfer(stockCode, destination, 2, { trnTime: 15000000 }),
        transfer(stockCode, destination, 3, { trnTime: 22000000 }),
        transfer(stockCode, destination, 4, { entryDate: '2026-11-19', trnTime: before }),
        transfer(stockCode, destination, 100, { entryDate: '2026-11-19', trnTime: cutoff })];
      const payload = { ...basePayload(), windows: customWindows, postingData: { status: 'connected', rows: normalizePostings(raw, customWindows) } };
      const result = derive.dailySystemSheets({ date, payload, boms, bomAvailable: true }).find((row) => row.stockCode === stockCode);
      assert.equal(result.scrap.quantity, 10, `${stockCode} closing ${end}`);
      assert.deepEqual(result.scrapRows.map((row) => row.shift), ['morning', 'afternoon', 'night', 'night']);
    }
  }
});

test('mapped scrap is unavailable when journal, time, units, coverage or complete response data is missing', () => {
  for (const [stockCode, destination] of [['120002', 'B-REG01'], ['120003', 'B-REG01'], ['121047', 'B-SCR01']]) {
    const run = (payload) => derive.dailySystemSheets({ date, payload, boms, bomAvailable: true }).find((row) => row.stockCode === stockCode).scrap;
    for (const invalid of [{ journalQty: null }, { journalQty: 999 }, { journalType: '' }, { transferFlag: '' },
      { stockUom: '' }, { journalUom: 'KG' }, { stockUom: 'KG', journalUom: 'KG' }, { trnTime: null }, { trnTime: 99999999 }]) {
      const result = run(basePayload([transfer(stockCode, destination, 3, invalid)]));
      assert.equal(result.status, 'unavailable', JSON.stringify(invalid)); assert.equal(result.quantity, null);
    }
    const covered = basePayload();
    for (const payload of [{ ...covered, postingData: { status: 'unavailable', rows: [] } },
      { ...covered, postingData: { status: 'connected' } }, { ...covered, postingData: { status: 'connected', rows: {} } }, { ...covered, stockCoverage: [] },
      { ...covered, data: covered.data.filter((row) => row.shift !== 'night') },
      { ...covered, data: covered.data.map((row) => row.shift === 'night' ? { ...row, uom: 'KG' } : row) }]) {
      assert.equal(run(payload).status, 'unavailable'); assert.equal(run(payload).quantity, null);
    }
    assert.equal(run(covered).quantity, 0);
    const original = transfer(stockCode, destination, 3);
    assert.equal(run(basePayload([original, { ...original, journalQty: 4 }])).status, 'unavailable');
    const otherRoute = { ...original, newWarehouse: destination === 'B-REG01' ? 'B-SCR01' : 'B-REG01' };
    assert.equal(run(basePayload([otherRoute, original])).status, 'unavailable');
    assert.equal(run(basePayload([original, otherRoute])).status, 'unavailable');
  }
});

test('TPO date-only output remains by posting date; Bedliners and Tailgates require their verified production feeds', () => {
  const tpo = 'N1WB-E13036-K', tpoBoms = [...boms, bom(tpo, '121047', { componentUom: 'KG' })];
  const tpoEntry = (extra) => entry({ stockCode: tpo, description: 'Floor TPO', ...extra });
  const payload = basePayload([tpoEntry({ trnTime: null }), tpoEntry({ entryDate: '2026-11-19', trnTime: null, trnQty: 12, journalQty: 12 })]);
  const row = derive.dailySystemSheets({ date, payload, boms: tpoBoms, bomAvailable: true })[1];
  assert.equal(row.tpo.quantity, 8); assert.equal(row.tpo.status, 'posting_date_only'); assert.match(row.tpo.reason, /Unavailable by shift/);
  assert.equal(row.bedliners.status, 'unavailable');
  assert.equal(row.tailgates.status, 'unavailable');
  const several = basePayload([tpoEntry({ trnTime: null }), tpoEntry({ trnTime: null, journalEntry: 2 }), tpoEntry({ trnTime: null })]);
  assert.equal(derive.dailySystemSheets({ date, payload: several, boms: tpoBoms, bomAvailable: true })[1].tpo.quantity, 16);
  const scrap = transfer('120002', 'B-REG01', 3, { trnTime: null });
  assert.equal(derive.dailySystemSheets({ date, payload: basePayload([scrap]), boms, bomAvailable: true })[0].scrap.status, 'unavailable');
});

test('successful zero, missing shift, unverified units, posting outage and unavailable BOM remain distinct', () => {
  const payload = basePayload(); const run = (p, available = true) => derive.dailySystemSheets({ date, payload: p, boms, bomAvailable: available })[0];
  payload.bedlinerData = { date, data: [{ stockCode: '120002', status: 'available', quantity: 0, uom: 'EA' }] };
  assert.equal(run(payload).scrap.quantity, 0); assert.equal(run(payload).bedliners.quantity, 0);
  assert.equal(run({ ...payload, data: payload.data.filter((row) => row.shift !== 'night') }).received.status, 'unavailable');
  assert.equal(run({ ...payload, postingData: { status: 'unavailable', error: 'Test outage', rows: [] } }).tpo.status, 'unavailable');
  assert.equal(run({ ...payload, postingData: { status: 'unavailable', error: 'Test outage', rows: [] } }).bedliners.quantity, 0);
  assert.equal(run(payload, false).tpo.status, 'mapping_unverified');
  assert.equal(run({ ...payload, stockCoverage: [] }).scrap.status, 'unavailable');
  assert.equal(run({ ...payload, data: payload.data.map((row) => ({ ...row, uom: '' })) }).received.status, 'unavailable');
});

test('an unclassified finished product remains visible and cannot turn into a false zero category', () => {
  const payload = basePayload([entry({ description: 'Unclassified product' })]);
  const rows = derive.dailySystemSheets({ date, payload, boms, bomAvailable: true });
  assert.equal(rows[0].tpo.status, 'mapping_unverified'); assert.equal(rows[0].bedliners.status, 'unavailable'); assert.equal(rows[0].tailgates.status, 'unavailable');
  assert.equal(rows[0].finishedGoodsRows.length, 1); assert.match(rows[0].mappings[0].reason, /classification is unverified/);
  assert.equal(rows[1].tailgates.quantity, null);
});

test('TPO products map to 121047 TPO Sheet and calculate TPO Built', () => {
  const tpoCode = 'N1WB-E13036-K';
  assert.equal(derive.finishedProductRole(tpoCode, 'Floor,TPO, DBL, LHD'), 'tpo');
  const tpoBoms = [...boms, bom(tpoCode, '121047', { qtyPer: 1, componentUom: 'KG' })];
  const tpoEntry = entry({ stockCode: tpoCode, description: 'Floor,TPO, DBL, LHD', trnTime: 11000000, trnQty: 15, journalQty: 15 });
  const payload = basePayload([tpoEntry]);
  const rows = derive.dailySystemSheets({ date, payload, boms: tpoBoms, bomAvailable: true });
  assert.equal(rows[1].tpo.quantity, 15);
  assert.equal(rows[1].tpo.uom, 'EA');
  assert.equal(rows[0].tpo.quantity, 0);
  assert.equal(rows[2].tpo.quantity, 0);
});

test('daily endpoint validates configured scope, uses SELECT-only parameters and supports independent failures', async () => {
  const db = require('../server/db'), original = db.query; const calls = [];
  const metadata = codes.map((stockCode) => ({ stockCode, warehouseExists: 1, earliestEntryDate: new Date('2025-01-01T00:00:00Z'), stockUom: 'Pcs' }));
  db.query = async (query, parameters) => { calls.push({ query, parameters }); return query.includes("m.Warehouse = 'B-FIN01'") ? [] : metadata; };
  const app = require('express')(); app.use(require('../server/routes/sheetAnalysis')); const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/sheet-analysis/system`, qs = new URLSearchParams({ date, shifts: JSON.stringify(rules) });
  try {
    for (const suffix of ['?date=2026-02-30&shifts=[]', '?date=2026-11-18&shifts=[]', '?date=2026-11-18&shifts=invalid']) assert.equal((await fetch(base + suffix)).status, 400);
    assert.equal(calls.length, 0);
    const response = await fetch(`${base}?${qs}`); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).data.length, 9);
    assert.ok(calls.every((call) => !/\b(UPDATE|DELETE|INSERT|MERGE|EXEC)\b/i.test(call.query)));
    assert.equal(calls[0].parameters[0].value.toISOString(), '2026-11-18T00:00:00.000Z');
    db.query = async (query) => { if (query.includes("m.Warehouse = 'B-FIN01'")) throw Object.assign(new Error('Private SQL connection'), { code: 'ETIMEOUT' }); return metadata; };
    const partial = await (await fetch(`${base}?${qs}`)).json(); assert.equal(partial.postingData.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(partial), /Private/); assert.equal(partial.data[0].qtyReceived.quantity, 0);
    db.query = async (query) => { if (query.includes("m.Warehouse = 'B-FIN01'") && query.includes('CAST(NULL AS decimal')) return [entry({ trnTime: null })]; throw Object.assign(new Error("Invalid column name 'TrnTime'"), { number: 207 }); };
    const dated = await (await fetch(`${base}?${qs}`)).json(); assert.equal(dated.data[0].totalIssue.status, 'unavailable_by_shift'); assert.equal(dated.postingData.rows[0].shiftStatus, 'unavailable_by_shift');
    db.query = async () => { throw Object.assign(new Error('Private server details'), { code: 'ETIMEOUT' }); };
    const outage = await fetch(`${base}?${qs}`); assert.equal(outage.status, 503); assert.doesNotMatch(await outage.text(), /Private/);
  } finally { db.query = original; await new Promise((resolve) => server.close(resolve)); }
});
