import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Plus, Search, Trash2 } from "lucide-react";
import { reasonLabel } from "./cycleCountReasons";
import {
  CYCLE_COUNT_SHIFTS,
  CYCLE_COUNT_WAREHOUSE,
  REQUIRED_THERMOFORMING_SHEETS,
  addDailyItem,
  canSubmitCycleCountShift,
  createCycleCountDay,
  formatQuantity,
  getCycleCountDisplayItems,
  getCycleCountComparison,
  getCycleCountRecords,
  getRequiredSheetProgress,
  hasDuplicateCycleCountRecords,
  hasPhysicalCount,
  inventoryCode,
  inventoryDescription,
  inventoryUom,
  isValidPhysicalQuantity,
  prepareCycleCountShift,
  removeDailyItem,
  submitCycleCountShift,
} from "./cycleCountUtils";
import { PRODUCTION_LINES } from "../production/productionLines";
import { getOeeShiftRules } from "../oee/oeeSettings";
import { useCycleCountMovements } from "./useCycleCountMovements";
import { movementDisplay } from "./cycleCountMovements";
import "./cycleCount.css";

const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const userName = (users, id) => users.find((user) => user.id === id)?.fullName || "Unassigned";
const normalizeCode = (value) => String(value ?? "").trim().toLocaleUpperCase();
const matches = (item, term) => [inventoryCode(item), inventoryDescription(item), inventoryUom(item)].some((value) => value.toLocaleLowerCase().includes(term));

function MaterialSearch({ inventory, status, selectedItems, disabled, onAdd, compact = false }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const selectedCodes = useMemo(() => new Set(selectedItems.map((item) => normalizeCode(item.stockCode))), [selectedItems]);
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term || status !== "connected") return [];
    return inventory.filter((item) => !selectedCodes.has(normalizeCode(inventoryCode(item))) && matches(item, term)).slice(0, 30);
  }, [inventory, query, selectedCodes, status]);
  function add() {
    if (!selected || disabled) return;
    onAdd(selected);
    setSelected(null);
    setQuery("");
  }
  return <div className={`cc-material-search${compact ? " compact" : ""}`}>
    <b>ADD OPTIONAL MATERIAL</b>
    <div className="cc-search"><Search size={15} /><input value={query} disabled={status !== "connected" || disabled} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="Search stock code or description..." /></div>
    {['loading', 'checking', 'reconnecting'].includes(status) && <p className="cc-search-state">Checking SYSPRO stock codes...</p>}
    {status === "offline" && <p className="cc-search-state error">Stock-code search unavailable — SYSPRO inventory is offline.</p>}
    {status === "connected" && query.trim() && !selected && <div className="cc-results">{results.map((item) => <button type="button" key={inventoryCode(item)} onClick={() => { setSelected(item); setQuery(inventoryCode(item)); }}><b>{inventoryCode(item)}</b><span>{inventoryDescription(item)}</span><small>UOM: {inventoryUom(item) || "Unavailable"}</small></button>)}{!results.length && <p>No matching unselected stock codes.</p>}</div>}
    {selected && <div className="cc-selected-material"><div><b>{inventoryCode(selected)}</b><span>{inventoryDescription(selected)}</span><small>UOM: {inventoryUom(selected) || "Unavailable"}</small></div><button type="button" className="mrp-btn mrp-btn-primary" disabled={disabled} onClick={add}><Plus size={14} /> Add to Cycle Count</button></div>}
    {disabled && status === "connected" && <p className="cc-search-state">Materials cannot be added after a shift has been submitted.</p>}
  </div>;
}

export default function CycleCount({ days, setDays, inventory, inventoryStatus, productionLine, oeeSettings, users, currentUser, canSetup, canCount, canReopen }) {
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState("entry");
  const [shift, setShift] = useState("morning");
  const [setupOpen, setSetupOpen] = useState(false);
  const [quantityError, setQuantityError] = useState("");
  const [eosState, setEosState] = useState({ key: "", status: "loading", data: [], error: "" });
  const [eosRefresh, setEosRefresh] = useState(0);
  const movements = useCycleCountMovements({ date, shift, summary: mode === "summary", shiftRules: getOeeShiftRules(oeeSettings, productionLine), enabled: productionLine === "thermoforming" });
  const day = days.find((entry) => entry.date === date && entry.productionLine === productionLine);
  const assignment = day?.shifts?.find((entry) => entry.shift === shift);
  const mayEditCount = canReopen || canCount;
  const locked = Boolean(assignment?.submittedAt);
  const items = getCycleCountDisplayItems(day, inventory);
  const records = getCycleCountRecords(day, shift);
  const counted = records.filter((record) => isValidPhysicalQuantity(record.physicalCount)).length;
  const requiredProgress = getRequiredSheetProgress(day, shift);
  const duplicateRecords = hasDuplicateCycleCountRecords(day, shift);
  const listLocked = day?.shifts?.some((entry) => entry.submittedAt);
  const stockCodes = items.map((item) => normalizeCode(item.stockCode)).sort().join(",");
  const eosKey = `${date}|${stockCodes}`;
  const eosBalances = eosState.key === eosKey ? eosState.data : [];
  const eosLoading = eosState.key !== eosKey || eosState.status === "loading";

  useEffect(() => {
    if (!stockCodes) return;
    const controller = new AbortController();
    setEosState({ key: eosKey, status: "loading", data: [], error: "" });
    fetch(`/api/syspro/cycle-count/eos?${new URLSearchParams({ date, stockCodes })}`, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error || "Historical shift-close balances are unavailable.");
        if (!controller.signal.aborted) setEosState({ key: eosKey, status: "connected", data: payload.data, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setEosState({ key: eosKey, status: "offline", data: [], error: error.message });
      });
    return () => controller.abort();
  }, [date, stockCodes, eosKey, eosRefresh]);

  useEffect(() => {
    if (productionLine !== "thermoforming") return;
    setDays((current) => {
      const existing = current.find((entry) => entry.date === date && entry.productionLine === productionLine);
      if (!existing) return [...current, createCycleCountDay(date, productionLine, currentUser.id, inventory)];
      const next = prepareCycleCountShift(existing, shift, inventory, currentUser.id);
      return next === existing ? current : current.map((entry) => entry.id === existing.id ? next : entry);
    });
  }, [date, productionLine, shift, inventory, currentUser.id, setDays]);

  function updateDay(mutator) {
    setDays((current) => {
      const existing = current.find((entry) => entry.date === date && entry.productionLine === productionLine);
      if (!existing) return current;
      const next = mutator(existing);
      return current.map((entry) => entry.id === existing.id ? next : entry);
    });
  }

  function ensureDay() {
    if (!canSetup || day) return;
    setDays((current) => current.some((entry) => entry.date === date && entry.productionLine === productionLine)
      ? current
      : [...current, createCycleCountDay(date, productionLine, currentUser.id, inventory)]);
  }

  function addItem(item) {
    if (canSetup && !listLocked) updateDay((current) => addDailyItem(current, item, currentUser.id));
  }

  function removeItem(stockCode) {
    if (canSetup && !listLocked) updateDay((current) => removeDailyItem(current, stockCode, currentUser.id));
  }

  function updateRecord(stockCode, field, value) {
    if (!mayEditCount || locked) return;
    if (field === "physicalCount" && value !== null && !isValidPhysicalQuantity(value)) {
      setQuantityError("Enter a finite, non-negative quantity with up to four decimal places.");
      return;
    }
    setQuantityError("");
    updateDay((current) => ({
      ...current,
      countRecords: current.countRecords.map((record) => {
        if (record.shift !== shift || normalizeCode(record.stockCode) !== normalizeCode(stockCode)
            || normalizeCode(record.warehouse || CYCLE_COUNT_WAREHOUSE) !== CYCLE_COUNT_WAREHOUSE) return record;
        const now = new Date().toISOString();
        const next = {
          ...record,
          [field]: value,
          productionDate: record.productionDate || current.date,
          productionLine: record.productionLine || current.productionLine,
          warehouse: record.warehouse || CYCLE_COUNT_WAREHOUSE,
          location: record.location ?? null,
          updatedByUserId: currentUser.id,
          updatedAt: now,
        };
        if (field === "physicalCount") {
          const balance = eosBalances.find((entry) => normalizeCode(entry.stockCode) === normalizeCode(stockCode) && entry.shift === shift);
          const comparison = getCycleCountComparison(next, balance, current.date, shift);
          next.expectedEosSoh = comparison.expectedEosSoh;
          next.expectedEosSource = comparison.expectedEosSoh === null ? null : balance.source;
          next.expectedEosCutoffAt = comparison.expectedEosSoh === null ? null : balance.cutoffAt;
          next.expectedEosFetchedAt = comparison.expectedEosSoh === null ? null : balance.fetchedAt;
          next.variance = comparison.variance;
          next.status = comparison.status;
          next.countedByUserId = hasPhysicalCount(value) ? currentUser.id : null;
          next.countedAt = hasPhysicalCount(value) ? (record.countedAt || now) : null;
        }
        return next;
      }),
      updatedByUserId: currentUser.id,
      updatedAt: new Date().toISOString(),
    }));
  }

  function submitShift() {
    if (!mayEditCount || locked) return;
    if (!canSubmitCycleCountShift(day, shift)) {
      setQuantityError("Every listed sheet and all three required Thermoforming sheets need a valid count before submission.");
      return;
    }
    if (records.some((record) => record.reasonCode === "OTHER" && !String(record.reasonComment || "").trim())) {
      window.alert("A comment is required when the reason is Other.");
      return;
    }
    updateDay((current) => submitCycleCountShift(current, shift, currentUser.id));
    setQuantityError("");
  }

  const header = <>
    <header className="cc-header"><div><span>Cycle Count</span><h1>{PRODUCTION_LINES[productionLine]?.name} — Cycle Count</h1><p>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</p></div><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></header>
    <div className="cc-scope">Count scope: <b>{CYCLE_COUNT_WAREHOUSE}</b> · Location is not captured by the current cycle-count source. Counts are not duplicated to other warehouses.</div>
    <div className="cc-eos-source"><div><b>EOS SOH: selected shift close</b><span>Morning 15:00 · Afternoon 22:00 · Night 06:00 next day (SAST). Reconstructed from SYSPRO entry dates/times; later backdated postings can revise balances.</span><span>{eosLoading ? "Loading historical balances…" : eosState.error || "Balances require reconciled movement history. Unclosed shifts and incomplete history show Unavailable."}</span></div><button type="button" className="mrp-btn" disabled={eosLoading || !stockCodes} onClick={() => setEosRefresh((value) => value + 1)}>Refresh EOS</button></div>
    {productionLine === "thermoforming" && <div className="cc-eos-source cc-movement-source"><div><b>SYSPRO shift movements · Read only</b><span>{movements.requests?.map((entry) => `${CYCLE_COUNT_SHIFTS.find((s) => s.id === entry.shift)?.label} ${entry.start}–${entry.end}${entry.end < entry.start ? " next day" : ""}`).join(" · ") || "Check configured shift times"} (SAST). Overnight shifts belong to their start date.</span><span>Qty Received: verified B-RAW01 → B-WIP01 receipt legs. Total Issue: B-WIP01 inventory issues. Signed reversals reduce totals; transfers out are excluded. Totals are in stock UOM and may change with later postings.</span><span>Physical counts can be entered and submitted while SYSPRO is unavailable.</span></div><button type="button" className="mrp-btn" disabled={movements.loading} onClick={movements.refresh}>Refresh movements</button></div>}
    <div className="cc-mode"><button className={mode === "entry" ? "active" : ""} onClick={() => setMode("entry")}>Count Entry</button><button className={mode === "summary" ? "active" : ""} onClick={() => setMode("summary")}>Daily Summary</button>{canSetup && day && <button onClick={() => setSetupOpen(!setupOpen)}>Daily Setup</button>}</div>
  </>;

  if (!day) return <div className="cycle-count">{header}<div className="cc-empty"><ClipboardCheck size={34} /><h2>{productionLine === "thermoforming" ? "Preparing shift count" : "No cycle count plan"}</h2><p>{productionLine === "thermoforming" ? "Required sheets are being prepared for this date and shift." : "Create the shared daily material list for this date and production line."}</p>{productionLine !== "thermoforming" && canSetup && <button className="mrp-btn mrp-btn-primary" onClick={ensureDay}><Plus size={15} /> Create Daily Count</button>}</div></div>;

  return <div className="cycle-count">{header}
    {setupOpen && canSetup && <section className="cc-setup"><h2>Daily Setup</h2><MaterialSearch inventory={inventory} status={inventoryStatus} selectedItems={items} disabled={listLocked} onAdd={addItem} compact /><table className="mrp-table"><thead><tr><th>Stock Code</th><th>Description</th><th>UOM</th><th>Requirement</th><th /></tr></thead><tbody>{items.map((item) => { const required = productionLine === "thermoforming" && REQUIRED_THERMOFORMING_SHEETS.includes(normalizeCode(item.stockCode)); return <tr key={normalizeCode(item.stockCode)}><td className="plex-mono">{item.stockCode}</td><td>{item.description || "—"}</td><td>{item.uom || "—"}</td><td>{required ? "Required each shift" : "Optional"}</td><td>{!required && <button type="button" className="cc-icon" disabled={listLocked} aria-label={`Remove ${item.stockCode}`} onClick={() => removeItem(item.stockCode)}><Trash2 size={14} /></button>}</td></tr>; })}</tbody></table></section>}
    {mode === "entry" ? <>
      <div className="cc-shifts">{CYCLE_COUNT_SHIFTS.map((item) => <button type="button" key={item.id} className={shift === item.id ? "active" : ""} onClick={() => { setShift(item.id); setQuantityError(""); }}>{item.label}</button>)}</div>
      <section className="cc-assignment">
        {productionLine === "thermoforming" && <div className="cc-progress required-progress"><b>{requiredProgress.counted} of {requiredProgress.required} required sheets counted</b><span>{requiredProgress.missingRows.length ? `${requiredProgress.missingRows.length} required rows missing` : `${requiredProgress.required - requiredProgress.counted} required outstanding`}</span></div>}
        <div className="cc-progress"><b>{counted} / {items.length} Counted</b><span>{Math.max(0, items.length - counted)} Outstanding</span></div>
        {locked && <div className="cc-submitted"><CheckCircle2 size={16} /> Submitted by {userName(users, assignment.submittedByUserId)} · {new Date(assignment.submittedAt).toLocaleString()}</div>}
        {requiredProgress.legacyIncomplete && <div className="cc-legacy" role="status">Legacy incomplete: this historical shift was submitted without all three required sheets. Existing values have been preserved.</div>}
        {duplicateRecords && <div className="cc-legacy" role="alert">Duplicate stock-code rows exist in this saved shift scope. They are displayed once and submission is blocked until the saved data is reviewed.</div>}
      </section>
      {canSetup && <MaterialSearch inventory={inventory} status={inventoryStatus} selectedItems={items} disabled={listLocked} onAdd={addItem} />}
      {!items.length ? <div className="cc-no-materials"><b>No stock codes selected for this Cycle Count.</b><span>Search above to add an optional stock code, or use Daily Setup to build the full count list.</span></div> : <CountTable day={day} shift={shift} movements={movements.shifts} eosBalances={eosBalances} items={items} records={records} users={users} mayEditCount={mayEditCount} locked={locked} productionLine={productionLine} updateRecord={updateRecord} quantityError={quantityError} />}
      {quantityError && <div className="cc-input-error" role="alert">{quantityError}</div>}
      <div className="cc-submit"><button type="button" className="mrp-btn mrp-btn-primary" disabled={!mayEditCount || locked || !canSubmitCycleCountShift(day, shift)} onClick={submitShift}>Submit Shift Count</button></div>
    </> : <DailySummary day={day} movements={movements.shifts} eosBalances={eosBalances} items={items} users={users} productionLine={productionLine} />}
  </div>;
}

function MovementCell({ state, stockCode, metric }) {
  const display = movementDisplay(state, normalizeCode(stockCode), metric);
  return <td className="plex-mono cc-movement" data-movement={metric} title={display.reason}>{display.text ?? formatQuantity(display.quantity)}</td>;
}

function CountTable({ day, shift, movements, eosBalances, items, records, users, mayEditCount, locked, productionLine, updateRecord, quantityError }) {
  return <div className="cc-table-wrap"><table className="mrp-table cc-entry"><thead><tr><th>Stock Code</th><th>Description</th><th>UOM</th><th>Warehouse</th><th>EOS SOH</th><th>Physical Count</th>{productionLine === "thermoforming" && <><th>Qty Received</th><th>Total Issue</th></>}<th>Variance</th><th>Status</th></tr></thead><tbody>{items.map((item) => {
    const savedRecord = records.find((entry) => normalizeCode(entry.stockCode) === normalizeCode(item.stockCode) && normalizeCode(entry.warehouse || CYCLE_COUNT_WAREHOUSE) === CYCLE_COUNT_WAREHOUSE);
    const balance = eosBalances.find((entry) => normalizeCode(entry.stockCode) === normalizeCode(item.stockCode) && entry.shift === shift);
    const record = savedRecord && { ...savedRecord, ...getCycleCountComparison(savedRecord, balance, day.date, shift) };
    const required = productionLine === "thermoforming" && REQUIRED_THERMOFORMING_SHEETS.includes(normalizeCode(item.stockCode));
    const description = item.description || "";
    const quantity = record?.physicalCount ?? "";
    return <tr key={normalizeCode(item.stockCode)}><td className="plex-mono">{item.stockCode}{required && <span className="cc-required-tag">Required each shift</span>}</td><td>{description || "—"}</td><td>{item.uom || "—"}</td><td>{record?.warehouse || CYCLE_COUNT_WAREHOUSE}</td><td className="plex-mono" title={balance?.reason || balance?.cutoffAt}>{record?.expectedEosSoh == null ? "Unavailable" : formatQuantity(record.expectedEosSoh)}</td><td><input aria-label={`Physical count ${item.stockCode}`} type="number" min="0" step="0.0001" value={quantity} disabled={!mayEditCount || locked || !record} aria-invalid={Boolean(quantityError)} onChange={(event) => {
      const value = event.target.value === "" ? null : event.target.value;
      if (value !== null && !isValidPhysicalQuantity(value)) {
        updateRecord(item.stockCode, "physicalCount", value);
        return;
      }
      updateRecord(item.stockCode, "physicalCount", value === null ? null : Number(value));
    }} /></td>{productionLine === "thermoforming" && <><MovementCell state={movements[shift]} stockCode={item.stockCode} metric="qtyReceived" /><MovementCell state={movements[shift]} stockCode={item.stockCode} metric="totalIssue" /></>}<td className={`plex-mono variance ${record?.variance < 0 ? "negative" : record?.variance > 0 ? "positive" : ""}`}>{record?.variance > 0 ? "+" : ""}{formatQuantity(record?.variance)}</td><td><span className={`cc-status ${record?.status?.toLowerCase()}`}>{record?.status?.replaceAll("_", " ") || "LEGACY MISSING"}</span>{record?.countedAt && <small className="cc-count-audit">Counted by {userName(users, record.countedByUserId)} · {new Date(record.countedAt).toLocaleString()}</small>}</td></tr>;
  })}</tbody></table></div>;
}

function DailySummary({ day, movements, eosBalances, items, users, productionLine }) {
  return <><div className="cc-summary-assignments">{CYCLE_COUNT_SHIFTS.map((shift) => {
    const assignment = day.shifts?.find((entry) => entry.shift === shift.id);
    const progress = getRequiredSheetProgress(day, shift.id);
    const submitted = Boolean(assignment?.submittedAt);
    return <div key={shift.id}><b>{shift.label}</b>{productionLine === "thermoforming" && <span>{progress.counted} of 3 required sheets counted</span>}{progress.legacyIncomplete && <strong className="cc-legacy-label">Legacy incomplete</strong>}{submitted ? <span>Submitted by {userName(users, assignment.submittedByUserId)} · {new Date(assignment.submittedAt).toLocaleString()}</span> : <span>{canSubmitCycleCountShift(day, shift.id) ? "Ready to submit" : "Incomplete draft"}</span>}</div>;
  })}</div><div className="cc-table-wrap"><table className="mrp-table cc-summary"><thead><tr><th rowSpan="2">Stock Code</th><th rowSpan="2">Description</th><th rowSpan="2">UOM</th>{CYCLE_COUNT_SHIFTS.map((shift) => <th key={shift.id} colSpan={productionLine === "thermoforming" ? 6 : 4}>{shift.label}</th>)}</tr><tr>{CYCLE_COUNT_SHIFTS.flatMap((shift) => ["EOS SOH", "Physical / Recorder", ...(productionLine === "thermoforming" ? ["Qty Received", "Total Issue"] : []), "Variance", "Reason"].map((label) => <th key={`${shift.id}-${label}`}>{label}</th>))}</tr></thead><tbody>{items.map((item) => <tr key={normalizeCode(item.stockCode)}><td className="plex-mono">{item.stockCode}{productionLine === "thermoforming" && REQUIRED_THERMOFORMING_SHEETS.includes(normalizeCode(item.stockCode)) && <span className="cc-required-tag">Required each shift</span>}</td><td>{item.description || "—"}</td><td>{item.uom || "—"}</td>{CYCLE_COUNT_SHIFTS.flatMap((shift) => {
    const savedRecord = getCycleCountRecords(day, shift.id).find((entry) => normalizeCode(entry.stockCode) === normalizeCode(item.stockCode));
    const balance = eosBalances.find((entry) => normalizeCode(entry.stockCode) === normalizeCode(item.stockCode) && entry.shift === shift.id);
    const record = savedRecord && { ...savedRecord, ...getCycleCountComparison(savedRecord, balance, day.date, shift.id) };
    return [
      <td key={`${shift.id}-e`} className="plex-mono" title={balance?.reason || balance?.cutoffAt}>{record?.expectedEosSoh == null ? "Unavailable" : formatQuantity(record.expectedEosSoh)}</td>,
      <td key={`${shift.id}-p`} className="plex-mono">{formatQuantity(record?.physicalCount)}{record?.countedAt && <small className="cc-count-audit">{userName(users, record.countedByUserId)} · {new Date(record.countedAt).toLocaleString()}</small>}</td>,
      ...(productionLine === "thermoforming" ? [<MovementCell key={`${shift.id}-received`} state={movements[shift.id]} stockCode={item.stockCode} metric="qtyReceived" />, <MovementCell key={`${shift.id}-issue`} state={movements[shift.id]} stockCode={item.stockCode} metric="totalIssue" />] : []),
      <td key={`${shift.id}-v`} className={`plex-mono ${record?.variance < 0 ? "negative" : record?.variance > 0 ? "positive" : ""}`}>{record?.variance > 0 ? "+" : ""}{formatQuantity(record?.variance)}</td>,
      <td key={`${shift.id}-r`}>{reasonLabel(record?.reasonCode)}</td>,
    ];
  })}</tr>)}</tbody></table></div></>;
}
