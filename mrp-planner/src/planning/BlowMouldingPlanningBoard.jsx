import React, { useMemo, useRef, useState } from "react";
import { Download, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import ShiftPlanningEditor from "./ShiftPlanningEditor";
import { exportPlanningBoard } from "./exportPlanningBoard";
import {
  SHIFTS, addCalendarDays, cellKey, planningAlias as blowPlanningAlias,
  buildPlanningParents, getISOWeek, mondayOf, parentMatches, summarize,
} from "./planningBoardUtils";
import "./planningBoard.css";
import { PRODUCTION_LINES, classifyThermoformingParent, deriveThermoformingParents, getThermoformingDisplayCode, thermoformingParents, unavailableAr3Aliases } from "../production/productionLines";
import { getEffectivePlanQty, getOriginalPlanQty, hasPlanAdjustment } from "./planQuantities";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const formatDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
const displayMachine = (machine) => machine.replace("BM0", "BM");

export default function BlowMouldingPlanningBoard({ planning, setPlanning, onWeekChange, logo, items, boms, editable = true, canAdjust = false, onAdjustPlan, currentUserId, productionLine = "blowMoulding", bomStatus, onRefreshBom }) {
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [plannedSearch, setPlannedSearch] = useState("");
  const reportRef = useRef(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addCalendarDays(planning.weekStart, index)), [planning.weekStart]);
  const entriesByKey = useMemo(() => {
    const map = new Map();
    planning.entries.forEach((entry) => { const key = cellKey(entry); map.set(key, [...(map.get(key) || []), entry]); });
    return map;
  }, [planning.entries]);
  const summary = useMemo(() => summarize(planning.entries), [planning.entries]);
  const line = PRODUCTION_LINES[productionLine];
  const MACHINES = Object.keys(line.machines);
  const planningAlias = (code) => productionLine === "thermoforming" ? getThermoformingDisplayCode(code) : blowPlanningAlias(code);
  const allParents = useMemo(() => buildPlanningParents(items, boms), [items, boms]);
  const parents = editing && productionLine === "thermoforming" ? thermoformingParents(items, boms, editing.cell.machine) : allParents;
  const sysproParentCount = useMemo(() => new Set(boms.map((row) => String(row.parentStockCode || "").trim().toUpperCase()).filter(Boolean)).size, [boms]);
  const thermoParentCount = useMemo(() => deriveThermoformingParents({ sysproBomRows: boms, machine: "AR3" }).length, [boms]);
  const parentsByCode = useMemo(() => new Map(parents.map((parent) => [parent.stockCode, parent])), [parents]);
  const { week, year } = getISOWeek(planning.weekStart);
  const end = days[6];

  function saveEntries(entries) {
    try {
      const now = new Date().toISOString();
      setPlanning((prev) => {
        const key = cellKey(entries[0]); const existingById = new Map(prev.entries.map((entry) => [entry.id, entry]));
        const saved = entries.map((entry) => { const existing = existingById.get(entry.id), classification = productionLine === "thermoforming" ? classifyThermoformingParent(entry.partNumber) : null; const originalPlanQty = Number(entry.buildQty) || 0; return { ...entry, originalPlanQty, buildQty: originalPlanQty, productionLine, weekStart: planning.weekStart, parentItemId: productionLine === "thermoforming" ? items.find((item) => item.code === entry.partNumber)?.id : undefined, parentStockCode: productionLine === "thermoforming" ? entry.partNumber : undefined, productFamily: classification?.family, market: classification?.market, createdByUserId: existing?.createdByUserId || currentUserId, updatedByUserId: currentUserId, createdAt: existing?.createdAt || now, updatedAt: now }; });
        return { ...prev, entries: [...prev.entries.filter((entry) => cellKey(entry) !== key), ...saved] };
      });
      setEditing(null);
      setMessage("");
    } catch (error) { setMessage(error.message); }
  }

  async function download() {
    setExporting(true); setMessage("");
    try { await exportPlanningBoard(reportRef.current, planning.weekStart); }
    catch (error) { setMessage(error.message); }
    finally { setExporting(false); }
  }

  const renderCell = (machine, day, shift) => {
    const cell = { machine, day, shift, weekday: DAY_NAMES[days.indexOf(day)] };
    const entries = entriesByKey.get(cellKey(cell)) || []; const entry = entries[0];
    const type = entry?.status === "OFF" ? "off" : entries.length ? "production" : "empty";
    const searchActive = Boolean(plannedSearch.trim()) && Boolean(entry?.partNumber) && getEffectivePlanQty(entry) > 0;
    const searchParent = entry ? (parentsByCode.get(entry.partNumber) || { stockCode: entry.partNumber, description: "", alias: planningAlias(entry.partNumber) }) : null;
    const isMatch = searchActive && parentMatches(searchParent, plannedSearch);
    return <td key={`${day}-${shift}`}><button type="button" className={`bm-cell ${type}${isMatch ? " search-match" : searchActive ? " search-dim" : ""}`} onClick={() => (editable || canAdjust) && setEditing({ cell, entries })} aria-label={`${editable ? "Edit" : canAdjust ? "Adjust" : "View"} ${displayMachine(machine)} ${day} ${shift}`}>
      {type === "off" ? <span>OFF</span> : entries.map((run) => <span className="bm-cell-run" key={run.id}>{run.status === "Changeover" ? run.partNumber ? "C/O → " : "C/O " : ""}<span>{planningAlias(run.partNumber)}</span>{hasPlanAdjustment(run) ? <><b>{getOriginalPlanQty(run).toLocaleString()} → {getEffectivePlanQty(run).toLocaleString()}</b><em>ADJ</em></> : getOriginalPlanQty(run) > 0 && <b>{getOriginalPlanQty(run).toLocaleString()}</b>}</span>)}
    </button></td>;
  };

  return <div className="bm-planning">
    <div className="bm-toolbar">
      <div className="bm-toolbar-group"><button onClick={() => onWeekChange(addCalendarDays(planning.weekStart, -7))}><ChevronLeft size={15} /> Previous Week</button><button className="bm-current" onClick={() => onWeekChange(mondayOf(new Date()))}><CalendarDays size={15} /> Current Week</button><button onClick={() => onWeekChange(addCalendarDays(planning.weekStart, 7))}>Next Week <ChevronRight size={15} /></button><input className="bm-planned-search" value={plannedSearch} onChange={(event) => setPlannedSearch(event.target.value)} placeholder="Search planned parent..." aria-label="Search planned parent" /></div>
      <button className="bm-export" disabled={exporting} onClick={download}><Download size={15} /> {exporting ? "Exporting…" : "Export PNG"}</button>
    </div>
    <div className="bm-syspro-status"><div><strong>SYSPRO BOM · {bomStatus?.loading ? "Loading" : bomStatus?.connected ? "Connected" : bomStatus?.error ? "Error" : "Offline"}</strong><span>{sysproParentCount.toLocaleString()} parents loaded{productionLine === "thermoforming" ? ` · ${thermoParentCount.toLocaleString()} Thermoforming parents identified` : ""}{bomStatus?.lastUpdated ? ` · Last refreshed: ${bomStatus.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span>{!bomStatus?.connected && <span>Parent selection depends on live SYSPRO BOM data.</span>}</div><button type="button" onClick={onRefreshBom} disabled={bomStatus?.loading}>Refresh SYSPRO BOM</button></div>
    {!editable && <div className="bm-error" style={{ background: "#E1EBE3", color: "#2F6F4E" }}>{canAdjust ? "Original plans are read-only · Select a run to adjust its effective plan" : "Read-only planning access"}</div>}
    {message && <div className="bm-error">{message}</div>}
    <div className="bm-scroll">
      <section className="bm-report" ref={reportRef}>
        <header className="bm-report-header"><div className="bm-title-wrap">{logo && <img className="bm-logo" src={logo} alt="ATD" />}<div className="bm-report-title">{line.name.toUpperCase()} PRODUCTION PLAN</div></div><div className="bm-report-meta">CW{week} · {year}<br />{formatDate(planning.weekStart)} – {formatDate(end)}</div></header>
        <table className="bm-grid"><thead><tr><th rowSpan="2" style={{ width: 76 }}>Machine</th><th rowSpan="2" style={{ width: 50 }}>Shift</th>{days.map((day, i) => <th key={day}>{DAY_NAMES[i]}<br />{formatDate(day)}</th>)}</tr><tr>{days.map((day) => <th key={day}>Production activity</th>)}</tr></thead>
          <tbody>{MACHINES.flatMap((machine) => SHIFTS.map((shift, shiftIndex) => <tr key={`${machine}-${shift}`}>{shiftIndex === 0 && <th className="machine" rowSpan="3">{displayMachine(machine)}</th>}<th className="shift">{shift.replace("SHIFT 0", "S")}</th>{days.map((day) => renderCell(machine, day, shift))}</tr>))}</tbody>
        </table>
        <div className="bm-summary">{summary.length ? summary.map((item) => <span key={item.partNumber}>{item.alias} {item.buildQty.toLocaleString()}</span>) : <span>No production assigned</span>}</div>
        <div className="bm-legend"><span><i className="bm-swatch" style={{ background: "#fff" }} />Production</span><span><i className="bm-swatch" style={{ background: "#dc5b54" }} />OFF</span><span><i className="bm-swatch" style={{ background: "#f3cf58" }} />Changeover</span><span><i className="bm-swatch" style={{ background: "#f0f1ef" }} />Unassigned</span></div>
      </section>
    </div>
    {editing && <ShiftPlanningEditor {...editing} parents={parents} productionLine={productionLine} bomStatus={bomStatus} missingAliases={editing.cell.machine === "AR3" ? unavailableAr3Aliases(boms) : []} editable={editable} canAdjust={canAdjust} onAdjustPlan={onAdjustPlan} onSave={saveEntries} onClose={() => setEditing(null)} />}
  </div>;
}
