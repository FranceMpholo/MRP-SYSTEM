import React, { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';
const subscribe = callback => {
  const media = window.matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const snapshot = () => window.matchMedia(query).matches;
export const useReducedMotion = () => useSyncExternalStore(subscribe, snapshot, () => true);

export function AnimatedValue({ value, format }) {
  const element = useRef(null), reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    if (value === null || reducedMotion || value === 0) {
      if (element.current) element.current.textContent = value === null ? 'Not comparable' : format(value);
      return;
    }
    const node = element.current;
    node.textContent = format(0);
    let frame, start;
    const tick = time => {
      if (start === undefined) start = time;
      const progress = Math.min(1, (time - start) / 650);
      node.textContent = format(progress === 1 ? value : value * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, format, reducedMotion]);
  const finalText = value === null ? 'Not comparable' : format(value);
  // Assistive technology receives the final value, not every animation frame.
  return <strong aria-label={finalText} className="scrap-count"><span ref={element} aria-hidden="true">{finalText}</span></strong>;
}

export function ScrapResults({ signature, children }) {
  const element = useRef(null), reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    if (reducedMotion || !element.current?.animate) return;
    const animation = element.current.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    return () => animation.cancel();
  }, [signature, reducedMotion]);
  return <div ref={element} className="scrap-results">{children}</div>;
}

export function ScrapSkeleton({ warehouse }) {
  const sections = warehouse === '' ? ['Confirmed Scrap', 'REG / Recovery Activity'] : [warehouse === 'B-SCR01' ? 'Confirmed Scrap' : 'REG / Recovery Activity'];
  return <div className="scrap-loading" aria-busy="true" aria-label="Loading Production Scrap">
    <p className="scrap-empty" role="status">Loading transactions and BOM commodity mappings…</p>
    <div aria-hidden="true">{sections.map(label => <section className="scrap-section scrap-skeleton-section" key={label}><h2>{label}</h2>
      <div className="scrap-kpis">{Array.from({ length: 4 }, (_, index) => <div className="scrap-kpi" key={index}><div className="scrap-skeleton scrap-skeleton-label" /><div className="scrap-skeleton scrap-skeleton-value" /><div className="scrap-skeleton scrap-skeleton-label" /></div>)}</div>
      <div className="scrap-charts">{Array.from({ length: label === 'Confirmed Scrap' ? 4 : 2 }, (_, index) => <div className="scrap-panel" key={index}><div className="scrap-skeleton scrap-skeleton-label" /><div className="scrap-skeleton scrap-skeleton-chart" /></div>)}</div>
      <div className="scrap-panel"><div className="scrap-skeleton scrap-skeleton-label" />{Array.from({ length: 5 }, (_, index) => <div className="scrap-skeleton scrap-skeleton-row" key={index} />)}</div>
    </section>)}</div>
  </div>;
}
