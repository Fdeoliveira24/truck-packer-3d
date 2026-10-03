// runtime security invariants: contract tests from the former security suite.

import {
  appPath,
  assert,
  corsSharedPath,
  fs,
  readAppSource,
  test,
} from '../fixtures/security-invariants-support.mjs';

test('shared CORS json helper does not default to wildcard origin', async () => {
  const source = await fs.readFile(corsSharedPath, 'utf8');
  assert.equal(source.includes('const allowOrigin = opts.origin ?? "*";'), false);
  assert.match(source, /const allowOrigin = opts\.origin \?\? "null";/);
});

test('P0 RUNTIME WIRING: app.js StateStore facade exposes resetHistory to AppShell', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');

  const facadeStart = appSrc.indexOf('const StateStore = {');
  assert.ok(facadeStart >= 0, 'app.js must define the runtime StateStore facade');
  const facadeEnd = appSrc.indexOf('\n    };', facadeStart);
  assert.ok(facadeEnd > facadeStart, 'the StateStore facade object literal must close');
  const facadeBlock = appSrc.slice(facadeStart, facadeEnd);

  // AppShell.navigate() calls StateStore.resetHistory() on Editor entry — if the
  // hand-maintained facade drifts and stops forwarding it, that throws at runtime
  // ("StateStore.resetHistory is not a function") even though every method exists
  // on the underlying core/state-store.js module.
  for (const method of ['init', 'get', 'set', 'replace', 'snapshot', 'resetHistory', 'undo', 'redo', 'subscribe']) {
    assert.match(facadeBlock, new RegExp(`${method}:\\s*CoreStateStore\\.${method},`),
      `the StateStore facade must forward ${method} from CoreStateStore`);
  }

  const appShellCallStart = appSrc.indexOf('createAppShell({');
  assert.ok(appShellCallStart >= 0, 'app.js must construct AppShell');
  const appShellCallEnd = appSrc.indexOf('});', appShellCallStart);
  const appShellCallBlock = appSrc.slice(appShellCallStart, appShellCallEnd);
  assert.match(appShellCallBlock, /\bStateStore,/,
    'createAppShell must receive the app.js StateStore facade (not the CoreStateStore module directly)');
});

test('HARDEN-P1A boot-time unhandledrejection still shows fatal overlay when appReady is false', async () => {
  const src = await readAppSource();

  const handlerDecl = src.indexOf('const handleRuntimeUnhandledRejection = ev =>');
  const addListenerAnchor = src.indexOf("window.addEventListener('error', handleRuntimeError", handlerDecl);
  const handlerBlock = src.slice(handlerDecl, addListenerAnchor);

  // appReady check must gate the post-boot early return
  assert.match(handlerBlock, /BootState\.appReady === true/, 'appReady guard present in rejection handler');

  // showFatalOverlay must be reachable for pre-boot rejections (i.e., appears in handler body)
  assert.match(handlerBlock, /showFatalOverlay/, 'showFatalOverlay reachable for pre-boot rejections');

  // The appReady check must appear before showFatalOverlay so the early-return branch fires first
  const appReadyPos = handlerBlock.indexOf('BootState.appReady === true');
  const fatalPos = handlerBlock.lastIndexOf('showFatalOverlay');
  assert.ok(fatalPos > appReadyPos, 'showFatalOverlay is reached only after the appReady branch');
});
