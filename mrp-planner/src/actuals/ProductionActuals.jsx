import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { SHIFTS, addCalendarDays, getISOWeek, mondayOf, planningAlias as blowPlanningAlias } from "../planning/planningBoardUtils";
import { deriveMaterialReconciliation } from "../reconciliation/deriveMaterialReconciliation";
import "./productionActuals.css";
import { PRODUCTION_LINES, classifyThermoformingParent, deriveThermoformingOutput, getThermoformingDisplayCode } from "../production/productionLines";

const fmt = (value) => value === null || value === undefined ? "—" : (Math.round((Number(value) + Number.EPSILON) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const dayName = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "short" });
const nextDay = (day) => addCalendarDays(day, 1);
const machineLabel = (machine) => machine.replace("BM0", "BM");
const tones = { "Data incomplete": ["#F3E1DE", "#A6362B"], "Pending BKF": ["#FFF1C7", "#765400"], "Consumption variance": ["#F3E1DE", "#A6362B"], "Stock balance variance": ["#F1E3D3", "#8C4A15"], Tied: ["#E1EBE3", "#2F6F4E"] };

function ReconciliationSection({ actuals, planning, items, boms, sysproTransactions, openingWipBalances, closingWipBalances, tolerances, day }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const entriesById = useMemo(() => new Map((planning.entries || []).map((entry) => [entry.id, entry])), [planning.entries]);
  const enrichedActuals = useMemo(() => actuals.map((actual) => {
    const plan = entriesById.get(actual.planningEntryId);
    return plan ? { ...plan, ...actual, partNumber: plan.partNumber, day: plan.day, machine: plan.machine, shift: plan.shift, actualDateTime: `${plan.day}T12:00:00` } : actual;
  }), [actuals, entriesById]);
  const period = useMemo(() => ({ day, dateFrom: `${day}T00:00:00`, dateTo: `${nextDay(day)}T00:00:00` }), [day]);
  const result = useMemo(() => deriveMaterialReconciliation({ productionActuals: enrichedActuals, items, boms, sysproTransactions, openingWipBalances, closingWipBalances, tolerances, period }), [enrichedActuals, items, boms, sysproTransactions, openingWipBalances, closingWipBalances, tolerances, period]);
  return <section className="actual-reconciliation">
    <button className="actual-section-toggle" onClick={() => setOpen(!open)}><div><strong>Material Reconciliation</strong><span>Expected consumption and Syspro/WIP variance review</span></div><ChevronDown size={18} style={{ transform: open ? "rotate(180deg)" : "none" }} /></button>
    {open && <div className="actual-reconciliation-body">
      {!sysproTransactions.length && <div className="actual-data-warning">Syspro transactions and period WIP snapshots are not connected. Expected consumption is available; rows show Data incomplete until live inputs arrive.</div>}
      <div className="actual-summary">{Object.entries({ "Materials Checked": result.summary.materialsChecked, Tied: result.summary.tied, "Consumption Variances": result.summary.consumptionVariances, "Stock Balance Variances": result.summary.stockBalanceVariances, "Pending BKF": result.summary.pendingBkf, "Data Issues": result.summary.dataIssues }).map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
      <div className="actual-table-scroll"><table className="mrp-table actual-recon-table"><thead><tr><th>Stock Code</th><th>Description</th><th>Expected</th><th>System</th><th>Consumption Variance</th><th>Closing WIP Variance</th><th>Status</th><th></th></tr></thead><tbody>
        {result.rows.map((row) => <React.Fragment key={row.stockCode}><tr><td className="plex-mono">{row.stockCode}</td><td>{row.description}</td><td className="plex-mono">{fmt(row.expectedConsumptionQty)}</td><td className="plex-mono">{fmt(row.systemConsumptionQty)}</td><td className="plex-mono">{fmt(row.consumptionVarianceQty)}</td><td className="plex-mono">{fmt(row.stockBalanceVarianceQty)}</td><td><span style={{ background: tones[row.status]?.[0], color: tones[row.status]?.[1] }}>{row.status}</span></td><td><button className="mrp-btn mrp-btn-ghost" onClick={() => setExpanded(expanded === row.stockCode ? null : row.stockCode)}>Details</button></td></tr>
        {expanded === row.stockCode && <tr><td colSpan={8} className="actual-detail"><div><b>Expected Consumption</b>{row.drillDown.parentBomContributions.map((c, i) => <p key={i} className="plex-mono">{c.machine} {c.shift}: {c.parentStockCode} × {fmt(c.actualMouldQty)} × {fmt(c.bomQtyPer)} = {fmt(c.expectedQty)}</p>)}</div><div><b>Syspro Consumption</b>{row.drillDown.sysproConsumptionTransactions.map((t) => <p key={t.transactionId} className="plex-mono">{t.transactionTime} {t.transactionType} {fmt(t.quantity)}</p>)}</div><div><b>WIP Balance</b><p className="plex-mono">Opening {fmt(row.openingWipQty)}<br />Incoming +{fmt(row.incomingWipQty)}<br />Outgoing -{fmt(row.outgoingWipQty)}<br />Expected Closing {fmt(row.expectedClosingWipQty)}<br />Actual Closing {fmt(row.actualClosingWipQty)}</p></div></td></tr>}</React.Fragment>)}
        {!result.rows.length && <tr><td colSpan={8}>No actual production or material activity for this day.</td></tr>}
      </tbody></table></div>
    </div>}
  </section>;
}

export default function ProductionActuals({ actuals, setActuals, planning, onWeekChange, items, boms, sysproTransactions, openingWipBalances, closingWipBalances, tolerances, editable = true, currentUserId, productionLine = "blowMoulding", bomStatus }) {
  const [day, setDay] = useState(planning.weekStart);
  const [commentFor, setCommentFor] = useState(null);
  const line = PRODUCTION_LINES[productionLine]; const MACHINES = Object.keys(line.machines);
  const planningAlias = (code) => productionLine === "thermoforming" ? getThermoformingDisplayCode(code) : blowPlanningAlias(code);
  useEffect(() => { setDay(planning.weekStart); }, [planning.weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addCalendarDays(planning.weekStart, index)), [planning.weekStart]);
  const plans = useMemo(() => { const grouped = new Map(); (planning.entries || []).filter((entry) => entry.day === day).forEach((entry) => { const key = `${entry.machine}|${entry.shift}`; grouped.set(key, [...(grouped.get(key) || []), entry]); }); return grouped; }, [planning.entries, day]);
  const actualsByPlan = useMemo(() => new Map(actuals.filter((actual) => actual.planningEntryId).map((actual) => [actual.planningEntryId, actual])), [actuals]);
  const { week, year } = getISOWeek(planning.weekStart);

  function updateActual(plan, field, value) {
    if (!editable) return;
    setActuals((current) => {
      const existing = current.find((actual) => actual.planningEntryId === plan.id);
      const next = { id: existing?.id || `actual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, planningEntryId: plan.id, actualMouldQty: existing?.actualMouldQty ?? "", comment: existing?.comment || "", createdByUserId: existing?.createdByUserId || currentUserId, updatedByUserId: currentUserId, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), [field]: value };
      return existing ? current.map((actual) => actual.id === existing.id ? next : actual) : [...current, next];
    });
  }

  return <div className={`production-actuals${editable ? "" : " actual-readonly"}`}>
    {bomStatus && !bomStatus.connected && <div className="actual-data-warning">Syspro BOM unavailable — expected consumption cannot be calculated from local BOM data.</div>}
    {!editable && <div className="actual-data-warning">Read-only production actuals access</div>}
    <header className="actual-header"><div><h1>{line.name} Production Actuals</h1><p>CW{week} · {year} · supervisors capture {line.quantityLabel.toLowerCase()} against the approved plan</p></div><div className="actual-week-nav"><button onClick={() => onWeekChange(addCalendarDays(planning.weekStart, -7))}><ChevronLeft size={15} /> Previous</button><button className="current" onClick={() => onWeekChange(mondayOf(new Date()))}><CalendarDays size={15} /> Current Week</button><button onClick={() => onWeekChange(addCalendarDays(planning.weekStart, 7))}>Next <ChevronRight size={15} /></button></div></header>
    <div className="actual-day-tabs">{days.map((date) => <button key={date} className={date === day ? "active" : ""} onClick={() => setDay(date)}><span>{dayName(date).split(",")[0]}</span><b>{date.slice(8)}</b></button>)}</div>
    <div className="actual-board-scroll"><table className="actual-board"><thead><tr><th>Machine</th>{SHIFTS.map((shift) => <th key={shift}>{shift.replace("SHIFT 0", "Shift ")}</th>)}<th>Cum Plan</th><th>Cum Actual</th><th>Variance</th></tr></thead><tbody>{MACHINES.map((machine) => {
      const machinePlans = SHIFTS.flatMap((shift) => plans.get(`${machine}|${shift}`) || []);
      const cumPlan = machinePlans.reduce((sum, plan) => sum + (Number(plan.buildQty) || 0), 0);
      const cumActual = machinePlans.reduce((sum, plan) => sum + (Number(actualsByPlan.get(plan.id)?.actualMouldQty) || 0), 0);
      return <tr key={machine}><th>{machineLabel(machine)}</th>{SHIFTS.map((shift) => {
        const slotPlans = plans.get(`${machine}|${shift}`) || []; if (!slotPlans.length) return <td key={shift}><div className="actual-cell empty">Unassigned</div></td>;
        return <td key={shift}><div className="actual-slot-runs">{slotPlans.map((plan) => { const actual = actualsByPlan.get(plan.id), off = plan.status === "OFF", changeover = plan.status === "Changeover"; return <div key={plan.id} className={`actual-cell ${off ? "off" : changeover ? "changeover" : "production"}`}><div className="actual-plan-label">{off ? "OFF" : changeover ? `C/O → ${planningAlias(plan.partNumber)}` : planningAlias(plan.partNumber)}</div>{!off && <><div className="actual-plan-qty">Plan: {fmt(plan.buildQty)}</div><label>Actual<input type="number" min="0" value={actual?.actualMouldQty ?? ""} onChange={(e) => updateActual(plan, "actualMouldQty", e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} /></label><button className={`actual-comment ${actual?.comment ? "has-comment" : ""}`} onClick={() => setCommentFor(commentFor === plan.id ? null : plan.id)}><MessageSquare size={12} /> {actual?.comment ? "Note added" : "Add note"}</button>{commentFor === plan.id && <input className="actual-comment-input" value={actual?.comment || ""} onChange={(e) => updateActual(plan, "comment", e.target.value)} placeholder="Optional comment" autoFocus />}</>}</div>; })}</div></td>;
      })}<td className="actual-total">{fmt(cumPlan)}</td><td className="actual-total">{fmt(cumActual)}</td><td className={`actual-total variance ${cumActual - cumPlan < 0 ? "negative" : cumActual - cumPlan > 0 ? "positive" : ""}`}>{fmt(cumActual - cumPlan)}</td></tr>;
    })}</tbody></table></div>
    <ReconciliationSection actuals={actuals} planning={planning} items={items} boms={boms} sysproTransactions={sysproTransactions} openingWipBalances={openingWipBalances} closingWipBalances={closingWipBalances} tolerances={tolerances} day={day} />
  </div>;
}
