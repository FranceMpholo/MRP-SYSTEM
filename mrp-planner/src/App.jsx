import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  LayoutDashboard, Package, Boxes, ListTree, CalendarClock, PlayCircle,
  Plus, Trash2, AlertTriangle, CheckCircle2, Loader2, RotateCcw, ChevronRight,
  CalendarRange
} from "lucide-react";

/* --------------------------------------------------------------------- */
/*  Local storage shim — replaces Claude.ai's window.storage sandbox API */
/*  so this app persists data via the browser's localStorage instead.    */
/* --------------------------------------------------------------------- */
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      const v = localStorage.getItem(key);
      return v === null ? null : { key, value: v, shared: false };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { key, value, shared: false };
    },
    async delete(key) {
      localStorage.removeItem(key);
      return { key, deleted: true, shared: false };
    },
    async list(prefix = "") {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
      return { keys, prefix, shared: false };
    },
  };
}

/* ---------------------------------------------------------------------- */
/*  Tokens                                                                */
/* ---------------------------------------------------------------------- */
const T = {
  ink: "#1B2430",
  inkSoft: "#2B3646",
  paper: "#F6F4EE",
  card: "#FFFFFF",
  line: "#E3DFD2",
  rule: "#C9C2AE",
  muted: "#746C5C",
  text: "#232323",
  copper: "#B5641F",
  copperDark: "#8C4A15",
  copperTint: "#F1E3D3",
  brick: "#A6362B",
  brickTint: "#F3E1DE",
  green: "#2F6F4E",
  greenTint: "#E1EBE3",
  sidebarText: "#D9D4C4",
  sidebarTextDim: "#8C93A0",
};

const FONTS = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    .plex-sans { font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif; }
    .plex-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
    .mrp-input { border: 1px solid ${T.rule}; background: #fff; padding: 6px 8px; font-size: 13px; border-radius: 3px; color: ${T.text}; }
    .mrp-input:focus { outline: none; border-color: ${T.copper}; box-shadow: 0 0 0 2px ${T.copperTint}; }
    .mrp-btn { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:500; padding:7px 12px; border-radius:3px; cursor:pointer; border:1px solid transparent; transition: background .12s ease; }
    .mrp-btn-primary { background:${T.copper}; color:#fff; }
    .mrp-btn-primary:hover { background:${T.copperDark}; }
    .mrp-btn-ghost { background:transparent; border-color:${T.rule}; color:${T.ink}; }
    .mrp-btn-ghost:hover { background:${T.line}; }
    .mrp-table { width:100%; border-collapse:collapse; font-size:13px; }
    .mrp-table th { text-align:left; font-weight:500; color:${T.muted}; font-size:11px; text-transform:uppercase; letter-spacing:.04em; padding:8px 10px; border-bottom:1px solid ${T.rule}; white-space:nowrap; }
    .mrp-table td { padding:6px 10px; border-bottom:1px solid ${T.line}; vertical-align:middle; }
    .mrp-table tr:hover td { background:#FBFAF6; }
    ::-webkit-scrollbar { height:10px; width:10px; }
    ::-webkit-scrollbar-track { background:#efeadf; }
    ::-webkit-scrollbar-thumb { background:${T.rule}; border-radius:6px; border:2px solid #efeadf; }
    .mrp-report-table th { background:#dfeaf3; color:${T.ink}; border-right:1px solid ${T.line}; }
    .mrp-report-table td { border-right:1px solid ${T.line}; }
    .mrp-report-table tr:nth-child(even) td { background:#f8f6f1; }
  `}</style>
);

/* ---------------------------------------------------------------------- */
/*  Helpers                                                               */
/* ---------------------------------------------------------------------- */
const uid = () => "id_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const todayISO = () => new Date().toISOString().slice(0, 10);

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function fmtShort(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function fmtNum(n) {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return r.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* ---------------------------------------------------------------------- */
/*  MRP engine                                                           */
/* ---------------------------------------------------------------------- */
function computeLLC(items, boms) {
  const llc = {};
  items.forEach((i) => (llc[i.id] = 0));
  let changed = true;
  let guard = 0;
  while (changed && guard < items.length + 3) {
    changed = false;
    boms.forEach((b) => {
      const cand = (llc[b.parentId] || 0) + 1;
      if ((llc[b.componentId] || 0) < cand) {
        llc[b.componentId] = cand;
        changed = true;
      }
    });
    guard++;
  }
  return llc;
}

function runMRP(items, boms, demands, openOrders, weeksCount, monday) {
  const llc = computeLLC(items, boms);
  const order = [...items].sort((a, b) => (llc[a.id] || 0) - (llc[b.id] || 0));
  const dependentGR = {};
  items.forEach((i) => (dependentGR[i.id] = new Array(weeksCount).fill(0)));

  const bucketIndex = (dateStr) => {
    const idx = Math.floor(daysBetween(monday, dateStr) / 7);
    return Math.min(Math.max(idx, 0), weeksCount - 1);
  };
  const isPastDue = (dateStr) => daysBetween(monday, dateStr) < 0;

  const results = {};

  order.forEach((item) => {
    const GR = new Array(weeksCount).fill(0);
    let pastDueDemand = 0;
    demands.filter((d) => d.itemId === item.id).forEach((d) => {
      if (isPastDue(d.dueDate)) pastDueDemand += Number(d.qty) || 0;
      GR[bucketIndex(d.dueDate)] += Number(d.qty) || 0;
    });
    for (let w = 0; w < weeksCount; w++) GR[w] += dependentGR[item.id][w];

    const SR = new Array(weeksCount).fill(0);
    openOrders.filter((o) => o.itemId === item.id).forEach((o) => {
      SR[bucketIndex(o.dueDate)] += Number(o.qty) || 0;
    });

    const leadWeeks = Math.max(0, Math.ceil((Number(item.leadTimeDays) || 0) / 7));
    const safety = Number(item.safetyStock) || 0;
    const lot = Number(item.lotSize) || 0;

    const POH = [];
    const PORcpt = new Array(weeksCount).fill(0);
    const PORel = new Array(weeksCount).fill(0);
    let running = Number(item.onHand) || 0;
    let pastDueRelease = 0;

    for (let w = 0; w < weeksCount; w++) {
      const avail = running + SR[w] - GR[w];
      let rcpt = 0;
      if (avail < safety) {
        const need = safety - avail;
        rcpt = lot > 0 ? Math.ceil(need / lot) * lot : need;
      }
      PORcpt[w] = rcpt;
      running = avail + rcpt;
      POH.push(running);

      if (rcpt > 0) {
        const relIdx = w - leadWeeks;
        if (relIdx < 0) {
          pastDueRelease += rcpt;
          PORel[0] += rcpt;
        } else {
          PORel[relIdx] += rcpt;
        }
      }
    }

    results[item.id] = { GR, SR, POH, PORcpt, PORel, pastDueRelease, pastDueDemand, llc: llc[item.id] || 0 };

    boms.filter((b) => b.parentId === item.id).forEach((b) => {
      for (let w = 0; w < weeksCount; w++) {
        if (PORel[w] > 0) dependentGR[b.componentId][w] += PORel[w] * (Number(b.qtyPer) || 0);
      }
    });
  });

  return results;
}

/* ---------------------------------------------------------------------- */
/*  Blow Molding — live dataset (wired from Pack Size / Query1 / SS_BR-w.Plan) */
/* ---------------------------------------------------------------------- */
const BM_DATA = {"items":[{"id":"120032","code":"120032","description":"Steel Metal Off-cuts and Rejects","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":0,"onHand":16290.995,"uom":"EA"},{"id":"121001","code":"121001","description":"3M Protective Film 21804C","type":"Buy","leadTimeDays":150,"safetyStock":0,"lotSize":2000,"onHand":2161.847,"uom":"EA"},{"id":"121007","code":"121007","description":"Bright Work Dbl Rh Brushed (316) Fmcsa","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":0,"onHand":164,"uom":"EA"},{"id":"121017","code":"121017","description":"Center Brkt Stamping Side Step (Fmcsa)","type":"Buy","leadTimeDays":113,"safetyStock":0,"lotSize":36,"onHand":8,"uom":"EA"},{"id":"121018","code":"121018","description":"Front Brkt Stamping Side Step (Fmcsa)","type":"Buy","leadTimeDays":113,"safetyStock":0,"lotSize":36,"onHand":7,"uom":"EA"},{"id":"121021","code":"121021","description":"Isr 70-05 Adhesive_Simson (600 Ml/Bags)","type":"Buy","leadTimeDays":60,"safetyStock":0,"lotSize":12,"onHand":235.332,"uom":"EA"},{"id":"121022","code":"121022","description":"Kuao Leng Bolt M6 x 1.0 x 16 mm","type":"Buy","leadTimeDays":60,"safetyStock":0,"lotSize":1600,"onHand":69759,"uom":"EA"},{"id":"121023","code":"121023","description":"Plastic Rivet (Pd-5060-Tl)","type":"Buy","leadTimeDays":3,"safetyStock":0,"lotSize":2000,"onHand":37823,"uom":"EA"},{"id":"121025","code":"121025","description":"Rear Brkt Stamping Side Step (Fmcsa)","type":"Buy","leadTimeDays":113,"safetyStock":0,"lotSize":1,"onHand":2,"uom":"EA"},{"id":"121029","code":"121029","description":"Bright Work RAP SS304 Brushed RH (P703)","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"121030","code":"121030","description":"Bright Work RAP SS304 Brushed LH (P703)","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"121031","code":"121031","description":"Bright Work RAP 316 Polished RH (P703)","type":"Buy","leadTimeDays":124,"safetyStock":0,"lotSize":1,"onHand":94,"uom":"EA"},{"id":"121034","code":"121034","description":"Bright Work RAP 316 Brushed LH (P703)","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":0,"onHand":200,"uom":"EA"},{"id":"121038","code":"121038","description":"Bright Work DBL SS304 Brushed LH (P703)","type":"Buy","leadTimeDays":124,"safetyStock":0,"lotSize":1,"onHand":88,"uom":"EA"},{"id":"121041","code":"121041","description":"Bright Work DBL316 Brushed RH (P703)","type":"Buy","leadTimeDays":213,"safetyStock":0,"lotSize":80,"onHand":211,"uom":"EA"},{"id":"121042","code":"121042","description":"Bright Work DBL316 Brushed LH (P703)","type":"Buy","leadTimeDays":60,"safetyStock":0,"lotSize":80,"onHand":207,"uom":"EA"},{"id":"121046","code":"121046","description":"Hifax EBGB 626GP C12716 PP20%","type":"Buy","leadTimeDays":45,"safetyStock":0,"lotSize":650,"onHand":2887.25,"uom":"EA"},{"id":"121050","code":"121050","description":"Metal Coil - 3.0mm thick, 428mm wide","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":1,"onHand":12753.184,"uom":"EA"},{"id":"121051","code":"121051","description":"Metal Coil - 3.0mm thick, 407mm wide","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":1,"onHand":78.63,"uom":"EA"},{"id":"121054","code":"121054","description":"ABS AX4300","type":"Buy","leadTimeDays":68,"safetyStock":0,"lotSize":900,"onHand":10515.7,"uom":"EA"},{"id":"121057","code":"121057","description":"Barcode Label - White - Thermal (Side Stp) 75 x 50","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":1,"onHand":2.521,"uom":"EA"},{"id":"121062","code":"121062","description":"Barcode Label - White - Thermal - (BWork) 75 x 25","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":1,"onHand":0.842,"uom":"EA"},{"id":"121065","code":"121065","description":"Regrind - Hifax EBGB 626GP C12716 PP20%","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":108247,"uom":"EA"},{"id":"121067","code":"121067","description":"Triangle Insert Nut 12mm. M6 x 1.0","type":"Buy","leadTimeDays":45,"safetyStock":0,"lotSize":3000,"onHand":82233,"uom":"EA"},{"id":"121080","code":"121080","description":"HE Resin 1000 KG","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"121081","code":"121081","description":"Pigment Paste","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"121100","code":"121100","description":"Resin Pigment Mix","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"121146","code":"121146","description":"ABS Off-cuts and Rejects","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":0,"onHand":3129,"uom":"EA"},{"id":"121150","code":"121150","description":"PP Off-cuts and Rejects","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":0,"onHand":0.5,"uom":"EA"},{"id":"200220","code":"200220","description":"Primer K540 NT (1 Ltr)","type":"Buy","leadTimeDays":3,"safetyStock":0,"lotSize":1,"onHand":30.371,"uom":"EA"},{"id":"EB3Z-16450-MK","code":"EB3Z-16450-MK","description":"P375 SS DBL 316 Brushed - MJ - RH - Service","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"FCSD-18","code":"FCSD-18","description":"Box for P703 Side Step","type":"Buy","leadTimeDays":7,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-16450-BAA","code":"N1WB-16450-BAA","description":"P703 SS RAP Low Series - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-16450-BB","code":"N1WB-16450-BB","description":"P703 SS RAP Low Series - BB - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":1,"onHand":34,"uom":"EA"},{"id":"N1WB-16450-CA","code":"N1WB-16450-CA","description":"P703 SS DBL Low Series - CA - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":69,"uom":"EA"},{"id":"N1WB-16450-CAA","code":"N1WB-16450-CAA","description":"P703 SS DBL Low Series - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-16450-LAA","code":"N1WB-16450-LAA","description":"P703 SS DBL High Series - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-16450-LB","code":"N1WB-16450-LB","description":"P703 SS DBL High Series 316 Brushed - LB - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-16451-B-PIA-A","code":"N1WB-16451-B-PIA-A","description":"P703 Front Bracket - In House ATD","type":"Make","leadTimeDays":2,"safetyStock":0,"lotSize":1,"onHand":4841,"uom":"EA"},{"id":"N1WB-16451-B-PIA-B","code":"N1WB-16451-B-PIA-B","description":"P703 Center Bracket - In House ATD","type":"Make","leadTimeDays":2,"safetyStock":0,"lotSize":1,"onHand":973,"uom":"EA"},{"id":"N1WB-16451-B-PIA-C","code":"N1WB-16451-B-PIA-C","description":"P703 Rear Bracket - In House ATD","type":"Make","leadTimeDays":2,"safetyStock":0,"lotSize":1,"onHand":2967,"uom":"EA"},{"id":"N1WB-16451-BAA","code":"N1WB-16451-BAA","description":"P703 SS RAP Low Series - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-16451-BB","code":"N1WB-16451-BB","description":"P703 SS RAP Low Series - BB - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-16451-CA","code":"N1WB-16451-CA","description":"P703 SS DBL Low Series - CA - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":40,"uom":"EA"},{"id":"N1WB-16451-CAA","code":"N1WB-16451-CAA","description":"P703 SS DBL Low Series - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-16451-LAA","code":"N1WB-16451-LAA","description":"P703 SS DBL High Series 316 Brushed - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-16451-LB","code":"N1WB-16451-LB","description":"P703 SS DBL High Series 316 Brushed - LB - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-E291A34-E-PIA-02","code":"N1WB-E291A34-E-PIA-02","description":"Aluminium Locating Pin - 10 x 33.74","type":"Buy","leadTimeDays":14,"safetyStock":0,"lotSize":1200,"onHand":6740,"uom":"EA"},{"id":"N1WB-E291A34-E-PIA-03","code":"N1WB-E291A34-E-PIA-03","description":"Plastic Clip","type":"Buy","leadTimeDays":45,"safetyStock":0,"lotSize":1000,"onHand":74314,"uom":"EA"},{"id":"N1WB-J29140-AH","code":"N1WB-J29140-AH","description":"Box Rail - P703 - Rap Cab - RH - AH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WB-J29141-AH","code":"N1WB-J29141-AH","description":"Box Rail - P703 - Rap Cab - LH - AH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WZ-16450-R","code":"N1WZ-16450-R","description":"P703 SS DBL Low Series -R- RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WZ-16450-S","code":"N1WZ-16450-S","description":"P703 SS RAP High Series 316 Polished - HB- RH-Svc","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WZ-16451-B","code":"N1WZ-16451-B","description":"P703 SS DBL Low Series -B- LH - Svc","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WZ-16451-D","code":"N1WZ-16451-D","description":"P703 SS DBL High Series 304 Brushed - D - LH - Svc","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WZ-16451-F","code":"N1WZ-16451-F","description":"P703 SS RAP Low Series - BB - LH - Svc","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WZ-16451-Q","code":"N1WZ-16451-Q","description":"P703 SS DBL Low Series -Q- LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1WZ-16451-S","code":"N1WZ-16451-S","description":"P703 SS RAP High Series 316 Brushed - JB- LH-Svc","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1XB-16450-AA","code":"N1XB-16450-AA","description":"J73 SS DBL Low Series - AA - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1XB-16450-ABA","code":"N1XB-16450-ABA","description":"J73 SS DBL Low Series - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1XB-16450-B-PIA-02","code":"N1XB-16450-B-PIA-02","description":"316 Polished Brightwork - RH","type":"Buy","leadTimeDays":14,"safetyStock":0,"lotSize":15,"onHand":644,"uom":"EA"},{"id":"N1XB-16450-BA","code":"N1XB-16450-BA","description":"J73 SS DBL\u00a0High Series 316 Polished - BA - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1XB-16450-BAA","code":"N1XB-16450-BAA","description":"J73 SS DBL High Series - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1XB-16451-AA","code":"N1XB-16451-AA","description":"J73 SS DBL Low Series - AA - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1XB-16451-ABA","code":"N1XB-16451-ABA","description":"J73 SS DBL Low Series - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1XB-16451-B-PIA-02","code":"N1XB-16451-B-PIA-02","description":"316 Polished Brightwork - LH","type":"Buy","leadTimeDays":14,"safetyStock":0,"lotSize":15,"onHand":558,"uom":"EA"},{"id":"N1XB-16451-BA","code":"N1XB-16451-BA","description":"J73 SS DBL\u00a0 High Series 316 Polished - BA - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1XB-16451-BAA","code":"N1XB-16451-BAA","description":"J73 SS DBL High Series - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1XB-E29076-A-PIA-05","code":"N1XB-E29076-A-PIA-05","description":"M8 Threaded Stud J73","type":"Buy","leadTimeDays":14,"safetyStock":0,"lotSize":600,"onHand":1661,"uom":"EA"},{"id":"N1XB-E29076-A-PIA-06","code":"N1XB-E29076-A-PIA-06","description":"Aluminium Locating Pin - 5.8 x 33.4","type":"Buy","leadTimeDays":14,"safetyStock":0,"lotSize":2200,"onHand":9142,"uom":"EA"},{"id":"N1XB-E29140-AC","code":"N1XB-E29140-AC","description":"Box Rail - J73 - Dbl Cab - RH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"},{"id":"N1XB-E29141-AC","code":"N1XB-E29141-AC","description":"Box Rail - J73 - Dbl Cab - LH","type":"Make","leadTimeDays":1,"safetyStock":0,"lotSize":0,"onHand":0,"uom":"EA"}],"boms":[{"id":"bom_N1WZ-16451-B_121022","parentId":"N1WZ-16451-B","componentId":"121022","qtyPer":6},{"id":"bom_N1WZ-16451-B_121046","parentId":"N1WZ-16451-B","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WZ-16451-B_121057","parentId":"N1WZ-16451-B","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WZ-16451-B_121065","parentId":"N1WZ-16451-B","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WZ-16451-B_121067","parentId":"N1WZ-16451-B","componentId":"121067","qtyPer":6},{"id":"bom_N1WZ-16451-B_FCSD-18","parentId":"N1WZ-16451-B","componentId":"FCSD-18","qtyPer":1},{"id":"bom_N1WZ-16451-B_N1WB-16451-B-PIA-A","parentId":"N1WZ-16451-B","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WZ-16451-B_N1WB-16451-B-PIA-B","parentId":"N1WZ-16451-B","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WZ-16451-B_N1WB-16451-B-PIA-C","parentId":"N1WZ-16451-B","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16451-B-PIA-C_120032","parentId":"N1WB-16451-B-PIA-C","componentId":"120032","qtyPer":-0.29},{"id":"bom_N1WB-16451-B-PIA-C_121051","parentId":"N1WB-16451-B-PIA-C","componentId":"121051","qtyPer":1.073},{"id":"bom_N1WB-16451-B-PIA-C_121100","parentId":"N1WB-16451-B-PIA-C","componentId":"121100","qtyPer":0.00221},{"id":"bom_121100_121080","parentId":"121100","componentId":"121080","qtyPer":2.261566},{"id":"bom_121100_121081","parentId":"121100","componentId":"121081","qtyPer":0.192901},{"id":"bom_N1WB-16451-B-PIA-B_120032","parentId":"N1WB-16451-B-PIA-B","componentId":"120032","qtyPer":-0.3},{"id":"bom_N1WB-16451-B-PIA-B_121051","parentId":"N1WB-16451-B-PIA-B","componentId":"121051","qtyPer":0.951},{"id":"bom_N1WB-16451-B-PIA-B_121100","parentId":"N1WB-16451-B-PIA-B","componentId":"121100","qtyPer":0.00221},{"id":"bom_N1WB-16451-B-PIA-A_120032","parentId":"N1WB-16451-B-PIA-A","componentId":"120032","qtyPer":-0.29},{"id":"bom_N1WB-16451-B-PIA-A_121050","parentId":"N1WB-16451-B-PIA-A","componentId":"121050","qtyPer":1.012},{"id":"bom_N1WB-16451-B-PIA-A_121100","parentId":"N1WB-16451-B-PIA-A","componentId":"121100","qtyPer":0.0024},{"id":"bom_121065_121150","parentId":"121065","componentId":"121150","qtyPer":1},{"id":"bom_N1WZ-16451-F_121022","parentId":"N1WZ-16451-F","componentId":"121022","qtyPer":6},{"id":"bom_N1WZ-16451-F_121046","parentId":"N1WZ-16451-F","componentId":"121046","qtyPer":6.65},{"id":"bom_N1WZ-16451-F_121057","parentId":"N1WZ-16451-F","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WZ-16451-F_121065","parentId":"N1WZ-16451-F","componentId":"121065","qtyPer":2.85},{"id":"bom_N1WZ-16451-F_121067","parentId":"N1WZ-16451-F","componentId":"121067","qtyPer":6},{"id":"bom_N1WZ-16451-F_FCSD-18","parentId":"N1WZ-16451-F","componentId":"FCSD-18","qtyPer":1},{"id":"bom_N1WZ-16451-F_N1WB-16451-B-PIA-A","parentId":"N1WZ-16451-F","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WZ-16451-F_N1WB-16451-B-PIA-B","parentId":"N1WZ-16451-F","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WZ-16451-F_N1WB-16451-B-PIA-C","parentId":"N1WZ-16451-F","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WZ-16451-S_121001","parentId":"N1WZ-16451-S","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1WZ-16451-S_121021","parentId":"N1WZ-16451-S","componentId":"121021","qtyPer":0.1},{"id":"bom_N1WZ-16451-S_121022","parentId":"N1WZ-16451-S","componentId":"121022","qtyPer":6},{"id":"bom_N1WZ-16451-S_121023","parentId":"N1WZ-16451-S","componentId":"121023","qtyPer":8},{"id":"bom_N1WZ-16451-S_121034","parentId":"N1WZ-16451-S","componentId":"121034","qtyPer":1},{"id":"bom_N1WZ-16451-S_121046","parentId":"N1WZ-16451-S","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WZ-16451-S_121057","parentId":"N1WZ-16451-S","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WZ-16451-S_121062","parentId":"N1WZ-16451-S","componentId":"121062","qtyPer":0.002},{"id":"bom_N1WZ-16451-S_121065","parentId":"N1WZ-16451-S","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WZ-16451-S_121067","parentId":"N1WZ-16451-S","componentId":"121067","qtyPer":6},{"id":"bom_N1WZ-16451-S_200220","parentId":"N1WZ-16451-S","componentId":"200220","qtyPer":0.0023},{"id":"bom_N1WZ-16451-S_FCSD-18","parentId":"N1WZ-16451-S","componentId":"FCSD-18","qtyPer":1},{"id":"bom_N1WZ-16451-S_N1WB-16451-B-PIA-A","parentId":"N1WZ-16451-S","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WZ-16451-S_N1WB-16451-B-PIA-B","parentId":"N1WZ-16451-S","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WZ-16451-S_N1WB-16451-B-PIA-C","parentId":"N1WZ-16451-S","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WZ-16450-S_121001","parentId":"N1WZ-16450-S","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1WZ-16450-S_121021","parentId":"N1WZ-16450-S","componentId":"121021","qtyPer":0.1},{"id":"bom_N1WZ-16450-S_121022","parentId":"N1WZ-16450-S","componentId":"121022","qtyPer":6},{"id":"bom_N1WZ-16450-S_121023","parentId":"N1WZ-16450-S","componentId":"121023","qtyPer":8},{"id":"bom_N1WZ-16450-S_121031","parentId":"N1WZ-16450-S","componentId":"121031","qtyPer":1},{"id":"bom_N1WZ-16450-S_121046","parentId":"N1WZ-16450-S","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WZ-16450-S_121057","parentId":"N1WZ-16450-S","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WZ-16450-S_121062","parentId":"N1WZ-16450-S","componentId":"121062","qtyPer":0.002},{"id":"bom_N1WZ-16450-S_121065","parentId":"N1WZ-16450-S","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WZ-16450-S_121067","parentId":"N1WZ-16450-S","componentId":"121067","qtyPer":6},{"id":"bom_N1WZ-16450-S_200220","parentId":"N1WZ-16450-S","componentId":"200220","qtyPer":0.0023},{"id":"bom_N1WZ-16450-S_FCSD-18","parentId":"N1WZ-16450-S","componentId":"FCSD-18","qtyPer":1},{"id":"bom_N1WZ-16450-S_N1WB-16451-B-PIA-A","parentId":"N1WZ-16450-S","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WZ-16450-S_N1WB-16451-B-PIA-B","parentId":"N1WZ-16450-S","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WZ-16450-S_N1WB-16451-B-PIA-C","parentId":"N1WZ-16450-S","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WZ-16451-Q_121001","parentId":"N1WZ-16451-Q","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1WZ-16451-Q_121021","parentId":"N1WZ-16451-Q","componentId":"121021","qtyPer":0.1},{"id":"bom_N1WZ-16451-Q_121022","parentId":"N1WZ-16451-Q","componentId":"121022","qtyPer":6},{"id":"bom_N1WZ-16451-Q_121023","parentId":"N1WZ-16451-Q","componentId":"121023","qtyPer":8},{"id":"bom_N1WZ-16451-Q_121030","parentId":"N1WZ-16451-Q","componentId":"121030","qtyPer":1},{"id":"bom_N1WZ-16451-Q_121046","parentId":"N1WZ-16451-Q","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WZ-16451-Q_121057","parentId":"N1WZ-16451-Q","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WZ-16451-Q_121062","parentId":"N1WZ-16451-Q","componentId":"121062","qtyPer":0.002},{"id":"bom_N1WZ-16451-Q_121065","parentId":"N1WZ-16451-Q","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WZ-16451-Q_121067","parentId":"N1WZ-16451-Q","componentId":"121067","qtyPer":6},{"id":"bom_N1WZ-16451-Q_200220","parentId":"N1WZ-16451-Q","componentId":"200220","qtyPer":0.0023},{"id":"bom_N1WZ-16451-Q_FCSD-18","parentId":"N1WZ-16451-Q","componentId":"FCSD-18","qtyPer":1},{"id":"bom_N1WZ-16451-Q_N1WB-16451-B-PIA-A","parentId":"N1WZ-16451-Q","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WZ-16451-Q_N1WB-16451-B-PIA-B","parentId":"N1WZ-16451-Q","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WZ-16451-Q_N1WB-16451-B-PIA-C","parentId":"N1WZ-16451-Q","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WZ-16450-R_121001","parentId":"N1WZ-16450-R","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1WZ-16450-R_121021","parentId":"N1WZ-16450-R","componentId":"121021","qtyPer":0.1},{"id":"bom_N1WZ-16450-R_121022","parentId":"N1WZ-16450-R","componentId":"121022","qtyPer":6},{"id":"bom_N1WZ-16450-R_121023","parentId":"N1WZ-16450-R","componentId":"121023","qtyPer":8},{"id":"bom_N1WZ-16450-R_121029","parentId":"N1WZ-16450-R","componentId":"121029","qtyPer":1},{"id":"bom_N1WZ-16450-R_121046","parentId":"N1WZ-16450-R","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WZ-16450-R_121057","parentId":"N1WZ-16450-R","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WZ-16450-R_121062","parentId":"N1WZ-16450-R","componentId":"121062","qtyPer":0.001},{"id":"bom_N1WZ-16450-R_121065","parentId":"N1WZ-16450-R","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WZ-16450-R_121067","parentId":"N1WZ-16450-R","componentId":"121067","qtyPer":6},{"id":"bom_N1WZ-16450-R_121150","parentId":"N1WZ-16450-R","componentId":"121150","qtyPer":-3.35},{"id":"bom_N1WZ-16450-R_200220","parentId":"N1WZ-16450-R","componentId":"200220","qtyPer":0.0023},{"id":"bom_N1WZ-16450-R_FCSD-18","parentId":"N1WZ-16450-R","componentId":"FCSD-18","qtyPer":1},{"id":"bom_N1WZ-16450-R_N1WB-16451-B-PIA-A","parentId":"N1WZ-16450-R","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WZ-16450-R_N1WB-16451-B-PIA-B","parentId":"N1WZ-16450-R","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WZ-16450-R_N1WB-16451-B-PIA-C","parentId":"N1WZ-16450-R","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_EB3Z-16450-MK_121001","parentId":"EB3Z-16450-MK","componentId":"121001","qtyPer":0.0087},{"id":"bom_EB3Z-16450-MK_121007","parentId":"EB3Z-16450-MK","componentId":"121007","qtyPer":1},{"id":"bom_EB3Z-16450-MK_121017","parentId":"EB3Z-16450-MK","componentId":"121017","qtyPer":1},{"id":"bom_EB3Z-16450-MK_121018","parentId":"EB3Z-16450-MK","componentId":"121018","qtyPer":1},{"id":"bom_EB3Z-16450-MK_121021","parentId":"EB3Z-16450-MK","componentId":"121021","qtyPer":0.03},{"id":"bom_EB3Z-16450-MK_121022","parentId":"EB3Z-16450-MK","componentId":"121022","qtyPer":6},{"id":"bom_EB3Z-16450-MK_121023","parentId":"EB3Z-16450-MK","componentId":"121023","qtyPer":5},{"id":"bom_EB3Z-16450-MK_121025","parentId":"EB3Z-16450-MK","componentId":"121025","qtyPer":1},{"id":"bom_EB3Z-16450-MK_121046","parentId":"EB3Z-16450-MK","componentId":"121046","qtyPer":4.73},{"id":"bom_EB3Z-16450-MK_121065","parentId":"EB3Z-16450-MK","componentId":"121065","qtyPer":2.03},{"id":"bom_EB3Z-16450-MK_121067","parentId":"EB3Z-16450-MK","componentId":"121067","qtyPer":6},{"id":"bom_EB3Z-16450-MK_200220","parentId":"EB3Z-16450-MK","componentId":"200220","qtyPer":0.00015},{"id":"bom_EB3Z-16450-MK_FCSD-18","parentId":"EB3Z-16450-MK","componentId":"FCSD-18","qtyPer":1},{"id":"bom_N1WZ-16451-D_121001","parentId":"N1WZ-16451-D","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1WZ-16451-D_121021","parentId":"N1WZ-16451-D","componentId":"121021","qtyPer":0.1},{"id":"bom_N1WZ-16451-D_121022","parentId":"N1WZ-16451-D","componentId":"121022","qtyPer":6},{"id":"bom_N1WZ-16451-D_121023","parentId":"N1WZ-16451-D","componentId":"121023","qtyPer":9},{"id":"bom_N1WZ-16451-D_121038","parentId":"N1WZ-16451-D","componentId":"121038","qtyPer":1},{"id":"bom_N1WZ-16451-D_121046","parentId":"N1WZ-16451-D","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WZ-16451-D_121057","parentId":"N1WZ-16451-D","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WZ-16451-D_121062","parentId":"N1WZ-16451-D","componentId":"121062","qtyPer":0.002},{"id":"bom_N1WZ-16451-D_121065","parentId":"N1WZ-16451-D","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WZ-16451-D_121067","parentId":"N1WZ-16451-D","componentId":"121067","qtyPer":6},{"id":"bom_N1WZ-16451-D_200220","parentId":"N1WZ-16451-D","componentId":"200220","qtyPer":0.0023},{"id":"bom_N1WZ-16451-D_FCSD-18","parentId":"N1WZ-16451-D","componentId":"FCSD-18","qtyPer":1},{"id":"bom_N1WZ-16451-D_N1WB-16451-B-PIA-A","parentId":"N1WZ-16451-D","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WZ-16451-D_N1WB-16451-B-PIA-B","parentId":"N1WZ-16451-D","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WZ-16451-D_N1WB-16451-B-PIA-C","parentId":"N1WZ-16451-D","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1XB-E29141-AC_121054","parentId":"N1XB-E29141-AC","componentId":"121054","qtyPer":5.5},{"id":"bom_N1XB-E29141-AC_121146","parentId":"N1XB-E29141-AC","componentId":"121146","qtyPer":-3.7},{"id":"bom_N1XB-E29141-AC_N1WB-E291A34-E-PIA-02","parentId":"N1XB-E29141-AC","componentId":"N1WB-E291A34-E-PIA-02","qtyPer":1},{"id":"bom_N1XB-E29141-AC_N1WB-E291A34-E-PIA-03","parentId":"N1XB-E29141-AC","componentId":"N1WB-E291A34-E-PIA-03","qtyPer":11},{"id":"bom_N1XB-E29141-AC_N1XB-E29076-A-PIA-05","parentId":"N1XB-E29141-AC","componentId":"N1XB-E29076-A-PIA-05","qtyPer":1},{"id":"bom_N1XB-E29141-AC_N1XB-E29076-A-PIA-06","parentId":"N1XB-E29141-AC","componentId":"N1XB-E29076-A-PIA-06","qtyPer":1},{"id":"bom_N1XB-E29140-AC_121054","parentId":"N1XB-E29140-AC","componentId":"121054","qtyPer":5.5},{"id":"bom_N1XB-E29140-AC_121146","parentId":"N1XB-E29140-AC","componentId":"121146","qtyPer":-3.7},{"id":"bom_N1XB-E29140-AC_N1WB-E291A34-E-PIA-02","parentId":"N1XB-E29140-AC","componentId":"N1WB-E291A34-E-PIA-02","qtyPer":1},{"id":"bom_N1XB-E29140-AC_N1WB-E291A34-E-PIA-03","parentId":"N1XB-E29140-AC","componentId":"N1WB-E291A34-E-PIA-03","qtyPer":11},{"id":"bom_N1XB-E29140-AC_N1XB-E29076-A-PIA-05","parentId":"N1XB-E29140-AC","componentId":"N1XB-E29076-A-PIA-05","qtyPer":1},{"id":"bom_N1XB-E29140-AC_N1XB-E29076-A-PIA-06","parentId":"N1XB-E29140-AC","componentId":"N1XB-E29076-A-PIA-06","qtyPer":1},{"id":"bom_N1WB-J29141-AH_121054","parentId":"N1WB-J29141-AH","componentId":"121054","qtyPer":5.5},{"id":"bom_N1WB-J29141-AH_121146","parentId":"N1WB-J29141-AH","componentId":"121146","qtyPer":-2.9},{"id":"bom_N1WB-J29141-AH_N1WB-E291A34-E-PIA-02","parentId":"N1WB-J29141-AH","componentId":"N1WB-E291A34-E-PIA-02","qtyPer":2},{"id":"bom_N1WB-J29141-AH_N1WB-E291A34-E-PIA-03","parentId":"N1WB-J29141-AH","componentId":"N1WB-E291A34-E-PIA-03","qtyPer":11},{"id":"bom_N1WB-J29140-AH_121054","parentId":"N1WB-J29140-AH","componentId":"121054","qtyPer":5.5},{"id":"bom_N1WB-J29140-AH_121146","parentId":"N1WB-J29140-AH","componentId":"121146","qtyPer":-2.9},{"id":"bom_N1WB-J29140-AH_N1WB-E291A34-E-PIA-02","parentId":"N1WB-J29140-AH","componentId":"N1WB-E291A34-E-PIA-02","qtyPer":2},{"id":"bom_N1WB-J29140-AH_N1WB-E291A34-E-PIA-03","parentId":"N1WB-J29140-AH","componentId":"N1WB-E291A34-E-PIA-03","qtyPer":11},{"id":"bom_N1XB-16451-BA_121001","parentId":"N1XB-16451-BA","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1XB-16451-BA_121021","parentId":"N1XB-16451-BA","componentId":"121021","qtyPer":0.091},{"id":"bom_N1XB-16451-BA_121022","parentId":"N1XB-16451-BA","componentId":"121022","qtyPer":6},{"id":"bom_N1XB-16451-BA_121023","parentId":"N1XB-16451-BA","componentId":"121023","qtyPer":4},{"id":"bom_N1XB-16451-BA_121046","parentId":"N1XB-16451-BA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1XB-16451-BA_121057","parentId":"N1XB-16451-BA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1XB-16451-BA_121062","parentId":"N1XB-16451-BA","componentId":"121062","qtyPer":0.002},{"id":"bom_N1XB-16451-BA_121065","parentId":"N1XB-16451-BA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1XB-16451-BA_121067","parentId":"N1XB-16451-BA","componentId":"121067","qtyPer":6},{"id":"bom_N1XB-16451-BA_121150","parentId":"N1XB-16451-BA","componentId":"121150","qtyPer":-3.35},{"id":"bom_N1XB-16451-BA_200220","parentId":"N1XB-16451-BA","componentId":"200220","qtyPer":0.0018},{"id":"bom_N1XB-16451-BA_N1WB-16451-B-PIA-A","parentId":"N1XB-16451-BA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1XB-16451-BA_N1WB-16451-B-PIA-B","parentId":"N1XB-16451-BA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1XB-16451-BA_N1WB-16451-B-PIA-C","parentId":"N1XB-16451-BA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1XB-16451-BA_N1XB-16451-B-PIA-02","parentId":"N1XB-16451-BA","componentId":"N1XB-16451-B-PIA-02","qtyPer":1},{"id":"bom_N1XB-16450-BA_121001","parentId":"N1XB-16450-BA","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1XB-16450-BA_121021","parentId":"N1XB-16450-BA","componentId":"121021","qtyPer":0.091},{"id":"bom_N1XB-16450-BA_121022","parentId":"N1XB-16450-BA","componentId":"121022","qtyPer":6},{"id":"bom_N1XB-16450-BA_121023","parentId":"N1XB-16450-BA","componentId":"121023","qtyPer":4},{"id":"bom_N1XB-16450-BA_121046","parentId":"N1XB-16450-BA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1XB-16450-BA_121057","parentId":"N1XB-16450-BA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1XB-16450-BA_121062","parentId":"N1XB-16450-BA","componentId":"121062","qtyPer":0.002},{"id":"bom_N1XB-16450-BA_121065","parentId":"N1XB-16450-BA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1XB-16450-BA_121067","parentId":"N1XB-16450-BA","componentId":"121067","qtyPer":6},{"id":"bom_N1XB-16450-BA_121150","parentId":"N1XB-16450-BA","componentId":"121150","qtyPer":-3.35},{"id":"bom_N1XB-16450-BA_200220","parentId":"N1XB-16450-BA","componentId":"200220","qtyPer":0.0018},{"id":"bom_N1XB-16450-BA_N1WB-16451-B-PIA-A","parentId":"N1XB-16450-BA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1XB-16450-BA_N1WB-16451-B-PIA-B","parentId":"N1XB-16450-BA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1XB-16450-BA_N1WB-16451-B-PIA-C","parentId":"N1XB-16450-BA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1XB-16450-BA_N1XB-16450-B-PIA-02","parentId":"N1XB-16450-BA","componentId":"N1XB-16450-B-PIA-02","qtyPer":1},{"id":"bom_N1XB-16451-BAA_121001","parentId":"N1XB-16451-BAA","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1XB-16451-BAA_121021","parentId":"N1XB-16451-BAA","componentId":"121021","qtyPer":0.0455},{"id":"bom_N1XB-16451-BAA_121022","parentId":"N1XB-16451-BAA","componentId":"121022","qtyPer":6},{"id":"bom_N1XB-16451-BAA_121023","parentId":"N1XB-16451-BAA","componentId":"121023","qtyPer":4},{"id":"bom_N1XB-16451-BAA_121046","parentId":"N1XB-16451-BAA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1XB-16451-BAA_121057","parentId":"N1XB-16451-BAA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1XB-16451-BAA_121062","parentId":"N1XB-16451-BAA","componentId":"121062","qtyPer":0.001},{"id":"bom_N1XB-16451-BAA_121065","parentId":"N1XB-16451-BAA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1XB-16451-BAA_121067","parentId":"N1XB-16451-BAA","componentId":"121067","qtyPer":6},{"id":"bom_N1XB-16451-BAA_200220","parentId":"N1XB-16451-BAA","componentId":"200220","qtyPer":0.0018},{"id":"bom_N1XB-16451-BAA_N1WB-16451-B-PIA-A","parentId":"N1XB-16451-BAA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1XB-16451-BAA_N1WB-16451-B-PIA-B","parentId":"N1XB-16451-BAA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1XB-16451-BAA_N1WB-16451-B-PIA-C","parentId":"N1XB-16451-BAA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1XB-16451-BAA_N1XB-16451-B-PIA-02","parentId":"N1XB-16451-BAA","componentId":"N1XB-16451-B-PIA-02","qtyPer":1},{"id":"bom_N1XB-16450-BAA_121001","parentId":"N1XB-16450-BAA","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1XB-16450-BAA_121021","parentId":"N1XB-16450-BAA","componentId":"121021","qtyPer":0.0455},{"id":"bom_N1XB-16450-BAA_121022","parentId":"N1XB-16450-BAA","componentId":"121022","qtyPer":6},{"id":"bom_N1XB-16450-BAA_121023","parentId":"N1XB-16450-BAA","componentId":"121023","qtyPer":4},{"id":"bom_N1XB-16450-BAA_121046","parentId":"N1XB-16450-BAA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1XB-16450-BAA_121057","parentId":"N1XB-16450-BAA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1XB-16450-BAA_121062","parentId":"N1XB-16450-BAA","componentId":"121062","qtyPer":0.001},{"id":"bom_N1XB-16450-BAA_121065","parentId":"N1XB-16450-BAA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1XB-16450-BAA_121067","parentId":"N1XB-16450-BAA","componentId":"121067","qtyPer":6},{"id":"bom_N1XB-16450-BAA_200220","parentId":"N1XB-16450-BAA","componentId":"200220","qtyPer":0.0018},{"id":"bom_N1XB-16450-BAA_N1WB-16451-B-PIA-A","parentId":"N1XB-16450-BAA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1XB-16450-BAA_N1WB-16451-B-PIA-B","parentId":"N1XB-16450-BAA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1XB-16450-BAA_N1WB-16451-B-PIA-C","parentId":"N1XB-16450-BAA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1XB-16450-BAA_N1XB-16450-B-PIA-02","parentId":"N1XB-16450-BAA","componentId":"N1XB-16450-B-PIA-02","qtyPer":1},{"id":"bom_N1XB-16451-AA_121022","parentId":"N1XB-16451-AA","componentId":"121022","qtyPer":6},{"id":"bom_N1XB-16451-AA_121046","parentId":"N1XB-16451-AA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1XB-16451-AA_121057","parentId":"N1XB-16451-AA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1XB-16451-AA_121065","parentId":"N1XB-16451-AA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1XB-16451-AA_121067","parentId":"N1XB-16451-AA","componentId":"121067","qtyPer":6},{"id":"bom_N1XB-16451-AA_121150","parentId":"N1XB-16451-AA","componentId":"121150","qtyPer":-3.35},{"id":"bom_N1XB-16451-AA_N1WB-16451-B-PIA-A","parentId":"N1XB-16451-AA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1XB-16451-AA_N1WB-16451-B-PIA-B","parentId":"N1XB-16451-AA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1XB-16451-AA_N1WB-16451-B-PIA-C","parentId":"N1XB-16451-AA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1XB-16450-AA_121022","parentId":"N1XB-16450-AA","componentId":"121022","qtyPer":6},{"id":"bom_N1XB-16450-AA_121046","parentId":"N1XB-16450-AA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1XB-16450-AA_121057","parentId":"N1XB-16450-AA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1XB-16450-AA_121065","parentId":"N1XB-16450-AA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1XB-16450-AA_121067","parentId":"N1XB-16450-AA","componentId":"121067","qtyPer":6},{"id":"bom_N1XB-16450-AA_121150","parentId":"N1XB-16450-AA","componentId":"121150","qtyPer":-3.35},{"id":"bom_N1XB-16450-AA_N1WB-16451-B-PIA-A","parentId":"N1XB-16450-AA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1XB-16450-AA_N1WB-16451-B-PIA-B","parentId":"N1XB-16450-AA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1XB-16450-AA_N1WB-16451-B-PIA-C","parentId":"N1XB-16450-AA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1XB-16451-ABA_121022","parentId":"N1XB-16451-ABA","componentId":"121022","qtyPer":6},{"id":"bom_N1XB-16451-ABA_121046","parentId":"N1XB-16451-ABA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1XB-16451-ABA_121057","parentId":"N1XB-16451-ABA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1XB-16451-ABA_121065","parentId":"N1XB-16451-ABA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1XB-16451-ABA_121067","parentId":"N1XB-16451-ABA","componentId":"121067","qtyPer":6},{"id":"bom_N1XB-16451-ABA_N1WB-16451-B-PIA-A","parentId":"N1XB-16451-ABA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1XB-16451-ABA_N1WB-16451-B-PIA-B","parentId":"N1XB-16451-ABA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1XB-16451-ABA_N1WB-16451-B-PIA-C","parentId":"N1XB-16451-ABA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1XB-16450-ABA_121022","parentId":"N1XB-16450-ABA","componentId":"121022","qtyPer":6},{"id":"bom_N1XB-16450-ABA_121046","parentId":"N1XB-16450-ABA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1XB-16450-ABA_121057","parentId":"N1XB-16450-ABA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1XB-16450-ABA_121065","parentId":"N1XB-16450-ABA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1XB-16450-ABA_121067","parentId":"N1XB-16450-ABA","componentId":"121067","qtyPer":6},{"id":"bom_N1XB-16450-ABA_N1WB-16451-B-PIA-A","parentId":"N1XB-16450-ABA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1XB-16450-ABA_N1WB-16451-B-PIA-B","parentId":"N1XB-16450-ABA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1XB-16450-ABA_N1WB-16451-B-PIA-C","parentId":"N1XB-16450-ABA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16451-LB_121001","parentId":"N1WB-16451-LB","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1WB-16451-LB_121021","parentId":"N1WB-16451-LB","componentId":"121021","qtyPer":0.0855},{"id":"bom_N1WB-16451-LB_121022","parentId":"N1WB-16451-LB","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16451-LB_121023","parentId":"N1WB-16451-LB","componentId":"121023","qtyPer":9},{"id":"bom_N1WB-16451-LB_121042","parentId":"N1WB-16451-LB","componentId":"121042","qtyPer":1},{"id":"bom_N1WB-16451-LB_121046","parentId":"N1WB-16451-LB","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WB-16451-LB_121057","parentId":"N1WB-16451-LB","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16451-LB_121062","parentId":"N1WB-16451-LB","componentId":"121062","qtyPer":0.001},{"id":"bom_N1WB-16451-LB_121065","parentId":"N1WB-16451-LB","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WB-16451-LB_121067","parentId":"N1WB-16451-LB","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16451-LB_200220","parentId":"N1WB-16451-LB","componentId":"200220","qtyPer":0.0018},{"id":"bom_N1WB-16451-LB_N1WB-16451-B-PIA-A","parentId":"N1WB-16451-LB","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16451-LB_N1WB-16451-B-PIA-B","parentId":"N1WB-16451-LB","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16451-LB_N1WB-16451-B-PIA-C","parentId":"N1WB-16451-LB","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16450-LB_121001","parentId":"N1WB-16450-LB","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1WB-16450-LB_121021","parentId":"N1WB-16450-LB","componentId":"121021","qtyPer":0.0855},{"id":"bom_N1WB-16450-LB_121022","parentId":"N1WB-16450-LB","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16450-LB_121023","parentId":"N1WB-16450-LB","componentId":"121023","qtyPer":9},{"id":"bom_N1WB-16450-LB_121041","parentId":"N1WB-16450-LB","componentId":"121041","qtyPer":1},{"id":"bom_N1WB-16450-LB_121046","parentId":"N1WB-16450-LB","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WB-16450-LB_121057","parentId":"N1WB-16450-LB","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16450-LB_121062","parentId":"N1WB-16450-LB","componentId":"121062","qtyPer":0.001},{"id":"bom_N1WB-16450-LB_121065","parentId":"N1WB-16450-LB","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WB-16450-LB_121067","parentId":"N1WB-16450-LB","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16450-LB_200220","parentId":"N1WB-16450-LB","componentId":"200220","qtyPer":0.0018},{"id":"bom_N1WB-16450-LB_N1WB-16451-B-PIA-A","parentId":"N1WB-16450-LB","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16450-LB_N1WB-16451-B-PIA-B","parentId":"N1WB-16450-LB","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16450-LB_N1WB-16451-B-PIA-C","parentId":"N1WB-16450-LB","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16451-LAA_121001","parentId":"N1WB-16451-LAA","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1WB-16451-LAA_121021","parentId":"N1WB-16451-LAA","componentId":"121021","qtyPer":0.0855},{"id":"bom_N1WB-16451-LAA_121022","parentId":"N1WB-16451-LAA","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16451-LAA_121023","parentId":"N1WB-16451-LAA","componentId":"121023","qtyPer":9},{"id":"bom_N1WB-16451-LAA_121042","parentId":"N1WB-16451-LAA","componentId":"121042","qtyPer":1},{"id":"bom_N1WB-16451-LAA_121046","parentId":"N1WB-16451-LAA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WB-16451-LAA_121057","parentId":"N1WB-16451-LAA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16451-LAA_121062","parentId":"N1WB-16451-LAA","componentId":"121062","qtyPer":0.001},{"id":"bom_N1WB-16451-LAA_121065","parentId":"N1WB-16451-LAA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WB-16451-LAA_121067","parentId":"N1WB-16451-LAA","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16451-LAA_200220","parentId":"N1WB-16451-LAA","componentId":"200220","qtyPer":0.0018},{"id":"bom_N1WB-16451-LAA_N1WB-16451-B-PIA-A","parentId":"N1WB-16451-LAA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16451-LAA_N1WB-16451-B-PIA-B","parentId":"N1WB-16451-LAA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16451-LAA_N1WB-16451-B-PIA-C","parentId":"N1WB-16451-LAA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16450-LAA_121001","parentId":"N1WB-16450-LAA","componentId":"121001","qtyPer":0.01175},{"id":"bom_N1WB-16450-LAA_121021","parentId":"N1WB-16450-LAA","componentId":"121021","qtyPer":0.0855},{"id":"bom_N1WB-16450-LAA_121022","parentId":"N1WB-16450-LAA","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16450-LAA_121023","parentId":"N1WB-16450-LAA","componentId":"121023","qtyPer":9},{"id":"bom_N1WB-16450-LAA_121041","parentId":"N1WB-16450-LAA","componentId":"121041","qtyPer":1},{"id":"bom_N1WB-16450-LAA_121046","parentId":"N1WB-16450-LAA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WB-16450-LAA_121057","parentId":"N1WB-16450-LAA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16450-LAA_121062","parentId":"N1WB-16450-LAA","componentId":"121062","qtyPer":0.001},{"id":"bom_N1WB-16450-LAA_121065","parentId":"N1WB-16450-LAA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WB-16450-LAA_121067","parentId":"N1WB-16450-LAA","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16450-LAA_200220","parentId":"N1WB-16450-LAA","componentId":"200220","qtyPer":0.0018},{"id":"bom_N1WB-16450-LAA_N1WB-16451-B-PIA-A","parentId":"N1WB-16450-LAA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16450-LAA_N1WB-16451-B-PIA-B","parentId":"N1WB-16450-LAA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16450-LAA_N1WB-16451-B-PIA-C","parentId":"N1WB-16450-LAA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16451-CA_121022","parentId":"N1WB-16451-CA","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16451-CA_121046","parentId":"N1WB-16451-CA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WB-16451-CA_121057","parentId":"N1WB-16451-CA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16451-CA_121065","parentId":"N1WB-16451-CA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WB-16451-CA_121067","parentId":"N1WB-16451-CA","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16451-CA_121150","parentId":"N1WB-16451-CA","componentId":"121150","qtyPer":-3.85},{"id":"bom_N1WB-16451-CA_N1WB-16451-B-PIA-A","parentId":"N1WB-16451-CA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16451-CA_N1WB-16451-B-PIA-B","parentId":"N1WB-16451-CA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16451-CA_N1WB-16451-B-PIA-C","parentId":"N1WB-16451-CA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16450-CA_121022","parentId":"N1WB-16450-CA","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16450-CA_121046","parentId":"N1WB-16450-CA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WB-16450-CA_121057","parentId":"N1WB-16450-CA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16450-CA_121065","parentId":"N1WB-16450-CA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WB-16450-CA_121067","parentId":"N1WB-16450-CA","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16450-CA_121150","parentId":"N1WB-16450-CA","componentId":"121150","qtyPer":-3.85},{"id":"bom_N1WB-16450-CA_N1WB-16451-B-PIA-A","parentId":"N1WB-16450-CA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16450-CA_N1WB-16451-B-PIA-B","parentId":"N1WB-16450-CA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16450-CA_N1WB-16451-B-PIA-C","parentId":"N1WB-16450-CA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16451-CAA_121022","parentId":"N1WB-16451-CAA","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16451-CAA_121046","parentId":"N1WB-16451-CAA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WB-16451-CAA_121057","parentId":"N1WB-16451-CAA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16451-CAA_121065","parentId":"N1WB-16451-CAA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WB-16451-CAA_121067","parentId":"N1WB-16451-CAA","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16451-CAA_N1WB-16451-B-PIA-A","parentId":"N1WB-16451-CAA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16451-CAA_N1WB-16451-B-PIA-B","parentId":"N1WB-16451-CAA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16451-CAA_N1WB-16451-B-PIA-C","parentId":"N1WB-16451-CAA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16450-CAA_121022","parentId":"N1WB-16450-CAA","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16450-CAA_121046","parentId":"N1WB-16450-CAA","componentId":"121046","qtyPer":6.3},{"id":"bom_N1WB-16450-CAA_121057","parentId":"N1WB-16450-CAA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16450-CAA_121065","parentId":"N1WB-16450-CAA","componentId":"121065","qtyPer":2.7},{"id":"bom_N1WB-16450-CAA_121067","parentId":"N1WB-16450-CAA","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16450-CAA_N1WB-16451-B-PIA-A","parentId":"N1WB-16450-CAA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16450-CAA_N1WB-16451-B-PIA-B","parentId":"N1WB-16450-CAA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16450-CAA_N1WB-16451-B-PIA-C","parentId":"N1WB-16450-CAA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16451-BB_121022","parentId":"N1WB-16451-BB","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16451-BB_121046","parentId":"N1WB-16451-BB","componentId":"121046","qtyPer":6.65},{"id":"bom_N1WB-16451-BB_121057","parentId":"N1WB-16451-BB","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16451-BB_121065","parentId":"N1WB-16451-BB","componentId":"121065","qtyPer":2.85},{"id":"bom_N1WB-16451-BB_121067","parentId":"N1WB-16451-BB","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16451-BB_121150","parentId":"N1WB-16451-BB","componentId":"121150","qtyPer":-4},{"id":"bom_N1WB-16451-BB_N1WB-16451-B-PIA-A","parentId":"N1WB-16451-BB","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16451-BB_N1WB-16451-B-PIA-B","parentId":"N1WB-16451-BB","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16451-BB_N1WB-16451-B-PIA-C","parentId":"N1WB-16451-BB","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16450-BB_121022","parentId":"N1WB-16450-BB","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16450-BB_121046","parentId":"N1WB-16450-BB","componentId":"121046","qtyPer":6.65},{"id":"bom_N1WB-16450-BB_121057","parentId":"N1WB-16450-BB","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16450-BB_121065","parentId":"N1WB-16450-BB","componentId":"121065","qtyPer":2.85},{"id":"bom_N1WB-16450-BB_121067","parentId":"N1WB-16450-BB","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16450-BB_121150","parentId":"N1WB-16450-BB","componentId":"121150","qtyPer":-4},{"id":"bom_N1WB-16450-BB_N1WB-16451-B-PIA-A","parentId":"N1WB-16450-BB","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16450-BB_N1WB-16451-B-PIA-B","parentId":"N1WB-16450-BB","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16450-BB_N1WB-16451-B-PIA-C","parentId":"N1WB-16450-BB","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16451-BAA_121022","parentId":"N1WB-16451-BAA","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16451-BAA_121046","parentId":"N1WB-16451-BAA","componentId":"121046","qtyPer":6.65},{"id":"bom_N1WB-16451-BAA_121057","parentId":"N1WB-16451-BAA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16451-BAA_121065","parentId":"N1WB-16451-BAA","componentId":"121065","qtyPer":2.85},{"id":"bom_N1WB-16451-BAA_121067","parentId":"N1WB-16451-BAA","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16451-BAA_N1WB-16451-B-PIA-A","parentId":"N1WB-16451-BAA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16451-BAA_N1WB-16451-B-PIA-B","parentId":"N1WB-16451-BAA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16451-BAA_N1WB-16451-B-PIA-C","parentId":"N1WB-16451-BAA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1},{"id":"bom_N1WB-16450-BAA_121022","parentId":"N1WB-16450-BAA","componentId":"121022","qtyPer":6},{"id":"bom_N1WB-16450-BAA_121046","parentId":"N1WB-16450-BAA","componentId":"121046","qtyPer":6.65},{"id":"bom_N1WB-16450-BAA_121057","parentId":"N1WB-16450-BAA","componentId":"121057","qtyPer":0.002},{"id":"bom_N1WB-16450-BAA_121065","parentId":"N1WB-16450-BAA","componentId":"121065","qtyPer":2.85},{"id":"bom_N1WB-16450-BAA_121067","parentId":"N1WB-16450-BAA","componentId":"121067","qtyPer":6},{"id":"bom_N1WB-16450-BAA_N1WB-16451-B-PIA-A","parentId":"N1WB-16450-BAA","componentId":"N1WB-16451-B-PIA-A","qtyPer":1},{"id":"bom_N1WB-16450-BAA_N1WB-16451-B-PIA-B","parentId":"N1WB-16450-BAA","componentId":"N1WB-16451-B-PIA-B","qtyPer":1},{"id":"bom_N1WB-16450-BAA_N1WB-16451-B-PIA-C","parentId":"N1WB-16450-BAA","componentId":"N1WB-16451-B-PIA-C","qtyPer":1}],"demands":[{"id":"dem_0","itemId":"N1WB-16450-BB","qty":80,"dueDate":"2026-08-03","source":"Build Plan"},{"id":"dem_1","itemId":"N1WB-16450-BB","qty":177,"dueDate":"2026-08-04","source":"Build Plan"},{"id":"dem_2","itemId":"N1WB-16451-BB","qty":80,"dueDate":"2026-08-03","source":"Build Plan"},{"id":"dem_3","itemId":"N1WB-16451-BB","qty":177,"dueDate":"2026-08-04","source":"Build Plan"},{"id":"dem_4","itemId":"N1WB-16450-CAA","qty":18,"dueDate":"2026-07-29","source":"Build Plan"},{"id":"dem_5","itemId":"N1WB-16450-CAA","qty":18,"dueDate":"2026-08-03","source":"Build Plan"},{"id":"dem_6","itemId":"N1WB-16450-CAA","qty":36,"dueDate":"2026-08-11","source":"Build Plan"},{"id":"dem_7","itemId":"N1WB-16450-CAA","qty":240,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_8","itemId":"N1WB-16450-CAA","qty":232,"dueDate":"2026-08-13","source":"Build Plan"},{"id":"dem_9","itemId":"N1WB-16451-CAA","qty":18,"dueDate":"2026-07-29","source":"Build Plan"},{"id":"dem_10","itemId":"N1WB-16451-CAA","qty":18,"dueDate":"2026-08-03","source":"Build Plan"},{"id":"dem_11","itemId":"N1WB-16451-CAA","qty":36,"dueDate":"2026-08-11","source":"Build Plan"},{"id":"dem_12","itemId":"N1WB-16451-CAA","qty":240,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_13","itemId":"N1WB-16451-CAA","qty":232,"dueDate":"2026-08-13","source":"Build Plan"},{"id":"dem_14","itemId":"N1WB-16450-CA","qty":160,"dueDate":"2026-07-27","source":"Build Plan"},{"id":"dem_15","itemId":"N1WB-16450-CA","qty":480,"dueDate":"2026-07-28","source":"Build Plan"},{"id":"dem_16","itemId":"N1WB-16450-CA","qty":462,"dueDate":"2026-07-29","source":"Build Plan"},{"id":"dem_17","itemId":"N1WB-16450-CA","qty":400,"dueDate":"2026-07-30","source":"Build Plan"},{"id":"dem_18","itemId":"N1WB-16450-CA","qty":142,"dueDate":"2026-08-03","source":"Build Plan"},{"id":"dem_19","itemId":"N1WB-16450-CA","qty":475,"dueDate":"2026-08-04","source":"Build Plan"},{"id":"dem_20","itemId":"N1WB-16450-CA","qty":400,"dueDate":"2026-08-05","source":"Build Plan"},{"id":"dem_21","itemId":"N1WB-16450-CA","qty":400,"dueDate":"2026-08-06","source":"Build Plan"},{"id":"dem_22","itemId":"N1WB-16450-CA","qty":480,"dueDate":"2026-08-07","source":"Build Plan"},{"id":"dem_23","itemId":"N1WB-16450-CA","qty":44,"dueDate":"2026-08-11","source":"Build Plan"},{"id":"dem_24","itemId":"N1WB-16451-CA","qty":160,"dueDate":"2026-07-27","source":"Build Plan"},{"id":"dem_25","itemId":"N1WB-16451-CA","qty":480,"dueDate":"2026-07-28","source":"Build Plan"},{"id":"dem_26","itemId":"N1WB-16451-CA","qty":462,"dueDate":"2026-07-29","source":"Build Plan"},{"id":"dem_27","itemId":"N1WB-16451-CA","qty":400,"dueDate":"2026-07-30","source":"Build Plan"},{"id":"dem_28","itemId":"N1WB-16451-CA","qty":142,"dueDate":"2026-08-03","source":"Build Plan"},{"id":"dem_29","itemId":"N1WB-16451-CA","qty":475,"dueDate":"2026-08-04","source":"Build Plan"},{"id":"dem_30","itemId":"N1WB-16451-CA","qty":400,"dueDate":"2026-08-05","source":"Build Plan"},{"id":"dem_31","itemId":"N1WB-16451-CA","qty":400,"dueDate":"2026-08-06","source":"Build Plan"},{"id":"dem_32","itemId":"N1WB-16451-CA","qty":480,"dueDate":"2026-08-07","source":"Build Plan"},{"id":"dem_33","itemId":"N1WB-16451-CA","qty":44,"dueDate":"2026-08-11","source":"Build Plan"},{"id":"dem_34","itemId":"N1WB-16450-LAA","qty":2,"dueDate":"2026-07-29","source":"Build Plan"},{"id":"dem_35","itemId":"N1WB-16450-LAA","qty":58,"dueDate":"2026-08-05","source":"Build Plan"},{"id":"dem_36","itemId":"N1WB-16450-LAA","qty":96,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_37","itemId":"N1WB-16451-LAA","qty":2,"dueDate":"2026-07-29","source":"Build Plan"},{"id":"dem_38","itemId":"N1WB-16451-LAA","qty":58,"dueDate":"2026-08-05","source":"Build Plan"},{"id":"dem_39","itemId":"N1WB-16451-LAA","qty":96,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_40","itemId":"N1WB-16450-LB","qty":214,"dueDate":"2026-07-29","source":"Build Plan"},{"id":"dem_41","itemId":"N1WB-16450-LB","qty":124,"dueDate":"2026-07-30","source":"Build Plan"},{"id":"dem_42","itemId":"N1WB-16450-LB","qty":148,"dueDate":"2026-08-05","source":"Build Plan"},{"id":"dem_43","itemId":"N1WB-16450-LB","qty":18,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_44","itemId":"N1WB-16451-LB","qty":214,"dueDate":"2026-07-29","source":"Build Plan"},{"id":"dem_45","itemId":"N1WB-16451-LB","qty":124,"dueDate":"2026-07-30","source":"Build Plan"},{"id":"dem_46","itemId":"N1WB-16451-LB","qty":148,"dueDate":"2026-08-05","source":"Build Plan"},{"id":"dem_47","itemId":"N1WB-16451-LB","qty":18,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_48","itemId":"N1XB-16450-ABA","qty":72,"dueDate":"2026-08-11","source":"Build Plan"},{"id":"dem_49","itemId":"N1XB-16450-ABA","qty":144,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_50","itemId":"N1XB-16451-ABA","qty":72,"dueDate":"2026-08-11","source":"Build Plan"},{"id":"dem_51","itemId":"N1XB-16451-ABA","qty":144,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_52","itemId":"N1XB-16450-AA","qty":166,"dueDate":"2026-07-30","source":"Build Plan"},{"id":"dem_53","itemId":"N1XB-16450-AA","qty":144,"dueDate":"2026-07-31","source":"Build Plan"},{"id":"dem_54","itemId":"N1XB-16451-AA","qty":166,"dueDate":"2026-07-30","source":"Build Plan"},{"id":"dem_55","itemId":"N1XB-16451-AA","qty":144,"dueDate":"2026-07-31","source":"Build Plan"},{"id":"dem_56","itemId":"N1XB-16450-BAA","qty":142,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_57","itemId":"N1XB-16450-BAA","qty":216,"dueDate":"2026-08-13","source":"Build Plan"},{"id":"dem_58","itemId":"N1XB-16451-BAA","qty":142,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_59","itemId":"N1XB-16451-BAA","qty":216,"dueDate":"2026-08-13","source":"Build Plan"},{"id":"dem_60","itemId":"N1XB-16450-BA","qty":72,"dueDate":"2026-07-28","source":"Build Plan"},{"id":"dem_61","itemId":"N1XB-16450-BA","qty":216,"dueDate":"2026-07-29","source":"Build Plan"},{"id":"dem_62","itemId":"N1XB-16450-BA","qty":30,"dueDate":"2026-07-30","source":"Build Plan"},{"id":"dem_63","itemId":"N1XB-16451-BA","qty":72,"dueDate":"2026-07-28","source":"Build Plan"},{"id":"dem_64","itemId":"N1XB-16451-BA","qty":216,"dueDate":"2026-07-29","source":"Build Plan"},{"id":"dem_65","itemId":"N1XB-16451-BA","qty":30,"dueDate":"2026-07-30","source":"Build Plan"},{"id":"dem_66","itemId":"N1WB-J29140-AH","qty":72,"dueDate":"2026-08-11","source":"Build Plan"},{"id":"dem_67","itemId":"N1WB-J29140-AH","qty":216,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_68","itemId":"N1WB-J29140-AH","qty":144,"dueDate":"2026-08-13","source":"Build Plan"},{"id":"dem_69","itemId":"N1WB-J29141-AH","qty":72,"dueDate":"2026-08-11","source":"Build Plan"},{"id":"dem_70","itemId":"N1WB-J29141-AH","qty":216,"dueDate":"2026-08-12","source":"Build Plan"},{"id":"dem_71","itemId":"N1WB-J29141-AH","qty":144,"dueDate":"2026-08-13","source":"Build Plan"},{"id":"dem_72","itemId":"N1WZ-16451-D","qty":40,"dueDate":"2026-07-31","source":"Build Plan"},{"id":"dem_73","itemId":"EB3Z-16450-MK","qty":85,"dueDate":"2026-07-31","source":"Build Plan"},{"id":"dem_74","itemId":"N1WZ-16450-R","qty":40,"dueDate":"2026-07-31","source":"Build Plan"},{"id":"dem_75","itemId":"N1WZ-16451-Q","qty":40,"dueDate":"2026-07-31","source":"Build Plan"},{"id":"dem_76","itemId":"N1WZ-16450-S","qty":40,"dueDate":"2026-07-31","source":"Build Plan"},{"id":"dem_77","itemId":"N1WZ-16451-S","qty":40,"dueDate":"2026-07-31","source":"Build Plan"},{"id":"dem_78","itemId":"N1WZ-16451-F","qty":43,"dueDate":"2026-08-04","source":"Build Plan"},{"id":"dem_79","itemId":"N1WZ-16451-B","qty":5,"dueDate":"2026-08-04","source":"Build Plan"},{"id":"dem_80","itemId":"N1WZ-16451-B","qty":8,"dueDate":"2026-08-13","source":"Build Plan"}],"openOrders":[{"id":"oo_0","itemId":"121001","qty":10000,"dueDate":"2027-01-10","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_1","itemId":"121021","qty":492,"dueDate":"2026-10-12","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_2","itemId":"121022","qty":493600,"dueDate":"2026-10-12","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_3","itemId":"121023","qty":16000,"dueDate":"2026-08-16","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_4","itemId":"121041","qty":3380,"dueDate":"2027-03-14","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_5","itemId":"121042","qty":3520,"dueDate":"2026-10-12","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_6","itemId":"121046","qty":422400,"dueDate":"2026-09-27","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_7","itemId":"121050","qty":6685,"dueDate":"2026-08-20","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_8","itemId":"121051","qty":18917,"dueDate":"2026-08-20","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_9","itemId":"121054","qty":158400,"dueDate":"2026-10-20","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_10","itemId":"121057","qty":700,"dueDate":"2026-08-20","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_11","itemId":"121067","qty":500000,"dueDate":"2026-09-27","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_12","itemId":"200220","qty":27,"dueDate":"2026-08-16","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_13","itemId":"FCSD-18","qty":300,"dueDate":"2026-08-20","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_14","itemId":"N1WB-E291A34-E-PIA-03","qty":15000,"dueDate":"2026-09-27","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_15","itemId":"N1XB-16450-B-PIA-02","qty":180,"dueDate":"2026-08-27","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_16","itemId":"N1XB-16451-B-PIA-02","qty":180,"dueDate":"2026-08-27","type":"PO","reference":"Open PO (Syspro)"},{"id":"oo_17","itemId":"N1XB-E29076-A-PIA-05","qty":1200,"dueDate":"2026-08-27","type":"PO","reference":"Open PO (Syspro)"}]};

function loadBlowMoldingData() {
  return {
    items: BM_DATA.items.map((i) => ({ ...i })),
    boms: BM_DATA.boms.map((b) => ({ ...b })),
    demands: BM_DATA.demands.map((d) => ({ ...d })),
    openOrders: BM_DATA.openOrders.map((o) => ({ ...o })),
  };
}

/* ---------------------------------------------------------------------- */
/*  Seed data (generic demo)                                              */
/* ---------------------------------------------------------------------- */
function seedData() {
  const iWidget = uid(), iBracket = uid(), iBoltKit = uid(), iSteel = uid(), iMotor = uid();
  const items = [
    { id: iWidget, code: "FG-1000", description: "Widget A (finished good)", type: "Make", leadTimeDays: 3, safetyStock: 5, lotSize: 10, onHand: 8, uom: "EA" },
    { id: iBracket, code: "SF-2001", description: "Mounting Bracket", type: "Make", leadTimeDays: 5, safetyStock: 10, lotSize: 25, onHand: 12, uom: "EA" },
    { id: iBoltKit, code: "RM-3050", description: "Bolt Kit M6", type: "Buy", leadTimeDays: 7, safetyStock: 20, lotSize: 100, onHand: 40, uom: "EA" },
    { id: iSteel, code: "RM-3010", description: "Steel Sheet 2mm", type: "Buy", leadTimeDays: 14, safetyStock: 15, lotSize: 50, onHand: 20, uom: "EA" },
    { id: iMotor, code: "RM-3090", description: "DC Motor 12V", type: "Buy", leadTimeDays: 21, safetyStock: 4, lotSize: 20, onHand: 6, uom: "EA" },
  ];
  const boms = [
    { id: uid(), parentId: iWidget, componentId: iBracket, qtyPer: 2 },
    { id: uid(), parentId: iWidget, componentId: iBoltKit, qtyPer: 1 },
    { id: uid(), parentId: iWidget, componentId: iMotor, qtyPer: 1 },
    { id: uid(), parentId: iBracket, componentId: iSteel, qtyPer: 1 },
  ];
  const demands = [
    { id: uid(), itemId: iWidget, qty: 20, dueDate: addDays(new Date(), 6).toISOString().slice(0, 10), source: "SO-10231" },
    { id: uid(), itemId: iWidget, qty: 15, dueDate: addDays(new Date(), 18).toISOString().slice(0, 10), source: "SO-10245" },
    { id: uid(), itemId: iWidget, qty: 25, dueDate: addDays(new Date(), 34).toISOString().slice(0, 10), source: "Forecast Wk6" },
  ];
  const openOrders = [
    { id: uid(), itemId: iSteel, qty: 50, dueDate: addDays(new Date(), 4).toISOString().slice(0, 10), type: "PO", reference: "PO-5510" },
    { id: uid(), itemId: iMotor, qty: 20, dueDate: addDays(new Date(), 10).toISOString().slice(0, 10), type: "PO", reference: "PO-5518" },
  ];
  return { items, boms, demands, openOrders };
}

const MACHINE_PART_OPTIONS = {
  BM01: [
    "N1WB-16450-BAA",
    "N1WB-16451-BAA",
    "N1WB-16450-BB",
    "N1WB-16451-BB",
  ],
  BM02: [
    "N1WB-16450-CAA",
    "N1WB-16451-CAA",
    "N1WB-16450-CA",
    "N1WB-16451-CA",
  ],
  BM03: [
    "N1WB-16450-LAA",
    "N1WB-16451-LAA",
    "N1WB-16450-LB",
    "N1WB-16451-LB",
  ],
  BM04: [
    "N1XB-16450-ABA",
    "N1XB-16451-ABA",
    "N1XB-16450-AA",
    "N1XB-16451-AA",
  ],
  BM05: [
    "N1XB-16450-BAA",
    "N1XB-16451-BAA",
    "N1XB-16450-BA",
    "N1XB-16451-BA",
  ],
};

const PART_NUMBER_OPTIONS = Object.values(MACHINE_PART_OPTIONS).flat();

function buildPlanningWeek(startDate = new Date()) {
  const start = getMonday(startDate);
  const days = Array.from({ length: 7 }, (_, idx) => addDays(start, idx));
  const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const machineCycle = ["BM01", "BM02", "BM03", "BM04", "BM05", "BM01", "BM02"];

  return {
    weekStart: start.toISOString().slice(0, 10),
    entries: days.map((date, index) => ({
      id: uid(),
      day: date.toISOString().slice(0, 10),
      weekday: weekdayNames[index],
      shift: "SHIFT 01",
      machine: machineCycle[index] || "BM01",
      partNumber: "",
      target: index < 2 ? "Output target" : "",
      status: "Planned",
    })),
  };
}

function buildDefaultPlanningWeek() {
  return buildPlanningWeek(new Date());
}

/* ---------------------------------------------------------------------- */
/*  Small building blocks                                                 */
/* ---------------------------------------------------------------------- */
function Field({ label, children, w }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: w }}>
      <label style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</label>
      {children}
    </div>
  );
}

function Badge({ children, tone }) {
  const tones = {
    ok: { bg: T.greenTint, fg: T.green },
    warn: { bg: T.brickTint, fg: T.brick },
    neutral: { bg: T.line, fg: T.muted },
  };
  const c = tones[tone] || tones.neutral;
  return (
    <span style={{ background: c.bg, color: c.fg, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 3, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/*  Main App                                                              */
/* ---------------------------------------------------------------------- */
export default function MRPPlanner() {
  const [tab, setTab] = useState("dashboard");
  const [items, setItems] = useState([]);
  const [boms, setBoms] = useState([]);
  const [demands, setDemands] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [planning, setPlanning] = useState(buildDefaultPlanningWeek());
  const [horizon, setHorizon] = useState(10);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved
  const [ledgerItemId, setLedgerItemId] = useState(null);
  const saveTimer = useRef(null);

  // load
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("mrp-data", false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setItems(parsed.items || []);
          setBoms(parsed.boms || []);
          setDemands(parsed.demands || []);
          setOpenOrders(parsed.openOrders || []);
          setPlanning(parsed.planning || buildDefaultPlanningWeek());
          setHorizon(parsed.horizon || 10);
        } else {
          const seed = loadBlowMoldingData();
          setItems(seed.items);
          setBoms(seed.boms);
          setDemands(seed.demands);
          setOpenOrders(seed.openOrders);
          setPlanning(buildDefaultPlanningWeek());
        }
      } catch (e) {
        const seed = seedData();
        setItems(seed.items);
        setBoms(seed.boms);
        setDemands(seed.demands);
        setOpenOrders(seed.openOrders);
      }
      setLoaded(true);
    })();
  }, []);

  // save (debounced)
  useEffect(() => {
    if (!loaded) return;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await window.storage.set(
          "mrp-data",
          JSON.stringify({ items, boms, demands, openOrders, planning, horizon }),
          false
        );
        setSaveState("saved");
      } catch (e) {
        setSaveState("idle");
      }
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [items, boms, demands, openOrders, planning, horizon, loaded]);

  const monday = useMemo(() => getMonday(new Date()), []);
  const weeks = useMemo(
    () => Array.from({ length: horizon }, (_, i) => addDays(monday, i * 7)),
    [horizon, monday]
  );
  const mrp = useMemo(
    () => runMRP(items, boms, demands, openOrders, horizon, monday),
    [items, boms, demands, openOrders, horizon, monday]
  );

  const itemById = useCallback((id) => items.find((i) => i.id === id), [items]);

  useEffect(() => {
    if (!ledgerItemId && items.length) setLedgerItemId(items[0].id);
  }, [items, ledgerItemId]);

  const exceptions = useMemo(() => {
    return items
      .map((it) => ({ item: it, r: mrp[it.id] }))
      .filter((x) => x.r && (x.r.pastDueRelease > 0 || x.r.pastDueDemand > 0));
  }, [items, mrp]);

  function resetDemo() {
    const seed = seedData();
    setItems(seed.items);
    setBoms(seed.boms);
    setDemands(seed.demands);
    setOpenOrders(seed.openOrders);
  }

  function resetBlowMolding() {
    const seed = loadBlowMoldingData();
    setItems(seed.items);
    setBoms(seed.boms);
    setDemands(seed.demands);
    setOpenOrders(seed.openOrders);
  }

  if (!loaded) {
    return (
      <div className="plex-sans" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: T.muted }}>
        <Loader2 size={18} style={{ marginRight: 8, animation: "spin 1s linear infinite" }} />
        Loading planning data…
      </div>
    );
  }

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "planning", label: "Planning", icon: CalendarRange },
    { id: "items", label: "Items", icon: Package },
    { id: "bom", label: "Bill of Materials", icon: ListTree },
    { id: "demand", label: "Demand", icon: CalendarClock },
    { id: "orders", label: "Open Orders", icon: Boxes },
    { id: "ledger", label: "Planning Ledger", icon: PlayCircle },
  ];

  return (
    <div className="plex-sans" style={{ background: T.paper, color: T.text, borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
      {FONTS}
      <div style={{ display: "flex", minHeight: 560 }}>
        {/* Sidebar */}
        <div style={{ width: 200, background: T.ink, color: T.sidebarText, padding: "18px 12px", flexShrink: 0 }}>
          <div style={{ padding: "0 8px 18px 8px" }}>
            <div style={{
              width: 120,
              height: 38,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              background: "linear-gradient(135deg, #ffffff 0%, #e9e3d7 100%)",
              boxShadow: "inset 0 0 0 1px rgba(27,36,48,0.08)",
              marginBottom: 12,
            }}>
              <div style={{
                fontSize: 26,
                fontWeight: 800,
                letterSpacing: "-0.08em",
                lineHeight: 1,
                color: T.ink,
                fontFamily: "'IBM Plex Sans', sans-serif",
              }}>
                ATD
              </div>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", letterSpacing: ".01em" }}>Planning Desk</div>
            <div style={{ fontSize: 11, color: T.sidebarTextDim, marginTop: 2 }}>Blow Molding — materials requirements</div>
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {navItems.map((n) => {
              const Icon = n.icon;
              const active = tab === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setTab(n.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "8px 10px",
                    borderRadius: 4,
                    border: "none",
                    cursor: "pointer",
                    background: active ? "rgba(181,100,31,0.22)" : "transparent",
                    color: active ? "#fff" : T.sidebarText,
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    textAlign: "left",
                  }}
                >
                  <Icon size={15} style={{ color: active ? T.copper : T.sidebarTextDim, flexShrink: 0 }} />
                  {n.label}
                  {n.id === "dashboard" && exceptions.length > 0 && (
                    <span style={{ marginLeft: "auto", background: T.brick, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8 }}>
                      {exceptions.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div style={{ marginTop: 24, padding: "0 8px" }}>
            <div style={{ fontSize: 11, color: T.sidebarTextDim, marginBottom: 6 }}>PLANNING HORIZON</div>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              style={{ width: "100%", background: T.inkSoft, color: "#fff", border: `1px solid #3A4557`, borderRadius: 3, padding: "5px 6px", fontSize: 12 }}
            >
              <option value={6}>6 weeks</option>
              <option value={10}>10 weeks</option>
              <option value={14}>14 weeks</option>
              <option value={20}>20 weeks</option>
            </select>
          </div>

          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8, padding: "0 8px" }}>
            <button
              onClick={resetBlowMolding}
              className="plex-sans"
              style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: T.sidebarText, fontSize: 11, cursor: "pointer", padding: 0, textAlign: "left" }}
            >
              <RotateCcw size={12} /> Reload Blow Molding data
            </button>
            <button
              onClick={resetDemo}
              className="plex-sans"
              style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: T.sidebarTextDim, fontSize: 11, cursor: "pointer", padding: 0, textAlign: "left" }}
            >
              <RotateCcw size={12} /> Load generic demo instead
            </button>
          </div>

          <div style={{ marginTop: 16, padding: "0 8px", fontSize: 11, color: T.sidebarTextDim, display: "flex", alignItems: "center", gap: 5 }}>
            {saveState === "saving" ? (
              <>
                <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Saving…
              </>
            ) : (
              <>
                <CheckCircle2 size={11} /> Saved
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: "22px 26px", overflowX: "auto" }}>
          {tab === "dashboard" && (
            <Dashboard
              items={items}
              mrp={mrp}
              exceptions={exceptions}
              demands={demands}
              openOrders={openOrders}
              boms={boms}
              saveState={saveState}
              onGoLedger={(id) => { setLedgerItemId(id); setTab("ledger"); }}
            />
          )}
          {tab === "planning" && <PlanningTab planning={planning} setPlanning={setPlanning} />}
          {tab === "items" && <ItemsTab items={items} setItems={setItems} />}
          {tab === "bom" && <BomTab items={items} boms={boms} setBoms={setBoms} />}
          {tab === "demand" && <DemandTab items={items} demands={demands} setDemands={setDemands} />}
          {tab === "orders" && <OrdersTab items={items} openOrders={openOrders} setOpenOrders={setOpenOrders} />}
          {tab === "ledger" && (
            <LedgerTab
              items={items}
              boms={boms}
              mrp={mrp}
              weeks={weeks}
              ledgerItemId={ledgerItemId}
              setLedgerItemId={setLedgerItemId}
            />
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Dashboard                                                             */
/* ---------------------------------------------------------------------- */
function Dashboard({ items, mrp, exceptions, demands, openOrders, boms, onGoLedger, saveState }) {
  const startDate = new Date();
  const endDate = addDays(new Date(), 3);
  const [page, setPage] = React.useState(0);
  const pageSize = 10;

  const rows = items.map((item) => {
    const r = mrp[item.id] || {};
    const grossReq = (r.GR || []).reduce((sum, value) => sum + Number(value || 0), 0);
    const plannedOrderReceipt = (r.PORcpt || []).reduce((sum, value) => sum + Number(value || 0), 0);
    const openPOQty = openOrders
      .filter((o) => o.itemId === item.id)
      .reduce((sum, o) => sum + Number(o.qty || 0), 0);

    const packSize = Number(item.lotSize) > 0 ? Number(item.lotSize) : 1;
    const currentStock = Number(item.onHand) || 0;
    const shortage = Math.max(0, grossReq - (currentStock + plannedOrderReceipt + openPOQty));
    const transferQty = Math.max(0, plannedOrderReceipt);
    const requestQty = Math.max(0, grossReq - currentStock);
    const variance = shortage > 0 ? shortage : 0;
    const status = variance > 0 ? "Under Transferred" : "Enough Stock";
    const tone = variance > 0 ? "warn" : "ok";

    return {
      id: item.id,
      code: item.code,
      description: item.description,
      packSize,
      sohWip: 0,
      sohRaw: currentStock,
      sohReg: 0,
      totalSoh: currentStock,
      bawOrder: openPOQty,
      grossReq,
      requestQty,
      transfer: transferQty,
      unitCost: 0,
      status,
      tone,
      variance,
    };
  });

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);

  React.useEffect(() => {
    if (page >= totalPages) setPage(totalPages - 1);
  }, [page, totalPages]);

  return (
    <div style={{ background: T.paper, border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ background: "linear-gradient(180deg, #1b4d6a 0%, #183e5d 100%)", color: "#fff", padding: "14px 18px", borderBottom: `1px solid ${T.rule}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: ".01em" }}>Material Requirements Planning (MRP)</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              className="mrp-btn mrp-btn-ghost"
              onClick={() => window.print()}
              style={{ background: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.3)", color: "#fff" }}
            >
              Print report
            </button>
            <button
              className="mrp-btn mrp-btn-ghost"
              onClick={() => {
                const printWindow = window.open('', '_blank', 'width=1200,height=900');
                if (!printWindow) return;
                const title = 'Material Requirements Planning (MRP)';
                const tableHtml = document.querySelector('.mrp-report-table')?.outerHTML || '';
                printWindow.document.write(`
                  <html>
                    <head>
                      <title>${title}</title>
                      <style>
                        body { font-family: Arial, sans-serif; margin: 20px; color: #1b2430; }
                        table { border-collapse: collapse; width: 100%; font-size: 11px; }
                        th, td { border: 1px solid #d7d0bf; padding: 6px 8px; text-align: left; }
                        th { background: #dfeaf3; }
                        .status { font-weight: 600; }
                        .right { text-align: right; }
                        .head { font-size: 18px; font-weight: 700; margin-bottom: 14px; }
                      </style>
                    </head>
                    <body>
                      <div class="head">${title}</div>
                      ${tableHtml}
                      <script>
                        window.onload = function () {
                          setTimeout(() => {
                            window.print();
                            window.close();
                          }, 250);
                        };
                      </script>
                    </body>
                  </html>
                `);
                printWindow.document.close();
              }}
              style={{ background: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.3)", color: "#fff" }}
            >
              Export PDF
            </button>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, padding: "5px 10px", fontSize: 11, fontWeight: 600 }}>
              {saveState === "saving" ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={11} />}
              {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Local draft"}
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: "#f3efe7", borderBottom: `1px solid ${T.line}`, padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(180px, 1fr))", gap: 12 }}>
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 4, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Start Date</div>
            <div className="plex-mono" style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{startDate.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</div>
          </div>
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 4, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>End Date</div>
            <div className="plex-mono" style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{endDate.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</div>
          </div>
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 4, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Source</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>SS_BR-w.Plan</div>
          </div>
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 4, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Status</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge tone={exceptions.length ? "warn" : "ok"}>{exceptions.length ? "Exceptions" : "Healthy"}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div style={{ overflowX: "auto", overflowY: "hidden", background: T.card, borderTop: `1px solid ${T.line}` }}>
        <table className="mrp-table mrp-report-table plex-sans" style={{ minWidth: 1700, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ minWidth: 150, padding: "8px 10px" }}>Component</th>
              <th style={{ minWidth: 240, padding: "8px 10px" }}>Description</th>
              <th style={{ minWidth: 90, padding: "8px 10px", textAlign: "right" }}>Pack Size</th>
              <th style={{ minWidth: 90, padding: "8px 10px", textAlign: "right" }}>SOH WIP</th>
              <th style={{ minWidth: 90, padding: "8px 10px", textAlign: "right" }}>SOH RAW</th>
              <th style={{ minWidth: 90, padding: "8px 10px", textAlign: "right" }}>SOH REG</th>
              <th style={{ minWidth: 110, padding: "8px 10px", textAlign: "right" }}>Total SOH</th>
              <th style={{ minWidth: 110, padding: "8px 10px", textAlign: "right" }}>BAW Order</th>
              <th style={{ minWidth: 110, padding: "8px 10px", textAlign: "right" }}>Gross Req</th>
              <th style={{ minWidth: 110, padding: "8px 10px", textAlign: "right" }}>Request Qty</th>
              <th style={{ minWidth: 90, padding: "8px 10px", textAlign: "right" }}>Unit Cost</th>
              <th style={{ minWidth: 120, padding: "8px 10px", textAlign: "right" }}>Transfer Qty</th>
              <th style={{ minWidth: 120, padding: "8px 10px", textAlign: "right" }}>Transfer Value</th>
              <th style={{ minWidth: 120, padding: "8px 10px", textAlign: "right" }}>Variance</th>
              <th style={{ minWidth: 170, padding: "8px 10px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={row.id} style={{ cursor: "pointer" }} onClick={() => onGoLedger(row.id)}>
                <td className="plex-mono" style={{ padding: "8px 10px", fontWeight: 600, color: T.ink }}>{row.code}</td>
                <td style={{ padding: "8px 10px", color: T.inkSoft }}>{row.description}</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right" }}>{fmtNum(row.packSize)}</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right", color: T.muted }}>0.00</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right" }}>{fmtNum(row.sohRaw)}</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right", color: T.muted }}>0.00</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{fmtNum(row.totalSoh)}</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right" }}>{fmtNum(row.bawOrder)}</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right" }}>{fmtNum(row.grossReq)}</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right" }}>{fmtNum(row.requestQty)}</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right" }}>{fmtNum(row.unitCost)}</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right" }}>{fmtNum(row.transfer)}</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right" }}>{fmtNum(row.transfer * row.unitCost)}</td>
                <td className="plex-mono" style={{ padding: "8px 10px", textAlign: "right", color: row.variance > 0 ? T.brick : T.green }}>
                  {fmtNum(row.variance)}
                </td>
                <td style={{ padding: "8px 10px" }}>
                  <Badge tone={row.tone}>{row.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, padding: "14px 16px", background: T.paper, borderTop: `1px solid ${T.line}` }}>
        <span style={{ fontSize: 12, color: T.muted }}>Page {safePage + 1} of {totalPages}</span>
        <button
          className="mrp-btn mrp-btn-ghost"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={safePage === 0}
          style={{ opacity: safePage === 0 ? 0.5 : 1, cursor: safePage === 0 ? "not-allowed" : "pointer" }}
        >
          Previous
        </button>
        <button
          className="mrp-btn mrp-btn-primary"
          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          disabled={safePage >= totalPages - 1}
          style={{ opacity: safePage >= totalPages - 1 ? 0.5 : 1, cursor: safePage >= totalPages - 1 ? "not-allowed" : "pointer" }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 600, color: T.ink }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: T.muted, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Planning                                                               */
/* ---------------------------------------------------------------------- */
function PlanningTab({ planning, setPlanning }) {
  function updateEntry(id, field, value) {
    setPlanning((prev) => ({
      ...prev,
      entries: prev.entries.map((entry) => entry.id === id ? { ...entry, [field]: value } : entry),
    }));
  }

  function addRow() {
    setPlanning((prev) => ({
      ...prev,
      entries: [
        ...prev.entries,
        {
          id: uid(),
          day: prev.weekStart,
          weekday: "Custom",
          shift: "SHIFT 01",
          machine: "BM01",
          partNumber: "",
          target: "",
          status: "Planned",
        },
      ],
    }));
  }

  function moveWeek(offset) {
    const current = new Date(planning.weekStart);
    const nextStart = addDays(current, offset * 7);
    setPlanning(buildPlanningWeek(nextStart));
  }

  function resetWeek() {
    setPlanning(buildDefaultPlanningWeek());
  }

  const weekOptions = [
    { label: "Prev", offset: -1 },
    { label: "This Week", offset: 0 },
    { label: "Next", offset: 1 },
  ];

  return (
    <div>
      <SectionHeader
        title="Planning"
        subtitle="Manual weekly plan for production and dispatch activity"
        right={
          <button className="mrp-btn mrp-btn-ghost" onClick={resetWeek}>
            <RotateCcw size={14} /> Reset week
          </button>
        }
      />

      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 6, overflow: "hidden", marginBottom: 18 }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>Week of</div>
            <div className="plex-mono" style={{ fontWeight: 600, fontSize: 15 }}>{planning.weekStart}</div>
          </div>
          <button className="mrp-btn mrp-btn-primary" onClick={addRow}><Plus size={14} /> Add row</button>
        </div>

        <div style={{ padding: "12px 14px 0", background: T.paper, borderBottom: `1px solid ${T.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, overflowX: "auto", paddingBottom: 10 }}>
            {weekOptions.map((option) => (
              <button
                key={option.label}
                onClick={() => moveWeek(option.offset)}
                style={{
                  flexShrink: 0,
                  border: "1px solid #d7d0bf",
                  background: option.offset === 0 ? T.copper : "#fff",
                  color: option.offset === 0 ? "#fff" : T.ink,
                  borderRadius: 999,
                  padding: "7px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: "auto", overflowY: "hidden" }}>
          <table className="mrp-table" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>Day</th>
                <th>Shift</th>
                <th>Machine</th>
                <th>Part Number</th>
                <th>Target</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {planning.entries.map((entry) => (
                <tr key={entry.id}>
                  <td><input type="date" className="mrp-input plex-mono" style={{ width: 130 }} value={entry.day} onChange={(e) => updateEntry(entry.id, "day", e.target.value)} /></td>
                  <td>
                    <select className="mrp-input" style={{ width: 120 }} value={entry.shift || "SHIFT 01"} onChange={(e) => updateEntry(entry.id, "shift", e.target.value)}>
                      <option value="SHIFT 01">SHIFT 01</option>
                      <option value="SHIFT 02">SHIFT 02</option>
                      <option value="SHIFT 03">SHIFT 03</option>
                    </select>
                  </td>
                  <td>
                    <select className="mrp-input" style={{ width: 110 }} value={entry.machine || ""} onChange={(e) => updateEntry(entry.id, "machine", e.target.value)}>
                      <option value="">Select…</option>
                      <option value="BM01">BM01</option>
                      <option value="BM02">BM02</option>
                      <option value="BM03">BM03</option>
                      <option value="BM04">BM04</option>
                      <option value="BM05">BM05</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="mrp-input"
                      style={{ width: 220 }}
                      value={entry.partNumber || ""}
                      onChange={(e) => updateEntry(entry.id, "partNumber", e.target.value)}
                      disabled={!entry.machine}
                    >
                      <option value="">Select…</option>
                      {(MACHINE_PART_OPTIONS[entry.machine] || PART_NUMBER_OPTIONS).map((part) => (
                        <option key={part} value={part}>{part}</option>
                      ))}
                    </select>
                  </td>
                  <td><input className="mrp-input" style={{ width: 180 }} value={entry.target} onChange={(e) => updateEntry(entry.id, "target", e.target.value)} placeholder="Output target / qty / notes" /></td>
                  <td>
                    <select className="mrp-input" value={entry.status} onChange={(e) => updateEntry(entry.id, "status", e.target.value)}>
                      <option>Planned</option>
                      <option>In progress</option>
                      <option>Completed</option>
                      <option>Blocked</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Items                                                                 */
/* ---------------------------------------------------------------------- */
function ItemsTab({ items, setItems }) {
  const [draft, setDraft] = useState(blankItem());

  function blankItem() {
    return { code: "", description: "", type: "Buy", leadTimeDays: 7, safetyStock: 0, lotSize: 0, onHand: 0, uom: "EA" };
  }

  function updateItem(id, field, value) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  }

  function addItem() {
    if (!draft.code.trim()) return;
    setItems((prev) => [...prev, { id: uid(), ...draft }]);
    setDraft(blankItem());
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div>
      <SectionHeader title="Items" subtitle="Item master — the record every BOM, demand and order line refers back to" />
      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 6, overflow: "hidden", marginBottom: 18 }}>
        <table className="mrp-table">
          <thead>
            <tr>
              <th>Code</th><th>Description</th><th>Type</th><th style={{ textAlign: "right" }}>Lead (d)</th>
              <th style={{ textAlign: "right" }}>Safety</th><th style={{ textAlign: "right" }}>Lot size</th>
              <th style={{ textAlign: "right" }}>On hand</th><th>UoM</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td><input className="mrp-input plex-mono" style={{ width: 90 }} value={it.code} onChange={(e) => updateItem(it.id, "code", e.target.value)} /></td>
                <td><input className="mrp-input" style={{ width: 210 }} value={it.description} onChange={(e) => updateItem(it.id, "description", e.target.value)} /></td>
                <td>
                  <select className="mrp-input" value={it.type} onChange={(e) => updateItem(it.id, "type", e.target.value)}>
                    <option>Make</option><option>Buy</option>
                  </select>
                </td>
                <td><input type="number" className="mrp-input plex-mono" style={{ width: 60, textAlign: "right" }} value={it.leadTimeDays} onChange={(e) => updateItem(it.id, "leadTimeDays", e.target.value)} /></td>
                <td><input type="number" className="mrp-input plex-mono" style={{ width: 60, textAlign: "right" }} value={it.safetyStock} onChange={(e) => updateItem(it.id, "safetyStock", e.target.value)} /></td>
                <td><input type="number" className="mrp-input plex-mono" style={{ width: 60, textAlign: "right" }} value={it.lotSize} onChange={(e) => updateItem(it.id, "lotSize", e.target.value)} /></td>
                <td><input type="number" className="mrp-input plex-mono" style={{ width: 60, textAlign: "right" }} value={it.onHand} onChange={(e) => updateItem(it.id, "onHand", e.target.value)} /></td>
                <td><input className="mrp-input plex-mono" style={{ width: 48 }} value={it.uom} onChange={(e) => updateItem(it.id, "uom", e.target.value)} /></td>
                <td><button onClick={() => removeItem(it.id)} className="mrp-btn" style={{ padding: 5, color: T.muted }}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background: T.card, border: `1px dashed ${T.rule}`, borderRadius: 6, padding: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>Add item</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Code" w={110}><input className="mrp-input plex-mono" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="RM-1000" /></Field>
          <Field label="Description" w={220}><input className="mrp-input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Item description" /></Field>
          <Field label="Type" w={90}><select className="mrp-input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}><option>Make</option><option>Buy</option></select></Field>
          <Field label="Lead (d)" w={70}><input type="number" className="mrp-input plex-mono" value={draft.leadTimeDays} onChange={(e) => setDraft({ ...draft, leadTimeDays: e.target.value })} /></Field>
          <Field label="Safety" w={70}><input type="number" className="mrp-input plex-mono" value={draft.safetyStock} onChange={(e) => setDraft({ ...draft, safetyStock: e.target.value })} /></Field>
          <Field label="Lot size" w={70}><input type="number" className="mrp-input plex-mono" value={draft.lotSize} onChange={(e) => setDraft({ ...draft, lotSize: e.target.value })} /></Field>
          <Field label="On hand" w={70}><input type="number" className="mrp-input plex-mono" value={draft.onHand} onChange={(e) => setDraft({ ...draft, onHand: e.target.value })} /></Field>
          <Field label="UoM" w={56}><input className="mrp-input plex-mono" value={draft.uom} onChange={(e) => setDraft({ ...draft, uom: e.target.value })} /></Field>
          <button className="mrp-btn mrp-btn-primary" onClick={addItem}><Plus size={14} /> Add</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  BOM                                                                   */
/* ---------------------------------------------------------------------- */
function BomTab({ items, boms, setBoms }) {
  const [draft, setDraft] = useState({ parentId: "", componentId: "", qtyPer: 1 });

  function addLine() {
    if (!draft.parentId || !draft.componentId || draft.parentId === draft.componentId) return;
    setBoms((prev) => [...prev, { id: uid(), ...draft }]);
    setDraft({ parentId: draft.parentId, componentId: "", qtyPer: 1 });
  }
  function removeLine(id) {
    setBoms((prev) => prev.filter((b) => b.id !== id));
  }
  function updateLine(id, field, value) {
    setBoms((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  }
  const codeOf = (id) => items.find((i) => i.id === id)?.code || "—";

  const grouped = useMemo(() => {
    const m = {};
    boms.forEach((b) => {
      if (!m[b.parentId]) m[b.parentId] = [];
      m[b.parentId].push(b);
    });
    return m;
  }, [boms]);

  return (
    <div>
      <SectionHeader title="Bill of Materials" subtitle="Parent-component structure, with quantity required per one parent unit" />

      {items.length === 0 ? (
        <div style={{ color: T.muted, fontSize: 13 }}>Add items first, then define their structure here.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
          {items.filter((p) => grouped[p.id]).map((parent) => (
            <div key={parent.id} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 6, overflow: "hidden" }}>
              <div style={{ padding: "9px 14px", borderBottom: `1px solid ${T.line}`, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <span className="plex-mono">{parent.code}</span>
                <span style={{ color: T.muted, fontWeight: 400 }}>{parent.description}</span>
              </div>
              <table className="mrp-table">
                <tbody>
                  {grouped[parent.id].map((b) => (
                    <tr key={b.id}>
                      <td style={{ width: 24, color: T.rule }}><ChevronRight size={14} /></td>
                      <td className="plex-mono">{codeOf(b.componentId)}</td>
                      <td style={{ color: T.muted }}>{items.find((i) => i.id === b.componentId)?.description}</td>
                      <td style={{ width: 140 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                          <span style={{ fontSize: 12, color: T.muted }}>qty/parent</span>
                          <input type="number" className="mrp-input plex-mono" style={{ width: 60, textAlign: "right" }} value={b.qtyPer} onChange={(e) => updateLine(b.id, "qtyPer", e.target.value)} />
                        </div>
                      </td>
                      <td style={{ width: 32 }}><button onClick={() => removeLine(b.id)} className="mrp-btn" style={{ padding: 5, color: T.muted }}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: T.card, border: `1px dashed ${T.rule}`, borderRadius: 6, padding: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>Add BOM line</div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Parent item" w={220}>
            <select className="mrp-input" value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}>
              <option value="">Select…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description}</option>)}
            </select>
          </Field>
          <Field label="Component item" w={220}>
            <select className="mrp-input" value={draft.componentId} onChange={(e) => setDraft({ ...draft, componentId: e.target.value })}>
              <option value="">Select…</option>
              {items.filter((i) => i.id !== draft.parentId).map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description}</option>)}
            </select>
          </Field>
          <Field label="Qty per parent" w={90}>
            <input type="number" className="mrp-input plex-mono" value={draft.qtyPer} onChange={(e) => setDraft({ ...draft, qtyPer: e.target.value })} />
          </Field>
          <button className="mrp-btn mrp-btn-primary" onClick={addLine}><Plus size={14} /> Add</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Demand                                                                */
/* ---------------------------------------------------------------------- */
function DemandTab({ items, demands, setDemands }) {
  const [draft, setDraft] = useState({ itemId: "", qty: 1, dueDate: todayISO(), source: "" });
  function add() {
    if (!draft.itemId || !draft.qty) return;
    setDemands((prev) => [...prev, { id: uid(), ...draft }]);
    setDraft({ itemId: draft.itemId, qty: 1, dueDate: todayISO(), source: "" });
  }
  function remove(id) { setDemands((prev) => prev.filter((d) => d.id !== id)); }
  function update(id, field, value) { setDemands((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))); }
  const codeOf = (id) => items.find((i) => i.id === id)?.code || "—";

  const sorted = [...demands].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  return (
    <div>
      <SectionHeader title="Demand" subtitle="Independent demand — confirmed sales orders and forecast" />
      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 6, overflow: "hidden", marginBottom: 18 }}>
        <table className="mrp-table">
          <thead><tr><th>Item</th><th>Source / reference</th><th style={{ textAlign: "right" }}>Qty</th><th>Due date</th><th></th></tr></thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.id}>
                <td className="plex-mono">{codeOf(d.itemId)}</td>
                <td><input className="mrp-input" style={{ width: 160 }} value={d.source} onChange={(e) => update(d.id, "source", e.target.value)} /></td>
                <td><input type="number" className="mrp-input plex-mono" style={{ width: 70, textAlign: "right" }} value={d.qty} onChange={(e) => update(d.id, "qty", e.target.value)} /></td>
                <td><input type="date" className="mrp-input plex-mono" value={d.dueDate} onChange={(e) => update(d.id, "dueDate", e.target.value)} /></td>
                <td><button onClick={() => remove(d.id)} className="mrp-btn" style={{ padding: 5, color: T.muted }}><Trash2 size={14} /></button></td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={5} style={{ color: T.muted, padding: 14 }}>No demand recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ background: T.card, border: `1px dashed ${T.rule}`, borderRadius: 6, padding: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>Add demand line</div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Item" w={220}>
            <select className="mrp-input" value={draft.itemId} onChange={(e) => setDraft({ ...draft, itemId: e.target.value })}>
              <option value="">Select…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description}</option>)}
            </select>
          </Field>
          <Field label="Source / ref" w={160}><input className="mrp-input" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="SO-10345" /></Field>
          <Field label="Qty" w={80}><input type="number" className="mrp-input plex-mono" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} /></Field>
          <Field label="Due date" w={140}><input type="date" className="mrp-input plex-mono" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></Field>
          <button className="mrp-btn mrp-btn-primary" onClick={add}><Plus size={14} /> Add</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Open Orders                                                           */
/* ---------------------------------------------------------------------- */
function OrdersTab({ items, openOrders, setOpenOrders }) {
  const [draft, setDraft] = useState({ itemId: "", qty: 1, dueDate: todayISO(), type: "PO", reference: "" });
  function add() {
    if (!draft.itemId || !draft.qty) return;
    setOpenOrders((prev) => [...prev, { id: uid(), ...draft }]);
    setDraft({ itemId: draft.itemId, qty: 1, dueDate: todayISO(), type: draft.type, reference: "" });
  }
  function remove(id) { setOpenOrders((prev) => prev.filter((o) => o.id !== id)); }
  function update(id, field, value) { setOpenOrders((prev) => prev.map((o) => (o.id === id ? { ...o, [field]: value } : o))); }
  const codeOf = (id) => items.find((i) => i.id === id)?.code || "—";
  const sorted = [...openOrders].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  return (
    <div>
      <SectionHeader title="Open orders" subtitle="Scheduled receipts already in motion — purchase orders and work orders" />
      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 6, overflow: "hidden", marginBottom: 18 }}>
        <table className="mrp-table">
          <thead><tr><th>Item</th><th>Type</th><th>Reference</th><th style={{ textAlign: "right" }}>Qty</th><th>Due date</th><th></th></tr></thead>
          <tbody>
            {sorted.map((o) => (
              <tr key={o.id}>
                <td className="plex-mono">{codeOf(o.itemId)}</td>
                <td>
                  <select className="mrp-input" value={o.type} onChange={(e) => update(o.id, "type", e.target.value)}>
                    <option>PO</option><option>WO</option>
                  </select>
                </td>
                <td><input className="mrp-input plex-mono" style={{ width: 120 }} value={o.reference} onChange={(e) => update(o.id, "reference", e.target.value)} /></td>
                <td><input type="number" className="mrp-input plex-mono" style={{ width: 70, textAlign: "right" }} value={o.qty} onChange={(e) => update(o.id, "qty", e.target.value)} /></td>
                <td><input type="date" className="mrp-input plex-mono" value={o.dueDate} onChange={(e) => update(o.id, "dueDate", e.target.value)} /></td>
                <td><button onClick={() => remove(o.id)} className="mrp-btn" style={{ padding: 5, color: T.muted }}><Trash2 size={14} /></button></td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={6} style={{ color: T.muted, padding: 14 }}>No open orders recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ background: T.card, border: `1px dashed ${T.rule}`, borderRadius: 6, padding: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>Add open order</div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Item" w={220}>
            <select className="mrp-input" value={draft.itemId} onChange={(e) => setDraft({ ...draft, itemId: e.target.value })}>
              <option value="">Select…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description}</option>)}
            </select>
          </Field>
          <Field label="Type" w={80}><select className="mrp-input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}><option>PO</option><option>WO</option></select></Field>
          <Field label="Reference" w={140}><input className="mrp-input plex-mono" value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} placeholder="PO-5521" /></Field>
          <Field label="Qty" w={80}><input type="number" className="mrp-input plex-mono" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} /></Field>
          <Field label="Due date" w={140}><input type="date" className="mrp-input plex-mono" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></Field>
          <button className="mrp-btn mrp-btn-primary" onClick={add}><Plus size={14} /> Add</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Planning Ledger                                                       */
/* ---------------------------------------------------------------------- */
function LedgerTab({ items, boms, mrp, weeks, ledgerItemId, setLedgerItemId }) {
  const item = items.find((i) => i.id === ledgerItemId);
  const r = item ? mrp[item.id] : null;
  const parentsUsing = boms.filter((b) => b.componentId === ledgerItemId).map((b) => items.find((i) => i.id === b.parentId)?.code).filter(Boolean);

  const rows = r
    ? [
        { label: "Gross requirements", data: r.GR, tone: "normal" },
        { label: "Scheduled receipts", data: r.SR, tone: "normal" },
        { label: "Projected on hand", data: r.POH, tone: "poh" },
        { label: "Planned order receipt", data: r.PORcpt, tone: "accent" },
        { label: "Planned order release", data: r.PORel, tone: "release" },
      ]
    : [];

  return (
    <div>
      <SectionHeader
        title="Planning ledger"
        subtitle="Time-phased record — gross requirements netted against on-hand and scheduled receipts, offset by lead time"
        right={
          <select className="mrp-input" style={{ width: 260 }} value={ledgerItemId || ""} onChange={(e) => setLedgerItemId(e.target.value)}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description}</option>)}
          </select>
        }
      />

      {!item ? (
        <div style={{ color: T.muted }}>Add an item to see its planning ledger.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 18, marginBottom: 14, fontSize: 12.5, color: T.muted, flexWrap: "wrap" }}>
            <span><b style={{ color: T.ink }}>{item.type}</b> item</span>
            <span>Lead time: <b className="plex-mono" style={{ color: T.ink }}>{item.leadTimeDays}d</b></span>
            <span>Safety stock: <b className="plex-mono" style={{ color: T.ink }}>{fmtNum(item.safetyStock)}</b></span>
            <span>Lot size: <b className="plex-mono" style={{ color: T.ink }}>{fmtNum(item.lotSize)}</b></span>
            <span>On hand today: <b className="plex-mono" style={{ color: T.ink }}>{fmtNum(item.onHand)}</b></span>
            {parentsUsing.length > 0 && <span>Used in: <b className="plex-mono" style={{ color: T.ink }}>{parentsUsing.join(", ")}</b></span>}
          </div>

          {r.pastDueRelease > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: T.brickTint, color: T.brick, padding: "8px 12px", borderRadius: 4, fontSize: 13, marginBottom: 14 }}>
              <AlertTriangle size={15} />
              Release {fmtNum(r.pastDueRelease)} {item.uom} now — the lead time doesn't fit before the requirement date.
            </div>
          )}

          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 6, overflow: "auto" }}>
            <table className="mrp-table plex-mono" style={{ minWidth: 620 + weeks.length * 74 }}>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, background: T.card, minWidth: 190 }} className="plex-sans">Bucket</th>
                  {weeks.map((w, i) => (
                    <th key={i} style={{ textAlign: "right", minWidth: 74 }}>
                      {i === 0 ? "This wk" : fmtShort(w)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <td style={{ position: "sticky", left: 0, background: T.card, color: T.muted, fontWeight: 500 }} className="plex-sans">{row.label}</td>
                    {row.data.map((v, i) => {
                      let color = T.text;
                      if (row.tone === "poh" && v < (Number(item.safetyStock) || 0)) color = T.brick;
                      if (row.tone === "release" && v > 0) color = T.copperDark;
                      if (row.tone === "accent" && v > 0) color = T.green;
                      return (
                        <td key={i} style={{ textAlign: "right", color, fontWeight: (row.tone === "release" || row.tone === "accent") && v > 0 ? 600 : 400 }}>
                          {v === 0 ? "·" : fmtNum(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: T.muted }}>
            Rows in copper mark planned order releases; red marks a projected on-hand balance below safety stock.
          </div>
        </>
      )}
    </div>
  );
}
