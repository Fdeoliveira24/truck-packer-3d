#!/usr/bin/env node
/**
 * tools/app-graph.js
 * TP3D Import + Wiring Graph Generator
 *
 * Scans index.html (script load order, CDN/vendor map) and src/ (ESM imports,
 * TP3D-specific wiring signals) and writes a JSON graph to tools/tp3d-graph.json.
 *
 * ── HOW TO RUN ────────────────────────────────────────────────────────────────
 *
 *   From the project root (same folder as index.html / package.json):
 *
 *     node tools/app-graph.js
 *
 *   Requires Node.js ≥ 16. No npm install needed — zero external dependencies.
 *
 * ── OUTPUT ────────────────────────────────────────────────────────────────────
 *
 *   tools/tp3d-graph.json   — full graph (open in any JSON viewer / VS Code)
 *
 *   Console summary example:
 *     ✅  Wrote: tools/tp3d-graph.json
 *     Nodes: 68 | Edges: 109
 *     Hot (churnRisk top-3): src/app.js(97)  src/core/supabase-client.js(53)  ...
 *     TP3D events emitted : tp3d:org-changed, ...
 *
 * ── WHAT'S IN THE JSON ────────────────────────────────────────────────────────
 *
 *   .summary           quick stats: node/edge counts, top churn files, events
 *   .hot.churnRisk     top-10 files by churn-risk score (auth+billing+bundle)
 *   .nodes["src/…"]    per-file: imports, importedBy, signals, factory, score
 *   .edges             every ESM import as { from, to, spec }
 *   .indexHtml         script load order, vendors, inline globals from HTML
 *
 * ── ENABLE RUNTIME DEBUG LOGS IN BROWSER ─────────────────────────────────────
 *
 *   In DevTools console:
 *     localStorage.setItem('tp3dDebug', '1')   // turn on
 *     localStorage.removeItem('tp3dDebug')     // turn off
 *
 * ── SAFE TO RE-RUN ANYTIME ───────────────────────────────────────────────────
 *
 *   Read-only — never touches src/ or any app file.
 *   Only overwrites tools/tp3d-graph.json.
 */

import fs   from 'fs';
import path from 'path';

// ─── Paths ───────────────────────────────────────────────────────────────────
const ROOT      = process.cwd();
const SRC_DIR   = path.join(ROOT, 'src');
const HTML_FILE = path.join(ROOT, 'index.html');
const OUT_FILE  = path.join(ROOT, 'tools', 'tp3d-graph.json');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

/**
 * Find all regex matches in text.
 * Always uses a fresh RegExp with the global flag to avoid lastIndex state bugs.
 */
function findAll(reSource, reFlags, text) {
  const re = new RegExp(reSource, reFlags.includes('g') ? reFlags : reFlags + 'g');
  return Array.from(text.matchAll(re));
}

/** Test whether a pattern occurs anywhere in text. */
function has(pattern, text) {
  return pattern.test(text);
}

function uniq(arr) { return Array.from(new Set(arr)); }

function walkSrc(dir) {
  const out = [];
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (it.name === 'node_modules' || it.name === 'vendor') continue;
      out.push(...walkSrc(p));
    } else if (it.isFile()) {
      const ext = path.extname(it.name).toLowerCase();
      if (ext === '.js' || ext === '.mjs' || ext === '.ts') out.push(p);
    }
  }
  return out;
}

function resolveImport(fromFile, spec) {
  if (!spec) return null;
  const s = String(spec).trim();
  if (!s.startsWith('.')) return { external: true, spec: s };
  const base = path.resolve(path.dirname(fromFile), s);
  const candidates = [
    base,
    base + '.js', base + '.mjs', base + '.ts',
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.ts'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return rel(c);
    } catch { /* ignore */ }
  }
  return rel(base);
}

// ─── index.html parser ───────────────────────────────────────────────────────
function parseIndexHtml() {
  const html = safeRead(HTML_FILE);
  if (!html) return { scripts: [], vendors: [], globals: {} };

  const scripts = [];
  let order = 0;
  for (const m of findAll('<script([^>]*)>', 'i', html)) {
    const attrs = m[1];
    const srcM  = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/);
    const typeM = attrs.match(/\btype\s*=\s*["']([^"']+)["']/);
    if (srcM) {
      scripts.push({ order: order++, src: srcM[1], type: typeM ? typeM[1] : 'classic' });
    }
  }

  const stylesheets = [];
  for (const m of findAll('<link([^>]*)>', 'i', html)) {
    const attrs = m[1];
    const relM  = attrs.match(/\brel\s*=\s*["']([^"']+)["']/);
    const hrefM = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/);
    if (relM && /stylesheet/i.test(relM[1]) && hrefM) stylesheets.push(hrefM[1]);
  }

  const vendorPatterns = [
    { key: 'three.js',    re: /three[@/]/ },
    { key: 'tween.js',   re: /tween/i },
    { key: 'jspdf',      re: /jspdf/i },
    { key: 'xlsx',       re: /xlsx/i },
    { key: 'supabase',   re: /supabase/i },
    { key: 'fontawesome', re: /font-awesome|fontawesome/i },
  ];
  const vendors = vendorPatterns
    .map(({ key, re }) => ({ key, entries: scripts.filter(s => re.test(s.src)).map(s => s.src) }))
    .filter(v => v.entries.length);

  const globals = {};
  if (/__TP3D_SUPABASE\s*=\s*\{/.test(html)) globals.__TP3D_SUPABASE = '(set inline)';
  for (const m of findAll('window\\.__TP3D_STRIPE_PRICE_(\\w+)\\s*=\\s*["\']([^"\']+)["\']', 'g', html)) {
    globals[`__TP3D_STRIPE_PRICE_${m[1]}`] = m[2];
  }

  return { scripts, stylesheets, vendors, globals };
}

// ─── Signal detectors ────────────────────────────────────────────────────────
function detectAuthSignals(text) {
  const f = [];
  if (/onAuthStateChange\s*\(/.test(text))          f.push('onAuthStateChange');
  if (/TOKEN_REFRESHED/.test(text))                  f.push('TOKEN_REFRESHED');
  if (/\bSIGNED_IN\b/.test(text))                   f.push('SIGNED_IN');
  if (/\bSIGNED_OUT\b/.test(text))                  f.push('SIGNED_OUT');
  if (/INITIAL_SESSION/.test(text))                  f.push('INITIAL_SESSION');
  if (/PASSWORD_RECOVERY/.test(text))                f.push('PASSWORD_RECOVERY');
  if (/getUserSingleFlight\s*\(/.test(text))         f.push('getUserSingleFlight');
  if (/getSessionSingleFlight[^S]/.test(text))       f.push('getSessionSingleFlight');
  if (/getSessionSingleFlightSafe\s*\(/.test(text))  f.push('getSessionSingleFlightSafe');
  if (/validateSessionSoft\s*\(/.test(text))         f.push('validateSessionSoft');
  if (/setAuthIntent\s*\(/.test(text))               f.push('setAuthIntent');
  if (/consumeAuthIntent\s*\(/.test(text))           f.push('consumeAuthIntent');
  if (/refreshSession\s*\(/.test(text))              f.push('refreshSession');
  if (/isCrossTabLogin/.test(text))                  f.push('isCrossTabLogin');
  if (/lastSignedInSnapshot/.test(text))             f.push('lastSignedInSnapshot');
  if (/FALLBACK_AUTH_TTL/.test(text))                f.push('FALLBACK_AUTH_TTL');
  return uniq(f);
}

function detectBillingSignals(text) {
  const f = [];
  if (/refreshBilling\s*\(/.test(text))              f.push('refreshBilling()');
  if (/fetchBillingStatus\s*\(/.test(text))           f.push('fetchBillingStatus()');
  if (/clearBillingState\s*\(/.test(text))            f.push('clearBillingState()');
  if (/getBillingState\s*\(/.test(text))              f.push('getBillingState()');
  if (/refreshBillingForOrgChange\s*\(/.test(text))   f.push('refreshBillingForOrgChange()');
  if (/createCheckoutSession\s*\(/.test(text))        f.push('createCheckoutSession()');
  if (/createPortalSession\s*\(/.test(text))          f.push('createPortalSession()');
  if (/\/billing-status/.test(text))                  f.push('billingStatusEndpoint');
  if (/applyAccessGateFromBilling\s*\(/.test(text))   f.push('applyAccessGateFromBilling()');
  if (/_billingRefreshQueued/.test(text))              f.push('_billingRefreshQueued');
  if (/BILLING_THROTTLE_MS/.test(text))               f.push('BILLING_THROTTLE_MS');
  if (/billingDebugLog\s*\(/.test(text))              f.push('billingDebugLog()');
  return uniq(f);
}

function detectBundleSignals(text) {
  const f = [];
  if (/getAccountBundleSingleFlight\s*\(/.test(text)) f.push('getAccountBundleSingleFlight()');
  if (/queueAccountBundleRefresh\s*\(/.test(text))    f.push('queueAccountBundleRefresh()');
  if (/loadAccountBundle\s*\(/.test(text))            f.push('loadAccountBundle()');
  if (/resetAccountBundleCache\s*\(/.test(text))      f.push('resetAccountBundleCache()');
  if (/invalidateAccountCache\s*\(/.test(text))       f.push('invalidateAccountCache()');
  if (/getOrganizationMembers\s*\(/.test(text))       f.push('getOrganizationMembers()');
  if (/isLoadingAccountBundle/.test(text))             f.push('isLoadingAccountBundle');
  if (/_bundleVisibilityRetryPending/.test(text))      f.push('_bundleVisibilityRetryPending');
  if (/lastBundleRefreshAt/.test(text))               f.push('lastBundleRefreshAt');
  return uniq(f);
}

function detectOrgSignals(text) {
  const f = [];
  if (/tp3d:org-changed/.test(text))               f.push('tp3d:org-changed');
  if (/applyOrgContextFromBundle\s*\(/.test(text))  f.push('applyOrgContextFromBundle()');
  if (/getActiveOrgId\s*\(/.test(text))            f.push('getActiveOrgId()');
  if (/getActiveOrgIdForBilling\s*\(/.test(text))  f.push('getActiveOrgIdForBilling()');
  if (/ensureOrgChangedListener\s*\(/.test(text))  f.push('ensureOrgChangedListener()');
  if (/awaitOrgReady\s*\(/.test(text))             f.push('awaitOrgReady()');
  if (/\bOrgContext\b/.test(text))                 f.push('OrgContext');
  if (/normalizeOrgId\s*\(/.test(text))            f.push('normalizeOrgId()');
  if (/\bmodalOrgId\b/.test(text))                 f.push('modalOrgId');
  return uniq(f);
}

function detectHiddenTabSignals(text) {
  const f = [];
  if (/document\.hidden/.test(text))               f.push('document.hidden');
  if (/_billingRefreshQueued/.test(text))           f.push('_billingRefreshQueued');
  if (/_bundleVisibilityRetryPending/.test(text))   f.push('_bundleVisibilityRetryPending');
  if (/_membersVisibilityRetryPending/.test(text))  f.push('_membersVisibilityRetryPending');
  if (/visibilitychange/.test(text))               f.push('visibilitychange');
  if (/requestAuthRefresh\s*\(/.test(text))         f.push('requestAuthRefresh()');
  if (/rehydrateAuthState\s*\(/.test(text))         f.push('rehydrateAuthState()');
  return uniq(f);
}

function detectStorageSignals(text) {
  const f = [];
  if (/localStorage\.setItem\s*\(/.test(text))     f.push('localStorage.setItem()');
  if (/localStorage\.getItem\s*\(/.test(text))     f.push('localStorage.getItem()');
  if (/localStorage\.removeItem\s*\(/.test(text))  f.push('localStorage.removeItem()');
  if (/sessionStorage\./.test(text))               f.push('sessionStorage');
  if (/window\.addEventListener\s*\(\s*['"`]storage['"`]/.test(text)) f.push('window.storage-listener');
  for (const m of findAll("localStorage\\.[a-zA-Z]+\\s*\\(\\s*['\"`](tp3d:[^'\"`]+)['\"`]", 'g', text)) {
    f.push('key:' + m[1]);
  }
  return uniq(f);
}

function detectSingleFlightSignals(text) {
  const f = [];
  if (/SingleFlight|_singleFlight/.test(text)) f.push('SingleFlight');
  if (/debounce\s*\(/.test(text))              f.push('debounce()');
  if (/\bsetTimeout\s*\(/.test(text))          f.push('setTimeout()');
  if (/\bclearTimeout\s*\(/.test(text))        f.push('clearTimeout()');
  return uniq(f);
}

function detectListeners(text) {
  return uniq(
    findAll("addEventListener\\s*\\(\\s*['\"`]([^'\"`]+)['\"`]", 'g', text).map(m => m[1])
  );
}

function detectTp3dEvents(text) {
  const all   = findAll("['\"`](tp3d:[a-z0-9:_-]+)['\"`]", 'g', text).map(m => m[1]);
  const emit  = findAll("dispatchEvent[^)]{0,80}['\"`](tp3d:[a-z0-9:_-]+)['\"`]", 'g', text).map(m => m[1]);
  const listen = findAll("addEventListener\\s*\\(\\s*['\"`](tp3d:[a-z0-9:_-]+)['\"`]", 'g', text).map(m => m[1]);
  const classified = new Set([...emit, ...listen]);
  const referenced = all.filter(e => !classified.has(e));
  return { emit: uniq(emit), listen: uniq(listen), referenced: uniq(referenced) };
}

function detectFactory(text) {
  const fnM = text.match(/export\s+(?:async\s+)?function\s+(create\w+)\s*\(/);
  if (!fnM) return null;
  const name = fnM[1];

  let params = [];
  const paramRe = new RegExp('export\\s+(?:async\\s+)?function\\s+' + name + '\\s*\\(\\s*\\{([^}]+)\\}');
  const paramM = text.match(paramRe);
  if (paramM) {
    params = paramM[1]
      .split(/[,\n]/)
      .map(s => s.replace(/[:=\s].*/, '').replace(/[^a-zA-Z0-9_$]/g, '').trim())
      .filter(Boolean);
  }

  let returns = [];
  const returnMatches = findAll('return\\s*\\{([^}]{0,500})\\}', 'g', text);
  if (returnMatches.length) {
    const last = returnMatches[returnMatches.length - 1][1];
    returns = last
      .split(/[,\n]/)
      .map(s => s.replace(/[:(\s].*/, '').replace(/[^a-zA-Z0-9_$]/g, '').trim())
      .filter(Boolean);
  }

  return { name, params: uniq(params), returns: uniq(returns) };
}

function buildSignals(text) {
  return {
    auth:          detectAuthSignals(text),
    billing:       detectBillingSignals(text),
    bundle:        detectBundleSignals(text),
    orgChange:     detectOrgSignals(text),
    hiddenTabGuard: detectHiddenTabSignals(text),
    tp3dEvents:    detectTp3dEvents(text),
    storage:       detectStorageSignals(text),
    singleFlight:  detectSingleFlightSignals(text),
    listeners:     detectListeners(text),
  };
}

function churnScore(signals) {
  return (signals.auth.length          * 3)
       + (signals.billing.length       * 3)
       + (signals.bundle.length        * 2)
       + (signals.orgChange.length     * 2)
       + (signals.hiddenTabGuard.length * 1)
       + (signals.storage.length       * 1);
}

// ─── Import extraction ───────────────────────────────────────────────────────
function extractImports(absFile, text) {
  const specs = [
    ...findAll("import\\s+[\\s\\S]*?\\sfrom\\s+['\"`]([^'\"`]+)['\"`]", 'g', text).map(m => m[1]),
    ...findAll("import\\s+['\"`]([^'\"`]+)['\"`]", 'g', text).map(m => m[1]),
    ...findAll("export\\s+[\\s\\S]*?\\sfrom\\s+['\"`]([^'\"`]+)['\"`]", 'g', text).map(m => m[1]),
  ];

  const localImports    = [];
  const externalImports = [];
  const edges           = [];
  const fromId          = rel(absFile);

  for (const spec of uniq(specs)) {
    const target = resolveImport(absFile, spec);
    if (!target) continue;
    if (typeof target === 'string') {
      localImports.push(target);
      edges.push({ from: fromId, to: target, type: 'import', spec });
    } else if (target.external) {
      externalImports.push(target.spec);
    }
  }
  return { imports: uniq(localImports), externalImports: uniq(externalImports), edges };
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('❌  src/ not found at:', SRC_DIR);
    process.exit(1);
  }

  const indexHtml = parseIndexHtml();
  const absFiles  = walkSrc(SRC_DIR);

  const nodes     = {};
  const allEdges  = [];

  for (const abs of absFiles) {
    const id   = rel(abs);
    const text = safeRead(abs);
    const { imports, externalImports, edges } = extractImports(abs, text);
    const signals = buildSignals(text);

    nodes[id] = {
      id,
      path: id,
      churnRisk:       churnScore(signals),
      signals,
      factory:         detectFactory(text),
      imports,
      externalImports,
      importedBy: [],
    };
    allEdges.push(...edges);
  }

  // Reverse-edge pass
  for (const e of allEdges) {
    if (nodes[e.to]) nodes[e.to].importedBy.push(e.from);
  }
  for (const n of Object.values(nodes)) n.importedBy = uniq(n.importedBy);

  // Hot maps
  const hot = {
    billing:        [],
    auth:           [],
    bundle:         [],
    orgChange:      [],
    hiddenTabGuard: [],
    storage:        [],
    churnRisk:      [],
  };
  for (const n of Object.values(nodes)) {
    if (n.signals.billing.length)        hot.billing.push(n.id);
    if (n.signals.auth.length)           hot.auth.push(n.id);
    if (n.signals.bundle.length)         hot.bundle.push(n.id);
    if (n.signals.orgChange.length)      hot.orgChange.push(n.id);
    if (n.signals.hiddenTabGuard.length) hot.hiddenTabGuard.push(n.id);
    if (n.signals.storage.length)        hot.storage.push(n.id);
  }
  hot.churnRisk = Object.values(nodes)
    .filter(n => n.churnRisk > 0)
    .sort((a, b) => b.churnRisk - a.churnRisk)
    .slice(0, 10)
    .map(n => ({ id: n.id, score: n.churnRisk }));

  const allTp3dEmitted  = uniq(Object.values(nodes).flatMap(n => n.signals.tp3dEvents.emit)).sort();
  const allTp3dListened = uniq(Object.values(nodes).flatMap(n => n.signals.tp3dEvents.listen)).sort();

  const summary = {
    totalFiles:              Object.keys(nodes).length,
    totalEdges:              allEdges.length,
    tp3dEventsEmitted:       allTp3dEmitted,
    tp3dEventsListened:      allTp3dListened,
    topChurnFiles:           hot.churnRisk,
    filesWithBillingCalls:   hot.billing,
    filesWithHiddenTabGuards: hot.hiddenTabGuard,
    filesWithCrossTabStorage: Object.values(nodes)
      .filter(n => n.signals.storage.includes('window.storage-listener'))
      .map(n => n.id),
    factoryFiles: Object.values(nodes)
      .filter(n => n.factory)
      .map(n => ({ id: n.id, factory: n.factory.name, returns: n.factory.returns })),
  };

  const graph = {
    generatedAt: new Date().toISOString(),
    root:        rel(ROOT) || '.',
    nodeCount:   Object.keys(nodes).length,
    edgeCount:   allEdges.length,
    indexHtml,
    hot,
    nodes,
    edges: allEdges,
    summary,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(graph, null, 2), 'utf8');

  // Console report
  const top3 = hot.churnRisk.slice(0, 3).map(x => `${x.id}(${x.score})`).join('  ');
  console.log('✅  Wrote:', rel(OUT_FILE));
  console.log(`Nodes: ${graph.nodeCount} | Edges: ${graph.edgeCount}`);
  console.log('Hot (churnRisk top-3):', top3 || '(none)');
  console.log('Hot counts:',
    `billing(${hot.billing.length})`,
    ` auth(${hot.auth.length})`,
    ` bundle(${hot.bundle.length})`,
    ` orgChange(${hot.orgChange.length})`,
    ` hiddenTabGuard(${hot.hiddenTabGuard.length})`
  );
  console.log('TP3D events emitted :', allTp3dEmitted.join(', ') || '(none)');
  console.log('TP3D events listened:', allTp3dListened.join(', ') || '(none)');
  if (summary.factoryFiles.length) {
    console.log('Factory exports     :',
      summary.factoryFiles.map(f => `${f.factory}→[${f.returns.join(',')}]`).join('  '));
  }
}

main();
