const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('../mrp-planner/node_modules/xlsx');
const sample = fs.readFileSync(path.join(__dirname, 'fixtures/Production_Plan_Converted.xlsx'));
let parser, layout, importer, document;
const boms = ['N1WB-E12606-SCP', 'N1WB-P13036-D', 'N1WB-E13036-N', 'N1WB-16450-CAA', 'N1WB-16451-CAA']
  .map((parentStockCode) => ({ parentStockCode, componentStockCode: 'TEST-RAW', qtyPer: 1 }));
test.before(async () => {
  parser = await import('../mrp-planner/src/planning/readPlanExcel.js');
  layout = await import('../mrp-planner/src/planning/excelPlanLayout.js');
  importer = await import('../mrp-planner/src/planning/excelPlanReview.js');
  document = await parser.readPlanExcel(new File([sample], 'Production_Plan_Converted.xlsx'));
});
function configured() {
  const draft = importer.createExcelPlanDraft(document);
  Object.assign(draft, { year: '2026', yearConfirmed: true, filenameReviewed: true, sourceReviewed: true, nightDateReviewed: true });
  document.dateGroups.forEach((group) => { draft.dates[group.id] = { date: `2026-11-${group.day}`, confirmed: true }; });
  document.shifts.forEach((shift, index) => { draft.shifts[shift.key] = { target: `SHIFT 0${index + 1}`, confirmed: true }; });
  const input = { document, draft, catalog: importer.planningExcelCatalog([], boms), planningWeeks: {}, bomConnected: true };
  select(input, 'B7:f0', 'N1WB-E12606-SCP');
  return input;
}
function select(input, id, target, unit = 'EA') {
  const row = input.draft.rows.find((row) => row.id === id);
  assert.ok(row, id);
  row.include = true;
  if (target) input.draft.mappings[importer.excelMappingKey(row, document.cells.find((cell) => cell.id === row.cellId))] = { target, sourceUnit: unit, factor: '1', reviewed: true, explanation: 'Explicit test mapping and quantity basis; not approval of the live sample.' };
  return row;
}
const review = (input) => importer.reviewExcelPlanImport(input);
const apply = (input) => importer.applyReviewedExcelPlan({ ...input, expectedReviewKey: review(input).key, userId: 'TEST-PLANNER', batchToken: 'TEST-BATCH' });

test('actual workbook layout: only Production Plan supplies 97 cells / 115 ordered fragments', () => {
  assert.equal(document.cells.length, 97);
  assert.equal(document.cells.reduce((sum, cell) => sum + cell.fragments.length, 0), 115);
  assert.match(document.referenceSheet, /reference only/);
  assert.deepEqual(document.dateGroups.map((group) => [group.id, group.day, group.month, group.year]), [['B4', 11, 11, ''], ['E4', 12, 11, ''], ['H4', 13, 11, '']]);
  assert.deepEqual([...new Set(document.cells.filter((cell) => cell.machine).map((cell) => cell.sourceMachine))], ['AR1', 'AR2', 'AR4', 'AR5', 'AR3', 'BM1', 'BM2', 'BM3', 'BM4']);
  assert.equal(document.cells.find((cell) => cell.id === 'B11').machine, 'BM01');
  assert.ok(document.notes.some((note) => note.includes('11 Oct 2026')));
});

test('multi-run cells, inline C/O, quantities and annotations keep source order', () => {
  const cell = (id) => document.cells.find((cell) => cell.id === id);
  assert.deepEqual(cell('B10').fragments.map((row) => [row.kind, row.quantity, row.productText]), [['Production', '20', 'SGL RH'], ['Changeover', '', ''], ['Production', '10', 'DBL RH'], ['Changeover', '', '']]);
  assert.deepEqual(cell('I9').fragments.map((row) => [row.kind, row.quantity]), [['Changeover', ''], ['Production', '24']]);
  assert.deepEqual(cell('C13').fragments.map((row) => row.quantity), ['53', '53', '19']);
  assert.equal(cell('C11').fragments[2].sourceText, '(KA)');
  assert.equal(cell('B15').sourceCell, 'Production Plan!B15:D15');
  assert.equal(cell('B15').shiftKey, '');
  assert.equal(cell('B15').daySpanning, true);
  assert.match(cell('A20').rawText, /CANCEL SHIFTS/);
});

test('initial preview infers neither a year nor quantity units and selects nothing', () => {
  const draft = importer.createExcelPlanDraft(document);
  assert.equal(draft.year, '');
  assert.equal(draft.yearConfirmed, false);
  assert.ok(draft.rows.every((row) => !row.include));
  assert.ok(Object.values(draft.dates).every((date) => !date.date && !date.confirmed));
  assert.equal(review({ ...configured(), draft }).canImport, false);
});

test('year, valid full dates and each mismatched shift require explicit confirmation', async () => {
  const input = configured();
  assert.equal(review(input).canImport, true);
  input.draft.yearConfirmed = false;
  assert.equal(review(input).canImport, false);
  input.draft.yearConfirmed = true;
  input.draft.dates.B4 = { date: '2026-02-30', confirmed: true };
  assert.equal(review(input).canImport, false);
  input.draft.dates.B4 = { date: '2026-11-11', confirmed: true };
  input.draft.shifts['14:00-22:23'].target = 'SHIFT 01';
  assert.match(review(input).errors.join(' '), /different configured shift/);
  const { SHIFT_CONFIG } = await import('../mrp-planner/src/planning/shiftConfig.js');
  assert.equal(SHIFT_CONFIG['SHIFT 01'].end, '15:00');
  assert.equal(SHIFT_CONFIG['SHIFT 02'].end, '22:00');
});

test('SCP and CAA stay unresolved until full codes and quantity basis are reviewed', () => {
  const input = configured();
  const shorthand = select(input, 'J9:f0');
  assert.ok(review(input).rows.find((row) => row.id === shorthand.id).errors.some((error) => error.includes('full-stock-code')));
  select(input, 'J9:f0', 'N1WB-E12606-SCP');
  const caa = select(input, 'B12:f0', 'N1WB_CAA_PAIR', 'SET');
  let result = apply(input);
  assert.equal(result.added.length, 3);
  assert.equal(result.added.find((entry) => entry.machine === 'BM02').quantityUom, 'SET');
  input.draft.mappings[importer.excelMappingKey(caa, document.cells.find((cell) => cell.id === caa.cellId))].reviewed = false;
  result = apply(input);
  assert.equal(result.added.length, 2);
  assert.match(result.exclusions.find((row) => row.rowId === caa.id).reason, /quantity meaning\/units/);
});

test('unresolved selected rows are skipped with reasons; valid selected rows alone import', () => {
  const input = configured();
  select(input, 'C7:f0', 'N1WB-E12606-SCP').quantity = '0';
  const before = JSON.stringify(input);
  const result = apply(input);
  assert.equal(result.added.length, 1);
  assert.equal(result.exclusions.length, 114);
  assert.match(result.exclusions.find((row) => row.rowId === 'C7:f0').reason, /greater than zero/);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.added[0].importSource.sourceCell, 'Production Plan!B7');
});

test('OFF and C/O require activity confirmation; unsupported areas, blanks and remarks never become production', () => {
  const input = configured();
  const off = select(input, 'D6:f0'), change = select(input, 'C6:f0'), bracket = select(input, 'B15:f0');
  assert.equal(apply(input).added.length, 1);
  off.activityConfirmed = true; change.activityConfirmed = true;
  const result = apply(input);
  assert.deepEqual(result.added.map((entry) => entry.status), ['Changeover', 'OFF', 'Planned']);
  assert.ok(result.added.filter((entry) => entry.status !== 'Planned').every((entry) => entry.buildQty === 0 && !entry.startTime));
  assert.match(result.exclusions.find((row) => row.rowId === bracket.id).reason, /Unsupported machine/);
  assert.ok(result.exclusions.some((row) => row.sourceCell === 'Production Plan!A20'));
  assert.ok(result.report.sourceCells.some((cell) => cell.sourceMachine === 'OFF-LINE FCSD' && !cell.rawText));
});

test('appending preserves all existing weeks, IDs, legacy reports and records linked to plans', () => {
  const input = configured();
  const existing = { id: 'KEEP', productionLine: 'thermoforming', machine: 'AR2', day: '2026-11-11', shift: 'SHIFT 01', status: 'Planned', partNumber: 'N1WB-E12606-SCP', buildQty: 5 };
  input.planningWeeks = { '2026-11-09': { weekStart: '2026-11-09', entries: [existing], pdfPlanImports: [{ id: 'legacy' }] }, '2026-11-16': { entries: [{ id: 'OTHER' }] } };
  const row = input.draft.rows.find((row) => row.include);
  assert.equal(review(input).canImport, false);
  row.appendConfirmed = true;
  const result = apply(input);
  assert.strictEqual(result.planningWeeks['2026-11-09'].entries[0], existing);
  assert.strictEqual(result.planningWeeks['2026-11-16'], input.planningWeeks['2026-11-16']);
  assert.deepEqual(result.planningWeeks['2026-11-09'].pdfPlanImports, [{ id: 'legacy' }]);
  assert.equal(result.report.addedEntryIds.length, 1);
  assert.deepEqual(importer.mergeExcelPlanResult(result.planningWeeks, result), result.planningWeeks);
});

test('likely duplicates require independent-run confirmation without merging split runs', () => {
  const input = configured();
  input.planningWeeks = { '2026-11-09': { entries: [{ id: 'SPLIT', productionLine: 'thermoforming', machine: 'AR2', day: '2026-11-11', shift: 'SHIFT 01', status: 'Planned', partNumber: 'N1WB-E12606-SCP', buildQty: 56 }] } };
  const row = input.draft.rows.find((row) => row.include); row.appendConfirmed = true;
  assert.match(review(input).rows.find((row) => row.include).errors.join(' '), /Likely duplicate/);
  row.independentConfirmed = true;
  const result = apply(input);
  assert.equal(result.planningWeeks['2026-11-09'].entries.length, 2);
  assert.equal(result.planningWeeks['2026-11-09'].entries[0].buildQty, 56);
  assert.equal(result.planningWeeks['2026-11-09'].entries[1].buildQty, 56);
});

test('re-upload blocks each imported fragment but permits an unimported fragment from the same cell', () => {
  const input = configured();
  select(input, 'B10:f0', 'N1WB-P13036-D');
  const first = apply(input);
  input.planningWeeks = first.planningWeeks;
  input.draft.rows.filter((row) => row.include).forEach((row) => { row.appendConfirmed = true; row.independentConfirmed = true; });
  select(input, 'B10:f2', 'N1WB-E13036-N').appendConfirmed = true;
  const second = apply(input);
  assert.equal(second.added.length, 1);
  assert.equal(second.added[0].partNumber, 'N1WB-E13036-N');
  assert.match(second.exclusions.find((row) => row.rowId === 'B10:f0').reason, /already imported/);
  // Manual edits/deletion do not erase the retained import identity.
  input.planningWeeks['2026-11-09'].entries = [];
  assert.match(review(input).rows.find((row) => row.id === 'B7:f0').errors.join(' '), /already imported/);
});

test('multiple blow-moulding outputs require independent-run review even when no pair mapping exists', () => {
  const input = configured();
  const codes = ['N1WZ-16450-H', 'N1WZ-16451-H'];
  input.catalog = importer.planningExcelCatalog([], [...boms, ...codes.map((parentStockCode) => ({ parentStockCode }))]);
  const first = select(input, 'C11:f0', codes[0]);
  const second = select(input, 'C11:f1', codes[1]);
  first.notesConfirmed = true; second.notesConfirmed = true;
  assert.equal(apply(input).added.length, 1);
  assert.match(review(input).rows.find((row) => row.id === first.id).errors.join(' '), /Multiple blow-moulding outputs/);
  first.independentConfirmed = true; second.independentConfirmed = true;
  const result = apply(input);
  assert.deepEqual(result.added.filter((entry) => entry.machine === 'BM01').map((entry) => [entry.partNumber, entry.buildQty]), [[codes[0], 40], [codes[1], 40]]);
});

test('correction confirmations preserve original source evidence and stale reviews cannot save', () => {
  const input = configured(), key = review(input).key, row = input.draft.rows.find((row) => row.include);
  row.quantity = '57';
  assert.throws(() => importer.applyReviewedExcelPlan({ ...input, expectedReviewKey: key }), /changed after review/);
  row.dateOverride = '2026-11-18'; row.shiftOverride = 'SHIFT 03'; row.machineOverride = 'AR5';
  assert.equal(review(input).canImport, false);
  row.dateOverrideConfirmed = true; row.shiftOverrideConfirmed = true; row.machineOverrideConfirmed = true;
  select(input, row.id, 'N1WB-E12606-SCP');
  const entry = apply(input).added[0];
  assert.equal(entry.machine, 'AR5'); assert.equal(entry.day, '2026-11-18'); assert.equal(entry.shift, 'SHIFT 03');
  assert.equal(entry.importSource.sourceCell, 'Production Plan!B7'); assert.equal(entry.importSource.machine, 'AR2');
});

test('renaming or changing Cell Review does not bypass schedule repeat detection', async () => {
  const workbook = XLSX.read(sample, { type: 'buffer' });
  workbook.Sheets['Cell Review'].F6.v = 'Reference correction is not a schedule edit';
  const changed = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const parsed = await parser.readPlanExcel(new File([changed], 'renamed.xlsx'));
  assert.equal(parsed.fingerprint, document.fingerprint);
  assert.notEqual(parsed.fileFingerprint, document.fileFingerprint);
});

test('unsupported files, corrupt containers and unsupported layouts fail clearly', async () => {
  await assert.rejects(parser.readPlanExcel(new File([sample], 'plan.pdf')), /\.xlsx/);
  await assert.rejects(parser.readPlanExcel(new File([], 'empty.xlsx')), /non-empty/);
  await assert.rejects(parser.readPlanExcel(new File(['bad file'], 'fake.xlsx')), /not a readable/);
  await assert.rejects(parser.readPlanExcel(new File([new Uint8Array([80, 75, 3, 4, 0])], 'broken.xlsx')), /damaged|unsupported/);
  for (const mutate of [
    (book) => { delete book.Sheets['Production Plan']; },
    (book) => { book.Sheets['Production Plan']['!merges'] = []; },
    (book) => { book.Sheets['Production Plan'].B5.v = 'Shift unknown'; },
    (book) => { book.Sheets['Production Plan'].B7.f = 'SUM(1,2)'; },
    (book) => { book.Sheets['Production Plan'].A7.v = ''; },
  ]) {
    const book = XLSX.read(sample, { type: 'buffer' }); mutate(book);
    assert.throws(() => layout.extractProductionPlanWorkbook(book), /Unsupported Excel layout/);
  }
});

test('a review cannot silently drop original fragments and disconnected BOM prevents import', () => {
  const input = configured(); input.draft.rows.pop();
  assert.match(review(input).errors.join(' '), /Every original source fragment/);
  assert.equal(review(configured()).canImport, true);
  assert.equal(review({ ...configured(), bomConnected: false }).canImport, false);
});
