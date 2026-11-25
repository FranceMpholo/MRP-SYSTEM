import { inspectBom, itemStockCode, normalizeStockCode, bomFactor } from './bomValidation.js';

export function adaptLedgerBoms(items, rows) {
  const ids = new Map(items.map((item) => [itemStockCode(item), item.id]));
  return rows.map((row, index) => ({ ...row, id: `syspro_${index}`,
    parentId: ids.get(normalizeStockCode(row.parentStockCode)),
    componentId: ids.get(normalizeStockCode(row.componentStockCode)),
  }));
}

export function ledgerIssues(items, rows, bomAvailable) {
  const ids = new Set(items.map((item) => item.id));
  const byId = new Map(items.map((item) => [item.id, itemStockCode(item)]));
  const normalizedRows = rows.map((row) => ({ ...row,
    parentStockCode: row.parentStockCode ?? byId.get(row.parentId), componentStockCode: row.componentStockCode ?? byId.get(row.componentId) }));
  const context = inspectBom(normalizedRows, items);
  const blocked = new Map();
  const add = (id, issue) => { if (ids.has(id)) blocked.set(id, new Set([...(blocked.get(id) || []), issue])); };
  for (const item of items) {
    context.globalIssues.forEach((issue) => add(item.id, issue));
    if (!bomAvailable) add(item.id, 'SYSPRO BOM unavailable or refreshing; ledger requirements are unknown.');
    if (item.liveOnly) add(item.id, 'Live item has no saved planning policy/balance; Make/Buy, lead time and available planning stock are not inferred.');
    if (!item.liveOnly && Object.hasOwn(item, 'savedPlanningUom')
        && normalizeStockCode(item.savedPlanningUom) !== normalizeStockCode(item.uom)) add(item.id, 'Saved planning balance UOM differs from live BOM/stock UOM; no verified conversion is available.');
    if (item.onHand === null || item.onHand === undefined || String(item.onHand).trim() === '' || !Number.isFinite(Number(item.onHand))) add(item.id, 'Saved planning stock balance is unavailable; no zero balance is inferred.');
    if (bomAvailable && !rows.length) add(item.id, 'SYSPRO returned an empty BOM snapshot; dependent requirements cannot be established.');
    if (item.type === 'Make' && !rows.some((row) => row.parentId === item.id)) add(item.id, 'Saved Make item has no BOM in the current snapshot; dependent materials are unknown.');
  }
  for (const row of normalizedRows) {
    const issues = [...context.lineIssues.get(row), ...(context.parentIssues.get(normalizeStockCode(row.parentStockCode)) || [])];
    if (!ids.has(row.parentId) || !ids.has(row.componentId)) issues.push('BOM item identifier is unresolved; the source line has not been discarded.');
    if (!['positive', 'zero'].includes(bomFactor(row).state)) issues.push('BOM factor is missing, invalid or negative; ledger explosion is unresolved.');
    for (const issue of issues) { add(row.parentId, issue); add(row.componentId, issue); }
  }
  // The affected dependency component cannot be presented as a complete plan:
  // parents with an unresolved subtree and all downstream demand are incomplete.
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (blocked.has(row.parentId) && ids.has(row.componentId) && !blocked.has(row.componentId)) {
      add(row.componentId, 'Upstream BOM requirement is incomplete; dependent demand is unknown.'); changed = true;
    }
    for (const row of rows) if (blocked.has(row.componentId) && ids.has(row.parentId) && !blocked.has(row.parentId)) {
      add(row.parentId, 'Downstream BOM or material planning policy is incomplete; the full material plan is unresolved.'); changed = true;
    }
  }
  return blocked;
}
