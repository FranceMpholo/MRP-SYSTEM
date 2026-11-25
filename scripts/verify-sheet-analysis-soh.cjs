// SELECT-only verification of the configured closing balance against a separate
// financial-period opening + earlier journal movement reconstruction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const db = require('../server/db');
const codes = ['120002', '121047', '120003'];
const out = path.resolve(__dirname, '../diagnostics/sheet-analysis-soh');
const date = process.argv[2] || '2026-11-18';
(async () => {
  const app = require('express')(); app.use('/api/syspro', require('../server/routes/sheetAnalysis'));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  try {
    const checks = [];
    for (const end of ['06:00', '05:30']) {
      const shifts = [{ shift: 'morning', start: '06:00', end: '15:00' }, { shift: 'afternoon', start: '15:00', end: '22:00' }, { shift: 'night', start: '22:00', end }];
      const started = Date.now();
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/syspro/sheet-analysis/closing-soh?${new URLSearchParams({ date, shifts: JSON.stringify(shifts) })}`);
      const payload = await response.json(), elapsedMs = Date.now() - started;
      assert.equal(response.status, 200); assert.ok(payload.data.every((row) => row.status === 'available'), 'All three historical balances must reconcile');
      const rows = await db.query(`WITH Clocked AS (
        SELECT m.StockCode, m.MovementType, m.TrnType, m.TrnQty,
          CASE WHEN m.TrnTime>=0 AND m.TrnTime<=23595999 AND FLOOR(m.TrnTime/10000)%100<60 AND FLOOR(m.TrnTime/100)%100<60
            THEN DATEADD(millisecond,CAST(m.TrnTime%100 AS int)*10,
              DATEADD(second,CAST(FLOOR(m.TrnTime/1000000) AS int)*3600+CAST(FLOOR(m.TrnTime/10000)%100 AS int)*60+CAST(FLOOR(m.TrnTime/100)%100 AS int),
                CONVERT(datetime2,CONVERT(date,m.EntryDate)))) END AS atLocal,
          CASE WHEN m.MovementType='I' AND m.TrnType='I' THEN -m.TrnQty
            WHEN m.MovementType='I' AND m.TrnType IN ('T','R','A') THEN m.TrnQty ELSE 0 END AS delta
        FROM dbo.InvMovements m CROSS JOIN dbo.InvControl c
        WHERE m.StockCode IN ('120002','121047','120003') AND m.Warehouse='B-WIP01'
          AND m.TrnYear=c.FinYear AND m.TrnMonth=c.FinMonth AND m.TrnQty<>0
      )
      SELECT w.StockCode stockCode,w.OpenBalQty1 openingQty,w.QtyOnHand currentSoh,i.StockUom uom,
        COALESCE(SUM(CASE WHEN m.atLocal<@CutoffLocal THEN m.delta ELSE 0 END),0) beforeQty,
        COALESCE(SUM(m.delta),0) netQty,
        SUM(CASE WHEN m.StockCode IS NOT NULL AND m.atLocal IS NULL THEN 1 ELSE 0 END) invalidTimes,
        SUM(CASE WHEN m.StockCode IS NOT NULL AND (m.MovementType<>'I' OR m.TrnType NOT IN ('I','T','R','A','C')) THEN 1 ELSE 0 END) unsupported,
        c.FinYear,c.FinMonth
      FROM dbo.InvWarehouse w CROSS JOIN dbo.InvControl c LEFT JOIN Clocked m ON m.StockCode=w.StockCode
      LEFT JOIN dbo.InvMaster i ON i.StockCode=w.StockCode
      WHERE w.StockCode IN ('120002','121047','120003') AND w.Warehouse='B-WIP01'
      GROUP BY w.StockCode,w.OpenBalQty1,w.QtyOnHand,i.StockUom,c.FinYear,c.FinMonth`, [
        { name: 'CutoffLocal', type: sql.DateTime2, value: new Date(`${payload.cutoffLocal}Z`) },
      ]);
      const comparison = codes.map((stockCode) => {
        const row = rows.find((item) => item.stockCode.trim() === stockCode), actual = payload.data.find((item) => item.stockCode === stockCode);
        assert.ok(row); assert.equal(row.invalidTimes, 0); assert.equal(row.unsupported, 0);
        // This acceptance date is in the live current period. Do not silently
        // apply the current opening if re-running after the period changes.
        assert.equal(row.FinYear, 2027); assert.equal(row.FinMonth, 8);
        assert.ok(Math.abs(row.openingQty + row.netQty - row.currentSoh) < 0.00011);
        const independentlyReconstructed = Math.round((row.openingQty + row.beforeQty) * 10000) / 10000;
        assert.ok(Math.abs(actual.quantity - independentlyReconstructed) < 0.00011);
        return { stockCode, uom: row.uom, apiSoh: actual.quantity, independentSoh: independentlyReconstructed,
          periodOpening: row.openingQty, preCloseNetMovements: row.beforeQty, cutoffAt: actual.cutoffAt };
      });
      checks.push({ status: response.status, elapsedMs, productionDate: date, cutoffLocal: payload.cutoffLocal, comparison });
    }
    const report = { checkedAt: new Date().toISOString(), liveSyspro: true, checks, readOnly: true,
      basis: 'Historical API rolls current stock backwards after the cutoff; independent query rolls the reconciled current-period opening forwards before it. Movement at the exact close is excluded from Shift 3.' };
    fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, date === '2026-11-18' ? 'live-soh-verification.json' : `live-soh-verification-${date}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await new Promise((resolve) => server.close(resolve)); await db.close(); }
})().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; });
