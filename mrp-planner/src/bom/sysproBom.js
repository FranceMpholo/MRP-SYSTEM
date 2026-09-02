export const normalizeStockCode = (value) => String(value || "").trim().toUpperCase();
export function indexSysproBom(rows = []) { const byParent = new Map(); rows.forEach((row) => { const key = normalizeStockCode(row.parentStockCode); if (!key) return; byParent.set(key, [...(byParent.get(key) || []), row]); }); return byParent; }
export const sysproBomParents = (rows = []) => Array.from(indexSysproBom(rows).entries()).map(([parentStockCode, components]) => ({ parentStockCode, parentDescription: components[0]?.parentDescription || "", components }));
