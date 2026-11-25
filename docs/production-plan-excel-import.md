# Planning Excel import: original grid and reusable profiles

The normal upload format is the original production grid. Planners keep its
machine rows, merged day headers and shift columns; no conversion or Cell Review
sheet is needed. The importer parses `.xlsx` locally in the browser. PDF exports,
including Store Request PDF, remain available.

## Recognition and dates

The acceptance workbook is
`C:/Users/France/OneDrive - ATD-Alliance/Documents/Production plan 17 Nov 2026 Rev2.xlsx`.
It contains `Table 1`, A1:M12, with four days (17-20 November), nine machines,
108 source cells and 125 ordered fragments: 85 production runs, 10 changeovers,
28 OFF markers and two notes.

Recognition uses structure rather than a sheet name or fixed day count:

- Machine labels occupy column A. BM1-BM5 use the existing BM01-BM05 IDs.
- Each merged date header spans three repeating shift columns.
- Weekdays and dates can use separate merged rows (`Table 1`) or one combined
  row (the earlier converted `Production Plan` template).
- One to fourteen days, up to 500 rows and 52 columns, are supported. Exactly one
  schedule sheet must match. `Cell Review` is reference only and is never imported.
- Full dates, including actual Excel date values, are used directly. Printed
  full years take precedence over a filename year.
- If the year is omitted, a single filename year is accepted only after every
  printed date is valid and every printed weekday agrees. Rev2 resolves to
  17-20 November 2026 without a year question. December-to-January schedules
  can cross into the next year.
- An uncertain year or date conflict produces one workbook-level question,
  with corrected dates applied to the whole workbook. An intentional printed
  weekday correction requires an explicit explanation. The year is checked
  afresh on each file; it is not inherited from last week's profile.

Workbook text is source data, not instructions to the application. Notes such as
`till AR#1`, `and programming`, or cancellation wording are displayed and retained;
they do not execute cancellations, transfer work, alter quantities or invent times.

## First upload: approve only new settings

The compact preview shows the date range, machines, ready count, duplicates and
exceptions. Valid rows are selected automatically. Source-order schedule details
are available on demand; the planner does not have to review each valid row.

New or changed decisions are grouped:

1. **Shift times and overnight date convention.** Map each source time range to
   a distinct configured shift. Choose whether its printed overnight date means
   the shift's start date or end date. End-date sources place overnight work on
   the previous start date. Application shift settings are unchanged.
2. **Shorthand.** Read a valid full stock code directly. Otherwise ask once per
   shorthand and context. Approvals can apply to a production line or a single
   machine. For example, BAA can map differently on BM01 and BM03; CAA can share
   an approved line mapping across BM02 and BM04. No suffix-based pair inference
   or arbitrary stock-code substitution occurs.
3. **Quantity basis.** Approve EA, SET, SHEET or KG and a positive multiplier
   (including 1) once for matching quantities. Rules are scoped to line/machine,
   target planning unit and stock unit. Live BOM stock units take precedence over
   saved item units; a changed stock unit or mapped target invalidates the affected
   approval and asks again. Other valid approvals are reused.

Each approval immediately applies to every matching preview row. The profile is
saved only with the successfully confirmed import. Cancel and failed saves leave
both saved plans and saved profile decisions untouched.

## Recurring upload: exceptions and one final confirmation

Matching uploads load the saved profile without repeating year, shift, shorthand
or quantity questions when the evidence agrees. Unknown codes, changed settings,
date conflicts and invalid quantities remain explicit questions or exceptions.
Questions can be resolved once or their matching rows explicitly skipped.

The planner can edit exceptional stock codes, quantities, machines, dates, shifts
and activities without reopening valid rows. Multiple runs and changeovers stay
in source order. OFF and C/O remain distinct, zero-production-quantity activities.
Notes are visible separately; blank and unsupported entries have their own list.

Likely duplicates, occupied shifts and uncertain paired-output counts remain
source-cell exceptions. A planner can confirm independent runs or skip the cell.
Legitimate split runs are never merged. In Rev2 the multiple output cells C11,
J11 and K11 still need this data-specific decision; the profile does not assume
that every future pair of output lines is an independent run.

One **Confirm and import N rows** action adds the ready rows, preserves existing
records, records every exclusion and saves the approved profile. Unresolved
exceptions are clearly counted and skipped. There is no per-row confirmation,
second review screen or additional final checkbox.

## Saving and linked records

Profiles live in `planningImportProfiles` inside the existing browser-local
`mrp-data` planner snapshot. They persist across reloads in that browser/workspace;
this does not add a shared server profile service. Planning edit permission is
required. Profile scope, target signatures, reviewer, timestamp and revision are
retained. Reusing unchanged approvals preserves their original revision/reviewer.

Import and autosave share the serialized writer. The entire candidate plan and
profile are written before their entries appear on the board. A failed write
retains the exact preview for retry and reuses stable batch/entry IDs. Cancellation
adds no records. Concurrent committed edits are not marked saved prematurely.

Imports append without replacing existing shifts or changing existing plan IDs,
linked Actuals/OEE, other weeks or other lines. Imported runs remain editable
through normal Planning controls, including directly imported full stock-code
members of known pairs. The source text, notes, mapping/unit decisions and
exclusion report remain available after manual edits.

Repeat detection uses source fragment/date identity, including retained reports
after manual edits or deletion. A repeated upload skips imported fragments;
the same grid for a new week stays importable. Other likely duplicates require
an independent-run decision rather than automatic deduplication or merging.

## Acceptance tests

Final verification passed: **233 automated tests**, the production build,
`git diff --check`, and the original/second-workbook browser acceptance flow.
Vite retains its existing large-chunk advisory. No live plan rows were added.

```powershell
npm test
npm run build
node scripts/smoke-planning-profile.cjs "C:/Users/France/OneDrive - ATD-Alliance/Documents/Production plan 17 Nov 2026 Rev2.xlsx"
```

The browser test starts disposable Vite/Edge processes on 5177/9239 with a fresh
profile and intercepted synthetic API data. It reads the supplied original file
without modifying its bytes and creates a second test workbook for 24-27 November
with the same grid, codes, shift times and quantity patterns. It never changes
the live planner's storage or database.

Verified browser acceptance:

- The first file validates 2026 against all weekdays, asks six scoped shorthand
  approvals (BAA differs by machine) and three quantity rules rather than questions
  for every production row. After exceptional split/occupied cells are addressed,
  one final confirmation saves 123 activities and the profile in synthetic storage.
- After a browser reload, the second workbook has **zero year or mapping
  questions**. Its three split-output cells remain exceptional data; one final
  confirmation saves another 123 activities without merging runs.
- AR1, 18 November, SHIFT 02 retains `10 N1WB-J12606-SAH`, C/O,
  `30 R1WB-E12606-AF`, in that order.
- An unknown shorthand repeated twice produces one scoped question. A filename
  year/weekday conflict produces one workbook question and blocks confirmation
  until corrected. Cancelling either changes neither saved profiles nor plans.
- Cancellation of initial profile approval, failed-save retry, reload, manual
  editing, repeat upload, and preservation of existing plans, Actuals and OEE pass.
- There are no runtime exceptions, API writes or live rows added. The test releases
  its own ports. Approval choices use synthetic catalogue data and do not seed or
  approve real business mappings in the live planner.

Evidence is under `diagnostics/planning-excel-profile/`: `acceptance-report.json`,
`first-profile-compact-preview.png`, and `second-upload-no-questions.png`.
Unit tests also cover numeric/full Excel dates, unknown or changed mapping scopes,
conversion factors, both overnight rules, changed live stock units, and atomic
profile/plan save failure.

The earlier converted workbook remains covered by parser/review regression tests.
Source size is limited to 10 MB; unsupported/corrupt/encrypted containers, formulas,
ambiguous layouts, irregular merges, invalid shifts and unowned source text fail
with an actionable error. Only the pinned bundled Excel parser handles the file;
the workbook is not uploaded.
