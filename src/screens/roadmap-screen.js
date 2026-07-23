/**
 * @file roadmap-screen.js
 * @description Screen factory responsible for rendering and binding UI for a specific screen.
 * @module screens/roadmap-screen
 * @created 07/23/2026
 * @updated 07/23/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

// Roadmap screen (extracted from src/app.js; behavior preserved)

export function createRoadmapScreen({
  Data,
  UIComponents,
}) {
  const RoadmapUI = (() => {
    const listEl = document.getElementById('roadmap-list');
    function initRoadmapUI() { }
    function render() {
      listEl.innerHTML = '';
      Data.roadmap.forEach(group => {
        const wrap = document.createElement('div');
        wrap.className = 'grid';
        wrap.style.gap = '10px';
        const h = document.createElement('div');
        h.style.fontSize = 'var(--text-lg)';
        h.style.fontWeight = 'var(--font-semibold)';
        h.textContent = group.quarter;
        wrap.appendChild(h);
        const grid = document.createElement('div');
        grid.className = 'pack-grid';
        grid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        group.items.forEach(item => {
          const card = document.createElement('div');
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
        wrap.appendChild(grid);
        listEl.appendChild(wrap);
      });
    }
    return { init: initRoadmapUI, render };
  })();

  return RoadmapUI;
}
