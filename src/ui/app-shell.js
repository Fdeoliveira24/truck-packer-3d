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
}) {
  const AppShell = (() => {
    const appRoot = document.getElementById('app');
    const sidebar = document.getElementById('sidebar');
    const btnSidebar = document.getElementById('btn-sidebar');
    const topbarTitle = document.getElementById('topbar-title');
    const topbarSubtitle = document.getElementById('topbar-subtitle');
    const contentRoot = document.querySelector('.content');
    const navButtons = Array.from(document.querySelectorAll('[data-nav]'));

    const screenTitles = {
      packs: { title: 'Packs', subtitle: 'Project library' },
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
    }

    function initShell() {
      btnSidebar.addEventListener('click', toggleSidebar);
      navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-nav');
          navigate(target);
          if (window.matchMedia('(max-width: 899px)').matches) {
            sidebar.classList.remove('open');
          }
        });
      });

      window.addEventListener('resize', () => {
        if (!window.matchMedia('(max-width: 899px)').matches) {
          sidebar.classList.remove('open');
        }
      });
    }

    function navigate(screenKey) {
      StateStore.set({ currentScreen: screenKey }, { skipHistory: true });
    }

    function renderShell() {
      const screen = StateStore.get('currentScreen');
      navButtons.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-nav') === screen));
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

      const meta = screenTitles[screen] || { title: 'Truck Packer 3D', subtitle: '' };
      topbarTitle.textContent = meta.title;
      topbarSubtitle.textContent = meta.subtitle;
    }

    return { init: initShell, navigate, renderShell };
  })();

  return AppShell;
}
