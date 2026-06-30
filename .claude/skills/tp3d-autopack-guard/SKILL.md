---
name: tp3d-autopack-guard
description: Load before editing Truck Packer 3D AutoPack, packing geometry, editor placement, selection mutation, AutoPack/Unpack, Wheel Wells, Front Overhang, or support/stacking behavior.
---

# TP3D AutoPack Guard

Before editing AutoPack, packing geometry, editor placement, selection mutation, AutoPack/Unpack, Wheel Wells, Front Overhang, or support/stacking behavior, read:

`docs/engineering/autopack-engine-contract.md`

## Rules

- Do not implement before identifying whether the change affects hard rules, quality scoring, editor state, or UI explanation.
- Do not hardcode one screenshot size or one fixture dimension.
- Do not weaken hard rules to improve visuals.
- Do not fake support, raised floors, bridge spans, or blocked-zone clearance.
- Keep Standard, Wheel Wells, and Front Overhang behavior isolated unless the packet explicitly scopes all modes.
- Preserve instanceId-based mutation. Never delete pack instances by caseId.
- AutoPack is a whole-pack re-solve. Unpack is whole-pack staging. Clear or rebase selection after whole-pack mutations.
- If revalidation moves non-selected items to staging, report that to the user.
- Prefer source-depth audit before code changes.
- Prefer smallest isolated packet.
- Prefer behavior tests over regex/source-pattern tests.
- Run targeted tests during implementation and full validation before code commits.
- Browser verification is required for editor and 3D behavior.

## Deferred work that must not be started accidentally

- true Wheel Wells bridge/spanning;
- Front Overhang retaining-wall strategy;
- organized Unpack;
- manual vertical snap;
- multi-solution AutoPack;
- Web Worker / InstancedMesh rewrite;
- CoG/axle/legal payload scoring;
- fragile/top-layer solver behavior.
