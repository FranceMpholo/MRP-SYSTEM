# Temporary PostgreSQL planning write restriction

This is containment, not completed authentication. The MRP router permits only
GET, HEAD, and OPTIONS. Other methods return HTTP 503 before route validation,
database acquisition, queries, or transactions, with this JSON response:

```json
{
  "success": false,
  "code": "PLANNING_WRITES_UNAVAILABLE",
  "error": "Planning writes are unavailable until server-side authentication and authorization are configured."
}
```

The response uses `Cache-Control: no-store`. The application's existing global
JSON parser and CORS middleware still run before the router; malformed HTTP/JSON
requests may be rejected there instead. They cannot reach mutation database code.

## Endpoints and callers inspected

The only existing planning mutation endpoints are:

| Method | Endpoint | Preserved implementation |
| --- | --- | --- |
| POST | `/api/mrp/planning` | Validation, reference checks, INSERT |
| PATCH | `/api/mrp/planning/:id` | Existing-row lookup, validation, UPDATE |
| DELETE | `/api/mrp/planning/:id` | Connection acquisition, transaction, dependency checks, DELETE |

No PUT, bulk, alternate planning endpoint, or planning-run write API is currently
registered. The restriction is first in `server/routes/mrp.js` and applies to
the entire `/api/mrp` namespace, including non-read methods on unregistered or
future bulk/alternative paths. Adding a route later in this router cannot
accidentally expose an anonymous write. Keep every future planning API behind
the same restriction until verified server-side access control replaces it.

Inspection of `server/server.js`, all route registrations, frontend API callers,
scripts, and tests found no active frontend workflow using these writes:

- `mrp-planner/src/App.jsx` updates planning state and saves browser-local
  `mrp-data` through `plannerStorage.js`.
- `mrp-planner/src/api/planningApi.js` exports only GET helpers, which are not
  imported by the active planner components.
- `apiClient.js` has generic mutation helpers, but the repository uses them only
  in transport tests against `/api/example`.
- Existing deletion tests invoke the preserved handler directly with mocked
  PostgreSQL collaborators. Those tests validate future handler behavior, not
  HTTP access. New restriction tests exercise the mounted HTTP application.
- The planning-run migration is schema-only; it does not register an API or
  run automatically. Item-master synchronization is a separate CLI/service,
  not a planning write caller, and is unaffected.

Existing GET routes for health, departments, shifts, machines, item resolution,
planning lists, and planning details keep their current behavior. HEAD and
OPTIONS retain Express/CORS behavior. SYSPRO, FCSD, OEE, Scrap, and browser-local
planning workflows are outside this restriction.

## Requirements before enabling authenticated writes

There is no environment flag, browser identity, role header, or bearer-token
presence check that enables writes. Supplying a token does not verify it, and
browser-local users/roles are not server authentication.

Replace the restriction only as part of a reviewed server-side access-control
implementation that:

1. Establishes a trusted identity using a configured authentication provider or
   server-managed session, with appropriate verification of credentials/tokens,
   including issuer, audience, signature, and expiry where applicable.
2. Enforces authorization for each operation and resource/department on the
   server before database acquisition or queries. Anonymous and unauthorized
   callers must fail closed, including on bulk/alternative endpoints.
3. Derives the acting user from verified server identity rather than request
   body IDs or browser-supplied role/identity headers, and records that actor.
4. Preserves the existing parameterized SQL, validation, transaction handling,
   and dependency protection. Applies CSRF protection if cookie sessions are used.
5. Adds HTTP regression coverage for invalid/expired tokens, unauthorized users,
   allowed operations, resource scope, and read-only behavior using disposable or
   mocked data. Authentication/configuration failures must never enable anonymous
   writes.

Do not remove the gate merely because a frontend login or token provider exists.
Frontend integration with shared planning data requires a separate reviewed task.

## Verification

```powershell
node --test tests/planningWriteRestriction.test.cjs tests/planningDelete.test.cjs tests/mrpItems.test.cjs tests/planningApiPhase1.test.cjs
node --test tests/*.test.cjs
npm run build
git diff --check
```

The restriction tests mock both database modules. They exercise anonymous writes,
untrusted browser identities/roles/tokens, bulk/alternative methods and paths,
and preserved read responses without real database writes or migrations.
