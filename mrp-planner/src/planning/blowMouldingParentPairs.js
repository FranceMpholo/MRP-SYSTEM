// Explicit business mappings. Never infer pairs by rewriting stock-code strings.
export const BLOW_MOULDING_PARENT_PAIRS = [
  { planningCode: "N1WB_BAA_PAIR", displayCode: "BAA", description: "P703 SS RAP Low Series LH/RH mould set", parents: ["N1WB-16450-BAA", "N1WB-16451-BAA"] },
  { planningCode: "N1WB_BB_PAIR", displayCode: "BB", description: "P703 SS RAP Low Series BB LH/RH mould set", parents: ["N1WB-16450-BB", "N1WB-16451-BB"] },
  { planningCode: "N1WB_CAA_PAIR", displayCode: "CAA", description: "P703 SS DBL Low Series LH/RH mould set", parents: ["N1WB-16450-CAA", "N1WB-16451-CAA"] },
  { planningCode: "N1WB_CA_PAIR", displayCode: "CA", description: "P703 SS DBL Low Series CA LH/RH mould set", parents: ["N1WB-16450-CA", "N1WB-16451-CA"] },
  { planningCode: "N1WB_LAA_PAIR", displayCode: "LAA", description: "P703 SS DBL High Series LH/RH mould set", parents: ["N1WB-16450-LAA", "N1WB-16451-LAA"] },
  { planningCode: "N1WB_LB_PAIR", displayCode: "LB", description: "P703 SS DBL High Series LB LH/RH mould set", parents: ["N1WB-16450-LB", "N1WB-16451-LB"] },
  { planningCode: "N1XB_ABA_PAIR", displayCode: "ABA", description: "J73 SS DBL Low Series LH/RH mould set", parents: ["N1XB-16450-ABA", "N1XB-16451-ABA"] },
  { planningCode: "N1XB_AA_PAIR", displayCode: "AA", description: "J73 SS DBL Low Series AA LH/RH mould set", parents: ["N1XB-16450-AA", "N1XB-16451-AA"] },
  { planningCode: "N1XB_BAA_PAIR", displayCode: "BAA", description: "J73 SS DBL High Series LH/RH mould set", parents: ["N1XB-16450-BAA", "N1XB-16451-BAA"] },
  { planningCode: "N1XB_BA_PAIR", displayCode: "BA", description: "J73 SS DBL High Series BA LH/RH mould set", parents: ["N1XB-16450-BA", "N1XB-16451-BA"] },
];

const pairsByPlanningCode = new Map(BLOW_MOULDING_PARENT_PAIRS.map((pair) => [pair.planningCode, pair]));

export const getParentPair = (planningCode) => pairsByPlanningCode.get(planningCode) || null;
export const getPlanningDisplayCode = (planningCode) => getParentPair(planningCode)?.displayCode || null;

export function availableParentPairs(parentStockCodes) {
  const available = parentStockCodes instanceof Set ? parentStockCodes : new Set(parentStockCodes);
  return BLOW_MOULDING_PARENT_PAIRS.filter((pair) => pair.parents.every((code) => available.has(code)));
}

export function expandPlanningEntry(entry) {
  const quantity = Number(entry.buildQty) || 0;
  if (!entry.partNumber || quantity <= 0) return [];
  const pair = getParentPair(entry.partNumber);
  if (!pair) return [{ parentStockCode: entry.partNumber, buildQty: quantity, planningCode: entry.partNumber, displayCode: entry.partNumber, isPair: false }];
  return pair.parents.map((parentStockCode) => ({ parentStockCode, buildQty: quantity, planningCode: pair.planningCode, displayCode: pair.displayCode, isPair: true }));
}
