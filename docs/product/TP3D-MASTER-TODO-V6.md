# Truck Packer 3D — Master TODO V6

**Last updated:** 2026-10-17
**Status:** Active operational roadmap.

---

## 1. Document Authority / Purpose

1. V6 is the current operational source of truth for Truck Packer 3D.
2. V5 (`TP3D-MASTER-TODO-V5.md`) is frozen/historical — do not use it to determine active work.
3. This document contains: current baseline, recently completed milestones, the current active milestone
   (if any), unapproved candidate workstreams, deferred work, critical invariants, and technical-debt
   follow-ups. A workstream is not active or approved until Section 4 names it.
4. Git history and project memory hold detailed implementation history. Do not paste full reports here.
5. Domain contracts win within their stated scope:
   - [Billing Entitlement Rules](./BILLING_ENTITLEMENT_RULES.md)
   - [AutoPack Engine Contract](../engineering/autopack-engine-contract.md)
6. Update at milestone closeout only. Replace stale status; do not append contradictory blocks.
7. `AGENTS.md`, `CLAUDE.md`, and `src/CLAUDE.md` define agent working rules and point here for status.

---

## 2. Current Baseline

| Field | Value |
|---|---|
| Repository branch | `main` |
| V6 creation baseline | `002c1f187b4a67fae6a1cbfde373c233f83d42f7` (snapshot at V6 creation; historical reference only) |
| Verified main at P2.5 start (2026-10-03) | `fe4bfe3be2b9a77b0d7ef9fc183fa08fd0ed15e3` — PR #95 merged; local `main` matched `origin/main` before branching |
| Last merge before P2.5 | PR #95 `cleanup: complete P2 legacy and dead code cleanup` |
| P2.5 implementation base | `test/p2-5-suite-ci-optimization` branched from that verified main; its PR and merge commit record the final P2.5 state |
| Three.js runtime | `three@0.185.1` via npm/Vite (WebGLRenderer, r185.1) |
| Vite | `8.2.1` |
| Node requirement | `^20.19.0` or `>=22.12.0` |
| Verified main after CI optimization (2026-10-17) | `a3c47f28c7930778771ac0806d398be22ed712a4` — PR #123 merged; main updated on GitHub |
| Quality Gate cost policy | One automatic full Quality Gate for PRs targeting `main`; optional manual `workflow_dispatch`; no automatic full run after merge/push to `main`. Focused local checks during implementation; documentation-only changes require diff/status checks, not application suites. |

---

## 3. Recently Completed Major Milestones

| Milestone | Key Result | PR / SHA |
|---|---|---|
| Quantity Controls | Ecommerce-style Case Qty, atomic Undo/Redo, multi-unit staging, Cases/Load Plans qty surfaces, PDF reporting, legacy cleanup | PR #20, `37d2c4c` |
| LLM QA Navigation Runbook | Runbook for AI-assisted QA navigation | PR #22 |
| Three.js npm/Vite migration | Migrated Three.js r160 from CDN/vendor to npm + Vite build pipeline | PR #23, `be62612` |
| Three.js r185.1 upgrade | Upgraded Three.js runtime from r160 to r185.1 | PR #24, `02ff0f7` |
| Space Utilization foundation | Initial Inspector gauge, editor card layout integration, capacity UI | PR #21, `7409b12` |
| Generic Space Utilization Engine | Engine extracted to generic spatial calculator; scale-only Inspector card (capacity-only, no arc gauge) | PR #25, `fc50d3c` |
| Project AI memory/retrieval infrastructure | `.ai/memory.json`, `tools/project-memory` CLI, Obsidian vault integration, Graphify routing | PR #26, `002c1f1` |
| Import/Export/Recovery | Completed import/export and recovery flows | PR #36, `dc5ff0b` |
| Font Awesome vendor packaging | Tracked required Font Awesome vendor CSS (fixed missing icon packaging) | PR #37, `794679d` |
| Debugger / MCP config cleanup | Removed obsolete debugger; ignored local MCP configuration | PR #38, `b5626ae` |
| Editor stabilization & polish sequence | Preview integrity (capture identity, freshness, image fidelity); Pack/camera view isolation; AutoPack Results synchronized with committed Pack; Export Integrity A/B/C; Editor accessibility/responsive safety; Case Browser filters; Editor regression cleanup; Professional Dropdown System; unified Focus/Selection visuals; Shortcut Contract cleanup + Keyboard Shortcuts resource | PR #74–#88, `59ed22e` |
| Business Identity (Phases 1 + UI) | Case `itemCode`, Load Plan `loadPlanNumber` / `customerReference`, identifier UI, Card Display | PR #14, #16 |
| Billing/Platform Foundation (Packets 1–3) | org INSERT boundary, server workspace limits, slug integrity, billing fixture harnesses, normalized entitlement | Multiple PRs through V5 |
| AutoPack Cleanup | Legacy solver removed, strategy differentiation audit, Max Capacity Phase C profile reporting | V5 milestones |
| Cargo Instructions (Phases 1–3) | Standard Instructions, Instance Notes, Pack Notes Editor access | V5 milestones |
| app.js P0 modularization | Billing/Org/Auth/AccountSwitcher extracted; app.js −27.8% (9,510 → 6,867 lines) | PR #7 |
| P2 — Legacy / Dead Code | Removed disconnected legacy modules and test-pinned dead code; retired the legacy Settings screen safely (`#/settings` now opens Settings → Preferences; "Reset demo data" removed); removed broken `lint:report` and unused `knip.json`; corrected stale active contracts; KEEP/DEFER registry in Section 8 | PR #93, PR #94, PR #95 |
| C5 stabilization | Scoped camera/orientation and staged Truck Change improvements; C5 packing-quality work remains paused | PR #117 |
| Editor CSS cleanup + Import / Export navigation | Consolidated layout styling and improved import/export access | PR #119 |
| Camera Phase 1 | Seven named Editor camera views, Fit Truck and interactive View menu | PR #120 |
| Camera Phase 2 | Interactive Perspective / Orthographic projection, per-Load-Plan camera metadata, Settings integration and export support; live PDF acceptance passed | PR #121 |
| Optional viewport Zoom Controls | Zoom In/Out for both projections; Settings On/Off visibility | PR #122 |
| Quality Gate cost optimization | Preserve PR and manual full gate; stop duplicate full runs after merge | PR #123 |

---

## 4. Current Active / Next Milestone

**Current status:** No feature implementation branch is authorized or active. Camera Phase 1, Camera Phase 2, and optional Editor Zoom Controls are complete and merged (PRs #120–#122). The owner accepted live PDF verification for Camera Phase 2 on 2026-10-17. PR #123 closed the duplicate full Quality Gate after merge.

### Owner-approved next sequence (planning order, not blanket implementation authorization)

| Order | Milestone | Intended outcome / contract to define | State |
|---|---|---|---|
| 1 | **Measurement Tool** | Interactive measurements of cargo, trailer dimensions, gaps and clearances in user-selected units. Specify point/edge selection, snapping, precision, temporary vs. saved measurements, and export visibility before coding. Measurement is informational, not transport-safety certification. | **NEXT — define and approve focused implementation contract** |
| 2 | **Annotations: Text and Drawing** | Add notes/labels and graphical marks/arrows independently of cargo geometry. Define anchoring, editing, storage, visibility, permissions, and screenshot/PDF inclusion before coding. Text and Drawing can be scoped into small releases. | **PLANNED — after Measurement** |
| 3 | **PDF Construction / Interactive Export Preview** | Clicking **Export PDF** opens a document-construction screen showing the proposed PDF. Users can modify the presentation/layout and content before selecting the final **Export PDF** action. Specify available editing, page reordering/layout, accurate print preview, templates/persistence, billing gates, and export safety in its product contract. Do not mutate cargo data by editing the document. | **PLANNED — after Annotations** |

**Removed from roadmap:** Zoom to Area / Magnifying Glass. Do not implement or propose it as part of Zoom Controls or the Measurement Tool.

**Owner sequencing:** Finish Measurement first, then Annotations (Text and Drawing), then PDF Construction. Each phase requires its own scoped acceptance and release checkpoint. Do not bundle these into a single implementation branch.

**Held work:** C5 AutoPack quality and related follow-ups are **PAUSED** due to unresolved load realism/transport-quality concerns. C6 reporting is **DEFERRED**. No changes to separate stabilization, Claude visual, or Codex visual worktrees are authorized.

---

## 5. Candidate Workstreams (Unapproved)

These are unapproved candidates outside the owner-approved sequence in Section 4. No candidate is an active implementation merely because it appears here. Items remain subject to individual product decisions and owner authorization; the sequence in Section 4 takes precedence.

1. **Professional 3D Editor Visual Foundation**
   - Cargo box presentation, edges/lines, labels, materials; selection/hover clarity, contact cues; truck visual hierarchy
   - Do not rewrite renderer architecture
   - **Reverted:** PRs #29, #31, and #33 were rejected and reverted in PR #34 (`6c305fc`); no restart without explicit owner approval

2. **PDF / Image Visualization Polish**
   - Optional future image/report styling beyond the already planned **PDF Construction / Interactive Export Preview** workflow in Section 4
   - Do not start a competing PDF export redesign before that product contract is settled

3. **Small 3D Visual Asset Spike (GLB)**
   - Test representative GLB assets before a full library: simple pallet, medium appliance, complex vehicle
   - Test at 1 / 25 / 100 / 300 counts

4. **Folder Sidebar Implementation**

5. **Load Plans / Stops / Unload Sequence**
   - Define sequencing/data model before Auto-Pack v2

6. **Auto-Pack v2 / Strategy Revisit**
   - Builds on a finalized load/unload model; remains held with C5

7. **Asset Manager + Curated Model Library**

8. **Measured Renderer Optimization**
   - Only after GLBs and richer visual scenes are available for realistic measurements

9. **Expanded 3D World / Environment Work**
   - Includes future 3D realism work, subject to explicit design approval

10. **Email Delivery / Sharing**

11. **Broader Shortcut / UI Consolidation**

12. **Settings Cleanup**

13. **Beta / Launch Hardening**
    - Observability, code/security audit, deployment/server review and production readiness before broad beta

14. **Real 3D Heatmap + Legend — LOW PRIORITY / NEAR LAST**
    - Optional visual enhancement, not required for core logistics planning
    - Postpone until **after 3D realism and richer scene presentation**
    - If later approved, build on the Generic Space Utilization Engine; capacity analysis only, not safety/compliance scoring

**Completed, not a candidate:** Camera / View System (PRs #120–#121) and optional Zoom Controls (PR #122).

---

## 5.5. Phase C — Editor Authority & Workflow Continuity (C5 Cycle)

**Status:** Locked product contract; C5A merged (PR #111). PR #117 merged scoped C5 stabilization changes. **C5 further implementation is PAUSED by explicit owner decision.** The prior C5B review state below is historical only; it does not authorize resumption.

### Phase C Milestones

| Phase | Title | Status | Approved Order | Key Outcomes |
|---|---|---|---|---|
| C1 | Canonical Source Semantics | ✅ COMPLETE / MERGED | 1 | Canonical mass, orientation and physical-input primitives |
| C2 | Shared Measurements + Assessment Core | ✅ COMPLETE / MERGED | 2 | Support geometry, load transfer and shared assessment/eligibility semantics |
| C3 | Mass + Orientation Runtime Cutover | ✅ COMPLETE / MERGED | 3 | Runtime adoption of canonical mass/orientation semantics |
| C4 | Assessment + Lifecycle Cutover | ✅ COMPLETE / MERGED | 4 | Read-only assessment and removal of hidden lifecycle repair |
| C5-0 | Editor Authority Contract | 🔒 LOCKED | — | Documentation checkpoint (this update) |
| C5A | Normal AutoPack Assessment + Results/Apply Authority | ✅ COMPLETE / MERGED (PR #111) | 5 | Candidate assessment, Balanced preference, transient Results authority and Apply |
| C5B | Staging Preservation + Inspector Coherence | ⏸️ PAUSED / HISTORICAL REVIEW STATE | 6 | Previous local work/review notes are not current implementation authorization; preserve existing branches/worktrees |
| C5M | Manual Editor Authority Hardening | ⏸️ PAUSED | 7 | Manual drag/move/rotate/stage/unstage and warning-vs-hard-rule boundary |
| C5T | Truck Change Workflow Continuity | ⏸️ PAUSED | 8 | Unresolved cargo preservation/fallback-to-staging without workflow blockage |
| C5C | Max Capacity Policy | ⏸️ PAUSED | 9 | Preserve relaxed Max handling with profile-aware assessment and Apply |
| C5D | Packing Quality + Wheel-Well Search | ⏸️ PAUSED | 10 | Avoidable-gap recovery, leftover-fit search and Wheel-Well seam competition |
| C5E | Bounded AutoPack Presentation | ⏸️ PAUSED | 11 | Adaptive bounded loading presentation without persistence authority |
| C6 | Reporting + Integrated Closure | 🔮 DEFERRED | 12 | Reporting, integrated validation and Phase C closure; not approved for current work |

**C5D recorded transport-realism finding:** Normal AutoPack can produce tall exposed stack faces without meaningful longitudinal blocking. Balanced optimizes packing/layout heuristics but does not establish truck-wide braking restraint or complete transport securement. C5D should investigate passive restraint and layout realism without claiming to certify tiedowns, friction, load bars or regulatory securement. This is recorded for future investigation; C5A introduces no transport-restraint solver behavior.

### C5-0 Product Contract (Locked)

See [AutoPack Engine Contract — Editor Authority and Automation Boundary](../engineering/autopack-engine-contract.md#editor-authority-and-automation-boundary) for the full contract.

**Core Principle:** Cargo Planner 3D is a manual load-planning workspace first. AutoPack is an assistant, not an override.

- Manual Editor is user-authoritative.
- AutoPack is assistant/recommendation.
- Hard physical geometry remains enforced for new manual placement.
- Handling/planning rules generally assess/warn rather than block manual editing.
- Manual VALID/INCOMPLETE/INVALID layouts may remain saved.
- Assessment does not grant/revoke editing permission.
- No silent repair.
- Missing definitions degrade physical certainty, not workflow availability.
- Untrusted unresolved cargo falls back to staging during geometry changes.
- Future load/unload sequence remains manually overridable.
- Automated solutions may be stricter than manual authoring.

### C5M Manual Editor Findings Registry

| ID | Finding | Status | Notes |
|---|---|---|---|
| M-01 | Manual drop may commit collision/occupied-space problems | RETAIN | Focused C5M verification required |
| M-02 | Staged cargo sometimes refuses an apparently valid truck-floor drop | RETAIN | User-observed; latest controlled QA did not reliably reproduce; do not rewrite drag architecture speculatively |
| M-03 | Manual action sometimes receives unrelated vertical-move messages | RETAIN | User-observed; latest controlled QA did not reproduce; investigate when reproducible |
| M-04 | AutoPack planning state must never become a permanent manual movement restriction | 🔒 LOCKED | Product invariant |
| M-05 | Handling rules should evaluate manual layouts, not generally block authoring | 🔒 LOCKED | Product decision |
| M-06 | Impossible physical geometry remains blocked | 🔒 LOCKED | Product decision |
| M-07 | Manual INVALID/INCOMPLETE layouts remain editable and saveable | 🔒 LOCKED | Product decision |

### Execution Notes

- C5A merged through PR #111 and scoped C5 stabilization merged through PR #117. Earlier C5B local-implementation notes are superseded by the owner's pause; do not resume from an old worktree or branch without renewed approval. Keep C5M and C5T separate.
- C5M owns manual drag/move/rotate/stage/unstage authority and handling rules warning behavior.
- C5T owns unresolved cargo preservation and fallback behavior.
- **No C5 implementation is currently authorized.** C5B/C5M/C5T/C5C/C5D/C5E require new explicit owner approval; C6 remains deferred.

---

## 6. Deferred / Future Work

Not approved branches. Not active work. Require focused audits and product decisions before implementation.

- Next-generation billing hardening (workspace-to-Stripe identity, cross-table consistency, billing anomaly logging)
- Workspace Slug Phase 2 (friendly slugs, owner-editable, routing)
- Pack Publishing / Crew View / Share Links
- Server-backed packs/cases and conflict-safe sync
- Business Identity server-persistence uniqueness contract
- Workspace-level analytics and telemetry
- Platform-admin schema and audit records
- CoG / axle / crush / DOT weight-distribution (requires explicit safety contracts)
- Deployment: Cloudflare Pages, branch previews, staging, rollback policy
- Product decisions still open: consolidated billing, one Customer per workspace vs. shared, final commercial plans

---

## 7. Critical Architecture Invariants

### Billing

- Stripe is payment truth. `/billing-status` is application entitlement truth.
- Normalized `entitlementStatus` only — never overload raw `status`.
- Valid states: `active`, `trialing`, `trial_expired`, `included_in_plan`, `workspace_limit_reached`, `owner_subscription_required`, `billing_unavailable`.
- Owners only for checkout, portal, plan, and payment.
- Do not gate owner inheritance on `ownerUserId !== currentUserId`.

### Development / CI Cost Policy

- Full Quality Gate runs automatically on PRs targeting `main`; optional manual dispatch is available. No automatic full suite after merging/pushing to `main` (PR #123).
- During implementation, use directly affected focused tests, typecheck as appropriate, and diff/status inspection. Do not duplicate broad local and GitHub CI runs.
- Documentation-only updates require diff review and whitespace/status checks, not application test suites.

### AutoPack / Editor

- Use `src/core/operation-lifecycle.js` for all mutating editor operations.
- Large-load snap: `> 300` packed placements — performance guard, not final solution.
- Wheel Wells wider-than-shelf and Front Overhang C2 require explicit safety contracts before implementation.
- Final saved state must never depend on animation completion.
- Camera orbit/pan/zoom must remain usable during operations.

### Space Utilization

- **Capacity analysis only:** occupied %, remaining space, density visualization.
- Not safety scoring, not compliance scoring, not weight-distribution quality.
- Internal diagnostics must not become user-facing scores without a future explicit product decision.

### 3D Architecture

- Direct Three.js + WebGLRenderer, currently r185.1 via npm/Vite.
- No React/R3F rewrite. No WebGPU migration now.
- Future addons via `three/addons`.
- GLB architecture (when introduced): authoritative packing envelope is always separate from optional visual model. Visual model never becomes collision truth by default. Keep technical-box fallback.

### Backend / Persistence Direction

- Supabase remains the temporary development backend for identity, workspaces, and billing.
- Cases, Load Plans, and related business data remain browser-local during this development phase.
- NoCodeBackend (NCB) remains the preferred future migration target. A September 2026 investigation found NCB could be viable, but the migration is paused, not canceled, so product, domain, email, billing, settings, and workspace-behavior work can be completed first — see [NCB Migration Investigation — Paused](../archive/2026-09-ncb-migration-paused/README.md).
- No active backend migration branch exists. A future migration must repeat the provider and source audit against the application state at that time. This entry does not authorize migration implementation.

### Data and Identity

- Customer-facing object name: **Load Plan** (not "Pack").
- Internal architecture: `PackLibrary`, `pack`, `pack.id`, DOM ids, CSS classes, storage keys, route identifiers, JSON schema unchanged.
- Auto-Pack, Unpack, packed item, packing rules vocabulary preserved.
- "Cargo Planner 3D" is the provisional product name — not yet applied in UI. Final branding deferred to launch prep.

---

## 8. Technical Debt / Security Follow-ups

- `.claude/settings.local.json` — git-ignored, previously flagged as potentially containing credential-bearing commands. Do not print or modify during normal sessions. Dedicated security/credential cleanup required before broad beta.
- Development retains legacy schema differences (cases/packs, policy/function, billing ID). Separate audit required.
- Workspace Slug Phase 2 (friendly slugs) remains required product work.
- `docs/product/PROJECT_TREE.md` is a point-in-time snapshot (2026-07-16) — no active authority.
- Graphify: run `graphify update .` after significant code changes. Do not hardcode node/edge counts in permanent instructions.

### P2 — Legacy / Dead Code: COMPLETE (2026-10)

Confirmed dead ordinary code is removed, test-pinned dead code is removed, the duplicate legacy Settings screen is retired safely, broken unused tooling is removed, and materially stale active contracts are corrected. The registry below records what remains on purpose so future audits do not reopen it. Provider/persistence and rendering cleanup are **not** complete; they are assigned to their own phases.

**Intentional KEEP (not dead code):**

| Item | Reason |
|---|---|
| `getCurrentAuthKey`, `debugAuthSnapshot`, `getMyMembership`, `getCurrentOrganization`, and the documented test/admin exports published via `window.__TP3D_SUPABASE_API` / `__TP3D_SUPABASE` / `SupabaseClient` | Public/debug/backward-compat surface; no in-repo caller is not proof of no consumer |
| `src/packing-core/{index,domain,space-model,orientation}.js` | Intentional, tested Phase-5 architectural boundary; do not delete as orphans |
| `src/core/utils.js` | Still has live production and test consumers |
| `vendor/three.module.js` (r160) | Intentional documented test fixture; production Three is npm r185 (`src/bootstrap/three-runtime.js`) |
| Browser harness `esm.sh` / `skypack` abort route (`tests/behavioral/app-js-browser-harness.mjs`) | Guards against accidental reintroduction of CDN Three loading |
| Storage legacy v1 migration (`src/core/storage.js`) | Backward compatibility for old persisted data |
| Retired HTTP 410 Edge Function tombstones (`supabase/functions/*`) | Provider/external endpoint compatibility; frontend call-graph absence does not prove no external caller |
| Constant-false auth/provider flags (e.g. `AUTH_GUARD_*_ENABLED`) | Explicit dormant provider gates; provider/persistence scope |
| Persisted `preferences.spaceUtilization` compatibility fields | Old backups/imported preferences may still carry them |

**Explicit DEFER (not dead-code cleanup):**

| Item | Owner |
|---|---|
| AccountOverlay module/lifecycle (the old opener is removed; auth-transition `close()` / `handleAuthChange` wiring remains) | Future auth/provider cleanup |
| `getSessionRawSingleFlight` and related auth internal state / string probes | Provider/persistence cleanup |
| Legacy `BillingService` compatibility helper object (`src/data/services/billing.service.js`) | Billing/provider cleanup |
| `readJson` / `writeJson` / `removeKey` (`src/core/storage.js`; may have no ordinary callers now) | Provider/persistence/recovery cleanup |
| DevOverlay (`src/editor/scene-runtime.js`) | Rendering phase |
| CoG visual marker / `updateCoG` | Rendering / future CoG safety work |

---

## 9. AI Memory Infrastructure

```
Config:    .ai/memory.json
CLI:       bash tools/project-memory query|record|promote "<text>"
Vault:     Truck-Packer-3D Obsidian Markdown vault (path in .ai/memory.json)
```

- `query` — retrieval works without a semantic memory graph (exact-match by default).
- `record` — record meaningful completed milestones.
- `promote` — promote durable Decisions, Lessons, or Problems.
- Semantic Graphify indexing of the memory vault is optional and requires an external LLM API key.

---

## 10. Status Legend

| Symbol | Meaning |
|---|---|
| ✅ | Complete and merged to main |
| 🔄 | In-progress / active branch |
| ⏭️ | Next milestone (explicitly approved by the user) |
| 📋 | Candidate workstream (unapproved, not yet started) |
| 🔮 | Deferred — not yet approved |
| 🔒 | Locked product contract / decision |

---

## 11. Update Rules

1. Update the current baseline and active milestone row only at milestone closeout or real blocker-state change.
2. Keep the candidate workstream list at 10–15 items maximum.
3. Replace stale status — do not append contradictory blocks.
4. Move detailed implementation reports and audit evidence to dedicated topic or archive documents.
5. Do not paste full implementation evidence here.
6. Do not promote deferred inventory to active queue without explicit approval.
7. When a milestone is closed, add a one-line concise summary with a PR link to Section 3.
8. Update `AGENTS.md` and `CLAUDE.md` references if V6 is superseded.
