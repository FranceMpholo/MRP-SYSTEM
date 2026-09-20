# Production Scrap separation update

This update formalizes the distinction between confirmed scrap and other inventory movement activity without changing the underlying read-only integration boundary.

## Confirmed scrap

Confirmed scrap remains limited to the reviewed source-leg transfer rule between a production stock location and the designated confirmed-scrap location. Direction and sign are preserved. Receipt-side duplicates, normal consumption, accounting adjustments, revaluation, and unrelated transfers remain outside this measure.

The query continues to use inclusive date selection through a start-inclusive, next-day-exclusive range. Historical movement cost is used only when present; missing cost remains visible.

## Other movement activity

Recovery, reuse, conversion, and correction flows are reported separately using neutral terminology. Their quantities and values describe movement activity, not confirmed loss, recoverable value, or a cancellation of another event.

There is no combined confirmed-plus-other total. Other activity does not participate in confirmed-scrap targets or variance KPIs.

## Mapping confidence

Every direct BOM parent relationship is retained. Candidate commodity rules are evaluated across the full parent set and produce one of four states:

| Status | Meaning |
| --- | --- |
| Mapped | One approved candidate with complete coverage |
| Incomplete Coverage | One candidate with additional unclassified parents |
| Unmapped | No approved candidate |
| Ambiguous | Multiple candidates |

The detail view exposes mapping provenance. Current BOM relationships are not presented as historical department attribution.

## KPI and chart behavior

Confirmed reporting includes cost, quantity, target reference, variance, time trends, commodity summaries, and stock-code summaries. Other activity receives separate directional trends and rankings.

Filters are shared but do not combine the two classifications. Mixed-unit quantities are labelled accordingly. Target comparisons are suppressed where the selected subset has no approved target allocation.

## Validation strategy

Tests use synthetic movement records such as `TEST-COMPONENT-001` and generic locations such as `TEST-WAREHOUSE-SCRAP`. Coverage verifies:

- other activity cannot enter confirmed totals;
- movement directions are not netted into a fabricated loss;
- BOM fan-out cannot duplicate physical movements;
- ambiguous and incomplete mappings remain explicit;
- date, commodity, movement, and stock filters intersect;
- missing costs and mixed units remain visible;
- SQL remains SELECT-only and uses typed parameters;
- database failures produce an unavailable response.

## Read-only guarantee

The application uses SYSPRO solely as a read-only source. No INSERT, UPDATE, DELETE, MERGE, DDL, or stored-procedure execution is part of this feature. PostgreSQL is not modified by the Production Scrap endpoint.
