// Recognize merged date groups above repeating shifts and column-A machines.
// Cell Review is reference material; it is never a second schedule source.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const timePattern = /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/;
export const columnName = (index) => {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
};
const address = (r, c) => `${columnName(c)}${r + 1}`;
const text = (sheet, r, c) => String(sheet[address(r, c)]?.v ?? '').trim();
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function dateHeader(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return { weekday: '', day: value.getUTCDate(), month: value.getUTCMonth() + 1, year: String(value.getUTCFullYear()) };
  const numeric = /^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))$/.exec(String(value));
  if (numeric) return { weekday: '', day: Number(numeric[3] || numeric[4]), month: Number(numeric[2] || numeric[5]), year: numeric[1] || numeric[6] };
  const match = /^(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*\|\s*)?(\d{1,2})[- /]([A-Za-z]+)(?:[- /](\d{4}))?$/i.exec(value);
  const month = match && MONTHS.findIndex((name) => name.toLowerCase() === match[3].slice(0, 3).toLowerCase()) + 1;
  if (!match || !month || Number(match[2]) < 1 || Number(match[2]) > 31) return null;
  return { weekday: WEEKDAYS.find((day) => day.toLowerCase() === match[1]?.toLowerCase()) || '', day: Number(match[2]), month, year: match[4] || '' };
}

function findHeader(sheet) {
  const merges = sheet['!merges'] || [];
  // Both supported layouts have a date merge starting in B within the first
  // twenty rows. The converted layout combines weekday/date; Rev2 separates them.
  const headers = merges.filter((merge) => merge.s.c === 1 && merge.s.r === merge.e.r && merge.s.r < 20 && dateHeader(sheet[address(merge.s.r, 1)]?.v));
  if (headers.length !== 1) return null;
  const header = headers[0].s.r;
  const dateMerges = merges.filter((merge) => merge.s.r === header && merge.e.r === header && merge.s.c > 0).sort((a, b) => a.s.c - b.s.c);
  const hasMachines = Object.entries(sheet).some(([key, cell]) => /^A\d+$/.test(key) && Number(key.slice(1)) > header + 2 && sourceMachine(cell.v).machine);
  if (!hasMachines) return null;
  return { header, shiftRow: header + 1, dateMerges };
}
export function sourceMachine(label) {
  const value = String(label).trim().toUpperCase();
  if (/^AR[1-5]$/.test(value)) return { machine: value, productionLine: 'thermoforming' };
  if (/^BM0?[1-5]$/.test(value)) return { machine: `BM0${Number(value.slice(2))}`, productionLine: 'blowMoulding' };
  return { machine: null, productionLine: null };
}
export function parseSourceCell(value) {
  if (!String(value).trim()) return [{ kind: 'Unresolved', sourceText: '', productText: '', quantity: '' }];
  return String(value).split(/\r?\n/).flatMap((line) => line.split(/(\bC\s*\/\s*O\b|\bOFF\b)/gi).filter((part) => part.trim()).map((part) => {
    const sourceText = part.trim();
    if (/^C\s*\/\s*O$/i.test(sourceText)) return { kind: 'Changeover', sourceText, productText: '', quantity: '' };
    if (/^OFF$/i.test(sourceText)) return { kind: 'OFF', sourceText, productText: '', quantity: '' };
    const match = /^(\d+(?:\.\d+)?)\s+([A-Za-z].*)$/.exec(sourceText);
    return match ? { kind: 'Production', sourceText, quantity: match[1], productText: match[2].trim() }
      : { kind: 'Remark', sourceText, productText: '', quantity: '' };
  }));
}

export function extractProductionPlanWorkbook(workbook, fileName = '') {
  const unsupported = (detail) => { throw new Error(`Unsupported Excel layout: ${detail} Expected one schedule sheet (such as Production Plan or Table 1) with column-A machine labels, merged date headers and three repeating shift columns per date. No planning data was changed.`); };
  const candidates = (workbook.SheetNames || Object.keys(workbook.Sheets || {})).filter((name) => name.trim().toLowerCase() !== 'cell review')
    .flatMap((name) => { const sheet = workbook.Sheets?.[name], layout = sheet && findHeader(sheet); return layout ? [{ name, sheet, ...layout }] : []; });
  if (candidates.length !== 1) unsupported(candidates.length ? 'multiple schedule sheets match; keep one schedule sheet in the upload.' : 'no sheet has the supported schedule structure.');
  const { name: sheetName, sheet, header, shiftRow, dateMerges } = candidates[0];
  const ref = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(sheet['!ref'] || '');
  if (!ref || Number(ref[4]) > 500 || ref[3].length > 2) unsupported('the schedule is empty or exceeds 500 rows / 52 columns.');
  const columnIndex = (name) => [...name].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
  const lastRow = Number(ref[4]) - 1, lastColumn = columnIndex(ref[3]);
  if (lastColumn > 51) unsupported('the schedule exceeds 52 columns.');
  for (const [key, cell] of Object.entries(sheet)) if (!key.startsWith('!') && cell.f) unsupported(`formula in ${key}; use a values-only copy.`);
  const merges = sheet['!merges'] || [];
  if (!dateMerges.length || dateMerges.length > 14) unsupported('merged date headers were not found.');
  const dateGroups = [], shifts = [], columns = new Map();
  let expectedColumn = 1;
  for (const merge of dateMerges) {
    if (merge.s.c !== expectedColumn || merge.e.c - merge.s.c !== 2) unsupported('each date must span exactly three contiguous shift columns.');
    const label = text(sheet, header, merge.s.c);
    const parsed = dateHeader(sheet[address(header, merge.s.c)]?.v);
    if (!parsed) unsupported(`unrecognized date header at ${address(header, merge.s.c)}.`);
    const weekdayMerge = merges.find((entry) => entry.s.r === header - 1 && entry.e.r === header - 1 && entry.s.c === merge.s.c && entry.e.c === merge.e.c);
    const weekday = parsed.weekday || (weekdayMerge && WEEKDAYS.find((day) => day.toLowerCase() === text(sheet, header - 1, merge.s.c).toLowerCase()));
    if (!weekday && !parsed.year) unsupported(`a matching merged weekday header is required above ${address(header, merge.s.c)}.`);
    const group = { id: address(header, merge.s.c), label: `${parsed.day}-${MONTHS[parsed.month - 1]}`, weekday: weekday || '', day: parsed.day, month: parsed.month, year: parsed.year, sourceCell: `${sheetName}!${address(header, merge.s.c)}` };
    if (dateGroups.some((previous) => previous.day === group.day && previous.month === group.month)) unsupported('date headers are repeated.');
    dateGroups.push(group);
    const groupShifts = [];
    for (let c = merge.s.c; c <= merge.e.c; c++) {
      const label = text(sheet, shiftRow, c), time = timePattern.exec(label);
      if (!time || [time[1], time[2]].some((part) => Number(part.slice(0, 2)) > 23 || Number(part.slice(3)) > 59)) unsupported(`unrecognized shift at ${address(shiftRow, c)}.`);
      const key = `${time[1]}-${time[2]}`;
      if (groupShifts.includes(key)) unsupported('a date has duplicate shift columns.');
      groupShifts.push(key);
      if (!shifts.some((shift) => shift.key === key)) shifts.push({ key, label, start: time[1], end: time[2] });
      columns.set(c, { dateGroupId: group.id, sourceShift: label, shiftKey: key });
    }
    if (shifts.length !== 3 || groupShifts.some((key, index) => key !== shifts[index].key)) unsupported('each date must use the same ordered set of three shifts.');
    expectedColumn = merge.e.c + 1;
  }
  const cells = [], machines = new Set();
  let remarks = false;
  for (let r = shiftRow + 1; r <= lastRow; r++) {
    const label = text(sheet, r, 0);
    if (/^remarks?\b/i.test(label)) { remarks = true; continue; }
    if (remarks) {
      for (let c = 0; c <= lastColumn; c++) if (text(sheet, r, c)) {
        cells.push({ id: address(r, c), sourceCell: `${sheetName}!${address(r, c)}`, sourceMachine: 'Remarks', machine: null, productionLine: null, dateGroupId: '', shiftKey: '', sourceShift: 'General remark', daySpanning: true, rawText: text(sheet, r, c), fragments: [{ kind: 'Remark', sourceText: text(sheet, r, c), quantity: '', productText: '' }] });
      }
      continue;
    }
    if (!label) {
      if ([...columns.keys()].some((c) => text(sheet, r, c))) unsupported(`populated row ${r + 1} has no machine/area label.`);
      continue;
    }
    if (machines.has(label.toUpperCase())) unsupported(`machine/area ${label} has more than one row.`);
    machines.add(label.toUpperCase());
    for (let c = 1; c < expectedColumn; c++) {
      const merge = merges.find((entry) => r >= entry.s.r && r <= entry.e.r && c >= entry.s.c && c <= entry.e.c);
      if (merge && (r !== merge.s.r || c !== merge.s.c)) continue;
      if (merge && (merge.e.r !== r || merge.s.c < 1 || merge.e.c >= expectedColumn || columns.get(merge.s.c)?.dateGroupId !== columns.get(merge.e.c)?.dateGroupId)) unsupported(`unsupported activity merge at ${address(r, c)}.`);
      const rawText = text(sheet, r, c), daySpanning = Boolean(merge && merge.e.c > c);
      cells.push({ id: address(r, c), sourceCell: `${sheetName}!${address(r, c)}${merge ? `:${address(merge.e.r, merge.e.c)}` : ''}`, sourceMachine: label, ...sourceMachine(label), ...columns.get(c),
        sourceShift: daySpanning ? 'Day-spanning; shift unassigned' : columns.get(c).sourceShift, shiftKey: daySpanning ? '' : columns.get(c).shiftKey,
        daySpanning, rawText, fragments: parseSourceCell(rawText) });
    }
    for (let c = expectedColumn; c <= lastColumn; c++) if (text(sheet, r, c)) unsupported(`unowned schedule text at ${address(r, c)}.`);
  }
  if (!cells.some((cell) => cell.machine)) unsupported('no supported machine rows were found.');
  const notes = Array.from({ length: header }, (_, r) => text(sheet, r, 0)).filter(Boolean);
  return { fileName, format: dateHeader(sheet[address(header, 1)]?.v).weekday ? 'production-plan-converted-xlsx-v1' : 'production-plan-grid-xlsx-v1', sheetName, dateGroups, shifts, cells, notes, issues: [],
    referenceSheet: workbook.SheetNames?.includes('Cell Review') ? 'Cell Review (reference only; not imported)' : '',
    yearAbsent: dateGroups.some((group) => !group.year), filenameDiscrepancy: notes.find((note) => /filename|confirm before import/i.test(note)) || 'Confirm schedule dates; the filename is not used to infer a year.' };
}
