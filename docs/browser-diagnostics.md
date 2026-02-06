# Browser Diagnostics — Truck Packer 3D

These snippets are **copy/paste** friendly and are designed to help trace:

- auth state transitions (login/logout/user changes)
- race conditions (multiple in-flight calls)
- tab/overlay binding issues
- DOM mutations (duplicate modals)
- slow loads / fetches

They do **not** change app state unless you intentionally do so (e.g., sign in/out).

---

## 0) Quick toggles (optional)

Enable app debug logs (only if code respects it):

```js
localStorage.tp3dDebug = '1';
```

Disable:

```js
localStorage.removeItem('tp3dDebug');
```

---

## 1) Minimal Settings overlay snapshot

Use when you suspect tab desync or duplicate settings modals.

```js
(() => {
  const roots = [...document.querySelectorAll('[data-tp3d-settings-modal="1"]')];
  console.log('settings roots:', roots.length, roots);
  const root = roots[0];
  if (!root) return;

  console.log('instance:', root.getAttribute('data-tp3d-settings-instance'));
  console.log('tab buttons:', root.querySelectorAll('[data-tab]').length);
  console.log('tab panels:', root.querySelectorAll('[data-tab-panel]').length);

  const activeBtn = root.querySelector('[data-tab].active');
  const activePanel = root.querySelector('[data-tab-panel]:not([hidden])');

  console.log('active button:', activeBtn?.getAttribute('data-tab'));
  console.log('active panel:', activePanel?.getAttribute('data-tab-panel'));
})();
```

---

## 2) Modal/overlay add/remove observer

Logs any modal/dialog added to the DOM and prints a stack trace.

```js
(() => {
  const isModal = el =>
    el?.matches?.('.modal, [role="dialog"], [data-tp3d-settings-modal="1"]') ||
    el?.querySelector?.('.modal, [role="dialog"], [data-tp3d-settings-modal="1"]');

  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && isModal(n)) {
          console.warn('[MODAL ADDED]', n);
          console.trace();
        }
      }
      for (const n of m.removedNodes) {
        if (n.nodeType === 1 && isModal(n)) {
          console.warn('[MODAL REMOVED]', n);
          console.trace();
        }
      }
    }
  });

  obs.observe(document.body, { childList: true, subtree: true });
  console.log('Modal observer running. Use window.__tp3dModalObsStop() to stop.');
  window.__tp3dModalObsStop = () => obs.disconnect();
})();
```

---

## 3) MASTER DIAGNOSTIC SNIPPET (recommended)

This logs:

- Auth events (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED)
- Visibility changes (tab switches)
- Slow fetch calls
- Race conditions in auth methods and overlay helpers
- Storage changes (cross-tab)
- Modal + Settings tab snapshots

```js
(() => {
  if (window.__TP3D_DIAG__) {
    console.warn('[TP3D_DIAG] Already installed');
    return;
  }

  const VERSION = '2.0.0';
  const START = performance.now();
  const SESSION_ID = `diag-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const CONFIG = {
    debug: true,
    slowFetchMs: 2000,
    trackBindings: false, // set true if you want listener duplication detection
  };

  const events = [];
  let eventId = 0;
  const inflight = new Map();

  const log = (type, category, data = {}) => {
    const t = Math.round(performance.now() - START);
    const evt = { id: ++eventId, t, type, category, data };
    events.push(evt);
    if (CONFIG.debug) {
      const color =
        {
          auth: '#00bcd4',
          fetch: '#8bc34a',
          race: '#f44336',
          dom: '#9c27b0',
          storage: '#795548',
          user: '#4caf50',
          nav: '#3f51b5',
        }[category] || '#666';
      console.log(`%c[${t}ms] ${type}`, `color:${color};font-weight:bold;`, data);
    }
    return evt;
  };

  const getApi = () => window.SupabaseClient || window.__TP3D_SUPABASE_API || null;
  const getClient = () => getApi()?.getClient?.() || null;

  const trackInflight = (key, id) => {
    if (!inflight.has(key)) inflight.set(key, new Set());
    const set = inflight.get(key);
    set.add(id);
    if (set.size > 1) {
      log(`RACE: ${key}`, 'race', { key, inflight: set.size });
    }
    return () => {
      set.delete(id);
      if (!set.size) inflight.delete(key);
    };
  };

  const wrap = (obj, fnName, category) => {
    if (!obj || !obj[fnName] || obj[fnName].__tp3dWrapped) return;
    const original = obj[fnName].bind(obj);
    obj[fnName] = async (...args) => {
      const id = Math.random().toString(16).slice(2, 10);
      const stop = trackInflight(fnName, id);
      log(`CALL ${fnName}`, category, { id, args: args?.[0] });
      const start = performance.now();
      try {
        const res = await original(...args);
        log(`OK ${fnName}`, category, { id, ms: Math.round(performance.now() - start) });
        return res;
      } catch (e) {
        log(`ERR ${fnName}`, category, {
          id,
          ms: Math.round(performance.now() - start),
          msg: e?.message,
        });
        throw e;
      } finally {
        stop();
      }
    };
    obj[fnName].__tp3dWrapped = true;
  };

  // Fetch wrapper (slow call detection)
  const wrapFetch = () => {
    const original = window.fetch;
    if (!original || original.__tp3dWrapped) return;
    window.fetch = async (...args) => {
      const start = performance.now();
      try {
        const res = await original(...args);
        const ms = Math.round(performance.now() - start);
        if (ms >= CONFIG.slowFetchMs) {
          log('SLOW FETCH', 'fetch', { ms, url: String(args[0]) });
        }
        return res;
      } catch (e) {
        log('FETCH ERROR', 'fetch', { url: String(args[0]), msg: e?.message });
        throw e;
      }
    };
    window.fetch.__tp3dWrapped = true;
  };

  // Auth event logger
  const bindAuthEvents = () => {
    const api = getApi();
    if (!api?.onAuthStateChange) return;
    api.onAuthStateChange((event, session) => {
      const userId = session?.user?.id || null;
      const hasToken = Boolean(session?.access_token);
      log('AUTH EVENT', 'auth', { event, userId, hasToken });
    });
  };

  // Visibility / focus
  const bindVisibility = () => {
    document.addEventListener('visibilitychange', () => {
      log(document.hidden ? 'TAB HIDDEN' : 'TAB VISIBLE', 'nav', { hidden: document.hidden });
    });
    window.addEventListener('focus', () => log('WINDOW FOCUS', 'nav'));
    window.addEventListener('blur', () => log('WINDOW BLUR', 'nav'));
  };

  // Storage changes (cross-tab)
  const bindStorage = () => {
    window.addEventListener('storage', e => {
      log('STORAGE EVENT', 'storage', { key: e.key, newValue: e.newValue });
    });
  };

  // Settings overlay snapshot helper
  const snapshotSettings = source => {
    const roots = [...document.querySelectorAll('[data-tp3d-settings-modal="1"]')];
    const root = roots[0];
    const activeBtn = root?.querySelector?.('[data-tab].active');
    const activePanel = root?.querySelector?.('[data-tab-panel]:not([hidden])');
    log('SETTINGS SNAPSHOT', 'dom', {
      source,
      rootCount: roots.length,
      instanceId: root?.getAttribute?.('data-tp3d-settings-instance'),
      activeBtn: activeBtn?.getAttribute?.('data-tab') || null,
      activePanel: activePanel?.getAttribute?.('data-tab-panel') || null,
    });
  };

  // Optional binding duplication tracker
  const wrapAddEventListener = () => {
    if (!CONFIG.trackBindings) return;
    const orig = EventTarget.prototype.addEventListener;
    if (orig.__tp3dWrapped) return;
    const seen = new Map();
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const key = `${type}-${listener}`;
      const count = (seen.get(key) || 0) + 1;
      seen.set(key, count);
      if (count > 1) {
        log('DUPLICATE LISTENER', 'race', { type, count });
      }
      return orig.call(this, type, listener, options);
    };
    EventTarget.prototype.addEventListener.__tp3dWrapped = true;
  };

  const init = () => {
    log('DIAG INIT', 'auth', { version: VERSION, sessionId: SESSION_ID });
    wrapFetch();
    bindAuthEvents();
    bindVisibility();
    bindStorage();
    wrapAddEventListener();

    const check = setInterval(() => {
      const api = getApi();
      const client = getClient();
      if (!api || !client) return;
      clearInterval(check);
      wrap(client.auth, 'getSession', 'auth');
      wrap(client.auth, 'getUser', 'auth');
      wrap(client.auth, 'signInWithPassword', 'auth');
      wrap(client.auth, 'signOut', 'auth');
      wrap(api, 'getAccountBundleSingleFlight', 'auth');
      log('SUPABASE WRAPPED', 'auth', { ok: true });
      snapshotSettings('init');
    }, 100);
  };

  window.__TP3D_DIAG__ = {
    version: VERSION,
    sessionId: SESSION_ID,
    getEvents: () => events,
    summary: () => {
      const counts = events.reduce((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + 1;
        return acc;
      }, {});
      console.log('TP3D_DIAG SUMMARY', { events: events.length, counts });
      return { events: events.length, counts };
    },
    snapshotSettings,
    config: CONFIG,
  };

  init();
  console.log('%cTP3D_DIAG active', 'color:#00bcd4;font-weight:bold;');
})();
```

---

## 4) Quick auth snapshot

```js
(() => {
  const api = window.SupabaseClient || window.__TP3D_SUPABASE_API;
  if (!api) return console.log('No Supabase API');
  const state = api.getAuthState?.();
  console.log('AuthState:', {
    status: state?.status,
    userId: state?.user?.id || null,
    hasToken: Boolean(state?.session?.access_token),
  });
})();
```

---

## 5) Stress-test checklist (manual)

1. Open Settings overlay.
2. Rapidly click tabs (10–15 times).
3. Close the overlay.
4. Reopen the overlay; confirm the selected tab is still correct.
5. Switch browser tabs (Tab A ↔ Tab B) while overlay is open; confirm tabs still match panels.
6. If anything desyncs, run:
   - snippet #1 (Settings snapshot)
   - snippet #2 (Modal observer)
   - snippet #3 (Master diagnostic)

---

### Notes

- The diagnostic snippet is safe to run multiple times; it will refuse to install twice.
- It only wraps auth and fetch when those exist, and logs are toggleable.
- If things get too noisy, set `window.__TP3D_DIAG__.config.debug = false`.
