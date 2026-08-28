# MRP Planner — Blow Molding

A time-phased material requirements planner: item master, multi-level BOM,
demand, open orders, and a planning ledger that nets requirements against
on-hand stock and lead time. Preloaded with the Blow Molding dataset wired
from Pack Size / Query1 / SS_BR-w.Plan.

## Run it

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually http://localhost:5173).

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
