-- Reconstruct B-WIP01 at shift close from retained, reconciled financial periods.
-- Issues reduce stock; transfers, receipts, and adjustments use signed quantities.
-- Cost changes repeat SOH in TrnQty and do not change quantity.
WITH Control AS (
    SELECT TOP (1) FinYear, FinMonth FROM dbo.InvControl
), Balances AS (
    SELECT iw.StockCode, iw.QtyOnHand, c.FinYear, c.FinMonth,
           p.periodOffset, p.openingQty, p.closingQty
    FROM dbo.InvWarehouse iw CROSS JOIN Control c
    CROSS APPLY (VALUES
        (0, iw.OpenBalQty1, iw.QtyOnHand),
        (1, iw.OpenBalQty2, iw.OpenBalQty1),
        (2, iw.OpenBalQty3, iw.OpenBalQty2),
        (3, iw.OpenBalQty4, iw.OpenBalQty3),
        (4, iw.OpenBalQty5, iw.OpenBalQty4),
        (5, iw.OpenBalQty6, iw.OpenBalQty5),
        (6, iw.OpenBalQty7, iw.OpenBalQty6),
        (7, iw.OpenBalQty8, iw.OpenBalQty7),
        (8, iw.OpenBalQty9, iw.OpenBalQty8),
        (9, iw.OpenBalQty10, iw.OpenBalQty9),
        (10, iw.OpenBalQty11, iw.OpenBalQty10),
        (11, iw.OpenBalQty12, iw.OpenBalQty11)
    ) p(periodOffset, openingQty, closingQty)
    WHERE iw.Warehouse = 'B-WIP01' AND iw.StockCode IN (/* STOCK_CODES */)
), Movements AS (
    SELECT m.StockCode, (c.FinYear - m.TrnYear) * 12 + c.FinMonth - m.TrnMonth AS periodOffset,
        CASE WHEN m.MovementType = 'I' AND m.TrnType = 'I' THEN -m.TrnQty
             WHEN m.MovementType = 'I' AND m.TrnType IN ('T', 'R', 'A') THEN m.TrnQty ELSE 0 END AS delta,
        CASE WHEN m.TrnQty <> 0 AND (m.MovementType <> 'I' OR m.TrnType NOT IN ('I', 'T', 'R', 'A', 'C')) THEN 1 ELSE 0 END AS unsupported,
        CASE WHEN m.TrnTime >= 0 AND m.TrnTime <= 23595999
               AND FLOOR(m.TrnTime / 10000) % 100 < 60
               AND FLOOR(m.TrnTime / 100) % 100 < 60
             THEN DATEADD(millisecond, CAST(m.TrnTime % 100 AS int) * 10,
                    DATEADD(second, CAST(FLOOR(m.TrnTime / 1000000) AS int) * 3600
                      + CAST(FLOOR(m.TrnTime / 10000) % 100 AS int) * 60
                      + CAST(FLOOR(m.TrnTime / 100) % 100 AS int),
                      CONVERT(datetime2, CONVERT(date, m.EntryDate)))) END AS movementAt
    FROM dbo.InvMovements m CROSS JOIN Control c
    WHERE m.Warehouse = 'B-WIP01' AND m.StockCode IN (/* STOCK_CODES */)
      AND (c.FinYear - m.TrnYear) * 12 + c.FinMonth - m.TrnMonth BETWEEN 0 AND 11
      AND m.TrnQty <> 0
)
SELECT LTRIM(RTRIM(b.StockCode)) AS stockCode, b.QtyOnHand AS currentSoh,
    b.FinMonth AS currentPeriod, b.periodOffset, b.openingQty, b.closingQty,
    COALESCE(SUM(m.delta), 0) AS netQty,
    COALESCE(SUM(m.unsupported), 0) AS unsupportedCount,
    SUM(CASE WHEN m.StockCode IS NOT NULL AND m.movementAt IS NULL THEN 1 ELSE 0 END) AS invalidTimeCount,
    MIN(m.movementAt) AS earliestMovement,
    COALESCE(SUM(CASE WHEN m.movementAt >= DATEADD(hour, 15, CONVERT(datetime2, @ProductionDate)) THEN m.delta ELSE 0 END), 0) AS morningAfterQty,
    COALESCE(SUM(CASE WHEN m.movementAt >= DATEADD(hour, 22, CONVERT(datetime2, @ProductionDate)) THEN m.delta ELSE 0 END), 0) AS afternoonAfterQty,
    COALESCE(SUM(CASE WHEN m.movementAt >= DATEADD(hour, 30, CONVERT(datetime2, @ProductionDate)) THEN m.delta ELSE 0 END), 0) AS nightAfterQty,
    SUM(CASE WHEN m.movementAt >= DATEADD(hour, 15, CONVERT(datetime2, @ProductionDate)) THEN 1 ELSE 0 END) AS morningAfterCount,
    SUM(CASE WHEN m.movementAt >= DATEADD(hour, 22, CONVERT(datetime2, @ProductionDate)) THEN 1 ELSE 0 END) AS afternoonAfterCount,
    SUM(CASE WHEN m.movementAt >= DATEADD(hour, 30, CONVERT(datetime2, @ProductionDate)) THEN 1 ELSE 0 END) AS nightAfterCount,
    SYSUTCDATETIME() AS fetchedAt
FROM Balances b LEFT JOIN Movements m ON m.StockCode = b.StockCode AND m.periodOffset = b.periodOffset
GROUP BY b.StockCode, b.QtyOnHand, b.FinMonth, b.periodOffset, b.openingQty, b.closingQty
ORDER BY b.StockCode, b.periodOffset;
