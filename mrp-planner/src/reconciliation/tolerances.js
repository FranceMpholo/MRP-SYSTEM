export const DEFAULT_TOLERANCE = Object.freeze({ type: "ABSOLUTE", value: 0 });

export function evaluateTolerance({ varianceQty, expectedQty, tolerance = DEFAULT_TOLERANCE }) {
  const absolute = Math.abs(Number(varianceQty) || 0);
  const expected = Math.abs(Number(expectedQty) || 0);
  const absoluteLimit = Math.max(0, Number(tolerance.value ?? tolerance.absoluteValue) || 0);
  const percentageLimit = expected * Math.max(0, Number(tolerance.percentageValue ?? tolerance.value) || 0) / 100;
  let allowedVarianceQty = absoluteLimit;
  if (tolerance.type === "PERCENTAGE") allowedVarianceQty = percentageLimit;
  if (tolerance.type === "ABSOLUTE_AND_PERCENTAGE") allowedVarianceQty = Math.min(absoluteLimit, percentageLimit);
  return { withinTolerance: absolute <= allowedVarianceQty, allowedVarianceQty };
}
