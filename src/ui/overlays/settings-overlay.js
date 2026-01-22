/**
 * @file settings-overlay.js
 * @description Settings overlay UI for viewing and updating user preferences.
 * @module ui/overlays/settings-overlay
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function createSettingsOverlay({
  documentRef = document,
  UIComponents,
  SessionManager,
  PreferencesManager,
  Defaults,
  Utils,
  getAccountSwitcher,
}) {
  const doc = documentRef;

  let settingsOverlay = null;
  let settingsModal = null;
  let settingsLeftPane = null;
  let settingsRightPane = null;
  let settingsActiveTab = 'account';
  let unmountAccountButton = null;

  function isOpen() {
    return Boolean(settingsOverlay);
  }

  function close() {
    if (!settingsOverlay) return;
    try {
      if (typeof unmountAccountButton === 'function') unmountAccountButton();
    } catch {
      // ignore
    }
    unmountAccountButton = null;

    try {
      settingsOverlay._tp3dCleanup && settingsOverlay._tp3dCleanup();
    } catch {
      // ignore
    }

    try {
      if (settingsOverlay.parentElement) settingsOverlay.parentElement.removeChild(settingsOverlay);
    } catch {
      // ignore
    }

    settingsOverlay = null;
    settingsModal = null;
    settingsLeftPane = null;
    settingsRightPane = null;
  }

  function setActive(tab) {
    settingsActiveTab = String(tab || 'account');
    render();
  }

  function savePrefsFromForm({ length, weight, theme, labelSize, hiddenOpacity }) {
    const prev = PreferencesManager.get();
    const next = Utils.deepClone(prev);
    next.units.length = length;
    next.units.weight = weight;
    next.theme = theme;
    next.labelFontSize = Utils.clamp(Number(labelSize) || 12, 8, 24);
    next.hiddenCaseOpacity = Utils.clamp(Number(hiddenOpacity) || 0.3, 0, 1);
    PreferencesManager.set(next);
    PreferencesManager.applyTheme(next.theme);
    UIComponents.showToast('Preferences saved', 'success');
  }

  function render() {
    if (!settingsOverlay) return;
    const session = SessionManager.get();
    const prefs = PreferencesManager.get();

    settingsLeftPane.innerHTML = '';
    settingsRightPane.innerHTML = '';

    // Left: account switcher button
    const accountBtn = doc.createElement('button');
    accountBtn.type = 'button';
    accountBtn.className = 'btn';
    accountBtn.style.width = '100%';
    accountBtn.style.justifyContent = 'space-between';
    accountBtn.style.padding = 'var(--space-2) var(--space-3)';
    accountBtn.innerHTML = `
      <span style="display:flex;align-items:center;gap:var(--space-3);min-width:0">
        <span class="brand-mark" aria-hidden="true" style="width:34px;height:34px;border-radius:12px;flex:0 0 auto"></span>
        <span style="display:flex;flex-direction:column;align-items:flex-start;min-width:0">
          <span style="font-weight:var(--font-semibold);line-height:1.1">${session.currentAccount?.name || 'Personal Account'}</span>
          <span class="muted" data-account-name style="font-size:var(--text-sm);line-height:1.1">${
            session.user?.name || '—'
          }</span>
        </span>
      </span>
      <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
    `;
    settingsLeftPane.appendChild(accountBtn);
    const accountSwitcher = getAccountSwitcher ? getAccountSwitcher() : null;
    unmountAccountButton =
      accountSwitcher && accountSwitcher.bind ? accountSwitcher.bind(accountBtn, { align: 'left' }) : null;

    // Left: settings navigation
    const navWrap = doc.createElement('div');
    navWrap.style.display = 'grid';
    navWrap.style.gap = '6px';

    const makeHeader = text => {
      const h = doc.createElement('div');
      h.className = 'muted';
      h.style.marginTop = '10px';
      h.style.fontSize = 'var(--text-sm)';
      h.textContent = text;
      return h;
    };

    const makeItem = ({ key, label, icon, indent }) => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-btn';
      btn.style.width = '100%';
      btn.style.borderRadius = 'var(--radius-sm)';
      btn.style.paddingLeft = '12px';
      btn.style.paddingRight = '12px';
      btn.style.gap = '12px';
      btn.style.fontSize = 'var(--text-base)';
      btn.dataset.settingsTab = key;

      if (icon) {
        const i = doc.createElement('i');
        i.className = icon;
        i.style.width = '20px';
        i.style.display = 'inline-flex';
        i.style.alignItems = 'center';
        i.style.justifyContent = 'center';
        i.style.color = settingsActiveTab === key ? 'var(--accent-primary)' : 'var(--text-secondary)';
        if (indent) i.style.marginLeft = '16px';
        btn.appendChild(i);
      }

      const text = doc.createElement('span');
      text.textContent = label;
      text.style.flex = '1';
      btn.appendChild(text);

      btn.classList.toggle('active', settingsActiveTab === key);
      btn.addEventListener('click', () => setActive(key));
      return btn;
    };

    navWrap.appendChild(makeHeader('Account'));
    navWrap.appendChild(makeItem({ key: 'account', label: 'Account', icon: 'fa-regular fa-user' }));
    navWrap.appendChild(makeItem({ key: 'preferences', label: 'Preferences', icon: 'fa-solid fa-gear' }));
    navWrap.appendChild(makeHeader('Organization'));
    navWrap.appendChild(makeItem({ key: 'org-general', label: 'General', icon: 'fa-regular fa-building', indent: true }));
    navWrap.appendChild(
      makeItem({ key: 'org-billing', label: 'Billing', icon: 'fa-regular fa-credit-card', indent: true })
    );
    settingsLeftPane.appendChild(navWrap);

    // Right: header
    const header = doc.createElement('div');
    header.className = 'row space-between';
    header.style.padding = 'var(--space-5) var(--space-6)';
    header.style.borderBottom = '1px solid var(--border-subtle)';
    header.style.alignItems = 'flex-start';
    const title = doc.createElement('div');
    title.style.fontSize = 'var(--text-2xl)';
    title.style.fontWeight = 'var(--font-semibold)';
    title.textContent =
      settingsActiveTab === 'account'
        ? 'Account'
        : settingsActiveTab === 'preferences'
          ? 'Display Units'
          : 'Organization';
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', () => close());
    header.appendChild(title);
    header.appendChild(closeBtn);
    settingsRightPane.appendChild(header);

    const body = doc.createElement('div');
    body.style.padding = 'var(--space-6)';
    body.style.overflow = 'auto';
    body.style.minWidth = '0';
    settingsRightPane.appendChild(body);

    function row(label, valueEl) {
      const wrap = doc.createElement('div');
      wrap.style.display = 'grid';
      wrap.style.gridTemplateColumns = '220px 1fr';
      wrap.style.gap = '16px';
      wrap.style.alignItems = 'center';
      wrap.style.padding = '16px 0';
      wrap.style.borderBottom = '1px solid var(--border-subtle)';
      const l = doc.createElement('div');
      l.style.fontWeight = 'var(--font-semibold)';
      l.textContent = label;
      wrap.appendChild(l);
      wrap.appendChild(valueEl);
      return wrap;
    }

    if (settingsActiveTab === 'account') {
      const nameRow = doc.createElement('div');
      nameRow.className = 'row';
      nameRow.style.gap = '12px';
      nameRow.innerHTML = `<span class="brand-mark" aria-hidden="true" style="width:40px;height:40px;border-radius:14px"></span><div style="font-weight:var(--font-semibold)">${
        session.user?.name || '—'
      }</div>`;
      body.appendChild(nameRow);

      const emailEl = doc.createElement('div');
      emailEl.textContent = session.user?.email || '—';
      body.appendChild(row('Email', emailEl));

      const danger = doc.createElement('div');
      danger.style.marginTop = '26px';
      danger.innerHTML = `
        <div style="font-size:var(--text-xl);font-weight:var(--font-semibold);margin-bottom:10px">Danger Zone</div>
        <div style="border-top:1px solid var(--border-subtle)"></div>
      `;
      const dangerRow = doc.createElement('div');
      dangerRow.style.display = 'grid';
      dangerRow.style.gridTemplateColumns = '220px 1fr';
      dangerRow.style.gap = '16px';
      dangerRow.style.alignItems = 'center';
      dangerRow.style.padding = '16px 0';
      const dLeft = doc.createElement('div');
      dLeft.style.color = 'var(--error)';
      dLeft.style.fontWeight = 'var(--font-semibold)';
      dLeft.textContent = 'Delete Account';
      const dRight = doc.createElement('div');
      dRight.className = 'muted';
      dRight.textContent = 'Contact support to delete your account. help@backlinelogic.com';
      dangerRow.appendChild(dLeft);
      dangerRow.appendChild(dRight);
      danger.appendChild(dangerRow);
      body.appendChild(danger);
    } else if (settingsActiveTab === 'preferences') {
      const length = doc.createElement('select');
      length.className = 'select';
      length.innerHTML = `
        <option value="in">Inches (in)</option>
        <option value="ft">Feet (ft)</option>
        <option value="mm">Millimeters (mm)</option>
        <option value="cm">Centimeters (cm)</option>
        <option value="m">Meters (m)</option>
      `;
      length.value = prefs.units.length;

      const weight = doc.createElement('select');
      weight.className = 'select';
      weight.innerHTML = `
        <option value="lb">Pounds (lb)</option>
        <option value="kg">Kilograms (kg)</option>
      `;
      weight.value = prefs.units.weight;

      const hiddenOpacity = doc.createElement('input');
      hiddenOpacity.className = 'input';
      hiddenOpacity.type = 'number';
      hiddenOpacity.min = '0';
      hiddenOpacity.max = '1';
      hiddenOpacity.step = '0.05';
      hiddenOpacity.value = String(prefs.hiddenCaseOpacity);

      const labelSize = doc.createElement('input');
      labelSize.className = 'input';
      labelSize.type = 'number';
      labelSize.min = '8';
      labelSize.max = '24';
      labelSize.step = '1';
      labelSize.value = String(prefs.labelFontSize);

      const theme = doc.createElement('select');
      theme.className = 'select';
      theme.innerHTML = `
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      `;
      theme.value = prefs.theme;

      body.appendChild(row('Length', length));
      body.appendChild(row('Weight', weight));
      body.appendChild(row('Hidden Case Opacity', hiddenOpacity));
      body.appendChild(row('Label Font Size', labelSize));
      body.appendChild(row('Theme', theme));

      const actions = doc.createElement('div');
      actions.className = 'row';
      actions.style.justifyContent = 'flex-end';
      actions.style.marginTop = '18px';
      const saveBtn = doc.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn-primary';
      saveBtn.textContent = 'Save changes';
      saveBtn.addEventListener('click', () =>
        savePrefsFromForm({
          length: length.value,
          weight: weight.value,
          theme: theme.value,
          labelSize: labelSize.value,
          hiddenOpacity: hiddenOpacity.value,
        })
      );
      actions.appendChild(saveBtn);
      body.appendChild(actions);
    } else if (settingsActiveTab === 'org-general') {
      const orgName = session.currentAccount?.name || 'Personal Account';
      const orgRole = session.currentAccount?.role || 'Owner';
      const slug = (session.user?.email || 'personal').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

      const orgCard = doc.createElement('div');
      orgCard.className = 'card';
      orgCard.style.maxWidth = '820px';
      orgCard.innerHTML = `
        <div style="display:grid;gap:18px">
          <div style="font-size:var(--text-xl);font-weight:var(--font-semibold)">Organization</div>
          <div style="border-top:1px solid var(--border-subtle)"></div>
          <div style="display:grid;gap:0">
            <div style="display:grid;grid-template-columns:220px 1fr;gap:16px;align-items:center;padding:16px 0;border-bottom:1px solid var(--border-subtle)">
              <div style="font-weight:var(--font-semibold)">Logo</div>
              <div><span class="brand-mark" aria-hidden="true" style="width:64px;height:64px;border-radius:18px;display:inline-block"></span></div>
            </div>
            <div style="display:grid;grid-template-columns:220px 1fr;gap:16px;align-items:center;padding:16px 0;border-bottom:1px solid var(--border-subtle)">
              <div style="font-weight:var(--font-semibold)">Name</div>
              <div>${orgName}</div>
            </div>
            <div style="display:grid;grid-template-columns:220px 1fr;gap:16px;align-items:center;padding:16px 0;border-bottom:1px solid var(--border-subtle)">
              <div style="font-weight:var(--font-semibold)">Role</div>
              <div>${orgRole}</div>
            </div>
            <div style="display:grid;grid-template-columns:220px 1fr;gap:16px;align-items:center;padding:16px 0;border-bottom:1px solid var(--border-subtle)">
              <div style="font-weight:var(--font-semibold)">Slug</div>
              <div class="muted" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">${slug}</div>
            </div>
          </div>
        </div>
      `;
      body.appendChild(orgCard);
    } else {
      const billingCard = doc.createElement('div');
      billingCard.className = 'card';
      billingCard.style.maxWidth = '820px';
      billingCard.innerHTML = `
        <div style="display:grid;gap:12px">
          <div style="font-size:var(--text-xl);font-weight:var(--font-semibold)">Billing</div>
          <div class="muted">This is a demo build. Billing integrations can be added in Phase 2.</div>
          <div style="border-top:1px solid var(--border-subtle)"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
            <div>
              <div style="font-weight:var(--font-semibold)">Current plan</div>
              <div class="muted">${session.currentAccount?.plan || 'Trial'}</div>
            </div>
            <button type="button" class="btn btn-primary">Upgrade</button>
          </div>
        </div>
      `;
      body.appendChild(billingCard);
    }
  }

  function open(tab) {
    if (settingsOverlay) return setActive(tab || settingsActiveTab);

    settingsOverlay = doc.createElement('div');
    settingsOverlay.className = 'modal-overlay';

    settingsModal = doc.createElement('div');
    settingsModal.className = 'modal';
    settingsModal.style.width = 'min(1100px, 94vw)';
    settingsModal.style.height = 'min(760px, 92vh)';
    settingsModal.style.display = 'grid';
    settingsModal.style.gridTemplateColumns = '280px 1fr';
    settingsModal.style.padding = '0';
    settingsModal.style.overflow = 'hidden';

    settingsLeftPane = doc.createElement('div');
    settingsLeftPane.style.padding = 'var(--space-6)';
    settingsLeftPane.style.borderRight = '1px solid var(--border-subtle)';
    settingsLeftPane.style.display = 'flex';
    settingsLeftPane.style.flexDirection = 'column';
    settingsLeftPane.style.gap = 'var(--space-4)';

    settingsRightPane = doc.createElement('div');
    settingsRightPane.style.display = 'flex';
    settingsRightPane.style.flexDirection = 'column';
    settingsRightPane.style.minWidth = '0';

    settingsModal.appendChild(settingsLeftPane);
    settingsModal.appendChild(settingsRightPane);
    settingsOverlay.appendChild(settingsModal);

    settingsOverlay.addEventListener('click', ev => {
      if (ev.target === settingsOverlay) close();
    });

    function onKeyDown(ev) {
      if (ev.key === 'Escape') close();
    }
    doc.addEventListener('keydown', onKeyDown);

    const root = doc.getElementById('modal-root');
    root.appendChild(settingsOverlay);

    settingsOverlay._tp3dCleanup = () => {
      doc.removeEventListener('keydown', onKeyDown);
    };

    if (tab) settingsActiveTab = String(tab);
    render();
  }

  function init() {
    // No-op; settings overlay is constructed lazily on demand.
  }

  return { init, open, close, isOpen, setActive, render };
}
