# SYSPRO startup diagnosis — 18 November 2026

## Confirmed cause and reproduction

The existing root `npm run dev` launched only the nested Vite command. Vite was
running on 5173, but the API had no listener on 3001. Direct API health failed
with `ECONNREFUSED` in 55 ms; Vite's `/api/health` returned an empty HTTP 500 in
48 ms while the application HTML returned HTTP 200. Process inspection confirmed
the npm/Vite chain and no backend. This was an absent backend, not outdated code
being served by a running backend.

The configured corporate hostname resolved in 17 ms and SQL TCP connected in
40 ms. Server, database and user settings were present; the password setting was
empty. Nevertheless a direct `SELECT 1` succeeded in 360 ms using the existing
configuration. Neither DNS nor authentication was the current blocker. No
credentials, hostname, TLS policy or company data were changed.

Inspection also found working-directory-dependent dotenv loading, a single
startup fetch with no recovery, an initial Offline label before any check,
discarded inventory error messages, and pool replacement on every query error
without closing the previous pool. A failed initial connection promise was
already cleared; a permanently rejected promise was not the confirmed cause.
Existing request identity checks already protected the old frontend against
late results and are preserved in the reusable source controller.

## Correction and operation

From the project root:

```powershell
npm run dev
```

This starts the API, checks process readiness, then starts Vite. Existing ports
cause an actionable failure before children start. Child failures propagate and
stop the other process owned by this launcher. No extra dependency, OS service,
scheduled task, migration or deployment is needed. Use Ctrl+C in that terminal
to stop that development session. With an existing frontend-only session, use
`npm run server` for the missing backend.

The root `.env` now loads by absolute project path, retaining process-environment
precedence. Vite development and preview proxy `/api` to the configured backend
port. Static production hosting still requires its own API proxy. The example
configuration now correctly describes the mssql driver instead of ODBC.

Pool creation is shared across concurrent callers. Failed pools close before
replacement, connection retries have a capped cooldown, and errors from old
requests cannot discard newer pools. Query/permission failures retain healthy
pools. Existing TLS settings are unchanged. Driver connection and query timeouts
are finite, with a separate 125-second browser deadline including response parsing.
No SQL statement is automatically replayed by the database layer.

Stock and BOM have independent Checking, Connected, Reconnecting and Offline
states. Transient read failures retry at 1/2/4/8/16/30 seconds, capped at 30 seconds,
with one timer per source. Authentication, configuration and query failures do
not automatically retry. Focus and online events trigger checks with a 10-second
throttle, never assert connectivity themselves, and skip in-flight checks.
Manual retry, cancellation, obsolete-response protection and error clearing are
included. Previous snapshots retain their timestamp and source, display as stale,
and cannot make live stock-dependent calculations complete.

`/api/ready` checks only process readiness. `/api/health` actually executes
`SELECT 1`, sends no-store responses, and returns 503 with a safe diagnostic
category on failure. Stock/BOM reads additionally check their real source tables.
Responses distinguish backend/proxy errors, DNS, TCP, authentication, database
access/query permissions, timeouts and closed pools without exposing driver
messages, SQL text or credentials.

## Verification

- Connection fixtures cover first-pool failure/recovery, concurrent callers,
  closed pools, pool events, query errors, stable invalid configuration and
  authentication failures, stale responses, bounded retries, cancellation,
  focus/network throttling and stale calculation gating.
- HTTP fixtures check real health semantics, diagnostic redaction, no-store
  headers, independently failing BOM and successful inventory, and recovery.
- Launcher fixtures start disposable HTTP children, propagate a child failure,
  verify cleanup, and refuse occupied ports without starting another backend.
- The isolated browser smoke covers initial Checking, reload, simulated backend
  and SQL/DNS restoration, authentication without rapid retry, manual retry,
  visible stale inventory with provenance, independent BOM failure and clearing
  old errors. Saved synthetic records remain intact; no API writes occur.
- All 205 tests in the full suite and the production build pass; `git diff --check` is clean.
  Vite reports its existing warning about large production chunks.
- Live backend and Vite-proxied reads returned 6,095 inventory rows and 27,544 BOM
  rows. Health performed successful SQL checks, and an isolated real browser
  reload displayed both stock and BOM Connected with real source timestamps.

The backend was activated with the established `npm run server` launch method.
Final process inspection found one backend listener on 3001 (PID 21656) and the
original Vite listener on 5173 (PID 31872). Process IDs are session-specific.
The existing frontend was not stopped. The new combined launcher takes effect
on the next development session.

No corporate access blocker remained during these checks. BOM reads took about
87–96 seconds, independently of the quick health/inventory reads. That latency
remains unresolved; ask the database administrator to review it if it persists.
The implemented recovery is fixture-tested; the present startup issue is also
verified resolved live. Future VPN, DNS, credential or SQL-service outages still
require the appropriate network/IT action. Planning-write restriction tests pass;
the restriction itself and all existing business data remain unchanged. No commit
was created.
