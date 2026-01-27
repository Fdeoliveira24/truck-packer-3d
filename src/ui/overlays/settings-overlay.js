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

import * as CoreStorage from '../../core/storage.js';
import * as StateStore from '../../core/state-store.js';
import { getUserAvatarView } from '../../core/utils/index.js';

export function createSettingsOverlay({
  documentRef = document,
  UIComponents,
  SessionManager: _SessionManager,
  PreferencesManager,
  Defaults: _Defaults,
  Utils,
  getAccountSwitcher,
  SupabaseClient,
  onExportApp: _onExportApp,
  onImportApp: _onImportApp,
  onHelp: _onHelp,
  onUpdates: _onUpdates,
  onRoadmap: _onRoadmap,
}) {
  const doc = documentRef;

  let settingsOverlay = null;
  let settingsModal = null;
  let settingsLeftPane = null;
  let settingsRightPane = null;
  let settingsActiveTab = 'preferences';
  let resourcesSubView = 'root';
  let unmountAccountButton = null;
  let lastFocusedEl = null;
  let trapKeydownHandler = null;
  let warnedMissingModalRoot = false;

  // NOTE: Phase 2+ will optionally pass a profile row (profiles table) into this helper.
  // Keep one shared source of truth for avatar displayName/initials.
  function getCurrentUserView(profile = null) {
    let user = null;
    try {
      user = SupabaseClient && SupabaseClient.getUser ? SupabaseClient.getUser() : null;
    } catch {
      user = null;
    }

    let sessionUser = null;
    try {
      const s = _SessionManager && typeof _SessionManager.get === 'function' ? _SessionManager.get() : null;
      sessionUser = s && s.user ? s.user : null;
    } catch {
      sessionUser = null;
    }

    return getUserAvatarView({ user, sessionUser, profile });
  }

  function isOpen() {
    return Boolean(settingsOverlay);
  }

  function close() {
    if (!settingsOverlay) return;
    resourcesSubView = 'root';
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
    settingsActiveTab = String(tab || 'preferences');
    resourcesSubView = 'root';
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

    navWrap.appendChild(makeHeader('Account Settings'));
    navWrap.appendChild(makeItem({ key: 'account', label: 'Account', icon: 'fa-regular fa-user' }));
    navWrap.appendChild(makeHeader('Settings'));
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

    const meta = (() => {
      switch (settingsActiveTab) {
        case 'account':
          return {
            title: 'Account',
            helper: 'Manage your profile and workspace identity.',
          };
        case 'preferences':
          return {
            title: 'Preferences',
            helper: 'Set your units, labels, and theme.',
          };
        case 'resources':
          return {
            title: 'Resources',
            helper: 'See updates, roadmap, exports, imports, and help in one place.',
          };
        case 'org-general':
          return {
            title: 'Organization',
            helper: 'View workspace details and role.',
          };
        case 'org-billing':
          return {
            title: 'Billing',
            helper: 'Manage billing and subscription details.',
          };
        default:
          return {
            title: 'Settings',
            helper: 'Adjust your preferences.',
          };
      }
    })();

    const headerText = doc.createElement('div');
    headerText.classList.add('tp3d-settings-right-text');

    const title = doc.createElement('div');
    title.classList.add('tp3d-settings-right-title');
    title.textContent = meta.title;

    const helper = doc.createElement('div');
    helper.classList.add('tp3d-settings-right-subtitle');
    helper.classList.add('muted');
    helper.textContent = meta.helper;

    headerText.appendChild(title);
    headerText.appendChild(helper);

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', () => close());

    header.appendChild(headerText);
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

      const dzTitle = doc.createElement('div');
      dzTitle.classList.add('tp3d-settings-danger-title');
      dzTitle.textContent = 'Deleting account';
      danger.appendChild(dzTitle);

      const dzDivider = doc.createElement('div');
      dzDivider.classList.add('tp3d-settings-danger-divider');
      danger.appendChild(dzDivider);

      const dzDesc = doc.createElement('div');
      dzDesc.className = 'muted';
      dzDesc.classList.add('tp3d-settings-delete-desc');
      dzDesc.textContent =
        'Deleting your account will remove all of your information from our database. This cannot be undone.';
      danger.appendChild(dzDesc);

      const dzConfirmLabel = doc.createElement('div');
      dzConfirmLabel.className = 'muted';
      dzConfirmLabel.classList.add('tp3d-settings-delete-confirm-label');
      dzConfirmLabel.textContent = 'To confirm this, type "DELETE"';
      danger.appendChild(dzConfirmLabel);

      const dzConfirmRow = doc.createElement('div');
      dzConfirmRow.classList.add('tp3d-settings-delete-confirm-row');
      const dzConfirmInput = doc.createElement('input');
      dzConfirmInput.className = 'input';
      dzConfirmInput.type = 'text';
      dzConfirmInput.placeholder = 'Type DELETE';
      dzConfirmInput.autocomplete = 'off';
      dzConfirmInput.spellcheck = false;
      dzConfirmInput.setAttribute('aria-label', 'Type DELETE to confirm account deletion');
      const dzDeleteBtn = doc.createElement('button');
      dzDeleteBtn.type = 'button';
      dzDeleteBtn.className = 'btn btn-danger';
      dzDeleteBtn.textContent = 'Delete account';
      dzDeleteBtn.disabled = true;

      const syncDeleteEnabled = () => {
        const ok = userView.isAuthed && String(dzConfirmInput.value || '').trim() === 'DELETE';
        dzDeleteBtn.disabled = !ok;
      };
      dzConfirmInput.addEventListener('input', syncDeleteEnabled);

      let dzInFlight = false;
      dzDeleteBtn.addEventListener('click', async () => {
        if (dzInFlight) return;
        if (!userView.isAuthed) {
          UIComponents.showToast('Not signed in', 'warning');
          return;
        }
        if (String(dzConfirmInput.value || '').trim() !== 'DELETE') return;

        dzInFlight = true;
        dzConfirmInput.disabled = true;
        dzDeleteBtn.disabled = true;
        const prevText = dzDeleteBtn.textContent;
        dzDeleteBtn.textContent = 'Deleting...';

        try {
          const client =
            SupabaseClient && typeof SupabaseClient.getClient === 'function' ? SupabaseClient.getClient() : null;
          if (!client || !client.functions || typeof client.functions.invoke !== 'function') {
            UIComponents.showToast('Delete account is not set up yet.', 'warning');
            return;
          }

          const res = await client.functions.invoke('delete-account', { body: {} });
          if (res && res.error) {
            UIComponents.showToast('Delete failed: ' + String(res.error.message || 'Unknown error'), 'error');
            return;
          }

          UIComponents.showToast('Account deleted', 'success');

          try {
            if (SupabaseClient && typeof SupabaseClient.signOut === 'function') {
              await SupabaseClient.signOut();
            }
          } catch {
            // ignore
          }
        } catch (err) {
          UIComponents.showToast('Delete failed: ' + String((err && err.message) || 'Unknown error'), 'error');
        } finally {
          dzDeleteBtn.textContent = prevText;
          dzConfirmInput.disabled = false;
          dzConfirmInput.value = '';
          dzInFlight = false;
          syncDeleteEnabled();
        }
      });

      dzConfirmRow.appendChild(dzConfirmInput);
      dzConfirmRow.appendChild(dzDeleteBtn);
      danger.appendChild(dzConfirmRow);

      if (!userView.isAuthed) {
        dzConfirmInput.disabled = true;
        dzDeleteBtn.disabled = true;
      }

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
      const makeBtn = (label, variant, onClick) => {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        if (variant) btn.classList.add(variant);
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
      };

      const renderResourcesRoot = () => {
        const container = doc.createElement('div');
        container.className = 'grid';

        const updatesBtn = makeBtn('Updates', null, () => {
          resourcesSubView = 'updates';
          render();
        });
        const roadmapBtn = makeBtn('Roadmap', null, () => {
          resourcesSubView = 'roadmap';
          render();
        });

        const exportBtn = makeBtn('Export App', null, () => {
          resourcesSubView = 'export-app';
          render();
        });
        const importBtn = makeBtn('Import App', null, () => {
          resourcesSubView = 'import-app';
          render();
        });
        const helpBtn = makeBtn('Help', null, () => {
          resourcesSubView = 'help';
          render();
        });

        container.appendChild(updatesBtn);
        container.appendChild(roadmapBtn);
        container.appendChild(exportBtn);
        container.appendChild(importBtn);
        container.appendChild(helpBtn);
        body.appendChild(container);
      };

      const renderResourcesSubView = view => {
        const wrap = doc.createElement('div');
        wrap.className = 'grid';

        const backBtn = doc.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'btn btn-ghost';
        backBtn.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Resources';
        backBtn.addEventListener('click', () => {
          resourcesSubView = 'root';
          render();
        });
        wrap.appendChild(backBtn);

        if (view === 'updates') {
          const card = doc.createElement('div');
          card.className = 'card';

          const h = doc.createElement('div');
          h.classList.add('tp3d-settings-account-display');
          h.textContent = 'Product Updates';

          const p = doc.createElement('div');
          p.className = 'muted';
          p.textContent = 'Release notes for recent versions.';

          const list = doc.createElement('div');
          list.className = 'grid';

          const makeUpdate = ({ version, date, items }) => {
            const c = doc.createElement('div');
            c.className = 'card';
            const t = doc.createElement('div');
            t.classList.add('tp3d-settings-account-display');
            t.textContent = `Version ${version}`;
            const d = doc.createElement('div');
            d.className = 'muted';
            d.textContent = date;
            const ul = doc.createElement('ul');
            items.forEach(text => {
              const li = doc.createElement('li');
              li.textContent = text;
              ul.appendChild(li);
            });
            c.appendChild(t);
            c.appendChild(d);
            c.appendChild(ul);
            return c;
          };

          const updates = [
            {
              version: '1.0.0',
              date: 'MVP',
              items: [
                'Packs and Cases libraries',
                '3D editor with drag and AutoPack',
                'CSV/XLSX import and JSON export/import',
              ],
            },
          ];

          updates.forEach(u => list.appendChild(makeUpdate(u)));

          card.appendChild(h);
          card.appendChild(p);
          wrap.appendChild(card);
          wrap.appendChild(list);
        } else if (view === 'roadmap') {
          const card = doc.createElement('div');
          card.className = 'card';

          const h = doc.createElement('div');
          h.classList.add('tp3d-settings-account-display');
          h.textContent = 'Roadmap';

          const p = doc.createElement('div');
          p.className = 'muted';
          p.textContent = 'Planned improvements and future features.';

          const list = doc.createElement('div');
          list.className = 'grid';

          const makeItemCard = ({ title: itemTitle, status }) => {
            const c = doc.createElement('div');
            c.className = 'card';
            const t = doc.createElement('div');
            t.classList.add('tp3d-settings-account-display');
            t.textContent = itemTitle;
            const s = doc.createElement('div');
            s.className = 'muted';
            s.textContent = status;
            c.appendChild(t);
            c.appendChild(s);
            return c;
          };

          [
            { title: 'Rotation in AutoPack', status: 'Planned' },
            { title: 'Weight balance tools', status: 'Planned' },
            { title: 'Multi-user collaboration', status: 'Future' },
          ].forEach(item => list.appendChild(makeItemCard(item)));

          card.appendChild(h);
          card.appendChild(p);
          wrap.appendChild(card);
          wrap.appendChild(list);
        } else if (view === 'export-app') {
          const card = doc.createElement('div');
          card.className = 'card';

          const h = doc.createElement('div');
          h.classList.add('tp3d-settings-account-display');
          h.textContent = 'Export App JSON';

          const p = doc.createElement('div');
          p.className = 'muted';
          p.textContent =
            'Exports a full JSON backup of packs, cases, and preferences. You can import it later to restore everything.';

          const details = doc.createElement('div');
          details.className = 'card';

          const dt = doc.createElement('div');
          dt.classList.add('tp3d-settings-account-display');
          dt.textContent = 'Export details';

          const fileLine = doc.createElement('div');
          fileLine.className = 'muted';
          const today = new Date();
          const yyyy = String(today.getFullYear());
          const mm = String(today.getMonth() + 1).padStart(2, '0');
          const dd = String(today.getDate()).padStart(2, '0');
          const filename = `truck-packer-app-backup-${yyyy}-${mm}-${dd}.json`;
          fileLine.textContent = `File: ${filename}`;

          details.appendChild(dt);
          details.appendChild(fileLine);

          const actions = doc.createElement('div');
          actions.className = 'row';
          actions.classList.add('tp3d-settings-actions-row');

          const exportBtn = doc.createElement('button');
          exportBtn.type = 'button';
          exportBtn.className = 'btn btn-primary';
          exportBtn.textContent = 'Export';
          exportBtn.addEventListener('click', () => {
            try {
              const json = CoreStorage.exportAppJSON();
              const blob = new Blob([json], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = doc.createElement('a');
              a.href = url;
              a.download = filename;
              doc.body.appendChild(a);
              a.click();
              doc.body.removeChild(a);
              URL.revokeObjectURL(url);
              UIComponents.showToast('App JSON exported', 'success');
            } catch (err) {
              UIComponents.showToast('Export failed: ' + String((err && err.message) || 'Unknown error'), 'error');
            }
          });

          actions.appendChild(exportBtn);

          card.appendChild(h);
          card.appendChild(p);
          card.appendChild(details);
          card.appendChild(actions);
          wrap.appendChild(card);
        } else if (view === 'import-app') {
          const content = doc.createElement('div');
          content.className = 'tp3d-import-content';

          const drop = doc.createElement('div');
          drop.className = 'tp3d-import-drop';
          drop.innerHTML = `
            <div class="tp3d-import-drop-icon" aria-hidden="true"><i class="fa-solid fa-file-arrow-up"></i></div>
            <div class="tp3d-import-drop-title">Drag & Drop Backup File Here</div>
            <div class="muted tp3d-import-drop-sub">Supported: .json</div>
          `;

          const browseBtn = doc.createElement('button');
          browseBtn.type = 'button';
          browseBtn.className = 'btn';
          browseBtn.innerHTML = '<i class="fa-solid fa-folder-open" aria-hidden="true"></i> Browse backup files';

          const fileInput = doc.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = '.json,application/json';
          fileInput.style.display = 'none';

          const helper = doc.createElement('div');
          helper.className = 'tp3d-import-helper';
          helper.innerHTML = `
            <div><strong>Required:</strong> <code>packLibrary</code>, <code>caseLibrary</code>, <code>preferences</code></div>
            <div class="tp3d-import-warning"><strong>Warning:</strong> This will replace your current data.</div>
          `;

          const status = doc.createElement('div');
          status.className = 'muted';

          const actions = doc.createElement('div');
          actions.className = 'row';
          actions.classList.add('tp3d-settings-actions-row');

          const importBtn = doc.createElement('button');
          importBtn.type = 'button';
          importBtn.className = 'btn btn-primary';
          importBtn.textContent = 'Replace and Import';
          importBtn.disabled = true;

          const cancelBtn = doc.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'btn btn-ghost';
          cancelBtn.textContent = 'Back';
          cancelBtn.addEventListener('click', () => {
            resourcesSubView = 'root';
            render();
          });

          actions.appendChild(cancelBtn);
          actions.appendChild(importBtn);

          let pendingImport = null;

          const setError = msg => {
            status.textContent = String(msg || '');
            importBtn.disabled = true;
            pendingImport = null;
          };

          const setReady = ({ packsCount, casesCount, preferencesCount }) => {
            status.textContent = `Ready to import. Packs: ${packsCount}. Cases: ${casesCount}. Preferences: ${preferencesCount}.`;
            importBtn.disabled = false;
          };

          const readFileText = file =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => reject(new Error('Failed to read file'));
              reader.readAsText(file);
            });

          const handleFile = async file => {
            if (!file) return setError('No file selected.');
            const name = String(file.name || '').toLowerCase();
            if (!name.endsWith('.json')) return setError('Invalid file type. Please choose a .json file.');
            try {
              const text = await readFileText(file);
              const parsed = CoreStorage.importAppJSON(text);
              pendingImport = parsed;
              const packsCount = Array.isArray(parsed.packLibrary) ? parsed.packLibrary.length : 0;
              const casesCount = Array.isArray(parsed.caseLibrary) ? parsed.caseLibrary.length : 0;
              const preferencesCount = parsed.preferences && typeof parsed.preferences === 'object' ? 1 : 0;
              setReady({ packsCount, casesCount, preferencesCount });
            } catch (err) {
              setError('Invalid App JSON: ' + String((err && err.message) || 'Unknown error'));
            }
          };

          browseBtn.addEventListener('click', () => fileInput.click());
          fileInput.addEventListener('change', () => handleFile(fileInput.files && fileInput.files[0]));

          drop.addEventListener('dragover', ev => {
            ev.preventDefault();
            drop.classList.add('is-dragover');
          });
          drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
          drop.addEventListener('drop', ev => {
            ev.preventDefault();
            drop.classList.remove('is-dragover');
            const f = ev.dataTransfer && ev.dataTransfer.files ? ev.dataTransfer.files[0] : null;
            handleFile(f);
          });

          importBtn.addEventListener('click', () => {
            if (!pendingImport) return;
            try {
              const prev = StateStore.get();
              const next = { ...prev };
              next.caseLibrary = pendingImport.caseLibrary;
              next.packLibrary = pendingImport.packLibrary;
              next.preferences = pendingImport.preferences;
              StateStore.replace(next);
              UIComponents.showToast('App data imported', 'success');
              resourcesSubView = 'root';
              render();
            } catch (err) {
              UIComponents.showToast('Import failed: ' + String((err && err.message) || 'Unknown error'), 'error');
            }
          });

          content.appendChild(drop);
          content.appendChild(browseBtn);
          content.appendChild(fileInput);
          content.appendChild(helper);
          content.appendChild(status);
          wrap.appendChild(content);
          wrap.appendChild(actions);
        } else if (view === 'help') {
          const card = doc.createElement('div');
          card.className = 'card';

          const h = doc.createElement('div');
          h.classList.add('tp3d-settings-account-display');
          h.textContent = 'Help - Export / Import';

          const p = doc.createElement('div');
          p.className = 'muted';
          p.textContent = 'Export and import tools are available in Settings -> Resources.';

          const list = doc.createElement('div');
          list.className = 'grid';

          const lines = [
            'App Export: Use Export App to download a full JSON backup.',
            'App Import: Use Import App to restore from a backup JSON. This replaces current data.',
            'Pack Export: In Packs, open the pack menu (three dots) and choose Export Pack.',
            'Pack Import: In Packs, use Import Pack to add a shared pack JSON.',
            'Cases Template: On the Cases screen, click Template to download CSV headers.',
            'Cases Import: On the Cases screen, click Import Case to upload CSV or XLSX.',
          ];

          const ul = doc.createElement('ul');
          lines.forEach(text => {
            const li = doc.createElement('li');
            li.textContent = text;
            ul.appendChild(li);
          });

          list.appendChild(ul);
          card.appendChild(h);
          card.appendChild(p);
          card.appendChild(list);
          wrap.appendChild(card);
        }

        body.appendChild(wrap);
      };

      if (
        resourcesSubView === 'updates' ||
        resourcesSubView === 'roadmap' ||
        resourcesSubView === 'export-app' ||
        resourcesSubView === 'import-app' ||
        resourcesSubView === 'help'
      ) {
        renderResourcesSubView(resourcesSubView);
      } else {
        renderResourcesRoot();
      }
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

    if (tab) {
      settingsActiveTab = String(tab);
    }
    resourcesSubView = 'root';
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
