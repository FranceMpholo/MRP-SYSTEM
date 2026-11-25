const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const db = require('../db');
const { validDate } = require('./productionScrap');
const { STOCK_CODES, deriveMovementTotals, movementLocal } = require('../services/cycleCountMovements');
const { configuredWindows, normalizePostings } = require('../services/sheetAnalysisSystem');
const { describeError, sendFailure } = require('../sysproErrors');
const { closingSohQuery, deriveSheetClosingSoh } = require('../services/sheetAnalysisSoh');
const { readTailgates } = require('../services/tailgateBackflush');
const { readBedliners } = require('../services/bedlinerProduction');
const movementsSql = fs.readFileSync(path.join(__dirname, '../queries/cycleCountMovements.sql'), 'utf8');
const postingsSql = fs.readFileSync(path.join(__dirname, '../queries/sheetAnalysisPostings.sql'), 'utf8');
const router = express.Router();

for (const [kind, read] of [['tailgates', readTailgates], ['bedliners', readBedliners]]) router.get(`/sheet-analysis/${kind}`, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const { date, shifts } = request.query;
  let windows;
  try {
    if (!validDate(date) || date < '2000-01-01' || date >= '9999-12-30') throw new Error('Invalid date');
    windows = configuredWindows(date, JSON.parse(shifts));
  } catch { return response.status(400).json({ success: false, error: 'Choose a valid production date and three non-overlapping configured shifts.' }); }
  const first = [...windows].sort((a, b) => a.startLocal.localeCompare(b.startLocal))[0];
  const last = [...windows].sort((a, b) => b.endLocal.localeCompare(a.endLocal))[0];
  try {
    const data = await read(db, date, windows, [
      { name: 'StartDay', type: sql.Date, value: new Date(`${first.startDay}T00:00:00Z`) },
      { name: 'EndDayExclusive', type: sql.Date, value: new Date(`${last.endDayExclusive}T00:00:00Z`) },
    ]);
    return response.json({ success: true, ...data, data: data.sheets, fetchedAt: new Date().toISOString() });
  } catch (error) { return sendFailure(response, error, `SYSPRO ${kind} backflush`); }
});

router.get('/sheet-analysis/closing-soh', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const { date, shifts } = request.query;
  let thirdShift;
  try {
    if (!validDate(date) || date < '2000-01-01' || date >= '9999-12-30') throw new Error('Invalid date');
    thirdShift = configuredWindows(date, JSON.parse(shifts)).find((window) => window.shift === 'night');
  } catch { return response.status(400).json({ success: false, error: 'Choose a valid production date and three non-overlapping configured shifts.' }); }
  try {
    const rows = Date.parse(thirdShift.endAt) > Date.now() ? [] : await db.query(closingSohQuery, [
      { name: 'ProductionDate', type: sql.Date, value: new Date(`${date}T00:00:00Z`) },
      { name: 'CutoffLocal', type: sql.DateTime2, value: new Date(`${thirdShift.endLocal}Z`) },
      ...STOCK_CODES.map((value, i) => ({ name: `StockCode${i}`, type: sql.VarChar(30), value })),
    ]);
    return response.json({ success: true, date, data: deriveSheetClosingSoh(date, thirdShift, rows),
      cutoffAt: thirdShift.endAt, cutoffLocal: thirdShift.endLocal,
      basis: 'B-WIP01 immediately before the configured Shift 3 closing boundary, reconstructed from reconciled retained SYSPRO movements. Later backdated postings can revise history.' });
  } catch (error) { return sendFailure(response, error, 'SYSPRO Sheet Analysis historical SOH'); }
});

router.get('/sheet-analysis/system', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const { date, shifts } = request.query;
  let windows;
  try {
    if (!validDate(date) || date < '2000-01-01' || date >= '9999-12-30') throw new Error('Invalid date');
    windows = configuredWindows(date, JSON.parse(shifts));
  } catch { return response.status(400).json({ success: false, error: 'Choose a valid production date and three non-overlapping configured shifts.' }); }
  const first = [...windows].sort((a, b) => a.startLocal.localeCompare(b.startLocal))[0];
  const last = [...windows].sort((a, b) => b.endLocal.localeCompare(a.endLocal))[0];
  const parameters = [
    { name: 'StartDay', type: sql.Date, value: new Date(`${first.startDay}T00:00:00Z`) },
    { name: 'EndDayExclusive', type: sql.Date, value: new Date(`${last.endDayExclusive}T00:00:00Z`) },
    { name: 'StartLocal', type: sql.DateTime2, value: new Date(`${first.startLocal}Z`) },
    { name: 'EndLocal', type: sql.DateTime2, value: new Date(`${last.endLocal}Z`) },
  ];
  const readPostings = async () => {
    try { return await db.query(postingsSql, parameters); }
    catch (error) {
      // Some installations expose EntryDate only. Preserve calendar-date
      // evidence explicitly; never invent midnight as the posting time.
      if (Number(error.number) === 207 && /TrnTime/i.test(error.message || '')) {
        return db.query(postingsSql.replace('m.TrnTime,', 'CAST(NULL AS decimal(8,0)) AS TrnTime,'), parameters);
      }
      throw error;
    }
  };
  const [movements, postings] = await Promise.allSettled([db.query(movementsSql, parameters), readPostings()]);
  if (movements.status === 'rejected' && postings.status === 'rejected') return sendFailure(response, movements.reason, 'SYSPRO Sheet Analysis');
  const fetchedAt = new Date().toISOString();
  const movementFailure = movements.status === 'rejected' ? describeError(movements.reason).error : '';
  const movementTimeMissing = movements.status === 'rejected' && Number(movements.reason.number) === 207 && /TrnTime/i.test(movements.reason.message || '');
  const postingFailure = postings.status === 'rejected' ? describeError(postings.reason).error : '';
  const data = windows.flatMap((window) => movements.status === 'fulfilled' ? deriveMovementTotals(window, movements.value, fetchedAt)
    : STOCK_CODES.map((stockCode) => ({ stockCode, productionDate: date, shift: window.shift, warehouse: 'B-WIP01',
      qtyReceived: { status: movementTimeMissing ? 'unavailable_by_shift' : 'unavailable', quantity: null, reason: movementTimeMissing ? 'The feed has posting dates without verified transaction times.' : movementFailure }, totalIssue: { status: movementTimeMissing ? 'unavailable_by_shift' : 'unavailable', quantity: null, reason: movementTimeMissing ? 'The feed has posting dates without verified transaction times.' : movementFailure } })));
  return response.json({ success: true, date, data, windows, fetchedAt,
    stockCoverage: STOCK_CODES.map((stockCode) => {
      const row = movements.status === 'fulfilled' ? movements.value.find((item) => item.stockCode.trim() === stockCode) : null;
      return { stockCode, warehouseExists: Boolean(row?.warehouseExists), earliestEntryDate: row?.earliestEntryDate || null };
    }),
    movementEvidence: movements.status === 'fulfilled' ? movements.value.filter((row) => row.entryDate).map((row) => {
      const postingLocal = movementLocal(row);
      return { ...row, postingLocal, shift: windows.find((window) => postingLocal && postingLocal >= window.startLocal && postingLocal < window.endLocal)?.shift || null };
    }) : [],
    postingData: { status: postings.status === 'fulfilled' ? 'connected' : 'unavailable', error: postingFailure,
      rows: postings.status === 'fulfilled' ? normalizePostings(postings.value, windows) : [] },
    basis: 'Selected production-date configured shifts in SAST, overnight under its start date. Sheet stock units and finished part units remain separate. FG receipt timestamp is when output was posted to finished goods, not when formed.' });
});

module.exports = router;
