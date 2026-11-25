const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/planningProfileFixture.cjs');
let profileApi, importer, reader, document, catalog;
test.before(async () => {
  profileApi = await import('../mrp-planner/src/planning/excelImportProfile.js');
  importer = await import('../mrp-planner/src/planning/excelPlanReview.js');
  reader = await import('../mrp-planner/src/planning/readPlanExcel.js');
  document = await reader.readPlanExcel(new File([fixture.bytes], fixture.sampleName));
  catalog = importer.planningExcelCatalog(fixture.items, fixture.boms);
});
const prepare = (input) => profileApi.prepareExcelPlanReview({ catalog, bomConnected: true, planningWeeks: {}, ...input });
function setup(doc = document) { return { document: doc, draft: profileApi.createAutomaticExcelDraft(doc), profile: profileApi.emptyExcelProfile(doc) }; }
function approved(doc = document) {
  const input = setup(doc);
  input.profile = profileApi.approveExcelShifts(input.profile, Object.fromEntries(doc.shifts.map((shift, index) => [shift.key, `SHIFT 0${index + 1}`])), 'start-date');
  for (let attempt = 0; attempt < 12; attempt++) {
    const plan = prepare(input);
    if (!plan.pendingCount) break;
    for (const question of plan.questions.codes) input.profile = profileApi.approveExcelCode(input.profile, question, ...fixture.codeChoice(question), catalog);
    for (const question of plan.questions.quantities) input.profile = profileApi.approveExcelQuantity(input.profile, question, question.targetUnit, '1', `line:${question.productionLine}`);
  }
  input.draft.rows.forEach((row) => { row.independentConfirmed = true; row.appendConfirmed = true; });
  return input;
}

test('original Rev2 dates resolve automatically only when filename year and every weekday agree', () => {
  const plan = prepare(setup());
  assert.equal(plan.dateResolution.issue, '');
  assert.equal(plan.dateResolution.dates.E2, '2026-11-18');
  assert.match(plan.dateResolution.evidence, /Filename year 2026/);
  assert.equal(plan.questions.codes.length, 5);
  assert.ok(plan.questions.codes.every((question) => !question.token.includes('-')));
  assert.ok(plan.exceptions.length < 10, 'mapping questions must not be repeated as exceptions on every row');
});

test('one approval applies to every matching row and machine-scoped shorthand stays distinct', () => {
  const input = approved(), plan = prepare(input);
  assert.equal(plan.pendingCount, 0); assert.equal(plan.canImport, true); assert.equal(plan.review.readyRows.length, 123);
  assert.equal(plan.review.rows.find((row) => row.id === 'C9:f0').entry.partNumber, 'N1WB_BAA_PAIR');
  assert.equal(plan.review.rows.find((row) => row.id === 'B11:f0').entry.partNumber, 'N1XB_BAA_PAIR');
  assert.ok(plan.review.rows.filter((row) => ['BM02', 'BM04'].includes(row.cell.machine)).every((row) => row.entry.partNumber === 'N1WB_CAA_PAIR'));
  assert.ok(input.profile.codeMappings['machine:BM01|BAA']); assert.ok(input.profile.codeMappings['machine:BM03|BAA']);
  assert.equal(Object.keys(input.profile.quantityRules).length, 3);
});

test('a second workbook reuses persisted approvals without asking year, shift, shorthand or unit questions', async () => {
  const first = approved(), savedProfile = JSON.parse(JSON.stringify(first.profile));
  const second = await reader.readPlanExcel(new File([fixture.nextWorkbook()], 'Production plan 24 Nov 2026 Rev2.xlsx'));
  const plan = prepare({ ...setup(second), profile: savedProfile });
  assert.equal(plan.dateResolution.issue, ''); assert.equal(plan.dateResolution.dates.B2, '2026-11-24');
  assert.equal(plan.pendingCount, 0); assert.equal(plan.questions.codes.length, 0); assert.equal(plan.questions.quantities.length, 0);
  assert.deepEqual(plan.questions.shifts, []); assert.equal(plan.questions.overnight, false);
  assert.equal(plan.review.readyRows.filter((row) => row.cell.id === 'F4').length, 3);
});

test('full Excel dates take precedence over the filename year and remain usable without a year question', async () => {
  const full = await reader.readPlanExcel(new File([fixture.nextWorkbook({ fullDates: true })], 'old filename 2025.xlsx'));
  const plan = prepare({ ...setup(full), profile: approved().profile });
  assert.equal(full.dateGroups[0].year, '2026'); assert.equal(plan.dateResolution.dates.B2, '2026-11-24');
  assert.equal(plan.dateResolution.issue, ''); assert.equal(plan.pendingCount, 0);
  assert.match(plan.dateResolution.evidence, /Full dates printed/);
});

test('date conflicts and uncertain years are single workbook decisions; corrected dates clear the conflict', async () => {
  const conflict = await reader.readPlanExcel(new File([fixture.bytes], 'Production plan 17 Nov 2025 Rev2.xlsx'));
  const input = { ...setup(conflict), profile: approved().profile };
  let plan = prepare(input);
  assert.match(plan.dateResolution.issue, /Date conflict/); assert.equal(plan.canImport, false); assert.equal(plan.pendingCount, 0);
  assert.ok(plan.exceptions.every((row) => row.errors.every((error) => !error.startsWith('A valid production date'))));
  input.draft.dateDecision = { confirmed: true, dates: profileApi.datesForYear(conflict, '2026') };
  plan = prepare(input); assert.equal(plan.dateResolution.issue, '');
  const uncertain = { ...document, fileName: 'weekly plan.xlsx' };
  assert.match(prepare({ ...setup(uncertain), profile: approved().profile }).dateResolution.issue, /year is uncertain/);
});

test('unknown shorthand is grouped once and never silently assigned from prior approvals', async () => {
  const unknown = await reader.readPlanExcel(new File([fixture.nextWorkbook({ unknown: true })], 'Production plan 24 Nov 2026 Rev2.xlsx'));
  const input = { ...setup(unknown), profile: approved().profile };
  let plan = prepare(input);
  assert.equal(plan.questions.codes.length, 1); assert.equal(plan.questions.codes[0].token, 'NEWCODE'); assert.equal(plan.questions.codes[0].rowIds.length, 2);
  assert.equal(plan.canImport, false);
  input.profile = profileApi.approveExcelCode(input.profile, plan.questions.codes[0], 'N1WB-E12606-SCP', 'machine:AR2', catalog);
  plan = prepare(input); assert.equal(plan.pendingCount, 0);
  assert.ok(['B5:f0', 'C5:f0'].every((id) => plan.review.readyRows.find((row) => row.id === id)?.entry.partNumber === 'N1WB-E12606-SCP'));
});

test('changed shift approvals and changed stock units require new decisions only for affected mappings', () => {
  const input = approved();
  input.profile.shifts['14:00-22:23'].targetSignature = 'changed configuration';
  let plan = prepare(input); assert.deepEqual(plan.questions.shifts.map((shift) => shift.key), ['14:00-22:23']);
  input.profile = approved().profile;
  const changedCatalog = catalog.map((item) => item.planningCode === 'N1WB-J12606-SAH' ? { ...item, stockUom: 'KG' } : item);
  plan = prepare({ ...input, catalog: changedCatalog });
  assert.equal(plan.questions.quantities.length, 1); assert.match(plan.questions.quantities[0].key, /EA\|KG/);
  const aliasChanged = catalog.map((item) => item.planningCode === 'N1WB-E13036-K' ? { ...item, stockUom: 'KG' } : item);
  plan = prepare({ ...input, catalog: aliasChanged });
  assert.equal(plan.questions.codes.length, 1); assert.equal(plan.questions.codes[0].changed, true); assert.equal(plan.questions.codes[0].token, 'DBL LH');
});

test('current BOM stock units override saved item units when deciding whether a quantity approval still matches', () => {
  const input = approved();
  const changedBoms = fixture.boms.map((row) => row.parentStockCode === 'N1WB-J12606-SAH' ? { ...row, parentUom: 'KG' } : row);
  const currentCatalog = importer.planningExcelCatalog(fixture.items, changedBoms);
  assert.equal(currentCatalog.find((item) => item.planningCode === 'N1WB-J12606-SAH').stockUom, 'KG');
  const plan = prepare({ ...input, catalog: currentCatalog });
  assert.equal(plan.questions.quantities.length, 1); assert.match(plan.questions.quantities[0].token, /KG/);
});

test('end-date overnight rule shifts only overnight work to the previous start date', () => {
  const input = approved(); input.profile.overnightRule = 'end-date';
  const plan = prepare(input);
  assert.equal(plan.review.readyRows.find((row) => row.id === 'D4:f0').entry.day, '2026-11-16');
  assert.equal(plan.review.readyRows.find((row) => row.id === 'F4:f0').entry.day, '2026-11-18');
});

test('quantity conversions apply once across the approved scope without changing source quantities', () => {
  const input = approved(); delete input.profile.quantityRules['line:thermoforming|EA|EA'];
  const question = prepare(input).questions.quantities[0];
  input.profile = profileApi.approveExcelQuantity(input.profile, question, 'SHEET', '2', 'line:thermoforming');
  const plan = prepare(input);
  assert.deepEqual(plan.review.readyRows.filter((row) => row.cell.id === 'F4').map((row) => [row.kind, row.entry.buildQty]), [['Production', 20], ['Changeover', 0], ['Production', 60]]);
  assert.equal(input.draft.rows.find((row) => row.id === 'F4:f0').quantity, '10');
});

test('valid full stock codes including paired members read directly and remain distinct from shorthand', () => {
  const input = approved(), row = input.draft.rows.find((row) => row.id === 'B10:f0'); row.productText = 'N1WB-16450-CAA';
  const plan = prepare(input);
  assert.equal(plan.pendingCount, 0); assert.equal(plan.review.readyRows.find((candidate) => candidate.id === row.id).entry.partNumber, 'N1WB-16450-CAA');
  assert.equal(plan.review.readyRows.find((row) => row.id === 'B12:f0').entry.partNumber, 'N1WB_CAA_PAIR');
});

test('notes remain visible, OFF and C/O stay distinct, and split runs keep source order', () => {
  const input = approved(), plan = prepare(input);
  assert.deepEqual(plan.review.readyRows.filter((row) => row.cell.id === 'F4').map((row) => [row.kind, row.entry.partNumber, row.entry.buildQty]), [['Production', 'N1WB-J12606-SAH', 10], ['Changeover', '', 0], ['Production', 'R1WB-E12606-AF', 30]]);
  assert.deepEqual(plan.notes.map((row) => row.cell.fragments[row.sourceFragment].sourceText), ['till AR#1', 'and programming']);
  assert.equal(plan.review.readyRows.filter((row) => row.kind === 'OFF').length, 28);
  assert.equal(plan.review.readyRows.filter((row) => row.kind === 'Changeover').length, 10);
});

test('repeat upload skips imported fragments after manual edits; the next week stays importable', async () => {
  const input = approved(), first = prepare(input);
  const result = importer.applyReviewedExcelPlan({ document, draft: first.draft, expectedReviewKey: first.review.key, catalog, planningWeeks: {}, bomConnected: true, batchToken: 'first' });
  result.planningWeeks['2026-11-16'].entries[0].buildQty = 999;
  const repeat = prepare({ ...input, planningWeeks: result.planningWeeks });
  assert.equal(repeat.review.readyRows.length, 0); assert.equal(repeat.duplicates.length, 123); assert.equal(repeat.pendingCount, 0);
  const next = await reader.readPlanExcel(new File([fixture.nextWorkbook()], 'Production plan 24 Nov 2026 Rev2.xlsx'));
  assert.ok(prepare({ ...setup(next), profile: input.profile, planningWeeks: result.planningWeeks }).review.readyRows.length > 100);
});

test('a failed atomic save changes neither the plan nor the profile; retry adds a stable batch once', async () => {
  const { createPlannerSaveLifecycle } = await import('../mrp-planner/src/planning/plannerSaveLifecycle.js');
  const input = approved(), plan = prepare(input), initial = { planningWeeks: {}, productionActuals: [{ id: 'KEEP-ACTUAL' }], oeeHistory: [{ id: 'KEEP-OEE' }], planningImportProfiles: {} };
  let snapshot = initial, stored = JSON.stringify(initial), fail = true, commits = 0;
  const saver = createPlannerSaveLifecycle({ getSnapshot: () => ({ loaded: true, data: snapshot }), onSaveState() {}, write: async (data) => { if (fail) throw new Error('Synthetic quota failure'); stored = JSON.stringify(data); } });
  const action = {
    prepare: (data) => {
      const result = importer.applyReviewedExcelPlan({ document, draft: plan.draft, expectedReviewKey: plan.review.key, catalog, planningWeeks: data.planningWeeks, bomConnected: true, batchToken: 'stable' });
      return { data: { ...data, planningWeeks: result.planningWeeks, planningImportProfiles: { [document.format]: input.profile } } };
    },
    commit: ({ data }) => { snapshot = data; commits++; },
  };
  await assert.rejects(saver.savePrepared(action), /quota/); assert.strictEqual(snapshot, initial); assert.equal(stored, JSON.stringify(initial)); assert.equal(commits, 0);
  fail = false; await saver.savePrepared(action);
  assert.equal(commits, 1); assert.equal(JSON.parse(stored).planningWeeks['2026-11-16'].entries.length, 123);
  assert.ok(JSON.parse(stored).planningImportProfiles[document.format]); assert.deepEqual(snapshot.productionActuals, initial.productionActuals); assert.deepEqual(snapshot.oeeHistory, initial.oeeHistory);
});
