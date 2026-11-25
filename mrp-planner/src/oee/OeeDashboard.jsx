import React, { useEffect, useMemo, useState } from 'react';
import { PRODUCTION_LINES } from '../production/productionLines';
import { SHIFTS, addCalendarDays } from '../planning/planningBoardUtils';
import { SHIFT_CONFIG } from '../planning/shiftConfig';
import { deriveFinishedGoods } from './finishedGoods';
import OeeChart, { formatNumber as fmt, metricLabels, percent } from './OeeChart';
import { addIdealOeeBenchmark, deriveDashboardRows, deriveDowntimeByCategory, deriveOeeMtd, filterDashboardRows, groupOeeRows, sortDashboardRows, summarizeOeeRows } from './dashboardReporting';
import './oee.css';

const factors = ['externalOee', 'internalOee', 'availability', 'performance', 'quality', 'productivity'];
const issueLabels = { MISSING_NICT: 'Missing NICT', MISSING_ACTUAL: 'Missing Actual', MISSING_PLANNED_TIME: 'Missing Planned Time', INVALID_TIME_ALLOCATION: 'Invalid Time Allocation', SCRAP_EXCEEDS_TOTAL: 'Scrap exceeds Actual', UNVERIFIED_SPECIAL_RULE: 'Special process rule not verified', MISSING_QUALITY_INPUT: 'Missing quality input' };
const formatMetric = (value) => value === null || value === undefined ? '—' : percent(value);
const detailColumns = [
  ['date', 'Date'], ['productionLine', 'Production Line'], ['machine', 'Machine'], ['shift', 'Shift'], ['process', 'Process'], ['product', 'Product'], ['suffix', 'Suffix'],
  ['effectivePlan', 'Effective Plan'], ['revisedPlan', 'Revised Plan'], ['target', 'Target'], ['actual', 'Actual'], ['good', 'Good'], ['scrap', 'Scrap'],
  ['plannedTime', 'Planned Time'], ['runTime', 'Run Time'], ['downtime', 'Downtime'], ['availability', 'Availability'], ['performance', 'Performance'],
  ['quality', 'Quality'], ['productivity', 'Productivity'], ['externalOee', 'External OEE'], ['internalOee', 'Internal OEE'], ['status', 'Status'],
];
const percentageKeys = new Set(['availability', 'performance', 'quality', 'productivity', 'externalOee', 'internalOee']);

export default function OeeDashboard({ planningWeeks, actuals, settings, productionLine, setProductionLine, weekStart }) {
  const [filters, setFilters] = useState({ startDate: weekStart, endDate: addCalendarDays(weekStart, 6), machine: '', shift: '', process: '', product: '', suffix: '', status: '' });
  const [sort, setSort] = useState({ key: 'date', direction: 'desc' });
  const [fgPayload, setFgPayload] = useState(null), [fgError, setFgError] = useState(''), [loading, setLoading] = useState(false), [refresh, setRefresh] = useState(0), [page, setPage] = useState(0);
  const validRange = filters.startDate !== '' && filters.endDate !== '' && filters.startDate <= filters.endDate && (Date.parse(filters.endDate) - Date.parse(filters.startDate)) / 86400000 <= 366;
  const rangeKey = `${filters.startDate}/${filters.endDate}`;

  useEffect(() => {
    setFgPayload(null); setFgError('');
    if (!validRange) { setLoading(false); return undefined; }
    const controller = new AbortController(); setLoading(true);
    fetch(`/api/syspro/oee/finished-goods?${new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate })}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => { if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`HTTP ${response.status}: expected JSON`); const payload = await response.json(); if (!response.ok || payload.success !== true || !Array.isArray(payload.data)) throw new Error(payload.error ?? 'Invalid response'); if (!controller.signal.aborted) setFgPayload({ ...payload, rangeKey }); })
      .catch((error) => { if (!controller.signal.aborted) { console.error('OEE B-FIN01 request failed:', error); setFgError('B-FIN01 movement data is unavailable.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [rangeKey, validRange, refresh]);
  useEffect(() => { setFilters((current) => ({ ...current, machine: '', process: '', product: '', suffix: '' })); }, [productionLine]);
  useEffect(() => setPage(0), [filters, productionLine, actuals, settings, sort]);

  const allRows = useMemo(() => deriveDashboardRows(planningWeeks, actuals, settings, productionLine), [planningWeeks, actuals, settings, productionLine]);
  const selected = useMemo(() => validRange ? filterDashboardRows(allRows, { ...filters, productionLine }) : [], [allRows, filters, productionLine, validRange]);
  const sorted = useMemo(() => sortDashboardRows(selected, sort), [selected, sort]);
  const summary = useMemo(() => summarizeOeeRows(selected), [selected]);
  const mtd = useMemo(() => deriveOeeMtd(allRows, filters.endDate, { ...filters, productionLine }), [allRows, filters, productionLine]);
  const idealOee = settings?.general?.idealOee ?? 0.75;
  const daily = useMemo(() => groupOeeRows(selected, 'date'), [selected]);
  const trend = useMemo(() => addIdealOeeBenchmark(daily, idealOee), [daily, idealOee]);
  const machines = useMemo(() => groupOeeRows(selected, 'machine'), [selected]);
  const factorBreakdown = useMemo(() => summary.count ? [{ label: 'Selected period', ...summary }] : [], [summary]);
  const downtimeCategories = useMemo(() => deriveDowntimeByCategory(selected), [selected]);
  const downtimeDaily = useMemo(() => daily.map((row) => ({ ...row, downtime: row.downtime ?? 0 })), [daily]);
  const fg = useMemo(() => deriveFinishedGoods(validRange && fgPayload?.rangeKey === rangeKey ? fgPayload : null, selected, filters, productionLine), [fgPayload, rangeKey, selected, filters, productionLine, validRange]);
  const processOptions = useMemo(() => [...new Set(allRows.map((row) => row.process).filter(Boolean))].sort(), [allRows]);
  const line = PRODUCTION_LINES[productionLine], pages = Math.max(1, Math.ceil(sorted.length / 30)), currentPage = Math.min(page, pages - 1);
  const change = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const changeSort = (key) => setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  const sortMark = (key) => sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : '';

  return <div className="oee-dashboard">
    <header className="oee-header oee-dashboard-title"><div><h2>OEE Dashboard</h2><p>Production Performance &amp; Equipment Effectiveness</p></div><div><div className="oee-period">Reporting period · {filters.startDate || '—'} to {filters.endDate || '—'}</div><span>{loading ? 'Loading B-FIN01…' : fgError ? 'B-FIN01 unavailable' : fgPayload ? 'SYSPRO connected · Read only' : 'Select reporting dates'}</span><button className="mrp-btn mrp-btn-ghost" disabled={loading || !validRange} onClick={() => setRefresh((value) => value + 1)}>Refresh FG</button></div></header>

    <section className="oee-filters" aria-label="OEE reporting filters"><label>From Date<input type="date" value={filters.startDate} onChange={(event) => change('startDate', event.target.value)} /></label><label>To Date<input type="date" value={filters.endDate} onChange={(event) => change('endDate', event.target.value)} /></label><label>Production Line<select value={productionLine} onChange={(event) => setProductionLine(event.target.value)}>{Object.values(PRODUCTION_LINES).map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label>Machine<select value={filters.machine} onChange={(event) => change('machine', event.target.value)}><option value="">All machines</option>{Object.keys(line.machines).map((machine) => <option key={machine}>{machine}</option>)}</select></label><label>Shift<select value={filters.shift} onChange={(event) => change('shift', event.target.value)}><option value="">All shifts</option>{SHIFTS.map((shift) => <option key={shift} value={shift}>{SHIFT_CONFIG[shift].name}</option>)}</select></label><label>Process<select value={filters.process} onChange={(event) => change('process', event.target.value)}><option value="">All processes</option>{processOptions.map((process) => <option key={process}>{process}</option>)}</select></label><label>Product / Stock Code<input type="search" value={filters.product} onChange={(event) => change('product', event.target.value)} /></label><label>Suffix<input value={filters.suffix} onChange={(event) => change('suffix', event.target.value)} /></label><label>OEE Status<select value={filters.status} onChange={(event) => change('status', event.target.value)}><option value="">All statuses</option><option value="COMPLETE">Complete</option><option value="INCOMPLETE">Incomplete</option><option value="PENDING">Pending</option></select></label></section>
    {!validRange && <p className="oee-notice" role="alert">Choose a valid reporting period of no more than 367 days.</p>}
    <p className="oee-caption">{summary.completeCount} complete / {summary.incompleteCount} incomplete / {summary.pendingCount} pending runs. Percentages average COMPLETE row-level results, including genuine zeroes. Quantities and times are summed. MTD runs from the first calendar day of the reporting month through {filters.endDate || 'the selected reporting date'}.</p>

    <div className="oee-kpis">{factors.map((key) => { const benchmarked = key === 'externalOee' || key === 'internalOee', value = summary[key], className = benchmarked && value !== null && value !== undefined ? value >= idealOee ? 'on-target' : 'below-target' : ''; return <article key={key} className={className}><h3>{metricLabels[key]}</h3><strong>{formatMetric(value)}</strong><small>{benchmarked ? `Ideal ${percent(idealOee)} · COMPLETE rows` : 'COMPLETE rows only'}</small></article>; })}</div>
    <section className="oee-panel"><h3>Production Summary</h3><div className="oee-kpi-grid">{[['Effective Plan', summary.effectivePlan], ['Available-Time Capacity / Revised Plan', summary.revisedPlan], ['OEE Target', summary.target], ['Actual Production', summary.actual], ['Good Parts', summary.good], ['Scrap Parts', summary.scrap], ['Planned Production Time', summary.plannedTime], ['Run Time', summary.runTime], ['Downtime', summary.downtime]].map(([label, value]) => <div key={label}><span className="oee-caption">{label}</span><strong>{fmt(value)}</strong></div>)}</div></section>
    <section className="oee-panel"><div className="oee-header"><h3>Month to Date · {filters.endDate?.slice(0, 7) || '—'}</h3><span className="oee-caption">Calendar month start through reporting date</span></div><div className="oee-summary-band"><div><span className="oee-caption">MTD External OEE</span><strong>{formatMetric(mtd.externalOee)}</strong></div><div><span className="oee-caption">MTD Internal OEE</span><strong>{formatMetric(mtd.internalOee)}</strong></div><div><span className="oee-caption">Complete OEE Runs</span><strong>{mtd.completeCount}</strong></div></div></section>

    <div className="oee-charts"><OeeChart className="oee-chart-wide" title="OEE Trend" caption="Daily arithmetic average of complete run-level results" data={trend} series={['externalOee', 'internalOee', 'idealOee']} line /><OeeChart title="OEE Factor Breakdown" caption="Selected reporting period" data={factorBreakdown} series={['availability', 'performance', 'quality', 'productivity']} /><OeeChart title="OEE by Machine" data={machines} series={['externalOee', 'internalOee']} /><OeeChart title="Production Comparison" data={daily} series={['effectivePlan', 'revisedPlan', 'target', 'actual']} percentage={false} /><OeeChart title="Downtime Trend" data={downtimeDaily} series={['downtime']} percentage={false} /><OeeChart title="Top Downtime Categories" caption="Captured historical category names" data={downtimeCategories} series={['downtime']} percentage={false} /></div>
    <section className="oee-panel"><h3>Quality &amp; Scrap</h3><div className="oee-summary-band"><div><span className="oee-caption">Good Parts</span><strong>{fmt(summary.good)}</strong></div><div><span className="oee-caption">Scrap Parts</span><strong>{fmt(summary.scrap)}</strong></div><div><span className="oee-caption">Quality</span><strong>{formatMetric(summary.quality)}</strong></div></div></section>
    <div className="oee-charts"><OeeChart title="Good / Scrap Trend" data={daily} series={['good', 'scrap']} percentage={false} /><OeeChart title="Quality Trend" data={daily} series={['quality']} line /></div>

    <section className="oee-panel"><h3>Finished Goods Transferred · B-FIN01</h3><p className="oee-caption">Supporting evidence only. B-FIN01 movements do not supply Actual Production, Good Parts, Scrap, Target, Performance, Quality or OEE.</p>{fgError && <p className="oee-notice">{fgError}</p>}{fg.available && <div className="oee-table-scroll"><table className="mrp-table"><thead><tr><th>Stock Code</th><th>Unit</th><th>Into FG</th><th>FG to WIP</th></tr></thead><tbody>{fg.products.map((row) => <tr key={row.stockCode}><td>{row.stockCode}</td><td>{row.uom}</td><td>{fmt(row.incoming)}</td><td>{fmt(row.returned)}</td></tr>)}{!fg.products.length && <tr><td colSpan="4">No matching movements in this period.</td></tr>}</tbody></table></div>}</section>

    <section className="oee-panel"><div className="oee-header"><div><h3>OEE Detail · {line.quantityLabel}</h3><p className="oee-caption">Each row remains keyed by planningEntryId; incomplete values are not converted to zero.</p></div><div><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button> {currentPage + 1} / {pages} <button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div><div className="oee-table-scroll"><table className="mrp-table"><thead><tr>{detailColumns.map(([key, label]) => <th key={key}><button className="oee-sort-button" type="button" onClick={() => changeSort(key)}>{label}{sortMark(key)}</button></th>)}</tr></thead><tbody>{sorted.slice(currentPage * 30, (currentPage + 1) * 30).map((row) => <tr key={row.planningEntryId} className={row.status === 'INCOMPLETE' ? 'oee-detail-row-incomplete' : row.status === 'PENDING' ? 'oee-detail-row-pending' : ''}>{detailColumns.map(([key]) => { if (key === 'status') return <td key={key}><details><summary><span className={`oee-status oee-status-${String(row.status).toLowerCase()}`}>{row.status}</span></summary>{row.issues?.map((issue) => <p key={issue}>{issueLabels[issue] ?? issue}</p>)}<p>planningEntryId: {row.planningEntryId}</p></details></td>; const value = row[key]; return <td key={key}>{percentageKeys.has(key) ? row.status === 'COMPLETE' && value !== null && value !== undefined ? percent(value) : '—' : key === 'productionLine' ? PRODUCTION_LINES[value]?.name ?? value ?? '—' : key === 'suffix' ? value || '—' : typeof value === 'number' || value === null || value === undefined ? fmt(value) : value}</td>; })}</tr>)}{!sorted.length && <tr><td colSpan={detailColumns.length}>No planned runs match these filters.</td></tr>}</tbody></table></div></section>
  </div>;
}
