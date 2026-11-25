-- The destination FG receipt is the posting event. SCR/REG use outgoing legs
-- only, with reverse-route transfers separate from normal inventory issues.
WITH Selected AS (
    SELECT m.StockCode, m.Warehouse, m.NewWarehouse, m.EntryDate, m.TrnTime,
        m.TrnYear, m.TrnMonth, m.Journal, m.JournalEntry, m.MovementType, m.TrnType,
        m.TrnQty, m.Reference, i.Description, i.StockUom,
        j.TrnType AS journalType, j.TrnQty AS journalQty, j.TransferFlag,
        j.TransferToWh, j.GtrReference, j.Uom AS journalUom
    FROM dbo.InvMovements m
    LEFT JOIN dbo.InvMaster i ON i.StockCode = m.StockCode
    LEFT JOIN dbo.InvJournalDet j ON j.JnlYear = m.TrnYear AND j.JnlMonth = m.TrnMonth
        AND j.Journal = m.Journal AND j.EntryNumber = m.JournalEntry
        AND j.StockCode = m.StockCode AND j.Warehouse = m.Warehouse
    WHERE m.EntryDate >= @StartDay AND m.EntryDate < @EndDayExclusive
        AND ((m.StockCode IN ('120002', '121047', '120003')
            AND ((m.Warehouse = 'B-WIP01' AND m.NewWarehouse IN ('B-SCR01', 'B-REG01'))
                OR (m.Warehouse IN ('B-SCR01', 'B-REG01') AND m.NewWarehouse = 'B-WIP01')))
        OR (m.Warehouse = 'B-FIN01' AND (m.StockCode LIKE '%12606%' OR m.StockCode LIKE '%2600038%'
            OR m.StockCode LIKE '%40726%' OR m.StockCode LIKE '%2640726%' OR m.StockCode LIKE '%13036%')))
), ReceiptReferences AS (
    SELECT DISTINCT StockCode, GtrReference FROM Selected
    WHERE Warehouse = 'B-FIN01' AND TrnType = 'T' AND TransferFlag = 'I'
        AND NULLIF(LTRIM(RTRIM(GtrReference)), '') IS NOT NULL
), Sources AS (
    SELECT r.StockCode, r.GtrReference, MIN(LTRIM(RTRIM(s.Warehouse))) AS sourceWarehouseMin,
        MAX(LTRIM(RTRIM(s.Warehouse))) AS sourceWarehouseMax
    FROM ReceiptReferences r
    JOIN dbo.InvMovements s ON s.StockCode = r.StockCode AND s.Reference = r.GtrReference
        AND s.NewWarehouse = 'B-FIN01' AND s.MovementType = 'I' AND s.TrnType = 'T'
    JOIN dbo.InvJournalDet j ON j.JnlYear = s.TrnYear AND j.JnlMonth = s.TrnMonth
        AND j.Journal = s.Journal AND j.EntryNumber = s.JournalEntry
        AND j.StockCode = s.StockCode AND j.Warehouse = s.Warehouse
        AND j.GtrReference = r.GtrReference AND j.TransferFlag = 'O'
        AND j.TransferToWh = 'B-FIN01' AND j.TrnQty = -s.TrnQty
    GROUP BY r.StockCode, r.GtrReference
)
SELECT m.StockCode AS stockCode, m.Description AS description, m.StockUom AS stockUom,
    m.Warehouse AS warehouse, m.NewWarehouse AS newWarehouse, m.EntryDate AS entryDate, m.TrnTime AS trnTime,
    m.TrnYear AS trnYear, m.TrnMonth AS trnMonth, m.Journal AS journal, m.JournalEntry AS journalEntry,
    m.MovementType AS movementType, m.TrnType AS trnType, m.TrnQty AS trnQty,
    m.Reference AS reference, m.journalType, m.journalQty, m.TransferFlag AS transferFlag,
    m.journalUom, m.GtrReference AS gtrReference, s.sourceWarehouseMin, s.sourceWarehouseMax
FROM Selected m LEFT JOIN Sources s ON s.StockCode = m.StockCode AND s.GtrReference = m.GtrReference
ORDER BY m.EntryDate, m.TrnTime, m.StockCode;
