const ARRAY_FIELDS = [
  "items",
  "demands",
  "openOrders",
  "productionActuals",
  "oeeHistory",
  "cycleCountDays",
  "sysproTransactions",
  "openingWipBalances",
  "closingWipBalances",
  "reconciliationTolerances",
];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function assertRecordArray(value, field) {
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
    throw new Error(`Invalid ${field} data`);
  }
}

function validatePlannerData(value) {
  if (!isRecord(value)) throw new Error("Invalid planner data");

  for (const field of ARRAY_FIELDS) {
    if (Object.hasOwn(value, field)) assertRecordArray(value[field], field);
  }

  if (Object.hasOwn(value, "planning") && value.planning !== null) {
    if (!isRecord(value.planning)) throw new Error("Invalid planning data");
    if (Object.hasOwn(value.planning, "entries")) assertRecordArray(value.planning.entries, "planning entries");
  }

  if (Object.hasOwn(value, "planningWeeks")) {
    if (!isRecord(value.planningWeeks)) throw new Error("Invalid planning weeks");
    for (const plan of Object.values(value.planningWeeks)) {
      if (!isRecord(plan)) throw new Error("Invalid planning week");
      if (Object.hasOwn(plan, "entries")) assertRecordArray(plan.entries, "planning week entries");
    }
  }

  if (value.oeeSettings !== undefined && value.oeeSettings !== null && !isRecord(value.oeeSettings)) {
    throw new Error("Invalid OEE settings");
  }
  if (value.planningImportProfiles !== undefined && (!isRecord(value.planningImportProfiles) || Object.values(value.planningImportProfiles).some((profile) => !isRecord(profile)))) throw new Error('Invalid planning import profiles');
  for (const field of ["activeWeekStart", "selectedProductionLine"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(`Invalid ${field}`);
    }
  }

  return value;
}

export async function readPlannerStorage(storage, key) {
  let response;
  try {
    response = await storage.get(key, false);
  } catch {
    throw new Error("Planner storage could not be read");
  }

  if (response === null || (isRecord(response) && response.value === null)) {
    return { status: "missing" };
  }
  if (!isRecord(response) || typeof response.value !== "string") {
    throw new Error("Planner storage returned an unreadable value");
  }

  try {
    return { status: "saved", data: validatePlannerData(JSON.parse(response.value)) };
  } catch {
    throw new Error("Saved planner data is malformed or has an unsupported structure");
  }
}

export async function writePlannerStorage(storage, key, value) {
  const serialized = JSON.stringify(value);
  await storage.set(key, serialized, false);
}

export const PLANNER_SAVE_ERROR_MESSAGE =
  "Changes could not be saved. Your current work is still on this screen. Retry saving when storage is available.";
