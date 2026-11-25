# Rev2 workbook recognition and preview

The importer recognizes schedule structure rather than a fixed sheet name or day
count. It accepts the original converted `Production Plan` layout and the Rev2
layout, including `Table 1`. `Cell Review` is always excluded from schedule
discovery. Exactly one sheet must match; multiple matching schedules are rejected
with an actionable error instead of importing both.

The sheet must have contiguous three-column date merges, the same ordered three
shift headers repeated under each date, and supported machine labels in column A.
Weekday/date labels can share a merged row (the converted layout), or occupy two
separate matching merged rows (Rev2). The bounded parser supports 1-14 days,
up to 500 rows and 52 columns. It retains each source cell and its fragments in
workbook order, including quantities, multiple runs, C/O, OFF and notes.

## Actual workbook inspected

`Production plan 17 Nov 2026 Rev2.xlsx` has one sheet, `Table 1`, range A1:M12:

- A1:A3 is merged and blank; there is no literal Machine heading to depend on.
- B1:D1, E1:G1, H1:J1, K1:M1 hold Tuesday through Friday.
- B2:D2, E2:G2, H2:J2, K2:M2 hold 17-Nov through 20-Nov. No year is printed.
- Row 3 repeats 06:00-14:23, 14:00-22:23 and 22:00-06:23 under each day.
- Rows 4-12 hold AR1, AR2, AR4, AR5, AR3, BM1, BM2, BM3 and BM4, preserving that
  order. BM1-BM4 use the existing BM01-BM04 model identifiers.
- Extraction retains **108 source cells and 125 fragments**: 85 production,
  10 changeovers, 28 OFF markers and 2 notes. No source fragments are combined.

## Requested AR1 verification

`Table 1!F4` belongs to AR1, 18 November, the second source shift
(14:00-22:23). Its extracted and displayed order is:

| Order | Activity | Stock code | Quantity |
| --- | --- | --- | --- |
| 1 | Production | N1WB-J12606-SAH | 10 |
| 2 | Changeover | none | no production quantity |
| 3 | Production | R1WB-E12606-AF | 30 |

The current normal upload flow verifies 2026 from the filename against every
printed weekday. The first upload approves recurring settings once; matching
uploads reuse the profile and present a compact preview with one final import
confirmation. See [the current importer workflow and acceptance results](production-plan-excel-import.md).

The browser acceptance test reads the original OneDrive workbook, then uploads a
second workbook with the same layout and approved mappings for the following week.
The second upload asks no year or mapping questions. Unknown shorthand, conflicting
dates, cancellation and failed saves remain covered, using isolated synthetic
storage only. No live plans are changed.

The raw workbook still leaves quantity units, shorthand interpretation and the
three multiple-output cells C11, J11 and K11 to planner-approved decisions. Its
notes `till AR#1` and `and programming` remain visible as source notes; they do not
execute transfers, quantity changes or programming durations.
