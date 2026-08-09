# AGENTS.md — Truck Packer 3D

**Last updated:** 2026-08-08
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

## Pending Truck vs. Committed Truck

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
| App wiring / keyboard shortcuts | `src/app.js` |
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

- Report: files changed, why, risk level, lint/test results, manual checklist.
- Commands: `npm test`, `npm run lint`, `npm run -s typecheck`, `git diff --check`.
- Documentation-only changes: skip full test suite.
- Billing/workspace changes: full checklist — owner 1 workspace, owner multiple, non-owner member, same-tab switch, cross-tab switch, AutoPack gate, PDF gate, Settings Billing, Settings Members (if org scope touched).
- AutoPack lifecycle changes: verify all mutating paths blocked while busy, camera still usable, Truck Change preview only on explicit click, Cancel restores scene.

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

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

## Project Memory Routing (canonical)

- History / prior decision / "why did we" → `bash tools/project-memory query "<question>"`
- Code structure / ownership / "where is" → Graphify
- Current behavior → source and tests only
- Generic question → no retrieval
- Conflict: current source and current authoritative contract win over historical memory.
