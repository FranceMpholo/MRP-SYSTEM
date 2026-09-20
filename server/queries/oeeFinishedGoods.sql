-- Source legs only: incoming transfers and separately identified returns to WIP.
SELECT CONVERT(char(10),m.EntryDate,23) AS date,
 LTRIM(RTRIM(m.StockCode)) AS stockCode, LTRIM(RTRIM(i.StockUom)) AS uom,
 LTRIM(RTRIM(m.Warehouse)) AS sourceWarehouse, LTRIM(RTRIM(m.NewWarehouse)) AS destinationWarehouse,
 CASE WHEN m.NewWarehouse='B-FIN01' THEN 'Into FG' ELSE 'FG to WIP' END AS direction,
 -m.TrnQty AS quantity, m.TrnTime AS trnTime, m.TrnYear AS trnYear, m.TrnMonth AS trnMonth,
 m.Journal AS journal, m.JournalEntry AS journalEntry, LTRIM(RTRIM(m.Reference)) AS reference
FROM dbo.InvMovements m
LEFT JOIN dbo.InvMaster i ON i.StockCode=m.StockCode
WHERE m.EntryDate>=@StartDate AND m.EntryDate<DATEADD(day,1,@EndDate)
 AND m.MovementType='I' AND m.TrnType='T' AND m.TrnQty<>0
 AND ((m.NewWarehouse='B-FIN01' AND m.Warehouse<>'B-FIN01')
 OR (m.Warehouse='B-FIN01' AND m.NewWarehouse='B-WIP01'))
ORDER BY m.EntryDate,m.TrnTime,m.StockCode;
