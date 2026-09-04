import { SHIFTS } from "../planning/planningBoardUtils";

const SHIFT_NAMES = ["Morning", "Afternoon", "Night"];
export const CYCLE_COUNT_SHIFTS = SHIFTS.map((planningShift, index) => ({
  id: SHIFT_NAMES[index].toLocaleLowerCase(), label: SHIFT_NAMES[index], planningShift,
}));

export const hasPhysicalCount = (value) => value !== null && value !== undefined && value !== "";
export const roundQuantity = (value) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
export const calculateVariance = (physicalCount, expectedEosSoh) => hasPhysicalCount(physicalCount) ? roundQuantity(Number(physicalCount) - Number(expectedEosSoh || 0)) : null;
export const automaticStatus = (physicalCount, expectedEosSoh) => {
  if (!hasPhysicalCount(physicalCount)) return "NOT_COUNTED";
  return calculateVariance(physicalCount, expectedEosSoh) === 0 ? "COUNTED" : "VARIANCE";
};
export const getWipSoh = (inventoryItem) => Number(inventoryItem?.B_WIP01_SOH ?? inventoryItem?.b_wip01_soh ?? inventoryItem?.bWip01Soh) || 0;
export const inventoryCode = (item) => String(item?.StockCode ?? item?.STOCKCODE ?? item?.stockCode ?? item?.code ?? "").trim();
export const inventoryDescription = (item) => String(item?.Description ?? item?.description ?? "").trim();
export const inventoryUom = (item) => String(item?.StockUom ?? item?.STOCKUOM ?? item?.uom ?? "").trim();

export function createCycleCountDay(date, productionLine, userId) {
  const now = new Date().toISOString();
  return {
    id: `cycle_${date}_${productionLine}_${crypto.randomUUID()}`,
    date, productionLine, items: [], countRecords: [],
    shifts: CYCLE_COUNT_SHIFTS.map(({ id }) => ({ shift: id, supervisorUserId: "", teamLeaderUserId: "", submittedByUserId: null, submittedAt: null })),
    createdByUserId: userId, createdAt: now, updatedByUserId: userId, updatedAt: now,
  };
}

export function addDailyItem(day, inventoryItem, userId) {
  const stockCode = inventoryCode(inventoryItem);
  if (!stockCode || day.items.some((item) => item.stockCode.toUpperCase() === stockCode.toUpperCase())) return day;
  const now = new Date().toISOString();
  const item = { stockCode, description: inventoryDescription(inventoryItem), uom: inventoryUom(inventoryItem) };
  const records = CYCLE_COUNT_SHIFTS.map(({ id }) => ({
    id: `count_${crypto.randomUUID()}`, cycleCountDayId: day.id, stockCode, shift: id,
    expectedEosSoh: getWipSoh(inventoryItem), physicalCount: null, variance: null,
    reasonCode: "", reasonComment: "", status: "NOT_COUNTED", countedByUserId: null,
    countedAt: null, updatedByUserId: userId, updatedAt: now,
  }));
  return { ...day, items: [...day.items, item], countRecords: [...day.countRecords, ...records], updatedByUserId: userId, updatedAt: now };
}

export const formatQuantity = (value) => value === null || value === undefined ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
