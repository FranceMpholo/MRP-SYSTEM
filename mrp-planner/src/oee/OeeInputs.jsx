import React from 'react';

export default function OeeInputs({ actual, onChange, editable, multiple, quantityLabel }) {
  const fields = [['runTime', 'Run Time (minutes)'], ['noTubs', 'No tubs / No Stillages (minutes)'], ['goodParts', `Good Parts (${quantityLabel})`],
    ...(multiple ? [['plannedTime', 'Allocated planned time (minutes)'], ['plannedBreaks', 'Allocated breaks (minutes)']] : [])];
  return <details className="oee-inputs"><summary>OEE Inputs</summary><p>Actual is Total Produced. Enter Good Parts in the same production units. No tubs / No Stillages is added to Run Time; enter a time value, not a container count.</p>
    {multiple && <p>Split configured shift time and breaks across all runs, including changeover. Allocations must total the shift settings.</p>}
    {fields.map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="any" disabled={!editable} value={actual?.oee?.[key] ?? ''}
      onChange={event => onChange({ ...(actual?.oee ?? {}), [key]: event.target.value === '' ? null : Number(event.target.value) })} /></label>)}
  </details>;
}
