import React, { useState } from "react";
import { ADJUSTMENT_REASONS, getAdjustedPlanQty, getOriginalPlanQty, validatePlanAdjustment } from "./planQuantities";

export default function PlanAdjustmentDialog({ entry, onSave, onClose }) {
  const existing = getAdjustedPlanQty(entry);
  const [adjustedPlanQty, setAdjustedPlanQty] = useState(existing ?? "");
  const [adjustmentReason, setAdjustmentReason] = useState(entry.adjustmentReason || "");
  const [adjustmentComment, setAdjustmentComment] = useState(entry.adjustmentComment || "");
  const [error, setError] = useState("");
  function submit(event) {
    event.preventDefault();
    const adjustment = { adjustedPlanQty, adjustmentReason, adjustmentComment };
    const validationError = validatePlanAdjustment(adjustment);
    if (validationError) return setError(validationError);
    try { onSave(adjustment); } catch (saveError) { setError(saveError.message); }
  }
  return <div className="bm-editor-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="bm-editor" onSubmit={submit}><div className="bm-editor-title">Adjust Plan</div><label>Original Plan<input value={getOriginalPlanQty(entry)} readOnly /></label><label>Adjusted Plan<input type="number" min="0" step="any" value={adjustedPlanQty} onChange={(event) => setAdjustedPlanQty(event.target.value)} autoFocus /></label><label>Reason<select value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)}><option value="">Select reason…</option>{ADJUSTMENT_REASONS.map((reason) => <option key={reason.code} value={reason.code}>{reason.label}</option>)}</select></label><label>Comment<textarea value={adjustmentComment} onChange={(event) => setAdjustmentComment(event.target.value)} placeholder={adjustmentReason === "OTHER" ? "Required" : "Optional"} rows={3} /></label>{error && <div className="bm-editor-error">{error}</div>}<div className="bm-editor-actions"><span /><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary">Save Adjustment</button></div></form></div>;
}
