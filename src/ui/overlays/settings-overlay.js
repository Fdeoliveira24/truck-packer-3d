/**
 * @file settings-overlay.js
 * @description Settings overlay UI for viewing and updating user preferences.
 * @module ui/overlays/settings-overlay
 * @created Unknown
 * @updated 01/28/2026
 * @author Truck Packer 3D Team
 * 
 * CHANGES (01/28/2026 - Account Settings Complete):
 * - Added profile state management (profileData, isEditingProfile, isLoadingProfile, isSavingProfile)
 * - Implemented loadProfile() to fetch user profile from Supabase on Account tab open
 * - Implemented saveProfile() with optimistic UI and error handling
 * - Implemented handleAvatarUpload() for avatar image uploads with validation
 * - Implemented handleAvatarRemove() to delete avatars and update profile
 * - Completely rewrote Account tab rendering with three sections:
 *   1. Avatar upload/remove section with preview (shows avatar or initials)
 *   2. Profile info section with edit mode (display_name, first_name, last_name, bio)
 *   3. Danger zone with delete account flow
 * - Profile editing uses form with proper validation and Cancel/Save buttons
 * - Delete account now wrapped in <form> to fix password field console warning
 * - All inline styles removed; uses CSS classes from main.css
 * - Avatar preview shows uploaded image or falls back to initials
 * - Profile data persists across page reloads via Supabase
 * - Edit/view mode toggle maintains state properly
 * - No duplicate event listeners on re-render
 * - Resources tab sub-views unchanged (Updates, Roadmap, Export, Import, Help work as before)
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { getUserAvatarView } from '../../core/utils/index.js';
import * as ImportExport from '../../services/import-export.js';
import * as StateStore from '../../core/state-store.js';
import * as CoreStorage from '../../core/storage.js';

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
  onUpdates,
  onRoadmap,
}) {
  const doc = documentRef;

  let settingsOverlay = null;
  let settingsModal = null;
  let settingsLeftPane = null;
  let settingsRightPane = null;
  let settingsActiveTab = 'preferences';
  let resourcesSubView = 'root'; // 'root' | 'updates' | 'roadmap' | 'export' | 'import' | 'help'
  let unmountAccountButton = null;
  let lastFocusedEl = null;
  let trapKeydownHandler = null;
  let warnedMissingModalRoot = false;
  
  // Profile editing state
  let profileData = null;
  let isEditingProfile = false;
  let isLoadingProfile = false;
  let isSavingProfile = false;

  // Static content for Updates and Roadmap (embedded to avoid external dependencies)
  const updatesData = [
    {
      version: '1.0.0',
      date: '2026-01-15',
      features: [
        'Multi-screen workspace (Packs, Cases, Editor, Updates, Roadmap, Settings)',
        'Three.js 3D editor with drag placement',
        'CSV/XLSX import, PNG + PDF export',
      ],
      bugFixes: [],
      breakingChanges: [],
    },
    {
      version: '1.1.0',
      date: '2026-03-01',
      features: ['(Example) Weight balance view', '(Example) Case rotation'],
      bugFixes: ['(Example) Improved collision edge cases'],
      breakingChanges: [],
    },
  ];

  const roadmapData = [
    {
      quarter: 'Q1 2026',
      items: [
        {
          title: 'Weight balance',
          status: 'Completed',
          badge: 'âœ“',
          color: 'var(--success)',
          details: 'Add center-of-gravity and axle load estimates.',
        },
        {
          title: 'Rotation (MVP)',
          status: 'In Progress',
          badge: 'â±',
          color: 'var(--warning)',
          details: 'Allow 90Â° rotations and pack-time heuristics.',
        },
      ],
    },
    {
      quarter: 'Q2 2026',
      items: [
        {
          title: 'Multi-user',
          status: 'Planned',
          badge: 'ðŸ“‹',
          color: 'var(--info)',
          details: 'Presence + change tracking (no real-time yet).',
        },
        {
          title: '3D export',
          status: 'Planned',
          badge: 'ðŸ“‹',
          color: 'var(--info)',
          details: 'GLB/GLTF export for downstream tools.',
        },
      ],
    },
    {
      quarter: 'Future',
      items: [
        {
          title: 'AR view',
          status: 'Idea',
          badge: 'ðŸ’¡',
          color: 'var(--text-muted)',
          details: 'Preview a load-out in real space on mobile.',
        },
      ],
    },
  ];

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

  async function loadProfile() {
    if (isLoadingProfile) return;
    isLoadingProfile = true;
    try {
      const profile = await SupabaseClient.getProfile();
      profileData = profile;
      isLoadingProfile = false;
      return profile;
    } catch (err) {
      isLoadingProfile = false;
      console.error('Failed to load profile:', err);
      return null;
    }
  }

  async function saveProfile(updates) {
    if (isSavingProfile) return;
    isSavingProfile = true;
    try {
      const updated = await SupabaseClient.updateProfile(updates);
      profileData = updated;
      isSavingProfile = false;
      isEditingProfile = false;
      UIComponents.showToast('Profile saved', 'success');
      render();
      return updated;
    } catch (err) {
      isSavingProfile = false;
      UIComponents.showToast(
        `Failed to save: ${err && err.message ? err.message : err}`,
        'error'
      );
      throw err;
    }
  }

  async function handleAvatarUpload(file) {
    try {
      const publicUrl = await SupabaseClient.uploadAvatar(file);
      // Add cache-busting timestamp to force browser to reload image
      const cacheBustedUrl = publicUrl + '?t=' + Date.now();
      await SupabaseClient.updateProfile({ avatar_url: publicUrl });
      UIComponents.showToast('Avatar uploaded', 'success');
      await loadProfile();
      render();
      // Notify app to refresh sidebar avatar
      try {
        const event = new CustomEvent('tp3d:profile-updated', { detail: { avatar_url: cacheBustedUrl } });
        window.dispatchEvent(event);
      } catch {
        // ignore
      }
    } catch (err) {
      UIComponents.showToast(
        `Upload failed: ${err && err.message ? err.message : err}`,
        'error'
      );
    }
  }

  async function handleAvatarRemove() {
    try {
      await SupabaseClient.deleteAvatar();
      await SupabaseClient.updateProfile({ avatar_url: null });
      UIComponents.showToast('Avatar removed', 'success');
      await loadProfile();
      render();
      // Notify app to refresh sidebar avatar
      try {
        const event = new CustomEvent('tp3d:profile-updated', { detail: { avatar_url: null } });
        window.dispatchEvent(event);
      } catch {
        // ignore
      }
    } catch (err) {
      UIComponents.showToast(
        `Remove failed: ${err && err.message ? err.message : err}`,
        'error'
      );
    }
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
    resourcesSubView = 'root'; // Reset sub-view on close

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
    // Reset sub-view when switching tabs
    if (tab !== 'resources') {
      resourcesSubView = 'root';
    }
    render();
  }

  function setResourcesSubView(subView) {
    resourcesSubView = subView;
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

  // Render Updates content inside the modal
  function renderUpdatesContent(container) {
    const wrap = doc.createElement('div');
    wrap.className = 'grid';
    wrap.style.gap = 'var(--space-4)';

    updatesData.forEach(u => {
      const card = doc.createElement('div');
      card.className = 'card';

      const header = doc.createElement('div');
      header.className = 'row space-between';
      header.style.alignItems = 'flex-start';

      const left = doc.createElement('div');
      left.innerHTML = `<div style="font-weight:var(--font-semibold);font-size:var(--text-lg)">Version ${u.version}</div><div class="muted" style="font-size:var(--text-xs)">${new Date(u.date).toLocaleDateString()}</div>`;
      header.appendChild(left);
      card.appendChild(header);

      const sections = [
        { title: 'New Features', items: u.features || [] },
        { title: 'Bug Fixes', items: u.bugFixes || [] },
        { title: 'Breaking Changes', items: u.breakingChanges || [] },
      ].filter(s => s.items.length);

      sections.forEach(s => {
        const t = doc.createElement('div');
        t.style.marginTop = '12px';
        t.style.fontWeight = 'var(--font-semibold)';
        t.textContent = s.title;
        card.appendChild(t);

        const ul = doc.createElement('ul');
        ul.style.margin = '8px 0 0 16px';
        ul.style.color = 'var(--text-secondary)';
        ul.style.fontSize = 'var(--text-sm)';
        s.items.forEach(it => {
          const li = doc.createElement('li');
          li.textContent = it;
          ul.appendChild(li);
        });
        card.appendChild(ul);
      });

      wrap.appendChild(card);
    });

    container.appendChild(wrap);
  }

  // Render Roadmap content inside the modal
  function renderRoadmapContent(container) {
    const wrap = doc.createElement('div');
    wrap.className = 'grid';
    wrap.style.gap = 'var(--space-5)';

    roadmapData.forEach(group => {
      const groupWrap = doc.createElement('div');
      groupWrap.className = 'grid';
      groupWrap.style.gap = '10px';

      const h = doc.createElement('div');
      h.style.fontSize = 'var(--text-lg)';
      h.style.fontWeight = 'var(--font-semibold)';
      h.textContent = group.quarter;
      groupWrap.appendChild(h);

      const grid = doc.createElement('div');
      grid.className = 'grid';
      grid.style.gap = 'var(--space-3)';

      group.items.forEach(item => {
        const card = doc.createElement('div');
        card.className = 'card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
          <div class="row space-between" style="gap:10px">
            <div style="font-weight:var(--font-semibold)">${item.title}</div>
            <div class="badge" style="border-color:transparent;background:${item.color};color:white">${item.badge} ${item.status}</div>
          </div>
          <div class="muted" style="font-size:var(--text-sm);margin-top:8px">${item.details}</div>
        `;
        card.addEventListener('click', () => {
          UIComponents.showModal({
            title: item.title,
            content: `<div class="muted" style="font-size:var(--text-sm)">${item.details}</div>`,
            actions: [{ label: 'Close', variant: 'primary' }],
          });
        });
        grid.appendChild(card);
      });

      groupWrap.appendChild(grid);
      wrap.appendChild(groupWrap);
    });

    container.appendChild(wrap);
  }

  function renderExportContent(container) {
    const wrap = doc.createElement('div');
    wrap.className = 'tp3d-resources-view';

    const blurb = doc.createElement('div');
    blurb.className = 'muted tp3d-resources-text';
    blurb.textContent =
      'App Export downloads a full JSON backup of packs, cases, and settings. This file can be imported back to restore everything.';

    const filename = `truck-packer-app-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const meta = doc.createElement('div');
    meta.className = 'card tp3d-resources-card';

    const metaTitle = doc.createElement('div');
    metaTitle.className = 'tp3d-resources-card-title';
    metaTitle.textContent = 'Export details';

    const metaValue = doc.createElement('div');
    metaValue.className = 'muted tp3d-resources-card-sub';
    metaValue.textContent = `File: ${filename}`;

    meta.appendChild(metaTitle);
    meta.appendChild(metaValue);

    const actions = doc.createElement('div');
    actions.className = 'tp3d-resources-actions';
    const exportBtn = doc.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'btn btn-primary';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', () => {
      try {
        const json = ImportExport.buildAppExportJSON();
        Utils.downloadText(filename, json);
        UIComponents.showToast('App JSON exported', 'success');
      } catch (err) {
        UIComponents.showToast('Export failed: ' + (err && err.message), 'error');
      }
    });
    actions.appendChild(exportBtn);

    wrap.appendChild(blurb);
    wrap.appendChild(meta);
    wrap.appendChild(actions);
    container.appendChild(wrap);
  }

  function applyCaseDefaultColor(caseObj) {
    const next = { ...(caseObj || {}) };
    const existing = String(next.color || '').trim();
    if (existing) return next;
    const key = String(next.category || 'default')
      .trim()
      .toLowerCase() || 'default';
    const cats = (_Defaults && _Defaults.categories) || [];
    const found = cats.find(c => c.key === key) || cats.find(c => c.key === 'default');
    next.color = (found && found.color) || '#9ca3af';
    return next;
  }

  async function handleImportAppFile(file, resultsEl) {
    resultsEl.classList.add('is-visible');
    resultsEl.innerHTML = '';

    if (!file) {
      UIComponents.showToast('No file selected', 'warning');
      return;
    }

    const name = String(file.name || '');
    const lower = name.toLowerCase();
    const isJson = lower.endsWith('.json') || String(file.type || '').includes('json');
    if (!isJson) {
      UIComponents.showToast('Invalid file type. Supported: .json', 'warning');
      return;
    }

    let text = '';
    try {
      text = await file.text();
    } catch (err) {
      UIComponents.showToast('Import failed: ' + (err && err.message), 'error');
      return;
    }

    let imported = null;
    try {
      imported = ImportExport.parseAppImportJSON(text);
    } catch (err) {
      UIComponents.showToast('Invalid App JSON: ' + (err && err.message), 'error');
      UIComponents.showToast('If you are importing only packs, use Import Pack.', 'info');
      return;
    }

    if (!imported || !Array.isArray(imported.packLibrary) || !Array.isArray(imported.caseLibrary) || !imported.preferences) {
      UIComponents.showToast('Invalid App JSON: missing required keys', 'error');
      return;
    }

    const ok = await UIComponents.confirm({
      title: 'Import App JSON?',
      message: 'This will replace your current data with the imported backup. This cannot be undone.',
      danger: true,
      okLabel: 'Replace & Import',
    });
    if (!ok) return;

    try {
      const prev = StateStore.get();
      const importedCases = (imported.caseLibrary || []).map(applyCaseDefaultColor);
      const nextState = {
        ...prev,
        caseLibrary: importedCases,
        packLibrary: imported.packLibrary,
        preferences: imported.preferences,
        currentPackId: null,
        currentScreen: 'packs',
        selectedInstanceIds: [],
      };
      StateStore.replace(nextState, { skipHistory: false });
      CoreStorage.saveNow();
      if (PreferencesManager && typeof PreferencesManager.applyTheme === 'function') {
        PreferencesManager.applyTheme(nextState.preferences.theme);
      }

      const summary = doc.createElement('div');
      summary.className = 'card';
      summary.innerHTML = `
        <div class="tp3d-import-summary-title">Import Result</div>
        <div class="muted tp3d-import-summary-meta">File: ${
          Utils && Utils.escapeHtml ? Utils.escapeHtml(file.name) : file.name
        }</div>
        <div class="tp3d-import-summary-spacer"></div>
        <div class="tp3d-import-badges">
          <div class="badge tp3d-import-badge-success">Packs: ${(imported.packLibrary || []).length}</div>
          <div class="badge tp3d-import-badge-info">Cases: ${(imported.caseLibrary || []).length}</div>
        </div>
      `;
      resultsEl.appendChild(summary);

      UIComponents.showToast('App data imported', 'success');
    } catch (err) {
      UIComponents.showToast('Import failed: ' + (err && err.message), 'error');
    }
  }

  function renderImportContent(container) {
    const content = doc.createElement('div');
    content.className = 'tp3d-import-content';

    const drop = doc.createElement('div');
    drop.className = 'card tp3d-import-drop';
    drop.innerHTML = `
      <div class="tp3d-import-drop-title">Drag & Drop Backup File Here</div>
      <div class="muted tp3d-import-drop-sub">Supported: .json</div>
      <div class="tp3d-import-drop-spacer"></div>
    `;
    const browseBtn = doc.createElement('button');
    browseBtn.className = 'btn';
    browseBtn.type = 'button';
    browseBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Browse Backup files';
    drop.appendChild(browseBtn);

    const hint = doc.createElement('div');
    hint.className = 'muted tp3d-import-hint';
    hint.innerHTML = `
      <div class="tp3d-import-warning">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <div>
          <span class="tp3d-import-warning-label">Warning:</span>
          <span class="tp3d-import-warning-text"> This will replace your current data.</span>
        </div>
      </div>
    `;

    const results = doc.createElement('div');
    results.classList.add('tp3d-import-results');

    content.appendChild(drop);
    content.appendChild(hint);
    content.appendChild(results);
    container.appendChild(content);

    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';

    browseBtn.addEventListener('click', () => fileInput.click());

    drop.addEventListener('dragover', ev => {
      ev.preventDefault();
      drop.classList.add('is-dragover');
    });
    drop.addEventListener('dragleave', () => {
      drop.classList.remove('is-dragover');
    });
    drop.addEventListener('drop', ev => {
      ev.preventDefault();
      drop.classList.remove('is-dragover');
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) handleImportAppFile(file, results);
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) handleImportAppFile(file, results);
    });
  }

  function renderHelpContent(container) {
    const wrap = doc.createElement('div');
    wrap.className = 'tp3d-resources-view';

    const block = doc.createElement('div');
    block.className = 'card tp3d-resources-card';

    const text = doc.createElement('div');
    text.className = 'tp3d-resources-help';

    const p1 = doc.createElement('div');
    p1.className = 'tp3d-resources-help-line';
    p1.innerHTML = '<strong>App Export/Import:</strong> Use Export to download a full JSON backup. Use Import to restore from that backup.';
    const p2 = doc.createElement('div');
    p2.className = 'tp3d-resources-help-line';
    p2.innerHTML =
      '<strong>Pack Export/Import:</strong> In Packs, open the pack menu and choose Export Pack to download a single pack JSON. Use Import Pack on the Packs screen to add a shared pack JSON.';
    const p3 = doc.createElement('div');
    p3.className = 'tp3d-resources-help-line';
    p3.innerHTML =
      '<strong>Cases Template:</strong> On the Cases screen, click Template to download the CSV headers for cases.';
    const p4 = doc.createElement('div');
    p4.className = 'tp3d-resources-help-line';
    p4.innerHTML =
      '<strong>Cases Import:</strong> Click Import on the Cases screen to upload CSV or XLSX. Valid rows are added; duplicates and invalid rows are skipped.';
    const p5 = doc.createElement('div');
    p5.className = 'tp3d-resources-help-line muted';
    p5.textContent = 'Tip: Export the app before importing to keep a backup.';

    text.appendChild(p1);
    text.appendChild(p2);
    text.appendChild(p3);
    text.appendChild(p4);
    text.appendChild(p5);
    block.appendChild(text);
    wrap.appendChild(block);
    container.appendChild(wrap);
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
          <span class="muted tp3d-settings-account-sub" data-account-name>${userView.displayName || 'â€”'}</span>
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
        case 'preferences':
          return {
            title: 'Preferences',
            helper: 'Set your units, labels, and theme.',
          };
        case 'resources':
          // Handle sub-views within Resources
          if (resourcesSubView === 'updates') {
            return {
              title: 'Updates',
              helper: 'Release notes and recent changes.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'roadmap') {
            return {
              title: 'Roadmap',
              helper: 'Product direction and upcoming features.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'export') {
            return {
              title: 'Export App JSON',
              helper: 'Download a full JSON backup of packs, cases, and settings.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'import') {
            return {
              title: 'Import App JSON',
              helper: 'Restore your data from a JSON backup.',
              showBack: true,
            };
          }
          if (resourcesSubView === 'help') {
            return {
              title: 'Help - Export / Import',
              helper: 'Guidance for exports and imports.',
              showBack: true,
            };
          }
          return {
            title: 'Resources',
            helper: 'See updates, roadmap, exports, imports, and help in one place.',
          };
        case 'account':
          return {
            title: 'Account',
            helper: 'Manage your profile and workspace identity.',
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

    const headerLeft = doc.createElement('div');
    headerLeft.className = 'row';
    headerLeft.style.gap = 'var(--space-3)';
    headerLeft.style.alignItems = 'center';

    // Back button for sub-views
    if (meta.showBack) {
      const backBtn = doc.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'btn btn-ghost';
      backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
      backBtn.title = 'Back to Resources';
      backBtn.addEventListener('click', () => setResourcesSubView('root'));
      headerLeft.appendChild(backBtn);
    }

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
    headerLeft.appendChild(headerText);

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', () => close());

    header.appendChild(headerLeft);
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

    if (settingsActiveTab === 'preferences') {
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
      // Handle sub-views within Resources
      if (resourcesSubView === 'updates') {
        // Render embedded Updates content
        renderUpdatesContent(body);
      } else if (resourcesSubView === 'roadmap') {
        // Render embedded Roadmap content
        renderRoadmapContent(body);
      } else if (resourcesSubView === 'export') {
        renderExportContent(body);
      } else if (resourcesSubView === 'import') {
        renderImportContent(body);
      } else if (resourcesSubView === 'help') {
        renderHelpContent(body);
      } else {
        // Root view: show buttons
        const container = doc.createElement('div');
        container.className = 'grid';

        const runResourceAction = (cb, { closeFirst = true } = {}) => {
          if (typeof cb !== 'function') return;
          if (closeFirst) close();
          cb();
        };

        const makeBtn = (label, variant, onClick) => {
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = 'btn';
          if (variant) btn.classList.add(variant);
          btn.textContent = label;
          btn.addEventListener('click', onClick);
          return btn;
        };

        const exportBtn = makeBtn('Export App', null, () => setResourcesSubView('export'));
        const importBtn = makeBtn('Import App', null, () => setResourcesSubView('import'));
        const helpBtn = makeBtn('Help', null, () => setResourcesSubView('help'));

        // Updates and Roadmap buttons switch sub-views
        const updatesBtn = makeBtn('Updates', null, () => setResourcesSubView('updates'));
        const roadmapBtn = makeBtn('Roadmap', null, () => setResourcesSubView('roadmap'));

        container.appendChild(updatesBtn);
        container.appendChild(roadmapBtn);
        container.appendChild(exportBtn);
        container.appendChild(importBtn);
        container.appendChild(helpBtn);
        body.appendChild(container);
      }
    } else if (settingsActiveTab === 'account') {
      const userView = getCurrentUserView(profileData);

      // Load profile if not already loaded
      if (!profileData && !isLoadingProfile && userView.isAuthed) {
        loadProfile().then(() => render()).catch(() => {});
      }

      // Avatar section
      const avatarSection = doc.createElement('div');
      avatarSection.className = 'card tp3d-settings-card-max';
      const avatarContainer = doc.createElement('div');
      avatarContainer.className = 'tp3d-account-avatar-upload-container';

      const avatarPreview = doc.createElement('div');
      avatarPreview.className = 'brand-mark tp3d-account-avatar-preview';
      
      if (profileData && profileData.avatar_url) {
        avatarPreview.classList.add('has-image');
        const img = doc.createElement('img');
        // Add cache-busting to force reload after upload
        const avatarUrl = profileData.avatar_url + (profileData.avatar_url.includes('?') ? '&' : '?') + 't=' + Date.now();
        img.src = avatarUrl;
        img.alt = 'Avatar';
        img.className = 'tp3d-account-avatar-img';
        avatarPreview.appendChild(img);
      } else {
        avatarPreview.textContent = userView.initials || '';
      }

      const avatarButtons = doc.createElement('div');
      avatarButtons.className = 'tp3d-account-avatar-buttons';

      const uploadBtn = doc.createElement('button');
      uploadBtn.type = 'button';
      uploadBtn.className = 'btn btn-secondary';
      uploadBtn.textContent = profileData && profileData.avatar_url ? 'Change Avatar' : 'Upload Avatar';
      uploadBtn.disabled = !userView.isAuthed;
      
      const fileInput = doc.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/jpeg,image/jpg,image/webp';
      fileInput.setAttribute('aria-hidden', 'true');
      fileInput.classList.add('visually-hidden');
      
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          await handleAvatarUpload(file);
          fileInput.value = '';
        }
      });

      avatarButtons.appendChild(uploadBtn);

      if (profileData && profileData.avatar_url) {
        const removeBtn = doc.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-ghost';
        removeBtn.textContent = 'Remove';
        removeBtn.disabled = !userView.isAuthed;
        removeBtn.addEventListener('click', () => handleAvatarRemove());
        avatarButtons.appendChild(removeBtn);
      }

      avatarContainer.appendChild(avatarPreview);
      avatarContainer.appendChild(avatarButtons);
      avatarContainer.appendChild(fileInput);
      avatarSection.appendChild(avatarContainer);
      body.appendChild(avatarSection);

      // Profile info section
      const profileSection = doc.createElement('div');
      profileSection.className = 'card tp3d-settings-card-max';

      if (isEditingProfile && profileData) {
        // Edit mode
        const form = doc.createElement('form');
        form.className = 'tp3d-account-profile-form';
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const formData = new FormData(form);
          const updates = {
            display_name: formData.get('display_name') || null,
            first_name: formData.get('first_name') || null,
            last_name: formData.get('last_name') || null,
            bio: formData.get('bio') || null,
          };
          saveProfile(updates);
        });

        // Display Name field
        const displayNameField = doc.createElement('div');
        displayNameField.className = 'tp3d-account-field';
        const displayNameLabel = doc.createElement('label');
        displayNameLabel.className = 'tp3d-account-field-label';
        displayNameLabel.textContent = 'Display Name';
        const displayNameInput = doc.createElement('input');
        displayNameInput.type = 'text';
        displayNameInput.name = 'display_name';
        displayNameInput.className = 'input';
        displayNameInput.value = profileData.display_name || '';
        displayNameInput.placeholder = 'Your display name';
        displayNameField.appendChild(displayNameLabel);
        displayNameField.appendChild(displayNameInput);
        form.appendChild(displayNameField);

        // First Name field
        const firstNameField = doc.createElement('div');
        firstNameField.className = 'tp3d-account-field';
        const firstNameLabel = doc.createElement('label');
        firstNameLabel.className = 'tp3d-account-field-label';
        firstNameLabel.textContent = 'First Name';
        const firstNameInput = doc.createElement('input');
        firstNameInput.type = 'text';
        firstNameInput.name = 'first_name';
        firstNameInput.className = 'input';
        firstNameInput.value = profileData.first_name || '';
        firstNameInput.placeholder = 'Your first name';
        firstNameField.appendChild(firstNameLabel);
        firstNameField.appendChild(firstNameInput);
        form.appendChild(firstNameField);

        // Last Name field
        const lastNameField = doc.createElement('div');
        lastNameField.className = 'tp3d-account-field';
        const lastNameLabel = doc.createElement('label');
        lastNameLabel.className = 'tp3d-account-field-label';
        lastNameLabel.textContent = 'Last Name';
        const lastNameInput = doc.createElement('input');
        lastNameInput.type = 'text';
        lastNameInput.name = 'last_name';
        lastNameInput.className = 'input';
        lastNameInput.value = profileData.last_name || '';
        lastNameInput.placeholder = 'Your last name';
        lastNameField.appendChild(lastNameLabel);
        lastNameField.appendChild(lastNameInput);
        form.appendChild(lastNameField);

        // Bio field
        const bioField = doc.createElement('div');
        bioField.className = 'tp3d-account-field';
        const bioLabel = doc.createElement('label');
        bioLabel.className = 'tp3d-account-field-label';
        bioLabel.textContent = 'Bio';
        const bioTextarea = doc.createElement('textarea');
        bioTextarea.name = 'bio';
        bioTextarea.value = profileData.bio || '';
        bioTextarea.placeholder = 'Tell us about yourself';
        bioTextarea.rows = 4;
        bioField.appendChild(bioLabel);
        bioField.appendChild(bioTextarea);
        form.appendChild(bioField);

        // Actions
        const actions = doc.createElement('div');
        actions.className = 'tp3d-account-actions';
        
        const cancelBtn = doc.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-ghost';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.disabled = isSavingProfile;
        cancelBtn.addEventListener('click', () => {
          isEditingProfile = false;
          render();
        });
        
        const saveBtn = doc.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.className = 'btn btn-primary';
        saveBtn.textContent = isSavingProfile ? 'Saving...' : 'Save Changes';
        saveBtn.disabled = isSavingProfile;

        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        profileSection.appendChild(form);
      } else {
        // View mode
        const viewContainer = doc.createElement('div');
        viewContainer.className = 'grid';

        // Display name
        const displayNameEl = doc.createElement('div');
        displayNameEl.textContent = (profileData && profileData.display_name) || userView.displayName || '\u2014';
        viewContainer.appendChild(row('Display Name', displayNameEl));

        // First name
        if (profileData) {
          const firstNameEl = doc.createElement('div');
          firstNameEl.textContent = profileData.first_name || '\u2014';
          viewContainer.appendChild(row('First Name', firstNameEl));

          // Last name
          const lastNameEl = doc.createElement('div');
          lastNameEl.textContent = profileData.last_name || '\u2014';
          viewContainer.appendChild(row('Last Name', lastNameEl));

          // Bio
          if (profileData.bio) {
            const bioEl = doc.createElement('div');
            bioEl.textContent = profileData.bio;
            viewContainer.appendChild(row('Bio', bioEl));
          }
        }

        // Email
        const emailEl = doc.createElement('div');
        emailEl.textContent = userView.isAuthed && userView.email ? userView.email : 'Not signed in';
        viewContainer.appendChild(row('Email', emailEl));

        // Edit button
        if (userView.isAuthed && profileData) {
          const editActions = doc.createElement('div');
          editActions.className = 'tp3d-account-actions';
          const editBtn = doc.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'btn btn-primary';
          editBtn.textContent = 'Edit Profile';
          editBtn.addEventListener('click', () => {
            isEditingProfile = true;
            render();
          });
          editActions.appendChild(editBtn);
          viewContainer.appendChild(editActions);
        }

        profileSection.appendChild(viewContainer);
      }

      body.appendChild(profileSection);

      // Danger zone
      const danger = doc.createElement('div');
      danger.className = 'card tp3d-settings-card-max tp3d-settings-danger';
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
      
      const deleteBtn = doc.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger';
      deleteBtn.textContent = 'Delete Account';
      deleteBtn.disabled = !userView.isAuthed;
      deleteBtn.addEventListener('click', () => {
        // Create confirmation modal content
        const modalContent = doc.createElement('div');
        modalContent.className = 'grid';
        modalContent.style.gap = 'var(--space-4)';
        
        const warningText = doc.createElement('div');
        warningText.className = 'muted';
        warningText.textContent = 'Deleting your account will remove all of your information from our database. This cannot be undone.';
        modalContent.appendChild(warningText);
        
        const confirmLabel = doc.createElement('div');
        confirmLabel.className = 'muted';
        confirmLabel.style.fontSize = 'var(--text-sm)';
        confirmLabel.textContent = 'To confirm this, type "DELETE"';
        modalContent.appendChild(confirmLabel);
        
        const confirmInput = doc.createElement('input');
        confirmInput.type = 'text';
        confirmInput.className = 'input';
        confirmInput.placeholder = 'Type DELETE';
        confirmInput.autocomplete = 'off';
        modalContent.appendChild(confirmInput);
        
        // Show modal
        const modal = UIComponents.showModal({
          title: 'Delete Account',
          content: modalContent,
          actions: [
            { 
              label: 'Cancel', 
              variant: 'ghost',
              onClick: () => modal.close()
            },
            { 
              label: 'Delete Account', 
              variant: 'danger',
              disabled: true,
              onClick: async () => {
                try {
                  const session = SupabaseClient && typeof SupabaseClient.getSession === 'function' ? SupabaseClient.getSession() : null;
                  if (!session || !session.access_token) throw new Error('No active session');
                  const cfg = window.__TP3D_SUPABASE && typeof window.__TP3D_SUPABASE === 'object' ? window.__TP3D_SUPABASE : {};
                  const baseUrl = cfg && cfg.url ? String(cfg.url) : '';
                  if (!baseUrl) throw new Error('Supabase URL missing');
                  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/functions/v1/delete-account`, {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${session.access_token}`,
                      apikey: cfg.anonKey || '',
                      'Content-Type': 'application/json',
                    },
                  });
                  if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(errText || 'Delete failed');
                  }
                  try {
                    CoreStorage.clearAll();
                  } catch {
                    // ignore
                  }
                  try {
                    const client = SupabaseClient && typeof SupabaseClient.getClient === 'function' ? SupabaseClient.getClient() : null;
                    if (client && client.auth) {
                      await client.auth.signOut({ scope: 'local' });
                    }
                  } catch {
                    // ignore
                  }
                  modal.close();
                  close();
                  window.location.reload();
                } catch (err) {
                  modal.close();
                  UIComponents.showToast(
                    `Delete failed: ${err && err.message ? err.message : err}`,
                    'error',
                    { title: 'Account' }
                  );
                }
              }
            }
          ]
        });
        
        // Enable delete button only when "DELETE" is typed
        const deleteAction = modal.element && modal.element.querySelector('.btn-danger');
        if (deleteAction && confirmInput) {
          confirmInput.addEventListener('input', () => {
            const isValid = confirmInput.value === 'DELETE';
            deleteAction.disabled = !isValid;
          });
        }
      });
      
      dRight.appendChild(deleteBtn);
      dangerRow.appendChild(dLeft);
      dangerRow.appendChild(dRight);
      danger.appendChild(dangerRow);
      body.appendChild(danger);
    } else if (settingsActiveTab === 'org-general') {
      const userView = getCurrentUserView();
      const orgName = 'Workspace';
      const orgRole = userView.isAuthed ? 'Owner' : 'â€”';

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