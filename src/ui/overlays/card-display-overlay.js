/**
 * @file card-display-overlay.js
 * @description Compact overlay for toggling Packs/Cases card and list column visibility.
 * @module ui/overlays/card-display-overlay
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function createCardDisplayOverlay({
  documentRef = document,
  UIComponents,
  PreferencesManager,
  Defaults,
  Utils,
  getCasesUI,
  getPacksUI,
}) {
  const doc = documentRef;

  function isOpen() {
    return Boolean(doc.querySelector('[data-dropdown="1"][data-role="card-display"]'));
  }

  function close() {
    try {
      UIComponents.closeAllDropdowns();
    } catch {
      // ignore
    }
  }

  function open({ screen, force } = {}) {
    const anchorEl = screen === 'cases' ? doc.getElementById('cases-card-display') : doc.getElementById('packs-card-display');
    if (!anchorEl) return;
    const anchorId = anchorEl.id || '';
    const existing = anchorId
      ? doc.querySelector(`[data-dropdown="1"][data-role="card-display"][data-anchor-id="${CSS.escape(anchorId)}"]`)
      : null;
    if (existing && !force) {
      UIComponents.closeAllDropdowns();
      return;
    }
    if (existing && force) UIComponents.closeAllDropdowns();

    const prefs = PreferencesManager.get();
    const badges = prefs.gridCardBadges || Defaults.defaultPreferences.gridCardBadges;
    const packs = (badges && badges.packs) || Defaults.defaultPreferences.gridCardBadges.packs;
    const cases = (badges && badges.cases) || Defaults.defaultPreferences.gridCardBadges.cases;

    function setFlag(path, value) {
      const prev = PreferencesManager.get();
      const next = Utils.deepClone(prev);
      next.gridCardBadges = next.gridCardBadges && typeof next.gridCardBadges === 'object' ? next.gridCardBadges : {};
      next.gridCardBadges.packs =
        next.gridCardBadges.packs && typeof next.gridCardBadges.packs === 'object' ? next.gridCardBadges.packs : {};
      next.gridCardBadges.cases =
        next.gridCardBadges.cases && typeof next.gridCardBadges.cases === 'object' ? next.gridCardBadges.cases : {};
      if (path.startsWith('packs.')) next.gridCardBadges.packs[path.slice('packs.'.length)] = Boolean(value);
      if (path.startsWith('cases.')) next.gridCardBadges.cases[path.slice('cases.'.length)] = Boolean(value);
      PreferencesManager.set(next);
      const casesUI = getCasesUI ? getCasesUI() : null;
      const packsUI = getPacksUI ? getPacksUI() : null;
      if (screen === 'cases' && casesUI && casesUI.render) casesUI.render();
      else if (packsUI && packsUI.render) packsUI.render();
    }

    function item(label, checked, onClick) {
      return {
        label,
        checkbox: true,
        checked,
        onCheckboxChange: () => {
          onClick();
          open({ screen, force: true });
        },
        onClick: () => {
          onClick();
          open({ screen, force: true });
        },
      };
    }

    const items = [];
    if (screen === 'cases') {
      items.push({ type: 'header', label: 'Card Display - Cases' });
      items.push(item('Show Category', cases.showCategory !== false, () => setFlag('cases.showCategory', cases.showCategory === false)));
      items.push(item('Show Dimensions', cases.showDims !== false, () => setFlag('cases.showDims', cases.showDims === false)));
      items.push(item('Show Volume', cases.showVolume !== false, () => setFlag('cases.showVolume', cases.showVolume === false)));
      items.push(item('Show Weight', cases.showWeight !== false, () => setFlag('cases.showWeight', cases.showWeight === false)));
      items.push(item('Show Flip', cases.showFlip !== false, () => setFlag('cases.showFlip', cases.showFlip === false)));
      items.push(item('Show Edited Time', cases.showEditedTime !== false, () => setFlag('cases.showEditedTime', cases.showEditedTime === false)));
    } else {
      items.push({ type: 'header', label: 'Card Display - Packs' });
      items.push(item('Show Thumbnail', packs.showThumbnail !== false, () => setFlag('packs.showThumbnail', packs.showThumbnail === false)));
      items.push(item('Show Cases Count', packs.showCasesCount !== false, () => setFlag('packs.showCasesCount', packs.showCasesCount === false)));
      items.push(item('Show Dimensions', packs.showTruckDims !== false, () => setFlag('packs.showTruckDims', packs.showTruckDims === false)));
      items.push(item('Show Shape', packs.showShapeMode !== false, () => setFlag('packs.showShapeMode', packs.showShapeMode === false)));
      items.push(item('Show Packed', packs.showPacked !== false, () => setFlag('packs.showPacked', packs.showPacked === false)));
      items.push(item('Show Volume', packs.showVolume !== false, () => setFlag('packs.showVolume', packs.showVolume === false)));
      items.push(item('Show Weight', packs.showWeight !== false, () => setFlag('packs.showWeight', packs.showWeight === false)));
      items.push(item('Show Edited Time', packs.showEditedTime !== false, () => setFlag('packs.showEditedTime', packs.showEditedTime === false)));
    }

    UIComponents.openDropdown(anchorEl, items, { width: 260, align: 'left', role: 'card-display', closeOnCheckboxChange: false });
  }

  function init() {
    // No-op; card display is opened via toolbar buttons.
  }

  return { init, open, close, isOpen };
}
