export const ROLES = [
  "ADMIN",
  "PLANNER",
  "SUPERVISOR",
  "TEAM LEADER",
  "SENIOR SUPERVISOR",
  "PRODUCTION ENG",
  "MANUFACTURING MANAGER",
  "INVENTORY",
];

export const PERMISSIONS = {
  ADMIN: { dashboard: "view", planning: "edit", planAdjustments: "edit", actuals: "edit", cycleCount: "edit", cycleCountSetup: "edit", cycleCountReopen: "edit", productionMrp: "view", reconciliation: "view", items: "edit", bom: "edit", ledger: "view", users: "edit" },
  PLANNER: { dashboard: "view", planning: "edit", actuals: "view", cycleCount: "view", cycleCountSetup: "edit", productionMrp: "view", reconciliation: "view", items: "view", bom: "view", ledger: "view" },
  SUPERVISOR: { dashboard: "view", planning: "view", planAdjustments: "edit", actuals: "edit", cycleCount: "edit", productionMrp: "view", reconciliation: "view", items: "view", bom: "view", ledger: "view" },
  "TEAM LEADER": { dashboard: "view", planning: "view", actuals: "edit", cycleCount: "edit", productionMrp: "view", reconciliation: "view", items: "view", bom: "view", ledger: "view" },
  "SENIOR SUPERVISOR": { dashboard: "view", planning: "view", planAdjustments: "edit", actuals: "edit", cycleCount: "edit", cycleCountSetup: "edit", productionMrp: "view", reconciliation: "view", items: "view", bom: "view", ledger: "view" },
  "PRODUCTION ENG": { dashboard: "view", planning: "view", actuals: "view", cycleCount: "view", productionMrp: "view", reconciliation: "view", items: "view", bom: "view", ledger: "view" },
  "MANUFACTURING MANAGER": { dashboard: "view", planning: "edit", planAdjustments: "edit", actuals: "edit", cycleCount: "edit", cycleCountSetup: "edit", cycleCountReopen: "edit", productionMrp: "view", reconciliation: "view", items: "view", bom: "view", ledger: "view" },
  INVENTORY: { dashboard: "view", planning: "view", actuals: "view", cycleCount: "view", cycleCountSetup: "edit", productionMrp: "view", reconciliation: "view", items: "view", bom: "view", ledger: "view" },
};

export const can = (user, resource, action = "view") => {
  const level = PERMISSIONS[user?.role]?.[resource];
  return level === "edit" || (action === "view" && level === "view");
};
