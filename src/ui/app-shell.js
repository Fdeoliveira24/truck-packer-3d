/**
 * @file app-shell.js
 * @description App shell: sidebar, top bar, screen show/hide, and screen-transition side effects.
 * @module ui/app-shell
 * @created 07/23/2026
 * @author Truck Packer 3D Team
 */

// App shell (extracted from src/app.js; behavior preserved).
// Side-effect-free factory: collaborators are injected; DOM references are
// captured when the factory runs, at the same point the inline IIFE ran.

export function createAppShell({
  StateStore,
  PackLibrary,
  Utils,
  beforeNavigate = null,
}) {
  const AppShell = (() => {
    const appRoot = document.getElementById('app');
    const sidebar = document.getElementById('sidebar');
    const btnSidebar = document.getElementById('btn-sidebar');
    const topbarTitle = document.getElementById('topbar-title');
    const topbarSubtitle = document.getElementById('topbar-subtitle');
    const contentRoot = document.querySelector('.content');
    const navButtons = Array.from(document.querySelectorAll('[data-nav]'));
    const toastContainer = document.getElementById('toast-container');

    function syncSidebarState() {
      const mobile = window.matchMedia('(max-width: 899px)').matches;
      const open = mobile ? sidebar.classList.contains('open') : !appRoot.classList.contains('sidebar-collapsed');
      btnSidebar.setAttribute('aria-expanded', String(open));
    }

    const screenTitles = {
      packs: { title: 'Load Plans', subtitle: 'Load plan library' },
      cases: { title: 'Cases', subtitle: 'Inventory management' },
      editor: { title: 'Editor', subtitle: '3D workspace' },
      updates: { title: 'Release Notes', subtitle: 'Verified product changes' },
      roadmap: { title: 'Roadmap', subtitle: 'Published product plans' },
      settings: { title: 'Settings', subtitle: 'Preferences' },
    };

    function toggleSidebar() {
      const isMobile = window.matchMedia('(max-width: 899px)').matches;
      if (isMobile) {
        sidebar.classList.toggle('open');
      } else {
        appRoot.classList.toggle('sidebar-collapsed');
      }
      syncSidebarState();
      if (isMobile && sidebar.classList.contains('open')) {
        const firstNav = sidebar.querySelector('[data-nav]');
        if (firstNav instanceof HTMLElement) firstNav.focus();
      } else if (sidebar.contains(document.activeElement)) {
        btnSidebar.focus();
      }
    }

    function initShell() {
      btnSidebar.addEventListener('click', toggleSidebar);
      // The sidebar closes only on an Escape nothing earlier consumed.
      window.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.defaultPrevented || !sidebar.classList.contains('open') ||
            document.body.classList.contains('tp3d-shared-modal-lock')) return;
        sidebar.classList.remove('open');
        syncSidebarState();
        btnSidebar.focus();
        event.preventDefault();
      });
      navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-nav');
          navigate(target);
          if (window.matchMedia('(max-width: 899px)').matches) {
            sidebar.classList.remove('open');
          }
          syncSidebarState();
        });
      });

      window.addEventListener('resize', () => {
        if (!window.matchMedia('(max-width: 899px)').matches) {
          sidebar.classList.remove('open');
        }
        syncSidebarState();
        placeToastContainer(StateStore.get('currentScreen'));
      });
      window.addEventListener('tp3d-modal-ownership-change', () =>
        placeToastContainer(StateStore.get('currentScreen')));
      syncSidebarState();
    }

    function navigate(screenKey) {
      const previousScreen = StateStore.get('currentScreen');
      // Optional synchronous observer: a failed preview must never veto navigation.
      try {
        if (beforeNavigate && previousScreen !== screenKey) beforeNavigate(previousScreen, screenKey);
      } catch (err) {
        console.warn('[AppShell] Before-navigation hook failed', err);
      }
      StateStore.set({ currentScreen: screenKey }, { skipHistory: true });
      if (previousScreen !== 'editor' && screenKey === 'editor') StateStore.resetHistory();
    }

    // Toasts default to a fixed bottom-right dock. In the Editor, that spot
    // sits on top of Inspector content, so on desktop (not the fixed mobile
    // overlay layout) dock toasts inside the canvas instead, safely below the
    // floating toolbar. Reparenting (not just CSS) keeps this to the Editor
    // only, since #toast-container is shared by every screen.
    function placeToastContainer(screen) {
      if (!toastContainer) return;
      const canvasWrap = document.querySelector('.canvas-wrap');
      const isMobile = window.matchMedia('(max-width: 899px)').matches;
      const modalActive = document.body.classList.contains('tp3d-shared-modal-lock');
      const targetParent = screen === 'editor' && canvasWrap && !isMobile && !modalActive
        ? canvasWrap : document.body;
      if (toastContainer.parentElement !== targetParent) targetParent.appendChild(toastContainer);
    }

    function renderShell() {
      const screen = StateStore.get('currentScreen');
      navButtons.forEach(btn => {
        const active = btn.getAttribute('data-nav') === screen;
        btn.classList.toggle('active', active);
        if (active) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
      });
      placeToastContainer(screen);
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      const el = document.getElementById(`screen-${screen}`);
      if (el) {
        el.classList.add('active');
        if (
          screen === 'editor' &&
          window.TruckPackerApp &&
          window.TruckPackerApp.EditorUI &&
          typeof window.TruckPackerApp.EditorUI.onActivated === 'function'
        ) {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              try {
                window.TruckPackerApp.EditorUI.onActivated();
              } catch (err) {
                console.warn('[AppShell] Editor activation hook failed', err);
              }
            });
          });
        }
      }
      if (contentRoot) contentRoot.classList.toggle('editor-mode', screen === 'editor');

      const isMobile = window.matchMedia('(max-width: 899px)').matches;

      if (screen === 'editor') {
        // Collapse sidebar to maximize editor viewport (desktop only)
        if (isMobile) {
          appRoot.classList.remove('sidebar-collapsed');
          sidebar.classList.remove('open');
        } else {
          appRoot.classList.add('sidebar-collapsed');
          sidebar.classList.remove('open');
        }
        syncSidebarState();
        // Ensure editor panels visible to avoid empty canvas gap
        const editorLeft = document.getElementById('editor-left');
        const editorRight = document.getElementById('editor-right');
        editorLeft && editorLeft.classList.remove('hidden');
        editorRight && editorRight.classList.remove('hidden');
        const pack = PackLibrary.getById(StateStore.get('currentPackId'));
        topbarTitle.textContent = pack ? pack.title || 'Editor' : 'Editor';
        topbarSubtitle.textContent = pack ? `Edited ${Utils.formatRelativeTime(pack.lastEdited)}` : '3D workspace';
        return;
      }

      // Restore sidebar when leaving editor (desktop)
      if (!isMobile) appRoot.classList.remove('sidebar-collapsed');
      syncSidebarState();

      const meta = screenTitles[screen] || { title: 'Truck Packer 3D', subtitle: '' };
      topbarTitle.textContent = meta.title;
      topbarSubtitle.textContent = meta.subtitle;
    }

    return { init: initShell, navigate, renderShell };
  })();

  return AppShell;
}
