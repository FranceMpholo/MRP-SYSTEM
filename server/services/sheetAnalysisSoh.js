const fs = require('node:fs');
const path = require('node:path');
const { STOCK_CODES } = require('./cycleCountMovements');
const { deriveEosBalances } = require('./cycleCountEos');

// Use the established retained-period reconciliation and signed movement rules.
// Cycle Count's original fixed cutoffs remain unchanged for its callers.
const closingSohQuery = fs.readFileSync(path.join(__dirname, '../queries/cycleCountEos.sql'), 'utf8')
  .replaceAll('/* STOCK_CODES */', STOCK_CODES.map((_, i) => `@StockCode${i}`).join(', '))
  .replaceAll('DATEADD(hour, 30, CONVERT(datetime2, @ProductionDate))', '@CutoffLocal');
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

function deriveSheetClosingSoh(date, thirdShift, rows, now = Date.now()) {
  const cutoffWallTime = Date.parse(`${thirdShift.endLocal}Z`);
  return STOCK_CODES.map((stockCode) => {
    const periods = rows.filter((row) => row.stockCode === stockCode);
    const missing = !periods.length || periods.some((row) => !Number.isFinite(Date.parse(row.fetchedAt))
      || !['nightAfterQty', 'nightAfterCount', 'unsupportedCount', 'invalidTimeCount'].every((field) => finite(row[field])));
    const base = { stockCode, warehouse: 'B-WIP01', productionDate: date, shift: thirdShift.shift,
      cutoffAt: new Date(cutoffWallTime - 7200000).toISOString(), cutoffLocal: thirdShift.endLocal,
      source: 'SYSPRO_RECONSTRUCTED_SHIFT_CLOSE' };
    if (Date.parse(base.cutoffAt) > now) return { ...base, status: 'in_progress', quantity: null, reason: 'Shift cycle in progress' };
    if (missing) return { ...base, status: 'unavailable', quantity: null, reason: 'Verified retained movement history or its capture time is unavailable.' };
    const balance = deriveEosBalances(date, [stockCode], periods, { night: cutoffWallTime }).find((row) => row.shift === 'night');
    return { ...balance, ...base, quantity: balance.expectedEosSoh };
  });
}

module.exports = { closingSohQuery, deriveSheetClosingSoh };
