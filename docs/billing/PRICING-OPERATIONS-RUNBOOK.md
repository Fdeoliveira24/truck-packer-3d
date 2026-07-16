# Cargo Planner 3D — Pricing Operations Runbook

## 1. Document Status

This is operational documentation for the current implementation. It is not a pricing decision, approval to modify Stripe, or a replacement for [Billing Entitlement Rules](../product/BILLING_ENTITLEMENT_RULES.md). Commercial pricing is not final.

The procedures below describe how the repository behaves at the time of writing. Future catalog behavior is labeled as future work. This runbook must be reviewed and updated after the behavior-preserving billing catalog is implemented.

## 2. Current Pricing Architecture

Pricing authority is split across three layers.

### Stripe

Stripe is authoritative for:

- Product and Price objects;
- amount and currency;
- recurring interval;
- whether a Product or Price is active for new purchases;
- subscription status and billing dates.

### Supabase Edge Functions

Edge Functions currently own:

- the checkout Price allow-list;
- month/year selection of the configured Pro Price;
- requested-workspace billing identity and normalized entitlement;
- trial, Pro, and Business workspace-limit selection;
- subscription and billing-customer projection from Stripe webhooks;
- organization-scoped portal resolution.

### Frontend

The frontend owns display labels, displayed marketing price text, and month/year selection. It sends an interval to the server. It has no authority to approve arbitrary Stripe Price IDs or determine entitlement.

Current display copy is hardcoded and duplicated:

- `getCheckoutPlanOptions()` describes monthly as `$19.99/mo` and yearly as `$199/yr`;
- the plan-picker cards display `$19.99` per month and `$16.67` per month, with yearly subcopy `Billed at $199.99/yr` and `Save 17%`.

These strings are non-authoritative and currently disagree on the yearly total. They must not be treated as approved commercial terms.

### Environment variables

Use variable names only in documentation and reports. Never print secret values or full Stripe object IDs.

| Purpose | Current variables |
|---|---|
| Stripe API | `STRIPE_SECRET_KEY` |
| Webhook verification | `STRIPE_WEBHOOK_SECRET` |
| Pro checkout and interval recognition | `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` |
| Business limit recognition in billing-status | `STRIPE_PRICE_BUSINESS_MONTHLY`, `STRIPE_PRICE_BUSINESS_YEARLY` |
| Workspace limits | `TP3D_TRIAL_WORKSPACE_LIMIT`, `TP3D_PRO_WORKSPACE_LIMIT`, `TP3D_BUSINESS_WORKSPACE_LIMIT` |
| Optional portal configuration | `STRIPE_PORTAL_CONFIGURATION_ID` |
| Supabase service access | `SUPABASE_URL`/`URL`, `SUPABASE_ANON_KEY`/`ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`/`SERVICE_ROLE_KEY` |

The current `.env.example` lists the Pro Price variables and optional portal configuration, but not the Business Price or workspace-limit variables. Source code remains the current implementation truth until the catalog centralizes configuration.

## 3. Current Source Map

| Concern | Current file/function | Environment variable | Authority | Changes customer money behavior? | Deployment required? | Current risk |
|---|---|---|---|---|---|---|
| Checkout allow-list | `supabase/functions/_shared/stripe.ts` → `assertAllowedPrice()` | Pro monthly/yearly Price variables | Server allow-list | Yes: controls which Price may be purchased | Secret-only change: configuration refresh; shared-code change: redeploy all importers | High; only two IDs are accepted |
| Interval-to-Price mapping | `supabase/functions/stripe-create-checkout-session/index.ts` → `priceIdFromInterval()` | Pro monthly/yearly Price variables | Server checkout | Yes | Secret-only change: configuration refresh; code change: deploy checkout | High; only `month` and `year` exist |
| Billing-status Price recognition | `supabase/functions/billing-status/index.ts` → interval normalization and `workspaceLimitForEntitlement()` | Pro and Business Price variables; three limit variables | App entitlement truth | Indirectly; changes access/limits, not Stripe amount | Secret-only change: configuration refresh; code change: deploy billing-status | P0; wrong mapping can grant or deny access |
| Restore workspace-limit logic | `supabase/functions/org-restore-workspace/index.ts` → `workspaceLimitForCandidate()` | Three limit variables | Restore authorization | No charge change; yes entitlement capacity | Secret-only change: configuration refresh; code change: deploy restore | P0; logic is duplicated and Business uses string heuristics |
| Webhook projection | `supabase/functions/stripe-webhook/index.ts` → `upsertSubscription()` | Stripe and webhook secrets | Stripe-to-database projection | Reflects billed state; does not choose checkout amount | Deploy webhook only when webhook/shared code changes | P0; `plan_name` is currently written as `pro` |
| Frontend plan options | `src/app.js` → `getCheckoutPlanOptions()` | None | Display only | No | Static frontend deployment | Medium; hardcoded copy can disagree with Stripe |
| Frontend plan picker | `src/app.js` → `pickCheckoutInterval()` | None | Display and interval selection | No direct authority | Static frontend deployment | Medium; duplicated yearly copy currently disagrees |
| Settings Billing CTA | `src/ui/overlays/settings-overlay.js` | None | Display and action routing | No direct authority | Static frontend deployment | Medium; must stay aligned with server truth |
| Workspace limits | `supabase/functions/billing-status/index.ts` and `supabase/functions/org-restore-workspace/index.ts` | Trial/Pro/Business limit variables | Server entitlement | No charge change; changes capacity | Deploy only functions whose code changes; secret-only update still needs runtime verification | High; defaults are duplicated (`1`, `3`, `10`) |
| Business recognition | `supabase/functions/billing-status/index.ts` exact Business Price IDs; `supabase/functions/org-restore-workspace/index.ts` Price/plan-name string matching | Business Price and limit variables | Limit recognition only | No active checkout path | Deploy affected function if code changes | High; recognition differs between functions |
| Test/live handling | `supabase/functions/_shared/stripe.ts`, `supabase/functions/stripe-webhook/index.ts` event storage, and deployment secrets | Stripe secret, Price IDs, webhook secret | Deployment configuration | Yes | No code deploy for secret-only correction; affected functions must be revalidated | P0; no explicit application mode marker enforces separation |
| Portal configuration | `supabase/functions/stripe-create-checkout-session/index.ts` and `supabase/functions/stripe-create-portal-session/index.ts` → `getPortalConfigurationId()` | `STRIPE_PORTAL_CONFIGURATION_ID` | Stripe portal behavior | Can affect plan-management choices | Secret-only change: configuration refresh; code change: deploy checkout and/or portal | High; requested organization must remain explicit |

Current duplication is intentional evidence, not an approved architecture: Pro Price variables are read by shared checkout code, checkout, and billing-status; limit variables are interpreted independently by billing-status and restore; frontend price copy exists separately from Stripe; Business recognition differs between billing-status and restore.

## 4. Current Known Pricing Constraints

- Commercial pricing is not final.
- Pro monthly and Pro yearly are the only approved checkout paths in current source.
- Business Price variables may be recognized for workspace limits by billing-status, and restore also recognizes Business through Price/plan-name text. Business is not in the checkout allow-list.
- Frontend displayed prices are hardcoded, duplicated, non-authoritative, and currently inconsistent for the yearly total.
- Checkout, billing-status interval normalization, and webhook projection support only `month` and `year`.
- An unknown, explicitly mapped active Price retains the current conservative paid fallback: it is treated as Pro for workspace-limit purposes unless it exactly matches a configured Business Price. Interval can remain `unknown` unless stored projection or Stripe lookup resolves it.
- The response has no `unknownPriceId` field.
- Checkout explicitly sets `allow_promotion_codes: false`. No coupon or promotion-code product feature is implemented or approved.
- No lifetime or complimentary entitlement feature is implemented.
- No supported existing-subscriber migration tool exists.
- Test/live separation depends on correct deployment secrets and Stripe mode. The app has no explicit mode marker tying Price IDs, Stripe keys, webhook events, and Supabase projects together.
- Webhook rows record Stripe's `livemode` flag, but current source does not use it as a complete deployment-mode enforcement contract.

## 5. Change-Type Decision Table

| Type | Stripe Dashboard action | Repository/config action | Affected functions | Frontend | Required deployment | Migration | Required tests | Rollback limits | Communication | Approved now? |
|---|---|---|---|---|---|---|---|---|---|---|
| A. Display copy only | None | Change both current display locations together | None | Update plan options and picker copy | Static frontend | No | Copy parity, monthly/yearly selection, checkout Price unchanged | Fully reversible before customers rely on copy | Required if public claim changes | Documentation/copy branch only with approval |
| B. Replace monthly Price | Create a new recurring monthly Price; keep old subscription Price | Update `STRIPE_PRICE_PRO_MONTHLY`; update display copy separately if amount changes | Checkout and billing-status consume config | Review monthly copy | Configuration refresh; deploy only changed code/static files | No | Full Section 10 matrix with monthly emphasis | Existing subscribers remain on old Price; charged invoices cannot be erased | Yes |
| C. Replace yearly Price | Create a new recurring yearly Price; keep old subscription Price | Update `STRIPE_PRICE_PRO_YEARLY`; update display copy separately if amount changes | Checkout and billing-status consume config | Review yearly total, monthly equivalent, savings claim | Configuration refresh; deploy only changed code/static files | No | Full matrix with yearly emphasis | Same as monthly | Yes |
| D. Replace both Prices | Create both new recurring Prices | Update both Pro Price variables and all display copy | Checkout and billing-status consume config | Review every displayed amount and savings claim | Configuration refresh plus any changed static/code deploy | No | Both intervals and rollback rehearsal | Larger blast radius; roll back each interval independently where possible | Yes |
| E. Change workspace limit only | None unless commercial Product terms also change | Update the relevant `TP3D_*_WORKSPACE_LIMIT` configuration | billing-status and restore | Update copy only if a visible promise changes | Configuration refresh; deploy only changed source | No | Direct, sibling, over-limit, archive/restore | Existing workspace access can change immediately | Yes only with explicit product approval |
| F. Add a recurring tier | Create Product/Prices only after product approval | New catalog/allow-list/limits/projection contract required | Checkout, billing-status, restore, webhook, portal review | New tier UI and copy | Multiple Edge functions plus static frontend | Maybe; audit first | Full new-tier matrix | Cannot safely roll back after customers subscribe without a support plan | Future work |
| G. Add another interval | Create Price with the approved interval | Extend interval types and every normalization/projection consumer | Checkout, billing-status, webhook; restore review | Add interval selection/copy | Affected Edge functions and static frontend | Maybe | New interval end-to-end | Existing sessions/subscriptions may outlive rollback | Future work |
| H. Stop new checkout for a tier | Deactivate/archive the current purchasable Price(s); do not delete Product/subscriptions | Optional user-facing unavailable copy; do not remove legacy entitlement recognition | Checkout behavior observed; entitlement functions should remain unchanged | Optional truthful unavailable state | Stripe action; static deploy only if copy changes | No | Checkout rejected, old entitlement/portal preserved | In-flight sessions may still require review | Yes as an incident action |
| I. Keep old subscribers grandfathered | Keep existing subscriptions on original Price | Preserve recognition and test old Price paths | billing-status, webhook, portal, restore | No automatic price promise | Deploy only if recognition code changes | No | Old subscriber access plus new checkout | Current source lacks an explicit legacy catalog; verification is mandatory | Safe default; commercial terms undecided |
| J. Move existing subscribers | Stripe subscription update after full approval | Dedicated migration tooling, evidence, recovery, and audit record | Webhook, billing-status, portal, restore | Communication/support UI as approved | Dedicated controlled release | Possibly | Rehearsal and per-subscription verification | Charges, prorations, and invoices may be irreversible | Required | Future work |
| K. Coupons or promotions | Create approved coupon/promotion objects | Checkout and entitlement policy design; current checkout disables promotion codes | Checkout, webhook, billing-status review | Coupon disclosure and terms | Affected Edge/static deploy | Maybe | Discount, renewal, cancellation, invoice tests | Redeemed discounts and invoices may not be fully reversible | Required | Future work |
| L. Lifetime or complimentary access | No current safe Stripe action | New entitlement model and source of truth required | Billing-status, gates, workspace limits, restore, admin controls | New truthful status/copy | Broad approved implementation | Likely | Full entitlement/security matrix | High risk of permanent access or revocation errors | Required | Future work |

## 6. Safe Price Replacement Procedure

Use this procedure for monthly, yearly, or both. A new Stripe Price is immutable in amount/currency/interval; replacement means creating a new Price.

1. Obtain explicit approval for the change type, customer impact, displayed copy, and rollback owner.
2. In the correct Stripe account's **test mode**, create the new recurring Price for the existing approved Product. Do not modify live mode yet.
3. Keep the old Price and existing subscriptions intact. Do not migrate subscribers.
4. Record masked old/new Price references in [Pricing Change Log](./PRICING-CHANGE-LOG.md).
5. Configure the new test Price ID in `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, or both for the intended non-production Supabase project.
6. Update repository code/config only where required. A secret-only Price replacement does not require changing the allow-list source because `assertAllowedPrice()` reads the variables. Frontend display copy is a separate change.
7. Run source/runtime tests, local database integration, typecheck, lint, and full repository tests.
8. Run deployed-development function checks against the intended project.
9. Complete a real Stripe test-mode checkout for each changed interval and confirm the Checkout Session uses the masked new Price reference.
10. Confirm webhook signature verification, idempotency, organization binding, Price ID, interval, status, and period projection.
11. Confirm `billing-status` returns the requested workspace's direct identity, correct interval/period, entitlement, and workspace limit.
12. Open the organization-scoped portal and confirm it targets the correct customer/subscription and configured portal behavior.
13. Archive and restore a safe fixture workspace to verify the same limit is used by restore logic.
14. Verify F12 direct-paid identity for directly paid siblings.
15. Verify included sibling coverage and over-limit behavior without relying on `includedOrgIds` as direct identity.
16. Verify active direct billing still blocks ownership transfer and that role/owner protections remain intact.
17. Update both frontend display-copy locations separately and prove they match the Stripe amount and approved wording.
18. Rehearse rollback in test mode: restore the previous configured Price reference and verify old checkout, billing-status, webhook, portal, and restore behavior.
19. Repeat the evidence process in live mode only after test-mode sign-off, with the live Stripe account, live Price, live webhook secret, and intended production Supabase project independently confirmed.
20. Only after validation may the old Price be deactivated/archived for **new purchases**. Do not delete the Product, Price, subscriptions, or customers.
21. Do not migrate existing subscribers automatically.

### Current limitation

There is no centralized billing catalog or explicit legacy-recognition list. Replacing the current Pro Price environment variable removes that old ID from explicit Pro interval recognition, although stored webhook interval and the current unknown-active-Price Pro fallback may preserve access. Business recognition is even more sensitive because it depends on current Business Price variables or restore heuristics. Inventory and test every existing Price before a live replacement; do not claim legacy support merely because the old Stripe subscription still exists.

The future catalog is expected to separate active checkout Prices from legacy recognition Prices, but that is not implemented today.

## 7. Grandfathering Policy — Current Safe Default

- Existing Stripe subscriptions stay on their original Price unless an explicitly approved migration changes them.
- Changing an environment Price ID does not modify existing Stripe subscriptions.
- Old Prices must remain supported by application recognition until a catalog provides explicit legacy recognition.
- Do not delete an old Product or Price. Do not deactivate an old Price for new purchases until existing-subscriber billing-status, webhook, portal, and restore behavior has been proved.
- Subscription migration is a separate, higher-risk operation.

This is an operational safety default, not final commercial grandfathering policy.

## 8. Existing Subscriber Migration Warning

> **High-risk operation — not approved by this runbook.** Moving an existing subscription to another Price can change invoices, renewal amounts, taxes, credits, and customer expectations. Rollback may be incomplete after Stripe creates a charge, proration, credit, or invoice.

Any subscriber migration requires:

- explicit approval and a named accountable owner;
- an exact affected-customer/subscription inventory;
- a proration decision;
- a renewal-date versus immediate-transition decision;
- test-mode rehearsal with equivalent subscription states;
- idempotent tooling;
- per-subscription before/after evidence;
- partial-failure recovery and safe restart behavior;
- customer communication and consent where required;
- a support plan;
- an audit record;
- a refund/credit policy.

Do not perform subscriber migration manually as an incidental part of a Price replacement.

## 9. Test and Live Environment Safety

- Never mix Stripe test and live secret keys, webhook secrets, Products, Prices, Customers, or Subscriptions.
- Never place secret keys in source control, documentation, screenshots, terminal transcripts, or browser code.
- Confirm Stripe key mode before any Price operation.
- Confirm the exact Supabase project before reading or setting secrets.
- Confirm the intended Stripe account and Dashboard mode independently.
- Mask Price, Customer, Subscription, event, user, organization, and project identifiers in reports.
- Never run fixture tooling against production and never use customer records as fixtures.
- Do not assume a Price ID exists in both Stripe modes. Stripe object IDs are mode-specific.
- Verify the webhook endpoint and signing secret for the same Stripe mode as the Price.
- Record `livemode` evidence from webhook events, but do not treat that field alone as a complete guard.

A future catalog/mode-marker contract should bind environment, Stripe mode, active Price set, and legacy recognition set explicitly. That is a recommendation, not current behavior.

## 10. Validation Matrix

Use the evidence classifications exactly: **source/runtime**, **local DB**, **deployed development**, **Stripe test mode**, **browser**, and **controlled live**. A source test is not Stripe evidence, and local DB fixtures are not hosted evidence.

| Check | Source/runtime | Local DB | Deployed development | Stripe test mode | Browser | Controlled live |
|---|---:|---:|---:|---:|---:|---:|
| Monthly checkout and configured Price | Required | Supporting | Required | Required | Required | Required before release |
| Yearly checkout and configured Price | Required | Supporting | Required | Required | Required | Required before release |
| Invalid Price rejection | Required | Supporting | Required | Required | Optional | Spot-check |
| Old subscriber access | Required | Required fixture where representable | Required | Required | Required | Required inventory sample |
| New subscriber receives new Price | Required | Supporting | Required | Required | Required | Required controlled purchase |
| Billing-status interval | Required | Required | Required | Required | Required | Required |
| Billing-status period end | Required | Required | Required | Required | Required | Required |
| Workspace limit | Required | Required | Required | Required | Required | Required |
| Direct-paid requested-workspace identity | Required | Required | Required | Required | Required | Required |
| Included sibling coverage | Required | Required | Required | Required | Required | Required |
| Over-limit behavior | Required | Required | Required | Required | Required | Required |
| Portal subscription target | Required | Supporting | Required | Required | Required | Required |
| Webhook projection/idempotency | Required | Supporting | Required | Required | Indirect | Required |
| Workspace restore | Required | Required | Required | Required | Required | Required |
| Ownership-transfer billing guard | Required | Required | Required | Required | Required | Required |
| Role and canonical-owner protections | Required | Required | Required | Supporting | Required | Spot-check |
| Sanitized errors and masked reports | Required | Required | Required | Required | Required | Required |
| Frontend display-copy parity | Required | Not applicable | Deployed static check | Compare to Dashboard | Required | Required |
| Rollback rehearsal | Required | Required | Required | Required | Required | Documented live plan before release |

Do not mark a column passed when that evidence layer was not run. Record **NOT RUN** with the reason.

## 11. Deployment Matrix

| Change | `billing-status` | `stripe-create-checkout-session` | `org-restore-workspace` | `stripe-webhook` | `stripe-create-portal-session` | Frontend/static |
|---|---|---|---|---|---|---|
| Display copy only | No | No | No | No | No | Yes |
| Pro Price secret value only | Validate runtime; no source deploy | Validate runtime; no source deploy | No, unless limits/tier logic also changes | No source deploy; validate projection | No source deploy; validate portal | Only if copy changes |
| Workspace-limit secret only | Validate runtime | No | Validate runtime | No | No | Only if visible promise changes |
| Checkout allow-list or interval code | If shared `_shared/stripe.ts` changes, yes | Yes | Review only | If shared `_shared/stripe.ts` changes, yes | If shared `_shared/stripe.ts` changes, yes | If selector/copy changes |
| Billing recognition/tier mapping | Yes | If checkout availability changes | Yes when restore mapping/limit changes | Yes when projection changes | Review organization/plan targeting | Yes when visible tier/copy changes |
| Webhook projection only | Review consumer compatibility | No | Review projected fields | Yes | Review projected mapping | No unless status copy changes |
| Portal configuration secret only | No | Validate existing-subscription redirect | No | No | Validate runtime | No |

Setting an Edge secret/configuration value and deploying function source are different operations. Do not redeploy an unaffected function merely because another function changed. Conversely, changing `_shared/stripe.ts` requires redeploying every current importer: billing-status, checkout, portal, and webhook.

## 12. Rollback Procedures

| Failure | Immediate stop | Code/config rollback | Stripe action | Supabase repair | Customer communication | Irreversible effects | Evidence after rollback |
|---|---|---|---|---|---|---|---|
| Wrong display copy | Pause promotion/share links | Revert static copy and redeploy | None | None | Correct material if published | Customer confusion | Screenshots plus checkout Price comparison |
| Wrong checkout Price ID | Stop new checkout; deactivate wrong purchasable Price if necessary | Restore prior Price variable | Preserve objects; cancel only proven erroneous sessions/subscriptions under incident approval | Correct projection only from Stripe truth | Contact affected purchasers | Completed charges/invoices may remain | Session/subscription inventory, webhook and billing-status proof |
| Wrong workspace limit | Stop limit/config rollout | Restore prior limit in every consumer | None | Repair only proven incorrect projection/access state if needed | Notify customers whose access changed | Temporary access denial/grant | Direct/sibling/over-limit/restore matrix |
| Wrong tier mapping | Disable affected new checkout | Restore prior recognition/limit mapping | Keep existing objects | Reconcile affected projections from Stripe truth | Required for entitlement impact | Access may have been granted/denied | Per-workspace entitlement evidence |
| Bad webhook projection | Keep event retries available; pause risky follow-on operations | Revert webhook code and redeploy | Do not delete Stripe truth | Replay/reconcile idempotently from verified events | If customer access/payment UI was wrong | External Stripe event already occurred | Event IDs masked, projection before/after, billing-status |
| Test/live mismatch | Stop all billing actions immediately | Restore correct mode-specific secrets | Do not copy/delete cross-mode objects | Remove only exact test pollution from non-production; escalate any live impact | Required for any live exposure | Live objects/charges cannot be moved to test | Independent account/mode/project verification |
| Accidental subscriber migration | Stop migration tool/job | Disable migration path; do not blindly reverse | Follow approved per-subscription recovery | Reconcile from final Stripe state | Mandatory | Proration, invoice, charge, tax, credit may persist | Per-subscription audit and financial reconciliation |
| Unintended Business checkout | Deactivate unintended purchasable Price | Restore Pro-only allow-list/config and redeploy affected code | Preserve existing affected subscriptions pending decision | Reconcile tier/limit projection | Mandatory for purchasers | Existing contracts/charges may remain | Checkout rejection plus affected-subscriber inventory |

Never repair billing by broad database deletion or by making Supabase projection contradict Stripe.

## 13. Emergency Checkout Stop

There is no current application checkout kill switch. The checkout function always resolves one of the configured Pro Price IDs and validates it against the same two-ID allow-list.

The smallest no-code emergency action is:

1. Confirm the affected Stripe account and mode.
2. Deactivate/archive the affected currently configured Pro Price for new purchases. Deactivate both monthly and yearly Prices to stop all new checkout.
3. Leave Products, Customers, Subscriptions, and existing entitlement projections intact.
4. Verify new Checkout Session creation is refused for each stopped interval.
5. Verify existing subscribers still receive correct billing-status, portal access, workspace limits, and Pro entitlement.
6. Record the incident and masked Price references.

Do not delete Stripe objects. Do not cancel customer subscriptions as a checkout-stop mechanism. Removing a required Price secret can also stop checkout, but because those variables are read by billing-status for interval recognition, it has a broader diagnostic blast radius and is not the preferred first action.

## 14. Pricing Change Evidence Template

Copy this block into an approved change record. Mask every external identifier.

```text
Change ID:
Date/time and timezone:
Approved by:
Implementation SHA:
Deployment project (masked):
Stripe account/mode:
Tier:
Interval:
Old Price reference (masked):
New Price reference (masked):
Change type (A–L):
Customer impact:
Grandfathering decision:
Migration performed: no / approved reference
Source/runtime results:
Local DB results:
Deployed-development results:
Stripe test-mode results:
Browser results:
Webhook results:
Portal results:
Workspace-limit/restore results:
Rollback rehearsal:
Customer communication:
Open gaps:
Final sign-off:
```

Append the final record to [Pricing Change Log](./PRICING-CHANGE-LOG.md). Never overwrite an older entry; append a corrective entry linked to the original change ID.

## 15. Open Decisions

The following remain unresolved and are not approved by this runbook:

- final monthly price;
- final yearly price;
- annual savings/discount representation;
- Business tier launch and included features;
- final Trial, Pro, and Business workspace limits;
- trial duration and eligibility policy;
- founder pricing;
- refund policy;
- cancellation timing;
- proration policy;
- tax handling;
- supported currency/currencies;
- existing-subscriber migration or commercial grandfathering;
- coupon and promotion policy;
- lifetime and complimentary access.

Operational priority and approval come from [Master TODO V5](../product/TP3D-MASTER-TODO-V5.md). Broader context is preserved in the [July 2026 Product Strategy Debrief](../product/PRODUCT-STRATEGY-DEBRIEF-2026-07.md).

## 16. Post-Catalog Update Requirement

After the behavior-preserving billing catalog is implemented, update this runbook to reflect the actual new source of truth for:

- centralized Price resolution;
- active checkout Prices;
- legacy recognition Prices;
- tier-to-workspace-limit mapping;
- unknown Price diagnostics;
- test/live mode rules;
- the reduced function/file change surface.

Do not update this document prospectively. Only document catalog behavior after implementation and validation.
