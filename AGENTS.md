# MRP Planner shared handover

Applies to Codex, Antigravity, VS Code Chat, and other assistants working in this repository. Use these files as the shared project handover; a chat transcript is not the project record. This coordinates repository work, not the application's browser-local business data.

## Start every task

1. Read this file, [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md), and [docs/DECISIONS.md](docs/DECISIONS.md). Read any relevant feature documentation linked there. If your client does not load `AGENTS.md` automatically, explicitly open these three files before working.
2. Check the actual checkout before editing:

   ```powershell
   git status --short --branch
   git branch --show-current
   git log -1 --oneline
   git diff --stat
   git diff --cached --stat
   ```

3. Treat the current worktree, including untracked files, as existing work to preserve. Inspect relevant diffs before editing. Do not reset, clean, overwrite, discard, or stash someone else's edits to obtain a clean tree. Do not assume that uncommitted work belongs to the current assistant.
4. Identify the requested scope, latest evidence, and next action. Distinguish source changes, isolated fixture tests, live read-only verification, and deployment. A successful test or an existing file is not proof that the operator's running instance has loaded it.
5. When assistants share a worktree, coordinate the files being edited and recheck them before saving. Do not concurrently rewrite the same files. Working in another checkout requires an explicit transfer of relevant uncommitted work; branch names alone do not share that work.

## Project boundaries

- React/Vite frontend: `mrp-planner/`. Express backend: `server/`. Root commands: `npm run dev`, `npm test`, and `npm run build`; see [mrp-planner/README.md](mrp-planner/README.md).
- The active planner stores records in browser-local `mrp-data`, not shared PostgreSQL planning storage. `localhost`, `127.0.0.1`, different ports, browser profiles, and other computers can have different plans. Preserve existing plans, physical counts, linked Actuals/OEE and manual edits. Browser smoke scripts must use isolated test profiles and synthetic records.
- SYSPRO integrations are read-only. Keep credentials and connection secrets out of documentation, logs, chat, fixtures, and Git. Use the existing approved connection for appropriately scoped read-only checks; do not introduce ERP writes as a side effect.
- Keep the PostgreSQL planning write restriction in place until a separately scoped implementation provides verified server-side authentication and authorization. Browser-local users/roles do not establish server identity. See [planning-write-restriction.md](docs/planning-write-restriction.md).
- Keep stale BOM/inventory safeguards: loading, unavailable, fresh-but-missing, unresolved calculations and confirmed zero are different states. Do not suppress warnings by inventing parents, factors, mappings, units or stock.
- MES integration is proposed, not an established data source. Do not describe manual Actuals/OEE capture or read-only SYSPRO journal reads as a live MES connection.
- Do not commit, deploy, migrate databases, restart an operator's existing services, or change business data merely to update a handover. Follow the current user's authorized task scope.

## End every task

1. Recheck Git status and the relevant diff. Preserve pre-existing edits and distinguish the task's changes from the rest of the worktree.
2. Update `docs/PROJECT_STATUS.md` with the date, assistant, branch, what changed, where to find it, tests actually run and their results, outstanding verification, and the next concrete action. Include relevant uncommitted work and whether anything was committed, deployed, migrated, or verified against live data.
3. Update `docs/DECISIONS.md` when a lasting behavior or architectural decision changes. State its rationale, evidence, constraints, and unresolved questions. Preserve history; explicitly supersede an old decision rather than silently rewriting it.
4. Use these evidence labels consistently:

   - **Proposed:** not implemented or no implementation evidence found.
   - **Implemented locally:** present in the working tree; describe fixture/build coverage separately. Not a deployment claim.
   - **Live-verified:** a specific behavior was checked against the real named source; record date, scope, and limitations. Does not imply all UI workflows or a deployed release were verified.

5. For documentation-only work, validate links, accuracy, the diff and preservation of existing files. Do not claim historical application tests were rerun. Finish with a short handover pointing to the shared files and any remaining verification.

## Handover entry template

```text
Date / assistant / branch:
Scope and evidence status:
Changed / file locations:
Tests run now / results / live or synthetic data:
Not tested or still uncertain:
Relevant uncommitted work / commit or deployment state:
Next action:
```
