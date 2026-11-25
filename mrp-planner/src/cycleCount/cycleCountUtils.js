import { SHIFTS } from "../planning/planningBoardUtils.js";

const SHIFT_NAMES = ["Morning", "Afternoon", "Night"];
export const CYCLE_COUNT_SHIFTS = SHIFTS.map((planningShift, index) => ({
  id: SHIFT_NAMES[index].toLocaleLowerCase(),
  label: SHIFT_NAMES[index],
  planningShift,
}));

export const CYCLE_COUNT_WAREHOUSE = "B-WIP01";
export const REQUIRED_THERMOFORMING_SHEETS = Object.freeze(["120002", "121047", "120003"]);
const normalizeCode = (value) => String(value ?? "").trim().toLocaleUpperCase();
const id = (prefix) => `${prefix}_${globalThis.crypto.randomUUID()}`;

export const hasPhysicalCount = (value) => value !== null && value !== undefined && value !== "";
export const isValidPhysicalQuantity = (value) => {
  if (!hasPhysicalCount(value)) return false;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return false;
  const scaled = number * 10000;
  return Math.abs(scaled - Math.round(scaled)) < 1e-8;
};
export const roundQuantity = (value) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
export const calculateVariance = (physicalCount, expectedEosSoh) => {
  if (!hasPhysicalCount(physicalCount) || expectedEosSoh === null || expectedEosSoh === undefined) return null;
  return roundQuantity(Number(physicalCount) - Number(expectedEosSoh));
};
export const automaticStatus = (physicalCount, expectedEosSoh) => {
  if (!hasPhysicalCount(physicalCount)) return "NOT_COUNTED";
  const variance = calculateVariance(physicalCount, expectedEosSoh);
  return variance === null || variance === 0 ? "COUNTED" : "VARIANCE";
};
export const getWipSoh = (inventoryItem) => Number(inventoryItem?.B_WIP01_SOH ?? inventoryItem?.b_wip01_soh ?? inventoryItem?.bWip01Soh) || 0;
export const inventoryCode = (item) => String(item?.StockCode ?? item?.STOCKCODE ?? item?.stockCode ?? item?.code ?? "").trim();
export const inventoryDescription = (item) => String(item?.Description ?? item?.description ?? "").trim();
export const inventoryUom = (item) => String(item?.StockUom ?? item?.STOCKUOM ?? item?.uom ?? "").trim();
const inventoryRow = (inventory, stockCode) => inventory.find((item) => normalizeCode(inventoryCode(item)) === normalizeCode(stockCode)) || null;
const recordScope = (record) => [
  normalizeCode(record.stockCode),
  normalizeCode(record.warehouse || CYCLE_COUNT_WAREHOUSE),
  normalizeCode(record.location || ""),
].join("\u0000");

function createCountRecord(day, item, shift, userId) {
  const now = new Date().toISOString();
  return {
    id: id("count"),
    cycleCountDayId: day.id,
    productionDate: day.date,
    productionLine: day.productionLine,
    stockCode: item.stockCode,
    sheetType: item.requiredEachShift ? "REQUIRED_EACH_SHIFT" : "OPTIONAL",
    warehouse: CYCLE_COUNT_WAREHOUSE,
    location: null,
    shift,
    expectedEosSoh: null,
    physicalCount: null,
    variance: null,
    reasonCode: "",
    reasonComment: "",
    status: "NOT_COUNTED",
    countedByUserId: null,
    countedAt: null,
    updatedByUserId: userId,
    updatedAt: now,
  };
}

function makeItem(stockCode, source, requiredEachShift = false) {
  return {
    stockCode,
    description: inventoryDescription(source),
    uom: inventoryUom(source),
    ...(requiredEachShift ? { requiredEachShift: true } : {}),
  };
}

export function createCycleCountDay(date, productionLine, userId, inventory = []) {
  const now = new Date().toISOString();
  const day = {
    id: `cycle_${date}_${productionLine}_${globalThis.crypto.randomUUID()}`,
    date,
    productionLine,
    warehouse: CYCLE_COUNT_WAREHOUSE,
    items: [],
    countRecords: [],
    shifts: CYCLE_COUNT_SHIFTS.map(({ id: shift }) => ({ shift, submittedByUserId: null, submittedAt: null })),
    createdByUserId: userId,
    createdAt: now,
    updatedByUserId: userId,
    updatedAt: now,
  };

  if (productionLine === "thermoforming") {
    day.items = REQUIRED_THERMOFORMING_SHEETS.map((stockCode) => makeItem(stockCode, inventoryRow(inventory, stockCode), true));
    day.countRecords = CYCLE_COUNT_SHIFTS.flatMap(({ id: shift }) => day.items.map((item) => createCountRecord(day, item, shift, userId)));
  }
  return day;
}

export function addDailyItem(day, inventoryItem, userId) {
  const stockCode = inventoryCode(inventoryItem);
  if (!stockCode || getCycleCountItems(day).some((item) => normalizeCode(item.stockCode) === normalizeCode(stockCode))) return day;
  const now = new Date().toISOString();
  const item = makeItem(stockCode, inventoryItem);
  const countRecords = [...day.countRecords];
  for (const { id: shift } of CYCLE_COUNT_SHIFTS) {
    if (!countRecords.some((record) => record.shift === shift && recordScope(record) === recordScope({ stockCode, shift, warehouse: CYCLE_COUNT_WAREHOUSE, location: null }))) {
      countRecords.push(createCountRecord(day, item, shift, userId));
    }
  }
  return { ...day, items: [...getCycleCountItems(day), item], countRecords, updatedByUserId: userId, updatedAt: now };
}

export function removeDailyItem(day, stockCode, userId) {
  if (day.productionLine === "thermoforming" && REQUIRED_THERMOFORMING_SHEETS.some((code) => normalizeCode(code) === normalizeCode(stockCode))) return day;
  if (!getCycleCountItems(day).some((item) => normalizeCode(item.stockCode) === normalizeCode(stockCode))) return day;
  return {
    ...day,
    items: getCycleCountItems(day).filter((item) => normalizeCode(item.stockCode) !== normalizeCode(stockCode)),
    countRecords: day.countRecords.filter((record) => normalizeCode(record.stockCode) !== normalizeCode(stockCode)),
    updatedByUserId: userId,
    updatedAt: new Date().toISOString(),
  };
}

/** Adds blank mandatory rows only to an unsubmitted legacy shift when explicitly started. */
export function prepareCycleCountShift(day, shift, inventory = [], userId = null) {
  if (day.productionLine !== "thermoforming" || day.shifts.find((entry) => entry.shift === shift)?.submittedAt) return day;
  const items = [...getCycleCountItems(day)];
  const countRecords = [...day.countRecords];
  let changed = false;
  for (const stockCode of REQUIRED_THERMOFORMING_SHEETS) {
    let item = items.find((entry) => normalizeCode(entry.stockCode) === normalizeCode(stockCode));
    const source = inventoryRow(inventory, stockCode);
    if (!item) {
      item = makeItem(stockCode, source, true);
      items.push(item);
      changed = true;
    } else if (!item.requiredEachShift) {
      item = { ...item, requiredEachShift: true };
      const index = items.findIndex((entry) => normalizeCode(entry.stockCode) === normalizeCode(stockCode));
      items[index] = item;
      changed = true;
    }
    if (source && ((!item.description && inventoryDescription(source)) || (!item.uom && inventoryUom(source)))) {
      item = {
        ...item,
        description: item.description || inventoryDescription(source),
        uom: item.uom || inventoryUom(source),
      };
      const index = items.findIndex((entry) => normalizeCode(entry.stockCode) === normalizeCode(stockCode));
      items[index] = item;
      changed = true;
    }
    const scope = recordScope({ stockCode, warehouse: CYCLE_COUNT_WAREHOUSE, location: null });
    const existingRecordIndex = countRecords.findIndex((record) => record.shift === shift && recordScope(record) === scope);
    if (existingRecordIndex < 0) {
      countRecords.push(createCountRecord(day, item, shift, userId));
      changed = true;
    }
  }
  if (!changed) return day;
  return { ...day, items, countRecords, warehouse: day.warehouse || CYCLE_COUNT_WAREHOUSE, updatedByUserId: userId, updatedAt: new Date().toISOString() };
}

export function getCycleCountItems(day) {
  const seen = new Set();
  return (day?.items || []).filter((item) => {
    const key = normalizeCode(item.stockCode);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getCycleCountDisplayItems(day, inventory = []) {
  const savedItems = getCycleCountItems(day);
  if (day?.productionLine !== "thermoforming") return savedItems;
  const displayRequired = REQUIRED_THERMOFORMING_SHEETS.map((stockCode) => {
    const saved = savedItems.find((item) => normalizeCode(item.stockCode) === normalizeCode(stockCode));
    const source = inventoryRow(inventory, stockCode);
    return {
      ...makeItem(stockCode, source, true),
      ...saved,
      stockCode: saved?.stockCode || stockCode,
      description: saved?.description || inventoryDescription(source),
      uom: saved?.uom || inventoryUom(source),
      requiredEachShift: true,
    };
  });
  const mandatory = new Set(REQUIRED_THERMOFORMING_SHEETS.map(normalizeCode));
  return [...displayRequired, ...savedItems.filter((item) => !mandatory.has(normalizeCode(item.stockCode)))];
}

export function getCycleCountRecords(day, shift) {
  const byScope = new Map();
  for (const record of day?.countRecords || []) {
    if (record.shift !== shift
        || normalizeCode(record.warehouse || CYCLE_COUNT_WAREHOUSE) !== CYCLE_COUNT_WAREHOUSE
        || normalizeCode(record.location || "") !== "") continue;
    const key = recordScope(record);
    const previous = byScope.get(key);
    if (!previous || String(record.updatedAt || record.countedAt || "") >= String(previous.updatedAt || previous.countedAt || "")) byScope.set(key, record);
  }
  return [...byScope.values()];
}

export function getRequiredSheetProgress(day, shift) {
  if (day?.productionLine !== "thermoforming") return { required: 0, counted: 0, missingRows: [], legacyIncomplete: false };
  const records = getCycleCountRecords(day, shift);
  const missingRows = REQUIRED_THERMOFORMING_SHEETS.filter((stockCode) => !records.some((record) => normalizeCode(record.stockCode) === normalizeCode(stockCode)));
  const counted = REQUIRED_THERMOFORMING_SHEETS.filter((stockCode) => records.some((record) => normalizeCode(record.stockCode) === normalizeCode(stockCode) && isValidPhysicalQuantity(record.physicalCount))).length;
  const assignment = day.shifts.find((entry) => entry.shift === shift);
  return { required: REQUIRED_THERMOFORMING_SHEETS.length, counted, missingRows, legacyIncomplete: Boolean(assignment?.submittedAt && counted < REQUIRED_THERMOFORMING_SHEETS.length) };
}

export function hasDuplicateCycleCountRecords(day, shift) {
  const scopes = (day?.countRecords || []).filter((record) => record.shift === shift
    && normalizeCode(record.warehouse || CYCLE_COUNT_WAREHOUSE) === CYCLE_COUNT_WAREHOUSE
    && normalizeCode(record.location || "") === "").map(recordScope);
  return new Set(scopes).size !== scopes.length;
}

export function canSubmitCycleCountShift(day, shift) {
  const items = getCycleCountItems(day);
  const records = getCycleCountRecords(day, shift);
  if (!items.length || hasDuplicateCycleCountRecords(day, shift)) return false;
  if (day.productionLine === "thermoforming" && getRequiredSheetProgress(day, shift).counted !== REQUIRED_THERMOFORMING_SHEETS.length) return false;
  return items.every((item) => {
    const record = records.find((entry) => normalizeCode(entry.stockCode) === normalizeCode(item.stockCode)
      && normalizeCode(entry.warehouse || CYCLE_COUNT_WAREHOUSE) === CYCLE_COUNT_WAREHOUSE
      && normalizeCode(entry.location || "") === "");
    return record && isValidPhysicalQuantity(record.physicalCount);
  });
}

export function submitCycleCountShift(day, shift, userId, submittedAt = new Date().toISOString()) {
  if (!canSubmitCycleCountShift(day, shift)) throw new Error("Every required and listed sheet needs a valid non-negative physical count before submission.");
  const previous = day.shifts.find((entry) => entry.shift === shift) || { shift };
  const shifts = day.shifts.some((entry) => entry.shift === shift)
    ? day.shifts.map((entry) => entry.shift === shift ? { ...entry, submittedByUserId: userId, submittedAt } : entry)
    : [...day.shifts, { ...previous, submittedByUserId: userId, submittedAt }];
  return { ...day, shifts, updatedByUserId: userId, updatedAt: submittedAt };
}

export const formatQuantity = (value) => value === null || value === undefined ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });

/** Saved legacy expectedEosSoh values came from current stock, not shift close. */
export function getCycleCountComparison(record, balance, date, shift) {
  const aligned = balance?.status === "available" && balance.productionDate === date && balance.shift === shift
    && normalizeCode(balance.stockCode) === normalizeCode(record?.stockCode)
    && balance.warehouse === CYCLE_COUNT_WAREHOUSE
    && balance.expectedEosSoh !== null && balance.expectedEosSoh !== undefined
    && Number.isFinite(Number(balance.expectedEosSoh));
  const expectedEosSoh = aligned ? Number(balance.expectedEosSoh) : null;
  return {
    expectedEosSoh,
    variance: calculateVariance(record?.physicalCount, expectedEosSoh),
    status: automaticStatus(record?.physicalCount, expectedEosSoh),
  };
}
