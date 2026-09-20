# Production Scrap architecture

The Production Scrap module presents confirmed scrap separately from other inventory movement activity. The separation prevents ambiguous recovery, rework, conversion, or correction movements from being reported as confirmed manufacturing loss.

## Data flow

```text
SYSPRO SQL Server (SELECT only)
  -> parameterized Express endpoint
  -> normalized movement records and mapping provenance
  -> pure frontend filtering and aggregation
  -> KPI cards, charts, and audit tables
```

The endpoint is:

```text
GET /api/syspro/production-scrap?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

Dates are validated, bounded, and supplied as typed SQL parameters. Invalid ranges return HTTP 400. Database failures return HTTP 503 rather than a successful empty report.

## Confirmed versus other activity

Confirmed scrap uses a deliberately narrow, reviewed movement rule. Other movement families are displayed in a separate neutral activity section and are excluded from confirmed cost, quantity, and target comparisons.

Synthetic documentation names illustrate the boundary:

- `TEST-WAREHOUSE-WIP`: production stock source.
- `TEST-WAREHOUSE-SCRAP`: confirmed scrap destination.
- `TEST-WAREHOUSE-RECOVERY`: other recovery/reuse activity.

The implementation preserves movement signs and source/destination direction. It does not use absolute values to manufacture net scrap, join both transfer legs, or deduplicate legitimate transactions heuristically.

## Commodity classification

Movement retrieval and commodity attribution are independent operations. A separate SELECT-only BOM query obtains all direct parent relationships for stock codes in the selected period.

Classification considers every returned parent:

- **Mapped**: exactly one approved candidate and complete parent coverage.
- **Incomplete Coverage**: one candidate plus unclassified parents.
- **Unmapped**: no approved candidate.
- **Ambiguous**: more than one candidate.

No arbitrary first parent is selected. Parent codes, descriptions, routes, quantities, and mapping provenance remain available for drill-down. BOM membership is described as commodity evidence, not proof of the department that caused a movement.

Example identifiers in tests and documentation should use values such as `TEST-PARENT-001` and `TEST-COMPONENT-001`.

## Reporting rules

- Confirmed KPIs use only the confirmed movement set.
- Other activity is shown independently and has no confirmed-scrap target comparison.
- Date, commodity, movement type, and stock-code filters intersect.
- Subset views do not claim comparison against an unallocated plant-wide target.
- Missing cost or mixed units remain visible and are not coerced into misleading totals.
- Multi-month references count the selected calendar scope according to the documented target policy.

## Responsibilities

- `server/queries/productionScrap.sql`: confirmed and other movement retrieval.
- `server/queries/scrapCommodityParents.sql`: BOM relationship evidence.
- `server/routes/productionScrap.js`: request validation and parameter binding.
- `server/scrapCommodity.js`: explicit mapping and confidence logic.
- `mrp-planner/src/scrap/deriveScrapData.js`: pure filtering and aggregation.
- `ProductionScrap.jsx`, `ScrapCharts.jsx`, and `scrapMotion.jsx`: presentation and interaction.
- `tests/productionScrap.test.cjs`: synthetic regression and endpoint coverage.

## Safety

- All runtime SYSPRO statements are SELECT-only.
- The module does not modify SYSPRO or PostgreSQL.
- No movement is reclassified solely from a warehouse name, stock-code pattern, zero stock, or recent activity.
- Unresolved activity stays visible and outside confirmed totals until an approved business rule exists.
- Automated tests use injected rows and mocked database collaborators.
