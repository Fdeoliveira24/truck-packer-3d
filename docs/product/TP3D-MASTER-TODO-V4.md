# Truck Packer 3D — Master TODO V4
**Last updated:** 2026-06-14 | Synthesized from all prior TODO versions + QA report + comparison research + competitive landscape + Codex/Copilot/Claude audit cross-check + storage/space planning vertical

---

## CURRENT ACTIVE WORK
| Field | Value |
|-------|-------|
| Stable main commit | `8f4bbfc` |
| Active branch | (none — between phases; 3B starts on a dedicated geometry-only branch) |
| Active phase | 3B — Geometry tolerance unification (audit complete, implementation pending) |
| Next planned phase | 3B implementation, followed by 5A stacking constraints |
| Waiting for | Approval to start 3B on a geometry-only branch |
| Do not start simultaneously | Stripe/billing patches, auth/membership/workspace/security work, or AutoPack realism (5B) |

*Update this block after each merge. Do not hardcode the commit hash anywhere else in this file.*

---

## Near-Term Execution Queue
*Approved order. Do not combine items. Do not skip steps.*

*Completed 2026-06-14: G1.2C/G1.2D merged; A1.1B front-first merged and browser-verified.*

1. Unify geometry epsilon across `app.js`, `pack-library.js`, and the solver (3B)
2. Fix `noStackOnTop` and `stackable: false` enforcement in AutoPack
3. Enforce `maxStackCount` in AutoPack
4. Correct the stacking score (flat STACKING_BONUS cancels gravity penalty)
5. Run the full A1 AutoPack realism and compaction audit
6. Case Browser — search-clear button and self-sizing filter panel
7. Case Browser — multi-selection and batch add/drop planning
8. Start wider Packs, Cases, Folders, and Spaces & Equipment screen UI phases

---

## Legend
- ✅ DONE — verified in browser and/or tests
- 🔄 IN PROGRESS — code written, awaiting live sign-off
- ⬜ TODO — not started
- 🚫 BLOCKED — depends on another item listed explicitly
- ⚠️ BUG — confirmed incorrect behavior
- 🟡 RISK — currently works, but has a known safety or scale concern
- ❓ DECISION — product or business rule still needs a documented approval

---

## Definition of Done for a Phase
A phase is only ✅ when ALL of the following are true:
1. Scope audit completed before any code is written.
2. Implementation is on a dedicated branch.
3. Automated tests pass (`npm test`).
4. Lint passes (`npm run lint` — 0 errors).
5. Typecheck passes (`npm run -s typecheck`).
6. Diff checks pass (`git diff --check`, `git diff --cached --check`).
7. Manual browser checks pass for all affected states (desktop + mobile where relevant).
8. Code review confirms no unrelated files changed.
9. Phase is committed, merged to main, and pushed.
10. This TODO is updated with the new status.

**🔄 in-progress states must say exactly what remains:**
- `🔄 Implemented, awaiting manual browser review`
- `🔄 Browser verified, awaiting audit`
- `🔄 Audited, awaiting commit and merge`
- `✅ Merged and pushed — evidence recorded`

Never use 🔄 to mean "finished." A phase is not done until it is merged, pushed, and the evidence is recorded.

---

## Release Gate Rule
Release-gate items block **public launch**, not isolated product development. Product phases may continue on separate branches but must never be mixed into billing/auth/security patches.

---

## PART 1 — RELEASE GATE (P0 Hard Blockers)

### 1A — Billing Foundation
| Status | Item | Evidence |
|--------|------|----------|
| ✅ | Stripe is billing truth; `billing_customers` is projection; UI trusts `/billing-status` only | Invariant tests + live verification |
| ✅ | Owner-only money actions (checkout, portal, cancel, plan change) | Edge Function 403 + UI gate |
| ✅ | Trial display uses relative days ("Ends in X days") | Browser verified test4 |
| ✅ | Paid badges: Auto-renew vs Cancels, with correct renewal/end date | Browser verified test1/test2 |
| ✅ | Trial-expired soft lock (modal, AutoPack gate, PDF gate) | Browser verified test3 |
| ✅ | Trial-expired lock persists through idle, focus, and billing fetch errors | test3 idle + tab-switch |
| ✅ | Past-due grace window (banner, owner portal link, hard block after grace) | Implemented + code review |
| ✅ | `billing_customers` uniqueness + index guardrails applied | Migration + DB verify |
| ✅ | Checkout idempotency key includes `organizationId` | Commit `f5cc8cd` + test 272/272 |
| ✅ | Portal "Manage" never returns 500 (schedule-managed + stale sub fallbacks) | Code complete |
| 🔄 | Portal manual sign-off: User4 deep-link, User1 schedule-managed, test1 stale-sub | — |
| ✅ | DB health checks Q1–Q6 all clean on production | 2026-05-08 live run |
| ✅ | Webhook idempotency — duplicate event returns 200, no re-processing | Audit test |
| ⚠️ | **BUG-01** — Cross-user billing state contamination (~5s window) on in-tab sign-in without page reload. `tp3d:active-org-id` keeps prior user's org during contamination window; feature gates run with wrong entitlement. Silent — no console error. | QA report 2026-05-04 |
| ⚠️ | **BUG-02** — `interval: "unknown"` for all Pro accounts; `currentPeriodEnd: null`. UI cannot show Monthly/Annual or renewal date. | QA report 2026-05-04 |
| ⚠️ | **BUG-03** — `portalAvailable: false` for test2 and test4. Paying subscribers cannot open Stripe portal from within the app. | QA report 2026-05-04 |
| ⚠️ | **BUG-04** — `workspaceCount: 7` inflated for test4 due to orphaned `org_member` rows. Workspace limit enforcement is wrong for that account. | QA report 2026-05-04 |
| ⚠️ | **BUG-05** — test6's second workspace absent from UI switcher despite valid billing-status. Membership row passes billing-status auth but fails another query. | QA report 2026-05-04 |
| ⚠️ | **BUG-06** — "Manage" billing navigates current tab to `billing.stripe.com` instead of opening a new tab. Destroys app session. | QA report 2026-05-04 |
| ⚠️ | **BUG-07** — Sidebar upgrade element retains stale cross-user billing content after sign-in. Hidden visually (`display:none` on parent), but innerHTML is wrong. Any parent-wrapper regression would expose it. | QA report 2026-05-04 |
| ⬜ | Replace `support@pxl360.com` placeholder with real support email throughout | — |

### 1B — Auth & Session
| Status | Item | Evidence |
|--------|------|----------|
| ✅ | User-scoped local storage (`truckPacker3d:v1:<userId>`) | Code + test |
| ✅ | Legacy storage migration to scoped key | Code |
| ✅ | StateStore resets on sign-in, sign-out, user switch | Browser verified |
| ✅ | Canonical logout helper — no timed reload after `signOut()` | Commit `e0b5e05` |
| ✅ | Logout-in-progress latch prevents auth snapshot resurrection during sign-out | Code |
| ✅ | Auth snapshot fallback (8s TTL) prevents transient unknown state from wiping org context | Code |
| ✅ | Cross-tab logout: Tab A sign-out causes Tab B to reach sign-in form (not spinner) | 2026-05-16 staging pass |
| ✅ | Separate-profile cross-tab logout verified | 2026-05-14 two-profile pass |
| ✅ | Same-tab different-user isolation verified | 2026-05-14 browser pass |
| ✅ | Two-tab same-user workspace switch verified | 2026-05-13 browser pass |
| ⬜ | `getAccountBundleSingleFlight({force:true})` returns session+user in both tabs (console/API proof) | — |
| ⬜ | No console errors in normal flows (ignore debug mode + favicon noise) | — |

### 1C — Workspace Foundation
| Status | Item | Evidence |
|--------|------|----------|
| ✅ | Workspace creation: creates org, adds owner, sets `current_organization_id`, refreshes billing | test5 live signup |
| ✅ | Workspace switching: no billing, member, invite, folder, or pack leakage | 2026-05-14 browser pass |
| ✅ | Workspace archive: data preserved, not cancelled in Stripe, excluded from active list | SQL + browser |
| ✅ | Archive fallback: active workspace auto-switches after archiving | test4/test5 browser |
| ✅ | No-active-workspace state is clean and guided | Browser |
| ✅ | Archived workspaces count toward plan workspace limits by policy | Billing-status + copy |
| 🔄 | Workspace restore: appears in switcher, billing refreshes after restore | — |
| ❓ | Transfer Ownership: define billing ownership policy before exposing to paid users | — |
| ✅ | Leave Workspace: removes only caller's `org_member` row; no Stripe or billing change | test2/WS-test4-w-6 |
| ✅ | Last Owner blocked from leaving until transfer | Server + UI |
| ✅ | Bottom-left chip uses workspace initials (circular shape) | Browser |
| ⬜ | Workspace creation: server-side limit enforcement (UI-only gate is insufficient for paid SaaS) | — |
| ❓ | Formal per-org trial vs free-default billing policy for workspaces added by non-new users | — |
| ⬜ | Billing behavior on workspace restore/transfer fully signed off | — |
| ⬜ | Cases view state sign-off after workspace switch | — |

### 1D — Membership & Invites
| Status | Item | Evidence |
|--------|------|----------|
| ✅ | Owner can invite Admin or Member | Edge Function + UI |
| ✅ | Admin can invite Member only (not Admin or Owner) | Phase 0.5C-1 |
| ✅ | Admin cannot promote users to Admin or Owner | Edge Function 403 |
| ✅ | Last Owner cannot be removed | Server-side check |
| ✅ | Removing member does not change billing | SQL check |
| ✅ | Invite email delivery via Resend (staging verified) | Phase 3A pass |
| ✅ | Signed-in correct-email invite accept works | Phase 3B pass |
| ✅ | Signed-out invite handoff resumes after matching login | Phase 3B pass |
| ✅ | Expired invite shows persistent rejection message | Phase 3C1 pass 2026-05-15 |
| ✅ | Revoked invite shows persistent rejection message | Phase 3C1 pass 2026-05-15 |
| ✅ | Wrong-email accept blocked with clear message | HTTP 403 verified |
| ✅ | `org-invite-revoke` Edge Function: owner-only for Admin invites, Admin for Member invites | Phase 0.6B |
| ✅ | Invite revoke row disappears immediately from Settings after success | Phase 0.6B-2 |
| ✅ | Admin can see pending Admin invite rows (transparency) with Revoke disabled | Phase 0.6B-2 |
| ✅ | Invite expiration enforced server-side (`expires_at`) | Phase 0.5C-3 |
| ⬜ | Removed member loses access in current tab AND another open tab (two-tab sign-off) | — |
| ⬜ | DB-level proof: invite flows do not mutate `billing_customers` or Stripe records | — |
| ⬜ | Production domain swap for Resend sender | — |
| ⬜ | Email template polish | — |
| ❓ | Ownership transfer: billing policy definition and live sign-off | — |

### 1E — Account Deletion & Security
| Status | Item | Evidence |
|--------|------|----------|
| ✅ | Delete account blocked if user is last Owner of any org | Code + UI message |
| ✅ | `deletion_status = 'requested'` is authoritative login block | Phase 0.6D-pre |
| ✅ | `request-account-deletion` preserves `organization_members` during 30-day window | Code |
| ✅ | Legacy `delete-account`, `ban-user`, `unban-user` Edge Functions retired (410) | Deployed |
| ✅ | Admin cannot remove another Admin (server + RLS) | Migration `2026050702` + deployed |
| ✅ | `billing-status` returns `billing_unavailable` for archived resolved workspaces | Code |
| ✅ | Support-assisted `cancel-account-deletion` endpoint deployed | Live curl 200 |
| ✅ | **P0 — `profiles` deletion fields server-side guard deployed and live-verified.** Main commit `e8c0b3f` introduced `supabase/migrations/2026061301_guard_profile_deletion_fields.sql`. Remote migration history on `yduzbvijzwczjapanxbd` includes `2026061301_guard_profile_deletion_fields`. Catalog verification on 2026-06-14 found one enabled `BEFORE UPDATE` row trigger on `public.profiles` (`tp3d_profiles_guard_deletion_fields`) calling `public.tp3d_guard_profile_deletion_fields()`, PL/pgSQL, SECURITY INVOKER, locked `search_path = ''`, NULL-safe `is not distinct from` checks for `deletion_status`/`deleted_at`/`purge_after`, 42501 rejection, no `session_user`/metadata/email/auth.uid bypass, and no duplicate deletion-field trigger. `anon`, `authenticated`, and `public` have no direct EXECUTE privilege. Live rollback-only DB behavior used the disposable `test5` fixture (no Stripe customer rows, no subscription rows; no real customer data): authenticated role updates to each protected field and a combined protected update were rejected with SQLSTATE 42501; normal profile update succeeded; unchanged protected values succeeded through the fast path; service-role protected update succeeded; original values were restored and rechecked (`deletion_status=none`, `deleted_at=null`, `purge_after=null`, `bio=null`). No auth user was deleted and no purge ran. Edge request/cancel source remains service-role based, but live request/cancel flow was not run because no no-workspace disposable account exists in the visible fixtures. | Live SQL verification + static invariant tests; 2026-06-14 |
| ✅ | Add targeted tests/proof: non-service-role calls cannot mutate `profiles.deletion_status`, `deleted_at`, `purge_after` — 8 static migration/invariant tests cover trigger/function structure, NULL-safe comparisons, fast-path, 42501 raise, trusted role model, no owner/admin/member/metadata bypass, SECURITY INVOKER + locked search path, EXECUTE revokes, Edge Function service clients, and browser client block. Live DB rollback proof on 2026-06-14 confirmed authenticated 42501 rejection for all protected fields and combined updates, normal update success, unchanged-value fast-path success, service-role success, and restoration. | `tests/audit/security-and-invariants.spec.mjs` + live SQL verification |
| ❓ | Define paid-subscription deletion policy: must cancel first, or support-assisted cancel during delete flow | — |
| ⬜ | Verify Admin cannot remove Admin in live browser | — |
| ⬜ | Verify Admin can still remove Member in live browser | — |
| ⬜ | Rotate Supabase DB password (was pasted in terminal/chat history during setup) | — |
| ⬜ | `purge-deleted-accounts` scheduling: pg_cron unavailable; decide GitHub Actions cron, external scheduler, or manual support runs (operational checklist item, not a code defect) | — |

### 1F — Feature Gating
| Status | Item | Evidence |
|--------|------|----------|
| ✅ | AutoPack gate respects trial, trial-expired, past-due, workspace-limit-reached | Browser verified |
| ✅ | PDF export gate respects same billing states | Browser verified |
| ✅ | Trial-expired: owner gets Subscribe CTA, non-owner gets support message | Browser verified test3 |
| ✅ | Workspace-limit-reached: AutoPack + PDF blocked with correct message | Browser verified fixture |
| ⬜ | Every Pro-gated feature checks billing-status at **action time**, not only at render | — |
| ⬜ | Backend enforcement (Edge Functions / RLS) for sensitive gated operations | — |
| ⬜ | Free users hitting gated actions see upgrade CTA, not broken/blank state | — |
| ❓ | Define policy: downgraded orgs keep existing packs read-only or with creation limits | — |
| ⬜ | Export (JSON backup) always works regardless of plan — data portability guarantee | — |

---

## PART 2 — PLATFORM SAFETY (Must-Have Before Growth)

### 2A — Runtime Error States
| Status | Item |
|--------|------|
| ⬜ | 404 for unknown hash routes |
| ⬜ | 404 / graceful fallback for missing/deleted current pack while editor is active |
| ⬜ | Fatal runtime error overlay (`#error-overlay` + `src/ui/error-overlay.js`) |
| ⬜ | Maintenance mode via inline config (blocks app boot before `src/app.js` loads) |
| ⬜ | Pre-boot vendor/CDN failure fallback with one-shot guard |
| ⬜ | Keep `system-overlay` intact — do not mix runtime safety into modularization |

### 2B — Data Export / Import
| Status | Item |
|--------|------|
| ✅ | Workspace JSON Export MVP (Settings → General, owner/admin-gated) |
| ✅ | Export includes packs, cases/items, `folderLibrary`; strips thumbnails |
| ✅ | Export excludes Stripe IDs, JWTs, service keys, private tokens, raw org/user IDs |
| ✅ | `parseWorkspaceImportJSON()` exists as groundwork |
| ✅ | Case Library spreadsheet imports capped at 5,000 rows and 10 MB |
| 🔄 | Workspace Export browser sign-off: owner/admin/member visibility; inspect downloaded file |
| 🟡 | **localStorage scale risk — thumbnails stored inline.** `saveNow()` writes full `caseLibrary` and `packLibrary` into workspace-scoped localStorage. Pack thumbnails are stored inline after preview capture. A single large workspace can exhaust the ~5 MB quota. Fix options: strip thumbnails from autosave payload (re-capture on demand), add quota check + warning before write, or move large payloads to IndexedDB. |
| ⚠️ | **JSON import has no file-size gate.** Spreadsheet imports are capped (5,000 rows / 10 MB) but JSON import parse paths have no comparable limit. A very large or malformed JSON file could hang or crash the tab. Add a file-size check before parsing. |
| ⬜ | Add localStorage quota handling: detect approaching limit and warn user before write fails |
| ⬜ | Add JSON import file-size limit (consistent with spreadsheet cap) |
| ⬜ | Workspace Import UI (decide under which roles; parser groundwork already exists) |
| ⬜ | App Export covers preferences + local libraries (full local backup path) |
| ⬜ | Export for member/invite summary (deferred — requires server reads + role decisions) |

### 2C — Security Hardening
| Status | Item |
|--------|------|
| 🟡 | **Composite DB indexes missing for common billing queries.** Current `subscriptions` table has only single-column indexes. Portal and billing-status queries filter on `(organization_id, status, updated_at)` and `(stripe_customer_id, status, updated_at)`. Add composite indexes before scale. |
| 🟡 | **Multi-workspace billing fallbacks need hardening.** Owner-account entitlement can fall back to the oldest owner workspace when no mapping is found (`billing-status/index.ts`). Portal lookup can fall back by customer without an org filter (`stripe-create-portal-session/index.ts`). Both paths need integration tests and explicit guards before paid scale. |
| ⬜ | Integration test: portal preselection always targets the correct workspace subscription for a multi-workspace owner |
| ⬜ | Integration test: owner-account entitlement fallback does not bleed entitlement across workspaces |
| ⬜ | Make Edge Function error responses less raw — checkout and portal currently return raw exception messages to the client; sanitize to safe user-facing copy |
| ⬜ | Content Security Policy headers on all pages |
| ⬜ | CORS policy: allow only your domain(s) to call Edge Functions |
| ⬜ | Input sanitization: all user text fields escaped before rendering |
| ⬜ | Rate limiting: login, signup, password reset, billing actions, invite sending |
| ⬜ | JWT validation on all Edge Functions (not only billing) |
| ⬜ | No secrets, JWTs, or API keys logged to console in production flows |

### 2D — Legal & Compliance
| Status | Item |
|--------|------|
| ⬜ | Terms of Service page (footer + during signup) |
| ⬜ | Privacy Policy page (footer + during signup) |
| ⬜ | Cookie consent banner (if using analytics or tracking cookies) |
| ⬜ | GDPR data export: user can download all personal data as JSON |
| ⬜ | GDPR data deletion: account deletion removes all personal data |
| ⬜ | Data Processing Agreement (DPA) available for Enterprise customers |

### 2E — Infrastructure & Monitoring
| Status | Item |
|--------|------|
| ⬜ | Error tracking (Sentry or equivalent) in production with stack traces + user context |
| ⬜ | Uptime monitoring + health check endpoint |
| ⬜ | Status page (even a simple one: gives enterprise customers confidence) |
| ⬜ | Webhook failure alerting (spike in `webhook_events.status='failed'`) |
| ⬜ | Billing anomaly alerting (active orgs with null Stripe IDs) |
| ⬜ | CI/CD: automated lint + tests on every push |
| ⬜ | Staging environment that mirrors production (separate Supabase project, Stripe test mode) |
| ⬜ | Deploy preview for PRs |

---

## PART 3 — CODE ARCHITECTURE & CLEANUP

### 3A — App Modularization
*Do Phase A only after the geometry epsilon is unified (3B). Do Phase B and C only after release gate is green.*

| Status | Item |
|--------|------|
| ⬜ | **M0 — Inventory first**: Create written inventory of all app globals, storage keys, BroadcastChannels, custom events, and exported surfaces before splitting `src/app.js` (currently 9,290 lines) |
| ⬜ | **M0**: Write focused tests for `getProRuleSet()` before extracting it |
| ⬜ | **Phase A — low risk, do first**: Extract `AccountSwitcher` from `src/app.js` → `src/ui/account-switcher.js`. It is self-contained with its own unmount path. Validate: account menu, workspace switch, settings, logout. |
| ⬜ | **Phase A — medium-low risk**: Extract `TrailerGeometry` from `src/app.js` → `src/services/trailer-geometry.js`, but ONLY after tolerance is unified (see 3B). Validate: rect, wheel wells, front bonus, AutoPack. |
| ⬜ | **Phase B**: Extract `ExportService` as a dependency-injected factory. Validate: screenshots, PDF billing gate, preview capture workspace guard. |
| ⬜ | **Phase B**: Extract `KeyboardManager`, keeping same shortcuts + adding teardown, only after tests exist. |
| ⬜ | **Phase C (later — high risk)**: Billing state / cross-tab / access gate extraction. Validate cross-tab, sign-out, org switch, stale billing, autosave before touching. |
| ⬜ | **Phase C (later — high risk)**: Org/workspace switching extraction. Same validation requirements. |
| ⬜ | Replace manually hardcoded build stamp in `src/app.js` with an automated or build-generated value. Do not record a fixed expected HEAD hash anywhere in this TODO. |
| ⬜ | Split `settings-overlay.js` by concern (deferred until workspace + runtime safety are stable) |
| ⬜ | Settings → Workspace → General: reorganize into 4 cards per approved UI plan (Identity, Backup & Export, Ownership & Access, Danger Zone) |

### 3B — Geometry & Engine Cleanup
*Fix epsilon before any Phase A extraction and before any deeper placement-phase work.*

| Status | Item |
|--------|------|
| ⚠️ | **Unify trailer geometry tolerance — technical blocker for placement work.** Root cause is a UNIT-CONTRACT defect, not just a number mismatch. `pack-library.js` and the active solver (`autopack-solver.js`) use `EPS = 0.05` in INCH space consistently (persisted packed/staged, AutoPack final validation, stats/OOG) — the canonical paths. But `app.js`'s `TrailerGeometry.isAabbContainedInAnyZone` hardcodes `EPS = 0.01` and is called with BOTH inch-space zones (Stats packed flag, duplicate-inside check, shape-change OOB warning → **0.01-inch** physical) AND world-space zones (editor drag "isInsideTruck" feedback, via `zonesInchesToWorld` → 0.01 world = **0.2-inch** physical, since `INCH_TO_WORLD = 0.05`). Net: three different physical tolerances (0.05" / 0.01" / 0.2") across active paths. Correction is one inch-space contract: route all containment through a single named inch epsilon (0.05"), and make world-space callers convert their AABB to inches first (not zones to world). Intended tolerance 0.05" (= 0.0025 world units): imperceptible visually, far above FP noise, and already governs the authoritative paths so it changes the fewest accepted placements. Must precede 3A `TrailerGeometry` extraction and all deeper AutoPack placement work. Add regression tests covering the epsilon boundary in both inch and world callers. |
| ⬜ | After tolerance is unified: consolidate `TrailerGeometry` into a single canonical module (currently duplicated between `app.js` and `pack-library.js`) |
| ⬜ | `solveLegacyAutoPack()` — confirm truly unused (`rg` shows only its own definition; no production caller found), then delete |
| ⬜ | `buildLegacyAutoPackItems()` — still live (imported and called in `autopack-engine.js`); do NOT remove yet |
| ⬜ | Safe AutoPack item builder cleanup path: create `src/services/autopack-item-builder.js`, move `buildLegacyAutoPackItems` and helpers, update `autopack-engine.js`, update invariant tests, run `npm test` + browser AutoPack fixtures, then trim `autopack-legacy-solver.js` only after `rg solveLegacyAutoPack` shows zero production references |

### 3C — Test Quality
| Status | Item |
|--------|------|
| ⬜ | **Add live integration tests (currently only audit/static checks exist)**: checkout owner/member denial, portal wrong-workspace preselection, webhook out-of-order + idempotent replay, billing-status after workspace switch, expired invite, accepted-invite same-email guard, account deletion owner block, RLS member/non-member select denial, import/export large-workspace quota |
| ✅ | Add test/proof: non-service-role calls cannot mutate `profiles.deletion_status`, `deleted_at`, `purge_after` — static migration/invariant tests exist in `security-and-invariants.spec.mjs`; live DB rollback verification completed 2026-06-14 against `yduzbvijzwczjapanxbd` with authenticated 42501 rejections and service-role success |
| ⬜ | Add regression test for `interval` and `currentPeriodEnd` returned by `/billing-status` for all Pro states |
| ⬜ | Add stress-test coverage for 200+ case loads (performance + correctness) |
| ⬜ | Reduce regex-heavy audit tests gradually; replace with direct behavior tests |
| ✅ | Phase tests are based on source ownership/behavior, not live working-tree file lists. `8474b09` retired ALL remaining `git diff`-based "changed files stay inside scope" guards (−804 lines in `security-and-invariants.spec.mjs`), following the earlier removal of the G1.2B/G1.2C/G1.2D polish-phase guards (they false-failed on any later valid change to forbidden files such as `autopack-engine.js`). No working-tree/`git diff --name-only` scope guards remain in `tests/`. Behavior/source-ownership tests retained; suite green (529). |

### 3D — Code Quality
| Status | Item |
|--------|------|
| 🔄 | Fix remaining eslint warnings (unused vars, no-use-before-define) — no behavior changes |
| 🔄 | Replace browser-native `window.prompt`/`alert` in app flows with app UI modal patterns |
| ⬜ | Fix html-validate warnings (prefer native button) in highest-impact UI first |
| ⬜ | Remove dead code after confirming no callers |

---

## PART 4 — UI / UX

### 4A — Inspector Panel
*Active work: G1.2C. Do not change Transform, Rotate, Flip, visibility, duplicate, delete, or selection behavior.*

| Status | Item |
|--------|------|
| 🔄 | G1.2C: Stats card label/value layout — implemented, awaiting manual browser review |
| 🔄 | G1.2C: Rotate/Flip icon alignment for single and multi-selection — implemented, awaiting manual browser review |
| 🔄 | G1.2C: Actions card inline layout styles removed — implemented, awaiting manual browser review |
| 🔄 | G1.2C: Usable overhang height display (trailer height minus deck height) — implemented, awaiting manual browser review |
| ⚠️ | **Inspector help tooltips use fragile positioning — affects all Inspector cards.** Confirmed broken on Transform and Front Overhang. Tooltips cover unrelated fields, extend over the card below, are too wide for the Inspector panel, do not choose direction based on available space, and may be clipped or hard to close on smaller screens. All Inspector help tooltips (Truck, Front Overhang, Wheel Wells, Transform, Rotate/Flip, and any others) must anchor to their own card header, remain fully inside the viewport, and automatically flip left/right or above/below based on available space. Tooltip placement must never depend on the card's computed height. |
| ⬜ | Tooltip has a reasonable maximum width and wraps long text without horizontal scrolling |
| ⬜ | Tooltip never extends outside the browser viewport at any size |
| ⬜ | Tooltip does not cover its own card's main fields when another placement is available |
| ⬜ | Tooltip arrow remains connected to the correct help icon |
| ⬜ | Opening one tooltip closes any other open tooltip |
| ⬜ | Escape key, outside click, and repeated icon click all close the tooltip |
| ⬜ | Tooltip works correctly at desktop, narrow desktop, tablet, and mobile sizes |
| ⬜ | Tooltip remains readable in both light and dark themes |
| ⬜ | Final spacing + typography tuning after G1.2C sign-off |
| ⬜ | Check Truck / Front Overhang / Wheel Wells card density |
| ⬜ | Confirm field labels align across all truck modes |
| ⬜ | Confirm Reset and Update buttons use the same sizing rules |
| ⬜ | Confirm Actions card does not wrap awkwardly |
| ⬜ | Confirm Delete is visually separate as a destructive action |
| ⬜ | Do NOT show fake cubic-foot capacity numbers |

### 4B — Case Browser Polish
| Status | Item |
|--------|------|
| ✅ | Unified Category and Manufacturer card renderer (G1.2B) |
| ✅ | Manufacturer cards show dimensions, volume, weight, category, flippable status |
| ✅ | Selected-case visual cue in Case Browser |
| ✅ | Removed duplicate card rendering code |
| ✅ | Case Browser Manufacturer tab exists and uses the shared card renderer |

**Minor polish (next iteration):**
| Status | Item |
|--------|------|
| ⬜ | Clear-search button inside/beside search field |
| ⬜ | Escape key clears search field |
| ⬜ | Filter dropdown resizes to content (avoid empty space when few filters exist) |
| ⬜ | Compact, aligned filter chips |
| ⬜ | Review filter panel placement on mobile |
| ⬜ | Keyboard access for all Case Browser interactions |

**Batch selection (separate phase — not a small CSS change):**
| Status | Item |
|--------|------|
| ⬜ | Selection model for library cases (how selection state is tracked and cleared) |
| ⬜ | Quantity input per selected case type |
| ⬜ | Batch Add action (adds all selected cases at specified quantities) |
| ⬜ | Batch drag/drop payload (one drag operation adds multiple case types) |
| ⬜ | Drop preview and placement behavior for batch drops |
| ⬜ | Handling duplicate selected presets in a single batch |
| ⬜ | Error behavior when only some selected cases fit in the pack |
| ⬜ | Undo support for batch add |
| ⬜ | Accessibility and keyboard selection for batch mode |

### 4C — Packs Screen UI
| Status | Item |
|--------|------|
| ✅ | Folder UI: Compact Folders dropdown, Create Folder, Move Pack to Folder, Rename, Delete (Phase 0.7C) |
| ✅ | Folder persistence survives reload |
| ✅ | Grid/list switching |
| ✅ | Search, status chips, folder filter |
| ⬜ | Empty Packs state with Create Pack and Import actions |
| ⬜ | Pack card preview image handling (thumbnail or fallback illustration) |
| ⬜ | Empty thumbnail fallback when no preview has been captured |
| ⬜ | Pack cards show useful stats: truck/space name, packed/staged counts, volume and weight warnings |
| ⬜ | Folder badge and status badge on pack cards |
| ⬜ | Clear distinction between draft, packed, staged, and warning states |
| ⬜ | Recently updated sort order |
| ⬜ | Bulk actions (select multiple packs, delete, move to folder) |
| ⬜ | List-view column definitions |
| ⬜ | Open-in-editor action from pack card |
| ⬜ | Page-level summary or key stats only if backed by trusted data — no invented numbers |
| ⬜ | Responsive layout review for narrow desktop, tablet, and mobile |

### 4D — Cases Library Screen UI
| Status | Item |
|--------|------|
| ⬜ | Empty Cases state: "Add your first cargo item" with New Case, Import, Template, and sample inventory CTAs |
| ⬜ | Populated grid layout |
| ⬜ | Case card fields: name, dimensions, weight, volume, category, manufacturer, and active rules (fragile, no-stack, etc.) |
| ⬜ | Populated list-view with defined column set |
| ⬜ | Search clear button and Escape-to-clear |
| ⬜ | Self-sizing filter dropdown |
| ⬜ | Folders, tags, categories, manufacturers filter |
| ⬜ | Multi-select and selected/bulk-action toolbar |
| ⬜ | Bulk actions: duplicate, move, tag, export, delete |
| ⬜ | Consistent case metadata and category indicators |
| ⬜ | Thumbnail/model preview support (plan now; not required at launch) |
| ⬜ | Trusted calculations only — no placeholder capacity data |

### 4E — Folder UI
| Status | Item |
|--------|------|
| ✅ | Pack-only folder data model (`folderLibrary`, nullable `pack.folderId`) |
| ✅ | Folder CRUD: create, rename, delete (moves packs to Unfiled, does not delete them) |
| ✅ | Move Pack to Folder |
| ✅ | Workspace Export includes `folderLibrary` |
| ⬜ | Full Folders screen with page heading, description, and primary actions (New Folder, etc.) |
| ⬜ | Folder summary cards at top: total folders, organized packs, uncategorized packs, largest project |
| ⬜ | Folder grid cards: color/icon, pack count, total weight, member avatars, sharing state, last-updated time |
| ⬜ | "New folder" empty card inside the folder grid |
| ⬜ | Recently opened packs section below the folder grid |
| ⬜ | Folder search and sorting |
| ⬜ | Grid/list view toggle |
| ⬜ | Folder card overflow menu (rename, share, archive, delete) |
| ⬜ | Folder sharing and Manage Access entry point |
| ⬜ | Folder-level permissions and sharing policy (❓ decision needed before implementation) |
| ⬜ | Empty Folders state |
| ⬜ | Archived folders or archived-project policy |
| ⬜ | Folder screen mobile layout |
| ⬜ | Drag packs into folders directly from the Packs grid |
| ⬜ | Folder counts and empty-folder state |
| ⬜ | Case folders (separate phase; pack folders are the foundation) |

### 4F — Spaces & Equipment Library UI
*Renamed from "Trucks / Equipment" to reflect the full scope: any space a user might pack — vehicles, storage units, containers, rooms, and more.*

**Space families supported (data model must accommodate all; UI can launch road-first):**
- Road vehicles: vans, box trucks, trailers, flatbeds
- Shipping: intermodal containers (20ft, 40ft, 40ftHC, open top, flat rack), portable storage containers (PODS, etc.)
- Storage: self-storage units (5×5 through 10×30), garage condos, residential garages, storage bays, rooms
- Warehouse: zones, racks, staging areas, bays
- Marine: boats, vessel storage areas, marine cargo holds
- Air: aircraft cargo holds, air-freight ULD containers
- Rail: railcars
- Custom: any user-defined rectangular or shaped space

**Screen UI items:**
| Status | Item |
|--------|------|
| ⬜ | Spaces & Equipment screen with fleet/library summary cards: total spaces, total cargo volume, total max payload, most-used space |
| ⬜ | Search, class/type filtering, and sorting |
| ⬜ | Grid and list views |
| ⬜ | Equipment/space card preview with interior dimensions, cargo volume, max payload, door/access type, and pack usage count |
| ⬜ | Built-in preset badge vs custom user-created space badge |
| ⬜ | Preferred/favorite space state |
| ⬜ | "Open in editor" action from card |
| ⬜ | Add Space and Import Specification actions |
| ⬜ | Utilization display only when calculation is formally defined (cross-ref 6I) |
| ⬜ | Do not show invented payload or capacity values when a preset does not contain trusted data |
| ⬜ | Empty state with sample presets across space families |
| ⬜ | Responsive grid/list layout |

### 4G — 3D Case Visual Polish
| Status | Item |
|--------|------|
| ⬜ | Regular case outlines: dark/neutral |
| ⬜ | Single selected-case outline: red |
| ⬜ | Multi-selected-case outline: orange |
| ⬜ | Collision red visually distinct from selection red |
| ⬜ | Out-of-gauge warning visually distinct from collision |
| ⬜ | Review hover state, hidden-item opacity, dragged-item transparency |
| ⬜ | Avoid emissive-only selection if it is unclear |
| ⬜ | Confirm selection state resets after drag, rotate, hide, delete |
| ⬜ | Confirm no material or geometry leaks |

### 4H — Truck Visual Polish
| Status | Item |
|--------|------|
| ✅ | Solid exterior truck rails (WebGL line width unreliable) |
| ✅ | Green rear/loading-door rails; red front/cab rails |
| ✅ | Internal seams between main body and overhang removed |
| ⬜ | Consider changing main rail color from yellow/orange to blue |
| ⬜ | Clamp rail thickness on mobile zoom |
| ⬜ | Review rail visibility in dark mode |
| ⬜ | Review Front Overhang and Wheel Wells blocked-zone fill strength |
| ⬜ | Future: doors, tires, wheel arches, cab details, floor texture, realistic materials |

### 4I — Onboarding & Empty States
| Status | Item |
|--------|------|
| ⬜ | New user guided intro (tooltip tour or welcome modal) |
| ⬜ | Sample pack pre-loaded on first visit (editor not empty) |
| ⬜ | Free user hitting Pro feature sees upgrade modal (not broken/blank state) |
| ⬜ | Trial user sees days remaining in subtle badge |
| ⬜ | Expired trial user sees feature comparison table |

### 4J — Notifications
| Status | Item |
|--------|------|
| ⬜ | Trial ending soon (3 days before, 1 day before) — email + in-app |
| ⬜ | Grace period ending — email + in-app banner |
| ⬜ | Payment issue messages (past_due, unpaid, canceled) |
| ⬜ | Invitation notifications (sent / accepted / expired) |
| ⬜ | System notices (maintenance, important alerts) |

---

## PART 5 — AUTOPACK ENGINE

### Dependency order for AutoPack work
1. Front-first default fix (A1.1B) — safe to do now, does not touch containment
2. Geometry epsilon unification (3B) — required before any further placement changes
3. noStackOnTop / maxStackCount enforcement — after epsilon is unified
4. Stacking score correction — after epsilon is unified
5. Full A1 realism and compaction audit — after all above are complete

### 5A — Near-Term Correctness Fixes
| Status | Item |
|--------|------|
| ✅ | **A1.1B — default packing direction** — Merged (`4fc8821`) and browser-verified 2026-06-14. Changed `const loadFrontFirst = mode === 'frontBonus'` → `const loadFrontFirst = true` in `src/services/autopack-engine.js` so all three modes pack front-first. Engine-only change; `loadFrontFirst` only affects placement ordering/anchoring (zones resolved separately, so containment/blocked zones unchanged). Added source-ownership test in `tests/audit/security-and-invariants.spec.mjs`; suite green, lint 0 errors, typecheck clean. |
| ✅ | Standard packs front-first — engine default now `true` (mode `rect`); browser-verified 2026-06-14 |
| ✅ | Wheel Wells packs front-first while respecting wheel-well zones — engine default now `true` (mode `wheelWells`); blocked zones come from `getTrailerUsableZones` and are unaffected by direction; browser-verified 2026-06-14 |
| ✅ | Front Overhang remains front-first and cab-void safe (no change needed) — already front-first; behavior unchanged |
| 🚫 | **Fix stacking bug**: `noStackOnTop` / `stackable: false` not enforced in `findRestingY()` or `collides()` — **blocked until geometry epsilon (3B) is unified** |
| 🚫 | **Fix stacking bug**: `maxStackCount` not enforced in AutoPack — **blocked until geometry epsilon (3B) is unified** |
| 🚫 | **Fix scoring bug**: `STACKING_BONUS` flat +1200 cancels gravity penalty at ~80" height — scale the bonus or remove gravity penalty for already-stacked placements — **blocked until geometry epsilon (3B) is unified** |

### 5B — Deep AutoPack Realism Review (Phase A1)
*Do not start until 5A correctness fixes and 3B epsilon unification are complete.*

| Status | Item |
|--------|------|
| 🚫 | Improve compaction and reduce unused gaps — blocked on 3B |
| ⬜ | Review scoring order and candidate selection |
| ⬜ | Review repeated floor batches |
| ⬜ | Review heavy-on-bottom behavior |
| ⬜ | Review fragile-item protection (fragile flag → top layer only) |
| ⬜ | Review support-area requirements |
| ⬜ | Review max stack height enforcement |
| ⬜ | Review orientation constraints |
| ⬜ | Review weight distribution |
| ⬜ | Review axle-zone balancing |
| ⬜ | CoG as a penalty in AutoPack scoring (cross-ref: 6C) |
| ⬜ | Produce multiple valid packing results (like TruckPacker's 5 parallel algorithms) |
| ⬜ | Keep deterministic output where required |
| ⬜ | Verify Standard, Wheel Wells, Front Overhang, containers, and future space types |
| ⬜ | Replace weak source-pattern tests with runtime behavior tests |

### 5C — AutoPack Strategy Controls (Future)
*Keep strategy IDs out of schema until 5A and 5B are stable.*

| Status | Item |
|--------|------|
| ⬜ | Front-first as default (see 6L for persistence) |
| ⬜ | Rear-first as user option |
| ⬜ | Balanced/COG-aware option (cross-ref: 6C) |
| ⬜ | Per-pack AutoPack strategy setting |
| ⬜ | Per-run strategy override |
| ⬜ | Strategy IDs: `frontFirst`, `rearFirst`, `balancedCog`, `multiStop`, `zoneSequence` |
| ⬜ | Packs with no saved strategy fall back to front-first (no migration needed) |

### 5D — Multi-Stop & Load Order (Future)
| Status | Item |
|--------|------|
| ⬜ | Pack-level delivery stops/groups |
| ⬜ | Load phases + unload sequence |
| ⬜ | Zone sequence support |
| ⬜ | First-in/last-out and last-in/first-out rules |
| ⬜ | Support `loadPriority`, `mustLoadLast`, `mustUnloadFirst`, `stopGroup`, `keepTogetherGroup`, `deliverySequence` |
| ⬜ | Visual stop colors or grouping |
| ⬜ | Stop-aware manifests and load instructions in PDF/export |

---

## PART 6 — PRODUCT FEATURES (Competitive Parity)

### 6A — Quick Product Wins (After AutoPack correctness fixes)
| Status | Item |
|--------|------|
| ⬜ | **Weight View**: toggle — color-codes placed boxes green→yellow→red by relative weight |
| ⬜ | **Weight Scale panel**: Current / Capacity / Remaining / Excess / % |
| ⬜ | **PDF improvements**: front view, category color chips, page numbers, payload line in header, branded org header |

### 6B — Cargo Constraints (Competitive Parity)
| Status | Item |
|--------|------|
| ⬜ | Stackability per case: boolean + `maxStackCount` (wire to AutoPack — see 5A) |
| ⬜ | `"With Like"` stacking: only same case preset ID can stack on each other |
| ⬜ | Orientation lock: "this side up" / "any" / "on side only" |
| ⬜ | Do-not-stack flag (hard block in AutoPack) |
| ⬜ | Fragile flag (auto-places on top layer) |
| ⬜ | Allowed rotations per case (subset of 0°, 90°, 180°, 270°) |
| ⬜ | Shipment grouping: items in same group stay together in container |

### 6C — Center of Gravity (CoG)
*CoG display toggle lives in 6J. CoG as AutoPack penalty lives in 5B.*

| Status | Item |
|--------|------|
| ⬜ | CoG calculation service — weighted average of all placed items |
| ⬜ | Live CoG indicator in 3D viewport (sphere/crosshair, green/yellow/red) |
| ⬜ | CoG deviation % in stats panel (front/rear, left/right) |
| ⬜ | "Within 10% of center" tolerance check with pass/fail badge |

### 6D — Non-Box Shapes & OOG
| Status | Item |
|--------|------|
| ⬜ | `shape` field on case model: `box`, `cylinder`, `drum` |
| ⬜ | Geometry factory: `CylinderGeometry` for cylinders/drums |
| ⬜ | Volume calculation updated for cylindrical shapes |
| ⬜ | Collision detection uses AABB for cylinders (acceptable) |
| ⬜ | Out-of-gauge (OOG): detect items extending beyond container boundary |
| ⬜ | Classify OOG violations: over-length, over-width, over-height |
| ⬜ | Visual OOG indicator: red/orange highlight on protruding portion |
| ⬜ | "Permit required" badge for OOG items |
| ⬜ | Optional: flatbed trailer preset (no walls) for OOG loads |

### 6E — Spaces & Equipment Library (Data Model)
*The core concept shifts from "truck" as root to "space" as root. A truck is one type of space.*

**Data model direction (long-term):**
| Status | Item |
|--------|------|
| ⬜ | Introduce `space` as the top-level concept: `spaceType`, `spaceProfile`, `usableZones`, `blockedZones`, `accessPoints` |
| ⬜ | A truck becomes one `spaceType` within the space model, not the root concept |
| ⬜ | Space families: road, shipping, storage, warehouse, marine, air, rail, custom |
| ⬜ | Standard road vehicle presets: vans, box trucks, trailers, flatbeds (Standard / Wheel Wells / Front Overhang) |
| ⬜ | Standard shipping container presets: 20ft, 40ft, 40ftHC, open top, flat rack |
| ⬜ | Portable storage container presets: PODS, U-Haul U-Box, 1-800-PACK-RAT, and generic 8×8×16 |
| ⬜ | Self-storage unit presets: 5×5, 5×10, 10×10, 10×15, 10×20, 10×30 ft |
| ⬜ | Garage condo and residential garage presets |
| ⬜ | Equipment grouped and filterable by space family |
| ⬜ | Custom space: user-created with custom dimensions, shape, axle/door/access config |
| ⬜ | Multi-space optimization: "find best combination of spaces for this item list" |
| ⬜ | Pallet support: `isPallet` flag, max weight, max stack height, overloaded pallet warning |

### 6F — Packlist Import into a Pack
*Distinct from the existing Case Library CSV/XLSX import. This imports a shipment list directly into a selected pack.*

| Status | Item |
|--------|------|
| ⬜ | Import a shipment list directly into a selected pack |
| ⬜ | Map columns to existing library cases or create new cases on import |
| ⬜ | Quantity column creates the requested number of instances |
| ⬜ | Preview column mapping and validate before applying |
| ⬜ | Duplicate matching by case ID, SKU, name, and dimensions |
| ⬜ | Handle common delimiters: comma, semicolon, tab |
| ⬜ | Excel (.xlsx) and CSV support |

### 6G — Sharing & Collaboration (Pro)
| Status | Item |
|--------|------|
| ⬜ | Read-only shareable pack link (3D viewer + stats, no edit) — Crew View |
| ⬜ | Secure share token (SHA-256 hash); slug alone must never grant access |
| ⬜ | Shared view: never expose billing, members, invites, or private tokens |
| ⬜ | Share link expiration support |
| ⬜ | Real-time collaboration: two users editing same pack (Supabase Realtime) |
| ⬜ | Activity log: who changed what in a pack |
| ⬜ | Comments on load plans |

### 6H — API Access (Enterprise Tier)
| Status | Item |
|--------|------|
| ⬜ | REST API for load plan CRUD (packs, cases) |
| ⬜ | API for running AutoPack programmatically |
| ⬜ | API keys per org, scoped to org data |
| ⬜ | Rate limiting per API key |
| ⬜ | OpenAPI / Swagger documentation |
| ⬜ | Embeddable 3D viewer (iframe or JS SDK) for customer websites |
| ⬜ | Outbound webhooks: pack created, AutoPack completed |

### 6I — Data & Stats Definitions
| Status | Item |
|--------|------|
| ⬜ | Define truck volume capacity formally per shape |
| ⬜ | Front Overhang: main-body volume + raised-overhang volume; exclude cab void |
| ⬜ | Wheel Wells: subtract blocked well volume |
| ⬜ | One clear definition of "Volume used" across UI, exports, and reports |
| ⬜ | Add packed cubic feet/meters only after calculation is trusted |
| ⬜ | Add weight capacity only after truck presets include max payload |
| ⬜ | Add axle and zone load summaries |
| ⬜ | Warnings when weight or zone limits exceeded |

### 6J — Display Controls (Editor View Menu)
*These are runtime toggles. Persistence of each toggle lives in 6L.*

| Status | Item |
|--------|------|
| ⬜ | Toggle truck exterior rails |
| ⬜ | Toggle front/rear color coding |
| ⬜ | Neutral monochrome truck rails for printing |
| ⬜ | Toggle blocked/no-load zones |
| ⬜ | Toggle wheel-well and cab-void guides |
| ⬜ | Toggle grid |
| ⬜ | Toggle item labels |
| ⬜ | Toggle dimensions |
| ⬜ | Center-of-gravity marker toggle (after 6C CoG service is done) |
| ⬜ | Loading-direction indicator (only when tied to real strategy from 5C) |
| ⬜ | Clean print/export mode with optional direction colors removed |

### 6K — Export & Print
| Status | Item |
|--------|------|
| ⬜ | Neutral print mode (rails optional) |
| ⬜ | Case outlines readable in PDF and screenshots |
| ⬜ | Front/rear labels in exports when user opts in |
| ⬜ | Load order and stop sequence in reports |
| ⬜ | Item manifest (packed/staged counts) |
| ⬜ | Volume and weight summaries |
| ⬜ | Exception warnings in manifest |
| ⬜ | "Paper by exception" report mode |
| ⬜ | Excel/CSV export of load plan (positions, weights, dimensions) |
| ⬜ | Branded PDF: org logo + name in header, configurable footer |

### 6L — Settings & Preferences
*This section covers persistence only. The feature itself is listed in its primary section.*

| Status | Item |
|--------|------|
| ⬜ | Persist user's default AutoPack strategy preference (cross-ref: 5C) |
| ⬜ | Persist each Editor Display toggle (cross-ref: 6J) |
| ⬜ | Unit system preference (metric vs imperial) — confirm current implementation is complete |
| ⬜ | Normalization and fallback values for all new preferences |
| ⬜ | Test preference persistence across reloads |

### 6M — Server-Backed Packs/Cases (Future Milestone)
| Status | Item |
|--------|------|
| ⬜ | Audit current local Pack/Case/Folder model and decide migration timing |
| ⬜ | Design server tables with `organization_id`, `created_by`, timestamps, role-aware RLS |
| ⬜ | Plan local draft/autosave behavior after server persistence exists |
| ⬜ | Plan migration from local workspace data to server data |
| ⬜ | Keep local export/import as backup even after server persistence |
| ⬜ | Cross-device sync |
| ⬜ | Server-side pagination and search (current implementation sorts/filters full in-memory arrays before pagination — fails at scale) |
| ⬜ | Object storage for pack preview thumbnails and assets (removes thumbnails from localStorage payload) |
| ⬜ | Webhook failure dashboard using `webhook_events.status` indexes |
| 🟡 | Scale readiness: 10 clients = 7/10 (viable with integration tests); 100 clients = 5/10 (localStorage limits, full-array render, billing fallback ambiguity); 1,000 clients = 2/10 without server-backed data, server pagination, and monitoring |

### 6N — Storage Space Planning & Comparison
*This is the consumer and moving/storage vertical. The same 3D engine that plans truck loads also answers: "Will my sofa, bed, boxes, and appliances fit in a 10×10 storage unit, a PODS container, or a garage condo?" This is a distinct product use case that needs its own items, starter content, and UI mode.*

**Item and space starter libraries:**
| Status | Item |
|--------|------|
| ⬜ | Furniture and household item starter library (sofa, bed, dresser, refrigerator, washer/dryer, boxes, etc.) |
| ⬜ | Self-storage unit presets: 5×5, 5×10, 10×10, 10×15, 10×20, 10×30 (cross-ref 6E) |
| ⬜ | Garage condo preset templates |
| ⬜ | Residential garage templates (1-car, 2-car, with door and column positions) |
| ⬜ | Portable storage container templates: PODS 8×8×16, 8×8×12, generic sizes |

**Space comparison workflow:**
| Status | Item |
|--------|------|
| ⬜ | User selects an item list and compares it across several spaces in one view |
| ⬜ | Fit result shown for every compared space (fits / does not fit / partially fits) |
| ⬜ | Packed volume, remaining volume, floor usage, and blocked items per space |
| ⬜ | Recommend the smallest space that safely fits all selected items |
| ⬜ | Show which items do not fit in a given space and why |
| ⬜ | Compare alternative layouts within the same space |
| ⬜ | Optional rental price input per space for cost comparison |
| ⬜ | "Best value" ranking combining fit, remaining space, and price |

**Space constraints (storage-specific):**
| Status | Item |
|--------|------|
| ⬜ | Support doors, columns, stairs, sloped ceilings, shelving, and fixed obstacle zones |
| ⬜ | Access-path clearance: items placed near the door must remain reachable (not trapped behind others) |
| ⬜ | Loading sequence that respects access order (last-in/first-out for storage) |
| ⬜ | Wall-hugging behavior for large items (sofas, appliances along walls first) |

**Output and sharing:**
| Status | Item |
|--------|------|
| ⬜ | "Room view" mode that does not look like a truck (no rail colors, no cab markers) |
| ⬜ | Storage layout, item manifest, and moving/loading order export |
| ⬜ | Customer-facing shared results link for storage companies and garage-condo sellers |
| ⬜ | Branded output for storage facility or moving company clients |

**Data model alignment:**
| Status | Item |
|--------|------|
| ⬜ | `spaceType: 'storage'` distinguishes storage spaces from road vehicles in the data model |
| ⬜ | Solver respects access-point geometry (door position, door width) when ordering items |
| ⬜ | No truck-specific fields (wheel wells, cab void, axle zones) appear in the storage UI |
| ⬜ | AutoPack strategy for storage: wall-first, then center fill, then vertical stacking |

---

## PART 7 — INTERNATIONALIZATION

| Status | Item |
|--------|------|
| ⬜ | All user-facing strings extracted to locale files (no hardcoded strings in JS) |
| ⬜ | Unit system: metric vs imperial — confirm current implementation is complete |
| ⬜ | Date formatting respects locale |
| ⬜ | Currency display for in-app billing pages |
| ⬜ | RTL support (do not break layout with absolute positioning) |
| ❓ | First language target: Spanish or Portuguese (decide based on market fit) |

---

## PART 8 — PERFORMANCE & BROWSER COMPATIBILITY

| Status | Item |
|--------|------|
| ⬜ | First meaningful paint under 3 seconds on 4G |
| ⬜ | Editor with 200+ cases maintains 30+ FPS |
| ⬜ | AutoPack on 100 items completes in under 5 seconds |
| ⬜ | `billing-status` API responds under 500ms (p95) |
| ⬜ | Chrome latest 2 versions |
| ⬜ | Firefox latest 2 versions |
| ⬜ | Safari latest 2 versions (test WebGL carefully) |
| ⬜ | Edge latest 2 versions |
| ⬜ | Mobile Safari (iOS) — 3D viewport touch controls |
| ⬜ | Mobile Chrome (Android) — 3D viewport touch controls |

---

## PART 9 — ACCESSIBILITY (WCAG 2.1 AA)

| Status | Item |
|--------|------|
| ⬜ | All interactive elements keyboard-navigable |
| ⬜ | Focus indicators visible |
| ⬜ | Color contrast meets AA ratio (4.5:1 for text) |
| ⬜ | Billing status, plan badges, error messages announced by screen reader |
| ⬜ | No information conveyed only by color (always pair with text or icon) |
| ⬜ | Touch targets meet minimum size on mobile |

---

## PART 10 — PRE-RELEASE GATE
*All must be checked before any public launch.*

- [ ] BUG-01 through BUG-07 from QA report resolved and regression-tested
- [x] `profiles` deletion-field server-side guard implemented and tested — migration `2026061301_guard_profile_deletion_fields.sql` deployed and live-verified 2026-06-14 on disposable test fixture; no real customer data used and no user purged
- [ ] P0 billing invariants pass for User1/User2/User3/User4
- [ ] Two-tab removed-member access loss verified live
- [ ] Portal sign-off: deep-link, schedule-managed fallback, stale-sub fallback
- [ ] Trial-expired gate verified in browser (test3)
- [ ] Workspace-limit-reached gate verified in browser (test2 fixture)
- [ ] No console errors in normal flows
- [ ] Terms of Service and Privacy Policy pages live
- [ ] Error tracking active in production
- [ ] Staging environment mirrors production
- [ ] Written release checklist exists and is filed
- [ ] Supabase DB password rotated
- [ ] SITE_URL is set (invite links use production domain)
- [ ] Resend sender domain is production domain
- [ ] All billing states tested: active, trialing, trial_expired, past_due_grace, workspace_limit_reached, included_in_plan

---

## PART 11 — FUTURE IDEAS
*See `docs/product/TP3D-FUTURE-IDEAS.md` for the full list. Summary index only:*

- **Storage & space planning**: garage condos, self-storage units, PODS containers, residential garages, space-comparison workflow, moving/loading order, customer-facing results for storage companies — fully tracked in 6N
- **AI & optimization**: reinforcement learning packing, natural language input, computer vision load verification, suggested orientations
- **Sustainability**: CO2e per scenario, Green Score, vehicle right-sizing, eco report
- **Mobile & field**: paperless loading guidance, phone-camera dimensioning, offline mode, AR overlay
- **Collaboration**: real-time co-editing, load plan versioning, approvals workflow, driver app
- **Integrations**: TMS/WMS/ERP webhooks, white-label embeddable widget, EDI 856/204, Shopify plugin, Zapier/Make
- **Analytics**: fleet utilization dashboard, case library analytics, AutoPack quality score, exception reporting
- **Enterprise**: SSO/SAML, custom branding/white-label, immutable audit trail, role-based field visibility, multi-tenant admin console
- **3D visual polish**: canvas-to-texture labels, category-based materials, ACES tone mapping, quality presets, beveled edges, richer space/truck models

---

## Execution Rules
1. **One phase at a time.** No mixing billing fixes with product feature work.
2. **Audit before implementation.** Confirm real reproduced bugs before writing code.
3. **Validate before merging.** `npm test`, `npm run lint`, `npm run -s typecheck`, `git diff --check`, browser checks.
4. **Keep changes small and testable.** If a task touches auth/billing/orgs/roles, treat as P0 risk.
5. **Update this file after each completed phase.** This is the single source of truth.
6. **Proof before marking ✅.** Add evidence to release-gate rows. A plain checkmark on a billing/security item is not enough months later.
