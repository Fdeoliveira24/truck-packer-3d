/*
  Truck Packer 3D - Runtime Debugger (opt-in)
  - Default OFF
  - Enables only when localStorage.tp3dDebug === '1', ?tp3dDebug=1, or window.__TP3D_FORCE_DEBUG__ === true
  - No runtime behavior changes when disabled
*/

const DEBUG_VERSION = '2.0.0';
const DEFAULT_MAX_EVENTS = 8000;
const DEFAULT_SLOW_FETCH_MS = 2000;
const PERSIST_KEY = 'tp3dDiagPersist';
const PERSIST_MAX_EVENTS = 400;
const PERSIST_MIN_INTERVAL_MS = 1500;

let _active = false;
let _startTime = 0;
let _sessionId = null;
let _eventId = 0;
const _events = [];
const _inflight = new Map();
let _pollTimer = null;
let _modalObserver = null;
let _wrappedFetch = false;
let _wrappedStorage = false;
let _wrappedHistory = false;
let _longTaskObserver = null;
let _lastPersistAt = 0;

let _supabaseInitWarned = false;
let _supabaseAttachWarned = false;
let _supabaseWrapStatusRecorded = false;
function safeString(v) {
  try {
    return v == null ? '' : String(v);
  } catch {
    return '';
  }
}

function fnPreview(fn, maxLen = 200) {
  try {
    if (typeof fn !== 'function') return null;
    const src = Function.prototype.toString.call(fn);
    return src.replace(/\s+/g, ' ').slice(0, maxLen);
  } catch {
    return null;
  }
}

function getAuthStateSnapshot(api) {
  try {
    if (!api || typeof api.getAuthState !== 'function') return null;
    const state = api.getAuthState();
    if (!state) return null;
    const userId =
      state.user && state.user.id ? String(state.user.id) : state.session && state.session.user ? state.session.user.id : null;
    const hasToken = Boolean(state.session && state.session.access_token);
    return {
      status: state.status || 'unknown',
      userId,
      hasToken,
      updatedAt: state.updatedAt || null,
    };
  } catch {
    return null;
  }
}

function recordRuntimeSnapshot(reason, extra = {}) {
  if (!_active) return;
  const api = window.SupabaseClient || window.__TP3D_SUPABASE_API;
  let modalCount = 0;
  try {
    modalCount = document.querySelectorAll('[data-tp3d-settings-modal="1"]').length;
  } catch {
    modalCount = 0;
  }
  const payload = {
    reason,
    hidden: typeof document !== 'undefined' ? Boolean(document.hidden) : null,
    online: typeof navigator !== 'undefined' ? navigator.onLine !== false : null,
    modalCount,
    authState: getAuthStateSnapshot(api),
    ...extra,
  };
  recordEvent('RUNTIME SNAPSHOT', 'debug', payload);
}

function getSupabaseWrapStatus(client) {
  try {
    const auth = client && client.auth ? client.auth : null;
    const getSession = auth && auth.getSession ? auth.getSession : null;
    const getUser = auth && auth.getUser ? auth.getUser : null;
    const refreshSession = auth && auth.refreshSession ? auth.refreshSession : null;

    const getSessionPrev = fnPreview(getSession);
    const getUserPrev = fnPreview(getUser);

    return {
      hasClient: Boolean(client),
      hasAuth: Boolean(auth),
      hasGetSession: typeof getSession === 'function',
      hasGetUser: typeof getUser === 'function',
      hasRefreshSession: typeof refreshSession === 'function',

      tp3dAuthWrappedFlag: client && client.__tp3dAuthWrapped === true,
      // Note: once debugger wraps these methods, previews will reflect the debugger wrapper.
      getSessionDebuggerWrapped: Boolean(getSession && getSession.__tp3dWrapped),
      getUserDebuggerWrapped: Boolean(getUser && getUser.__tp3dWrapped),

      // Best-effort detection of the TP3D auth wrapper before the debugger wraps.
      getSessionLooksTp3dWrapped: Boolean(getSessionPrev && getSessionPrev.includes('getSessionRawSingleFlight')),
      getUserLooksTp3dWrapped: Boolean(getUserPrev && getUserPrev.includes('getUserRawSingleFlight')),

      getSessionPreview: getSessionPrev,
      getUserPreview: getUserPrev,
    };
  } catch (err) {
    return {
      error: err && err.message ? err.message : String(err),
    };
  }
}

function getStackSlice(skip = 2, take = 6) {
  try {
    const stack = new Error().stack;
    if (!stack) return [];
    return stack
      .split('\n')
      .slice(skip, skip + take)
      .map(l => l.trim());
  } catch {
    return [];
  }
}

function isSupabaseNotInitializedError(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  return msg.includes('SupabaseClient not initialized');
}

function describeNode(node) {
  if (!node || !(node instanceof Element)) return null;
  const cls = typeof node.className === 'string' ? node.className : '';
  const classPreview = cls
    ? cls
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .join(' ')
    : '';

  const attrs = {};
  const role = node.getAttribute('role');
  if (role) attrs.role = role;

  const settingsMarker = node.getAttribute('data-tp3d-settings-modal');
  if (settingsMarker) attrs['data-tp3d-settings-modal'] = settingsMarker;

  const id = node.id || null;

  let text = '';
  try {
    text = (node.textContent || '').trim().slice(0, 60);
  } catch {
    text = '';
  }

  return {
    tag: node.tagName ? node.tagName.toLowerCase() : null,
    id,
    class: classPreview || null,
    attrs,
    text: text || null,
  };
}

function shouldIgnoreStorageKey(key) {
  return key === 'tp3dDebug' || key === '__TP3D_DIAG__' || (key && String(key).startsWith(PERSIST_KEY));
}

const CONFIG = {
  maxEvents: DEFAULT_MAX_EVENTS,
  slowFetchMs: DEFAULT_SLOW_FETCH_MS,
  consoleOutput: true,
  includeStack: true,
};

function isEnabled() {
  try {
    if (window.__TP3D_FORCE_DEBUG__ === true) return true;
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('tp3dDebug') === '1') return true;
    const v = window.localStorage && window.localStorage.getItem('tp3dDebug');
    return v === '1';
  } catch {
    return false;
  }
}

function ensureSession() {
  if (!_sessionId) {
    _sessionId = `tp3d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function recordEvent(type, category, data = {}) {
  if (!_active) return null;
  const now = performance.now();
  const evt = {
    id: ++_eventId,
    t: Math.round(now - _startTime),
    ts: new Date().toISOString(),
    sessionId: _sessionId,
    type,
    category,
    data,
  };
  if (CONFIG.includeStack) {
    try {
      evt.stack = new Error().stack;
    } catch {
      // ignore
    }
  }
  _events.push(evt);
  if (_events.length > CONFIG.maxEvents) _events.shift();
  if (CONFIG.consoleOutput) {
    const color = {
      auth: '#00bcd4',
      fetch: '#8bc34a',
      race: '#f44336',
      dom: '#9c27b0',
      storage: '#795548',
      nav: '#3f51b5',
      user: '#4caf50',
      edge: '#ff9800',
      debug: '#607d8b',
      perf: '#9e9e9e',
    }[category] || '#666';

    console.groupCollapsed(
      `%c[${evt.t}ms] ${type}`,
      `color:${color};font-weight:bold;`
    );
    console.log(evt.data);
    console.groupEnd();
  }
  maybePersistEvent(evt);
  return evt;
}

function shouldPersistEvent(evt) {
  if (!evt) return false;
  if (evt.type === 'LONG TASK') return true;
  if (evt.type === 'RUNTIME SNAPSHOT') return true;
  if (evt.type === 'SUPABASE WRAP STATUS') return true;
  if (evt.type === 'TP3D AUTH SIGNED OUT') return true;
  if (evt.type === 'AUTH EVENT') return true;
  if (evt.type.startsWith('RACE:')) return true;
  if (evt.type === 'STORAGE EVENT') {
    const key = evt.data && evt.data.key ? String(evt.data.key) : '';
    return (
      key.includes('tp3d-logout-trigger') ||
      key.startsWith('sb-') ||
      key.includes('supabase') ||
      key.includes('truckPacker3d')
    );
  }
  return false;
}

function maybePersistEvent(evt) {
  if (!_active) return;
  if (!shouldPersistEvent(evt)) return;
  const now = Date.now();
  if (now - _lastPersistAt < PERSIST_MIN_INTERVAL_MS) return;
  _lastPersistAt = now;
  try {
    const payload = {
      version: DEBUG_VERSION,
      sessionId: _sessionId,
      ts: new Date().toISOString(),
      reason: evt ? evt.type : 'unknown',
      lastEvent: evt ? { t: evt.t, type: evt.type, category: evt.category } : null,
      events: _events.slice(-PERSIST_MAX_EVENTS),
    };
    window.localStorage && window.localStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function trackInflight(fnName, id) {
  if (!_inflight.has(fnName)) _inflight.set(fnName, new Set());
  const set = _inflight.get(fnName);
  set.add(id);
  if (set.size > 1) {
    let modalOpen = false;
    try {
      modalOpen = Boolean(document.querySelector('[data-tp3d-settings-modal="1"]'));
    } catch {
      modalOpen = false;
    }
    recordEvent(`RACE: ${fnName}`, 'race', {
      fnName,
      inflight: set.size,
      hidden: typeof document !== 'undefined' ? Boolean(document.hidden) : null,
      online: typeof navigator !== 'undefined' ? navigator.onLine !== false : null,
      modalOpen,
      stack: getStackSlice(3, 6),
    });
  }
  return () => {
    set.delete(id);
    if (!set.size) _inflight.delete(fnName);
  };
}

function wrapFunction(obj, fnName, category) {
  if (!obj || !obj[fnName] || obj[fnName].__tp3dWrapped) return;
  const original = obj[fnName].bind(obj);
  obj[fnName] = async (...args) => {
    const callId = Math.random().toString(16).slice(2, 10);
    const cleanup = trackInflight(fnName, callId);
    const startTime = performance.now();
    recordEvent(`CALL ${fnName}`, category, { callId, args: args[0] });
    try {
      const res = await original(...args);
      recordEvent(`OK ${fnName}`, category, { callId, ms: Math.round(performance.now() - startTime) });
      return res;
    } catch (err) {
      recordEvent(`ERR ${fnName}`, category, {
        callId,
        ms: Math.round(performance.now() - startTime),
        msg: err && err.message ? err.message : String(err),
      });
      throw err;
    } finally {
      cleanup();
    }
  };
  obj[fnName].__tp3dWrapped = true;
}

function wrapFetch() {
  if (_wrappedFetch || !window.fetch) return;
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const startTime = performance.now();
    try {
      const res = await original(...args);
      const ms = Math.round(performance.now() - startTime);
      if (ms >= CONFIG.slowFetchMs) {
        const req = args[0];
        const init = args[1];
        const url = req && typeof req === 'object' && 'url' in req ? req.url : safeString(req);
        const method = (init && init.method) || (req && typeof req === 'object' && 'method' in req ? req.method : undefined);
        recordEvent('SLOW FETCH', 'fetch', {
          ms,
          url,
          method: method || 'GET',
          status: res && typeof res.status === 'number' ? res.status : undefined,
        });
      }
      return res;
    } catch (err) {
      const req = args[0];
      const init = args[1];
      const url = req && typeof req === 'object' && 'url' in req ? req.url : safeString(req);
      const method = (init && init.method) || (req && typeof req === 'object' && 'method' in req ? req.method : undefined);
      recordEvent('FETCH ERROR', 'fetch', {
        url,
        method: method || 'GET',
        msg: err && err.message,
      });
      throw err;
    }
  };
  window.fetch.__tp3dWrapped = true;
  _wrappedFetch = true;
}

function wrapStorage() {
  if (_wrappedStorage || !window.localStorage) return;
  const originalSet = window.localStorage.setItem;
  const originalRemove = window.localStorage.removeItem;

  window.localStorage.setItem = function (key, value) {
    if (shouldIgnoreStorageKey(key)) {
      return originalSet.apply(this, arguments);
    }
    recordEvent('LOCALSTORAGE SET', 'storage', {
      key,
      valueLength: value ? String(value).length : 0,
    });
    return originalSet.apply(this, arguments);
  };

  window.localStorage.removeItem = function (key) {
    if (shouldIgnoreStorageKey(key)) {
      return originalRemove.apply(this, arguments);
    }
    recordEvent('LOCALSTORAGE REMOVE', 'storage', { key });
    return originalRemove.apply(this, arguments);
  };

  _wrappedStorage = true;
}

function wrapHistory() {
  if (_wrappedHistory) return;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;

  history.pushState = function (...args) {
    recordEvent('PUSH STATE', 'nav', { url: args[2], state: args[0] });
    return originalPush.apply(this, args);
  };

  history.replaceState = function (...args) {
    recordEvent('REPLACE STATE', 'nav', { url: args[2], state: args[0] });
    return originalReplace.apply(this, args);
  };

  _wrappedHistory = true;
}

function snapshotSettings(source = 'manual') {
  if (!_active) return null;
  const roots = [...document.querySelectorAll('[data-tp3d-settings-modal="1"]')];
  const root = roots[0] || null;
  const activeBtn = root ? root.querySelector('[data-tab].active') : null;
  const activePanel = root ? root.querySelector('[data-tab-panel]:not([hidden])') : null;
  const payload = {
    source,
    rootCount: roots.length,
    instanceId: root ? root.getAttribute('data-tp3d-settings-instance') : null,
    activeBtn: activeBtn ? activeBtn.getAttribute('data-tab') : null,
    activePanel: activePanel ? activePanel.getAttribute('data-tab-panel') : null,
  };
  recordEvent('SETTINGS SNAPSHOT', 'dom', payload);
  return payload;
}

function installModalObserver() {
  if (_modalObserver) return;
  const isModal = el =>
    el &&
    (el.matches?.('.modal, [role="dialog"], [data-tp3d-settings-modal="1"]') ||
      el.querySelector?.('.modal, [role="dialog"], [data-tp3d-settings-modal="1"]'));

  _modalObserver = new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && isModal(n)) {
          recordEvent('MODAL ADDED', 'dom', { modal: describeNode(n) });
        }
      }
      for (const n of m.removedNodes) {
        if (n.nodeType === 1 && isModal(n)) {
          recordEvent('MODAL REMOVED', 'dom', { modal: describeNode(n) });
        }
      }
    }
  });

  _modalObserver.observe(document.body, { childList: true, subtree: true });
}

function installAuthTracking(api, client) {
  try {
    if (api && typeof api.onAuthStateChange === 'function') {
      api.onAuthStateChange((event, session) => {
        recordEvent('AUTH EVENT', 'auth', {
          event,
          userId: session?.user?.id || null,
          hasToken: Boolean(session?.access_token),
        });
        recordRuntimeSnapshot('auth-event', { event });
      });
    }
  } catch {
    // ignore
  }

  if (client && client.auth) {
    wrapFunction(client.auth, 'getSession', 'auth');
    wrapFunction(client.auth, 'getUser', 'auth');
    wrapFunction(client.auth, 'signInWithPassword', 'auth');
    wrapFunction(client.auth, 'signUp', 'auth');
    wrapFunction(client.auth, 'signOut', 'auth');
    wrapFunction(client.auth, 'refreshSession', 'auth');
  }
}

function installEdgeTracking(client) {
  if (!client || !client.functions || !client.functions.invoke) return;
  wrapFunction(client.functions, 'invoke', 'edge');
}

function installSupabaseClientTracking(api) {
  if (!api) return;
  wrapFunction(api, 'getSessionSingleFlightSafe', 'auth');
  wrapFunction(api, 'getSessionSingleFlight', 'auth');
  wrapFunction(api, 'getUserSingleFlight', 'auth');
  wrapFunction(api, 'validateSessionSoft', 'auth');
  wrapFunction(api, 'getAuthState', 'auth');
  wrapFunction(api, 'signOut', 'auth');
}

function installAppEvents() {
  try {
    window.addEventListener('tp3d:auth-signed-out', ev => {
      recordEvent('TP3D AUTH SIGNED OUT', 'auth', { detail: ev && ev.detail ? ev.detail : null });
      recordRuntimeSnapshot('app-auth-signed-out');
    });
  } catch {
    // ignore
  }

  try {
    window.addEventListener('tp3d:org-changed', ev => {
      recordEvent('TP3D ORG CHANGED', 'auth', { detail: ev && ev.detail ? ev.detail : null });
      recordRuntimeSnapshot('app-org-changed');
    });
  } catch {
    // ignore
  }

  try {
    window.addEventListener('tp3d:auth-error', ev => {
      recordEvent('TP3D AUTH ERROR', 'auth', { detail: ev && ev.detail ? ev.detail : null });
      recordRuntimeSnapshot('app-auth-error');
    });
  } catch {
    // ignore
  }
}

function installLongTaskObserver() {
  if (_longTaskObserver || typeof PerformanceObserver !== 'function') return;
  try {
    _longTaskObserver = new PerformanceObserver(list => {
      const entries = list.getEntries ? list.getEntries() : [];
      for (const entry of entries) {
        recordEvent('LONG TASK', 'perf', {
          name: entry.name || null,
          duration: Math.round(entry.duration || 0),
          startTime: Math.round(entry.startTime || 0),
        });
      }
    });
    _longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch {
    _longTaskObserver = null;
  }
}

function installUserEvents() {
  document.addEventListener(
    'click',
    ev => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const tag = target.tagName.toLowerCase();
      recordEvent('CLICK', 'user', {
        tag,
        id: target.id || null,
        class: target.className || null,
        text: (target.textContent || '').trim().slice(0, 60),
        x: ev.clientX,
        y: ev.clientY,
      });
    },
    true
  );

  document.addEventListener('visibilitychange', () => {
    recordEvent(document.hidden ? 'TAB HIDDEN' : 'TAB VISIBLE', 'nav', { hidden: document.hidden });
    recordRuntimeSnapshot(document.hidden ? 'tab-hidden' : 'tab-visible');
  });
  window.addEventListener('focus', () => recordEvent('WINDOW FOCUS', 'nav'));
  window.addEventListener('blur', () => recordEvent('WINDOW BLUR', 'nav'));
}

function installStorageEvents() {
  window.addEventListener('storage', e => {
    if (shouldIgnoreStorageKey(e.key)) return;
    recordEvent('STORAGE EVENT', 'storage', {
      key: e.key,
      newValue: e.newValue,
    });
    try {
      const key = e && e.key ? String(e.key) : '';
      if (
        key.includes('tp3d-logout-trigger') ||
        key.startsWith('sb-') ||
        key.includes('supabase') ||
        key.includes('truckPacker3d')
      ) {
        recordRuntimeSnapshot('storage-event', {
          key,
          valueLength: e && typeof e.newValue === 'string' ? e.newValue.length : null,
        });
      }
    } catch {
      // ignore
    }
  });
}

function installNavEvents() {
  window.addEventListener('hashchange', e => {
    recordEvent('HASH CHANGE', 'nav', {
      from: e.oldURL ? e.oldURL.split('#')[1] : '',
      to: e.newURL ? e.newURL.split('#')[1] : '',
    });
  });
}

function start() {
  if (_active) return;
  if (!isEnabled()) return;
  _active = true;
  _startTime = performance.now();
  ensureSession();
  recordEvent('DIAG START', 'debug', { version: DEBUG_VERSION, sessionId: _sessionId });
  try {
    window.__TP3D_DIAG_PERSIST_KEY__ = PERSIST_KEY;
  } catch {
    // ignore
  }

  wrapFetch();
  wrapStorage();
  wrapHistory();
  installUserEvents();
  installNavEvents();
  installStorageEvents();
  installAppEvents();
  installLongTaskObserver();
  installModalObserver();

  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(() => {
    const api = window.SupabaseClient || window.__TP3D_SUPABASE_API;
    if (!api) return;

    let client = null;
    if (api.getClient) {
      try {
        client = api.getClient();
      } catch (err) {
        // SupabaseClient object exists before init(); this must never crash the page
        if (isSupabaseNotInitializedError(err)) {
          if (!_supabaseInitWarned) {
            _supabaseInitWarned = true;
            recordEvent('SUPABASE NOT READY (waiting for init)', 'auth', {
              msg: err && err.message ? err.message : String(err),
            });
          }
          return;
        }

        if (!_supabaseAttachWarned) {
          _supabaseAttachWarned = true;
          recordEvent('SUPABASE ATTACH ERROR', 'auth', {
            msg: err && err.message ? err.message : String(err),
            stack: getStackSlice(3, 8),
          });
        }
        return;
      }
    }

    if (!client) return;
    clearInterval(_pollTimer);
    _pollTimer = null;

    // Capture wrapper status BEFORE the debugger wraps client.auth methods.
    const preWrapStatus = getSupabaseWrapStatus(client);

    installAuthTracking(api, client);
    installSupabaseClientTracking(api);
    installEdgeTracking(client);
    wrapFunction(api, 'getAccountBundleSingleFlight', 'auth');
    recordEvent('SUPABASE WRAPPED', 'auth', { ok: true });

    // Record a one-time richer payload to make troubleshooting cross-tab storms easier.
    if (!_supabaseWrapStatusRecorded) {
      _supabaseWrapStatusRecorded = true;
      const postWrapStatus = getSupabaseWrapStatus(client);
      recordEvent('SUPABASE WRAP STATUS', 'auth', {
        globals: {
          hasWindowSupabaseClient: Boolean(window.SupabaseClient),
          hasWindowTp3dSupabaseApi: Boolean(window.__TP3D_SUPABASE_API),
          hasWindowTp3dSupabaseClient: Boolean(window.__TP3D_SUPABASE_CLIENT),
        },
        pre: preWrapStatus,
        post: postWrapStatus,
        note:
          'pre=before debugger wraps auth methods; post=after. If tp3dAuthWrappedFlag is true, TP3D supabase-client patched auth.getSession/getUser.',
      });
    }

    snapshotSettings('init');
  }, 100);
}

function enable() {
  try {
    window.localStorage && window.localStorage.setItem('tp3dDebug', '1');
  } catch {
    // ignore
  }
  start();
  recordEvent('DEBUG ENABLED', 'debug');
}

function disable() {
  try {
    window.localStorage && window.localStorage.removeItem('tp3dDebug');
  } catch {
    // ignore
  }
  _active = false;
}

export function initTP3DDebugger() {
  if (window.__TP3D_DIAG__ && window.__TP3D_DIAG__.__tp3dInstalled) {
    if (isEnabled()) start();
    return window.__TP3D_DIAG__;
  }

  window.__TP3D_DIAG__ = {
    __tp3dInstalled: true,
    version: DEBUG_VERSION,
    isEnabled,
    enable,
    disable,
    getEvents: () => _events.slice(),
    getEventsByType: type => _events.filter(e => e.type === type),
    getPersisted: () => {
      try {
        const raw = window.localStorage && window.localStorage.getItem(PERSIST_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    clearPersisted: () => {
      try {
        window.localStorage && window.localStorage.removeItem(PERSIST_KEY);
      } catch {
        // ignore
      }
    },
    summary: () => {
      const counts = _events.reduce((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + 1;
        return acc;
      }, {});
      const summary = {
        active: _active,
        sessionId: _sessionId,
        total: _events.length,
        counts,
      };
      if (_active) console.log('TP3D_DIAG SUMMARY', summary);
      return summary;
    },
    download: () => {
      if (!_active) return;
      const payload = {
        version: DEBUG_VERSION,
        sessionId: _sessionId,
        startedAt: new Date(Date.now() - _startTime).toISOString(),
        events: _events,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tp3d-diag-${_sessionId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    snapshotSettings,
  };

  if (isEnabled()) start();
  return window.__TP3D_DIAG__;
}
