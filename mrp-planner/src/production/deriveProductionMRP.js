import { expandPlanningEntry, getParentPair } from "../planning/blowMouldingParentPairs.js";
import { entryProductionLine } from "./productionLines.js";
import { getEffectivePlanQty } from "../planning/planQuantities.js";
import { inspectBom, normalizeStockCode, itemStockCode, bomFactor } from '../bom/bomValidation.js';

const number = (value) => Number(value) || 0;
const finiteQtyPer = (value) => value === "" || value === null || value === undefined || (typeof value === "string" && value.trim() === "")
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;

/**
 * Produces the Version 1 production material view from the manual production
 * plan, item balances, and direct BOM lines. It deliberately does not use or
 * calculate time-phased MRP data.
 */
export function deriveProductionMRP({ planning = {}, items = [], boms = [], bomAvailable = true, inventoryAvailable = true }) {
  const itemsByCode = new Map(items.map((item) => [itemStockCode(item), item]));
  const context = inspectBom(boms, items);
  const bomByParentStockCode = context.byParent;
  const parentPlans = new Map();
  const displayedPlans = new Map();
  const dataIssues = [];
  const dataWarnings = [];
  if (!bomAvailable) dataIssues.push('SYSPRO BOM unavailable or refreshing; stale lines are not approved for calculations.');
  if (!inventoryAvailable) dataIssues.push('Live SYSPRO stock unavailable or refreshing; saved balances cannot establish current material requests.');

  (planning.entries || []).forEach((entry) => {
    const buildQty = getEffectivePlanQty(entry);
    if (!entry.partNumber || buildQty <= 0) return;
    const isThermoforming = entryProductionLine(entry) === "thermoforming";
    const effectiveEntries = isThermoforming ? [{ parentStockCode: entry.parentStockCode || entry.partNumber, buildQty }] : expandPlanningEntry({ ...entry, buildQty });
    const missing = bomAvailable
      ? effectiveEntries.filter(({ parentStockCode }) => !bomByParentStockCode.has(String(parentStockCode).trim().toUpperCase()))
      : [];
    if (missing.length) dataIssues.push(isThermoforming ? `Thermoforming parent BOM missing — ${missing[0].parentStockCode}` : effectiveEntries.length > 1 ? `${entry.partNumber} pair incomplete — ${missing.map((row) => `${row.parentStockCode} BOM missing`).join(", ")}` : `BOM missing in Syspro: ${missing[0].parentStockCode}`);

    const pair = isThermoforming ? null : getParentPair(entry.partNumber);
    const displayKey = pair?.planningCode || entry.partNumber;
    const displayed = displayedPlans.get(displayKey);
    if (displayed) displayed.plannedBuildQty += buildQty;
    else displayedPlans.set(displayKey, {
      parentId: displayKey,
      stockCode: pair?.displayCode || entry.partNumber,
      description: pair?.description || itemsByCode.get(normalizeStockCode(entry.partNumber))?.description || "No description",
      plannedBuildQty: buildQty,
      isPair: Boolean(pair),
      produces: effectiveEntries.map(({ parentStockCode }) => ({ stockCode: parentStockCode, plannedBuildQty: buildQty })),
    });

    effectiveEntries.forEach(({ parentStockCode, buildQty: effectiveQty }) => {
      parentStockCode = normalizeStockCode(parentStockCode);
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
    const parentCode = normalizeStockCode(parentPlan.stockCode);
    const structureIssues = context.parentIssues.get(parentCode) || [];
    dataIssues.push(...context.issuesForParent(parentCode, { direct: true }).map((issue) => `${parentCode}: ${issue}`));
    (bomByParentStockCode.get(String(parentPlan.stockCode).trim().toUpperCase()) || []).forEach((bom) => {
      const childCode = normalizeStockCode(bom.componentStockCode);
      const child = itemsByCode.get(childCode) || { id: childCode, code: childCode, description: bom.componentDescription, uom: bom.componentUom };
      const packUomMismatch = Object.hasOwn(child, 'savedPlanningUom') && !child.liveOnly
        && normalizeStockCode(child.savedPlanningUom) !== normalizeStockCode(child.uom);
      if (packUomMismatch) dataIssues.push(`Saved pack-size UOM differs from live stock UOM — ${child.code}; no pack conversion is inferred.`);
      const existing = childRequirements.get(child.id);
      const requirement = existing || {
          childId: child.id,
          stockCode: child.code,
          description: child.description || "No description",
          uom: child.uom || "",
          knownGrossRequirement: 0,
          incompleteBomQtyPer: false,
          explicitZeroBomQtyPer: false,
          bWip01Soh: inventoryAvailable && child.liveStockAvailable !== false ? finiteQtyPer(child.bWip01Soh) : null,
          bRaw01Soh: inventoryAvailable && child.liveStockAvailable !== false ? finiteQtyPer(child.bRaw01Soh) : null,
          scrapQty: number(child.bScr01Qty),
          reg01Qty: number(child.bReg01Qty),
          packSize: packUomMismatch ? 0 : number(child.lotSize),
        };
      const { value: qtyPer, state } = bomFactor(bom);
      const lineIncomplete = !bomAvailable || context.globalIssues.length > 0 || structureIssues.length > 0 || context.lineIssues.get(bom).length > 0 || context.byParent.has(childCode);
      if (lineIncomplete) {
        requirement.incompleteBomQtyPer = true;
        dataIssues.push(`BOM requirement unresolved — ${parentPlan.stockCode} → ${child.code}; no complete store-request total can be issued.`);
      } else {
        requirement.knownGrossRequirement += parentPlan.plannedBuildQty * qtyPer;
        if (state === 'zero') {
          requirement.explicitZeroBomQtyPer = true;
          dataWarnings.push(`BOM QtyPer explicitly zero — ${parentPlan.stockCode} → ${child.code}. It contributes zero requirement; review whether the BOM line is intentional.`);
        }
      }
      childRequirements.set(child.id, requirement);
    });
  });

  const children = Array.from(childRequirements.values())
    .map((child) => {
      const grossRequirement = child.incompleteBomQtyPer ? null : child.knownGrossRequirement;
      // B-RAW01 is Stores' fulfilment balance, not production stock available
      // for consumption, so it must not reduce Production Shortfall.
      const productionShortfall = grossRequirement === null || child.bWip01Soh === null ? null : Math.max(0, grossRequirement - child.bWip01Soh);
      const packSizeMissing = productionShortfall !== null && productionShortfall > 0 && child.packSize <= 0;
      const packsRequired = productionShortfall === null ? null : productionShortfall === 0 ? 0 : packSizeMissing ? null : Math.ceil(productionShortfall / child.packSize);
      const storeRequestQty = packsRequired === null ? null : productionShortfall === 0 ? 0 : packsRequired * child.packSize;
      const hasValidRequest = storeRequestQty !== null && child.bRaw01Soh !== null;
      const projectedRawBalance = hasValidRequest ? child.bRaw01Soh - storeRequestQty : null;
      const rawShortage = hasValidRequest ? Math.max(0, storeRequestQty - child.bRaw01Soh) : null;

      let status = "No request required";
      if (grossRequirement === null) status = "BOM quantity incomplete";
      else if (child.bWip01Soh === null || child.bRaw01Soh === null) status = 'Live stock incomplete';
      else if (packSizeMissing) status = "Pack size missing";
      else if (productionShortfall > 0 && rawShortage > 0) status = "Insufficient RAW stock";
      else if (productionShortfall > 0) status = "Ready to request";

      return {
        ...child,
        grossRequirement,
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
    storeRequests: children.filter((child) => child.productionShortfall === null || child.productionShortfall > 0),
    complete: dataIssues.length === 0 && children.every((child) => child.storeRequestQty !== null && child.projectedRawBalance !== null),
    dataIssues: [...new Set(dataIssues)],
    dataWarnings: [...new Set(dataWarnings)],
  };
}

export default deriveProductionMRP;
