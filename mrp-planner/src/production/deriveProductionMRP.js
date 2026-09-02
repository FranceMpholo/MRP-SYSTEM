import { expandPlanningEntry, getParentPair } from "../planning/blowMouldingParentPairs.js";
import { entryProductionLine } from "./productionLines.js";

const number = (value) => Number(value) || 0;

/**
 * Produces the Version 1 production material view from the manual production
 * plan, item balances, and direct BOM lines. It deliberately does not use or
 * calculate time-phased MRP data.
 */
export function deriveProductionMRP({ planning = {}, items = [], boms = [] }) {
  const itemsByCode = new Map(items.map((item) => [String(item.code || "").trim().toUpperCase(), item]));
  const bomByParentStockCode = new Map(); boms.forEach((bom) => { const key = String(bom.parentStockCode || "").trim().toUpperCase(); if (key) bomByParentStockCode.set(key, [...(bomByParentStockCode.get(key) || []), bom]); });
  const parentPlans = new Map();
  const displayedPlans = new Map();
  const dataIssues = [];

  (planning.entries || []).forEach((entry) => {
    const buildQty = number(entry.buildQty);
    if (!entry.partNumber || buildQty <= 0) return;
    const isThermoforming = entryProductionLine(entry) === "thermoforming";
    const effectiveEntries = isThermoforming ? [{ parentStockCode: entry.parentStockCode || entry.partNumber, buildQty }] : expandPlanningEntry(entry);
    const missing = effectiveEntries.filter(({ parentStockCode }) => !bomByParentStockCode.has(String(parentStockCode).trim().toUpperCase()));
    if (missing.length) { dataIssues.push(isThermoforming ? `Thermoforming parent BOM missing — ${missing[0].parentStockCode}` : effectiveEntries.length > 1 ? `${entry.partNumber} pair incomplete — ${missing.map((row) => `${row.parentStockCode} BOM missing`).join(", ")}` : `BOM missing in Syspro: ${missing[0].parentStockCode}`); return; }

    const pair = isThermoforming ? null : getParentPair(entry.partNumber);
    const displayKey = pair?.planningCode || entry.partNumber;
    const displayed = displayedPlans.get(displayKey);
    if (displayed) displayed.plannedBuildQty += buildQty;
    else displayedPlans.set(displayKey, {
      parentId: displayKey,
      stockCode: pair?.displayCode || entry.partNumber,
      description: pair?.description || itemsByCode.get(entry.partNumber)?.description || "No description",
      plannedBuildQty: buildQty,
      isPair: Boolean(pair),
      produces: effectiveEntries.map(({ parentStockCode }) => ({ stockCode: parentStockCode, plannedBuildQty: buildQty })),
    });

    effectiveEntries.forEach(({ parentStockCode, buildQty: effectiveQty }) => {
      const parent = itemsByCode.get(parentStockCode) || { id: parentStockCode, code: parentStockCode, description: bomByParentStockCode.get(parentStockCode)?.[0]?.parentDescription };
      const existing = parentPlans.get(parent.code);
      if (existing) existing.plannedBuildQty += effectiveQty;
      else parentPlans.set(parent.code, { parentId: parent.id, stockCode: parent.code, description: parent.description || "No description", plannedBuildQty: effectiveQty });
    });
  });

  displayedPlans.forEach((plan) => {
    if (!plan.isPair) return;
    plan.produces = plan.produces.map((produced) => ({ ...produced, plannedBuildQty: plan.plannedBuildQty }));
  });

  const childRequirements = new Map();
  parentPlans.forEach((parentPlan) => {
    (bomByParentStockCode.get(String(parentPlan.stockCode).trim().toUpperCase()) || []).forEach((bom) => {
      const child = itemsByCode.get(bom.componentStockCode) || { id: bom.componentStockCode, code: bom.componentStockCode, description: bom.componentDescription };

      const grossRequirement = parentPlan.plannedBuildQty * number(bom.qtyPer);
      const existing = childRequirements.get(child.id);
      if (existing) {
        existing.grossRequirement += grossRequirement;
      } else {
        childRequirements.set(child.id, {
          childId: child.id,
          stockCode: child.code,
          description: child.description || "No description",
          uom: child.uom || "",
          grossRequirement,
          bWip01Soh: number(child.bWip01Soh),
          bRaw01Soh: number(child.bRaw01Soh),
          scrapQty: number(child.bScr01Qty),
          reg01Qty: number(child.bReg01Qty),
          packSize: number(child.lotSize),
        });
      }
    });
  });

  const children = Array.from(childRequirements.values())
    .map((child) => {
      // B-RAW01 is Stores' fulfilment balance, not production stock available
      // for consumption, so it must not reduce Production Shortfall.
      const productionShortfall = Math.max(0, child.grossRequirement - child.bWip01Soh);
      const packSizeMissing = productionShortfall > 0 && child.packSize <= 0;
      const packsRequired = productionShortfall === 0 ? 0 : packSizeMissing ? null : Math.ceil(productionShortfall / child.packSize);
      const storeRequestQty = productionShortfall === 0 ? 0 : packSizeMissing ? null : packsRequired * child.packSize;
      const hasValidRequest = storeRequestQty !== null;
      const projectedRawBalance = hasValidRequest ? child.bRaw01Soh - storeRequestQty : null;
      const rawShortage = hasValidRequest ? Math.max(0, storeRequestQty - child.bRaw01Soh) : null;

      let status = "No request required";
      if (packSizeMissing) status = "Pack size missing";
      else if (productionShortfall > 0 && rawShortage > 0) status = "Insufficient RAW stock";
      else if (productionShortfall > 0) status = "Ready to request";

      return {
        ...child,
        productionShortfall,
        packsRequired,
        storeRequestQty,
        projectedRawBalance,
        rawShortage,
        status,
      };
    })
    .sort((a, b) => a.stockCode.localeCompare(b.stockCode));

  return {
    productionPlan: Array.from(displayedPlans.values()).sort((a, b) => a.stockCode.localeCompare(b.stockCode)),
    childRequirements: children,
    storeRequests: children.filter((child) => child.productionShortfall > 0),
    dataIssues,
  };
}

export default deriveProductionMRP;
