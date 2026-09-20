import React from 'react';
const colors = ['#0868B2', '#B5641F', '#2F6F4E', '#8356A1'];
export const metricLabels = { externalOee: 'External OEE', internalOee: 'Internal OEE', availability: 'Availability', quality: 'Quality', performance: 'Performance', productivity: 'Productivity', target: 'Target', effectivePlan: 'Effective Plan', revisedPlan: 'Revised Plan', totalProduced: 'Actual Produced', actual: 'Actual Produced', goodParts: 'Good Parts', good: 'Good Parts', scrap: 'Scrap Parts', fgTransferred: 'FG Transferred', downtime: 'Total Downtime' };
export const formatNumber = value => value === null || value === undefined ? '—' : value.toLocaleString('en-ZA', { maximumFractionDigits: 2 });
export const percent = value => (value * 100).toFixed(1) + '%';
export default function OeeChart({ title, data, series, line = false, percentage = true, caption }) {
  const available = data.filter(row => row.count === undefined || row.count > 0);
  const max = Math.max(percentage ? 1 : 1, ...available.flatMap(row => series.map(key => row[key] ?? 0)));
  const min = Math.min(0, ...available.flatMap(row => series.map(key => row[key] ?? 0)));
  const width = 720, height = 300, left = 65, top = 20, bottom = 65, plotWidth = 630, plotHeight = height - top - bottom;
  const x = index => left + (index + 0.5) * plotWidth / Math.max(data.length, 1);
  const y = value => top + plotHeight * (max - value) / (max - min);
  const fmt = percentage ? percent : formatNumber;
  return <section className="oee-panel"><h3>{title}</h3><p className="oee-caption">{caption}</p><div className="oee-legend">{series.map((key, index) => <span key={key}><i style={{ background: colors[index] }} />{metricLabels[key]}</span>)}</div>
    {available.length === 0 ? <p className="oee-empty">Data Incomplete: no complete records for these filters.</p> : <div className="oee-plot"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}><title>{title}</title>
      {[0, 1, 2, 3, 4].map(tick => { const value = min + (max - min) * tick / 4; return <g key={tick}><line x1={left} x2={width - 25} y1={y(value)} y2={y(value)} stroke="#E3DFD2" /><text x={left - 8} y={y(value) + 4} textAnchor="end">{fmt(value)}</text></g>; })}
      {series.map((key, si) => <g key={key}>{line && <path d={data.map((row, index) => row.count === 0 ? '' : `${index === 0 || data[index - 1].count === 0 ? 'M' : 'L'}${x(index)},${y(row[key])}`).join(' ')} fill="none" stroke={colors[si]} strokeWidth="2.5" />}
        {data.map((row, index) => {
          if (row.count === 0) return null;
          const value = row[key], label = `${row.label} · ${metricLabels[key]}: ${fmt(value)}`, bw = Math.min(36, plotWidth / data.length * 0.75 / series.length);
          return line ? <circle key={row.label} cx={x(index)} cy={y(value)} r="4" fill={colors[si]} tabIndex="0" aria-label={label}><title>{label}</title></circle>
            : <rect key={row.label} x={x(index) + (si - series.length / 2) * bw} y={Math.min(y(0), y(value))} width={Math.max(1, bw - 1)} height={Math.abs(y(0) - y(value))} fill={colors[si]} tabIndex="0" aria-label={label}><title>{label}</title></rect>;
        })}</g>)}
      {data.map((row, index) => index % Math.max(1, Math.ceil(data.length / 7)) === 0 ? <text key={row.label} x={x(index)} y={height - 38} textAnchor="middle">{row.label.length > 18 ? row.label.slice(0, 17) + '…' : row.label}<title>{row.label}</title></text> : null)}
    </svg></div>}
  </section>;
}
