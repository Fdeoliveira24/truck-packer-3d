# PERFORMANCE_REPORT

## PASS H — Performance profiling summary

### Method
- Static hotspot analysis (`tools/tp3d-graph.json` churn map).
- Render-loop and disposal-path inspection in editor runtime.
- Lint scan for anti-pattern hints.

## Observations

### Hot files by churn-risk (from graph)
1. `src/app.js` (98)
2. `src/core/supabase-client.js` (53)
3. `src/ui/overlays/settings-overlay.js` (51)

### Render loops and cleanup
- Editor runtime starts RAF loop in `scene-runtime` (`src/editor/scene-runtime.js:202`, `src/editor/scene-runtime.js:411-417`).
- Loop short-circuits when not on editor screen (`src/editor/scene-runtime.js:413`).
- GPU/resource disposal present for materials/geometries/textures:
  - `src/editor/scene-runtime.js:528-543`, `src/editor/scene-runtime.js:791-792`
  - `src/screens/editor-screen.js:110-122`, `src/screens/editor-screen.js:259-266`

### Data-path safeguards added this cycle
- Import row count capped at 5000 and file size at 10MB (`src/services/import-export.js:20-22`, `103-124`).
- Ingest path re-validates dimensions before write (`src/services/import-export.js:208-216`).

## Risks and mitigations

### Risk A: Always-running RAF loop
- Evidence: `requestAnimationFrame(tick)` recurs unconditionally (`src/editor/scene-runtime.js:411-413`).
- Impact: background CPU wakeups remain possible even when not on editor screen.
- Current mitigation: early return when off-editor (`src/editor/scene-runtime.js:413`).
- Recommendation: future patch can pause/cancel RAF outside editor route for stricter battery usage.

### Risk B: High-complexity app bootstrap path
- Evidence: high churn concentration in `src/app.js` with many async branches.
- Impact: regressions likely in auth/org/billing transitions.
- Current mitigation: init single-flight + tests.

## Lint/perf-adjacent warnings
- `no-await-in-loop` warnings at `src/app.js:396` and `src/app.js:403` (intentional polling/retry behavior).
- No lint errors.

## Verdict
- Immediate blocking performance defects found: **No**.
- Residual optimization opportunities: **Yes** (RAF cancellation outside editor, warning cleanup).
