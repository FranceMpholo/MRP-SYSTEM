// SELECT-only live acceptance check. No business data or application state is written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/db');
const sql = require('mssql');
const out = path.resolve(__dirname, '../diagnostics/cycle-count-movements');
(async () => {
  const app = require('express')(); app.use('/api/syspro', require('../server/routes/cycleCount'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/syspro/cycle-count/movements?date=2026-11-18&shift=morning&start=06:00&end=15:00`);
    const payload = await response.json(), elapsedMs = Date.now() - started;
    assert.equal(response.status, 200); assert.equal(payload.success, true);
    // Independent journal-led comparison: quantities come from InvJournalDet;
    // InvMovements supplies the journal entry's actual entry timestamp only.
    const journal = await db.query(`SELECT d.StockCode, d.TrnType, d.TrnQty, d.TransferFlag, d.Uom, d.GtrReference,
        d.JnlYear, d.JnlMonth, d.Journal, d.EntryNumber, m.EntryDate, m.TrnTime
      FROM dbo.InvJournalDet d JOIN dbo.InvMovements m ON m.TrnYear=d.JnlYear AND m.TrnMonth=d.JnlMonth
        AND m.Journal=d.Journal AND m.JournalEntry=d.EntryNumber AND m.Warehouse=d.Warehouse AND m.StockCode=d.StockCode
      WHERE d.StockCode IN ('120002','121047','120003') AND d.Warehouse='B-WIP01'
        AND m.EntryDate='20261118' AND m.TrnTime>=6000000 AND m.TrnTime<15000000
        AND d.TrnType IN ('I','T') ORDER BY d.StockCode, m.TrnTime`);
    const receipts = journal.filter((row) => row.TrnType.trim() === 'T' && row.TransferFlag.trim() === 'I');
    const sources = [];
    for (const row of receipts) {
      const linked = await db.query(`SELECT d.StockCode,d.Warehouse,d.TransferToWh,d.TrnQty,d.GtrReference,d.TransferFlag
        FROM dbo.InvMovements m JOIN dbo.InvJournalDet d ON d.JnlYear=m.TrnYear AND d.JnlMonth=m.TrnMonth
          AND d.Journal=m.Journal AND d.EntryNumber=m.JournalEntry AND d.StockCode=m.StockCode AND d.Warehouse=m.Warehouse
        WHERE m.StockCode=@Code AND m.Reference=@Reference AND m.NewWarehouse='B-WIP01'
          AND d.GtrReference=@Reference AND d.TransferFlag='O' AND d.TransferToWh='B-WIP01'`, [
        { name: 'Code', type: sql.VarChar(30), value: row.StockCode }, { name: 'Reference', type: sql.VarChar(50), value: row.GtrReference },
      ]);
      assert.ok(linked.length, 'Every live receipt has a source journal leg');
      assert.ok(linked.every((entry) => entry.Warehouse.trim() === 'B-RAW01'));
      sources.push({ receiptJournal: row.Journal, receiptEntry: row.EntryNumber, stockCode: row.StockCode, gtrReference: row.GtrReference.trim(), sourceLegs: linked });
    }
    const comparison = payload.data.map((row) => {
      const sameCode = journal.filter((entry) => entry.StockCode.trim() === row.stockCode);
      const received = sameCode.filter((entry) => entry.TrnType.trim() === 'T' && entry.TransferFlag.trim() === 'I').reduce((sum, entry) => sum + entry.TrnQty, 0);
      const issued = sameCode.filter((entry) => entry.TrnType.trim() === 'I').reduce((sum, entry) => sum + entry.TrnQty, 0);
      assert.equal(row.qtyReceived.status, 'available'); assert.equal(row.totalIssue.status, 'available');
      assert.equal(row.qtyReceived.quantity, received); assert.equal(row.totalIssue.quantity, issued);
      return { stockCode: row.stockCode, uom: row.uom, apiQtyReceived: row.qtyReceived.quantity, journalQtyReceived: received,
        apiTotalIssue: row.totalIssue.quantity, journalTotalIssue: issued, journalEntryCount: sameCode.length };
    });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'live-comparison.json'), JSON.stringify({ checkedAt: new Date().toISOString(), status: response.status,
      elapsedMs, window: payload.window, comparison, sourceLinks: sources, journal }, null, 2));
    console.log(JSON.stringify({ live: true, status: response.status, elapsedMs, window: payload.window, comparison }, null, 2));
  } finally { await new Promise((resolve) => server.close(resolve)); await db.close(); }
})().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; });
