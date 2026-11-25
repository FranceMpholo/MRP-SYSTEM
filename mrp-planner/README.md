# MRP Planner — Blow Molding

A time-phased material requirements planner: item master, multi-level BOM,
demand, open orders, and a planning ledger that nets requirements against
on-hand stock and lead time. Preloaded with the Blow Molding dataset wired
from Pack Size / Query1 / SS_BR-w.Plan.

## Run it

Run from the **project root** (the directory containing `server/` and `mrp-planner/`):

```bash
npm install
npm run dev
```

`npm run dev` starts the API and Vite together, surfaces startup failures, and
stops the other child if either exits. It refuses occupied ports to avoid duplicate
instances. Open http://localhost:5173. Stop this session with Ctrl+C.

The launcher allows 60 seconds for the API to become ready, including cold module
loading. For slower machines, set `DEV_STARTUP_TIMEOUT_MS=120000` in the root
`.env`. A backend crash still stops startup immediately. If readiness times out,
run `npm run server` from the root to inspect backend startup directly.

For an already-running frontend-only session, start the missing API from the
project root with `npm run server`. The separate frontend command is
`npm run dev:frontend`; running `npm run dev` inside `mrp-planner/` also starts
only Vite. Use the root command for normal startup.

The backend loads the root `.env` regardless of working directory. Keep approved
SQL settings there or in the process environment; do not put credentials in
`VITE_` variables. Missing settings and authentication failures need administrator
attention; a blank password is accepted only if the configured SQL login permits
it. The Vite development and local preview proxies forward `/api` to the backend
port (`PORT`, default 3001). Static production hosting needs its own `/api` proxy.

`/api/ready` checks only the API process. `/api/health` executes a SQL `SELECT 1`
and returns 503 with a safe category on failure; data endpoint checks additionally
exercise permissions on the actual source tables. The UI checks stock and BOM
independently, retries transient read failures with capped backoff, and offers
manual retry. Focus/network restoration triggers throttled checks. Last successful
snapshots remain visible as stale with their timestamp and source; they are not
treated as complete live stock calculations. Authentication/configuration/query
errors do not start an automatic retry loop.

Run `npm test`, `npm run build`, and `git diff --check` from the project root.

Planning normally uploads the original Excel grid, including the Rev2 `Table 1`
layout. Dates resolve from full sheet dates, or a filename year only when all
printed dates and weekdays agree. Approve recurring shift times, overnight dates,
scoped shorthand and quantity rules once; matching uploads reuse the saved profile.
A compact preview shows ready rows, duplicates and exceptions, followed by one
final import confirmation. Failed saves retain the preview, and existing plans,
Actuals, OEE, manual editing and PDF exports are preserved.
See [Planning Excel import](../docs/production-plan-excel-import.md) for the
workflow and the original/second-workbook acceptance test. Test runs use isolated
synthetic browser storage and never add rows to the live plan.

## Build for deployment

```bash
npm run build
```

Outputs static files to `dist/`, which you can host anywhere (Netlify,
Vercel, an internal server, etc.).

## Notes

- Data persists in your browser's `localStorage` (see the shim at the top
  of `src/App.jsx`). It's per-browser, per-machine — not shared between
  people. For multi-user access you'd want a real backend instead.
- Click "Load generic demo instead" in the sidebar to see the simpler demo
  dataset, or "Reload Blow Molding data" to reset back to the real dataset.
