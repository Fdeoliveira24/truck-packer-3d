# Truck Packer 3D — Master TODO V6

**Last updated:** 2026-08-08
**Status:** Active operational roadmap.

---

## 1. Document Authority / Purpose

1. V6 is the current operational source of truth for Truck Packer 3D.
2. V5 (`TP3D-MASTER-TODO-V5.md`) is frozen/historical — do not use it to determine active work.
3. This document contains: current baseline, recently completed milestones, next approved milestone,
   approved near-term roadmap, deferred work, critical invariants, and technical-debt follow-ups.
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
| Last merge | PR #26 `chore(ai): add project memory retrieval integration` |
| Three.js runtime | `three@0.185.1` via npm/Vite (WebGLRenderer, r185.1) |
| Vite | `8.2.0` |
| Node requirement | `^20.19.0` or `>=22.12.0` |

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
| Business Identity (Phases 1 + UI) | Case `itemCode`, Load Plan `loadPlanNumber` / `customerReference`, identifier UI, Card Display | PR #14, #16 |
| Billing/Platform Foundation (Packets 1–3) | org INSERT boundary, server workspace limits, slug integrity, billing fixture harnesses, normalized entitlement | Multiple PRs through V5 |
| AutoPack Cleanup | Legacy solver removed, strategy differentiation audit, Max Capacity Phase C profile reporting | V5 milestones |
| Cargo Instructions (Phases 1–3) | Standard Instructions, Instance Notes, Pack Notes Editor access | V5 milestones |
| app.js P0 modularization | Billing/Org/Auth/AccountSwitcher extracted; app.js −27.8% (9,510 → 6,867 lines) | PR #7 |

---

## 4. Current Active / Next Milestone

| Field | Current value |
|---|---|
| Task | **Professional 3D Editor Visual Foundation** |
| Branch | To be created |
| Outcome | Approved direction — not yet started |
| Blocker state | Unblocked |
| Scope | Improve cargo box presentation, edges/lines, labels, materials, selection/hover clarity, contact cues, truck visual presentation, scene hierarchy. Professional visual consistency. **No renderer architecture rewrite.** |

---

## 5. Approved Near-Term Roadmap

Queue order is approval order. One active branch at a time. Update Section 4 when a branch opens.

1. **Professional 3D Editor Visual Foundation** ← NEXT
   - Cargo box presentation, edges/lines, labels, materials
   - Selection/hover clarity, contact cues
   - Truck visual presentation, scene hierarchy
   - Professional visual consistency
   - Do not rewrite renderer architecture

2. **Camera / View System**
   - Named viewpoints: Front, Rear, Left, Right, Top, Isometric
   - Orthographic / Perspective modes
   - Future: crew/loader view, cutaway, saved viewpoints

3. **Real 3D Heatmap + Legend**
   - Builds on finalized camera/view system
   - Extends Generic Space Utilization Engine

4. **PDF / Image Visualization Redesign**
   - Reuse camera outputs and visualization infrastructure

5. **Small 3D Visual Asset Spike** (GLB)
   - Test representative GLB assets before a full library
   - Representative cases: simple pallet, medium appliance, complex vehicle
   - Test at 1 / 25 / 100 / 300 counts

6. **Folder Sidebar Implementation**

7. **Load Plans / Stops / Unload Sequence**
   - Define sequencing/data model before Auto-Pack v2

8. **Auto-Pack v2 / Strategy Revisit**
   - Builds on finalized load/unload model

9. **Asset Manager + Curated Model Library**

10. **Measured Renderer Optimization**
    - Only after: GLBs, heatmap, richer visual scenes in production

11. **Expanded 3D World / Environment Work**

12. **Email Delivery / Sharing**

13. **Broader Shortcut / UI Consolidation**

14. **Settings Cleanup**

15. **Beta / Launch Hardening**
    - Sentry/observability before broad beta
    - Code and security review
    - Server/deployment review
    - Production hardening

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
| ⏭️ | Next approved (not yet started) |
| 📋 | Approved queue (not yet started) |
| 🔮 | Deferred — not yet approved |

---

## 11. Update Rules

1. Update the current baseline and active milestone row only at milestone closeout or real blocker-state change.
2. Keep the approved queue at 10–15 items maximum.
3. Replace stale status — do not append contradictory blocks.
4. Move detailed implementation reports and audit evidence to dedicated topic or archive documents.
5. Do not paste full implementation evidence here.
6. Do not promote deferred inventory to active queue without explicit approval.
7. When a milestone is closed, add a one-line concise summary with a PR link to Section 3.
8. Update `AGENTS.md` and `CLAUDE.md` references if V6 is superseded.
