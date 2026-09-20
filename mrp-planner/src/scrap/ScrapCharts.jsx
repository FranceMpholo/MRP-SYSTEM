import React, { useId, useMemo, useState } from 'react';
export const money = value => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 2 }).format(value);
const compact = value => `R${new Intl.NumberFormat('en-ZA', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
const colors = ['#0868B2', '#B5641F'];
const COST_SERIES = ['cost'];

export default function ScrapChart({ title, data, kind = 'line', series = COST_SERIES, target = false, caption }) {
  const clipId = useId().replace(/:/g, '') + '-reveal';
  const tooltipId = clipId + '-tooltip';
  const [hover, setHover] = useState(null);
  // Equal plotted values keep the same SVG group, even when parent objects change.
  const animationKey = useMemo(() => JSON.stringify([kind, target, series, data.map(row => [row.label, ...series.map(key => row[key] ?? 0)])]), [data, kind, target, series]);
  const active = hover?.signature === animationKey ? hover : null;
  const horizontal = kind === 'horizontal';
  const width = 720, height = horizontal ? Math.max(260, data.length * 36 + 50) : 290;
  const left = horizontal ? 250 : 80, right = 25, top = 25, bottom = 55;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = data.flatMap(row => series.map(key => row[key] || 0));
  const min = Math.min(0, ...values), max = Math.max(1, target ? 400000 : 0, ...values);
  const y = value => top + (max - value) / (max - min) * plotHeight;
  const x = index => left + (index + 0.5) * plotWidth / Math.max(1, data.length);
  const hx = value => left + (value - min) / (max - min) * plotWidth;
  const step = Math.max(1, Math.ceil(data.length / 7));
  const select = (index, si = 0) => setHover(previous => previous?.signature === animationKey && previous.index === index && previous.si === si ? previous : { signature: animationKey, index, si });
  const interaction = (index, si = 0) => ({
    onPointerEnter: () => select(index, si), onFocus: () => select(index, si), onBlur: () => setHover(null),
    'aria-describedby': active?.index === index && active.si === si ? tooltipId : undefined,
  });
  function nearestPoint(event) {
    if (horizontal || kind !== 'line' || data.length === 0) return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    if (point.x < left || point.x > width - right || point.y < top || point.y > height - bottom) { setHover(null); return; }
    const index = Math.max(0, Math.min(data.length - 1, Math.round((point.x - left) / plotWidth * data.length - 0.5)));
    const si = series.reduce((best, key, indexInSeries) => Math.abs(y(data[index][key] ?? 0) - point.y) < Math.abs(y(data[index][series[best]] ?? 0) - point.y) ? indexInSeries : best, 0);
    select(index, si);
  }
  const activeRow = active ? data[active.index] : null;
  const activeValue = activeRow ? activeRow[horizontal ? 'cost' : series[active.si]] ?? 0 : null;
  const tooltipX = activeRow ? horizontal ? hx(activeValue) : x(active.index) : 0;
  const tooltipY = activeRow ? horizontal ? top + (active.index + 0.5) * plotHeight / data.length : y(activeValue) : 0;
  return <section className="scrap-panel"><h3>{title}</h3>{caption && <p className="scrap-caption">{caption}</p>}
    {series.length > 1 && <div className="scrap-legend">{series.map((key, i) => <span key={key}><i style={{ background: colors[i] }} />{key}</span>)}</div>}
    {!data.length ? <p className="scrap-empty">No transactions match these filters.</p> : <div className="scrap-plot"><div className="scrap-svg-frame" onPointerLeave={() => setHover(null)}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} onPointerMove={nearestPoint} onKeyDown={event => { if (event.key === 'Escape') setHover(null); }}>
      <title>{title}</title><desc>Cost in South African rand. Focus a mark or hover for the exact value.</desc>
      {[0, 1, 2, 3, 4].map(tick => {
        const value = min + (max - min) * tick / 4;
        return horizontal ? <g key={tick}><line x1={hx(value)} x2={hx(value)} y1={top} y2={height - bottom} className="scrap-gridline" /><text x={hx(value)} y={height - 28} textAnchor="middle">{compact(value)}</text></g>
          : <g key={tick}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="scrap-gridline" /><text x={left - 9} y={y(value) + 4} textAnchor="end">{compact(value)}</text></g>;
      })}
      {target && <g><line x1={left} x2={width - right} y1={y(400000)} y2={y(400000)} stroke="#A6362B" strokeDasharray="6 5" /><text x={width - right} y={y(400000) - 8} textAnchor="end" fill="#A6362B">Monthly target R400,000</text></g>}
      <g key={animationKey} className="scrap-chart-dataset">
      <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><rect className="scrap-line-reveal" x={left - 8} y="0" width={plotWidth + 16} height={height} style={{ transformOrigin: `${left - 8}px 0px` }} /></clipPath></defs>
      {horizontal ? data.map((row, index) => {
        const cy = top + (index + 0.5) * plotHeight / data.length;
        const split = row.label.lastIndexOf(' ', 29);
        const lines = row.label.length > 29 ? [row.label.slice(0, split > 0 ? split : 29), row.label.slice(split > 0 ? split + 1 : 29)] : [row.label];
        return <g key={row.label}><text x={left - 10} y={cy + (lines.length > 1 ? -3 : 4)} textAnchor="end"><title>{row.label}</title>{lines.map((line, i) => <tspan key={i} x={left - 10} dy={i ? 14 : 0}>{line}</tspan>)}</text><rect {...interaction(index)} className={`scrap-bar scrap-bar-horizontal${active?.index === index ? ' is-active' : ''}`} style={{ transformOrigin: `${hx(0)}px ${cy}px` }} tabIndex="0" aria-label={`${row.label}: ${money(row.cost)}`} x={Math.min(hx(0), hx(row.cost))} y={cy - 10} width={Math.max(1, Math.abs(hx(row.cost) - hx(0)))} height={20} rx={2} fill={colors[0]}><title>{row.label}: {money(row.cost)}</title></rect></g>;
      }) : <>
        {series.map((key, si) => <g key={key} clipPath={kind === 'line' ? `url(#${clipId})` : undefined}>
          {kind === 'line' && <polyline points={data.map((row, i) => `${x(i)},${y(row[key] || 0)}`).join(' ')} fill="none" stroke={colors[si]} strokeWidth={2.5} />}
          <g className={kind === 'line' ? 'scrap-markers' : undefined}>{data.map((row, i) => {
            const value = row[key] || 0, label = `${row.label}${key === 'cost' ? '' : ' ' + key}: ${money(value)}`;
            const barWidth = Math.min(45, plotWidth / data.length * 0.75 / series.length);
            const isActive = active?.index === i && active.si === si;
            return kind === 'line' ? <circle {...interaction(i, si)} className={`scrap-point${isActive ? ' is-active' : ''}`} key={row.label} tabIndex="0" aria-label={label} cx={x(i)} cy={y(value)} r={isActive ? 5 : 3.5} fill={colors[si]}><title>{label}</title></circle>
              : <rect {...interaction(i, si)} className={`scrap-bar scrap-bar-vertical${isActive ? ' is-active' : ''}`} style={{ transformOrigin: `${x(i)}px ${y(0)}px` }} key={row.label} tabIndex="0" aria-label={label} x={x(i) + (si - series.length / 2) * barWidth} y={Math.min(y(0), y(value))} width={barWidth - 1} height={Math.max(1, Math.abs(y(value) - y(0)))} fill={colors[si]}><title>{label}</title></rect>;
          })}</g>
        </g>)}
        {data.map((row, i) => i % step === 0 || i === data.length - 1 ? <text key={row.label} x={x(i)} y={height - 28} textAnchor="middle">{row.label}</text> : null)}
      </>}
      </g>
    </svg>{activeRow && <div id={tooltipId} role="tooltip" className="scrap-tooltip" style={{ left: `clamp(125px, ${tooltipX / width * 100}%, calc(100% - 125px))`, top: `${Math.max(75, Math.min(height - 15, tooltipY)) / height * 100}%` }}><b>{activeRow.label}</b>{!horizontal && series[active.si] !== 'cost' && <span>{series[active.si]}</span>}<span>{money(activeValue)}</span></div>}</div></div>}
  </section>;
}
