# Truck Packer 3D — Supabase Auth + Account Bundle: Issue Summary & Fix Playbook (as of 2026-02-03)

> Purpose: A single place to remember what went wrong, why it happened, what we changed, and how to debug it fast next time.

---

## 1) What we were building

### 1.1 Requirements
- Browser app (Truck Packer 3D) using Supabase Auth (email/password).
- “Account bundle” concept: after auth, load related data used by the UI:
  - `profiles` row
  - org list (from RPC `get_user_organizations` or fallback table query)
  - membership row (`organization_members`)
  - active org selection (first org by default)

### 1.2 Constraints
- Must work across multiple tabs.
- Must avoid “old user/org” showing after a login switch.
- Must avoid repeated or overlapping auth calls and state races.
- Keep code changes small and without new deps.

---

## 2) Symptoms we saw

### 2.1 “Stale user/org display” (core bug)
- Log in as user A, then sign out and sign in as user B (or do it in another tab).
- UI sometimes still shows user A’s account/org info after user B is active.
- This points to cached “account bundle” data or UI state being applied after auth changed.

### 2.2 “DIRECT CALL (BYPASSED WRAPPER): getSession” spam (mostly noise)
- Logs showed “DIRECT CALL (BYPASSED WRAPPER)” for `auth.getSession()`.
- Entries often appeared in tight bursts (2–3 calls in 1–2ms).

### 2.3 Profile query failures (406 Not Acceptable)
- `profiles` reads sometimes returned 406.
- In PostgREST, this commonly happens when `.single()` or `.maybeSingle()` expects 1 row, but 0 rows exist.

---

## 3) Key findings (what we proved)

### 3.1 The “bypassed wrapper” messages were mostly false positives
From Codex analysis of your logs:
- The stack traces were mainly `Generator.next` inside `supabase.min.js`.
- Supabase itself calls `auth.getSession()` internally (token access, refresh, lock/visibility paths).
- Our detection rule marked these as “bypassed” because the call stack did not include our single-flight wrapper markers.

**Conclusion:** treat these as internal Supabase calls unless the stack points to your own files (like `app.js` or UI modules).

### 3.2 Wrapping / patching was active in both tabs
You ran:

```js
const api = window.SupabaseClient || window.__TP3D_SUPABASE_API;
const client = api?.getClient?.();
console.log(
  'client', client,
  'auth.getSession === patched?',
  client?.auth?.getSession?.toString?.().includes('getSessionRawSingleFlight')
);
```

Result: `auth.getSession === patched? true` in both tabs.

**Conclusion:** wrapper enforcement is likely fine. The remaining bug is state/cache sync.

### 3.3 You already have the right primitives in `src/core/supabase-client.js`
From `Object.keys(window.SupabaseClient || window.__TP3D_SUPABASE_API).sort()`:

- `getAccountBundleSingleFlight`
- `invalidateAccountCache`
- `getAuthEpoch`
- `onAuthStateChange`
- `getAuthState`
- `getClient`
- plus auth helpers like `getSessionSingleFlight`, `getUserSingleFlight`, etc.

And in the file itself:
- `_authEpoch` monotonic counter
- `_inflightAccountPromise` single-flight promise
- `_accountCache` keyed by `userId:tokenSuffix` (`getAuthKey`)
- `resetAccountBundleCache()` which bumps epoch and clears inflight/cache
- `updateAuthState()` bumps epoch when user/token changes
- `initCrossTabLogout()` with BroadcastChannel + localStorage fallback

**Conclusion:** the correct fix is to ensure that:
1) auth events always clear bundle cache, and  
2) UI only applies bundle results if the auth epoch has not changed.

### 3.4 `invalidateAccountCache()` was incomplete for the stale-data bug
Current code:
```js
export function invalidateAccountCache() {
  _accountCache = { key: null, ts: 0, data: null };
}
```

But stale display can still happen if:
- `_inflightAccountPromise` continues and resolves after auth changes
- UI applies that result later

So cache invalidation needs to clear both:
- cached data (`_accountCache`)
- in-flight promise (`_inflightAccountPromise`)

---

## 4) Root cause (plain English)

### 4.1 Why “old user/org” showed up
This is a classic async race:
1) Tab A starts a bundle fetch for user A.
2) Auth changes to user B (or token refresh happens).
3) The earlier fetch resolves late and overwrites UI state with user A’s data.

Even if you have single-flight, it only prevents parallel requests. It does not stop old requests from applying results after auth changes unless you guard it.

### 4.2 Why it’s worse across tabs
- Each tab may have its own in-memory UI state.
- Logout broadcasts and auth storage updates can be slightly out of sync.
- If one tab applies old cached results after another tab signs in, the UI can drift.

---

## 5) Proposed solution (durable fix)

### 5.1 Make the Supabase client a strict singleton (defensive)
In `src/core/supabase-client.js`:
- `init()` should:
  - return existing `_client` early
  - store client on `window.__TP3D_SUPABASE_CLIENT` after creation (already present)
- Ensure other modules always get the same instance via `getClient()`.

### 5.2 “Auth epoch” + guarded UI apply (main fix)
You already have `_authEpoch` and `getAuthEpoch()`.

**Rule:**
- When an auth change happens (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED), do:
  - bump auth epoch
  - clear bundle cache + in-flight promise
- When UI awaits the bundle, do:
  - capture `epochAtStart`
  - await bundle
  - apply only if current epoch equals `epochAtStart`

This prevents late/stale results from being shown.

### 5.3 Make invalidate/reset clear BOTH cache and inflight
Update `invalidateAccountCache()` (or only use `resetAccountBundleCache`) to clear:
- `_accountCache`
- `_inflightAccountPromise`

Simplest: make `invalidateAccountCache()` call `resetAccountBundleCache('invalidate')`.

### 5.4 Handle profile “missing row” without blocking auth
Your bundle builder already does:
- `profileResult || _buildDefaultProfile(user)`

So policy should be:
- treat 406 / no rows as “profile missing” and continue
- do not stop login UI on that

---

## 6) Debug playbook (copy/paste)

### 6.1 Confirm one client, patched auth methods
Run in each tab:

```js
const api = window.SupabaseClient || window.__TP3D_SUPABASE_API;
const c = api?.getClient?.();
({
  hasClient: !!c,
  storageKey: c?.auth?._storageKey || c?.auth?.storageKey || null,
  getSessionWrapped: String(c?.auth?.getSession || '').includes('getSessionRawSingleFlight'),
  getUserWrapped: String(c?.auth?.getUser || '').includes('getUserRawSingleFlight'),
  authEpoch: api?.getAuthEpoch?.(),
  authState: api?.getAuthState?.()
});
```

### 6.2 Compare auth user vs bundle user (catch stale results)
```js
const api = window.SupabaseClient || window.__TP3D_SUPABASE_API;
api?.getAccountBundleSingleFlight?.({ force: true }).then(b => ({
  authUserId: api?.getAuthState?.()?.user?.id,
  bundleUserId: b?.profile?.user_id || b?.user?.id || b?.profile?.id || null,
  orgId: b?.activeOrg?.id || null,
  epoch: b?.epoch,
  nowEpoch: api?.getAuthEpoch?.()
}));
```

If `authUserId !== bundleUserId` or `b.epoch !== nowEpoch`, you are looking at stale or canceled data being applied.

### 6.3 Repo grep checks
From repo root:

```bash
grep -RIn "createClient(" src | head -n 50
grep -RIn "onAuthStateChange" src | head -n 50
grep -RIn "getAccountBundleSingleFlight" src | head -n 50
grep -RIn "invalidateAccountCache" src | head -n 50
grep -RIn "BroadcastChannel" src | head -n 50
```

---

## 7) Notes from your recent console + terminal output

### 7.1 Both tabs expose the same API surface
`Object.keys(window.SupabaseClient || window.__TP3D_SUPABASE_API).sort()` returned the same 30 functions in Tab A and Tab B.

That is good: it suggests the wrapper file is loaded consistently.

### 7.2 `__TP3D_WRAPPER_DETECTIVE__` is not defined
You tried:
```js
__TP3D_WRAPPER_DETECTIVE__.getBypassedCalls()
```
and got a ReferenceError in both tabs.

So either:
- the detective tool is not loaded anymore, or
- it was never exported globally, or
- it is behind a debug flag

This is fine; it means we should not treat old “bypassed wrapper” noise as a blocker.

### 7.3 Epoch + reset hooks already exist in code
In `init()` you already call:
```js
if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
  resetAccountBundleCache(event);
}
```

So remaining work is usually in `app.js`:
- clear UI-derived state on auth events
- guard bundle apply by epoch

---

## 8) Checklist: prevent repeats

### 8.1 When you add any new “cached account/org data”
- Cache must be cleared on auth events.
- Any async fetch must be guarded by auth epoch.

### 8.2 When you add new queries tied to a user
- “No rows” must not crash the app.
- Use `.maybeSingle()` where appropriate and handle 406 as “missing”.

### 8.3 Multi-tab
- Keep logout broadcast as best-effort.
- Avoid doing heavy bundle fetch work inside cross-tab handlers; just clear local state and let the active tab fetch.

---

## 9) Small code changes that usually fix it (high level)

### 9.1 `src/core/supabase-client.js`
- Make `invalidateAccountCache()` clear in-flight promise too (or call `resetAccountBundleCache()`).

### 9.2 `src/app.js`
- In `SupabaseClient.onAuthStateChange(...)`:
  - On SIGNED_OUT: clear UI state and render signed-out immediately.
  - On SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED:
    - `const epochAtStart = SupabaseClient.getAuthEpoch()`
    - `const bundle = await SupabaseClient.getAccountBundleSingleFlight({ force: true })`
    - apply only if `SupabaseClient.getAuthEpoch() === epochAtStart`

---

## 10) Common pitfalls
- Clearing only cached data but not the in-flight promise.
- Applying bundle results without checking if auth changed mid-flight.
- Treating missing profile row as fatal.
- Multiple auth listeners performing competing UI updates.

---

## 11) Where to look next time
- `src/core/supabase-client.js`
  - `updateAuthState()`
  - `bumpAuthEpoch()`, `resetAccountBundleCache()`, `invalidateAccountCache()`
  - `getAccountBundleSingleFlight()`
  - `initCrossTabLogout()`
- `src/app.js`
  - the main `onAuthStateChange` subscription
  - any “current user / current org / overlay state” setters
- UI overlays:
  - `src/ui/overlays/account-overlay.js`
  - `src/ui/overlays/settings-overlay.js`

---

## 12) One-liner reminder
If you see the wrong user/org after login, it is almost always a cache + async race. Fix it by clearing cache + inflight on auth change and guarding UI applies by auth epoch.
