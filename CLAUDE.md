# CLAUDE.md — Truck Packer 3D

**Last updated:** 2026-08-08
**For:** Claude Code. See `AGENTS.md` for the complete authority and invariant reference.

---

## Authority Hierarchy

1. **Current source + tests** — definitive truth about current implementation.
2. **Domain contracts** — `docs/product/BILLING_ENTITLEMENT_RULES.md`, `docs/engineering/autopack-engine-contract.md`.
3. **V6 roadmap** — `docs/product/TP3D-MASTER-TODO-V6.md` — current operational status and approved queue.
4. **Project memory** — `bash tools/project-memory query "<question>"` — history and rationale.
5. **Graphify** — code index only, not authority.

Current source + tests wins over memory, Graphify, and all prior docs. V6 wins over V5.

---

## Retrieval Routing

| Question | Use |
|---|---|
| History / "why did we" / prior decisions | `bash tools/project-memory query "<question>"` — up to 3 passages |
| Code structure / "where is" / relationships | `graphify query/path/explain` against `graphify-out/graph.json` |
| Current behavior | Source and tests only |
| Generic programming | No retrieval needed |

Never load full `graph.json`, `GRAPH_REPORT.md`, or entire vault folders.

---

## Working Rules

1. **Inspect before edit.** `git status -sb`, `git diff --name-only` first.
2. **Minimal changes.** No refactor mixed with behavior. No unnecessary files.
3. **Fix root causes** — not symptoms, not UI polish over data bugs.
4. **Do not rewrite working architecture** because it is large.
5. **Backend leads billing changes.** Do not change entitlement in UI first.
6. **Stop on unexpected dirty state.** Confirm before proceeding.
7. **Protect production/Supabase data.** Never use it as a fixture.
8. **Never log secrets, tokens, or PII** even behind debug flags.

---

## Git Discipline

- `git status -sb` before any edit.
- `git diff --check` before commit.
- One focused change per commit.
- Never `--force` push, `reset --hard`, or drop unrecognized work without user confirmation.

---

## Critical Invariants (summary — full list in AGENTS.md)

- Auth, billing, workspace switching, cross-tab state, and storage are **P0 risk.**
- Use `src/core/operation-lifecycle.js` for all mutating editor operations.
- AutoPack / Unpack / Truck Change / preview capture are mutually disruptive — guard all paths.
- Billing entitlement uses normalized `entitlementStatus` field, not raw `status`.
- Owners only for checkout, portal, plan, and payment actions.
- Space Utilization is capacity-only — not a safety, compliance, or load-quality score.
- Three.js is r185.1 via npm/Vite. No React/R3F rewrite. No WebGPU migration now.

---

## Implementation Workflow (Claude Code)

See `src/CLAUDE.md` for scoped implementation workflow steps.

Short version:
1. Identify symptom and owning module.
2. Read only the owner file and relevant tests — not the full app.
3. Make the smallest safe fix.
4. Run `npm test` / `npm run lint` / `git diff --check`.
5. Summarize: files changed, why, risk, manual checklist.

For large files (`src/app.js`, `src/screens/editor-screen.js`, `src/ui/overlays/settings-overlay.js`): read targeted line ranges only.

---

## Memory Infrastructure

```
Config:    .ai/memory.json
CLI:       bash tools/project-memory query|record|promote "<text>"
Vault:     Truck-Packer-3D Obsidian Markdown vault (at path in .ai/memory.json)
```

Record meaningful completed work. Promote only durable Decisions/Lessons/Problems.
Explicit `tools/project-memory` retrieval works without a semantic memory graph.

---

## Graphify

`graphify query/path/explain` for code relationships. Start with `graphify-out/wiki/index.md`.
`graphify update .` after significant code changes.
Do not read `graph.json` wholesale. Do not hardcode node/edge counts.

---

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

## Security Follow-Up

`.claude/settings.local.json` is git-ignored and was previously flagged as potentially containing credential-bearing commands. Do not print or modify it during normal coding sessions. A dedicated credential/security cleanup is tracked in the V6 technical debt section.
