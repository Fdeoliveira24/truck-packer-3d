import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FAKE_SUPABASE_PATH = fileURLToPath(
  new URL('./fixtures/fake-supabase.js', import.meta.url)
);

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function installPrebootInstrumentation() {
  const listeners = [];
  const removals = [];
  const dispatches = [];
  const timeouts = [];
  const timeoutClears = [];
  const intervals = [];
  const intervalClears = [];
  const channels = [];
  const fetches = [];
  const listenerIds = new WeakMap();
  let nextListenerId = 0;

  const targetName = target => {
    if (target === window) return 'window';
    if (target === document) return 'document';
    if (target && target.nodeName) return String(target.nodeName).toLowerCase();
    return target && target.constructor && target.constructor.name
      ? String(target.constructor.name)
      : typeof target;
  };
  const listenerId = listener => {
    if ((typeof listener !== 'function' && (typeof listener !== 'object' || listener === null))) {
      return null;
    }
    if (!listenerIds.has(listener)) {
      nextListenerId += 1;
      listenerIds.set(listener, nextListenerId);
    }
    return listenerIds.get(listener);
  };
  const normalizeOptions = options => {
    if (typeof options === 'boolean') return { capture: options, once: false, passive: false };
    return {
      capture: Boolean(options && options.capture),
      once: Boolean(options && options.once),
      passive: Boolean(options && options.passive),
    };
  };

  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
  const originalDispatchEvent = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.addEventListener = new Proxy(originalAddEventListener, {
    apply(target, thisArg, args) {
      listeners.push({
        target: targetName(thisArg),
        type: String(args[0] || ''),
        listenerId: listenerId(args[1]),
        ...normalizeOptions(args[2]),
      });
      return Reflect.apply(target, thisArg, args);
    },
  });
  EventTarget.prototype.removeEventListener = new Proxy(originalRemoveEventListener, {
    apply(target, thisArg, args) {
      removals.push({
        target: targetName(thisArg),
        type: String(args[0] || ''),
        listenerId: listenerId(args[1]),
        ...normalizeOptions(args[2]),
      });
      return Reflect.apply(target, thisArg, args);
    },
  });
  EventTarget.prototype.dispatchEvent = new Proxy(originalDispatchEvent, {
    apply(target, thisArg, args) {
      dispatches.push({
        target: targetName(thisArg),
        type: args[0] && args[0].type ? String(args[0].type) : '',
      });
      return Reflect.apply(target, thisArg, args);
    },
  });

  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  const originalSetInterval = window.setInterval;
  const originalClearInterval = window.clearInterval;
  window.setTimeout = new Proxy(originalSetTimeout, {
    apply(target, thisArg, args) {
      const id = Reflect.apply(target, thisArg, args);
      timeouts.push({ id, delay: Number(args[1]) || 0 });
      return id;
    },
  });
  window.clearTimeout = new Proxy(originalClearTimeout, {
    apply(target, thisArg, args) {
      timeoutClears.push(args[0]);
      return Reflect.apply(target, thisArg, args);
    },
  });
  window.setInterval = new Proxy(originalSetInterval, {
    apply(target, thisArg, args) {
      const id = Reflect.apply(target, thisArg, args);
      intervals.push({ id, delay: Number(args[1]) || 0 });
      return id;
    },
  });
  window.clearInterval = new Proxy(originalClearInterval, {
    apply(target, thisArg, args) {
      intervalClears.push(args[0]);
      return Reflect.apply(target, thisArg, args);
    },
  });

  if (typeof window.BroadcastChannel === 'function') {
    const OriginalBroadcastChannel = window.BroadcastChannel;
    window.BroadcastChannel = new Proxy(OriginalBroadcastChannel, {
      construct(target, args, newTarget) {
        const value = Reflect.construct(target, args, newTarget);
        channels.push({ name: String(args[0] || '') });
        return value;
      },
    });
  }

  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = new Proxy(originalFetch, {
      apply(target, thisArg, args) {
        const input = args[0];
        const init = args[1] || {};
        fetches.push({
          url: typeof input === 'string' ? input : input && input.url ? String(input.url) : String(input),
          method: String(init.method || (input && input.method) || 'GET').toUpperCase(),
        });
        return Reflect.apply(target, thisArg, args);
      },
    });
  }

  window.__TP3D_TEST_INSTRUMENTATION__ = {
    snapshot() {
      return {
        listeners: listeners.map(value => ({ ...value })),
        removals: removals.map(value => ({ ...value })),
        dispatches: dispatches.map(value => ({ ...value })),
        timeouts: timeouts.map(value => ({ ...value })),
        timeoutClears: [...timeoutClears],
        intervals: intervals.map(value => ({ ...value })),
        intervalClears: [...intervalClears],
        channels: channels.map(value => ({ ...value })),
        fetches: fetches.map(value => ({ ...value })),
      };
    },
  };
}

// TRIAGE-3D-B: deterministic, test-only failure injection at an already-exposed
// initialization boundary (window.TruckPackerApp.EditorUI.init, called from the
// unguarded src/app.js:9049-9058 block). A property-setter trap on
// window.TruckPackerApp fires synchronously the instant app.js assigns the facade
// (src/app.js:2304 / src/app.js:6851), which happens before boot() ever calls
// init() (src/app.js:10225-10243) — so the throwing replacement is installed with
// no timing race against the auto-boot. Only the facade assignment that already
// carries an EditorUI object is patched; the earlier `window.TruckPackerApp =
// window.TruckPackerApp || {}` stub assignment is ignored.
function installEditorInitFailureTrap() {
  let actualApp;
  Object.defineProperty(window, 'TruckPackerApp', {
    configurable: true,
    enumerable: true,
    get() {
      return actualApp;
    },
    set(value) {
      actualApp = value;
      if (value && value.EditorUI && typeof value.EditorUI.init === 'function' && !window.__TRIAGE_ORIGINAL_EDITOR_INIT__) {
        const original = value.EditorUI.init;
        let callCount = 0;
        window.__TRIAGE_ORIGINAL_EDITOR_INIT__ = original;
        window.__TRIAGE_EDITOR_INIT_CALLS__ = () => callCount;
        value.EditorUI.init = function throwingEditorInit(...args) {
          callCount += 1;
          throw new Error('TRIAGE-3D-B injected initializer failure');
        };
      }
    },
  });
}

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
      }

      const parsed = new URL(request.url || '/', 'http://127.0.0.1');
      let pathname;
      try {
        pathname = decodeURIComponent(parsed.pathname);
      } catch {
        response.writeHead(400);
        response.end('Bad request');
        return;
      }
      if (pathname === '/') pathname = '/index.html';

      const filePath = path.resolve(REPOSITORY_ROOT, `.${pathname}`);
      const rootPrefix = REPOSITORY_ROOT.endsWith(path.sep)
        ? REPOSITORY_ROOT
        : `${REPOSITORY_ROOT}${path.sep}`;
      if (filePath !== REPOSITORY_ROOT && !filePath.startsWith(rootPrefix)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      const body = request.method === 'HEAD' ? null : await fs.readFile(filePath);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
      });
      response.end(body);
    } catch (error) {
      const status = error && error.code === 'ENOENT' ? 404 : 500;
      response.writeHead(status);
      response.end(status === 404 ? 'Not found' : 'Server error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to resolve test server address.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function localVendorBody(relativePath) {
  return fs.readFile(path.join(REPOSITORY_ROOT, relativePath));
}

async function installDeterministicRoutes(context, diagnostics, billingTransport) {
  const vendorBodies = new Map();
  const getVendor = async relativePath => {
    if (!vendorBodies.has(relativePath)) {
      vendorBodies.set(relativePath, await localVendorBody(relativePath));
    }
    return vendorBodies.get(relativePath);
  };

  await context.route('https://**/*', async route => {
    const request = route.request();
    const url = request.url();
    diagnostics.externalRequests.push({ url, method: request.method() });

    if (url.includes('/functions/v1/billing-status')) {
      await billingTransport.handle(route);
      return;
    }
    if (url.includes('esm.sh/three@') || url.includes('cdn.skypack.dev/three@')) {
      await route.abort('failed');
      return;
    }
    if (url.includes('supabase') && url.endsWith('.js')) {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '' });
      return;
    }
    if (url.includes('tween')) {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: await getVendor('vendor/tween.umd.js') });
      return;
    }
    if (url.includes('jspdf')) {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: await getVendor('vendor/jspdf.umd.min.js') });
      return;
    }
    if (url.includes('xlsx')) {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: await getVendor('vendor/xlsx.full.min.js') });
      return;
    }
    if (url.includes('font-awesome') || url.includes('fontawesome')) {
      await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: await getVendor('vendor/fontawesome.min.css') });
      return;
    }
    if (url.includes('fonts.googleapis.com')) {
      await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' });
      return;
    }
    await route.abort('blockedbyclient');
  });
}

function createBillingTransport() {
  let mode = 'automatic';
  let defaultStatus = 200;
  let defaultBody = {
    plan: 'pro',
    status: 'active',
    entitlementStatus: 'active',
    workspaceIncluded: true,
    workspaceCount: 1,
    workspaceLimit: 1,
    billingOwnerUserId: null,
    canManageBilling: true,
  };
  const pending = [];
  const pendingWaiters = new Set();

  const notifyPendingWaiters = () => {
    for (const waiter of Array.from(pendingWaiters)) {
      if (pending.length < waiter.count) continue;
      pendingWaiters.delete(waiter);
      clearTimeout(waiter.timeoutId);
      waiter.resolve();
    }
  };

  return {
    async handle(route) {
      const request = route.request();
      if (mode === 'deferred') {
        await new Promise(resolve => {
          pending.push({ route, request, resolve });
          notifyPendingWaiters();
        });
        return;
      }
      const parsed = new URL(request.url());
      const orgId = parsed.searchParams.get('organization_id');
      await route.fulfill({
        status: defaultStatus,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ...defaultBody, orgId }),
      });
    },
    setAutomatic(body = defaultBody, status = 200) {
      mode = 'automatic';
      defaultBody = { ...body };
      defaultStatus = status;
    },
    setDeferred() {
      mode = 'deferred';
    },
    pendingSnapshot() {
      return pending.map((entry, index) => ({
        index,
        url: entry.request.url(),
        method: entry.request.method(),
        headers: entry.request.headers(),
      }));
    },
    async waitForPendingCount(count, timeoutMs = 15000) {
      const normalizedCount = Math.max(1, Number(count) || 1);
      if (pending.length >= normalizedCount) return;
      await new Promise((resolve, reject) => {
        const waiter = {
          count: normalizedCount,
          reject,
          resolve,
          timeoutId: setTimeout(() => {
            pendingWaiters.delete(waiter);
            reject(new Error(`Timed out waiting for ${normalizedCount} deferred billing request(s).`));
          }, timeoutMs),
        };
        pendingWaiters.add(waiter);
      });
    },
    async release(index, body, status = 200) {
      const entry = pending[index];
      if (!entry) throw new Error(`No deferred billing request at index ${index}.`);
      pending.splice(index, 1);
      const parsed = new URL(entry.request.url());
      const orgId = parsed.searchParams.get('organization_id');
      await entry.route.fulfill({
        status,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ...(body || defaultBody), orgId }),
      });
      entry.resolve();
    },
    async abortAll() {
      for (const waiter of Array.from(pendingWaiters)) {
        pendingWaiters.delete(waiter);
        clearTimeout(waiter.timeoutId);
        waiter.reject(new Error('Billing transport closed before the deferred request arrived.'));
      }
      const entries = pending.splice(0);
      for (const entry of entries) {
        await entry.route.abort('failed').catch(() => {});
        entry.resolve();
      }
    },
  };
}

export async function createAppBrowserHarness() {
  const server = await startStaticServer();
  const fakeSupabaseSource = await fs.readFile(FAKE_SUPABASE_PATH, 'utf8');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    await server.close();
    throw error;
  }

  return {
    baseUrl: server.baseUrl,
    async createScenario(scenario = {}) {
      const context = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: 1280, height: 800 },
      });
      const diagnostics = {
        consoleErrors: [],
        externalRequests: [],
        pageErrors: [],
        requestFailures: [],
      };
      const billing = createBillingTransport();
      try {
        const serializedScenario = JSON.stringify(scenario).replace(/[\u2028\u2029]/g, character =>
          `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
        );
        await context.addInitScript({
          content: `(${installPrebootInstrumentation.toString()})();\n`
            + `window.__TP3D_FAKE_SUPABASE_SCENARIO__ = ${serializedScenario};\n`
            + fakeSupabaseSource,
        });
        if (scenario.injectEditorInitFailure) {
          await context.addInitScript({
            content: `(${installEditorInitFailureTrap.toString()})();`,
          });
        }
        if (scenario.supabaseConfigOverride) {
          // TRIAGE-3D-B Scenario E: rewrite the served index.html's inline
          // window.__TP3D_SUPABASE config block (index.html:1008-1016) to an
          // existing, intentionally-recoverable degraded value (see
          // src/app.js:8305-8332). Test-only response rewrite; src/ is untouched.
          const overrideJson = JSON.stringify(scenario.supabaseConfigOverride);
          await context.route('**/index.html', async route => {
            const response = await route.fetch();
            const body = await response.text();
            const replaced = body.replace(
              /window\.__TP3D_SUPABASE\s*=\s*\{[\s\S]*?\};/,
              `window.__TP3D_SUPABASE = ${overrideJson};`
            );
            if (replaced === body) {
              throw new Error('harness: could not find window.__TP3D_SUPABASE block in index.html to override');
            }
            await route.fulfill({ response, body: replaced });
          });
        }
        await installDeterministicRoutes(context, diagnostics, billing);
      } catch (error) {
        await billing.abortAll().catch(() => {});
        await context.close().catch(() => {});
        throw error;
      }

      const pages = new Set();
      const attachPageDiagnostics = page => {
        pages.add(page);
        page.on('console', message => {
          if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
        });
        page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
        page.on('requestfailed', request => {
          diagnostics.requestFailures.push({
            url: request.url(),
            errorText: request.failure() ? request.failure().errorText : 'unknown',
          });
        });
        return page;
      };

      const openPage = async () => {
        const page = attachPageDiagnostics(await context.newPage());
        await page.goto(`${server.baseUrl}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return page;
      };
      const waitForAppReady = async page => {
        await page.waitForFunction(() => {
          const boot = window.__TP3D_BOOT;
          return Boolean(boot && (boot.appReady || boot.fatalOverlayShown));
        }, null, { timeout: 30000 });
        const boot = await page.evaluate(() => ({
          appReady: Boolean(window.__TP3D_BOOT && window.__TP3D_BOOT.appReady),
          fatalOverlayShown: Boolean(window.__TP3D_BOOT && window.__TP3D_BOOT.fatalOverlayShown),
        }));
        if (!boot.appReady || boot.fatalOverlayShown) {
          throw new Error(`Application did not reach ready state: ${JSON.stringify({ boot, diagnostics })}`);
        }
      };

      return {
        billing,
        context,
        diagnostics,
        openPage,
        waitForAppReady,
        async close() {
          try {
            await billing.abortAll();
          } finally {
            await context.close();
          }
        },
      };
    },
    async close() {
      try {
        await browser.close();
      } finally {
        await server.close();
      }
    },
  };
}

export async function readRuntimeSnapshot(page) {
  return page.evaluate(() => ({
    authBodyState: document.body && document.body.dataset ? document.body.dataset.auth || null : null,
    boot: {
      appReady: Boolean(window.__TP3D_BOOT && window.__TP3D_BOOT.appReady),
      fatalOverlayShown: Boolean(window.__TP3D_BOOT && window.__TP3D_BOOT.fatalOverlayShown),
    },
    facadeKeys: window.TruckPackerApp ? Object.keys(window.TruckPackerApp).sort() : [],
    facadeDebugKeys: window.TruckPackerApp && window.TruckPackerApp._debug
      ? Object.keys(window.TruckPackerApp._debug).sort()
      : [],
    billingGlobalKeys: Object.keys(window).filter(key => /billing/i.test(key)).sort(),
    billingDebugKeys: window.__TP3D_BILLING ? Object.keys(window.__TP3D_BILLING).sort() : [],
    fakeSupabase: window.__TP3D_FAKE_SUPABASE_CONTROL__
      ? window.__TP3D_FAKE_SUPABASE_CONTROL__.snapshot()
      : null,
    instrumentation: window.__TP3D_TEST_INSTRUMENTATION__
      ? window.__TP3D_TEST_INSTRUMENTATION__.snapshot()
      : null,
  }));
}
