# AGENTS.md — Truck Packer 3D

**Last updated:** 2026-10-17
**Project:** Truck Packer 3D / Cargo Planner 3D — 3D cargo logistics planning application.

---

## Authority Hierarchy

1. **Current source + tests** — definitive truth about current implementation.
2. **Domain contracts** — `docs/product/BILLING_ENTITLEMENT_RULES.md`, `docs/engineering/autopack-engine-contract.md`.
3. **V6 roadmap** — `docs/product/TP3D-MASTER-TODO-V6.md` — current operational status and approved queue.
4. **Project memory** — history, rationale, prior decisions: `bash tools/project-memory query "<question>"`.
5. **Graphify** — code structure index only, not authority.
6. **Git history** — implementation evidence.

Conflicts: current source + tests win. V6 wins over V5 and all older plans. Domain contracts win within their stated scope.

---

## Working Rules

1. **Keep changes surgical.** Do not broaden scope without a clear reason.
2. **Inspect before edit.** `git status -sb` and `git diff --name-only` first. Confirm clean state.
3. **No refactor mixed with behavior changes** unless the bug fix requires it.
4. **No new files unless explicitly requested** or clearly required.
5. **Do not rewrite working architecture** because it is large or imperfect.
6. **Backend leads billing.** Do not change billing semantics in UI first.
7. **Use `/billing-status` for entitlement truth.** Do not guess from local state.
8. **Preserve workspace switch safety.** No stale org, billing, member, invite, editor, or preview leakage.
9. **Treat auth, billing, org switching, cross-tab state, and storage as P0 risk.**
10. **Owners only for money actions.** Checkout, portal, plan, and payment are owner-only.
11. **Do not remove existing safety guards** unless a proven bug requires replacement.
12. **Do not hide data/state bugs with UI polish.** Fix the lifecycle first.
13. **Stop on unexpected dirty state.** Never `--force` push, `reset --hard`, or drop unrecognized work.
14. **Protect production/Supabase data.** Never use it as a fixture.

---

## Retrieval Routing

| Question type | Use |
|---|---|
| History / prior decision / "why did we" | `bash tools/project-memory query "<question>"` — up to 3 short passages |
| Code structure / ownership / "where is" | `graphify query/path/explain` against `graphify-out/graph.json` |
| Current behavior | Read source and tests directly |
| Generic programming question | No retrieval — use general knowledge |

Never inject full `graph.json`, `GRAPH_REPORT.md`, or entire vault folders.
Current source wins over stale memory or Graphify results.

---

## Memory

- **Record meaningful completed work:** `bash tools/project-memory record`
- **Promote durable Decisions/Lessons/Problems only:** `bash tools/project-memory promote`
- Do not record trivial changes. Do not produce many notes merely because the tool exists.

---

## Billing Invariants

- Stripe is payment truth. `/billing-status` is application entitlement truth. `billing_customers` is a projection, not the only truth.
- Use normalized fields: `entitlementStatus`, `workspaceIncluded`, `workspaceCount`, `workspaceLimit`, `billingOwnerUserId`, `canManageBilling`. Never overload raw `status`.
- Valid `entitlementStatus` values: `active`, `trialing`, `trial_expired`, `included_in_plan`, `workspace_limit_reached`, `owner_subscription_required`, `billing_unavailable`.
- Do **not** gate owner inheritance on `ownerUserId !== currentUserId`.
- Frontend gates must use normalized entitlement, not raw payment rows.

---

## AutoPack + Operation Lifecycle Invariants

- Large-load snap threshold: `> 300` packed placements — a performance guard, not a final solution.
- Wheel Wells: wider-than-shelf cases require an explicit bridge/support contract before implementation.
- Front Overhang: C2 requires rear retention before loading the raised deck.
- AutoPack, Unpack, Truck Change, and preview capture are mutually disruptive — use `src/core/operation-lifecycle.js`.
- Guard **all** mutating paths: toolbar, keyboard shortcuts, drag, rotate, nudge, delete, add, paste.
- A stale operation token must not overwrite a newer operation.
- Do not fake cancel or live-progress that the synchronous solver cannot honor.
- Final saved state must never depend on animation completion.
- Do not block camera orbit/pan/zoom unless a specific bug requires it.

---

## Editor Authority and AutoPack Assistant Model

**Cargo Planner 3D is a manual load-planning workspace first. AutoPack is an assistant, not an override.**

- The 3D Editor is manually authoritative. The user owns the arrangement.
- AutoPack is assistant/recommendation. Results are suggestions, not authority over the Editor.
- Hard physical geometry remains enforced for new manual placement (truck/container boundaries, collision, Wheel Wells, Front Overhang, unsupported placement).
- Handling, planning, and assessment rules must generally WARN or ASSESS rather than prevent ordinary manual authoring (no-top-load, heavy-on-bottom, stack preferences, handling preferences, grouping, loading priority, future sequence, orientation metadata).
- Manual VALID, INCOMPLETE, and INVALID layouts may remain saved. No silent repair on open/save/reload.
- Assessment does not grant/revoke editing permission.
- Missing Case definitions reduce physical certainty, not workflow availability. Unresolved cargo falls back to staging rather than stopping the workflow.
- Future load/unload sequence must remain manually overridable. Sequence can constrain AutoPack more strongly than manual editing.
- Automated solutions may be stricter than manual authoring.

See [docs/engineering/autopack-engine-contract.md — Editor Authority and Automation Boundary](./docs/engineering/autopack-engine-contract.md#editor-authority-and-automation-boundary) for the full contract and [docs/product/TP3D-MASTER-TODO-V6.md — Phase C (C5-0)](./docs/product/TP3D-MASTER-TODO-V6.md#55-phase-c--editor-authority--workflow-continuity-c5-cycle) for execution status.

---

## Measurement Tool V1 Invariants (approved contract, revised 2026-10-17; implementation visually approved 2026-10-18)

Full contract, acceptance gates and stages: [docs/product/TP3D-MASTER-TODO-V6.md — Section 4.1](./docs/product/TP3D-MASTER-TODO-V6.md#41-measurement-tool-v1--approved-contract). The implementation is on the branch and locally validated, with specs pinning G1–G6 (`tests/audit/measurement-tool-*.spec.mjs`). Status: implementation visually approved and locally validated; GitHub Quality Gate and final merge approval pending.

- The Measurement Tool is an illustrative, informational ruler. It never moves cargo and never influences placement, collision, handling rules, assessment, Space Utilization, AutoPack or the existing PDF. Not a clearance or safety/compliance feature.
- Measurements belong to one Load Plan (`pack.measurements`, max 100, canonical inches). The distance is derived, never stored.
- A point can be placed on anything visible: any cargo surface (any shape; stored as a local point + **instance ID** + geometry signature), the truck floor/walls/ceiling, and the ground anywhere. Floor points are revalidated by geometry; truck-shell points flag Needs Review if the truck changes; nothing is ever relocated.
- Never silently delete, relocate or substitute an anchor: an unresolvable measurement stays stored and visibly flagged. The only way an anchor changes is the owner's deliberate endpoint drag onto a supported surface (`PackLibrary.moveMeasurementEndpoint`): it is a measurement-only edit (`lastEdited`, no cargo Undo entry), it never moves, rotates, stages or selects cargo, and Escape, pointer cancel, a drop on nothing, a blocking operation or leaving the plan restores the original and writes nothing.
- One Escape press exits Measurement Mode completely through the regular `exit()` routine (dropping an unfinished point or endpoint drag without writing; saved measurements stay) and is consumed in the capture phase. A modal, dropdown, text field or the load-status popover that owns Escape keeps it; with the mode off Escape is unchanged. Focus never goes to the ruler (it returns to the viewport, with no focus frame after mouse use). Cargo keys, including Delete, still act on the cargo selection; a gesture that loses its cargo is cancelled by `sync()` and writes nothing.
- Measurements are read-only only while AutoPack, Unpack, Truck Change, a Truck Change preview or a transient AutoPack preview is active, and the message names that cause. A background thumbnail capture is a pixel readback, not an edit: it must never block measurements or cancel an unfinished one. Only a single distance is shown (no L/W/H).
- A malformed stored measurement record is never silently dropped and then overwritten by autosave: preserve it, surface a recovery condition, block destructive persistence until resolved.
- Cargo Undo/Redo preserves the current measurements and must not roll back `lastEdited` solely because measurement edits are excluded from cargo history.
- A generic object spread is not persistence. `normalizePack` is a field whitelist; history, duplicate/import ID remap, export/backup projection and validation, and capture exclusion each need explicit handling (V6 §4.1 gates G1–G6).

---

## Workflow Continuity Invariants

- Form state changes update pending state only — do not update the 3D scene until confirmed.
- The Truck Change preview opens only on explicit **Update truck** click.
- Cancel/X/Escape restores the committed truck, scene, and form state.

---

## Space Utilization — Product Contract

Space Utilization is **capacity analysis only**: occupied percentage, remaining space, density visualization. It is not a safety score, compliance score, weight-distribution quality score, or load-quality rating. Internal diagnostics must not become user-facing scores without an explicit future product decision.

---

## 3D Architecture Direction

- **Direct Three.js / WebGLRenderer** — currently r185.1 (`three@0.185.1` via npm/Vite).
- No React/R3F rewrite. No WebGPU migration now. Future addons via `three/addons`.
- GLB architecture (future): authoritative packing envelope (dimensions, collision, AutoPack) is separate from optional visual model (GLB representation). Visual model never becomes collision truth by default. Keep technical-box fallback.

---

## File Ownership

| Area | File(s) |
|---|---|
| App wiring | `src/app.js` |
| App-level keyboard shortcuts | `src/ui/keyboard-manager.js` |
| Viewport cargo keys (R/T/E/F, arrows, Alt vertical, Enter/Esc holds) | `src/screens/editor-screen.js` (InteractionManager) |
| Editor UI / AutoPack/Unpack/Truck controls | `src/screens/editor-screen.js` |
| AutoPack orchestration | `src/services/autopack-engine.js` |
| Solver geometry | `src/services/autopack-solver.js` |
| Truck-change flow | `src/ui/truck-change-controller.js` |
| Operation lifecycle lock | `src/core/operation-lifecycle.js` |
| Settings / billing UI | `src/ui/overlays/settings-overlay.js` |
| State, session, storage, events | `src/core/*` |

Prefer the owner layer for bugs. Do not broaden scope beyond the owning file(s) without approval.

---

## Testing

**During implementation:**
- Run directly affected focused tests only (normally 1–3 focused files or tight patterns)
- Do NOT run the complete local Node suite
- Do NOT run the complete local browser suite
- Do NOT run npm run test:ci:node or npm run test:ci:browser
- Do NOT run npm run quality:ci as routine local validation
- Do NOT repeat broad local + CI coverage

**Before push:**
- Directly affected focused tests
- `npm run -s typecheck`
- `git diff --check`
- Inspect git diff / git diff --stat
- Lint/build only when the production change warrants them

**GitHub:**
- The full Quality Gate owns broad regression coverage
- Run it once per finished reviewable PR/checkpoint
- If CI fails, diagnose reported failures with focused local reproduction
- Do not respond to CI failure by blindly running every suite locally

**Browser:**
- One narrowly defined manual acceptance scenario per checkpoint when relevant

**Documentation-only:**
- `git diff --check`
- Diff/status inspection
- No application test suite required locally

Human QA can veto merge even if CI is green.

**Report:** files changed, why, risk level, focused test results, manual checklist.

---

## Graphify Navigation

Query: `graphify query "<question>"` when `graphify-out/graph.json` exists.
Path: `graphify path "<A>" "<B>"` for relationships.
Explain: `graphify explain "<concept>"` for focused concepts.
Browse: start with `graphify-out/wiki/index.md`.
Update: `graphify update .` after significant code changes (AST-only, no API cost).

Do not read `graph.json` or `GRAPH_REPORT.md` wholesale.
Do not hardcode graph node/edge counts into permanent instructions — they are diagnostic snapshots.

---

## Project Memory Routing (canonical)

- History / prior decision / "why did we" → `bash tools/project-memory query "<question>"`
- Code structure / ownership / "where is" → Graphify
- Current behavior → source and tests only
- Generic question → no retrieval
- Conflict: current source and current authoritative contract win over historical memory.
