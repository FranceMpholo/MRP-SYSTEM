import { CYCLE_COUNT_SHIFTS, REQUIRED_THERMOFORMING_SHEETS, CYCLE_COUNT_WAREHOUSE } from "../cycleCount/cycleCountUtils.js";
import { classifyThermoformingParent } from "../production/productionLines.js";
import { SHIFT_CONFIG } from "../planning/shiftConfig.js";
import { inspectBom, factorUnitIssues } from '../bom/bomValidation.js';

const code = (value) => String(value ?? "").trim().toUpperCase();
const numeric = (value) => value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;
const finiteNumber = (value) => value === "" || value === null || value === undefined || (typeof value === "string" && value.trim() === "")
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const previousDate = (value) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};
const SHIFT_IDS = CYCLE_COUNT_SHIFTS.map((shift) => shift.id);

export function priorShiftSlot(date, shift) {
  const index = SHIFT_IDS.indexOf(shift);
  if (!validDate(date) || index < 0) return null;
  return index > 0
    ? { date, shift: SHIFT_IDS[index - 1] }
    : { date: previousDate(date), shift: SHIFT_IDS[SHIFT_IDS.length - 1] };
}

const latestActualsByPlan = (actuals = []) => {
  const grouped = new Map();
  for (const actual of actuals) {
    if (!actual?.planningEntryId) continue;
    grouped.set(actual.planningEntryId, [...(grouped.get(actual.planningEntryId) || []), actual]);
  }
  const latest = new Map();
  for (const [planId, rows] of grouped) {
    rows.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")) || String(b.id || "").localeCompare(String(a.id || "")));
    const latestTimestamp = String(rows[0].updatedAt || rows[0].createdAt || "");
    const ambiguous = rows.filter((row) => String(row.updatedAt || row.createdAt || "") === latestTimestamp).length > 1;
    latest.set(planId, { row: rows[0], replacedRows: Math.max(0, rows.length - 1), ambiguous });
  }
  return latest;
};

function findDescendantSheetIssues(parentCode, bomsByParent) {
  const found = new Set();
  const cycles = new Set();
  const visit = (current, path, depth = 0) => {
    for (const line of bomsByParent.get(current) || []) {
      const child = code(line.componentStockCode);
      if (!child) continue;
      if (REQUIRED_THERMOFORMING_SHEETS.includes(child) && depth > 0) {
        found.add(child);
        continue;
      }
      if (REQUIRED_THERMOFORMING_SHEETS.includes(child)) continue;
      if (path.has(child)) {
        cycles.add([...path, child].join(" → "));
        continue;
      }
      if (bomsByParent.has(child)) visit(child, new Set([...path, child]), depth + 1);
    }
  };
  visit(parentCode, new Set([parentCode]));
  return { found: [...found], cycles: [...cycles] };
}

function getSubmittedCount(day, shift, stockCode) {
  if (!day) return { status: "No Cycle Count record", quantity: null, record: null };
  const assignment = (day.shifts || []).find((row) => row.shift === shift);
  const scoped = (day.countRecords || []).filter((row) => row.shift === shift
    && code(row.stockCode) === stockCode
    && code(row.warehouse || day.warehouse || CYCLE_COUNT_WAREHOUSE) === CYCLE_COUNT_WAREHOUSE
    && !String(row.location || "").trim());
  if (!assignment?.submittedAt) {
    const draft = scoped.find((row) => numeric(row.physicalCount));
    return { status: draft ? "Draft — not submitted" : scoped.length ? "Not counted — draft" : "No Cycle Count record", quantity: numeric(draft?.physicalCount) ? Number(draft.physicalCount) : null, record: draft || scoped[0] || null };
  }
  if (scoped.length !== 1 || !numeric(scoped[0]?.physicalCount)) {
    return { status: "Submitted but incomplete / legacy", quantity: null, record: scoped[0] || null };
  }
  return { status: "Submitted closing count", quantity: Number(scoped[0].physicalCount), record: scoped[0] };
}

export function deriveSheetAnalysis({
  date, shift, cycleCountDays = [], productionActuals = [], planningEntries = [], boms = [],
  bomAvailable = false, bomCapturedAt = null, inventory = [], inventoryAvailable = false, inventoryCapturedAt = null,
}) {
  const countDay = cycleCountDays.find((day) => day.date === date && day.productionLine === "thermoforming") || null;
  const planningForShift = planningEntries.filter((entry) => entry.day === date
    && entry.productionLine === "thermoforming"
    && entry.shift === CYCLE_COUNT_SHIFTS.find((item) => item.id === shift)?.planningShift);
  const plans = planningForShift.filter((entry) => !["OFF", "Changeover"].includes(entry.status));
  const actualsByPlan = latestActualsByPlan(productionActuals);
  const outputs = plans.map((plan) => {
    const latest = actualsByPlan.get(plan.id);
    return { plan, actual: latest?.row || null, replacedRows: latest?.replacedRows || 0, ambiguousActuals: latest?.ambiguous || false };
  });
  const bomsByParent = new Map();
  boms.forEach((line) => {
    const parent = code(line.parentStockCode);
    if (parent) bomsByParent.set(parent, [...(bomsByParent.get(parent) || []), line]);
  });
  const inventoryByCode = new Map(inventory.map((item) => [code(item.StockCode ?? item.STOCKCODE ?? item.stockCode ?? item.code), item]));
  const bomContext = inspectBom(boms, inventory);
  const priorSlot = priorShiftSlot(date, shift);
  const priorDay = priorSlot && cycleCountDays.find((day) => day.date === priorSlot.date && day.productionLine === "thermoforming");
  const issues = [];
  if (!countDay) issues.push("No Cycle Count day exists for this production date.");
  if (!bomAvailable) issues.push("SYSPRO BOM snapshot is unavailable; expected consumption cannot be calculated.");
  else if (!boms.length) issues.push('SYSPRO returned an empty BOM snapshot; no parent requirements can be established.');
  if (!plans.length) issues.push("No planned Thermoforming production entries exist for this date and shift.");

  const summaries = REQUIRED_THERMOFORMING_SHEETS.map((stockCode) => {
    const physical = getSubmittedCount(countDay, shift, stockCode);
    const contributions = [];
    const sheetIssues = [];
    sheetIssues.push(...bomContext.globalIssues);
    const sheetWarnings = [];
    let expectedConsumption = 0;
    let anyMappedParent = false;
    let productionComplete = plans.length > 0;
    if (!plans.length) sheetIssues.push("No planned Thermoforming production entries exist for this date and shift.");

    for (const { plan, actual, replacedRows, ambiguousActuals } of outputs) {
      const parentCode = code(plan.partNumber || plan.parentStockCode);
      const parentBom = bomsByParent.get(parentCode) || [];
      sheetIssues.push(...(bomContext.parentIssues.get(parentCode) || []));
      if (!actual || !numeric(actual.actualMouldQty)) {
        productionComplete = false;
        sheetIssues.push(`${parentCode || plan.id}: actual production quantity is missing or invalid.`);
        continue;
      }
      if (ambiguousActuals) {
        productionComplete = false;
        sheetIssues.push(`${parentCode}: multiple actual records share the latest capture timestamp; correction ordering is ambiguous.`);
      }
      if (!parentBom.length) {
        sheetIssues.push(`${parentCode}: BOM is missing from the loaded SYSPRO snapshot.`);
        productionComplete = false;
        continue;
      }
      const direct = parentBom.filter((line) => code(line.componentStockCode) === stockCode);
      const nested = findDescendantSheetIssues(parentCode, bomsByParent);
      if (nested.found.includes(stockCode)) {
        sheetIssues.push(`${parentCode}: ${stockCode} appears below a BOM subassembly; the app does not infer nested consumption.`);
        productionComplete = false;
      }
      if (nested.cycles.length) {
        sheetIssues.push(`${parentCode}: BOM cycle detected (${nested.cycles[0]}).`);
        productionComplete = false;
      }
      if (!direct.length) continue;
      anyMappedParent = true;
      if (direct.length !== 1) {
        sheetIssues.push(`${parentCode}: multiple direct ${stockCode} BOM lines are ambiguous.`);
        productionComplete = false;
        continue;
      }
      const bomQtyPer = finiteNumber(direct[0].qtyPer);
      if (bomQtyPer === null) {
        sheetIssues.push(`${parentCode}: direct BOM QtyPer is missing or invalid. Correct the SYSPRO BOM quantity before using this consumption total.`);
        productionComplete = false;
        continue;
      }
      if (bomQtyPer < 0) {
        sheetIssues.push(`${parentCode}: direct BOM QtyPer is negative. Its recovery/by-product meaning is not established, so it is excluded from expected consumption.`);
        productionComplete = false;
        continue;
      }
      if (bomQtyPer === 0) sheetWarnings.push(`${parentCode}: direct BOM QtyPer is explicitly zero. It adds zero expected consumption; review whether this BOM line is intentional.`);
      const parentInventory = inventoryByCode.get(parentCode);
      const componentInventory = inventoryByCode.get(stockCode);
      const parentUom = String(parentInventory?.StockUom ?? parentInventory?.STOCKUOM ?? parentInventory?.uom ?? "").trim();
      const sheetUom = String(componentInventory?.StockUom ?? componentInventory?.STOCKUOM ?? componentInventory?.uom ?? "").trim();
      const unitIssues = factorUnitIssues(direct[0], parentInventory, componentInventory);
      const sourceLineIssues = bomContext.lineIssues.get(direct[0]) || [];
      sheetIssues.push(...sourceLineIssues.map((issue) => `${parentCode}: ${issue}`));
      if (!parentUom || !sheetUom) {
        sheetIssues.push(`${parentCode}: parent or sheet StockUom is missing; the BOM quantity basis cannot be confirmed.`);
        productionComplete = false;
      }
      const actualQty = Number(actual.actualMouldQty);
      const expectedQty = !bomAvailable || bomContext.globalIssues.length || unitIssues.length || sourceLineIssues.length || (bomContext.parentIssues.get(parentCode) || []).length ? null : actualQty * bomQtyPer;
      if (expectedQty !== null) expectedConsumption += expectedQty;
      contributions.push({
        planId: plan.id, actualId: actual.id, parentStockCode: parentCode,
        description: direct[0].parentDescription || plan.description || "",
        machine: plan.machine, productionDate: plan.day, shift: plan.shift,
        actualMouldQty: actualQty, actualUpdatedAt: actual.updatedAt || actual.createdAt || null,
        replacedActualRows: replacedRows, bomQtyPer, expectedQty,
        qtyPerStatus: expectedQty === null ? 'Factor basis / source unresolved' : bomQtyPer === 0 ? "Explicit zero — review" : "Verified stocking-unit factor",
        parentUom, sheetUom, bomSource: "SYSPRO BomStructure.QtyPer",
        classification: classifyThermoformingParent(parentCode)?.categoryLabel || "Thermoforming parent — classification unavailable",
      });
    }

    if (!anyMappedParent && plans.length && productionComplete && bomAvailable) {
      sheetIssues.push("No direct BOM mapping to this sheet was found for the selected production outputs.");
    }
    const parentUoms = new Set(contributions.map((item) => code(item.parentUom)).filter(Boolean));
    if (parentUoms.size > 1) {
      sheetIssues.push(`Direct mappings use incompatible parent stock units (${[...parentUoms].join(", ")}); no conversion is available.`);
      productionComplete = false;
    }
    const priorPhysical = getSubmittedCount(priorDay, priorSlot?.shift, stockCode);
    const historicalSystemBalance = null;
    const currentBalanceItem = inventoryByCode.get(stockCode);
    const currentBalanceValue = currentBalanceItem?.B_WIP01_SOH ?? currentBalanceItem?.b_wip01_soh ?? currentBalanceItem?.bWip01Soh;
    const currentBalance = inventoryAvailable && numeric(currentBalanceValue) ? Number(currentBalanceValue) : null;
    const status = [
      physical.status,
      !bomAvailable ? "BOM unavailable" : sheetIssues.length ? "Mapping / production incomplete" : "Calculation complete",
      ...sheetWarnings.map(() => "Explicit zero QtyPer — review"),
      currentBalance === null ? "Current SYSPRO balance unavailable" : "Current balance only — timing not aligned",
    ];
    return {
      stockCode, physical, expectedConsumption: bomAvailable && sheetIssues.length === 0 && productionComplete ? expectedConsumption : null,
      partialExpectedConsumption: contributions.some((item) => item.expectedQty !== null) ? expectedConsumption : null,
      calculationComplete: bomAvailable && sheetIssues.length === 0 && productionComplete,
      contributions, issues: sheetIssues, warnings: sheetWarnings, status,
      priorClose: priorPhysical,
      priorSlot,
      historicalSystemBalance,
      historicalSystemBalanceStatus: "Historical system balance unavailable",
      currentSystemBalance: currentBalance,
      currentSystemBalanceStatus: currentBalance === null ? "Current B-WIP01 balance unavailable" : "Current B-WIP01 balance — timing not aligned to selected shift",
      sheetUom: String(currentBalanceItem?.StockUom ?? currentBalanceItem?.STOCKUOM ?? currentBalanceItem?.uom ?? "").trim() || null,
      countRecord: physical.record,
    };
  });
  return {
    date, shift,
    shiftLabel: CYCLE_COUNT_SHIFTS.find((item) => item.id === shift)?.label || "Unknown shift",
    shiftTime: (() => { const config = SHIFT_CONFIG[CYCLE_COUNT_SHIFTS.find((item) => item.id === shift)?.planningShift]; return config ? { start: config.start, end: config.end } : null; })(),
    summaries,
    productionOutputs: outputs.map(({ plan, actual, replacedRows, ambiguousActuals }) => ({
      planId: plan.id, parentStockCode: code(plan.partNumber || plan.parentStockCode),
      machine: plan.machine, productionDate: plan.day, shift: plan.shift,
      plannedQuantity: plan.buildQty ?? plan.qty ?? null,
      actualQuantity: actual && numeric(actual.actualMouldQty) ? Number(actual.actualMouldQty) : null,
      actualStatus: !actual ? "Actual not recorded" : ambiguousActuals ? "Correction ordering ambiguous" : numeric(actual.actualMouldQty) ? "Recorded" : "Actual quantity missing or invalid",
      actualRecordId: actual?.id || null, actualUpdatedAt: actual?.updatedAt || actual?.createdAt || null,
      replacedRows, originalPlanId: actual?.planningEntryId || null,
      ambiguousActuals,
    })),
    priorSlot,
    priorShiftCount: priorPhysicalSummary(cycleCountDays, priorSlot),
    movementCoverage: "No verified, complete, shift-timestamped material movement feed is connected; prior count cannot be rolled forward.",
    currentBalanceCapturedAt: inventoryCapturedAt,
    bomCapturedAt,
    sourceDisclosure: "Cycle Count and Production Actuals are stored in this browser's mrp-data. SYSPRO BOM and current inventory are read-only snapshots.",
    issues,
  };
}

function priorPhysicalSummary(days, slot) {
  if (!slot) return null;
  const day = days.find((entry) => entry.date === slot.date && entry.productionLine === "thermoforming");
  return { date: slot.date, shift: slot.shift, exists: Boolean(day), submittedAt: day?.shifts?.find((entry) => entry.shift === slot.shift)?.submittedAt || null };
}

export function compareFgPostings({ productionOutputs = [], movements = [], date }) {
  const byCode = new Map();
  movements.filter((movement) => movement.date === date).forEach((movement) => {
    const key = code(movement.stockCode);
    const row = byCode.get(key) || { stockCode: key, uoms: new Set(), intoFg: 0, fgToWip: 0, records: [] };
    if (movement.uom) row.uoms.add(movement.uom);
    if (movement.direction === "Into FG") row.intoFg += Number(movement.quantity) || 0;
    if (movement.direction === "FG to WIP") row.fgToWip += Number(movement.quantity) || 0;
    row.records.push(movement);
    byCode.set(key, row);
  });
  const producedByCode = new Map();
  productionOutputs.forEach((row) => {
    if (row.actualQuantity === null) return;
    producedByCode.set(row.parentStockCode, (producedByCode.get(row.parentStockCode) || 0) + row.actualQuantity);
  });
  return [...new Set([...byCode.keys(), ...producedByCode.keys()])].sort().map((stockCode) => {
    const posting = byCode.get(stockCode);
    return {
      stockCode,
      productionActual: producedByCode.has(stockCode) ? producedByCode.get(stockCode) : null,
      intoFg: posting?.uoms.size === 1 ? posting.intoFg : null,
      fgToWip: posting?.uoms.size === 1 ? posting.fgToWip : null,
      uom: posting?.uoms.size === 1 ? [...posting.uoms][0] : null,
      records: posting?.records || [],
      status: !posting ? "No FG posting in selected posting-date range" : posting.uoms.size !== 1 ? "Incompatible or missing posting UOM" : "Posting-date comparison only — no shift allocation",
    };
  });
}
