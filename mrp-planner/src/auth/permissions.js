export const ROLES = ["ADMIN", "PLANNER", "SUPERVISOR", "INVENTORY"];

export const PERMISSIONS = {
  ADMIN: { dashboard: "view", planning: "edit", actuals: "edit", productionMrp: "view", reconciliation: "view", items: "edit", bom: "edit", ledger: "view", users: "edit" },
  PLANNER: { dashboard: "view", planning: "edit", actuals: "view", productionMrp: "view", reconciliation: "view", items: "view", bom: "view", ledger: "view" },
  SUPERVISOR: { dashboard: "view", planning: "view", actuals: "edit", productionMrp: "view", reconciliation: "view", items: "view", bom: "view", ledger: "view" },
  INVENTORY: { dashboard: "view", planning: "view", actuals: "view", productionMrp: "view", reconciliation: "view", items: "view", bom: "view", ledger: "view" },
};

export const can = (user, resource, action = "view") => {
  const level = PERMISSIONS[user?.role]?.[resource];
  return level === "edit" || (action === "view" && level === "view");
};
