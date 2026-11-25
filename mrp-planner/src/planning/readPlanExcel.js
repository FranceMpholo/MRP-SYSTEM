import { extractProductionPlanWorkbook } from './excelPlanLayout.js';

const MAX_BYTES = 10 * 1024 * 1024;
const hash = async (data) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((value) => value.toString(16).padStart(2, '0')).join('');

export async function readPlanExcel(file) {
  if (!/\.xlsx$/i.test(file.name) || !file.size || file.size > MAX_BYTES) throw new Error('Choose a non-empty Excel .xlsx workbook up to 10 MB. Other file types are unsupported.');
  const data = new Uint8Array(await file.arrayBuffer());
  if (data[0] !== 0x50 || data[1] !== 0x4b || data[2] !== 3 || data[3] !== 4) throw new Error('This file is not a readable .xlsx workbook. Choose an unlocked Excel workbook.');
  const XLSX = await import('xlsx');
  let workbook;
  try {
    workbook = XLSX.read(data, { type: 'array', cellDates: true, cellHTML: false, cellFormula: true, bookVBA: true, bookFiles: true });
    if (workbook.vbaraw || !workbook.keys?.includes('xl/workbook.xml')) throw new Error('Unsupported workbook container');
  } catch {
    throw new Error('The Excel workbook is damaged, encrypted, or unsupported. Choose an unlocked, values-only .xlsx copy. No planning data was changed.');
  }
  const document = extractProductionPlanWorkbook(workbook, file.name);
  // A renamed/re-saved workbook or edits to Cell Review must not bypass repeat detection.
  const schedule = { format: document.format, dates: document.dateGroups, shifts: document.shifts, cells: document.cells };
  return { ...document, fingerprint: await hash(new TextEncoder().encode(JSON.stringify(schedule))), fileFingerprint: await hash(data) };
}
