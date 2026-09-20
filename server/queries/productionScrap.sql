-- Net production transfers, counted on the source leg only. See docs/production-scrap.md.
SELECT CONVERT(char(10), m.EntryDate, 23) AS date,
    LTRIM(RTRIM(m.StockCode)) AS stockCode,
    COALESCE(LTRIM(RTRIM(i.Description)), '') AS description,
    CASE WHEN m.Warehouse = 'B-WIP01' THEN LTRIM(RTRIM(m.NewWarehouse))
         ELSE LTRIM(RTRIM(m.Warehouse)) END AS warehouse,
    CASE WHEN m.Warehouse = 'B-WIP01' THEN -m.TrnQty ELSE m.TrnQty END AS scrapQty,
    m.UnitCost AS unitCost,
    (CASE WHEN m.Warehouse = 'B-WIP01' THEN -m.TrnQty ELSE m.TrnQty END) * m.UnitCost AS totalCost,
    LTRIM(RTRIM(m.Reference)) AS reference,
    LTRIM(RTRIM(i.StockUom)) AS uom,
    LTRIM(RTRIM(m.Warehouse)) AS sourceWarehouse,
    LTRIM(RTRIM(m.NewWarehouse)) AS destinationWarehouse,
    m.TrnYear AS trnYear, m.TrnMonth AS trnMonth, m.Journal AS journal,
    m.JournalEntry AS journalEntry, m.TrnTime AS trnTime
FROM dbo.InvMovements m
LEFT JOIN dbo.InvMaster i ON i.StockCode = m.StockCode
WHERE m.EntryDate >= @StartDate AND m.EntryDate < DATEADD(day, 1, @EndDate)
    AND m.MovementType = 'I' AND m.TrnType = 'T'
    AND m.TrnQty <> 0
    AND ((m.Warehouse = 'B-WIP01' AND m.NewWarehouse IN ('B-SCR01', 'B-REG01'))
      OR (m.Warehouse IN ('B-SCR01', 'B-REG01') AND m.NewWarehouse = 'B-WIP01'))
ORDER BY m.EntryDate DESC, m.TrnTime DESC, m.Journal DESC, m.JournalEntry DESC;
