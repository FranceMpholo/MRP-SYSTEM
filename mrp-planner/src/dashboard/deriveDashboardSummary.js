import { PRODUCTION_LINES, classifyThermoformingParent, deriveThermoformingOutput } from "../production/productionLines.js";
const number = (value) => Number(value) || 0;
const attentionPriority = { "Consumption variance": 0, "Stock balance variance": 1, "Pending BKF": 2, "Insufficient RAW stock": 3, "Pack size missing": 4, "Ready to request": 5, "Data incomplete": 6 };

/** Aggregates and reshapes existing active-week Planning, Production MRP, and Reconciliation outputs. */
export function deriveDashboardSummary({ planning = {}, productionActuals = [], productionMrp = {}, materialReconciliation = { summary: {}, rows: [] }, selectedDay = null, reconciliationAvailable = false, productionLine = "blowMoulding" }) {
  const MACHINES = Object.keys(PRODUCTION_LINES[productionLine].machines);
  const scopedPlans = (planning.entries || []).filter((entry) => !selectedDay || entry.day === selectedDay);
  const plansById = new Map(scopedPlans.map((entry) => [entry.id, entry]));
  const actualByPlanId = new Map(productionActuals.filter((actual) => plansById.has(actual.planningEntryId)).map((actual) => [actual.planningEntryId, actual]));
  const productionPlans = scopedPlans.filter((entry) => entry.status !== "OFF");
  const plannedSets = productionPlans.reduce((sum, entry) => sum + Math.max(0, number(entry.buildQty)), 0);
  const actualSets = productionPlans.reduce((sum, entry) => sum + Math.max(0, number(actualByPlanId.get(entry.id)?.actualMouldQty)), 0);
  const productionVariance = actualSets - plannedSets;
  const achievementPct = plannedSets > 0 ? actualSets / plannedSets * 100 : null;
  const productSummary = productionPlans.reduce((summary, entry) => { const family = entry.productFamily || classifyThermoformingParent(entry.parentStockCode || entry.partNumber)?.family; const planned = number(entry.buildQty); const actual = number(actualByPlanId.get(entry.id)?.actualMouldQty); if (family === "BEDLINER") { summary.bedlinerPlanned += planned; summary.bedlinerActual += actual; summary.tailgateExpectedFromPlan += deriveThermoformingOutput({ family, qty: planned }).tailgateQty; summary.tailgateExpectedFromActual += deriveThermoformingOutput({ family, qty: actual }).tailgateQty; } if (family === "TPO") { summary.tpoPlanned += planned; summary.tpoActual += actual; } return summary; }, { bedlinerPlanned: 0, bedlinerActual: 0, tpoPlanned: 0, tpoActual: 0, tailgateExpectedFromPlan: 0, tailgateExpectedFromActual: 0 });

  const machinePerformance = MACHINES.map((machine) => {
    const machinePlans = productionPlans.filter((entry) => entry.machine === machine);
    const planned = machinePlans.reduce((sum, entry) => sum + number(entry.buildQty), 0);
    const actual = machinePlans.reduce((sum, entry) => sum + number(actualByPlanId.get(entry.id)?.actualMouldQty), 0);
    return { machine, planned, actual, variance: actual - planned, achievementPct: planned > 0 ? actual / planned * 100 : null };
  });

  const childrenByCode = new Map((productionMrp.childRequirements || []).map((child) => [child.stockCode, child]));
  const requestsByCode = new Map((productionMrp.storeRequests || []).map((child) => [child.stockCode, child]));
  const reconciliationByCode = new Map((materialReconciliation.rows || []).map((row) => [row.stockCode, row]));
  const materialsToRequest = [...requestsByCode.values()].filter((child) => number(child.storeRequestQty) > 0).length;
  const rawShortages = [...requestsByCode.values()].filter((child) => number(child.rawShortage) > 0).length;
  const materialVariances = (materialReconciliation.rows || []).filter((row) => row.status === "Consumption variance" || row.status === "Stock balance variance").length;
  const attentionCodes = new Set([
    ...[...requestsByCode.values()].filter((row) => number(row.productionShortfall) > 0 || number(row.rawShortage) > 0 || number(row.packSize) <= 0).map((row) => row.stockCode),
    ...(reconciliationAvailable ? (materialReconciliation.rows || []).filter((row) => row.status !== "Tied").map((row) => row.stockCode) : []),
  ]);
  const materialAttention = [...attentionCodes].map((stockCode) => {
    const mrp = childrenByCode.get(stockCode) || requestsByCode.get(stockCode);
    const reconciliation = reconciliationByCode.get(stockCode);
    const reconciliationStatus = reconciliationAvailable && reconciliation?.status !== "Tied" ? reconciliation.status : null;
    return { stockCode, description: mrp?.description || reconciliation?.description || "No description", expectedConsumptionQty: reconciliation?.expectedConsumptionQty ?? null, systemConsumptionQty: reconciliationAvailable ? reconciliation?.systemConsumptionQty ?? null : null, consumptionVarianceQty: reconciliationAvailable ? reconciliation?.consumptionVarianceQty ?? null : null, productionShortfall: mrp?.productionShortfall ?? 0, rawShortageQty: mrp?.rawShortage ?? 0, status: reconciliationStatus || mrp?.status || "No request required" };
  }).sort((a, b) => (attentionPriority[a.status] ?? 7) - (attentionPriority[b.status] ?? 7) || number(b.rawShortageQty) - number(a.rawShortageQty) || a.stockCode.localeCompare(b.stockCode));

  return { plannedSets, actualSets, productionVariance, achievementPct, productSummary, childMaterials: childrenByCode.size, materialsToRequest, rawShortages, materialVariances, machinePerformance, materialAttention, reconciliationIndicators: { tied: number(materialReconciliation.summary?.tied), pendingBkf: number(materialReconciliation.summary?.pendingBkf), dataIssues: number(materialReconciliation.summary?.dataIssues) } };
}

export default deriveDashboardSummary;
