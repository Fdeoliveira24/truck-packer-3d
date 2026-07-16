# Truck Packer 3D Docs

This folder is organized by document purpose.

Start with [`product/TP3D-MASTER-TODO-V5.md`](product/TP3D-MASTER-TODO-V5.md) for the active operational status, blockers, and approved execution queue.

Use [`product/PRODUCT-STRATEGY-DEBRIEF-2026-07.md`](product/PRODUCT-STRATEGY-DEBRIEF-2026-07.md) as a supporting reference for broad product direction, open decisions, and deferred candidates. It does not approve implementation or create active work.

- `product/`: current product rules, entitlement rules, product comparisons, and active planning docs that should guide implementation.
- `dev/`: developer setup, operational references, and command playbooks.
- `review/`: potentially useful docs that are not authoritative until reviewed.
- `audits/`: completed audit reports and release-gate evidence.
- `archive/`: historical notes retained for context only; do not use archived files as implementation source of truth.

Authority is defined by document purpose, not folder location alone:

- [Master TODO V5](product/TP3D-MASTER-TODO-V5.md) controls current operational status, blockers, and the approved execution queue.
- Named domain contracts control behavior within their defined scope.
- The [July 2026 Product Strategy Debrief](product/PRODUCT-STRATEGY-DEBRIEF-2026-07.md) preserves strategy context; it does not override V5, domain contracts, or branch approval.
- `AGENTS.md`, `CLAUDE.md`, and scoped agent guides control working rules.
- Plans and runbooks describe proposed work or operational procedures; they do not override V5 or domain contracts.
- Audits and review documents are evidence and findings, not live behavioral contracts.
- Archive documents are historical and cannot authorize current work.
