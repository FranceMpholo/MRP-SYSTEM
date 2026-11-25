// SELECT-only acceptance. Never opens or changes the operator's browser data.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), types = require('mssql');
const db = require('../server/db');
const { movementLocal } = require('../server/services/cycleCountMovements');
const { applicableMapping } = require('../server/services/tailgateBackflush');
const out = path.resolve(__dirname, '../diagnostics/tailgate-backflush');
const date = process.argv[2] || '2026-11-18';
(async () => {
  const { SHIFT_CONFIG } = await import('../mrp-planner/src/planning/shiftConfig.js');
  const shifts = Object.values(SHIFT_CONFIG).map(({ start, end }, i) => ({ shift: ['morning', 'afternoon', 'night'][i], start, end }));
  const app = require('express')(); app.use('/api/syspro', require('../server/routes/sheetAnalysis'));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  try {
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/syspro/sheet-analysis/tailgates?${new URLSearchParams({ date, shifts: JSON.stringify(shifts) })}`);
    const payload = await response.json(); assert.equal(response.status, 200); assert.equal(payload.data.length, 2);
    const elapsedMs = Date.now() - started;
    const endDay = payload.windows.map((row) => row.endDayExclusive).sort().at(-1);
    const journal = await db.query(`SELECT j.StockCode AS stockCode,j.Warehouse AS warehouse,j.JnlYear AS trnYear,j.JnlMonth AS trnMonth,
        j.Journal AS journal,j.EntryNumber AS journalEntry,j.TrnType AS trnType,j.TrnQty AS journalQty,j.TransferFlag AS transferFlag,
        j.GtrReference AS gtrReference,j.Job AS job,m.EntryDate AS entryDate,m.TrnTime AS trnTime
      FROM dbo.InvJournalDet j JOIN dbo.InvMovements m ON m.TrnYear=j.JnlYear AND m.TrnMonth=j.JnlMonth
        AND m.Journal=j.Journal AND m.JournalEntry=j.EntryNumber AND m.StockCode=j.StockCode AND m.Warehouse=j.Warehouse
      JOIN dbo.InvMaster i ON i.StockCode=j.StockCode
      WHERE j.Warehouse='B-FIN01' AND j.TrnType IN ('R','T') AND (j.TrnType<>'T' OR j.TransferFlag<>'O')
        AND (i.Description LIKE '%Tailgate%' OR i.Description LIKE '%Tlgt%' OR i.StockCode LIKE '%40726%')
        AND m.EntryDate>=@StartDay AND m.EntryDate<@EndDay`, [
      { name: 'StartDay', type: types.Date, value: new Date(`${date}T00:00:00Z`) },
      { name: 'EndDay', type: types.Date, value: new Date(`${endDay}T00:00:00Z`) },
    ]);
    const selected = journal.filter((row) => { const at = movementLocal(row); return at && payload.windows.some((window) => at >= window.startLocal && at < window.endLocal); });
    const boms = (await db.query(require('../server/routes/inventory').BOM_SQL)).map(require('../server/bomMapping').mapBomRow);
    const knownCodes = ['N1WB-E40726-CJ', 'N1WB-E40726-DC', 'N1WB-E40726-CJ-RAP'];
    const known = knownCodes.map((stockCode) => ({ stockCode, allRoutes: applicableMapping(stockCode, boms, date), route0: applicableMapping(stockCode, boms, date, { route: '0' }) }));
    assert.deepEqual(known.map((row) => row.route0.candidateSheets), [['120002'], ['120002'], ['120003']]);
    const discovered = payload.catalog.filter((row) => row.finishedWarehouseExists && row.candidateSheets.length);
    const codes = [...new Set([...discovered.map((row) => row.stockCode), ...payload.rows.map((row) => row.stockCode)])].sort();
    const comparison = codes.map((stockCode) => {
      const rows = payload.rows.filter((row) => row.stockCode === stockCode);
      const journalRows = selected.filter((row) => row.stockCode.trim() === stockCode);
      const journalReceiptUnits = journalRows.reduce((sum, row) => sum + Number(row.journalQty), 0);
      const candidateReceiptUnits = rows.reduce((sum, row) => sum + Number(row.quantity), 0);
      assert.equal(candidateReceiptUnits, journalReceiptUnits, stockCode);
      const verifiedUnits = rows.filter((row) => row.status === 'available').reduce((sum, row) => sum + row.quantity, 0);
      return { stockCode, candidateSheets: payload.catalog.find((row) => row.stockCode === stockCode)?.candidateSheets || [],
        additional: !knownCodes.includes(stockCode), candidateReceiptUnits, journalReceiptUnits, verifiedUnits,
        unresolvedReceipts: rows.filter((row) => row.status !== 'available').length, receiptCount: rows.length };
    });
    const report = { checkedAt: new Date().toISOString(), date, elapsedMs, shifts, source: 'Live read-only SYSPRO',
      scope: 'Receipt timestamps in repository-default SAST shifts; actual operator overrides and browser records not inspected',
      known, totals: payload.data, comparison, additionalCodes: discovered.filter((row) => !knownCodes.includes(row.stockCode)),
      limitations: 'GTR transfers without producing job/backflush lineage are not counted as built. Verified subtotal 0 is not a confirmed zero total when receipts are unresolved.' };
    fs.mkdirSync(out, { recursive: true });
    for (const [name, value] of Object.entries({ 'live-report': report, 'live-payload': payload, 'independent-journal': journal })) fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(value, null, 2));
    console.log(JSON.stringify({ date, elapsedMs, totals: payload.data, known: known.map((row) => ({ stockCode: row.stockCode, route0Sheets: row.route0.candidateSheets, allRoutesStatus: row.allRoutes.status })),
      additionalCodeCount: report.additionalCodes.length, comparison }, null, 2));
  } finally { await new Promise((resolve) => server.close(resolve)); await db.close(); }
})().catch((error) => { console.error(error.code === 'ERR_ASSERTION' ? error.stack : error.code || 'Tailgate verification failed'); process.exitCode = 1; });
