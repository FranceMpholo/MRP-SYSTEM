import React, { useCallback, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Factory, Gauge, ClipboardCheck, Info, Layers, Wrench } from "lucide-react";
import { addCalendarDays, mondayOf } from "../planning/planningBoardUtils";
import { deriveProductionOverview } from "./deriveProductionOverview.js";
import CardInfoPopover from "./CardInfoPopover";
import "./productionOverview.css";

const format = (value) => value == null ? "Unavailable" : value.toLocaleString("en-ZA", { maximumFractionDigits: 2 });
export const UNSUPPORTED_AREAS = {
  "rsb-dashboard": { name: "Rear Step Bumper", scope: "RSB commodity", reason: "FCSD contains selected RSB part examples and scrap reporting has a BOM-based RSB classification. Neither establishes a complete, scoped production plan and actual-output source for this commodity." },
  "frame-dashboard": { name: "Bumper Frame & Chassis", scope: "Bumper Frame and Chassis Frame commodities", reason: "FCSD lists Bumper Frame examples and a Chassis Frame filter, but no complete commodity-to-production-run mapping or comparable actual-output source is available." },
};

export function UnavailableProductionDashboard({ area, weekStart }) {
  const detail = UNSUPPORTED_AREAS[area];
  return <section className="production-unavailable"><p className="production-eyebrow">PRODUCTION COVERAGE</p><h1>{detail.name}</h1><p className="production-state">Production dashboard unavailable</p><p>{detail.reason}</p><p>Scope: {detail.scope}. No production figures are shown.</p><p>Period: no supported production period. Overview week {weekStart} does not filter this coverage statement.</p></section>;
}

function OverviewCard({ id, title, scope, period, status, statusTone = "neutral", icon: Icon, children, notes, onOpen, activeInfo, setActiveInfo, closeInfo }) {
  const infoTrigger = useRef(null);
  const expanded = activeInfo === id;
  return <article className="production-overview-card" aria-labelledby={`overview-${id}`} data-card={id}>
    <header><span className="production-card-icon" aria-hidden="true"><Icon size={20} /></span><div className="production-card-heading"><h2 id={`overview-${id}`}><button type="button" className="production-card-target" onClick={onOpen} aria-label={`Open ${title} dashboard`} aria-describedby={`overview-${id}-scope overview-${id}-period overview-${id}-status`}>{title}</button></h2><p id={`overview-${id}-scope`}>{scope}</p></div><div className="production-card-controls"><button ref={infoTrigger} type="button" className="production-card-info" data-production-info={id} aria-label={`${title} information`} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? `overview-${id}-information` : undefined} onClick={(event) => { event.stopPropagation(); setActiveInfo(expanded ? null : id); }}><Info size={16} aria-hidden="true" /></button><ArrowRight className="production-card-arrow" size={16} aria-hidden="true" /></div></header>
    <div className="production-card-body">{children || <div className="production-card-empty"><span aria-hidden="true">—</span><p>{statusTone === 'preview' ? 'Material planning preview' : status}</p></div>}</div>
    <footer className="production-card-meta"><div><span className="production-card-period-label">Reporting period</span><p className="production-card-period" id={`overview-${id}-period`}>{period}</p></div><span className={`production-state production-state-${statusTone}`} id={`overview-${id}-status`}>{children ? status : statusTone === 'preview' ? status : 'Unavailable'}</span></footer>
    {expanded && <CardInfoPopover id={id} title={title} triggerRef={infoTrigger} onClose={closeInfo}>{notes}</CardInfoPopover>}
  </article>;
}

function ProductionMetrics({ summary }) {
  const unit = summary.unit === "mould sets" ? "sets" : "parts";
  const value = (number) => <>{format(number)}{number != null && <small> {unit}</small>}</>;
  return <dl className="production-card-metrics"><div><dt>Effective plan</dt><dd className={summary.planned == null ? 'is-unavailable' : undefined}>{value(summary.planned)}</dd></div><div><dt>Captured actual</dt><dd className={summary.actual == null ? 'is-unavailable' : undefined}>{value(summary.actual)}</dd></div><div><dt>Achievement</dt><dd className={summary.achievementPct == null ? 'is-unavailable' : undefined}>{summary.achievementPct == null ? "Unavailable" : `${format(summary.achievementPct)}%`}</dd></div></dl>;
}

function ProductionNotes({ summary }) {
  return <>
    <p className="production-card-caption">Unit: {summary.unit}. {summary.runCount ? `${summary.captured}/${summary.runCount} runs with one valid actual.` : "No production runs for this week."}</p>
    {summary.missing > 0 && <p className="production-card-warning">{summary.missing} runs missing actuals; missing is not zero.</p>}
    {summary.duplicate > 0 && <p className="production-card-warning">{summary.duplicate} runs have duplicate/corrected actuals requiring resolution.</p>}
    {summary.invalid > 0 && <p className="production-card-warning">{summary.invalid} runs have invalid actuals.</p>}
    {summary.issues.map((issue) => <p className="production-card-warning" key={issue}>{issue}</p>)}
  </>;
}

export default function ProductionOverview({ planningWeeks, weekStart, productionActuals, onWeekChange, onOpenLine, onOpenView, bomStatus, inventoryStatus }) {
  const [activeInfo, setActiveInfo] = useState(null);
  const weekInfoTrigger = useRef(null);
  const closeInfo = useCallback(() => setActiveInfo(null), []);
  const information = { activeInfo, setActiveInfo, closeInfo };
  const summaries = useMemo(() => deriveProductionOverview({ planningWeeks, weekStart, productionActuals }), [planningWeeks, weekStart, productionActuals]);
  const period = `Week: ${weekStart} to ${addCalendarDays(weekStart, 6)}`;
  const sourceState = bomStatus.loading || inventoryStatus === "loading" ? "Material sources loading."
    : bomStatus.error ? "Material sources unavailable (source error); live alerts cannot be confirmed."
      : !bomStatus.connected || inventoryStatus !== "connected" ? "Material sources unavailable; live alerts cannot be confirmed."
      : "Material alerts in detail view.";
  const lineCard = (id, title, scope, note) => <OverviewCard key={id} id={id} title={title} icon={Factory} scope={scope} period={period} statusTone={summaries[id].state === "complete" ? "complete" : summaries[id].state === "incomplete" ? "warning" : "neutral"} status={summaries[id].state === "complete" ? "Actuals complete" : summaries[id].state === "incomplete" ? "Incomplete production data" : "Production data unavailable"} onOpen={() => onOpenLine(id)} {...information} notes={<><ProductionNotes summary={summaries[id]} /><p className="production-card-caption">{note}</p><p className="production-card-caption">Source: workspace planning and supervisor actuals. {sourceState}</p><p>Achievement is captured actual divided by effective plan. Weekly actual and achievement require one valid actual for every scoped run; missing actuals are not zero. Duplicate/corrected actuals require resolution. A zero effective plan has no achievement percentage.</p></>}>
    <ProductionMetrics summary={summaries[id]} />
  </OverviewCard>;
  return <section className="production-overview" aria-labelledby="production-overview-title">
    <header className="production-overview-header"><div><p className="production-eyebrow">PLANNING DESK</p><h1 id="production-overview-title">Production Overview</h1></div><div className="production-period-controls" role="group" aria-label="Overview planning period"><div className="production-period-label"><CalendarDays size={15} aria-hidden="true" /><span>{period}</span><button ref={weekInfoTrigger} type="button" className="production-card-info" data-production-info="week" aria-label="Overview week filter information" aria-haspopup="dialog" aria-expanded={activeInfo === 'week'} aria-controls={activeInfo === 'week' ? 'overview-week-information' : undefined} onClick={() => setActiveInfo(activeInfo === 'week' ? null : 'week')}><Info size={16} aria-hidden="true" /></button></div><div className="production-week-buttons"><button type="button" onClick={() => onWeekChange(addCalendarDays(weekStart, -7))}><ChevronLeft size={14} aria-hidden="true" />Previous week</button><button type="button" onClick={() => onWeekChange(mondayOf(new Date()))}>Current week</button><button type="button" onClick={() => onWeekChange(addCalendarDays(weekStart, 7))}>Next week<ChevronRight size={14} aria-hidden="true" /></button></div></div></header>
    {activeInfo === 'week' && <CardInfoPopover id="week" title="Overview week filter" triggerRef={weekInfoTrigger} onClose={closeInfo}><p>Week filters production summaries only. FCSD and OEE use their own dates. Cards may overlap; they are not additive plant totals.</p><p>Each card shows its applicable reporting period. Unavailable production coverage is not filtered by the overview week.</p></CardInfoPopover>}
    <div className="production-overview-grid">
      {lineCard("thermoforming", "Thermoforming", "AR1–AR5 · Bedliner / TPO", "Assembly completion capture; forming output unavailable. Expected tailgates and FG postings excluded.")}
      {lineCard("blowMoulding", "Blow Molding", "BM1–BM5 · LH/RH mould-set plans", "LH/RH sets; unverified product units suppress metrics.")}
      <OverviewCard id="rsb" title="Rear Step Bumper" icon={Wrench} scope="RSB commodity" period="Production period unavailable" status="Production dashboard unavailable" onOpen={() => onOpenView("rsb-dashboard")} {...information} notes={<p className="production-card-caption">FCSD/scrap classifications do not establish scoped production coverage. Overview week does not apply.</p>} />
      <OverviewCard id="fcsd" title="FCSD Tracker" icon={ClipboardCheck} scope="FCSD BOM-parent candidates" period="Tracker required date" status="Planning preview only" statusTone="preview" onOpen={() => onOpenView("fcsd")} {...information} notes={<p className="production-card-caption">Current SYSPRO part/BOM snapshots; unsaved preview. Workflow counts unavailable. Source status shown in tracker. Overview week does not apply.</p>} />
      <OverviewCard id="frame" title="Bumper Frame & Chassis" icon={Layers} scope="Bumper Frame / Chassis Frame" period="Production period unavailable" status="Production dashboard unavailable" onOpen={() => onOpenView("frame-dashboard")} {...information} notes={<p className="production-card-caption">FCSD classifications do not establish a scoped production plan/actual source. Overview week does not apply.</p>} />
      <OverviewCard id="oee" title="Overall Plant OEE" icon={Gauge} scope="Existing line-level OEE reports" period="OEE reporting dates" status="Plant summary not yet available" onOpen={() => onOpenView("oee")} {...information} notes={<p className="production-card-caption">Plant aggregation unsupported. Area percentages are not averaged into a plant percentage. Overview week does not apply.</p>} />
    </div>
  </section>;
}
