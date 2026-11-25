const express = require("express");
const db = require("../db");
const { mapBomRow } = require('../bomMapping');
const { BOM_SQL } = require('./inventory');

const router = express.Router();

const PARTS_SQL = `
WITH BomItemRoles AS (
  SELECT RoleRows.StockCode,
         MAX(RoleRows.IsBomParent) AS IsBomParent,
         MAX(RoleRows.IsBomComponent) AS IsBomComponent
  FROM (
    SELECT LTRIM(RTRIM(ParentPart)) AS StockCode, 1 AS IsBomParent, 0 AS IsBomComponent
    FROM dbo.BomStructure
    WHERE NULLIF(LTRIM(RTRIM(ParentPart)), '') IS NOT NULL
    UNION ALL
    SELECT LTRIM(RTRIM(Component)) AS StockCode, 0 AS IsBomParent, 1 AS IsBomComponent
    FROM dbo.BomStructure
    WHERE NULLIF(LTRIM(RTRIM(Component)), '') IS NOT NULL
  ) AS RoleRows
  GROUP BY RoleRows.StockCode
)
SELECT LTRIM(RTRIM(Master.StockCode)) AS StockCode,
       LTRIM(RTRIM(Master.Description)) AS Description,
       LTRIM(RTRIM(Master.StockUom)) AS StockUom,
       LTRIM(RTRIM(Master.PartCategory)) AS PartCategory,
       LTRIM(RTRIM(Master.ProductClass)) AS ProductClass,
       CAST(COALESCE(Roles.IsBomParent, 0) AS bit) AS IsBomParent,
       CAST(COALESCE(Roles.IsBomComponent, 0) AS bit) AS IsBomComponent
FROM dbo.InvMaster AS Master
LEFT JOIN BomItemRoles AS Roles ON Roles.StockCode = Master.StockCode
ORDER BY Master.StockCode;
`;


function field(row, name) {
  const key = Object.keys(row || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? null : row[key];
}

router.get("/parts", async (_request, response) => {
  try {
    const rows = await db.query(PARTS_SQL);
    const data = rows.map((row) => ({
      stockCode: String(field(row, "StockCode") ?? "").trim(),
      description: String(field(row, "Description") ?? "").trim(),
      uom: String(field(row, "StockUom") ?? "").trim(),
      partCategory: field(row, "PartCategory") == null ? null : String(field(row, "PartCategory")).trim(),
      productClass: field(row, "ProductClass") == null ? null : String(field(row, "ProductClass")).trim(),
      isBomParent: Boolean(field(row, "IsBomParent")),
      isBomComponent: Boolean(field(row, "IsBomComponent")),
    }));
    response.json({
      success: true,
      count: data.length,
      data,
      source: "SYSPRO InvMaster joined to current BomStructure roles",
      coverage: "All InvMaster stock codes are returned; BOM parent status is only a candidate indicator and does not establish finished-good status.",
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("SYSPRO FCSD item lookup failed:", error.message);
    response.status(503).json({ success: false, error: "SYSPRO FCSD item lookup is unavailable." });
  }
});

router.get("/bom", async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  try {
    const rows = await db.query(BOM_SQL);
    const data = rows.map(mapBomRow);
    response.json({
      success: true,
      count: data.length,
      data,
      source: "SYSPRO current BomStructure joined to InvMaster",
      fetchedAt: new Date().toISOString(),
      snapshot: true,
      revisionMetadataAvailable: false,
      structureMetadataAvailable: true,
      structureSelection: 'unresolved',
    });
  } catch (error) {
    console.error("SYSPRO FCSD BOM lookup failed:", error.message);
    response.status(503).json({ success: false, error: "SYSPRO FCSD BOM snapshot is unavailable." });
  }
});

module.exports = router;
module.exports.PARTS_SQL = PARTS_SQL;
module.exports.BOM_SQL = BOM_SQL;
