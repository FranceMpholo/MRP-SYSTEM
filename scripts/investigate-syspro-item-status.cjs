"use strict";

require("dotenv").config({ quiet: true });

const sql = require("mssql");
const sysproDb = require("../server/db");

const SAMPLE_STOCK_CODES = Object.freeze([
  "N1WB-16450-BAA",
  "N1WB-16451-BAA",
  "N1WB-E12606-SAH",
  "121046",
  "121065",
]);

const KNOWN_ITEMS_SQL = `
SELECT
  StockCode,
  Description,
  StockUom,
  PartCategory,
  ProductClass,
  StockOnHold,
  StockOnHoldReason,
  SupercessionDate,
  DateStkAdded
FROM dbo.InvMaster
WHERE LTRIM(RTRIM(StockCode)) IN (
  @StockCode1,
  @StockCode2,
  @StockCode3,
  @StockCode4,
  @StockCode5
)
ORDER BY StockCode;
`;

const STATUS_AGGREGATE_SQL = `
WITH StatusCounts AS (
  SELECT
    NULLIF(LTRIM(RTRIM(StockOnHold)), '') AS StockOnHold,
    COUNT_BIG(*) AS ItemCount
  FROM dbo.InvMaster
  WHERE @IncludeAll = 1
  GROUP BY NULLIF(LTRIM(RTRIM(StockOnHold)), '')
),
Totals AS (
  SELECT
    SUM(CASE
      WHEN NULLIF(LTRIM(RTRIM(StockOnHoldReason)), '') IS NOT NULL THEN 1
      ELSE 0
    END) AS WithStockOnHoldReason,
    SUM(CASE WHEN SupercessionDate IS NOT NULL THEN 1 ELSE 0 END)
      AS WithSupercessionDate
  FROM dbo.InvMaster
  WHERE @IncludeAll = 1
)
SELECT
  StatusCounts.StockOnHold,
  StatusCounts.ItemCount,
  Totals.WithStockOnHoldReason,
  Totals.WithSupercessionDate
FROM StatusCounts
CROSS JOIN Totals
ORDER BY StatusCounts.ItemCount DESC, StatusCounts.StockOnHold;
`;

const EXCEPTION_SAMPLE_SQL = `
WITH Normalized AS (
  SELECT
    StockCode,
    Description,
    StockUom,
    PartCategory,
    ProductClass,
    NULLIF(LTRIM(RTRIM(StockOnHold)), '') AS StockOnHold,
    NULLIF(LTRIM(RTRIM(StockOnHoldReason)), '') AS StockOnHoldReason,
    SupercessionDate,
    DateStkAdded
  FROM dbo.InvMaster
  WHERE @IncludeAll = 1
),
DominantStatus AS (
  SELECT TOP (1)
    StockOnHold
  FROM Normalized
  GROUP BY StockOnHold
  ORDER BY COUNT_BIG(*) DESC, StockOnHold
)
SELECT TOP (@SampleLimit)
  Normalized.StockCode,
  Normalized.Description,
  Normalized.StockUom,
  Normalized.PartCategory,
  Normalized.ProductClass,
  Normalized.StockOnHold,
  Normalized.StockOnHoldReason,
  Normalized.SupercessionDate,
  Normalized.DateStkAdded
FROM Normalized
CROSS JOIN DominantStatus
WHERE
  ISNULL(Normalized.StockOnHold, '') <> ISNULL(DominantStatus.StockOnHold, '')
  OR Normalized.StockOnHoldReason IS NOT NULL
  OR Normalized.SupercessionDate IS NOT NULL
ORDER BY
  CASE
    WHEN ISNULL(Normalized.StockOnHold, '') <> ISNULL(DominantStatus.StockOnHold, '')
      THEN 0
    ELSE 1
  END,
  Normalized.StockCode;
`;

const SELECT_ONLY_QUERIES = Object.freeze([
  KNOWN_ITEMS_SQL,
  STATUS_AGGREGATE_SQL,
  EXCEPTION_SAMPLE_SQL,
]);

function assertSelectOnly(queryText) {
  const withoutComments = queryText
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim();
  const prohibited = /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC(?:UTE)?|CALL|CREATE|ALTER|DROP|TRUNCATE)\b/i;

  if (!/^(?:SELECT|WITH)\b/i.test(withoutComments) || prohibited.test(withoutComments)) {
    throw new Error("Investigation query failed the SELECT-only safety check");
  }
}

async function main() {
  SELECT_ONLY_QUERIES.forEach(assertSelectOnly);

  const knownItemParameters = SAMPLE_STOCK_CODES.map((stockCode, index) => ({
    name: `StockCode${index + 1}`,
    type: sql.VarChar(50),
    value: stockCode,
  }));

  const knownItems = await sysproDb.query(KNOWN_ITEMS_SQL, knownItemParameters);
  const statusAggregate = await sysproDb.query(STATUS_AGGREGATE_SQL, [
    { name: "IncludeAll", type: sql.Bit, value: true },
  ]);
  const exceptionSample = await sysproDb.query(EXCEPTION_SAMPLE_SQL, [
    { name: "IncludeAll", type: sql.Bit, value: true },
    { name: "SampleLimit", type: sql.Int, value: 20 },
  ]);

  console.log(JSON.stringify({
    connection: sysproDb.connectionName,
    requestedStockCodes: SAMPLE_STOCK_CODES,
    knownItems,
    statusAggregate,
    exceptionSample,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(
      `SYSPRO item-status investigation stopped without results (${sysproDb.connectionName}): ${error.message}`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    setImmediate(() => process.exit(process.exitCode || 0));
  });
