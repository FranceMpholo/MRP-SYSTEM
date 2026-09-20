-- Separate lookup: never multiply physical movement rows with a BOM join.
SELECT LTRIM(RTRIM(b.Component)) AS stockCode,
    LTRIM(RTRIM(b.ParentPart)) AS parentPart,
    LTRIM(RTRIM(p.Description)) AS description,
    LTRIM(RTRIM(b.Route)) AS route, b.QtyPer AS qtyPer
FROM dbo.BomStructure b
LEFT JOIN dbo.InvMaster p ON p.StockCode = b.ParentPart
WHERE EXISTS (
    SELECT 1 FROM dbo.InvMovements m
    WHERE m.StockCode = b.Component
      AND m.EntryDate >= @StartDate AND m.EntryDate < DATEADD(day, 1, @EndDate)
      AND m.MovementType = 'I' AND m.TrnType = 'T' AND m.TrnQty <> 0
      AND ((m.Warehouse = 'B-WIP01' AND m.NewWarehouse IN ('B-SCR01', 'B-REG01'))
        OR (m.Warehouse IN ('B-SCR01', 'B-REG01') AND m.NewWarehouse = 'B-WIP01'))
)
ORDER BY b.Component, b.ParentPart, b.Route;
