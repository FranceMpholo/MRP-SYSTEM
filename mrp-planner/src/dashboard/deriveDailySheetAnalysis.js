import { CYCLE_COUNT_SHIFTS, REQUIRED_THERMOFORMING_SHEETS, isValidPhysicalQuantity, canSubmitCycleCountShift } from '../cycleCount/cycleCountUtils.js';
import { bomFactor } from '../bom/bomValidation.js';
const code = (value) => String(value ?? '').trim().toUpperCase();
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;
const unavailable = (reason, status = 'unavailable') => ({ quantity: null, status, reason });
export const SCRAP_DESTINATIONS = Object.freeze({ '120002': 'B-REG01', '120003': 'B-REG01', '121047': 'B-SCR01' });

export function dailyPhysicalCounts({ date, cycleCountDays = [] }) {
  const days = cycleCountDays.filter((day) => day.date === date && day.productionLine === 'thermoforming');
  const day = days.length === 1 ? days[0] : null;
  return REQUIRED_THERMOFORMING_SHEETS.map((stockCode) => {
    const counts = CYCLE_COUNT_SHIFTS.map(({ id: shift, label }) => {
      const assignments = (day?.shifts || []).filter((item) => item.shift === shift);
      const assignment = assignments.length === 1 ? assignments[0] : null;
      const records = (day?.countRecords || []).filter((record) => record.shift === shift && code(record.stockCode) === stockCode
        && code(record.warehouse || day.warehouse) === 'B-WIP01' && !String(record.location || '').trim());
      const record = records.length === 1 ? records[0] : null;
      const valid = record && ['string', 'number'].includes(typeof record.physicalCount) && String(record.physicalCount).trim() !== '' && isValidPhysicalQuantity(record.physicalCount);
      const shiftComplete = Boolean(day && Array.isArray(day.shifts) && canSubmitCycleCountShift(day, shift));
      const included = Boolean(valid && assignments.length === 1 && assignment?.submittedAt && shiftComplete);
      const reason = days.length > 1 ? 'Duplicate Cycle Count days require review' : !day ? 'Missing Cycle Count day'
        : assignments.length > 1 ? 'Duplicate shift submissions' : !assignment?.submittedAt ? 'Draft / not submitted'
          : records.length !== 1 ? 'Missing or duplicate B-WIP01 count' : !valid ? 'Physical count missing or invalid'
            : !shiftComplete ? 'Submitted shift is incomplete / legacy' : 'Submitted and complete';
      return { shift, label, quantity: valid ? Number(record.physicalCount) : null, included, status: included ? 'complete' : 'incomplete', reason,
        recordId: record?.id || null, countedAt: record?.countedAt || null, countedByUserId: record?.countedByUserId || null,
        submittedAt: assignment?.submittedAt || null, warehouse: 'B-WIP01' };
    });
    const complete = counts.every((count) => count.included);
    return { stockCode, counts, complete, completedShifts: counts.filter((count) => count.included).length,
      quantity: complete ? round(counts.reduce((sum, count) => sum + count.quantity, 0)) : null,
      status: complete ? 'Complete' : 'Incomplete', label: '3-shift count sum' };
  });
}

export function finishedProductRole(stockCode, description) {
  const c = code(stockCode);
  if (!/(12606|2600038|40726|2640726|13036)/.test(c) && !/\bTPO\b/i.test(description)) return null;
  if (/\bTAILGATE\b/i.test(description)) return 'tailgates';
  if (/\b(BEDLINER|LNR)\b/i.test(description)) return 'bedliners';
  if (/\bTPO\b/i.test(description) || /13036/.test(c)) return 'tpo';
  return null;
}

export function sheetMapping(stockCode, boms = [], available = true, index) {
  const byParent = index || new Map();
  if (!index) for (const line of boms) { const key = code(line.parentStockCode); byParent.set(key, [...(byParent.get(key) || []), line]); }
  const candidates = new Set(), paths = [], issues = new Set(), warnings = new Set();
  if (!available) return { stockCode, status: 'mapping_unverified', candidateSheets: [], paths, reason: 'A fresh complete SYSPRO BOM snapshot is required.' };
  const visit = (parent, path, trace, depth) => {
    if (depth > 16) { issues.add('The alternative BOM graph exceeds the verified traversal depth'); return; }
    // Identity attribution does not explode quantities. Revisiting an ancestor
    // introduces no new sheet: its other branches are already being explored.
    // Retain the cycle warning, while requiring the complete positive graph to
    // converge on one sheet. Production MRP's calculation guard is unchanged.
    if (path.has(parent)) { warnings.add('Positive BOM cycle retained for review; no consumption quantity is calculated'); return; }
    for (const line of byParent.get(parent) || []) {
      const child = code(line.componentStockCode), factor = bomFactor(line);
      if (['zero', 'negative'].includes(factor.state)) continue; // zero/non-consuming recovery lines do not prove sheet consumption
      if (!REQUIRED_THERMOFORMING_SHEETS.includes(child) && !byParent.has(child)) continue;
      if (factor.state !== 'positive') { issues.add('Unknown consumption factor on a relevant BOM path'); continue; }
      if (line.parentReferenceExists === false || line.componentReferenceExists === false || line.factorUnitsVerified !== true || line.qtyPerBasis !== 'stocking') issues.add('Unverified master references or consumption basis');
      const meaningfulDate = (value) => value && !/^(1900|0001)-/.test(value instanceof Date ? value.toISOString() : String(value));
      if (meaningfulDate(line.structureOnDate) || meaningfulDate(line.structureOffDate) || code(line.version) || code(line.release)) issues.add('Dated/revision selection requires confirmation');
      const next = [...trace, { parent, child, route: line.route || '', sequence: line.sequence || '', qtyPer: factor.value }];
      if (REQUIRED_THERMOFORMING_SHEETS.includes(child)) { candidates.add(child); if (paths.length < 24) paths.push(next); }
      else visit(child, new Set([...path, parent]), next, depth + 1);
    }
  };
  visit(code(stockCode), new Set(), [], 0);
  if (candidates.size !== 1) issues.add(candidates.size ? 'Alternative BOM paths consume different sheets; no production route was selected' : 'No verified consuming path to a required sheet');
  return { stockCode, status: issues.size ? 'mapping_unverified' : 'verified', candidateSheets: [...candidates], paths, warnings: [...warnings],
    reason: [...issues].join('; ') || 'All retained positive BOM paths identify one sheet. Part quantity is not multiplied by QtyPer.',
    basis: 'Current SYSPRO BOM identity attribution; not historical route selection or calculated sheet consumption' };
}

const sumMetrics = (rows, key) => {
  if (rows.length !== 3 || new Set(rows.map((row) => row.shift)).size !== 3) return unavailable('All three shift results are required.');
  const failed = rows.find((row) => row[key]?.status !== 'available' || !finite(row[key]?.quantity));
  const units = new Set(rows.map((row) => code(row.uom)));
  if (failed) return unavailable(failed[key]?.reason || 'Shift movement unavailable.', failed[key]?.status || 'unavailable');
  if (units.size !== 1 || units.has('')) return unavailable('Stock units are missing or inconsistent.');
  return { status: 'available', quantity: round(rows.reduce((sum, row) => sum + row[key].quantity, 0)), uom: rows[0].uom };
};

function sumPostings(rows, uom, date, { fg = false } = {}) {
  if (rows.some((row) => row.status !== 'available' || !finite(row.quantity))) return unavailable(rows.find((row) => row.status !== 'available')?.reason || 'Posting quantity is unavailable.');
  const dateOnly = rows.some((row) => row.shiftStatus === 'unavailable_by_shift');
  if (dateOnly && !fg) return unavailable('Posting dates without verified times cannot be allocated to configured shifts.', 'unavailable_by_shift');
  const selected = dateOnly ? rows.filter((row) => row.entryDate === date) : rows;
  const units = new Set(selected.map((row) => code(row.stockUom)));
  if (units.has('') || units.size > 1 || (!fg && [...units].some((unit) => unit !== code(uom))) || (fg && [...units].some((unit) => !['EA', 'PCS', 'EACH', 'PART'].includes(unit)))) return unavailable('Posting stock units are missing, mixed or do not match the required stock units.');
  return { status: dateOnly ? 'posting_date_only' : 'available', quantity: round(selected.reduce((sum, row) => sum + row.quantity, 0)),
    uom: selected[0]?.stockUom || uom, reason: dateOnly ? 'By posting date; Unavailable by shift. Posted to finished goods, not time of production.' : '', rows: selected };
}

export function dailySystemSheets({ date, payload, boms = [], bomAvailable = false, tailgateData = payload?.tailgateData, bedlinerData = payload?.bedlinerData }) {
  const byParent = new Map();
  for (const line of boms) { const parent = code(line.parentStockCode); byParent.set(parent, [...(byParent.get(parent) || []), line]); }
  const postings = Array.isArray(payload?.postingData?.rows) ? payload.postingData.rows : [];
  const fg = postings.filter((row) => row.category === 'finishedGoods').map((row) => ({ ...row, role: finishedProductRole(row.stockCode, row.description) }));
  const mappings = [...new Set(fg.map((row) => row.stockCode))].map((stockCode) => {
    const posting = fg.find((row) => row.stockCode === stockCode);
    const mapping = sheetMapping(stockCode, boms, bomAvailable, byParent);
    return { ...mapping, description: posting?.description, ...(!posting.role ? {
      status: 'mapping_unverified', reason: `Finished product classification is unverified. ${mapping.reason}`,
    } : {}) };
  });
  const mappingByCode = new Map(mappings.map((mapping) => [mapping.stockCode, mapping]));
  return REQUIRED_THERMOFORMING_SHEETS.map((stockCode) => {
    const shifts = (payload?.data || []).filter((row) => row.stockCode === stockCode && row.productionDate === date && row.warehouse === 'B-WIP01');
    const received = sumMetrics(shifts, 'qtyReceived'), issued = sumMetrics(shifts, 'totalIssue');
    const uom = shifts.find((row) => row.uom)?.uom || null;
    const scrapDestination = SCRAP_DESTINATIONS[stockCode];
    const scrapRows = postings.filter((row) => row.stockCode === stockCode && (
      (row.warehouse === 'B-WIP01' && row.newWarehouse === scrapDestination)
      || (row.warehouse === scrapDestination && row.newWarehouse === 'B-WIP01')));
    const regRows = postings.filter((row) => row.stockCode === stockCode && row.category === 'regActivity');
    const postingUnavailable = payload?.postingData?.status !== 'connected' || !Array.isArray(payload?.postingData?.rows);
    const coverage = payload?.stockCoverage?.find((row) => row.stockCode === stockCode);
    const covered = coverage?.warehouseExists && coverage?.earliestEntryDate?.slice(0, 10) <= date && uom;
    const completeShifts = shifts.length === 3 && CYCLE_COUNT_SHIFTS.every(({ id }) => shifts.filter((row) => row.shift === id).length === 1)
      && shifts.every((row) => code(row.uom) && code(row.uom) === code(uom));
    const scrapResult = postingUnavailable ? unavailable(payload?.postingData?.error || 'Posting feed unavailable.')
      : !covered ? unavailable('Retained stock history does not cover this date.')
        : !completeShifts ? unavailable('All three configured shifts and consistent stock units are required.') : sumPostings(scrapRows, uom, date);
    const scrap = scrapResult.status === 'unavailable_by_shift' ? { ...scrapResult, status: 'unavailable' } : scrapResult;
    const scrapConfirmed = scrap; // compatibility for existing read-only evidence consumers
    const outputs = {};
    for (const role of ['tpo']) {
      const relevant = fg.filter((row) => (row.role === role || !row.role) && (mappingByCode.get(row.stockCode)?.candidateSheets.includes(stockCode) || !mappingByCode.get(row.stockCode)?.candidateSheets.length));
      const unresolved = relevant.filter((row) => mappingByCode.get(row.stockCode)?.status !== 'verified');
      outputs[role] = postingUnavailable ? unavailable(payload?.postingData?.error || 'Posting feed unavailable.')
        : !bomAvailable ? unavailable('Fresh SYSPRO BOM attribution is required.', 'mapping_unverified')
          : unresolved.length ? { ...unavailable('One or more posted stock codes have ambiguous or missing sheet mappings.', 'mapping_unverified'), unresolvedCodes: [...new Set(unresolved.map((row) => row.stockCode))] }
            : sumPostings(relevant, 'parts', date, { fg: true });
    }
    outputs.bedliners = bedlinerData?.date === date && Array.isArray(bedlinerData?.data)
      ? bedlinerData.data.find((row) => row.stockCode === stockCode) || unavailable('No Bedliner production result for this sheet')
      : unavailable('Verified Bedliner backflush production data is unavailable');
    outputs.tailgates = tailgateData?.date === date && Array.isArray(tailgateData?.data)
      ? tailgateData.data.find((row) => row.stockCode === stockCode) || unavailable('No tailgate result for this sheet')
      : unavailable('Verified backflush-to-finished-goods tailgate data is unavailable');
    return { stockCode, uom, received, issued, scrap, scrapConfirmed, scrapDestination, regRows, scrapRows, ...outputs,
      shifts, mappings: mappings.filter((mapping) => mapping.candidateSheets.includes(stockCode) || !mapping.candidateSheets.length),
      finishedGoodsRows: fg.filter((row) => { const mapping = mappingByCode.get(row.stockCode); return mapping?.candidateSheets.includes(stockCode) || !mapping?.candidateSheets.length; }),
      movementEvidence: (payload?.movementEvidence || []).filter((row) => row.stockCode === stockCode) };
  });
}
