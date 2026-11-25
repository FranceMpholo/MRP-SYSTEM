-- SELECT only. Receipt time defines the reporting shift. Production lineage is
-- read separately using exact GTR/full-code and job/journal identities.
SELECT m.StockCode AS stockCode,i.Description AS description,i.StockUom AS stockUom,
    m.Warehouse AS warehouse,m.EntryDate AS entryDate,m.TrnTime AS trnTime,
    m.TrnYear AS trnYear,m.TrnMonth AS trnMonth,m.Journal AS journal,m.JournalEntry AS journalEntry,
    m.MovementType AS movementType,m.TrnType AS trnType,m.TrnQty AS trnQty,
    j.TrnType AS journalType,j.TrnQty AS journalQty,j.Uom AS journalUom,
    j.TransferFlag AS transferFlag,j.GtrReference AS gtrReference,
    m.Job AS movementJob,j.Job AS journalJob,m.Reference AS reference,
    j.Reference AS journalReference,m.Version AS version,m.Release AS release
FROM dbo.InvMaster i
JOIN dbo.InvMovements m ON m.StockCode=i.StockCode AND m.Warehouse='B-FIN01'
LEFT JOIN dbo.InvJournalDet j ON j.JnlYear=m.TrnYear AND j.JnlMonth=m.TrnMonth
    AND j.Journal=m.Journal AND j.EntryNumber=m.JournalEntry
    AND j.StockCode=m.StockCode AND j.Warehouse=m.Warehouse
WHERE m.EntryDate>=@StartDay AND m.EntryDate<@EndDayExclusive
    AND (i.Description LIKE '%Tailgate%' OR i.Description LIKE '%Tlgt%' OR i.StockCode LIKE '%40726%')
    AND m.TrnType IN ('R','T')
    AND (m.TrnType<>'T' OR ISNULL(j.TransferFlag,'')<>'O')
ORDER BY m.EntryDate,m.TrnTime,m.StockCode;
