import { PRODUCTION_LINES, entryProductionLine, deriveThermoformingParents, classifyThermoformingParent } from "../production/productionLines.js";
import { buildPlanningParents, mondayOf } from "./planningBoardUtils.js";
import { SHIFT_CONFIG } from "./shiftConfig.js";
import { weekdayFromDateOnly } from "./planningApiMapper.js";

const normalize = (value) => String(value || "").trim().toUpperCase();
const positive = (value) => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(value)) && Number.isFinite(Number(value)) && Number(value) > 0;
export const excelMappingKey = (row, cell) => `${row.machineOverride || cell.machine || cell.sourceMachine}|${normalize(row.productText)}`;
const slotKey = (entry) => [entry.productionLine || entryProductionLine(entry), entry.machine, entry.day, entry.shift].join("|");

export function planningExcelCatalog(items = [], boms = []) {
  const itemsByCode = new Map(items.map((item) => [normalize(item.code), item]));
  const liveUnits = new Map(boms.filter((row) => row.parentUom).map((row) => [normalize(row.parentStockCode), normalize(row.parentUom)]));
  const stockUnit = (code) => liveUnits.get(normalize(code)) || normalize(itemsByCode.get(normalize(code))?.uom) || 'EA';
  return Object.values(PRODUCTION_LINES).flatMap((line) => Object.keys(line.machines).flatMap((machine) => {
    const parents = line.id === "thermoforming" ? deriveThermoformingParents({ sysproBomRows: boms, machine }) : buildPlanningParents(items, boms, { includePairedMembers: true });
    return parents.map((parent) => ({ machine, productionLine: line.id, planningCode: parent.stockCode, fullStockCodes: parent.linkedParents || [parent.stockCode],
      description: parent.description, alias: parent.alias, isPair: Boolean(parent.isPair), targetUnit: parent.isPair ? "SET" : "EA", stockUom: [...new Set((parent.linkedParents || [parent.stockCode]).map(stockUnit))].sort().join('+'),
      parentItemId: itemsByCode.get(parent.stockCode)?.id || null }));
  }));
}

export function defaultExcelMapping(row, cell, catalog) {
  const exact = catalog.filter((item) => item.machine === (row.machineOverride || cell.machine) && item.planningCode === normalize(row.productText) && !item.isPair);
  return { target: exact.length === 1 ? exact[0].planningCode : "", sourceUnit: "", factor: "", explanation: "", reviewed: false };
}

export function createExcelPlanDraft(document) {
  return { year: "", yearConfirmed: false, filenameReviewed: false, sourceReviewed: false, nightDateReviewed: false,
    dates: Object.fromEntries(document.dateGroups.map((group) => [group.id, { date: "", confirmed: false }])),
    shifts: Object.fromEntries(document.shifts.map((shift) => [shift.key, { target: "", confirmed: false }])), mappings: {},
    rows: document.cells.flatMap((cell) => cell.fragments.map((fragment, index) => ({ id: `${cell.id}:f${index}`, cellId: cell.id, sourceFragment: index,
      kind: fragment.kind, productText: fragment.productText, quantity: fragment.quantity,
      include: false, excludedReason: !cell.machine ? "Unsupported machine/area; source scope retained for review." : fragment.kind === "Remark" ? "Remark has no supported planning activity or production quantity." : !cell.rawText ? "Blank source cell; no activity inferred." : "Not selected by the planner.", correctionNote: "", machineOverride: "", machineOverrideConfirmed: false, activityConfirmed: false,
      dateOverride: "", dateOverrideConfirmed: false, shiftOverride: "", shiftOverrideConfirmed: false, notesConfirmed: false, appendConfirmed: false, independentConfirmed: false }))) };
}

export function reviewExcelPlanImport({ document, draft, catalog, planningWeeks = {}, bomConnected }) {
  const errors = [];
  if (!document.fingerprint || !document.cells.length || !document.dateGroups.length) errors.push("A supported, readable Excel table is required.");
  if (!bomConnected) errors.push("A connected SYSPRO BOM snapshot is required to validate product mappings. No import is possible while it is loading or unavailable.");
  if (!/^\d{4}$/.test(draft.year) || Number(draft.year) < 1900 || Number(draft.year) > 2199 || !draft.yearConfirmed) errors.push("Enter and explicitly confirm the printed dates' year.");
  if (!draft.filenameReviewed) errors.push("Acknowledge the filename/printed-date review.");
  if (!draft.sourceReviewed) errors.push("Confirm source-cell ownership and the reviewed exclusions.");
  if (!draft.nightDateReviewed) errors.push("Confirm that the printed date is the shift-start date, including the overnight shift.");
  document.dateGroups.forEach((group) => {
    const decision = draft.dates[group.id];
    if (!decision?.confirmed || !weekdayFromDateOnly(decision.date) || (!draft.automatic && decision.date.slice(0, 4) !== draft.year)) errors.push(`Confirm the full date and year for ${group.label}.`);
  });
  const mappedShifts = [];
  document.shifts.forEach((shift) => {
    const mapping = draft.shifts[shift.key];
    if (!mapping?.confirmed || !Object.hasOwn(SHIFT_CONFIG, mapping.target)) errors.push(`Explicitly map and confirm Excel shift ${shift.label}.`);
    else mappedShifts.push(mapping.target);
  });
  if (new Set(mappedShifts).size !== mappedShifts.length) errors.push("Each of the three Excel shifts must map to a different configured shift; collapsing shift ownership is not supported.");
  const existingEntries = Object.values(planningWeeks).flatMap((week) => week.entries || []);
  const retainedReports = Object.values(planningWeeks).flatMap((week) => week.excelPlanImports || []);
  const sourceIdentities = [...existingEntries.map((entry) => entry.importSource), ...retainedReports.flatMap((report) => report.importedSources || [])].filter(Boolean);
  const cells = new Map(document.cells.map((cell) => [cell.id, cell]));
  for (const cell of document.cells) {
    cell.fragments.forEach((_, index) => {
      if (!draft.rows.some((row) => row.cellId === cell.id && row.sourceFragment === index)) errors.push("Every original source fragment must be included or explicitly excluded; source rows cannot disappear from review.");
    });
  }
  const seenIds = new Set();
  const rows = draft.rows.map((row, index) => {
    const originalCell = cells.get(row.cellId);
    const override = row.machineOverride ? Object.values(PRODUCTION_LINES).find((line) => Object.hasOwn(line.machines, row.machineOverride)) : null;
    const cell = originalCell && row.machineOverride ? { ...originalCell, machine: row.machineOverride, productionLine: override?.id || null } : originalCell;
    const rowErrors = [], result = { ...row, index, cell, errors: rowErrors, entry: null, target: null, existingCount: 0 };
    if (!cell) { rowErrors.push("Original source cell is missing."); return result; }
    if (row.sourceFragment !== -1 && (!Number.isInteger(row.sourceFragment) || !cell.fragments[row.sourceFragment])) rowErrors.push("Original source fragment is missing. Add a manually split run explicitly instead.");
    if (seenIds.has(row.id)) rowErrors.push("Duplicate review-row identity.");
    seenIds.add(row.id);
    if (!row.include) return result;
    if (row.machineOverride && (!originalCell.machine || !row.machineOverrideConfirmed)) rowErrors.push("Confirm the corrected machine; unsupported areas cannot be reassigned by this importer.");
    if (["OFF", "Changeover"].includes(row.kind) && !row.activityConfirmed) rowErrors.push("Confirm this non-production activity belongs to the assigned machine, date and shift; no production quantity or duration is inferred.");
    if (!cell.machine || !Object.hasOwn(PRODUCTION_LINES[cell.productionLine]?.machines || {}, cell.machine)) rowErrors.push("Unsupported machine/area. Keep it in the exclusion list; no production-line value will be invented.");
    if (!["Production", "OFF", "Changeover"].includes(row.kind)) rowErrors.push("Unresolved/remark rows need an explicit supported activity correction or an exclusion reason.");
    if (cell.fragments.some((fragment) => fragment.kind === 'Remark') && !row.notesConfirmed) rowErrors.push('Review the notes/conditions in this source cell explicitly. No timing, machine transfer or programming duration is inferred.');
    const fragment = cell.fragments[row.sourceFragment];
    if ((!fragment || fragment.kind !== row.kind) && !row.correctionNote.trim()) rowErrors.push("Explain the activity correction or manually added run.");
    const date = row.dateOverride || draft.dates[cell.dateGroupId]?.date;
    if (!weekdayFromDateOnly(date)) rowErrors.push("A valid production date is required.");
    if (row.dateOverride && !row.dateOverrideConfirmed) rowErrors.push("Confirm the corrected row date.");
    const shift = row.shiftOverride || draft.shifts[cell.shiftKey]?.target;
    if (!Object.hasOwn(SHIFT_CONFIG, shift || "")) rowErrors.push("Map this activity to a configured shift explicitly.");
    if ((row.shiftOverride || cell.daySpanning) && !row.shiftOverrideConfirmed) rowErrors.push("Confirm the row's shift assignment; day-spanning work must not be assigned automatically.");
    if (sourceIdentities.some((source) => source.documentHash === document.fingerprint && source.rowId === row.id && source.targetDate === date)) rowErrors.push("This source fragment was already imported for this date. Re-uploading cannot duplicate it, even after manual edits.");
    let quantity = 0, target;
    if (row.kind === "Production") {
      const mapping = draft.mappings[excelMappingKey(row, cell)] || defaultExcelMapping(row, cell, catalog);
      target = catalog.find((item) => item.machine === cell.machine && item.productionLine === cell.productionLine && item.planningCode === mapping.target);
      if (!target) rowErrors.push("Choose a valid full-stock-code mapping for this machine/product.");
      if (!mapping.reviewed || !["EA", "SET", "SHEET", "KG"].includes(mapping.sourceUnit) || !positive(mapping.factor)) rowErrors.push("Confirm quantity meaning/units and enter the reviewed conversion factor, including 1 for unchanged quantities.");
      if (target && ((!target.fullStockCodes.includes(normalize(row.productText)) && target.planningCode !== normalize(row.productText)) || mapping.sourceUnit !== target.targetUnit || Number(mapping.factor) !== 1) && !mapping.explanation.trim()) rowErrors.push("Explain the shorthand/code correction or unit conversion against the reviewed full stock codes.");
      if (!positive(row.quantity)) rowErrors.push("Production quantity must be a finite number greater than zero.");
      quantity = Number(row.quantity) * Number(mapping.factor);
      if (!Number.isFinite(quantity) || quantity <= 0) rowErrors.push("The converted quantity is invalid.");
      result.mapping = mapping;
      result.target = target || null;
    } else if (row.quantity !== "" && Number(row.quantity) !== 0) rowErrors.push("OFF/C/O are source activities, not quantity-bearing production runs. Split out production explicitly.");
    if (date && weekdayFromDateOnly(date) && shift && cell.machine) {
      result.entry = { productionLine: cell.productionLine, machine: cell.machine, day: date, weekday: weekdayFromDateOnly(date), weekStart: mondayOf(date), shift,
        status: row.kind === "Production" ? "Planned" : row.kind, activity: row.kind, partNumber: target?.planningCode || "", buildQty: row.kind === "Production" ? quantity : 0,
        originalPlanQty: row.kind === "Production" ? quantity : 0, quantityUom: target?.targetUnit || null };
      const occupied = existingEntries.filter((entry) => slotKey(entry) === slotKey(result.entry));
      result.existingCount = occupied.length;
      if (occupied.length && (row.kind === "OFF" || occupied.some((entry) => entry.status === "OFF"))) rowErrors.push("OFF conflicts with an occupied shift. Existing records will not be replaced or silently hidden.");
      else if (occupied.length && !row.appendConfirmed) rowErrors.push(`Confirm appending an independent activity while keeping all ${occupied.length} existing activities in this shift.`);
    }
    if (result.entry && occupiedDuplicate(existingEntries, result.entry) && !row.independentConfirmed) rowErrors.push("Likely duplicate: same machine, date, shift, product, activity and quantity already exist. Confirm this is an independent split run to keep both.");
    return result;
  });
  const included = rows.filter((row) => row.include && row.entry);
  included.forEach((row) => {
    const peers = included.filter((other) => other !== row && slotKey(other.entry) === slotKey(row.entry));
    if ((row.kind === "OFF" && peers.length) || peers.some((other) => other.kind === "OFF")) row.errors.push("OFF must be the only activity in its target shift.");
    if (row.target && peers.some((other) => other.target && other.target.fullStockCodes.some((code) => row.target.fullStockCodes.includes(code))) && !row.independentConfirmed) row.errors.push("Overlapping product/paired outputs share this shift. Confirm independent runs or exclude redundant paired output lines with a reason; quantities are never deduplicated arbitrarily.");
    if (row.target?.productionLine === 'blowMoulding' && peers.some((other) => other.target && other.cell.id === row.cell.id) && !row.independentConfirmed) row.errors.push('Multiple blow-moulding outputs share this source cell. Confirm independent runs and quantity basis, or skip counterpart outputs of the same mould set. Runs are never merged automatically.');
  });
  const readyRows = rows.filter((row) => row.include && row.entry && !row.errors.length);
  if (!readyRows.length) errors.push("Select and resolve at least one supported activity to add. Unresolved rows will be skipped.");
  const key = JSON.stringify({ fingerprint: document.fingerprint, draft, planningWeeks, bomConnected, catalog: catalog.map(({ machine, planningCode, fullStockCodes, targetUnit }) => ({ machine, planningCode, fullStockCodes, targetUnit })) });
  return { rows, errors: [...new Set(errors)], key, canImport: !errors.length && readyRows.length > 0, includedCount: readyRows.length, excludedCount: rows.length - readyRows.length, readyRows };
}

export function applyReviewedExcelPlan({ document, draft, expectedReviewKey, catalog, planningWeeks, bomConnected, userId, now = new Date().toISOString(), batchToken = crypto.randomUUID(), profileEvidence = null }) {
  const review = reviewExcelPlanImport({ document, draft, catalog, planningWeeks, bomConnected });
  if (!review.canImport) throw new Error("The Excel review still contains unresolved items or unconfirmed mappings. No planning records were changed.");
  if (review.key !== expectedReviewKey) throw new Error("Planning data or mappings changed after review. Review the exact additions again; nothing was imported.");
  const weeks = { ...planningWeeks }, added = [], batchId = `excel_batch_${batchToken}`;
  for (const row of review.readyRows) {
    const classification = row.cell.productionLine === "thermoforming" ? classifyThermoformingParent(row.entry.partNumber) : null;
    const entry = { ...row.entry, id: `excel_${batchToken}_${row.id}`, parentStockCode: row.cell.productionLine === "thermoforming" ? row.entry.partNumber : undefined,
      parentItemId: row.target?.parentItemId || undefined, productFamily: classification?.family, market: classification?.market,
      createdAt: now, updatedAt: now, createdByUserId: userId, updatedByUserId: userId,
      importSource: { batchId, profileId: profileEvidence?.id || null, profileRevision: profileEvidence?.revision || null, documentHash: document.fingerprint, fileName: document.fileName, sheetName: document.sheetName, sourceCell: row.cell.sourceCell, targetDate: row.entry.day, cellId: row.cell.id, rowId: row.id, sourceOrder: row.index,
        machine: row.cell.sourceMachine, printedDate: document.dateGroups.find((date) => date.id === row.cell.dateGroupId)?.label || "Unconfirmed", sourceShift: row.cell.sourceShift,
        cellText: row.cell.rawText, fragmentText: row.cell.fragments[row.sourceFragment]?.sourceText || "Manually split run", originalKind: row.cell.fragments[row.sourceFragment]?.kind || "Manually added",
        correctionNote: row.correctionNote, notesReviewed: Boolean(row.notesConfirmed), sourceProduct: row.productText, originalQuantity: row.cell.fragments[row.sourceFragment]?.quantity || "", sourceQuantity: row.quantity, fullStockCodes: row.target?.fullStockCodes || [],
        sourceUnit: row.mapping?.sourceUnit || null, targetUnit: row.target?.targetUnit || null, conversionFactor: row.mapping ? Number(row.mapping.factor) : null,
        mappingExplanation: row.mapping?.explanation || "", reviewedAt: now, reviewedByUserId: userId, sourceFileHash: document.fileFingerprint || null } };
    const current = weeks[entry.weekStart] || { weekStart: entry.weekStart, entries: [] };
    weeks[entry.weekStart] = { ...current, entries: [...(current.entries || []), entry] };
    added.push(entry);
  }
  const exclusions = review.rows.filter((row) => !row.include || row.errors.length).map((row) => ({ rowId: row.id, sourceCell: row.cell?.sourceCell, machine: row.cell?.sourceMachine, dateLabel: document.dateGroups.find((date) => date.id === row.cell?.dateGroupId)?.label || "Unconfirmed", shift: row.cell?.sourceShift, sourceText: row.cell?.rawText, fragmentText: row.cell?.fragments[row.sourceFragment]?.sourceText || "", reason: row.errors.length ? row.errors.join(" ") : row.excludedReason || "Not selected by the planner." }));
  const report = structuredClone({ id: batchId, fileName: document.fileName, documentHash: document.fingerprint, format: document.format, profile: profileEvidence,
    importedAt: now, reviewedByUserId: userId, importedSources: added.map((entry) => entry.importSource), addedEntryIds: added.map((entry) => entry.id), filenameDiscrepancy: document.filenameDiscrepancy,
    dates: draft.dates, shifts: draft.shifts, mappings: draft.mappings, sourceCells: document.cells, exclusions });
  for (const weekStart of new Set(added.map((entry) => entry.weekStart))) {
    const current = weeks[weekStart];
    if (current.excelPlanImports != null && !Array.isArray(current.excelPlanImports)) throw new Error("Existing Excel source reports are unreadable. Nothing was imported.");
    weeks[weekStart] = { ...current, excelPlanImports: [...(current.excelPlanImports || []), report] };
  }
  return { planningWeeks: weeks, added, exclusions, report };
}

function occupiedDuplicate(entries, proposed) {
  return entries.some((entry) => slotKey(entry) === slotKey(proposed) && entry.partNumber === proposed.partNumber && entry.status === proposed.status && Number(entry.originalPlanQty ?? entry.buildQty) === Number(proposed.originalPlanQty));
}

// Append the prepared batch to the latest state, preserving changes made elsewhere
// during the storage write. Identity checks make the commit safe to retry.
export function mergeExcelPlanResult(planningWeeks, result) {
  const weeks = { ...planningWeeks };
  for (const entry of result.added) {
    const week = weeks[entry.weekStart] || { weekStart: entry.weekStart, entries: [] };
    weeks[entry.weekStart] = { ...week, entries: (week.entries || []).some((item) => item.id === entry.id) ? week.entries : [...(week.entries || []), entry] };
  }
  for (const key of new Set(result.added.map((entry) => entry.weekStart))) {
    const week = weeks[key], reports = week.excelPlanImports || [];
    weeks[key] = { ...week, excelPlanImports: reports.some((report) => report.id === result.report.id) ? reports : [...reports, result.report] };
  }
  return weeks;
}
