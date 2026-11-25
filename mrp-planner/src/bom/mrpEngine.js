import { ledgerIssues } from './ledgerBom.js';
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function computeLLC(items, boms) {
  const llc = {};
  items.forEach((i) => (llc[i.id] = 0));
  let changed = true;
  let guard = 0;
  while (changed && guard < items.length + 3) {
    changed = false;
    boms.forEach((b) => {
      const cand = (llc[b.parentId] || 0) + 1;
      if ((llc[b.componentId] || 0) < cand) {
        llc[b.componentId] = cand;
        changed = true;
      }
    });
    guard++;
  }
  return llc;
}

export function runMRP(items, boms, demands, openOrders, weeksCount, monday, bomAvailable = true, inventoryAvailable = true) {
  const blocked = ledgerIssues(items, boms, bomAvailable);
  if (!inventoryAvailable) for (const item of items) blocked.set(item.id, new Set([...(blocked.get(item.id) || []), 'SYSPRO inventory unavailable or refreshing; stock calculations are incomplete.']));
  const llc = computeLLC(items, boms.filter((row) => !blocked.has(row.parentId) && !blocked.has(row.componentId)));
  const order = [...items].sort((a, b) => (llc[a.id] || 0) - (llc[b.id] || 0));
  const dependentGR = {};
  items.forEach((i) => (dependentGR[i.id] = new Array(weeksCount).fill(0)));

  const bucketIndex = (dateStr) => {
    const idx = Math.floor(daysBetween(monday, dateStr) / 7);
    return Math.min(Math.max(idx, 0), weeksCount - 1);
  };
  const isPastDue = (dateStr) => daysBetween(monday, dateStr) < 0;

  const results = {};

  order.forEach((item) => {
    if (blocked.has(item.id)) {
      const unknown = () => new Array(weeksCount).fill(null);
      results[item.id] = { GR: unknown(), SR: unknown(), POH: unknown(), PORcpt: unknown(), PORel: unknown(), pastDueRelease: null, pastDueDemand: null, incomplete: true, issues: [...blocked.get(item.id)] };
      return;
    }
    const GR = new Array(weeksCount).fill(0);
    let pastDueDemand = 0;
    demands.filter((d) => d.itemId === item.id).forEach((d) => {
      if (isPastDue(d.dueDate)) pastDueDemand += Number(d.qty) || 0;
      GR[bucketIndex(d.dueDate)] += Number(d.qty) || 0;
    });
    for (let w = 0; w < weeksCount; w++) GR[w] += dependentGR[item.id][w];

    const SR = new Array(weeksCount).fill(0);
    openOrders.filter((o) => o.itemId === item.id).forEach((o) => {
      SR[bucketIndex(o.dueDate)] += Number(o.qty) || 0;
    });

    const leadWeeks = Math.max(0, Math.ceil((Number(item.leadTimeDays) || 0) / 7));
    const safety = Number(item.safetyStock) || 0;
    const lot = Number(item.lotSize) || 0;

    const POH = [];
    const PORcpt = new Array(weeksCount).fill(0);
    const PORel = new Array(weeksCount).fill(0);
    let running = Number(item.onHand) || 0;
    let pastDueRelease = 0;

    for (let w = 0; w < weeksCount; w++) {
      const avail = running + SR[w] - GR[w];
      let rcpt = 0;
      if (avail < safety) {
        const need = safety - avail;
        rcpt = lot > 0 ? Math.ceil(need / lot) * lot : need;
      }
      PORcpt[w] = rcpt;
      running = avail + rcpt;
      POH.push(running);

      if (rcpt > 0) {
        const relIdx = w - leadWeeks;
        if (relIdx < 0) {
          pastDueRelease += rcpt;
          PORel[0] += rcpt;
        } else {
          PORel[relIdx] += rcpt;
        }
      }
    }

    results[item.id] = { GR, SR, POH, PORcpt, PORel, pastDueRelease, pastDueDemand, llc: llc[item.id] || 0 };

    boms.filter((b) => b.parentId === item.id && dependentGR[b.componentId]).forEach((b) => {
      for (let w = 0; w < weeksCount; w++) {
        if (PORel[w] > 0) dependentGR[b.componentId][w] += PORel[w] * Number(b.qtyPer);
      }
    });
  });

  return results;
}
