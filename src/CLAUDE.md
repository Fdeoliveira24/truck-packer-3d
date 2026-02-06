# CLAUDE.md — Truck Packer 3D (TP3D) Agent Operating Guide

This file is the single source of truth for how an agent should work inside this repo. It is meant
for Claude Code, but it also works for any coding agent.

---

## #Agent instruction

You are an engineering agent working in the **Truck Packer 3D** codebase.

Your top goals:

1. Fix bugs without breaking existing behavior
2. Keep changes small, testable, and easy to review
3. Prefer stable, readable code over clever code
4. Prevent regressions in auth, overlays, and state handling
5. Keep logs useful when `localStorage.tp3dDebug = "1"` is enabled
6. Avoid “quick fixes” that hide root causes

If you are unsure, choose the safer change (least surface area) and add a short note in comments
explaining why.

---

## ## The WAT architecture

WAT = **Workflows → Agents → Tools**

This repo expects structured work. Do not jump straight into edits. Follow the layers.

---

## #Layer 1: Workflows (The instructions)

### 1.1 Workflow: Understand the issue

- Read the bug report or user message carefully.
- Identify:
  - What is happening
  - What should happen
  - Steps to reproduce
  - Scope (files, screens, user types)
- Find the “owner area” in code (the most direct module for the behavior).

### 1.2 Workflow: Locate the real source

- Search for:
  - The UI entrypoint (where user action starts)
  - The state update
  - The side effects (network calls, storage, DOM changes)
- Trace the full path: UI event → handler → service wrapper → state update → render

### 1.3 Workflow: Make a minimal fix

- Fix the root cause, not symptoms.
- Prefer changing one place over patching many places.
- Keep changes tight:
  - No unrelated refactors
  - No renaming for style
  - No formatting-only commits unless requested

### 1.4 Workflow: Add guard rails

Add guard rails when the bug is caused by timing, repeated events, or async races:

- Single-flight promises for duplicate calls
- Timeouts where requests can hang
- “epoch” or “version” checks for stale async results
- Debounce/throttle for noisy events

### 1.5 Workflow: Validate

- Run existing tests or scripts if available.
- If no tests exist for the area:
  - Add a small debug log path (behind tp3dDebug)
  - Provide a manual test checklist

### 1.6 Workflow: Document the outcome

When you finish:

- Summarize what changed and why
- List the files changed
- Give a short manual test list
- Mention any known limits or follow-ups

---

## #Layer 2: Agents (The decision making)

### 2.1 How you decide what to change

When choosing an approach, rank options like this:

1. Fix inside the module that owns the behavior
2. Fix at the boundary layer (service wrapper / adapter)
3. Fix at call sites only if the owner module cannot be changed

Never “spray” fixes across many files unless the system truly needs it.

### 2.2 Priority rules (important)

1. **Auth correctness** is higher priority than UI convenience
2. **No silent sign-outs** because of tab visibility or brief stalls
3. **Overlays must not close due to unrelated state refresh**
4. **Cross-tab logout must not cause loops**
5. **Offline behavior must not destroy valid user state**
6. **Avoid repeated cache invalidation unless user or token changed**

### 2.3 Stability rules

- Avoid introducing new dependencies.
- Avoid deep rewrites.
- Prefer predictable control flow.
- Add comments only where needed to prevent future mistakes.

### 2.4 Security mindset

- Never log secrets (tokens, passwords).
- Never store passwords in the repo.
- Be careful with:
  - localStorage/sessionStorage keys
  - “global signOut”
  - event listeners that run in all tabs

### 2.5 Performance mindset

- Avoid repeated network calls from:
  - visibility/focus handlers
  - timers
  - overlay open/close
- Use caches with clear TTL or clear invalidation rules.

---

## #Layer 3 Tools (The Execution)

This project uses plain browser JS with modular files. Most work is done by editing repo files and
running scripts.

### 3.1 Code search tools

- Prefer `rg` (ripgrep) if installed.
- If not available, use `grep -RIn`.

Examples:

- `rg -n "functionName" src`
- `grep -RIn "functionName" src`

### 3.2 Runtime debug tools

- Use `localStorage.tp3dDebug = "1"` to enable extra logs.
- Use `window.__TP3D_WRAPPER_DETECTIVE__` if present:
  - `__TP3D_WRAPPER_DETECTIVE__.getWrapperUsage()`
  - `__TP3D_WRAPPER_DETECTIVE__.smokeTest()`

### 3.3 Preferred instrumentation style

- Logs must be short and safe.
- Wrap logs behind `tp3dDebug`.
- Do not log raw access tokens or user PII beyond userId.

### 3.4 Git discipline

- Keep commits focused (one fix per commit when possible).
- Do not mix doc moves with logic changes in the same commit unless asked.
- If you must move files, do it in a separate commit.

---

## **Why this matters**

This repo is sensitive to:

- async races around auth and session reads
- multiple tabs broadcasting logout
- UI overlays being replaced by re-render or rehydration code
- hidden/visible tab behavior causing false negatives

A small “helpful” change can create:

- random sign-outs
- infinite auth loops
- overlays that close right after opening
- repeated calls that flood the network

So the agent must work carefully and prove changes with checks.

---

## # How to Operate

### 4.1 Start every task with this checklist

1. Identify the user-facing symptom
2. Reproduce it (or follow the steps given)
3. Find the owning module
4. Add a tiny debug trace (behind tp3dDebug) if needed
5. Make the smallest safe fix
6. Validate (tests or manual checklist)
7. Summarize clearly

### 4.2 Work in numbered steps

When writing plans or instructions, use numbered steps. When a step has sub-steps, use decimals
(1.1, 1.2, ...).

### 4.3 Avoid hidden state surprises

When working on auth/session:

- Use a single source of truth for session/user state
- Treat “hidden tab” as “do not assume signed out”
- Avoid clearing state unless you are sure

### 4.4 Overlay safety rules

Overlay open handlers should:

- Close dropdowns
- Close the other overlay
- Open the target overlay
- **Not trigger global rehydration that can replace DOM** unless proven safe

If you need rehydration, do it:

- after overlay open is stable
- with a short delay
- and only if needed

---

## **Look for existing tools first**

Before adding new helpers, search the repo for:

- existing wrappers (SupabaseClient)
- debug helpers (tp3dDebug patterns)
- existing state store functions
- existing event names and handlers

If a helper exists, use it. Do not create a second competing helper.

---

## **Learn and adapt when things fail**

If your fix does not work:

### 5.1 Debug loop

1. Confirm reproduction steps still match
2. Add 1–2 targeted logs (tp3dDebug only)
3. Verify assumptions (is the event firing? is the module loaded? is the state updated?)
4. Identify where the expected flow breaks
5. Adjust with the smallest possible change

### 5.2 Do not “stack fixes”

Do not add multiple patches hoping one works. Find the actual break and fix that.

### 5.3 When reverting is best

If changes cause side effects:

- revert or reduce scope immediately
- re-approach with a safer plan

---

## **Keep workflow current and the self improvement loop**

When you learn something important (like a recurring failure mode), update this file.

Examples of things worth adding:

- a new reliable reproduction step
- a common regression pattern
- a new debug command that proved useful
- an agreed rule (example: “do not validate auth while hidden”)

Keep updates short and specific.

---

## File structure (high level)

Common areas you will touch:

- `src/app.js`  
  Main entrypoint. Wires UI, screens, overlays, and event handlers.

- `src/core/supabase-client.js`  
  Supabase wrapper with guards: single-flight, timeouts, offline behavior, cross-tab sync.

- `src/ui/overlays/*`  
  UI overlays such as auth, account, settings.

- `src/core/*`  
  State store, session, storage, events, defaults.

- `src/services/*`  
  Data services for cases, packs, import/export, preferences.

When changing behavior, prefer editing the “owner” layer:

- UI bug → overlay module or app wiring
- Auth/session bug → `supabase-client.js`
- State bug → state-store or normalizer

---

## Core principles

1. Fix root causes
2. Keep changes small
3. Guard async code against races
4. Respect offline and hidden tab conditions
5. Avoid duplicate listeners and duplicate network calls
6. Never leak secrets into logs
7. Prefer simple code that the next person can follow

---

## Bottom line

Make the smallest safe change that fixes the issue, prove it with checks, and protect the project
from the same bug returning.
