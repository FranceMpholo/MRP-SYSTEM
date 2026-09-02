export const MACHINES = ["BM01", "BM02", "BM03", "BM04", "BM05"];
export const SHIFTS = ["SHIFT 01", "SHIFT 02", "SHIFT 03"];

// Deliberately explicit: production aliases are business labels, not parsed stock-code suffixes.
export const PART_ALIASES = {
  "N1WB-16450-BAA": "BAA", "N1WB-16451-BAA": "BAA",
  "N1WB-16450-BB": "BB", "N1WB-16451-BB": "BB",
  "N1WB-16450-CAA": "CAA", "N1WB-16451-CAA": "CAA",
  "N1WB-16450-CA": "CA", "N1WB-16451-CA": "CA",
  "N1WB-16450-LAA": "LAA", "N1WB-16451-LAA": "LAA",
  "N1WB-16450-LB": "LB", "N1WB-16451-LB": "LB",
  "N1XB-16450-ABA": "ABA", "N1XB-16451-ABA": "ABA",
  "N1XB-16450-AA": "AA", "N1XB-16451-AA": "AA",
  "N1XB-16450-BAA": "BAA", "N1XB-16451-BAA": "BAA",
  "N1XB-16450-BA": "BA", "N1XB-16451-BA": "BA",
};

export function buildPlanningParents(items = [], boms = []) {
  const syspro = boms.some((bom) => bom.parentStockCode);
  const parentCodes = new Set(boms.map((bom) => String(syspro ? bom.parentStockCode : items.find((item) => item.id === bom.parentId)?.code || "").trim().toUpperCase()).filter(Boolean));
  const descriptions = new Map(boms.map((bom) => [String(bom.parentStockCode || "").trim().toUpperCase(), bom.parentDescription]));
  const itemsByCode = new Map(items.map((item) => [String(item.code || "").trim().toUpperCase(), item]));
  const actualParents = [...parentCodes].map((code) => ({ id: itemsByCode.get(code)?.id || code, stockCode: code, description: descriptions.get(code) || itemsByCode.get(code)?.description || "No description", alias: PART_ALIASES[code] || "" }));
  const actualCodes = new Set(actualParents.map((parent) => parent.stockCode));
  const pairs = availableParentPairs(actualCodes);
  const pairedCodes = new Set(pairs.flatMap((pair) => pair.parents));
  return [
    ...pairs.map((pair) => ({ id: pair.planningCode, stockCode: pair.planningCode, description: pair.description, alias: pair.displayCode, linkedParents: pair.parents, isPair: true })),
    ...actualParents.filter((parent) => !pairedCodes.has(parent.stockCode)),
  ].sort((a, b) => (a.alias || a.stockCode).localeCompare(b.alias || b.stockCode) || a.stockCode.localeCompare(b.stockCode));
}

export function parentMatches(parent, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [parent.stockCode, parent.description, parent.alias, ...(parent.linkedParents || [])]
    .some((value) => (value || "").toLowerCase().includes(needle));
}

export const toISODate = (date) => {
  const d = new Date(date);
  const y = d.getFullYear();
  return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function mondayOf(value = new Date()) {
  const d = new Date(`${typeof value === "string" ? value : toISODate(value)}T12:00:00`);
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()));
  return toISODate(d);
}

export function addCalendarDays(iso, count) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + count);
  return toISODate(d);
}

export const cellKey = ({ machine, day, shift }) => `${machine}|${day}|${shift}`;

export function duplicateKeys(entries = []) {
  const counts = new Map();
  entries.forEach((entry) => {
    if (!entry.machine || !entry.day || !entry.shift) return;
    const key = cellKey(entry);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts].filter(([, count]) => count > 1).map(([key]) => key);
}

export function upsertPlanningEntry(entries = [], nextEntry) {
  const key = cellKey(nextEntry);
  const matches = entries.reduce((result, entry, index) => cellKey(entry) === key ? [...result, index] : result, []);
  if (matches.length > 1) throw new Error(`Duplicate planning entries exist for ${key}. Resolve them before editing this cell.`);
  if (matches.length === 1) return entries.map((entry, index) => index === matches[0] ? { ...entry, ...nextEntry } : entry);
  return [...entries, nextEntry];
}

export function getISOWeek(iso) {
  const date = new Date(`${iso}T12:00:00`);
  const target = new Date(date);
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const week1 = new Date(target.getFullYear(), 0, 4, 12);
  return { week: 1 + Math.round(((target - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7), year: target.getFullYear() };
}

export function summarize(entries = []) {
  const totals = new Map();
  entries.forEach(({ partNumber, buildQty }) => {
    const qty = Number(buildQty) || 0;
    if (partNumber && qty > 0) totals.set(partNumber, (totals.get(partNumber) || 0) + qty);
  });
  return [...totals].map(([partNumber, buildQty]) => ({ partNumber, buildQty, alias: getPlanningDisplayCode(partNumber) || PART_ALIASES[partNumber] || partNumber }));
}

export const planningAlias = (partNumber) => getPlanningDisplayCode(partNumber) || PART_ALIASES[partNumber] || partNumber;
import { availableParentPairs, getPlanningDisplayCode } from "./blowMouldingParentPairs.js";
