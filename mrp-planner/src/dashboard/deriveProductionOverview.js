import { PRODUCTION_LINES, entryProductionLine, classifyThermoformingParent } from "../production/productionLines.js";
import { getParentPair } from "../planning/blowMouldingParentPairs.js";
import { getEffectivePlanQty } from "../planning/planQuantities.js";

const quantity = (value) => (typeof value === "number" || typeof value === "string")
  && String(value).trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;

// This is a read-only summary of the legacy capture contract, not ERP FG output.
// Ambiguous actuals are deliberately unresolved: timestamps do not prove correction lineage.
export function deriveProductionOverview({ planningWeeks = {}, weekStart, productionActuals = [] }) {
  const entries = planningWeeks[weekStart]?.entries || [];
  const idCounts = new Map();
  Object.values(planningWeeks).flatMap((week) => week.entries || []).forEach((entry) => {
    if (entry.id) idCounts.set(entry.id, (idCounts.get(entry.id) || 0) + 1);
  });
  const actuals = new Map();
  productionActuals.forEach((actual) => {
    if (actual.planningEntryId) actuals.set(actual.planningEntryId, [...(actuals.get(actual.planningEntryId) || []), actual]);
  });
  const end = new Date(`${weekStart}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const weekEnd = end.toISOString().slice(0, 10);
  return Object.fromEntries(Object.entries(PRODUCTION_LINES).map(([lineId, line]) => {
    const runs = entries.filter((entry) => entryProductionLine(entry) === lineId && entry.status !== "OFF" && entry.status !== "Changeover");
    const issues = [];
    let planned = 0, actual = 0, captured = 0, missing = 0, duplicate = 0, invalid = 0;
    for (const run of runs) {
      if (!run.id || idCounts.get(run.id) !== 1) issues.push("Planning run identity is missing or duplicated.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(run.day || "") || run.day < weekStart || run.day > weekEnd || !Object.hasOwn(line.machines, run.machine)) {
        issues.push("Some planning runs have an invalid date or machine scope.");
      }
      const family = classifyThermoformingParent(run.parentStockCode || run.partNumber)?.family;
      const scopedUnit = lineId === "blowMoulding" ? Boolean(getParentPair(run.partNumber))
        : Boolean(family && line.machines[run.machine]?.allowedFamilies.includes(family));
      if (!scopedUnit) issues.push("Output units or product scope are unverified for some runs.");
      const rawPlan = run.adjustedPlanQty ?? run.originalPlanQty ?? run.buildQty;
      if (!quantity(rawPlan)) issues.push("Some effective plan quantities are missing or invalid.");
      else planned += getEffectivePlanQty(run);
      const rows = actuals.get(run.id) || [];
      if (rows.length > 1) { duplicate += 1; continue; }
      if (!rows.length || rows[0].actualMouldQty == null || String(rows[0].actualMouldQty).trim() === "") { missing += 1; continue; }
      if (!quantity(rows[0].actualMouldQty) || (rows[0].productionLine && rows[0].productionLine !== lineId)) { invalid += 1; continue; }
      actual += Number(rows[0].actualMouldQty);
      captured += 1;
    }
    const scopeValid = issues.length === 0;
    const complete = runs.length > 0 && scopeValid && missing === 0 && duplicate === 0 && invalid === 0;
    return [lineId, {
      unit: lineId === "thermoforming" ? "assembly-completed parts" : "mould sets",
      runCount: runs.length, captured, missing, duplicate, invalid,
      state: !runs.length ? "unavailable" : complete ? "complete" : "incomplete",
      planned: runs.length && scopeValid ? planned : null,
      actual: complete ? actual : null,
      achievementPct: complete && planned > 0 ? actual / planned * 100 : null,
      issues: [...new Set(issues)],
    }];
  }));
}
