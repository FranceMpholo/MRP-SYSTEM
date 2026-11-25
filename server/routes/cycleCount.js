const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const db = require('../db');
const { validDate } = require('./productionScrap');
const { deriveEosBalances } = require('../services/cycleCountEos');
const { STOCK_CODES, shiftWindow, deriveMovementTotals } = require('../services/cycleCountMovements');
const { sendFailure } = require('../sysproErrors');
const queryTemplate = fs.readFileSync(path.join(__dirname, '../queries/cycleCountEos.sql'), 'utf8');
const movementQuery = fs.readFileSync(path.join(__dirname, '../queries/cycleCountMovements.sql'), 'utf8');
const router = express.Router();

router.get('/cycle-count/movements', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const { date, shift, start, end } = request.query;
  let window;
  try {
    if (!validDate(date) || date < '2000-01-01' || date >= '9999-12-30') throw new Error('Invalid date');
    window = shiftWindow(date, shift, start, end);
  } catch {
    return response.status(400).json({ success: false, error: 'Choose a valid production date, shift and configured start/end times.' });
  }
  try {
    const rows = await db.query(movementQuery, [
      { name: 'StartDay', type: sql.Date, value: new Date(`${window.startDay}T00:00:00Z`) },
      { name: 'EndDayExclusive', type: sql.Date, value: new Date(`${window.endDayExclusive}T00:00:00Z`) },
      // UTC-shaped Date objects transport SQL's timezone-free plant wall clock.
      { name: 'StartLocal', type: sql.DateTime2, value: new Date(`${window.startLocal}Z`) },
      { name: 'EndLocal', type: sql.DateTime2, value: new Date(`${window.endLocal}Z`) },
    ]);
    response.json({ success: true, data: deriveMovementTotals(window, rows), window,
      basis: 'Plant local entry date/time (SAST), start inclusive/end exclusive. Net signed WIP receipt legs linked to RAW; net signed inventory issues. Later postings may revise totals.' });
  } catch (error) {
    if (Number(error.number) === 207 && /TrnTime|EntryDate/i.test(error.message || '')) {
      return response.json({ success: true, window, data: STOCK_CODES.map((stockCode) => ({ stockCode,
        productionDate: date, shift, warehouse: 'B-WIP01', qtyReceived: { status: 'unavailable_by_shift', quantity: null, reason: 'SYSPRO does not expose a verified transaction timestamp.' },
        totalIssue: { status: 'unavailable_by_shift', quantity: null, reason: 'SYSPRO does not expose a verified transaction timestamp.' } })) });
    }
    return sendFailure(response, error, 'SYSPRO cycle-count movements');
  }
});

router.get('/cycle-count/eos', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const { date, stockCodes: rawCodes } = request.query;
  const stockCodes = typeof rawCodes === 'string' ? [...new Set(rawCodes.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean))] : [];
  if (!validDate(date) || date < '2000-01-01' || date >= '9999-12-30'
      || !stockCodes.length || stockCodes.length > 100 || stockCodes.some((code) => code.length > 30)) {
    return response.status(400).json({ success: false, error: 'Choose a valid date and 1–100 stock codes.' });
  }
  const parameters = [{ name: 'ProductionDate', type: sql.Date, value: new Date(`${date}T00:00:00Z`) },
    ...stockCodes.map((value, index) => ({ name: `StockCode${index}`, type: sql.VarChar(30), value }))];
  const query = queryTemplate.replaceAll('/* STOCK_CODES */', stockCodes.map((_, index) => `@StockCode${index}`).join(', '));
  try {
    const rows = await db.query(query, parameters);
    const data = deriveEosBalances(date, stockCodes, rows);
    response.json({ success: true, date, data, count: data.length,
      basis: 'B-WIP01 reconstructed by SYSPRO entry date/time, using reconciled retained financial periods. Shift close: 15:00, 22:00, and next-day 06:00 SAST. Later backdated postings can revise historical balances.' });
  } catch (error) {
    console.error('SYSPRO cycle-count EOS read failed:', error.message);
    response.status(503).json({ success: false, error: 'Historical SYSPRO shift-close balances are unavailable.' });
  }
});

module.exports = router;
