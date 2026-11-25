-- SELECT only. Incoming transfers are counted at the WIP receipt timestamp.
-- Their GTR source can have been posted on an earlier date/shift.
WITH Selected AS (
    SELECT m.StockCode, m.Warehouse, m.NewWarehouse, m.EntryDate, m.TrnTime,
        m.MovementType, m.TrnType, m.TrnQty, m.TrnYear, m.TrnMonth, m.Journal, m.JournalEntry, m.Reference,
        j.TrnType AS journalType, j.TrnQty AS journalQty, j.TransferFlag, j.Uom, j.GtrReference
    FROM dbo.InvMovements m
    CROSS APPLY (SELECT CASE WHEN m.TrnTime >= 0 AND m.TrnTime <= 23595999
        AND m.TrnTime = FLOOR(m.TrnTime)
        AND FLOOR(m.TrnTime / 10000) % 100 < 60 AND FLOOR(m.TrnTime / 100) % 100 < 60
        THEN DATEADD(millisecond, CAST(m.TrnTime % 100 AS int) * 10,
            DATEADD(second, CAST(FLOOR(m.TrnTime / 1000000) AS int) * 3600
                + CAST(FLOOR(m.TrnTime / 10000) % 100 AS int) * 60
                + CAST(FLOOR(m.TrnTime / 100) % 100 AS int), CONVERT(datetime2, CONVERT(date, m.EntryDate))))
        END AS movementAt) clock
    LEFT JOIN dbo.InvJournalDet j ON j.JnlYear = m.TrnYear AND j.JnlMonth = m.TrnMonth
        AND j.Journal = m.Journal AND j.EntryNumber = m.JournalEntry
        AND j.StockCode = m.StockCode AND j.Warehouse = m.Warehouse
    WHERE m.StockCode IN ('120002', '121047', '120003') AND m.Warehouse = 'B-WIP01'
        AND m.EntryDate >= @StartDay AND m.EntryDate < @EndDayExclusive
        AND (clock.movementAt IS NULL OR (clock.movementAt >= @StartLocal AND clock.movementAt < @EndLocal))
), ReceiptReferences AS (
    SELECT DISTINCT StockCode, GtrReference FROM Selected
    WHERE TrnType = 'T' AND TransferFlag = 'I' AND NULLIF(LTRIM(RTRIM(GtrReference)), '') IS NOT NULL
), Sources AS (
    SELECT r.StockCode, r.GtrReference, MIN(LTRIM(RTRIM(s.Warehouse))) AS sourceWarehouseMin,
        MAX(LTRIM(RTRIM(s.Warehouse))) AS sourceWarehouseMax
    FROM ReceiptReferences r
    JOIN dbo.InvMovements s ON s.StockCode = r.StockCode AND s.Reference = r.GtrReference
        AND s.NewWarehouse = 'B-WIP01' AND s.MovementType = 'I' AND s.TrnType = 'T'
    JOIN dbo.InvJournalDet j ON j.JnlYear = s.TrnYear AND j.JnlMonth = s.TrnMonth
        AND j.Journal = s.Journal AND j.EntryNumber = s.JournalEntry
        AND j.StockCode = s.StockCode AND j.Warehouse = s.Warehouse
        AND j.GtrReference = r.GtrReference AND j.TransferFlag = 'O'
        AND j.TransferToWh = 'B-WIP01' AND j.TrnQty = -s.TrnQty
    GROUP BY r.StockCode, r.GtrReference
)
SELECT codes.stockCode, CASE WHEN iw.StockCode IS NULL THEN 0 ELSE 1 END AS warehouseExists,
    im.StockUom AS stockUom, history.earliestEntryDate,
    m.Warehouse AS warehouse, m.NewWarehouse AS newWarehouse, m.EntryDate AS entryDate, m.TrnTime AS trnTime,
    m.MovementType AS movementType, m.TrnType AS trnType, m.TrnQty AS trnQty,
    m.TrnYear AS trnYear, m.TrnMonth AS trnMonth, m.Journal AS journal, m.JournalEntry AS journalEntry,
    m.journalType, m.journalQty, m.TransferFlag AS transferFlag, m.Uom AS journalUom,
    m.Reference AS reference, m.GtrReference AS gtrReference,
    s.sourceWarehouseMin, s.sourceWarehouseMax
FROM (VALUES ('120002'), ('121047'), ('120003')) codes(stockCode)
LEFT JOIN dbo.InvWarehouse iw ON iw.StockCode = codes.stockCode AND iw.Warehouse = 'B-WIP01'
LEFT JOIN dbo.InvMaster im ON im.StockCode = codes.stockCode
OUTER APPLY (SELECT MIN(h.EntryDate) AS earliestEntryDate FROM dbo.InvMovements h
    WHERE h.StockCode = codes.stockCode AND h.Warehouse = 'B-WIP01') history
LEFT JOIN Selected m ON m.StockCode = codes.stockCode
LEFT JOIN Sources s ON s.StockCode = m.StockCode AND s.GtrReference = m.GtrReference
ORDER BY codes.stockCode, m.EntryDate, m.TrnTime;
