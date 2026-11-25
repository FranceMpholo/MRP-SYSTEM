import React, { useMemo, useState } from "react";
import { ChevronRight, RotateCcw } from "lucide-react";
import { sysproBomParents } from "./sysproBom";
import { inspectBom, bomFactor, bomSourceReady } from './bomValidation.js';

export default function SysproBomExplorer({ boms, status, onRefresh }) {
  const [search, setSearch] = useState(""); const [expanded, setExpanded] = useState(null);
  const parents = useMemo(() => { const q = search.trim().toLowerCase(); return sysproBomParents(boms).filter((p) => !q || p.parentStockCode.toLowerCase().includes(q) || p.parentDescription.toLowerCase().includes(q)); }, [boms, search]);
  const context = useMemo(() => inspectBom(boms), [boms]);
  return <section className="bom-explorer">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <div><h1>Bill of Materials</h1><p>Source: SYSPRO {status.lastUpdated ? `· refreshed ${new Date(status.lastUpdated).toLocaleString()}` : ''}</p></div>
      <button className="mrp-btn mrp-btn-primary" onClick={onRefresh} disabled={status.loading}><RotateCcw size={14} />{status.loading ? 'Loading…' : 'Refresh'}</button>
    </div>
    <p>Source lines are retained separately. No route, revision, effectivity, duplicate-line or negative-quantity business rule is inferred.</p>
    {context.globalIssues.map((issue) => <p key={issue} role="alert" style={{ color: '#A6362B' }}>{issue}</p>)}
    {!bomSourceReady(status) && <div role="status" style={{ background: '#F3E1DE', color: '#A6362B', padding: 10 }}>{status.loading ? 'Loading SYSPRO BOM…' : `SYSPRO BOM unavailable: ${status.error || 'not connected'}`}{boms.length ? ' · previous snapshot is shown for inspection only; dependent calculations are incomplete.' : ''}</div>}
    <input className="mrp-input" style={{ width: '100%', maxWidth: 470, marginBottom: 12 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search parent stock code or description…" />
    {bomSourceReady(status) && !boms.length && <div role="status">No BOM lines returned by SYSPRO (connected, empty snapshot).</div>}
    {bomSourceReady(status) && boms.length > 0 && !parents.length && <div>No matching parent stock codes.</div>}
    <div style={{ background: '#fff', border: '1px solid #E3DFD2' }}>{parents.map((parent) => <div key={parent.parentStockCode}>
      <button onClick={() => setExpanded(expanded === parent.parentStockCode ? null : parent.parentStockCode)} style={{ width: '100%', border: 0, background: '#fff', padding: 12, display: 'flex', gap: 10, textAlign: 'left' }}>
        <ChevronRight size={16} /><b>{parent.parentStockCode}</b><span>{parent.parentDescription}</span><span style={{ marginLeft: 'auto' }}>{parent.components.length} source lines</span>
      </button>
      {expanded === parent.parentStockCode && <>
        {context.issuesForParent(parent.parentStockCode).map((issue) => <p key={issue} role="status" style={{ color: '#A6362B', padding: '0 12px' }}>{issue}</p>)}
        <div style={{ overflowX: 'auto' }}><table className="mrp-table"><thead><tr><th>Child stock code</th><th>Description</th><th>Qty per</th><th>Factor state</th><th>Parent / component stock UOM</th><th>Route / sequence</th><th>Revision / release</th><th>Effectivity</th></tr></thead>
          <tbody>{parent.components.map((row, index) => { const factor = bomFactor(row); return <tr key={index}>
            <td>{row.componentStockCode || 'Missing reference'}</td><td>{row.componentDescription}</td><td>{factor.value === null ? 'Unknown' : factor.value}</td><td>{factor.state}{factor.state === 'invalid' && row.qtyPerRaw != null ? ` (${String(row.qtyPerRaw)})` : ''}</td>
            <td>{row.parentUom || '?'} / {row.componentUom || '?'}{row.factorUnitsVerified !== true ? ' · basis unverified' : ' · QtyPer stocking basis'}</td>
            <td>{row.route || 'unspecified'} / {row.sequence || 'unspecified'}</td><td>{row.version || '—'} / {row.release || '—'}</td><td>{row.structureOnDate || '—'} → {row.structureOffDate || '—'}</td>
          </tr>; })}</tbody></table></div>
      </>}
    </div>)}</div>
  </section>;
}
