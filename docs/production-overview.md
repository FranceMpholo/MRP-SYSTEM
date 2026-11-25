# Production Overview

The single Dashboard sidebar entry opens six navigation summaries in the approved order. Wide desktop screens use three columns (1280px and above), tablets use two (701–1279px), and phones use one (700px and below). Equal fractional grid rows give all six cards equal widths and heights, across both desktop rows. Sizes remain content-driven: wrapped or enlarged text grows the rows without a fixed height or clipping. Each card has an icon/title/subtitle header, a metrics or concise-status body, and a reporting-period/status footer. A native title button covers the entire card's navigation area; a separate sibling info button sits beside the arrow above that hit area. There are no nested controls or separate Open dashboard buttons. Both controls support native Enter/Space activation and visible keyboard focus. Department details, FCSD and OEE have a simple Back to overview action; unrelated module screens use the existing sidebar navigation. The internal departmental detail state remains available without a duplicate Line Dashboard sidebar entry.

Each card keeps its title, subtitle, period, concise status and supported metrics visible. Numeric quantities show parts or sets beside the value; unavailable quantities remain distinct from zero. Info popovers retain every explanatory paragraph, source note, unit definition, coverage count, missing/duplicate/invalid warning and scope issue previously displayed in the cards. Calculation requirements are also explained there. Important production incompleteness, unavailable and planning-preview badges remain visible without opening notes.

Only one info popover opens at a time. The labelled, nonmodal dialog opens on click or keyboard activation, focuses its close control, and returns focus on close, Escape or outside click. Switching info buttons does not navigate. The panel is portalled to `document.body`, positioned within the visible viewport, and follows scroll/resize/zoom changes. Long notes scroll internally in short windows, independently of the workspace. No hover interaction is required.

## Source and metric contract

| Card | Source / scope | Units / period | Limitations |
| --- | --- | --- | --- |
| Thermoforming | Current workspace `planningWeeks` and supervisor `productionActuals`, linked by unique planning-entry ID; AR1–AR5 and existing Bedliner/TPO classification | Assembly-completed parts, selected active week; effective plan uses the existing adjustment helper | Production Actuals captures assembly completions, not forming output. Expected tailgates and FG postings are excluded. Missing/unverified product scope, invalid dates/machines or invalid plan quantities suppress comparison. Sheet Analysis remains in the existing detail. |
| Blow Molding | Same workspace data; BM01–BM05, existing explicit LH/RH mould-set mappings | Mould sets, selected active week | No expansion into individual LH/RH parts. Generic legacy product codes with unverified units suppress comparison. |
| Rear Step Bumper | Coverage statement based on existing FCSD example classifications and scrap BOM-parent classification | No production quantity or supported period | Those sources do not establish a complete commodity-to-production-run mapping. Opens an unavailable production view, never another area's figures. |
| FCSD Tracker | Existing FCSD screen; read-only SYSPRO part/BOM snapshots loaded on opening | Planning preview only; its own required date | No saved-request, verification, approval or blocked-request counts. No new FCSD fetch occurs for the overview. Existing loading/error states and unsaved-preview leave guard remain. Commodities can overlap other cards. |
| Bumper Frame & Chassis | Coverage statement based on existing FCSD Bumper Frame examples and Chassis Frame filter | No production quantity or supported period | No complete scoped production source or reliable output comparison. Opens an unavailable production view. |
| Overall Plant OEE | Link to the existing OEE module, retaining the selected production line | No plant percentage; OEE's own reporting dates | Existing summaries average complete run percentages within the selected line. This is not a supported plant aggregation, so the overview shows “Plant summary not yet available”. |

Weekly production metrics exclude OFF and Changeover rows. Original plan falls back to legacy build quantity; an explicit adjusted zero is retained. Confirmed numeric actual zero is valid. A missing/blank actual is not zero. A full weekly actual and achievement are shown only when every scoped run has exactly one valid actual, with valid plan identity, product units, date and machine. Partial, invalid and duplicate/corrected actual coverage is labelled. Duplicate actuals remain unresolved regardless of timestamp or array order because no correction lineage contract exists. No new duplicate-resolution policy is applied to existing detailed views.

Material alert counts are not recalculated on the overview. It labels BOM/inventory loading, error or unavailable sources and retains the detailed reporting links. The week controls reuse `selectPlanningWeek`, `mondayOf` and `addCalendarDays`; they affect the two production summaries. FCSD, unavailable commodity coverage statements, and OEE are explicitly outside this filter.

The longer week-filter explanation is now in the small information control beside
the selected week. It uses the same accessible popover as the cards and shares
their single-open-panel behavior. Each footer still shows its applicable period;
the FCSD and OEE explanations about their independent dates remain in their notes.

No production-line enum values were added. Detail entry deliberately selects Thermoforming or Blow Molding; overview/back, FCSD, OEE and unavailable coverage screens preserve the selected line. Navigation uses the existing FCSD confirmation guard. Existing planner autosave remains in place.

## Files in this change

- `mrp-planner/src/App.jsx`: overview/detail navigation, guarded entry/back, toolbar workspace label.
- `mrp-planner/src/dashboard/ProductionOverview.jsx`: six cards and unavailable coverage views.
- `mrp-planner/src/dashboard/CardInfoPopover.jsx`: accessible, viewport-constrained info dialog with portal, dismissal, positioning and focus return.
- `mrp-planner/src/dashboard/PlannerDashboard.jsx`: line-specific machine-performance caption; Thermoforming explicitly describes assembly-completed parts and unavailable forming-output capture.
- `mrp-planner/src/dashboard/productionOverview.css`: responsive navy/teal/white layout.
- `mrp-planner/src/dashboard/deriveProductionOverview.js`: read-only scoped metric selector.
- `tests/productionOverview.test.cjs`: focused metric/scope tests.
- `scripts/smoke-production-overview.cjs`: disposable CDP browser validation with intercepted synthetic API responses.
- `docs/production-overview.md`: source and validation record.

## Verification

Run `node --test tests/*.test.cjs`, `npm run build`, and `git diff --check` from the repository root. All 152 tests pass, including the nine new focused tests; the production build and diff check pass. Migration tests inspect SQL text; they do not apply migrations.

The browser script expects Vite on `http://127.0.0.1:5175` and a **disposable** Edge profile exposing CDP on port 9235. Do not point it at a real browser profile: it deliberately replaces local storage with synthetic fixtures. It intercepts every API request, rejects writes, and blocks external requests. No backend is needed. It validates:

- Six ordered cards; three wide columns, two medium columns and 390/320px single-column layouts; 360px short layouts and 240px viewport-constrained, internally scrolling notes.
- One Dashboard sidebar entry, separate native info/navigation buttons without nesting, full-card pointer hit area, visible keyboard focus, and Enter/Space activation for both controls.
- All six info panels retain their notes, visible metric units, concise statuses and data-quality warnings; info clicks do not navigate, panels switch one at a time, Escape/outside click dismiss, and focus returns to the trigger. Portals remain inside the viewport during scrolling/resizing and on mobile.
- All card/detail/back routes, line selection, existing Sheet Analysis/Cycle Count access, FCSD dirty-preview cancellation and accepted leave.
- Fixed branding and toolbar, independently scrolling navigation/content, keyboard dismissal and short-window utility menus.
- Confirmed zero, missing/duplicate actuals, empty weeks, source loading/errors and FCSD errors.
- Unchanged synthetic planning, actuals and Cycle Count data after navigation/autosave, zero API writes and zero runtime exceptions.

Ignored local evidence for the info-popover update is stored under `diagnostics/production-overview-info/`: desktop/medium/mobile/short-height/incomplete screenshots, info-panel screenshots and `browser-report.json`. Screenshots show synthetic data, not business results. Pre-edit copies of the cards and styles and SHA-256 hashes of every pre-existing uncommitted file support the preservation check. This update changes only the overview component/styles, adds the info-dialog component, and updates documentation/browser validation. The selector, calculations, App navigation/permissions, existing shell and business data are unchanged.

The browser script records intercepted synthetic GET requests, API writes and runtime exceptions in its report, and asserts zero API writes and runtime exceptions. The info-popover run passed with 24 intercepted synthetic GET requests, zero API writes and zero runtime exceptions. Native mouse-wheel events verify independent scroll ownership. The preservation audit compares pre-existing uncommitted files against their hashes and checks for changes outside the intended dashboard files.

No commit, deployment, migration application, SYSPRO write, PDF Planning import or detailed Thermoforming WIP work is part of this change.

## Overview visual redesign — 18 November 2026

The redesign changes only `ProductionOverview.jsx` and `productionOverview.css`
in the application. Navy/teal styling, tinted icon tiles, aligned metric rows,
consistent footers, restrained status colours, soft hover and keyboard focus
replace the previous uneven compact cards. The metric selector, App navigation,
sidebar, data sources and calculations are unchanged. FCSD remains planning
preview only; Plant OEE remains unavailable. Unavailable values never become zero.

`scripts/smoke-production-overview-redesign.cjs` reuses the existing development
frontend on port 5173 and requires an isolated Edge profile exposing CDP 9248.
It replaces only that disposable profile's local data with synthetic fixtures,
intercepts API GETs and blocks external requests. Never use a real profile.
Evidence is under ignored `diagnostics/production-overview-redesign/`:

- `browser-report.json` records every card's dimensions at desktop widths
  1600/1440/1366, tablet widths 1100/1024/820/768, and phone widths 390/320.
  All six cards have equal widths/heights within one pixel with no content
  clipping. Production metric labels and values align across both source cards.
- Enlarged text exercises intrinsic card growth; zoom checks include both a
  200% layout equivalent and the isolated browser's actual 200% zoom setting.
  The browser setting is restored after verification. Info panels fit the
  viewport at zoom and in short mobile windows.
- Native pointer/Enter/Space checks cover card bodies, footers, arrows and
  independent info controls, plus Escape, outside dismissal and focus return.
  Week-filter information opens without navigating. All original card/detail/back
  routes and the single Dashboard sidebar entry remain available.
- Confirmed zero, missing/duplicate actuals, empty weeks, unavailable Plant OEE,
  FCSD preview/error, loading/error source notes and local-record preservation
  use the existing fixtures. The run records zero API writes and runtime errors.
- All nine existing overview metric tests, production build and `git diff --check`
  pass. The build retains the existing large-chunk advisory.

`baseline.json` records pre-edit hashes, allowing preservation checks to confirm
that all other existing work is unchanged. No backend restart is required.
