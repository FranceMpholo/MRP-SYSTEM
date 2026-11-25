export const normalizeStockCode = (value) => String(value ?? '').trim().toUpperCase();
export const itemStockCode = (item) => normalizeStockCode(item?.code ?? item?.stockCode ?? item?.StockCode ?? item?.STOCKCODE);
export function quantityState(raw) {
  if (raw === null || raw === undefined) return 'missing';
  if (typeof raw === 'string' && !raw.trim()) return 'blank';
  if (!['number', 'string'].includes(typeof raw) || !Number.isFinite(Number(raw))) return 'invalid';
  return Number(raw) === 0 ? 'zero' : Number(raw) < 0 ? 'negative' : 'positive';
}
export function bomFactor(row) {
  const state = ['missing', 'blank', 'invalid'].includes(row.qtyPerState) ? row.qtyPerState : quantityState(row.qtyPer);
  return { state, value: ['positive', 'zero', 'negative'].includes(state) ? Number(row.qtyPer) : null };
}
const unit = (value) => String(value ?? '').trim().toUpperCase();
export function factorUnitIssues(row, parent, child) {
  const issues = [];
  if (row.factorUnitsVerified !== true || row.qtyPerBasis !== 'stocking' || !unit(row.parentUom) || !unit(row.componentUom)) {
    issues.push('BOM factor units are unverified; stock UOM names alone do not establish the factor basis.');
  }
  const parentUom = parent?.uom ?? parent?.StockUom;
  const childUom = child?.uom ?? child?.StockUom;
  if (unit(parentUom) && unit(row.parentUom) && unit(parentUom) !== unit(row.parentUom)) issues.push('Parent UOM differs from the BOM factor basis; no verified conversion is available.');
  if (unit(childUom) && unit(row.componentUom) && unit(childUom) !== unit(row.componentUom)) issues.push('Component UOM differs from the BOM factor basis; no verified conversion is available.');
  return issues;
}

/** Retains source lines; ambiguous alternatives and duplicates are never merged. */
export function inspectBom(rows = [], items = []) {
  const itemsByCode = new Map(items.map((item) => [itemStockCode(item), item]));
  const byParent = new Map();
  const lineIssues = new Map();
  const parentIssues = new Map();
  const globalIssues = [];
  const addParent = (parent, issue) => parentIssues.set(parent, [...(parentIssues.get(parent) || []), issue]);
  for (const row of rows) {
    const parent = normalizeStockCode(row.parentStockCode), child = normalizeStockCode(row.componentStockCode);
    byParent.set(parent, [...(byParent.get(parent) || []), row]);
    const issues = [];
    const { state } = bomFactor(row);
    if (!parent || !child) issues.push('BOM parent or component stock code is missing.');
    if (!parent) globalIssues.push('A source BOM line has no parent reference; its material requirement cannot be assigned safely.');
    if (['missing', 'blank', 'invalid'].includes(state)) issues.push(`BOM QtyPer is ${state}; requirement is unknown.`);
    if (state === 'negative') issues.push('Negative BOM QtyPer requires business review; it is not ordinary consumption or a stock credit.');
    if (row.parentReferenceExists === false || (items.length && !itemsByCode.has(parent))) issues.push(`Parent item reference is missing: ${parent}.`);
    if (row.componentReferenceExists === false || (items.length && !itemsByCode.has(child))) issues.push(`Component item reference is missing: ${child}.`);
    issues.push(...factorUnitIssues(row, itemsByCode.get(parent), itemsByCode.get(child)));
    if (row.fixedQtyPerFlag === 'Y') issues.push('Fixed-quantity BOM relationship needs a verified calculation rule.');
    if (row.structureOnDate || row.structureOffDate) issues.push('BOM effectivity selection is unresolved; dated source lines are retained for review.');
    lineIssues.set(row, issues);
  }
  for (const [parent, lines] of byParent) {
    const structures = new Set(lines.map((row) => [row.route || '', row.version || '', row.release || ''].join('\0')));
    if (structures.size > 1) addParent(parent, `Multiple BOM routes/revisions exist for ${parent}; structure selection is unresolved.`);
    const groups = new Map();
    lines.forEach((row) => { const code = normalizeStockCode(row.componentStockCode); groups.set(code, [...(groups.get(code) || []), row]); });
    for (const [child, matches] of groups) if (matches.length > 1) {
      const issue = `Duplicate component lines ${parent} → ${child}; sequence/alternate meaning must be established before combining quantities.`;
      matches.forEach((row) => lineIssues.get(row).push(issue));
    }
  }
  // A recursion stack detects indirect cycles without a low-level-code guard.
  const visited = new Set(), stack = [], active = new Set();
  const visit = (parent) => {
    if (active.has(parent)) {
      const cycle = [...stack.slice(stack.indexOf(parent)), parent];
      cycle.forEach((code) => addParent(code, `BOM cycle detected: ${cycle.join(' → ')}.`));
      return;
    }
    if (visited.has(parent)) return;
    active.add(parent); stack.push(parent);
    for (const row of byParent.get(parent) || []) {
      const child = normalizeStockCode(row.componentStockCode);
      if (byParent.has(child)) visit(child);
    }
    stack.pop(); active.delete(parent); visited.add(parent);
  };
  byParent.forEach((_, parent) => visit(parent));
  const issuesForParent = (parentCode, { direct = false } = {}) => {
    const parent = normalizeStockCode(parentCode), issues = [...globalIssues, ...(parentIssues.get(parent) || [])];
    for (const row of byParent.get(parent) || []) {
      issues.push(...lineIssues.get(row));
      if (direct && byParent.has(normalizeStockCode(row.componentStockCode))) issues.push(`Nested BOM ${row.componentStockCode}: stocked-subassembly/phantom policy is unresolved; no automatic explosion is applied.`);
    }
    return [...new Set(issues)];
  };
  return { byParent, lineIssues, parentIssues, globalIssues: [...new Set(globalIssues)], issuesForParent };
}

export const bomSourceReady = (status) => Boolean(status?.connected && !status.loading && !status.error);
