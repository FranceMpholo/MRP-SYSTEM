export const ADJUSTMENT_REASONS = [
  ["MACHINE_BREAKDOWN", "Machine breakdown"],
  ["TOOL_CHANGE", "Tool change"],
  ["MATERIAL_SHORTAGE", "Material shortage"],
  ["QUALITY_ISSUE", "Quality issue"],
  ["MANPOWER_SHORTAGE", "Manpower shortage"],
  ["PRODUCTION_PRIORITY_CHANGE", "Production priority change"],
  ["ENGINEERING_ISSUE", "Engineering issue"],
  ["OTHER", "Other"],
].map(([code, label]) => ({ code, label }));

const finiteQty = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const getOriginalPlanQty = (entry = {}) => finiteQty(entry.originalPlanQty ?? entry.buildQty, 0);
export const getAdjustedPlanQty = (entry = {}) => entry.adjustedPlanQty === null || entry.adjustedPlanQty === undefined ? null : finiteQty(entry.adjustedPlanQty, 0);
export const getEffectivePlanQty = (entry = {}) => getAdjustedPlanQty(entry) ?? getOriginalPlanQty(entry);
export const getPlanAdjustmentQty = (entry = {}) => getEffectivePlanQty(entry) - getOriginalPlanQty(entry);
export const hasPlanAdjustment = (entry = {}) => entry.adjustedPlanQty !== null && entry.adjustedPlanQty !== undefined;
export const adjustmentReasonLabel = (code) => ADJUSTMENT_REASONS.find((reason) => reason.code === code)?.label || code || "—";

export function validatePlanAdjustment({ adjustedPlanQty, adjustmentReason, adjustmentComment }) {
  if (adjustedPlanQty === "" || adjustedPlanQty === null || adjustedPlanQty === undefined) return "Adjusted Plan is required.";
  const quantity = Number(adjustedPlanQty);
  if (!Number.isFinite(quantity) || quantity < 0) return "Adjusted Plan must be a number greater than or equal to zero.";
  if (!ADJUSTMENT_REASONS.some((reason) => reason.code === adjustmentReason)) return "Select an adjustment reason.";
  if (adjustmentReason === "OTHER" && !String(adjustmentComment || "").trim()) return "Comment is required when the reason is Other.";
  return null;
}

export function applyPlanAdjustment(entry, adjustment, { userId, adjustedAt = new Date().toISOString() } = {}) {
  const error = validatePlanAdjustment(adjustment);
  if (error) throw new Error(error);
  return {
    ...entry,
    originalPlanQty: getOriginalPlanQty(entry),
    adjustedPlanQty: Number(adjustment.adjustedPlanQty),
    adjustmentReason: adjustment.adjustmentReason,
    adjustmentComment: String(adjustment.adjustmentComment || "").trim(),
    adjustedByUserId: userId,
    adjustedAt,
  };
}
