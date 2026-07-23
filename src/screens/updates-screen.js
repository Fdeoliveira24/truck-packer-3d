/**
 * @file updates-screen.js
 * @description Screen factory responsible for rendering and binding UI for a specific screen.
 * @module screens/updates-screen
 * @created 07/23/2026
 * @updated 07/23/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

// Updates screen (extracted from src/app.js; behavior preserved)

export function createUpdatesScreen({
  Data,
}) {
  const UpdatesUI = (() => {
    const listEl = document.getElementById('updates-list');
    function initUpdatesUI() { }
    function render() {
      listEl.innerHTML = '';
      Data.updates.forEach(u => {
        const card = document.createElement('div');
        card.className = 'card';
        const header = document.createElement('div');
        header.className = 'row space-between';
        header.style.alignItems = 'flex-start';
        const left = document.createElement('div');
        left.innerHTML = `<div style="font-weight:var(--font-semibold);font-size:var(--text-lg)">Version ${u.version}</div><div class="muted" style="font-size:var(--text-xs)">${new Date(u.date).toLocaleDateString()}</div>`;
        header.appendChild(left);
        card.appendChild(header);

        const sections = [
          { title: 'New Features', items: u.features || [] },
          { title: 'Bug Fixes', items: u.bugFixes || [] },
          { title: 'Breaking Changes', items: u.breakingChanges || [] },
        ].filter(s => s.items.length);
        sections.forEach(s => {
          const t = document.createElement('div');
          t.style.marginTop = '12px';
          t.style.fontWeight = 'var(--font-semibold)';
          t.textContent = s.title;
          card.appendChild(t);
          const ul = document.createElement('ul');
          ul.style.margin = '8px 0 0 16px';
          ul.style.color = 'var(--text-secondary)';
          ul.style.fontSize = 'var(--text-sm)';
          s.items.forEach(it => {
            const li = document.createElement('li');
            li.textContent = it;
            ul.appendChild(li);
          });
          card.appendChild(ul);
        });
        listEl.appendChild(card);
      });
    }
    return { init: initUpdatesUI, render };
  })();

  return UpdatesUI;
}
