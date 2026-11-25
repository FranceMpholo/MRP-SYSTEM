import React, { useEffect, useMemo, useRef, useState } from "react";
import { calculateFcsdRequirements } from "./fcsdRequirements.js";
import { classifyFcsdFinishedPartCode, FCSD_COMMODITIES, isKnownFcsdFinishedPartExample } from "./fcsdClassification.js";
import "./fcsdTracker.css";

async function fetchSnapshot(path, signal) {
  const response = await fetch(path, { method: "GET", headers: { Accept: "application/json" }, signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
    throw new Error(payload?.error || `SYSPRO request failed (${response.status})`);
  }
  return payload;
}

const display = (value) => value === null || value === undefined ? 'Unresolved' : Number(value).toLocaleString("en-ZA", { maximumFractionDigits: 4 });

export default function FCSDTracker({ onDirtyChange }) {
  const [parts, setParts] = useState([]);
  const [bomRows, setBomRows] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [commodity, setCommodity] = useState("");
  const [reference, setReference] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [selectedParts, setSelectedParts] = useState([]);
  const requestVersion = useRef(0);
  const activeRequest = useRef(null);

  const dirty = Boolean(reference || requiredDate || selectedParts.length);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = "Your FCSD planning preview has unsaved work."; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const load = async (signal) => {
    const version = ++requestVersion.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    setLoading(true);
    setError("");
    try {
      const [partPayload, bomPayload] = await Promise.all([
        fetchSnapshot("/api/syspro/fcsd/parts", controller.signal),
        fetchSnapshot("/api/syspro/fcsd/bom", controller.signal),
      ]);
      if (controller.signal.aborted || version !== requestVersion.current) return;
      setParts(partPayload.data);
      setBomRows(bomPayload.data);
      setSnapshot({
        partsCapturedAt: partPayload.fetchedAt || null,
        bomCapturedAt: bomPayload.fetchedAt || null,
        coverage: partPayload.coverage,
      });
      setLoading(false);
    } catch (cause) {
      if (controller.signal.aborted || version !== requestVersion.current) return;
      setError(cause.message || "SYSPRO FCSD preview data is unavailable.");
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => { controller.abort(); activeRequest.current?.abort(); };
  }, []);

  const candidates = useMemo(() => parts
    .filter((part) => part.isBomParent || isKnownFcsdFinishedPartExample(part.stockCode))
    .map((part) => ({ ...part, classification: classifyFcsdFinishedPartCode(part.stockCode) }))
    .filter((part) => part.classification.isFcsd)
    .map((part) => ({ ...part, commodity: part.classification.commodity }))
    .sort((a, b) => a.stockCode.localeCompare(b.stockCode)), [parts]);

  const filteredParts = useMemo(() => {
    const needle = search.trim().toLocaleUpperCase();
    return candidates.filter((part) => (!commodity || part.commodity === commodity)
      && (!needle || `${part.stockCode} ${part.description}`.toLocaleUpperCase().includes(needle)));
  }, [candidates, commodity, search]);

  const preview = useMemo(() => calculateFcsdRequirements({ finishedParts: selectedParts, candidates: parts, bomRows }), [selectedParts, parts, bomRows]);
  const selectedCodes = new Set(selectedParts.map((part) => part.stockCode));

  const addPart = (part) => {
    setSelectedParts((current) => current.some((row) => row.stockCode === part.stockCode)
      ? current
      : [...current, { stockCode: part.stockCode, description: part.description, uom: part.uom, quantity: "" }]);
  };
  const editPart = (stockCode, quantity) => setSelectedParts((current) => current.map((part) => part.stockCode === stockCode ? { ...part, quantity } : part));
  const removePart = (stockCode) => setSelectedParts((current) => current.filter((part) => part.stockCode !== stockCode));

  return <section className="fcsd-tracker">
    <header className="fcsd-header"><div><p className="fcsd-eyebrow">FCSD WORKSPACE</p><h1>FCSD Tracker</h1><p>Planning preview — not approved for scheduling.</p></div>
      <button type="button" className="fcsd-refresh" onClick={() => { const controller = new AbortController(); load(controller.signal); }}>Refresh SYSPRO snapshot</button></header>
    <div className="fcsd-notice" role="note"><strong>Unsaved planning preview.</strong> This workspace is local to this open screen; it is not shared, approved, reserved, or a record of protected stock. Finished-part candidates are BOM parents; SYSPRO data does not establish which parents are finished goods.</div>
    {loading && <p className="fcsd-state" role="status">Loading FCSD candidates and BOM snapshot from SYSPRO…</p>}
    {!loading && error && <div className="fcsd-error" role="alert"><strong>SYSPRO preview data unavailable.</strong> {error}<button type="button" onClick={() => { const controller = new AbortController(); load(controller.signal); }}>Retry loading</button></div>}
    {!loading && !error && <>
      <p className="fcsd-source">Source: SYSPRO InvMaster and BomStructure · Item snapshot: {snapshot?.partsCapturedAt ? new Date(snapshot.partsCapturedAt).toLocaleString() : "capture time unavailable"} · BOM snapshot: {snapshot?.bomCapturedAt ? new Date(snapshot.bomCapturedAt).toLocaleString() : "capture time unavailable"}. Source routes, revisions and effectivity are retained; no alternative has been automatically selected.</p>
      <div className="fcsd-work-grid">
        <section className="fcsd-panel"><h2>FCSD finished-part candidates</h2><p className="fcsd-help">Classified from BOM-parent candidate codes only. Finished-good status needs business confirmation.</p>
          <div className="fcsd-filters"><label>Search code or description<input value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>Commodity<select value={commodity} onChange={(event) => setCommodity(event.target.value)}><option value="">All commodities</option>{FCSD_COMMODITIES.map((name) => <option key={name}>{name}</option>)}</select></label></div>
          {!filteredParts.length ? <p className="fcsd-state">{candidates.length ? "No FCSD candidates match these filters." : "No FCSD BOM-parent candidates were returned by SYSPRO."}</p> : <div className="fcsd-list"><table><thead><tr><th>Stock code</th><th>Description</th><th>Commodity</th><th>UOM</th><th /></tr></thead><tbody>{filteredParts.map((part) => <tr key={part.stockCode}><td>{part.stockCode}</td><td>{part.description || "Description unavailable"}</td><td>{part.commodity}</td><td>{part.uom || "Missing"}</td><td><button type="button" disabled={selectedCodes.has(part.stockCode)} onClick={() => addPart(part)}>{selectedCodes.has(part.stockCode) ? "Added" : "Add"}</button></td></tr>)}</tbody></table></div>}
          <p className="fcsd-coverage">{snapshot?.coverage || "SYSPRO stock master lookup; candidate-role coverage unavailable."}</p>
        </section>
        <section className="fcsd-panel"><h2>Build request preview</h2><div className="fcsd-request-fields"><label>Customer / build-plan reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Reference" /></label><label>Required date<input type="date" value={requiredDate} onChange={(event) => setRequiredDate(event.target.value)} /></label></div>
          {!selectedParts.length ? <p className="fcsd-state">Add one or more FCSD candidates to enter proposed build quantities.</p> : <div className="fcsd-list"><table><thead><tr><th>Finished part</th><th>Proposed quantity</th><th /></tr></thead><tbody>{selectedParts.map((part) => <tr key={part.stockCode}><td>{part.stockCode}<small>{part.description} · {part.uom || "UOM missing"}</small></td><td><input aria-label={`Quantity for ${part.stockCode}`} type="number" min="0" step="any" value={part.quantity} onChange={(event) => editPart(part.stockCode, event.target.value)} /></td><td><button type="button" onClick={() => removePart(part.stockCode)}>Remove</button></td></tr>)}</tbody></table></div>}
        </section>
      </div>
      {selectedParts.length > 0 && <section className="fcsd-panel fcsd-results"><div className="fcsd-result-heading"><div><h2>Consolidated component requirements</h2><p>Gross requirements only. These are not net shortages, available-to-build quantities, or allocations.</p></div><strong className={preview.complete ? "fcsd-status-ok" : "fcsd-status-unresolved"}>{preview.complete ? "Preview" : "Unresolved — incomplete explosion"}</strong></div>
        {preview.issues.length > 0 && <div className="fcsd-issues" role="status"><strong>Review required</strong><ul>{preview.issues.map((issue, index) => <li key={`${issue.code}-${issue.stockCode}-${index}`}><b>{issue.stockCode || "Data"}:</b> {issue.message}</li>)}</ul></div>}
        {preview.requirements.length > 0 ? <div className="fcsd-list"><table><thead><tr><th>Component</th><th>Description</th><th>Gross requirement</th><th>UOM</th><th>Finished-part contribution</th><th>Explosion</th></tr></thead><tbody>{preview.requirements.map((row) => <tr key={`${row.stockCode}-${row.uom}`}><td>{row.stockCode}</td><td>{row.description}</td><td>{display(row.grossRequirement)}</td><td>{row.uom}</td><td>{row.contributions.map((entry) => `${entry.finishedPartCode}: ${display(entry.quantity)}`).join(" · ")}</td><td>{row.nestedBom ? "Nested BOM unresolved" : "Direct BOM"}</td></tr>)}</tbody></table></div> : <p className="fcsd-state">No gross component totals can be shown until valid positive quantities and BOM data are available.</p>}
        {preview.negativeQuantities.length > 0 && <div className="fcsd-negative"><h3>Negative BOM quantities — business review</h3><p>Displayed separately; these values are not credited against gross requirements or treated as available stock.</p><ul>{preview.negativeQuantities.map((row, index) => <li key={`${row.stockCode}-${index}`}>{row.stockCode} · {row.description} · {display(row.quantity)} {row.uom} from {row.contribution.finishedPartCode}</li>)}</ul></div>}
      </section>}
    </>}
  </section>;
}
