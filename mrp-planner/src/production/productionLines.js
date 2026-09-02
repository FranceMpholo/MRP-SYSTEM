export const PRODUCTION_LINES = {
  blowMoulding: { id: "blowMoulding", name: "Blow Moulding", quantityLabel: "Mould Sets", machines: { BM01: {}, BM02: {}, BM03: {}, BM04: {}, BM05: {} } },
  thermoforming: { id: "thermoforming", name: "Thermoforming", quantityLabel: "Parts", machines: { AR1: { allowedFamilies: ["BEDLINER"] }, AR2: { allowedFamilies: ["BEDLINER"] }, AR3: { allowedFamilies: ["BEDLINER", "TPO"] }, AR4: { allowedFamilies: ["BEDLINER"] }, AR5: { allowedFamilies: ["BEDLINER"] } } },
};
export const AR3_TPO_PARENT_ALIASES = {
  "N1WB-J13036-B": { shortName: "RAP LH", family: "TPO" },
  "N1WB-P13036-C": { shortName: "SGL LH", family: "TPO" },
  "N1WB-P13036-D": { shortName: "SGL RH", family: "TPO" },
  "N1WB-E13036-K": { shortName: "DBL LH", family: "TPO" },
  "N1WB-E13036-N": { shortName: "DBL RH", family: "TPO" },
};
export const normalizeProductionStockCode = (value) => String(value || "").trim().toUpperCase();
export function getThermoformingParentAlias(stockCode) { return AR3_TPO_PARENT_ALIASES[normalizeProductionStockCode(stockCode)] || null; }
export function getThermoformingDisplayCode(stockCode) { return getThermoformingParentAlias(stockCode)?.shortName || normalizeProductionStockCode(stockCode); }
export function classifyThermoformingParent(stockCode = "") { const code = normalizeProductionStockCode(stockCode), alias = getThermoformingParentAlias(code); if (alias) return { family: alias.family, market: null, categoryLabel: "TPO", shortName: alias.shortName }; let result = null; if (code.includes("2640726")) result = { family: "TPO", market: "FCSD" }; else if (code.includes("2600038")) result = { family: "BEDLINER", market: "FCSD" }; else if (code.includes("12606")) result = { family: "BEDLINER", market: "OEM" }; else if (code.includes("40726")) result = { family: "TPO", market: "OEM" }; return result && { ...result, categoryLabel: `${result.family === "BEDLINER" ? "Bedliner" : "TPO"} ${result.market}` }; }
export function deriveThermoformingOutput({ family, qty }) { const formedQty = Math.max(0, Number(qty) || 0); return { formedQty, tailgateQty: family === "BEDLINER" ? formedQty : 0 }; }
export function deriveThermoformingParents({ sysproBomRows = [], machine }) { const allowed = PRODUCTION_LINES.thermoforming.machines[machine]?.allowedFamilies || []; const parents = new Map(); sysproBomRows.forEach((row) => { const code = normalizeProductionStockCode(row.parentStockCode); if (code && !parents.has(code)) parents.set(code, String(row.parentDescription || "").trim() || "Description unavailable"); }); const familyOrder = { BEDLINER: 0, TPO: 1 }, marketOrder = { OEM: 0, FCSD: 1 }; return [...parents].map(([stockCode, description]) => ({ stockCode, description, classification: classifyThermoformingParent(stockCode) })).filter(({ classification }) => classification && allowed.includes(classification.family)).map(({ stockCode, description, classification }) => ({ id: stockCode, stockCode, description, alias: classification.shortName || classification.categoryLabel, displayCode: classification.shortName || classification.categoryLabel, ...classification })).sort((a, b) => familyOrder[a.family] - familyOrder[b.family] || (marketOrder[a.market] ?? 2) - (marketOrder[b.market] ?? 2) || a.stockCode.localeCompare(b.stockCode)); }
export function unavailableAr3Aliases(sysproBomRows = []) { const available = new Set(sysproBomRows.map((row) => normalizeProductionStockCode(row.parentStockCode))); return Object.entries(AR3_TPO_PARENT_ALIASES).filter(([code]) => !available.has(code)).map(([stockCode, value]) => ({ stockCode, ...value })); }
export function thermoformingParents(_items = [], boms = [], machine) { return deriveThermoformingParents({ sysproBomRows: boms, machine }); }
export const entryProductionLine = (entry) => entry.productionLine || "blowMoulding";
