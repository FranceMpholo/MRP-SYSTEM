import React, { useMemo } from "react";
import { Boxes, ClipboardList, PackageCheck } from "lucide-react";
import { deriveProductionMRP } from "./deriveProductionMRP";

const colors = {
  ink: "#1B2430", card: "#FFFFFF", line: "#E3DFD2", muted: "#746C5C",
  copper: "#0868B2", brick: "#A6362B", brickTint: "#F3E1DE", green: "#2F6F4E", greenTint: "#E1EBE3",
};

const fmt = (value) => {
  if (value === null || value === undefined) return "—";
  const rounded = Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

function Section({ title, subtitle, icon: Icon, children }) {
  return <section style={{ background: colors.card, border: `1px solid ${colors.line}`, borderRadius: 6, overflow: "hidden" }}>
    <div style={{ padding: "13px 15px", borderBottom: `1px solid ${colors.line}`, display: "flex", alignItems: "center", gap: 9 }}>
      <Icon size={17} color={colors.copper} />
      <div><div style={{ color: colors.ink, fontSize: 16, fontWeight: 600 }}>{title}</div><div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{subtitle}</div></div>
    </div>
    {children}
  </section>;
}

function Empty({ children, columns }) {
  return <tr><td colSpan={columns} style={{ padding: 18, color: colors.muted }}>{children}</td></tr>;
}

function Status({ child }) {
  const exception = child.status === "Insufficient RAW stock" || child.status === "Pack size missing";
  return <div>
    <span style={{ display: "inline-block", padding: "3px 7px", borderRadius: 3, fontSize: 11, fontWeight: 600, background: exception ? colors.brickTint : colors.greenTint, color: exception ? colors.brick : colors.green }}>{child.status}</span>
    {child.rawShortage > 0 && <div className="plex-mono" style={{ color: colors.brick, fontSize: 11, fontWeight: 600, marginTop: 3 }}>RAW shortage: {fmt(child.rawShortage)} {child.uom}</div>}
  </div>;
}

export default function ProductionMRP({ planning, items, boms, productionMrp, bomStatus }) {
  const productionMRP = useMemo(() => productionMrp || deriveProductionMRP({ planning, items, boms }), [productionMrp, planning, items, boms]);
  const { productionPlan, childRequirements, storeRequests } = productionMRP;
  const planningWeek = planning?.weekStart || "—";

  return <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
    <div>
      <div style={{ color: colors.ink, fontSize: 22, fontWeight: 600 }}>Production MRP</div>
      <div style={{ color: colors.muted, fontSize: 13, marginTop: 3 }}>Direct child material requirements for the selected production plan week.</div>
    </div>
    {bomStatus && !bomStatus.connected && <div style={{ background: colors.brickTint, color: colors.brick, padding: 10, borderRadius: 4, fontWeight: 600 }}>Syspro BOM unavailable{bomStatus.error ? `: ${bomStatus.error}` : ""}</div>}
    {(productionMRP.dataIssues || []).map((issue) => <div key={issue} style={{ background: colors.brickTint, color: colors.brick, padding: 10, borderRadius: 4, fontWeight: 600 }}>{issue}</div>)}

    <Section title="Production plan" subtitle={`Planning week: ${planningWeek}`} icon={ClipboardList}>
      <div style={{ overflowX: "auto" }}><table className="mrp-table" style={{ minWidth: 620 }}>
        <thead><tr><th>Planned parent / mould set</th><th>Description and effective parents</th><th style={{ textAlign: "right" }}>Planned mould qty</th></tr></thead>
        <tbody>{productionPlan.map((parent) => <tr key={parent.parentId}><td className="plex-mono" style={{ fontWeight: 600 }}>{parent.stockCode}{parent.isPair && <div className="plex-sans" style={{ color: colors.copper, fontSize: 10, marginTop: 3 }}>PAIRED LH/RH MOULD</div>}</td><td><div>{parent.description}</div>{parent.isPair && <div style={{ marginTop: 5 }}>{parent.produces.map((produced) => <div className="plex-mono" key={produced.stockCode} style={{ color: colors.muted, fontSize: 11 }}>{produced.stockCode} → {fmt(produced.plannedBuildQty)}</div>)}</div>}</td><td className="plex-mono" style={{ textAlign: "right", fontWeight: 600 }}>{fmt(parent.plannedBuildQty)}</td></tr>)}{!productionPlan.length && <Empty columns={3}>Enter a parent stock code and a positive Planned Build Qty in Planning to create a production requirement.</Empty>}</tbody>
      </table></div>
    </Section>

    <Section title="Production material requirements" subtitle="Direct BOM components netted only against current Production stock in B-WIP01." icon={Boxes}>
      <div style={{ overflowX: "auto" }}><table className="mrp-table" style={{ minWidth: 930 }}>
        <thead><tr><th>Child stock code</th><th>Description</th><th>UOM</th><th style={{ textAlign: "right" }}>Gross requirement</th><th style={{ textAlign: "right" }}>B-WIP01 SOH</th><th style={{ textAlign: "right" }}>Production shortfall</th></tr></thead>
        <tbody>{childRequirements.map((child) => <tr key={child.childId}><td className="plex-mono" style={{ fontWeight: 600 }}>{child.stockCode}</td><td>{child.description}</td><td className="plex-mono">{child.uom || "—"}</td><td className="plex-mono" style={{ textAlign: "right" }}>{fmt(child.grossRequirement)}</td><td className="plex-mono" style={{ textAlign: "right" }}>{fmt(child.bWip01Soh)}</td><td className="plex-mono" style={{ textAlign: "right", fontWeight: 600, color: child.productionShortfall > 0 ? colors.brick : colors.green }}>{fmt(child.productionShortfall)}</td></tr>)}{!childRequirements.length && <Empty columns={6}>No direct BOM components are required for the current Production Plan.</Empty>}</tbody>
      </table></div>
    </Section>

    <Section title="Store request — B-RAW01" subtitle="Requests are rounded to pack size; B-RAW01 tests whether Stores can fulfil the request." icon={PackageCheck}>
      <div style={{ overflowX: "auto" }}><table className="mrp-table" style={{ minWidth: 1080 }}>
        <thead><tr><th>Child stock code</th><th>Description</th><th>UOM</th><th style={{ textAlign: "right" }}>Production shortfall</th><th style={{ textAlign: "right" }}>Pack size</th><th style={{ textAlign: "right" }}>Packs required</th><th style={{ textAlign: "right" }}>Store request qty</th><th style={{ textAlign: "right" }}>B-RAW01 SOH</th><th style={{ textAlign: "right" }}>Projected RAW balance</th><th>Status</th></tr></thead>
        <tbody>{storeRequests.map((child) => <tr key={child.childId}><td className="plex-mono" style={{ fontWeight: 600 }}>{child.stockCode}</td><td>{child.description}</td><td className="plex-mono">{child.uom || "—"}</td><td className="plex-mono" style={{ textAlign: "right" }}>{fmt(child.productionShortfall)}</td><td className="plex-mono" style={{ textAlign: "right" }}>{fmt(child.packSize)}</td><td className="plex-mono" style={{ textAlign: "right" }}>{fmt(child.packsRequired)}</td><td className="plex-mono" style={{ textAlign: "right", fontWeight: 600 }}>{fmt(child.storeRequestQty)}</td><td className="plex-mono" style={{ textAlign: "right" }}>{fmt(child.bRaw01Soh)}</td><td className="plex-mono" style={{ textAlign: "right", color: child.projectedRawBalance < 0 ? colors.brick : colors.ink }}>{fmt(child.projectedRawBalance)}</td><td><Status child={child} /></td></tr>)}{!storeRequests.length && <Empty columns={10}>No Store requests are required from B-RAW01 for this Production Plan.</Empty>}</tbody>
      </table></div>
    </Section>
  </div>;
}
