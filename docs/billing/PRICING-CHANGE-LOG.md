# Cargo Planner 3D — Pricing Change Log

This is the append-only operational ledger for approved pricing and pricing-configuration changes. It contains no historical entries at creation because no change may be inferred or backfilled without evidence.

Use [Pricing Operations Runbook](./PRICING-OPERATIONS-RUNBOOK.md) before planning, applying, validating, or rolling back a change.

## Append-only rules

1. Append one record for every approved change attempt, including rolled-back or aborted attempts that reached an external system.
2. Never edit or delete a signed-off record. Append a corrective record and link its original change ID.
3. Mask Stripe, Supabase, user, customer, subscription, Price, Product, event, and organization identifiers.
4. Never include keys, tokens, authorization headers, full session data, customer personal data, or unmasked payment identifiers.
5. Use `NOT RUN — <reason>` for an evidence layer that was not executed.
6. Do not mark future pricing or catalog behavior as current.

## Entry index

| Change ID | Date | Status | Stripe mode | Product (masked) | Tier | Interval | Old Price (masked) | New Price (masked) | Code SHA | Approver |
|---|---|---|---|---|---|---|---|---|---|---|

## Entry template

### `<CHANGE-ID>` — `<short description>`

| Field | Evidence |
|---|---|
| Date/time and timezone | |
| Status | Planned / Applied / Rolled back / Aborted |
| Stripe account and mode | |
| Product reference (masked) | |
| Tier | |
| Interval | |
| Old Price reference (masked) | |
| New Price reference (masked) | |
| Customer impact | |
| Grandfathering decision | |
| Subscriber migration | None / approved evidence reference |
| Implementation SHA | |
| Deployment project (masked) | |
| Deployed functions | |
| Static/frontend deployment | |
| Source/runtime evidence | |
| Local DB evidence | |
| Deployed-development evidence | |
| Stripe test-mode evidence | |
| Browser evidence | |
| Webhook evidence | |
| Portal evidence | |
| Workspace-limit/restore evidence | |
| Rollback rehearsal/evidence | |
| Customer communication | |
| Approver | |
| Final sign-off | |
| Notes and linked corrective change | |
