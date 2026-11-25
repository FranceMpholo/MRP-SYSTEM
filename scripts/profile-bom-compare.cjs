// Offline parity/timing comparison: never contacts SYSPRO or modifies data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../diagnostics/bom-performance');
const read = (file) => JSON.parse(fs.readFileSync(path.join(output, file), 'utf8'));
const before = read('before-browser.json'), after = read('after-browser.json');
const server = ['before', 'after'].flatMap((stage) => fs.readFileSync(path.join(output, `${stage}-server.jsonl`), 'utf8').trim().split('\n').map(JSON.parse));
const comparisons = [];
for (const phase of ['startup', 'manual']) {
  const a = before.results.find((r) => r.phase === phase), b = after.results.find((r) => r.phase === phase);
  assert.equal(a.requestCount, 1); assert.equal(b.requestCount, 1);
  const oldPayload = read(`before-${phase}-response.json`), newPayload = read(`after-${phase}-response.json`);
  const { fetchedAt: oldTimestamp, ...oldContent } = oldPayload, { fetchedAt: newTimestamp, ...newContent } = newPayload;
  assert.deepEqual(newContent, oldContent, `${phase}: every row, its order, metadata, source and envelope match`);
  assert.ok(Date.parse(newTimestamp) > Date.parse(oldTimestamp));
  assert.equal(a.dataSha256, b.dataSha256); assert.equal(a.validation.warningsSha256, b.validation.warningsSha256);
  const factorStates = (rows) => rows.reduce((counts, row) => { counts[row.qtyPerState] = (counts[row.qtyPerState] || 0) + 1; return counts; }, {});
  assert.deepEqual(factorStates(oldPayload.data), factorStates(newPayload.data));
  const oldServer = server.find((r) => r.id === a.profileId), newServer = server.find((r) => r.id === b.profileId);
  comparisons.push({ phase, rows: a.rows, bytes: a.bytes, factorStates: factorStates(newPayload.data), contentIdentical: true, warningsIdentical: true,
    before: { ...a, server: oldServer }, after: { ...b, server: newServer }, speedup: a.browserFetchToPaintMs / b.browserFetchToPaintMs });
}
assert.equal(after.errors.length, 0);
const report = { comparisons, coldDefinition: 'New backend pool and isolated browser; corporate SQL buffer/plan caches were not flushed.',
  staleRefresh: after.staleRefresh, liveBomSelects: server.filter((r) => r.status === 200).length + 2,
  liveSelectCountNote: 'Four formal before/after reads, two incomplete diagnostic preflights, one unhinted plan-probe read, and one hinted candidate. The corrected batch SHOWPLAN probe is compile-only.' };
fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
