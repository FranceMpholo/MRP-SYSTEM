const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('../mrp-planner/node_modules/xlsx');
const sample = fs.readFileSync(path.join(__dirname, 'fixtures/Production plan 17 Nov 2026 Rev2.xlsx'));
let parser, layout, importer, document;
const codes = ['N1WB-J12606-SAH', 'R1WB-E12606-AF', 'N1WB-E12606-SAJ', 'N1WB-E13036-K', 'N1WB-E13036-N', 'N1WB-16450-CAA', 'N1WB-16451-CAA'];
const boms = codes.map((parentStockCode) => ({ parentStockCode }));
test.before(async () => {
  parser = await import('../mrp-planner/src/planning/readPlanExcel.js');
  layout = await import('../mrp-planner/src/planning/excelPlanLayout.js');
  importer = await import('../mrp-planner/src/planning/excelPlanReview.js');
  document = await parser.readPlanExcel(new File([sample], 'Production plan 17 Nov 2026 Rev2.xlsx'));
});
function configured() {
  const draft = importer.createExcelPlanDraft(document);
  Object.assign(draft, { year: '2026', yearConfirmed: true, filenameReviewed: true, sourceReviewed: true, nightDateReviewed: true });
  document.dateGroups.forEach((group) => { draft.dates[group.id] = { date: `2026-11-${group.day}`, confirmed: true }; });
  document.shifts.forEach((shift, index) => { draft.shifts[shift.key] = { target: `SHIFT 0${index + 1}`, confirmed: true }; });
  const input = { document, draft, catalog: importer.planningExcelCatalog([], boms), bomConnected: true,
    planningWeeks: { '2026-11-16': { entries: [{ id: 'DO-NOT-CHANGE', machine: 'BM01', day: '2026-11-17', shift: 'SHIFT 01', buildQty: 5 }] } } };
  return input;
}
function select(input, id, target, sourceUnit = 'EA') {
  const row = input.draft.rows.find((row) => row.id === id); row.include = true;
  if (target) input.draft.mappings[importer.excelMappingKey(row, document.cells.find((cell) => cell.id === row.cellId))] = { target, sourceUnit, factor: '1', reviewed: true, explanation: 'Synthetic preview test only; real quantity units still require planner review.' };
  return row;
}
const review = (input) => importer.reviewExcelPlanImport(input);

test('actual Rev2 layout recognizes Table 1, separate weekday/date merges, four days and column-A machine order', () => {
  assert.equal(document.sheetName, 'Table 1');
  assert.deepEqual(document.dateGroups.map((group) => [group.id, group.weekday, group.day, group.month, group.year]), [
    ['B2', 'Tuesday', 17, 11, ''], ['E2', 'Wednesday', 18, 11, ''], ['H2', 'Thursday', 19, 11, ''], ['K2', 'Friday', 20, 11, ''],
  ]);
  assert.equal(document.cells.length, 108);
  assert.equal(document.cells.flatMap((cell) => cell.fragments).length, 125);
  assert.deepEqual(document.shifts.map((shift) => shift.key), ['06:00-14:23', '14:00-22:23', '22:00-06:23']);
  assert.deepEqual([...new Set(document.cells.map((cell) => cell.sourceMachine))], ['AR1', 'AR2', 'AR4', 'AR5', 'AR3', 'BM1', 'BM2', 'BM3', 'BM4']);
});

test('AR1 18 November Shift 2 preserves 10 SAH, changeover, 30 AF in source order', () => {
  const cell = document.cells.find((cell) => cell.id === 'F4');
  assert.equal(cell.sourceCell, 'Table 1!F4');
  assert.equal(cell.machine, 'AR1'); assert.equal(cell.dateGroupId, 'E2'); assert.equal(cell.shiftKey, '14:00-22:23');
  assert.deepEqual(cell.fragments.map((fragment) => [fragment.kind, fragment.quantity, fragment.productText]), [
    ['Production', '10', 'N1WB-J12606-SAH'], ['Changeover', '', ''], ['Production', '30', 'R1WB-E12606-AF'],
  ]);
  const input = configured(), before = structuredClone(input.planningWeeks);
  select(input, 'F4:f0', codes[0]); select(input, 'F4:f1').activityConfirmed = true; select(input, 'F4:f2', codes[1]);
  const result = review(input);
  assert.equal(result.canImport, true);
  assert.deepEqual(result.readyRows.map((row) => [row.entry.machine, row.entry.day, row.entry.shift, row.entry.buildQty]), [
    ['AR1', '2026-11-18', 'SHIFT 02', 10], ['AR1', '2026-11-18', 'SHIFT 02', 0], ['AR1', '2026-11-18', 'SHIFT 02', 30],
  ]);
  assert.deepEqual(input.planningWeeks, before, 'preview does not add any entries');
});

test('Rev2 still requires explicit year, full dates, shift mapping and uncertain unit review', () => {
  const draft = importer.createExcelPlanDraft(document);
  assert.equal(draft.year, '', '2026 in the filename is not an approved year');
  assert.ok(draft.rows.every((row) => !row.include));
  const input = configured(); select(input, 'F4:f0', codes[0]);
  input.draft.yearConfirmed = false; assert.equal(review(input).canImport, false);
  input.draft.yearConfirmed = true; input.draft.shifts['14:00-22:23'].confirmed = false;
  assert.equal(review(input).canImport, false);
  input.draft.shifts['14:00-22:23'].confirmed = true;
  input.draft.mappings['AR1|N1WB-J12606-SAH'].sourceUnit = '';
  assert.match(review(input).rows.find((row) => row.id === 'F4:f0').errors.join(' '), /quantity meaning\/units/);
});

test('notes, conditional work and programming stay ordered and require acknowledgement', () => {
  const conditional = document.cells.find((cell) => cell.id === 'B6');
  const programming = document.cells.find((cell) => cell.id === 'C6');
  assert.deepEqual(conditional.fragments.map((fragment) => fragment.sourceText), ['56 N1WB-E12606-SAJ', 'till AR#1']);
  assert.deepEqual(programming.fragments.map((fragment) => fragment.sourceText), ['C/O', 'and programming']);
  const input = configured();
  const production = select(input, 'B6:f0', 'N1WB-E12606-SAJ'), change = select(input, 'C6:f0'); change.activityConfirmed = true;
  assert.equal(review(input).readyRows.length, 0);
  assert.match(review(input).rows.find((row) => row.id === production.id).errors.join(' '), /notes\/conditions/);
  production.notesConfirmed = true; change.notesConfirmed = true;
  const result = review(input); assert.equal(result.readyRows.length, 2);
  assert.equal(result.rows.find((row) => row.id === 'B6:f1').kind, 'Remark');
  assert.equal(result.rows.find((row) => row.id === 'C6:f1').include, false);
});

test('Rev2 shorthand remains unresolved until full codes and units are confirmed', () => {
  const input = configured(); select(input, 'B8:f0'); select(input, 'B10:f0');
  assert.equal(review(input).readyRows.length, 0);
  select(input, 'B8:f0', 'N1WB-E13036-K'); select(input, 'B10:f0', 'N1WB_CAA_PAIR', 'SET');
  assert.equal(review(input).readyRows.length, 2);
  assert.equal(review(input).readyRows.find((row) => row.id === 'B10:f0').entry.quantityUom, 'SET');
});

test('layout recognition supports variable day counts without relying on the sheet name', () => {
  for (const dayCount of [1, 2, 5, 7, 14]) {
    const rows = [[], [], [], ['AR1']], merges = [];
    for (let index = 0; index < dayCount; index++) {
      const col = 1 + index * 3, day = 17 + index;
      rows[0][col] = new Date(`2026-11-${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      rows[1][col] = `${day}-Nov`;
      ['06:00 - 14:23', '14:00 - 22:23', '22:00 - 06:23'].forEach((shift, offset) => { rows[2][col + offset] = shift; rows[3][col + offset] = '1 N1WB-J12606-SAH'; });
      for (const r of [0, 1]) merges.push({ s: { r, c: col }, e: { r, c: col + 2 } });
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows); sheet['!merges'] = merges;
    const parsed = layout.extractProductionPlanWorkbook({ SheetNames: ['Schedule', 'Cell Review'], Sheets: { Schedule: sheet, 'Cell Review': sheet } });
    assert.equal(parsed.dateGroups.length, dayCount);
    assert.equal(parsed.cells.length, dayCount * 3);
    assert.equal(parsed.sheetName, 'Schedule');
  }
});

test('ambiguous sheets, inconsistent repeats and missing weekday merges fail clearly', () => {
  for (const change of [
    (book) => { book.SheetNames.push('Another schedule'); book.Sheets['Another schedule'] = book.Sheets['Table 1']; },
    (book) => { book.Sheets['Table 1'].F3.v = '06:00 - 14:23'; },
    (book) => { book.Sheets['Table 1']['!merges'] = book.Sheets['Table 1']['!merges'].filter((merge) => !(merge.s.r === 0 && merge.s.c === 4)); },
    (book) => { book.Sheets['Table 1'].A5.v = 'AR1'; },
  ]) {
    const book = XLSX.read(sample, { type: 'buffer' }); change(book);
    assert.throws(() => layout.extractProductionPlanWorkbook(book), /Unsupported Excel layout/);
  }
});
