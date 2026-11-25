// Synthetic catalogue and approval choices for the real workbook's UI tests.
// These values never establish business approval for live production data.
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('../../mrp-planner/node_modules/xlsx');
const sampleName = 'Production plan 17 Nov 2026 Rev2.xlsx';
const bytes = fs.readFileSync(path.join(__dirname, sampleName));
const codes = new Set(Object.values(XLSX.read(bytes, { type: 'buffer' }).Sheets['Table 1']).flatMap((cell) => typeof cell.v === 'string' ? [...cell.v.matchAll(/\b[A-Z][A-Z0-9]+-[A-Z0-9-]+/g)].map((match) => match[0]) : []));
for (const code of ['N1WB-E13036-K', 'N1WB-E13036-N', 'N1WB-16450-BAA', 'N1WB-16451-BAA', 'N1XB-16450-BAA', 'N1XB-16451-BAA', 'N1WB-16450-CAA', 'N1WB-16451-CAA', 'N1XB-16450-ABA', 'N1XB-16451-ABA']) codes.add(code);
const parentCodes = [...codes];
const boms = parentCodes.map((parentStockCode) => ({ parentStockCode, parentDescription: 'Synthetic test parent', componentStockCode: 'TEST-RAW', componentDescription: 'Synthetic material', qtyPer: 1, parentUom: 'EA', componentUom: 'EA', factorUnitsVerified: true, qtyPerBasis: 'stocking' }));
const items = [...parentCodes, 'TEST-RAW'].map((code) => ({ id: code, code, description: 'Synthetic item', uom: 'EA', type: 'Buy', lotSize: 10, onHand: 0 }));
function nextWorkbook({ unknown = false, fullDates = false } = {}) {
  const book = XLSX.read(bytes, { type: 'buffer' }), sheet = book.Sheets['Table 1'];
  for (const [index, address] of ['B2', 'E2', 'H2', 'K2'].entries()) sheet[address] = fullDates ? { t: 'd', v: new Date(Date.UTC(2026, 10, 24 + index)), z: 'dd-mmm-yyyy' } : { t: 's', v: `${24 + index}-Nov` };
  if (unknown) { sheet.B5.v = '12 NEWCODE'; sheet.C5.v = '14 NEWCODE'; }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
function codeChoice(question) {
  if (question.token === 'BAA') return question.machines.includes('BM01') ? ['N1WB_BAA_PAIR', 'machine:BM01'] : ['N1XB_BAA_PAIR', 'machine:BM03'];
  return [{ 'DBL LH': 'N1WB-E13036-K', 'DBL RH': 'N1WB-E13036-N', CAA: 'N1WB_CAA_PAIR', ABA: 'N1XB_ABA_PAIR' }[question.token], `line:${question.productionLine}`];
}
module.exports = { bytes, sampleName, boms, items, parentCodes, nextWorkbook, codeChoice };
