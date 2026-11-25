const { deriveBuiltParts } = require('./tailgateBackflush');
// A Built quantity is established at the producing backflush, not when older
// in-transit inventory is subsequently received into the finished warehouse.
const scope = `(i.Description LIKE '%Bedliner%' OR i.Description LIKE '%Lnr%')`;
const selected = `SELECT m.StockCode AS stockCode,i.Description AS description,i.StockUom AS stockUom,
    m.Warehouse AS warehouse,m.EntryDate AS entryDate,m.TrnTime AS trnTime,
    m.TrnYear AS trnYear,m.TrnMonth AS trnMonth,m.Journal AS journal,m.JournalEntry AS journalEntry,
    m.MovementType AS movementType,m.TrnType AS trnType,m.TrnQty AS trnQty,
    j.TrnType AS journalType,j.TrnQty AS journalQty,j.Uom AS journalUom,
    m.Reference AS reference,j.Reference AS journalReference,m.Job AS movementJob,j.Job AS journalJob,
    m.Version AS version,m.Release AS release,w.StockCode AS jobStockCode,w.Route AS jobRoute,
    w.Version AS jobVersion,w.Release AS jobRelease
    FROM dbo.InvMaster i JOIN dbo.InvMovements m ON m.StockCode=i.StockCode AND m.Warehouse='B-WIP01'
    LEFT JOIN dbo.InvJournalDet j ON j.JnlYear=m.TrnYear AND j.JnlMonth=m.TrnMonth
        AND j.Journal=m.Journal AND j.EntryNumber=m.JournalEntry AND j.StockCode=m.StockCode AND j.Warehouse=m.Warehouse
    LEFT JOIN dbo.WipMaster w ON w.Job=COALESCE(NULLIF(LTRIM(RTRIM(j.Job)),''),NULLIF(LTRIM(RTRIM(m.Job)),''))
    WHERE ${scope} AND m.TrnType='R' AND (m.Reference LIKE 'Backflush%' OR j.Reference LIKE 'Backflush%')
        AND m.EntryDate>=@StartDay AND m.EntryDate<@EndDayExclusive`;
const receiptsSql = `${selected} ORDER BY m.EntryDate,m.TrnTime,m.StockCode`;
const journalSql = `WITH Selected AS (${selected}), Journals AS (SELECT DISTINCT trnYear,trnMonth,journal FROM Selected)
    SELECT d.StockCode AS stockCode,d.Warehouse AS warehouse,d.TrnType AS trnType,d.TrnQty AS journalQty,
        d.Uom AS journalUom,d.Reference AS reference,d.JnlYear AS trnYear,d.JnlMonth AS trnMonth,
        d.Journal AS journal,d.EntryNumber AS journalEntry,d.Job AS journalJob,i.StockUom AS stockUom,
        m.EntryDate AS entryDate,m.TrnTime AS trnTime,m.TrnQty AS trnQty,m.MovementType AS movementType,m.TrnType AS movementTrnType
    FROM Journals s JOIN dbo.InvJournalDet d ON d.JnlYear=s.trnYear AND d.JnlMonth=s.trnMonth AND d.Journal=s.journal
    LEFT JOIN dbo.InvMaster i ON i.StockCode=d.StockCode
    LEFT JOIN dbo.InvMovements m ON m.TrnYear=d.JnlYear AND m.TrnMonth=d.JnlMonth
        AND m.Journal=d.Journal AND m.JournalEntry=d.EntryNumber AND m.StockCode=d.StockCode AND m.Warehouse=d.Warehouse
    WHERE d.TrnType IN ('I','R')`;
const catalogSql = `SELECT i.StockCode AS stockCode,i.Description AS description,i.StockUom AS stockUom FROM dbo.InvMaster i WHERE ${scope}`;
const coverageSql = `SELECT MIN(h.earliestEntryDate) AS earliestEntryDate FROM dbo.InvMaster i
    OUTER APPLY (SELECT MIN(m.EntryDate) AS earliestEntryDate FROM dbo.InvMovements m
        WHERE m.StockCode=i.StockCode AND m.Warehouse='B-WIP01') h WHERE ${scope}`;
function deriveBedliners(args) { return deriveBuiltParts({ ...args, receiptWarehouse: 'B-WIP01' }); }
async function readBedliners(db, date, windows, parameters) {
  const { BOM_SQL } = require('../routes/inventory'), { mapBomRow } = require('../bomMapping');
  const [receipts, journalRows, catalog, boms, coverage] = await Promise.all([
    db.query(receiptsSql, parameters), db.query(journalSql, parameters), db.query(catalogSql), db.query(BOM_SQL), db.query(coverageSql),
  ]);
  const linked = receipts.map((row) => ({ ...row, backflushesJson: [{ ...row, journalRowsJson: journalRows.filter((detail) =>
    detail.trnYear === row.trnYear && detail.trnMonth === row.trnMonth && detail.journal === row.journal) }] }));
  return deriveBedliners({ date, windows, receipts: linked, catalog, boms: boms.map(mapBomRow), coverage: coverage[0] });
}
module.exports = { receiptsSql, journalSql, catalogSql, coverageSql, deriveBedliners, readBedliners };
