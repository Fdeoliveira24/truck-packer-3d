# P0 Domain Module Contract — Independent Review

**Reviewer stance:** Adversarial second engineer. Goal: break the contract before implementation does.
**Subject:** `docs/engineering/p0-domain-module-contract.md`
**Verdict up front:** The contract is sound in its ownership model and correctly resolves the two prior blockers (mutual coupling; AccountSwitcher via inter-module-private accessors). The three points I flagged as not-yet-airtight have now been closed by the gate-closure phase (see **Gate-closure disposition** at the end). Updated verdict: **concur with SAFE TO BEGIN.**

## 1. Contradictions found

- **`getActiveOrgIdForBilling` — injected vs. global-reading.** Audit 3 lists it as an *injected* accessor into Billing; Audit 15 says it stays "in app.js." Source reality: `getActiveOrgIdForBilling()` is a **module-top-level function (app.js:936) that reads `window.OrgContext.getActiveOrgId()`**. The contract must pick one and state it: **recommended — leave `getActiveOrgIdForBilling` as-is reading the `window.OrgContext` global** (zero change, already decoupled), rather than inject an org accessor into Billing. Injecting would be gratuitous churn. This inconsistency is minor but must be resolved in the frozen text before Stage 1, or the implementer will invent a boundary.

## 2. Unsupported assumption (highest-priority finding)

- **The billing→org readiness callback direction is asserted, not proven.** The contract freezes "Billing calls `OrgContextModule.markWorkspaceSwitchBillingReady(snapshot)` on settle." But `markWorkspaceSwitchBillingReadyIfSettled` is currently an **org-band** function (4780); its **actual current caller was not traced**. If today it is invoked *from within the billing subscriber path / `applyAccessGateFromBilling`*, the extracted direction (billing→org) is correct. If it is invoked *from org subscribing to billing* (`subscribeBilling`), the direction is org←billing and the callback name/owner differ. **Mandatory before Stage 2:** trace every current call site of `markWorkspaceSwitchBillingReadyIfSettled` and `applyAccessGateFromBilling`/`_billingGateApplier` setter, and confirm the callback direction. Freezing the wrong direction risks a readiness-ordering regression that browser tests may not deterministically catch.

## 3. Missing / under-specified

- **`_billingGateApplier` current setter is unspecified.** The contract says "root supplies the gate applier" but does not identify who sets it today. Confirm the current assignment site and whether it targets an org/UI function; the late-bind `setBillingGateApplier` must reproduce it exactly.
- **`renderAuthState` reads more than `orgContext.activeOrgId`.** Only one read (7238) was cited; `init` reads `orgContext.role`/`.activeOrgId` at 3 sites (8262/8376/8752). All are field reads, so `getOrgContextSnapshot()` copy is safe — but the contract should enumerate all reader sites in the Stage-2 brief so none is missed during re-pointing.
- **Stale browser baseline.** The browser characterization suite was **deferred through EU-04/05/07/08**; the last confirmed green browser run was at the M2 consolidation (`faaba81`), not at current `4f83c32`. **Mandatory before Stage 1:** run the browser suite once on the *current pre-extraction* HEAD to establish the green baseline. Without it, a Stage-1 regression cannot be distinguished from a pre-existing M4-era issue. The contract's Audit 14 understates this by saying "no behavior entirely uncharacterized" — true, but the characterization has not been *executed* against current HEAD.

## 4. API overexposure

- **`getOrgContextSnapshot()` exposes the full `orgs` array + `activeOrg` object.** This is a broad read surface (whole workspace list), justified only by future AccountSwitcher. Acceptable **because it is inter-module/root-private, not a browser global**, and it returns a copy. But: confirm nothing outside AccountSwitcher/`init`/`renderAuthState` needs it, and keep it off `window.OrgContext`. If only scalar fields are ever read, prefer several scalar accessors over one broad snapshot — but the snapshot is acceptable given AccountSwitcher iterates `orgs`.

## 5. Cyclic dependency

- **No static import cycle** (modules import only `src/core/*` + services; app.js imports the three factories; modules never import app.js or each other). Confirmed sound.
- **Runtime mutual reference Org↔Billing is real** and resolved by two-step late-binding + null-guards. This is load-bearing: if Step B binding is skipped or a callback fires before binding, `onBillingSettled`/`getBillingState` could be undefined. The existing `_billingGateApplier` null-guard pattern must be applied to *every* injected callback. **Verify** each late-bound call site is null-guarded, matching current defensive style.

## 6. Ordering risks

- **Billing created at module-eval (2103) before `window.OrgContext` exists (5382).** Billing's `getActiveOrgIdForBilling` reads `window.OrgContext` — safe only because it is not *called* until post-init. The contract's two-step wiring preserves this, but the implementer must not call any billing method that reads org during Step A. Flag explicitly in the Stage-1 brief.
- **`_executeSignedOutCleanup` step 10** currently does `orgContextResolved = false` *after* `clearOrgContext` (step 5). If `clearOrgContext` already sets resolved=false internally, the explicit `markOrgContextUnresolved()` is redundant but harmless — preserve both to avoid behavior change. Confirm `clearOrgContext`'s current effect on `orgContextResolved`.

## 7. Identity / reference risks

- **Resolved correctly.** `getBillingState()` copy semantics (971) are confirmed; `getOrgContextSnapshot()`/`getWorkspaceSwitchState()` as copies are consistent with current shapes. The one residual: confirm **no external reader holds a returned snapshot across an async boundary expecting it to mutate live** — a copy would silently go stale. The ~23 org reads and 6 billing reads are synchronous field reads (no retained references found), so this is low risk, but the Stage-2/Stage-1 briefs must assert it per-site.
- **`refreshBilling` wrappability** is correctly flagged; the module must place the actual function object on the facade (no `.bind()`), or debugger wrapping breaks silently.

## 8. Test gaps

- Concur with the two mandatory-before-Stage-1 pins (facade member-set + `getBillingState` copy; `refreshBilling` wrappable).
- **Add:** a pin that `window.OrgContext` has *exactly* its 4 members after extraction (guards against accidental exposure of `handleWorkspaceLeft`/`handleOwnershipTransferred`/`notifyOrgAccessLoss`).
- The DEF-011 `isCurrent()` check-order is only source-pattern-tested; the browser suite exercises stale-context-no-nav behaviorally. Adequate, but the Stage-1 browser subset must include both owner and non-owner and a forced stale context.

## 9. Staging plan safety

- **Billing-first is correct.** Rationale in the contract holds: billing is module-top-level, already accessed via `getBillingState()` copy and the `window.OrgContext` global, so its extraction changes the fewest external reads. The Stage-1 `onBillingSettled` callback pointing at the still-in-app.js `markWorkspaceSwitchBillingReadyIfSettled` is **not a prohibited temporary bridge** — it is the permanent callback whose target relocates in Stage 2; the callback contract is stable. Confirmed acceptable.
- **One caution:** Stage 1 leaves org (in app.js) calling `BillingModule.getBillingState()` and billing calling app.js-resident org functions. This is a *larger* app.js↔module surface mid-flight than any prior phase. Each stage MUST be independently green (audit + browser subset) before proceeding, and nothing merges to canonical until Stage 4. The contract states this; enforce it strictly.

## Summary of required closures before Stage 1
1. Resolve the `getActiveOrgIdForBilling` injected-vs-global contradiction (recommend: leave global).
2. Trace the current caller of `markWorkspaceSwitchBillingReadyIfSettled` + `_billingGateApplier` setter; confirm callback direction/owner.
3. Establish a **fresh green browser baseline on current HEAD** (the deferred gate must run before, not just during, extraction).
4. Add the four characterization pins (billing facade set + copy; `refreshBilling` wrappable; `window.OrgContext` exact-4-members).

## Gate-closure disposition (all findings resolved)

- **Finding 1 (contradiction) — CLOSED.** Source confirms `getActiveOrgIdForBilling` (app.js:936) reads the `window.OrgContext` global + localStorage fallback; contract updated to preserve the global read, not inject. My recommendation was adopted.
- **Finding 2 (unproven callback direction) — CLOSED, with a material correction I concur with.** The trace shows readiness is marked via the **existing `subscribeBilling` subscription** (app.js:9241), synchronously inside `_notifyBilling` after `_billingState` mutation, not via a new `onBillingSettled` callback. This is *better* than the contract's original proposal — it uses the existing API and adds no surface. `_billingGateApplier` confirmed set-once (9239), null-guarded (957). Ownership model stands.
- **Finding 3 (stale browser baseline) — CLOSED.** Full behavioral suite run on current HEAD: **37/37 green**. I additionally flag (and the contract now records) that owner/non-owner checkout/portal money-action flows are not individually browser-scripted; DEF-011 is audit-structural. This is **non-blocking for the baseline** (nothing red) but the Stage-1 browser subset must add live checkout/portal exercise before Billing merges — retained as a Stage-1 gate, not a baseline blocker.
- **Findings 4–9 (overexposure / cycles / ordering / identity / test gaps / staging) — CLOSED or retained-as-documented.** The four pins are added and passing; `getBillingState` copy semantics are pinned structurally; `window.OrgContext` exact-4-members pinned (guards accidental exposure of the unresolved members); no import cycle; late-bind null-guards required per the confirmed `_billingGateApplier` precedent.

**Residual (carried into Stage 1, not blocking):** confirm `authBlockState` sole-writer during Stage 3; add live checkout/portal + storage-isolation scenarios to the Stage-1/Stage-4 browser subset; per-site assert no reader retains a snapshot across an async boundary during each stage's re-pointing.

**Updated verdict: SAFE TO BEGIN.** The four mandatory closures are complete; the contract is implementation-ready and the Billing-first staged plan is safe.
