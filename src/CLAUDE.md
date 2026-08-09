# src/CLAUDE.md — Implementation Workflow Guide

**Subordinate to root `CLAUDE.md` and `AGENTS.md`.** Root files define project authority, invariants,
retrieval routing, and critical safeguards. This file adds Claude Code-specific implementation
workflow for `src/` work.

---

## Token-Safe Audit Discipline

Before reading large files, check the task scope:

- Read only the owner file, the related test file, and any named service files.
- Do not open full `src/app.js` unless the task is explicitly about app wiring or shortcuts.
- Prefer targeted `rg` / `grep` searches over opening long files wholesale.
- Use `git status -sb`, `git diff --name-only` first. Leave unrelated dirty files alone.
- Do not spend context budget proving facts already shown by terminal output.

Default scope for operation lifecycle work:
- `src/core/operation-lifecycle.js`
- `src/services/autopack-engine.js`
- `src/screens/editor-screen.js`
- `src/ui/truck-change-controller.js`
- `src/app.js` — lifecycle wiring and keyboard shortcuts only
- `styles/main.css` — busy/spinner styling only

---

## Implementation Steps

1. **Identify:** What is happening, what should happen, which module owns it.
2. **Locate:** UI entrypoint → state update → side effects → render.
3. **Fix:** Smallest safe change at the root cause, not symptoms.
4. **Guard:** Add epoch/version checks for stale async; debounce for noisy events; single-flight for duplicate calls.
5. **Validate:** `npm test`, `npm run lint`, `git diff --check`, manual checklist.
6. **Summarize:** Files changed, why, risk level, follow-ups.

---

## Debug Tools

- `localStorage.tp3dDebug = "1"` — enables verbose console logs.
- `window.__TP3D_WRAPPER_DETECTIVE__` — if present: `.getWrapperUsage()`, `.smokeTest()`.
- Logs must be short, safe, and gated behind `tp3dDebug`. Never log tokens or PII.

---

## Overlay Safety Rules

Overlay open handlers should:
- Close dropdowns → close competing overlay → open target overlay.
- **Not trigger global rehydration** that can replace DOM, unless proven safe.
- If rehydration is needed: do it after the overlay is stable, with a short delay, and only if required.

---

## When Fixes Fail

1. Confirm reproduction steps still match.
2. Add 1–2 targeted logs (behind `tp3dDebug` only).
3. Verify assumptions — is the event firing? is the module loaded? is state updated?
4. Adjust with the smallest possible change. Do not stack fixes hoping one works.
5. If side effects appear: revert or reduce scope immediately and re-approach.
