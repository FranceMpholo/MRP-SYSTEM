import React, { useMemo, useState } from 'react';
import { CYCLE_COUNT_SHIFTS, REQUIRED_THERMOFORMING_SHEETS } from '../cycleCount/cycleCountUtils';
import { getOeeShiftRules } from '../oee/oeeSettings';
import { bomSourceReady } from '../bom/bomValidation';
import { dailyPhysicalCounts, dailySystemSheets } from './deriveDailySheetAnalysis';
import { useSheetAnalysisSystem } from './useSheetAnalysisSystem';
import { useSheetTailgates, useSheetBedliners } from './useSheetTailgates';
import { historicalSohValue, previousProductionDate, useSheetClosingSoh } from './useSheetClosingSoh';
import './sheetAnalysis.css';

const fmt = (value) => value == null ? '\u2014' : Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }) : 'Unavailable';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const stamp = (value) => value ? new Date(value).toLocaleString(undefined, { timeZone: 'Africa/Johannesburg' }) : 'Not recorded';
const states = { loading: 'Loading', unavailable: 'Unavailable', unavailable_by_shift: 'Unavailable by shift', mapping_unverified: 'Mapping unverified', incomplete: 'Incomplete', historical_unavailable: 'Historical SOH unavailable', cycle_in_progress: 'Shift cycle in progress' };

function Metric({ label, value, uom, caption }) {
  const details = [value?.reason, value?.uom || uom, caption,
    value?.status === 'posting_date_only' && 'by posting date | Unavailable by shift',
    value?.verifiedSubtotal !== undefined && value.status !== 'available' && `Verified subtotal: ${fmt(value.verifiedSubtotal)} finished units`,
    value?.byStockCode?.map((row) => `${row.stockCode}: ${fmt(row.quantity)}${row.unresolvedReceipts ? `; ${row.unresolvedReceipts} unresolved receipts` : ''}`).join(' | '),
  ].filter(Boolean).join(' | ');
  return <div data-sheet-metric={label}><dt>{label}</dt><dd title={details}>{value && ['available', 'posting_date_only'].includes(value.status) ? fmt(value.quantity) : states[value?.status] || 'Unavailable'}</dd></div>;
}

export default function SheetAnalysis({ cycleCountDays = [], boms = [], bomStatus, inventory = [], oeeSettings }) {
  const [date, setDate] = useState(today());
  const [views, setViews] = useState(() => Object.fromEntries(REQUIRED_THERMOFORMING_SHEETS.map((stockCode) => [stockCode, 'physical'])));
  const anySystem = Object.values(views).some((view) => view === 'system');
  const shiftRules = getOeeShiftRules(oeeSettings, 'thermoforming');
  const system = useSheetAnalysisSystem({ date, shiftRules, enabled: anySystem });
  const tailgates = useSheetTailgates({ date, shiftRules, enabled: anySystem });
  const bedliners = useSheetBedliners({ date, shiftRules, enabled: anySystem });
  const previousDate = previousProductionDate(date);
  const opening = useSheetClosingSoh({ date: previousDate, shiftRules, enabled: anySystem });
  const closing = useSheetClosingSoh({ date, shiftRules, enabled: anySystem });
  const physical = useMemo(() => dailyPhysicalCounts({ date, cycleCountDays }), [date, cycleCountDays]);
  const systemRows = useMemo(() => dailySystemSheets({ date, payload: system.payload, boms, bomAvailable: bomSourceReady(bomStatus), tailgateData: tailgates.payload, bedlinerData: bedliners.payload }), [date, system.payload, boms, bomStatus, tailgates.payload, bedliners.payload]);
  const shiftText = (shift) => { const rule = shiftRules?.[shift.planningShift]; return rule ? `${rule.start}-${rule.end}${rule.end < rule.start ? ' next day' : ''}` : 'Times unavailable'; };
  const metric = (row, name) => system.status === 'connected' ? row[name] : { status: system.status, reason: system.error };

  return <section className="sheet-analysis" aria-labelledby="sheet-analysis-title">
    <header className="sheet-analysis-header"><div><h2 id="sheet-analysis-title">Sheet Analysis</h2><p>Thermoforming &middot; {CYCLE_COUNT_SHIFTS.map((shift) => `${shift.label} ${shiftText(shift)}`).join(' | ')} (SAST)</p></div>
      <div className="sheet-analysis-filters"><label>Production date<input aria-label="Sheet Analysis production date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
    </header>
    <p className="sheet-analysis-disclosure">Physical: three submitted complete B-WIP01 closing counts. System: read-only SYSPRO postings and verified historical SOH. Overnight shifts belong to their start date. Bedliners Built uses backflush production time; Tailgates Built requires a linked finished-goods receipt.</p>
    {anySystem && <div className="sheet-analysis-system-state"><span role="status">{system.status === 'connected' ? `Postings captured ${stamp(system.payload.fetchedAt)} SAST` : system.error || 'Loading selected-day SYSPRO postings...'}</span><button type="button" className="mrp-btn mrp-btn-ghost" disabled={system.status === 'loading' || tailgates.status === 'loading' || bedliners.status === 'loading' || opening.status === 'loading' || closing.status === 'loading'} onClick={() => { system.refresh(); tailgates.refresh(); bedliners.refresh(); opening.refresh(); closing.refresh(); }}>Refresh system</button></div>}
    <div className="sheet-analysis-cards">{physical.map((row, index) => {
      const mode = views[row.stockCode];
      const posted = systemRows[index];
      const uom = posted.uom || inventory.find((item) => String(item.StockCode || item.stockCode || item.code).trim() === row.stockCode)?.StockUom || cycleCountDays.find((day) => day.date === date && day.productionLine === 'thermoforming')?.items?.find((item) => item.stockCode === row.stockCode)?.uom;
      const soh = historicalSohValue(closing, row.stockCode, date, closing.target);
      const openingSoh = historicalSohValue(opening, row.stockCode, previousDate, opening.target, { kind: 'opening' });
      const openingCaption = opening.target ? `B-WIP01 | night started ${previousDate}, closed ${opening.target.cutoffLocal.replace('T', ' ')} SAST` : 'B-WIP01 | opening cutoff unavailable';
      const cutoffCaption = closing.target ? `B-WIP01 | closes ${closing.target.cutoffLocal.replace('T', ' ')} SAST` : 'B-WIP01 | closing time unavailable';
      return <article className="sheet-analysis-card" data-stock-code={row.stockCode} data-source={mode} key={row.stockCode}>
        <header>
          <div>
            <b className="plex-mono">{row.stockCode}</b>
            {row.stockCode === '121047' && <span className="sheet-analysis-subtitle" style={{ marginLeft: 6, fontSize: '11px', color: '#746c5c', fontWeight: 500 }}>TPO Sheet</span>}
          </div>
          <span className="sheet-analysis-status">{mode === 'physical' ? `${row.status} | ${row.completedShifts}/3 submitted complete` : system.status === 'connected' ? 'System postings' : states[system.status] || 'Unavailable'}</span>
        </header>
        <dl>{mode === 'physical' ? <div data-sheet-metric="3-shift count sum"><dt>3-shift count sum</dt><dd>{row.complete ? fmt(row.quantity) : 'Incomplete'}<small>{uom || 'Stock UOM unavailable'}</small></dd></div> : <>
          <Metric label="Opening Balance of Sheets" value={openingSoh} uom={uom} caption={openingCaption} />
          <Metric label="Received Sheets" value={metric(posted, 'received')} uom={uom} caption="B-RAW01 to B-WIP01" />
          <Metric label="SOH in WIP (Closing Balance)" value={soh} uom={uom} caption={cutoffCaption} />
          <Metric label="Issued Sheets" value={metric(posted, 'issued')} uom={uom} caption="B-WIP01 inventory issues" />
          <Metric label="Scrap & Defect Sheets" value={metric(posted, 'scrap')} uom={uom} caption={`B-WIP01 to ${posted.scrapDestination}; net of verified returns/reversals`} />
          {row.stockCode === '121047' ? (
            <Metric label="TPO Built" value={metric(posted, 'tpo')} caption="posted to finished goods" />
          ) : (
            <>
            <Metric label="Bedliners Built" value={bedliners.status === 'connected' ? posted.bedliners : { status: bedliners.status, reason: bedliners.error }} caption="finished Bedliner units backflushed in B-WIP01; production timestamp; FG transfers separate" />
              <Metric label="Tailgates Built" value={tailgates.status === 'connected' ? posted.tailgates : { status: tailgates.status, reason: tailgates.error }} caption="finished units from verified B-WIP01 backflush consumption received into B-FIN01" />
            </>
          )}
        </>}</dl>
        <div className="sheet-analysis-card-actions sheet-analysis-switch" role="group" aria-label={`View for sheet ${row.stockCode}`}>{['physical', 'system'].map((view) => <button type="button" key={view} aria-pressed={mode === view} className={mode === view ? 'active' : ''} onClick={() => setViews((current) => ({ ...current, [row.stockCode]: view }))}>{view === 'physical' ? 'Physical' : 'System'}</button>)}</div>
      </article>;
    })}</div>
  </section>;
}
