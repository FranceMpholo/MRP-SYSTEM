const express = require("express");
const db = require("../db");

const router = express.Router();
const INVENTORY_SQL = `
SELECT
    im.StockCode,
    im.Description,
    im.StockUom,
    SUM(CASE WHEN iw.Warehouse = 'B-WIP01' THEN ISNULL(iw.QtyOnHand, 0) ELSE 0 END) AS B_WIP01_SOH,
    SUM(CASE WHEN iw.Warehouse = 'B-RAW01' THEN ISNULL(iw.QtyOnHand, 0) ELSE 0 END) AS B_RAW01_SOH,
    SUM(CASE WHEN iw.Warehouse = 'B-CON01' THEN ISNULL(iw.QtyOnHand, 0) ELSE 0 END) AS B_CON01_SOH,
    SUM(CASE WHEN iw.Warehouse = 'B-CHE01' THEN ISNULL(iw.QtyOnHand, 0) ELSE 0 END) AS B_CHE01_SOH
FROM InvMaster im
LEFT JOIN InvWarehouse iw
    ON iw.StockCode = im.StockCode
    AND iw.Warehouse IN ('B-WIP01', 'B-RAW01', 'B-CON01', 'B-CHE01')
GROUP BY im.StockCode, im.Description, im.StockUom
ORDER BY im.StockCode;
`;
const BOM_SQL = `
SELECT
    bom.ParentPart,
    parent.Description AS ParentDescription,
    bom.Component,
    child.Description AS ComponentDescription,
    bom.QtyPer
FROM BomStructure bom
LEFT JOIN InvMaster parent ON parent.StockCode = bom.ParentPart
LEFT JOIN InvMaster child ON child.StockCode = bom.Component
ORDER BY bom.ParentPart, bom.Component;
`;

const value = (row, ...names) => { const key = Object.keys(row).find((candidate) => names.some((name) => candidate.toLowerCase() === name.toLowerCase())); return key ? row[key] : null; };

router.get("/inventory", async (_request, response) => {
  try {
    const rows = await db.query(INVENTORY_SQL);
    response.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error("Syspro inventory read failed:", error.message);
    response.status(503).json({ success: false, error: "Syspro inventory is unavailable." });
  }
});

router.get("/bom", async (_request, response) => {
  try {
    const rows = await db.query(BOM_SQL);
    const data = rows.map((row) => ({ parentStockCode: String(value(row, "ParentPart") || "").trim(), parentDescription: String(value(row, "ParentDescription") || "").trim(), componentStockCode: String(value(row, "Component") || "").trim(), componentDescription: String(value(row, "ComponentDescription") || "").trim(), qtyPer: Number(value(row, "QtyPer")) || 0 })).filter((row) => row.parentStockCode && row.componentStockCode);
    response.json({ success: true, count: data.length, parentCount: new Set(data.map((row) => row.parentStockCode.toUpperCase())).size, data });
  } catch (error) {
    console.error("Syspro BOM read failed:", error.message);
    response.status(503).json({ success: false, error: "Syspro BOM is unavailable." });
  }
});

module.exports = router;
