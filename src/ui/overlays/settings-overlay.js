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
  SessionManager: _SessionManager,
  PreferencesManager,
  Defaults: _Defaults,
  Utils,
  getAccountSwitcher,
  SupabaseClient,
  onExportApp,
  onImportApp,
  onHelp,
}) {
  const doc = documentRef;

  let settingsOverlay = null;
  let settingsModal = null;
  let settingsLeftPane = null;
  let settingsRightPane = null;
  let settingsActiveTab = 'account';
  let unmountAccountButton = null;
  let lastFocusedEl = null;
  let trapKeydownHandler = null;
  let warnedMissingModalRoot = false;

  // NOTE: Phase 2+ will optionally pass a profile row (profiles table) into this helper.
  // For now, keep Supabase-only behavior and safe fallbacks.
  function getCurrentUserView(profile = null) {
    let user = null;
    try {
      user = SupabaseClient && SupabaseClient.getUser ? SupabaseClient.getUser() : null;
    } catch {
      user = null;
    }

    const isAuthed = Boolean(user);
    const userId = user && user.id ? String(user.id) : '';
    const email = user && user.email ? String(user.email) : '';

    let displayName = '';
    if (profile && typeof profile === 'object') {
      if (profile.full_name) displayName = String(profile.full_name);
      if (!displayName && (profile.first_name || profile.last_name)) {
        displayName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
      }
    }
    if (user && user.user_metadata) {
      if (!displayName) displayName = user.user_metadata.full_name || user.user_metadata.name || '';
    }
    if (!displayName && email) {
      const prefix = email.split('@')[0];
      displayName = prefix || '';
    }
    if (!displayName) displayName = isAuthed ? 'User' : 'Guest';

    let initials = '';
    if (displayName && displayName !== 'Guest') {
      const words = displayName.trim().split(/\s+/).filter(Boolean);
      if (words.length >= 2) {
        initials = (words[0][0] + words[1][0]).toUpperCase();
      } else if (words.length === 1 && words[0].length >= 2) {
        initials = words[0].substring(0, 2).toUpperCase();
      } else if (words[0]) {
        initials = words[0][0].toUpperCase();
      }
    }
    if (!initials && email && email.length >= 2) {
      initials = email.substring(0, 2).toUpperCase();
    }

    const workspaceShareId = userId ? userId.slice(0, 8) : '';

    return { isAuthed, userId, email, displayName, initials, workspaceShareId };
  }

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
      doc.body.classList.remove('modal-open');
    } catch {
      // ignore
    }

    try {
      if (trapKeydownHandler) doc.removeEventListener('keydown', trapKeydownHandler, true);
    } catch {
      // ignore
    }
    trapKeydownHandler = null;

    try {
      if (settingsOverlay.parentElement) settingsOverlay.parentElement.removeChild(settingsOverlay);
    } catch {
      // ignore
    }

    settingsOverlay = null;
    settingsModal = null;
    settingsLeftPane = null;
    settingsRightPane = null;

    try {
      if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
        lastFocusedEl.focus();
      }
    } catch {
      // ignore
    }
    lastFocusedEl = null;
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
    const prefs = PreferencesManager.get();

    settingsLeftPane.innerHTML = '';
    settingsRightPane.innerHTML = '';

    // Left: account switcher button
    const userView = getCurrentUserView();
    const accountBtn = doc.createElement('button');
    accountBtn.type = 'button';
    accountBtn.className = 'btn';
    accountBtn.classList.add('tp3d-settings-account-btn');
    accountBtn.innerHTML = `
      <span class="tp3d-settings-account-inner">
        <span class="brand-mark tp3d-settings-account-avatar" aria-hidden="true">${userView.initials || ''}</span>
        <span class="tp3d-settings-account-text">
          <span class="tp3d-settings-account-name">Workspace</span>
          <span class="muted tp3d-settings-account-sub" data-account-name>${userView.displayName || '—'}</span>
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
    navWrap.classList.add('tp3d-settings-nav-wrap');

    const makeHeader = text => {
      const h = doc.createElement('div');
      h.className = 'muted';
      h.classList.add('tp3d-settings-nav-header');
      h.textContent = text;
      return h;
    };

    const makeItem = ({ key, label, icon, indent }) => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-btn';
      btn.classList.add('tp3d-settings-nav-item');
      btn.dataset.settingsTab = key;

      if (icon) {
        const i = doc.createElement('i');
        i.className = icon;
        i.classList.add('tp3d-settings-nav-icon');
        if (indent) i.classList.add('is-indented');
        btn.appendChild(i);
      }

      const text = doc.createElement('span');
      text.textContent = label;
      text.classList.add('tp3d-settings-nav-label');
      btn.appendChild(text);

      btn.classList.toggle('active', settingsActiveTab === key);
      btn.addEventListener('click', () => setActive(key));
      return btn;
    };

    navWrap.appendChild(makeHeader('Account'));
    navWrap.appendChild(makeItem({ key: 'account', label: 'Account', icon: 'fa-regular fa-user' }));
    navWrap.appendChild(makeItem({ key: 'preferences', label: 'Preferences', icon: 'fa-solid fa-gear' }));
    navWrap.appendChild(makeItem({ key: 'resources', label: 'Resources', icon: 'fa-solid fa-life-ring' }));
    navWrap.appendChild(makeHeader('Organization'));
    navWrap.appendChild(makeItem({ key: 'org-general', label: 'General', icon: 'fa-regular fa-building', indent: true }));
    navWrap.appendChild(
      makeItem({ key: 'org-billing', label: 'Billing', icon: 'fa-regular fa-credit-card', indent: true })
    );
    settingsLeftPane.appendChild(navWrap);

    // Right: header
    const header = doc.createElement('div');
    header.className = 'row space-between';
    header.classList.add('tp3d-settings-right-header');
    const title = doc.createElement('div');
    title.classList.add('tp3d-settings-right-title');
    title.textContent =
      settingsActiveTab === 'account'
        ? 'Account'
        : settingsActiveTab === 'preferences'
          ? 'Display Units'
          : settingsActiveTab === 'resources'
            ? 'Resources'
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
    body.classList.add('tp3d-settings-right-body');
    settingsRightPane.appendChild(body);

    function row(label, valueEl) {
      const wrap = doc.createElement('div');
      wrap.classList.add('tp3d-settings-row');
      const l = doc.createElement('div');
      l.classList.add('tp3d-settings-row-label');
      l.textContent = label;
      wrap.appendChild(l);
      wrap.appendChild(valueEl);
      return wrap;
    }

    if (settingsActiveTab === 'account') {
      const userView = getCurrentUserView();
      const nameRow = doc.createElement('div');
      nameRow.className = 'row';
      nameRow.classList.add('tp3d-settings-account-row');
      nameRow.innerHTML = `<span class="brand-mark tp3d-settings-account-avatar-lg" aria-hidden="true">${
        userView.initials || ''
      }</span><div class="tp3d-settings-account-display">${userView.displayName || '—'}</div>`;
      body.appendChild(nameRow);

      const emailEl = doc.createElement('div');
      emailEl.textContent = userView.isAuthed && userView.email ? userView.email : 'Not signed in';
      body.appendChild(row('Email', emailEl));

      const danger = doc.createElement('div');
      danger.classList.add('tp3d-settings-danger');
      danger.innerHTML = `
        <div class="tp3d-settings-danger-title">Danger Zone</div>
        <div class="tp3d-settings-danger-divider"></div>
      `;
      const dangerRow = doc.createElement('div');
      dangerRow.classList.add('tp3d-settings-danger-row');
      const dLeft = doc.createElement('div');
      dLeft.classList.add('tp3d-settings-danger-left');
      dLeft.textContent = 'Delete Account';
      const dRight = doc.createElement('div');
      dRight.classList.add('tp3d-settings-danger-right');
      const delBtn = doc.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger';
      delBtn.textContent = 'Delete account';
      delBtn.disabled = true;
      const dMsg = doc.createElement('div');
      dMsg.className = 'muted';
      dMsg.classList.add('tp3d-settings-danger-msg');
      const warnIcon = doc.createElement('i');
      warnIcon.className = 'fa-solid fa-triangle-exclamation';
      warnIcon.setAttribute('aria-hidden', 'true');
      warnIcon.classList.add('tp3d-settings-danger-warn-icon');
      const warnText = doc.createElement('span');
      warnText.textContent = 'Delete account is not set up yet.';
      dMsg.appendChild(warnIcon);
      dMsg.appendChild(warnText);
      dRight.appendChild(delBtn);
      dRight.appendChild(dMsg);
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
      actions.classList.add('tp3d-settings-actions-row');
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
    } else if (settingsActiveTab === 'resources') {
      const container = doc.createElement('div');
      container.className = 'grid';

      const subtitle = doc.createElement('div');
      subtitle.className = 'muted';
      subtitle.textContent = 'Access exports, imports, and help resources.';
      container.appendChild(subtitle);

      const makeBtn = (label, variant, onClick) => {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        if (variant) btn.classList.add(variant);
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
      };

      const exportBtn = makeBtn('Export App', null, () => {
        if (typeof onExportApp === 'function') onExportApp();
      });
      const importBtn = makeBtn('Import App', null, () => {
        if (typeof onImportApp === 'function') onImportApp();
      });
      const helpBtn = makeBtn('Help', null, () => {
        if (typeof onHelp === 'function') onHelp();
      });

      container.appendChild(exportBtn);
      container.appendChild(importBtn);
      container.appendChild(helpBtn);
      body.appendChild(container);
    } else if (settingsActiveTab === 'org-general') {
      const userView = getCurrentUserView();
      const orgName = 'Workspace';
      const orgRole = userView.isAuthed ? 'Owner' : '—';

      const orgCard = doc.createElement('div');
      orgCard.className = 'card';
      orgCard.classList.add('tp3d-settings-card-max');
      const orgWrap = doc.createElement('div');
      orgWrap.classList.add('tp3d-settings-org');

      const orgTitle = doc.createElement('div');
      orgTitle.classList.add('tp3d-settings-org-title');
      orgTitle.textContent = 'Organization';

      const orgDivider = doc.createElement('div');
      orgDivider.classList.add('tp3d-settings-org-divider');

      const orgRows = doc.createElement('div');
      orgRows.classList.add('tp3d-settings-org-rows');

      const orgRow = (label, valueEl) => {
        const wrap = doc.createElement('div');
        wrap.classList.add('tp3d-settings-row');
        const l = doc.createElement('div');
        l.classList.add('tp3d-settings-row-label');
        l.textContent = label;
        wrap.appendChild(l);
        wrap.appendChild(valueEl);
        return wrap;
      };

      const logo = doc.createElement('span');
      logo.className = 'brand-mark tp3d-settings-org-logo';
      logo.setAttribute('aria-hidden', 'true');
      logo.textContent = userView.initials || '';
      orgRows.appendChild(orgRow('Logo', logo));

      const orgNameEl = doc.createElement('div');
      orgNameEl.textContent = orgName;
      orgRows.appendChild(orgRow('Name', orgNameEl));

      const orgRoleEl = doc.createElement('div');
      orgRoleEl.textContent = orgRole;
      orgRows.appendChild(orgRow('Role', orgRoleEl));

      orgWrap.appendChild(orgTitle);
      orgWrap.appendChild(orgDivider);
      orgWrap.appendChild(orgRows);
      orgCard.appendChild(orgWrap);
      body.appendChild(orgCard);
    } else {
      const billingCard = doc.createElement('div');
      billingCard.className = 'card';
      billingCard.classList.add('tp3d-settings-card-max');
      const billingWrap = doc.createElement('div');
      billingWrap.classList.add('tp3d-settings-billing');

      const billingTitle = doc.createElement('div');
      billingTitle.classList.add('tp3d-settings-billing-title');
      billingTitle.textContent = 'Billing';

      const billingMsg = doc.createElement('div');
      billingMsg.className = 'muted tp3d-settings-billing-msg';
      billingMsg.textContent = 'Billing is not set up yet.';

      billingWrap.appendChild(billingTitle);
      billingWrap.appendChild(billingMsg);
      billingCard.appendChild(billingWrap);
      body.appendChild(billingCard);
    }
  }

  function open(tab) {
    if (settingsOverlay) return setActive(tab || settingsActiveTab);

    lastFocusedEl = doc.activeElement && typeof doc.activeElement.focus === 'function' ? doc.activeElement : null;

    settingsOverlay = doc.createElement('div');
    settingsOverlay.className = 'modal-overlay';

    settingsModal = doc.createElement('div');
    settingsModal.className = 'modal';
    settingsModal.classList.add('tp3d-settings-modal');
    settingsModal.setAttribute('role', 'dialog');
    settingsModal.setAttribute('aria-modal', 'true');
    settingsModal.setAttribute('tabindex', '-1');

    settingsLeftPane = doc.createElement('div');
    settingsLeftPane.classList.add('tp3d-settings-left-pane');

    settingsRightPane = doc.createElement('div');
    settingsRightPane.classList.add('tp3d-settings-right-pane');

    settingsModal.appendChild(settingsLeftPane);
    settingsModal.appendChild(settingsRightPane);
    settingsOverlay.appendChild(settingsModal);

    settingsOverlay.addEventListener('click', ev => {
      if (ev.target === settingsOverlay) close();
    });

    trapKeydownHandler = ev => {
      if (ev.key === 'Escape') {
        close();
        return;
      }

      if (ev.key !== 'Tab') return;
      if (!settingsModal) return;
      const focusables = Array.from(
        settingsModal.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!focusables.length) {
        ev.preventDefault();
        settingsModal.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = doc.activeElement;
      if (ev.shiftKey) {
        if (active === first || active === settingsModal) {
          ev.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    doc.addEventListener('keydown', trapKeydownHandler, true);

    const root = doc.getElementById('modal-root');
    if (root) {
      root.appendChild(settingsOverlay);
    } else {
      if (!warnedMissingModalRoot) {
        console.warn('Settings overlay: #modal-root not found, falling back to document.body');
        warnedMissingModalRoot = true;
      }
      doc.body.appendChild(settingsOverlay);
    }

    doc.body.classList.add('modal-open');

    settingsOverlay._tp3dCleanup = () => {
      if (trapKeydownHandler) {
        doc.removeEventListener('keydown', trapKeydownHandler, true);
      }
    };

    if (tab) settingsActiveTab = String(tab);
    render();

    const focusTarget = settingsModal.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (focusTarget || settingsModal).focus();
  }

  function init() {
    // No-op; settings overlay is constructed lazily on demand.
  }

  function refreshAccountUI() {
    if (isOpen()) render();
  }

  function handleAuthChange(_event) {
    try {
      refreshAccountUI();
    } catch {
      // ignore
    }
  }

  return { init, open, close, isOpen, setActive, render, refreshAccountUI, handleAuthChange };
}
