export const DEPARTMENT_PRODUCTION_LINES = Object.freeze({
  BM: "blowMoulding",
  TF: "thermoforming",
});

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERIC_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function mapDepartmentCodeToProductionLine(departmentCode) {
  if (typeof departmentCode !== "string") return null;
  const normalized = departmentCode.trim().toUpperCase();
  return DEPARTMENT_PRODUCTION_LINES[normalized] ?? null;
}

export function parsePostgresNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized || !NUMERIC_PATTERN.test(normalized)) return null;

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function weekdayFromDateOnly(value) {
  if (typeof value !== "string") return null;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return WEEKDAYS[date.getUTCDay()];
}

export function mapPlanningRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;

  return {
    id: record.id ?? null,
    day: record.production_date ?? null,
    weekday: weekdayFromDateOnly(record.production_date),
    weekStart: record.week_start ?? null,
    buildQty: parsePostgresNumber(record.planned_qty),
    status: record.status ?? null,
    machine: record.machine_code ?? null,
    shift: record.shift_code ?? null,
    partNumber: record.parent_stock_code ?? null,
    productionLine: mapDepartmentCodeToProductionLine(record.department_code),
    parentItemId: record.parent_item_id ?? null,
    createdByUserId: record.created_by ?? null,
  };
}

export function mapPlanningRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.map(mapPlanningRecord).filter((record) => record !== null);
}
