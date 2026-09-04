export const CYCLE_COUNT_REASONS = [
  ["PENDING_INVESTIGATION", "Pending Investigation"],
  ["INCORRECT_COUNT", "Incorrect Count"],
  ["PENDING_BACKFLUSH", "Pending Backflush"],
  ["TRANSACTION_TIMING", "Transaction Timing"],
  ["INCORRECT_BOM", "Incorrect BOM"],
  ["MATERIAL_CONVERSION", "Material Conversion"],
  ["WRONG_WAREHOUSE", "Wrong Warehouse"],
  ["SCRAP_NOT_PROCESSED", "Scrap Not Processed"],
  ["UNPROCESSED_TRANSFER", "Unprocessed Transfer"],
  ["PRODUCTION_CONSUMPTION", "Production Consumption"],
  ["STOCK_ADJUSTMENT_REQUIRED", "Stock Adjustment Required"],
  ["OTHER", "Other"],
].map(([value, label]) => ({ value, label }));

export const reasonLabel = (value) => CYCLE_COUNT_REASONS.find((reason) => reason.value === value)?.label || "—";
