import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import ScrapChart, { money } from './ScrapCharts';
import { deriveScrapData, WAREHOUSES, REG_DIRECTIONS } from './deriveScrapData';
import { API_UNAVAILABLE, readProductionScrap, commodityOptions } from './productionScrapApi';
import './productionScrap.css';
import { AnimatedValue, ScrapResults, ScrapSkeleton } from './scrapMotion';

const dateString = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const qty = value => new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 6 }).format(value);
const units = data => data.uoms.length > 1 ? 'Mixed units: ' + data.uoms.join(', ') + ' — arithmetic sum' : data.uoms[0] || 'No transactions';
function Kpis({ cards }) {
  return <section className="scrap-kpis">{cards.map(([label, value, caption, format = money]) => <article className="scrap-kpi" key={label}><h3>{label}</h3><AnimatedValue value={value} format={format} /><small>{caption}</small></article>)}</section>;
}
function MappingAudit({ row, mapping }) {
  const [open, setOpen] = useState(false);
  return <details className="scrap-mapping" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{row.mappingStatus}</summary>
    {open && <div><b>{row.stockCode} — current direct BOM parents</b><p>Commodity membership does not identify the physical department responsible.</p>
      <p>Candidates: {mapping?.candidateCommodities?.join(', ') || 'None'} · Unclassified parents: {mapping?.unclassifiedParentCount || 0}</p>
      {!mapping?.parents?.length ? <p>No direct BOM parents.</p> : <ul>{mapping.parents.map((parent, index) => <li key={index}><b>{parent.parentPart}</b> — {parent.description}<br />Route {parent.route || '—'} · Qty per {qty(parent.qtyPer)} · {parent.commodities.join(', ') || 'Unclassified parent'}</li>)}</ul>}
    </div>}
  </details>;
}
function DetailTable({ data, mappings, reg = false }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [data]);
  const pages = Math.max(1, Math.ceil(data.rows.length / 50)), current = Math.min(page, pages - 1);
  return <section className="scrap-panel"><div className="scrap-table-header"><div><h3>{reg ? 'REG Activity Detail' : 'Confirmed Scrap Detail'}</h3><p className="scrap-caption">{qty(data.rows.length)} transactions · {reg ? 'Quantity and value are transfer magnitudes, not scrap loss.' : 'Total Cost = signed Scrap Qty × Unit Cost.'} Open Mapping Status to inspect all BOM parents.</p></div>
    <div className="scrap-pagination"><button disabled={!current} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current + 1} of {pages}</span><button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Next</button></div></div>
    <div className="scrap-table-scroll"><table className="mrp-table"><thead><tr>{['Date', 'Commodity', 'Mapping Status', 'Stock Code', 'Description', reg ? 'Direction' : 'Warehouse', reg ? 'Quantity' : 'Scrap Qty', 'Unit Cost', reg ? 'Value' : 'Total Cost', 'Reference'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {data.rows.slice(current * 50, (current + 1) * 50).map((row, index) => <tr key={[row.trnYear, row.journal, row.journalEntry, index].join('-')}><td>{row.date}</td><td>{row.commodity}</td><td><MappingAudit row={row} mapping={mappings[row.stockCode]} /></td><td className="plex-mono">{row.stockCode}</td><td>{row.description}</td><td>{reg ? row.direction : row.warehouse}</td><td className="scrap-number">{qty(row.quantity)} <small>{row.uom}</small></td><td className="scrap-number">{row.unitCost == null ? 'Unavailable' : 'R ' + qty(row.unitCost)}</td><td className="scrap-number">{row.value == null ? 'Unavailable' : money(row.value)}</td><td title={'Journal ' + row.trnYear + '/' + row.trnMonth + '/' + row.journal + '/' + row.journalEntry}>{row.reference || '—'}</td></tr>)}
      {!data.rows.length && <tr><td colSpan={10} className="scrap-empty">No transactions match these filters.</td></tr>}
    </tbody><tfoot><tr><td colSpan={6}>Filtered {reg ? 'activity' : 'confirmed scrap'} total · all pages</td><td className="scrap-number">{qty(data.totalQty)}</td><td></td><td className="scrap-number">{money(data.totalValue)}</td><td></td></tr></tfoot></table></div>
  </section>;
}
function Quality({ data }) {
  return <><p className="scrap-caption">{Object.entries(data.statuses).map(([status, count]) => status + ': ' + qty(count)).join(' · ')}. Incomplete Coverage means candidate commodity parents coexist with unclassified parents.</p>
    {!!data.missingCostCount && <p className="scrap-notice" role="alert">{qty(data.missingCostCount)} transactions lack unit cost. Monetary totals and rankings are incomplete; rows remain visible.</p>}</>;
}
export default function ProductionScrap() {
  const [filters, setFilters] = useState(() => ({ startDate: new Date().getFullYear() + '-01-01', endDate: dateString(new Date()), commodity: '', warehouse: '', stockCode: '' }));
  const [payload, setPayload] = useState(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  const validRange = Boolean(filters.startDate && filters.endDate && filters.startDate <= filters.endDate && (Date.parse(filters.endDate) - Date.parse(filters.startDate)) / 86400000 <= 3660);
  const rangeKey = filters.startDate + '/' + filters.endDate;
  useEffect(() => {
    if (!validRange) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setPayload(null);
    const query = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate });
    fetch('/api/syspro/production-scrap?' + query, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async response => {
        const result = await readProductionScrap(response);
        if (!controller.signal.aborted) setPayload({ ...result, rangeKey });
      }).catch(cause => {
        if (!controller.signal.aborted) {
          console.error('Production Scrap request failed:', cause);
          setError(API_UNAVAILABLE);
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters.startDate, filters.endDate, validRange, rangeKey, refresh]);
  const ready = validRange && !loading && !error && payload?.rangeKey === rangeKey;
  const data = useMemo(() => ready ? deriveScrapData(payload.data, filters) : null, [ready, payload, filters]);
  // A content signature triggers presentation fades without remounting tables.
  const resultSignature = useMemo(() => data === null ? '' : JSON.stringify([
    data.confirmed.rows, data.reg.rows, data.target,
  ]), [data]);
  const commodities = commodityOptions(payload?.data);
  const change = (key, value) => setFilters(previous => ({ ...previous, [key]: value }));
  const confirmed = data?.confirmed, reg = data?.reg;
  return <div className="production-scrap">
    <header className="scrap-header"><div><h2>Production Scrap</h2><p>Confirmed B-SCR01 scrap · separate REG / recovery activity</p></div><div className="scrap-status"><span>{loading ? 'Connecting to SYSPRO…' : error ? 'SYSPRO unavailable' : ready ? 'SYSPRO connected · Read only' : 'Select a date range'}</span>{ready && <small>Updated {new Date(payload.fetchedAt).toLocaleString()}</small>}<button onClick={() => setRefresh(value => value + 1)} disabled={loading || !validRange}><RotateCcw size={13} />Refresh</button></div></header>
    <section className="scrap-filters" aria-label="Shared scrap and REG filters">
      <label>From<input type="date" value={filters.startDate} onChange={event => change('startDate', event.target.value)} /></label>
      <label>To<input type="date" value={filters.endDate} onChange={event => change('endDate', event.target.value)} /></label>
      <label>Commodity<select value={filters.commodity} onChange={event => change('commodity', event.target.value)}><option value="">All commodities</option>{commodities.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Warehouse / Activity Type<select value={filters.warehouse} onChange={event => change('warehouse', event.target.value)}><option value="">All Activity</option>{WAREHOUSES.map(name => <option key={name} value={name}>{name === 'B-SCR01' ? 'B-SCR01 · Confirmed Scrap' : 'B-REG01 · REG / Recovery'}</option>)}</select></label>
      <label>Stock Code search<input type="search" placeholder="Search stock codes…" value={filters.stockCode} onChange={event => change('stockCode', event.target.value)} /></label>
    </section>
    {!validRange && <p className="scrap-notice" role="alert">Choose a valid date range of no more than 10 years.</p>}
    {error && <p className="scrap-notice" role="alert">{error} Use Refresh to retry.</p>}
    {loading && validRange && <ScrapSkeleton warehouse={filters.warehouse} />}
    {ready && <ScrapResults signature={resultSignature}>
      {filters.warehouse !== 'B-REG01' && <section className="scrap-section" aria-label="Confirmed Scrap"><h2>Confirmed Scrap</h2>
        <p className="scrap-caption">Validated B-SCR01 calculation only: WIP-to-SCR source transfers with the existing SCR-to-WIP deductions. REG is excluded.</p>
        <Kpis cards={[
          ['Confirmed Scrap Cost', confirmed.totalValue, 'B-SCR01 only'],
          ['Confirmed Scrap Qty', confirmed.totalQty, units(confirmed), qty],
          ['Monthly Scrap Target', data.target.monthly, 'Confirmed scrap only · full-month reference'],
          ['Variance to Target', data.target.variance, data.target.variance == null ? 'Target is not allocated to commodity/stock subsets or missing costs.' : 'Cost minus ' + data.target.months + ' × R400,000; positive = above reference.'],
        ]} />
        <p className="scrap-caption">Period target reference: {money(data.target.periodReference)} across {data.target.months} calendar months. Partial boundary months use the full monthly reference, not a prorated budget.</p>
        <Quality data={confirmed} />
        <div className="scrap-charts">
          <ScrapChart title="Monthly Confirmed Scrap Cost" data={confirmed.monthly} target caption="R400,000 full-month reference for confirmed B-SCR01 scrap; not an allocated target for filtered commodities or stock codes." />
          <ScrapChart title="Daily Confirmed Scrap Cost" data={confirmed.daily} caption="B-SCR01 only; existing signed deductions are preserved." />
          <ScrapChart title="Confirmed Scrap by Commodity" data={confirmed.commodities} kind="horizontal" caption="Incomplete Coverage, Unmapped and Ambiguous remain explicitly qualified." />
          <ScrapChart title="Top 10 Confirmed Scrap Stock Codes" data={confirmed.stocks.slice(0, 10)} kind="horizontal" />
        </div>
        <DetailTable data={confirmed} mappings={payload.mappings || {}} />
      </section>}
      {filters.warehouse !== 'B-SCR01' && <section className="scrap-section scrap-reg-section" aria-label="REG / Recovery Activity"><h2>REG / Recovery Activity</h2>
        <p className="scrap-notice">B-REG01 contains a mixture of regrind, off-cuts, scrap, conversion/recovery, reuse and correction activity. Values are shown separately from confirmed scrap.</p>
        <Kpis cards={[
          ['B-REG01 Activity Value', reg.totalValue, 'Unresolved REG · gross transfer value, not loss'],
          ['B-REG01 Activity Qty', reg.totalQty, 'Unresolved REG · gross transfer quantity · ' + units(reg), qty],
          ['WIP → REG Activity', reg.directions[REG_DIRECTIONS[0]].value, qty(reg.directions[REG_DIRECTIONS[0]].count) + ' transfers'],
          ['REG → WIP Activity', reg.directions[REG_DIRECTIONS[1]].value, qty(reg.directions[REG_DIRECTIONS[1]].count) + ' transfers · not assumed reversals'],
        ]} />
        <p className="scrap-caption">Scope: transfers between WIP and REG only. Activity sums transfer magnitudes in both directions; it is not net inventory or conversion loss. Other REG movement types and conversion-loss accounting are not included.</p>
        <Quality data={reg} />
        <div className="scrap-charts"><ScrapChart title="B-REG01 Activity Trend" data={reg.monthly} kind="bar" series={REG_DIRECTIONS.slice(0, 2)} caption="Separate monthly transfer directions. No scrap target applies." /><ScrapChart title="Top B-REG01 Stock Codes" data={reg.stocks.slice(0, 10)} kind="horizontal" caption="Ranked by gross activity value, not confirmed scrap cost." /></div>
        <DetailTable data={reg} mappings={payload.mappings || {}} reg />
      </section>}
    </ScrapResults>}
  </div>;
}

