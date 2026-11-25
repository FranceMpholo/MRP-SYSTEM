// Live SELECT-only acceptance; application storage and business data are untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const db = require('../server/db');
const { movementLocal } = require('../server/services/cycleCountMovements');
const { mapBomRow } = require('../server/bomMapping');
const out = path.resolve(__dirname, '../diagnostics/sheet-analysis-system');
const date = process.argv[2] || '2026-11-18';
(async () => {
  const { SHIFT_CONFIG } = await import('../mrp-planner/src/planning/shiftConfig.js');
  const { dailySystemSheets, sheetMapping, SCRAP_DESTINATIONS } = await import('../mrp-planner/src/dashboard/deriveDailySheetAnalysis.js');
  const rules = Object.values(SHIFT_CONFIG).map(({ start, end }, i) => ({ shift: ['morning', 'afternoon', 'night'][i], start, end }));
  const app = require('express')(); app.use('/api/syspro', require('../server/routes/sheetAnalysis'));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  try {
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/syspro/sheet-analysis/system?${new URLSearchParams({ date, shifts: JSON.stringify(rules) })}`);
    const payload = await response.json(), elapsedMs = Date.now() - started;
    assert.equal(response.status, 200); assert.equal(payload.success, true);
    const boms = (await db.query(require('../server/routes/inventory').BOM_SQL)).map(mapBomRow);
    const summaries = dailySystemSheets({ date, payload, boms, bomAvailable: true });
    const parameters = [{ name: 'StartDay', type: sql.Date, value: new Date(`${date}T00:00:00Z`) },
      { name: 'EndDay', type: sql.Date, value: new Date(`${payload.windows.map((window) => window.endDayExclusive).sort().at(-1)}T00:00:00Z`) }];
    const journal = await db.query(`SELECT d.StockCode AS stockCode,d.Warehouse AS warehouse,d.TrnType AS trnType,
        d.TrnQty AS journalQty,d.TransferFlag AS transferFlag,d.TransferToWh AS transferToWh,d.GtrReference AS gtrReference,d.Uom,
        d.JnlYear,d.JnlMonth,d.Journal,d.EntryNumber,m.EntryDate AS entryDate,m.TrnTime AS trnTime,m.NewWarehouse AS newWarehouse
      FROM dbo.InvJournalDet d JOIN dbo.InvMovements m ON m.TrnYear=d.JnlYear AND m.TrnMonth=d.JnlMonth
        AND m.Journal=d.Journal AND m.JournalEntry=d.EntryNumber AND m.StockCode=d.StockCode AND m.Warehouse=d.Warehouse
      WHERE m.EntryDate>=@StartDay AND m.EntryDate<@EndDay
        AND ((d.StockCode IN ('120002','121047','120003') AND d.Warehouse IN ('B-WIP01','B-REG01','B-SCR01'))
          OR (d.Warehouse='B-FIN01' AND (d.StockCode LIKE '%12606%' OR d.StockCode LIKE '%2600038%' OR d.StockCode LIKE '%40726%' OR d.StockCode LIKE '%2640726%' OR d.StockCode LIKE '%13036%')))
      ORDER BY m.EntryDate,m.TrnTime,d.StockCode`, parameters);
    const selected = journal.filter((row) => { const at = movementLocal(row); return payload.windows.some((window) => at && at >= window.startLocal && at < window.endLocal); });
    const comparison = summaries.map((row) => {
      const matched = selected.filter((item) => item.stockCode.trim() === row.stockCode && item.warehouse.trim() === 'B-WIP01');
      const issue = matched.filter((item) => item.trnType.trim() === 'I').reduce((sum, item) => sum + item.journalQty, 0);
      const receipt = matched.filter((item) => item.trnType.trim() === 'T' && item.transferFlag.trim() === 'I').reduce((sum, item) => sum + item.journalQty, 0);
      // This day's RAW origin is independently visible in the API's source-link evidence.
      assert.ok(payload.movementEvidence.filter((item) => item.stockCode === row.stockCode && item.trnType.trim() === 'T' && item.transferFlag.trim() === 'I').every((item) => item.sourceWarehouseMin === 'B-RAW01' && item.sourceWarehouseMax === 'B-RAW01'));
      assert.equal(row.issued.quantity, issue); assert.equal(row.received.quantity, receipt);
      const destination = SCRAP_DESTINATIONS[row.stockCode];
      const scrapJournalRows = selected.filter((item) => item.stockCode.trim() === row.stockCode && item.trnType.trim() === 'T'
        && item.transferFlag.trim() === 'O' && ((item.warehouse.trim() === 'B-WIP01' && item.transferToWh.trim() === destination)
          || (item.warehouse.trim() === destination && item.transferToWh.trim() === 'B-WIP01')));
      const identities = scrapJournalRows.map((item) => JSON.stringify([item.JnlYear, item.JnlMonth, item.Journal, item.EntryNumber, item.stockCode.trim(), item.warehouse.trim(), item.entryDate, item.trnTime]));
      assert.equal(new Set(identities).size, identities.length, 'Journal join duplicated a scrap source leg');
      assert.ok(scrapJournalRows.every((item) => item.newWarehouse.trim() === item.transferToWh.trim()), 'Journal and movement destination disagree');
      const journalScrap = scrapJournalRows.reduce((sum, item) => sum + (item.warehouse.trim() === 'B-WIP01' ? item.journalQty : -item.journalQty), 0);
      assert.equal(row.scrap.status, 'available'); assert.equal(row.scrap.quantity, journalScrap);
      return { stockCode: row.stockCode, uom: row.uom, received: row.received, journalReceived: receipt, issued: row.issued, journalIssued: issue,
        scrap: row.scrap, journalScrap, scrapDestination: destination, scrapJournalLegs: scrapJournalRows.length,
        confirmedScrap: row.scrapConfirmed, regRows: row.regRows.length, bedliners: row.bedliners, tailgates: row.tailgates };
    });
    const fgJournal = selected.filter((row) => row.warehouse.trim() === 'B-FIN01' && row.trnType.trim() === 'T' && row.transferFlag.trim() === 'I');
    const fgReferences = [...new Map(fgJournal.filter((row) => String(row.gtrReference || '').trim()).map((row) => {
      const reference = { stockCode: row.stockCode.trim(), gtrReference: String(row.gtrReference).trim() };
      return [[reference.stockCode, reference.gtrReference].join('/'), reference];
    })).values()];
    const sourceParameters = fgReferences.flatMap((row, i) => [
      { name: `SourceCode${i}`, type: sql.VarChar(30), value: row.stockCode },
      { name: `GtrReference${i}`, type: sql.VarChar(60), value: row.gtrReference },
    ]);
    const fgSources = fgReferences.length ? await db.query(`SELECT s.StockCode AS stockCode,s.Reference AS gtrReference,
        MIN(LTRIM(RTRIM(s.Warehouse))) AS sourceWarehouseMin,MAX(LTRIM(RTRIM(s.Warehouse))) AS sourceWarehouseMax
      FROM dbo.InvMovements s JOIN dbo.InvJournalDet j ON j.JnlYear=s.TrnYear AND j.JnlMonth=s.TrnMonth
        AND j.Journal=s.Journal AND j.EntryNumber=s.JournalEntry AND j.StockCode=s.StockCode AND j.Warehouse=s.Warehouse
      WHERE s.MovementType='I' AND s.TrnType='T' AND s.NewWarehouse='B-FIN01'
        AND j.TrnType='T' AND j.TransferFlag='O' AND j.TransferToWh='B-FIN01'
        AND j.GtrReference=s.Reference AND j.TrnQty=-s.TrnQty
        AND (${fgReferences.map((_, i) => `(s.StockCode=@SourceCode${i} AND s.Reference=@GtrReference${i})`).join(' OR ')})
      GROUP BY s.StockCode,s.Reference`, sourceParameters) : [];
    const sourceByGtr = new Map(fgSources.map((row) => [[row.stockCode.trim(), row.gtrReference.trim()].join('/'), row]));
    const verifiedFgJournal = fgJournal.filter((row) => {
      const source = sourceByGtr.get([row.stockCode.trim(), String(row.gtrReference || '').trim()].join('/'));
      return source?.sourceWarehouseMin === 'B-WIP01' && source.sourceWarehouseMax === 'B-WIP01';
    });
    const fgApi = payload.postingData.rows.filter((row) => row.category === 'finishedGoods' && row.status === 'available' && row.shift);
    const fgByCode = [...new Set(fgApi.map((row) => row.stockCode))].map((stockCode) => {
      const apiQty = fgApi.filter((row) => row.stockCode === stockCode).reduce((sum, row) => sum + row.quantity, 0);
      const apiRows = fgApi.filter((row) => row.stockCode === stockCode);
      assert.ok(apiRows.every((row) => {
        const source = sourceByGtr.get([row.stockCode.trim(), String(row.gtrReference || '').trim()].join('/'));
        return source?.sourceWarehouseMin === 'B-WIP01' && source.sourceWarehouseMax === 'B-WIP01';
      }), `${stockCode} API FG receipt is not independently linked to B-WIP01`);
      const journalQty = verifiedFgJournal.filter((row) => row.stockCode.trim() === stockCode).reduce((sum, row) => sum + row.journalQty, 0);
      assert.equal(apiQty, journalQty);
      return { stockCode, apiQty, journalQty, verifiedWipSourceReceiptCount: verifiedFgJournal.filter((row) => row.stockCode.trim() === stockCode).length,
        mapping: sheetMapping(stockCode, boms, true) };
    });
    const mappingChecks = ['N1WB-E40726-DC', 'N1WB-E40726-CJ', 'N1WB-E40726-CJ-RAP', 'N1WZ-2640726-K', 'N1WZ-2640726-M'].map((code) => sheetMapping(code, boms, true));
    const night = payload.windows.find((window) => window.shift === 'night');
    const nextDate = night.endLocal.slice(0, 10);
    const boundary = { night, nextDateRowsIncluded: selected.filter((row) => String(row.entryDate.toISOString()).startsWith(nextDate)).length,
      rowsOutsideConfiguredWindowsExcluded: journal.length - selected.length,
      sampleNextDate: selected.filter((row) => row.entryDate.toISOString().startsWith(nextDate)).slice(0, 3).map((row) => ({ stockCode: row.stockCode, postingLocal: movementLocal(row) })) };
    const report = { checkedAt: new Date().toISOString(), liveSyspro: true, physicalCycleCounts: 'Not accessible: actual operator browser storage not connected. No live count totals claimed.',
      status: response.status, elapsedMs, date, configuredShiftSource: 'Repository defaults; operator override settings not accessible', comparison, fgByCode, mappingChecks, boundary };
    fs.mkdirSync(out, { recursive: true });
    for (const [name, data] of Object.entries({ 'live-system-report': report, 'live-system-payload': payload, 'live-system-journal': journal, 'live-bom': boms })) fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(data, null, 2));
    const compact = (metric) => ({ status: metric.status, quantity: metric.quantity, uom: metric.uom, reason: metric.reason });
    console.log(JSON.stringify({ status: response.status, elapsedMs, comparison: comparison.map((row) => ({ stockCode: row.stockCode,
      received: compact(row.received), journalReceived: row.journalReceived, issued: compact(row.issued), journalIssued: row.journalIssued,
      scrap: compact(row.scrap), journalScrap: row.journalScrap, scrapDestination: row.scrapDestination, scrapJournalLegs: row.scrapJournalLegs,
      confirmedScrap: compact(row.confirmedScrap), bedliners: compact(row.bedliners), tailgates: compact(row.tailgates) })),
      fgByCode: fgByCode.map(({ stockCode, apiQty, journalQty, mapping }) => ({ stockCode, apiQty, journalQty, mappingStatus: mapping.status, sheets: mapping.candidateSheets })),
      mappingChecks: mappingChecks.map(({ stockCode, status, candidateSheets, reason }) => ({ stockCode, status, candidateSheets, reason })), boundary }, null, 2));
  } finally { await new Promise((resolve) => server.close(resolve)); await db.close(); }
})().catch((error) => { console.error(error.code === 'ERR_ASSERTION' ? error.stack : error.code || 'Live verification failed'); process.exitCode = 1; });
