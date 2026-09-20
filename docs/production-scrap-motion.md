# Production Scrap presentation update

The charts use custom React/SVG, not an external chart library. No animation dependency was added.

- Horizontal bars grow along X from the zero baseline; vertical bars grow along Y from zero. Negative values retain their original direction and values.
- Line series reveal left to right using an animated SVG clip. Markers fade as a group, avoiding thousands of separate animations on long daily series.
- Chart growth/reveal and numeric count-ups run for 650 ms with smooth easing; dataset fades take 200 ms.
- KPI count-ups receive original numeric values and reuse the existing currency and quantity formatters. Final values are exact; signed values and Not comparable remain intact. Animation frames update only presentation text.
- Hover emphasizes bars without geometric scaling. Line hover selects the nearest date/series point. Tooltips expose labels, dates and formatted values, with keyboard-focus support and Escape dismissal. Native SVG titles remain available.
- Loading displays skeleton KPI cards, charts and table rows, with a status announcement and no misleading KPI zeros.
- Plotted-content signatures preserve the animated SVG group on equal data and unrelated renders. Result fades do not remount the table or change pagination. Count-ups depend on the numeric value and formatter, not parent object identity.
- `prefers-reduced-motion` disables CSS animations/transitions and cancels count-ups/result fades; final values render immediately.

Changed presentation files: `mrp-planner/src/scrap/ProductionScrap.jsx`, `ScrapCharts.jsx`, `productionScrap.css`; added `scrapMotion.jsx`. `mrp-planner/src/App.jsx` changes sidebar order only for this request, preserving existing IDs, permissions and module rendering.

Requested sidebar order: Dashboard, Planning, Production MRP, Production Actuals, Cycle Count, Production Scrap, OEE, Items, Bill of Materials, Planning Ledger, Users.

Browser checks in `scripts/smoke-scrap-motion.cjs` cover initial loading, both date filters, commodity and movement views, stock search, chart growth/reveal, nearest-point and keyboard tooltips, count-up completion/formatting, reduced motion, unchanged pagination, and no animation restarts from hover/pagination. The isolated browser intercepts synthetic responses and does not contact a database.

No calculation module, SQL query, API route, commodity mapping, filtering, or pagination logic is changed by the presentation behavior described here.
