---
name: tp3d-autopack-guard
description: Load before editing Truck Packer 3D AutoPack, packing geometry, editor placement, selection mutation, AutoPack/Unpack, Wheel Wells, Front Overhang, or support/stacking behavior.
---

# TP3D AutoPack Guard

Before editing AutoPack, packing geometry, editor placement, selection mutation, AutoPack/Unpack, Wheel Wells, Front Overhang, or support/stacking behavior, first confirm repo state, then read the source-of-truth contract:

`docs/engineering/autopack-engine-contract.md`

Start every scoped change with:

```bash
git status -sb
git rev-parse --short HEAD
git log --oneline -8
```

If the working tree has unrelated dirty files, stop and report before editing.

## Rules

- Do not implement before identifying whether the change affects hard rules, quality scoring, editor state, or UI explanation.
- Do not hardcode one screenshot size or one fixture dimension.
- Do not weaken hard rules to improve visuals.
- Do not fake support, raised floors, bridge spans, or blocked-zone clearance.
- Keep Standard, Wheel Wells, and Front Overhang behavior isolated unless the packet explicitly scopes all modes.
- Preserve instanceId-based mutation. Never delete pack instances by caseId.
- AutoPack is a whole-pack re-solve. Unpack is whole-pack staging. Clear or rebase selection after whole-pack mutations.
- If revalidation moves non-selected items to staging, report that to the user.
- Prefer source-depth audit before code changes, especially when browser behavior disagrees with green tests.
- Separate source-depth audit, implementation, validation, and browser verification into distinct phases.
- Prefer smallest isolated packet.
- Prefer behavior tests over regex/source-pattern tests.
- Run targeted tests during implementation and full validation before code commits, except for docs-only changes.
- Browser verification is required for editor and 3D behavior.
- Keep delete/revalidation UX separate from AutoPack solver quality work.
- Keep persistence/Supabase/billing/auth work separate from solver/editor packets.
- Do not mark a solver packet complete based on tests alone when the browser result is visually or operationally unacceptable.

## Deferred work that must not be started accidentally

- true Wheel Wells bridge/spanning;
- Front Overhang retaining-wall strategy;
- organized Unpack;
- manual vertical snap;
- multi-solution AutoPack;
- Web Worker / InstancedMesh rewrite;
- CoG/axle/legal payload scoring;
- fragile/top-layer solver behavior.

## Current known follow-ups

- Delete/revalidation UX contract: deleting one support case may stage dependents; the user must be told what moved and why.
- Wheel Wells constrained leftover pass: after floor/filler/stack, try staged leftovers into remaining legal floor/channel holes with smaller/channel-fitting cartons prioritized.
- Front Overhang retaining-wall strategy.
- Organized Unpack.
- Manual vertical placement.
- AutoPack Results / Case Browser counts.
- Persistence Track B must stay separate from solver/editor packets.
