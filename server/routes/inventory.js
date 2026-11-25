const express = require("express");
const db = require("../db");
const { mapBomRow } = require('../bomMapping');
const { sendFailure } = require('../sysproErrors');

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
// The query-local hash hint avoids the measured slow plan for the normalized
// joins without changing their matching, source rows or ordering. See docs/bom-performance.md.
const BOM_SQL = `
SELECT
    bom.ParentPart,
    parent.StockCode AS ParentMasterCode,
    parent.Description AS ParentDescription,
    parent.StockUom AS ParentUom,
    bom.Component,
    child.StockCode AS ComponentMasterCode,
    child.Description AS ComponentDescription,
    child.StockUom AS ComponentUom,
    bom.QtyPer, bom.QtyPerEnt, bom.UomFlag,
    bom.Route, bom.SequenceNum, bom.Version, bom.Release, bom.ComVersion, bom.ComRelease,
    bom.StructureOnDate, bom.StructureOffDate, bom.FixedQtyPerFlag, bom.FixedQtyPer
FROM BomStructure bom
LEFT JOIN InvMaster parent ON UPPER(LTRIM(RTRIM(parent.StockCode))) = UPPER(LTRIM(RTRIM(bom.ParentPart)))
LEFT JOIN InvMaster child ON UPPER(LTRIM(RTRIM(child.StockCode))) = UPPER(LTRIM(RTRIM(bom.Component)))
ORDER BY bom.ParentPart, bom.Route, bom.Version, bom.Release, bom.SequenceNum, bom.Component
OPTION (HASH JOIN);
`;

const finiteQtyPer = (rawQtyPer) => {
  if (rawQtyPer === null || rawQtyPer === undefined || (typeof rawQtyPer === "string" && rawQtyPer.trim() === "")) return null;
  const qtyPer = Number(rawQtyPer);
  return Number.isFinite(qtyPer) ? qtyPer : null;
};

router.get("/inventory", async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  try {
    const rows = await db.query(INVENTORY_SQL);
    response.json({ success: true, count: rows.length, data: rows, source: 'SYSPRO InvMaster / InvWarehouse', fetchedAt: new Date().toISOString() });
  } catch (error) {
    sendFailure(response, error, 'SYSPRO inventory read');
  }
});

router.get("/bom", async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  try {
    const rows = await db.query(BOM_SQL);
    const data = rows.map(mapBomRow);
    response.json({ success: true, count: data.length, parentCount: new Set(data.map((row) => row.parentStockCode.toUpperCase())).size, data,
      source: 'SYSPRO BomStructure, all returned structures; none selected or merged', fetchedAt: new Date().toISOString(),
      structureSelection: 'unresolved', quantityBasis: 'QtyPer stocking quantities; QtyPerEnt is retained separately' });
  } catch (error) {
    sendFailure(response, error, 'SYSPRO BOM read');
  }
});

module.exports = router;
module.exports.finiteQtyPer = finiteQtyPer;
module.exports.mapBomRow = mapBomRow;
module.exports.BOM_SQL = BOM_SQL;
