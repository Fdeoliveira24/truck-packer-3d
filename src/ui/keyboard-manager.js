/**
 * @file keyboard-manager.js
 * @description App-wide keyboard shortcut manager: global keydown handling, shortcut map, and clipboard state.
 * @module ui/keyboard-manager
 * @created 07/23/2026
 * @author Truck Packer 3D Team
 */

// Keyboard manager (extracted from src/app.js; behavior preserved).
// Side-effect-free factory: all collaborators are injected; the single
// document keydown listener is installed only when init() is called.

export function createKeyboardManager({
  StateStore,
  PackLibrary,
  CaseLibrary,
  CaseScene,
  SceneManager,
  InteractionManager,
  AutoPackEngine,
  OperationLifecycle,
  UIComponents,
  AppShell,
  Storage,
  Utils,
}) {
  let shortcuts = {};

  const KeyboardManager = (() => {
    let clipboard = null;

    function clearClipboard() {
      clipboard = null;
    }

    function initKeyboardManager() {
      document.addEventListener('keydown', handleKeyDown);
    }

    function handleKeyDown(event) {
      if (isTypingContext(event)) return;
      const key = buildKeyString(event);
      const handler = shortcuts[key];
      if (!handler) return;
      const handled = handler(event);
      if (handled === false) return;
      event.preventDefault();
    }

    function isTypingContext(event) {
      const el = event.target;
      if (!el) return false;
      if (el.isContentEditable) return true;
      return el.matches && el.matches('input, textarea, select');
    }

    function buildKeyString(event) {
      const parts = [];
      if (event.metaKey) parts.push('meta');
      if (event.ctrlKey && !event.metaKey) parts.push('ctrl');
      if (event.shiftKey) parts.push('shift');
      if (event.altKey) parts.push('alt');
      parts.push(String(event.key || '').toLowerCase());
      return parts.join('+');
    }

    function inEditor() {
      return StateStore.get('currentScreen') === 'editor';
    }

    // Block pack-mutating keyboard shortcuts while a mutating editor operation
    // (AutoPack / Unpack / Truck Change / preview capture) owns the editor. Returns
    // true (and toasts) when blocked. Read-only shortcuts (copy, select, camera,
    // grid/shadow toggles) are intentionally NOT gated.
    function mutationBlockedWhileBusy() {
      if (OperationLifecycle && OperationLifecycle.isBusy()) {
        UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Editor' });
        return true;
      }
      return false;
    }

    function save() {
      Storage.saveNow();
      UIComponents.showToast('Saved locally', 'success', { title: 'Storage' });
    }

    function undo() {
      if (mutationBlockedWhileBusy()) return;
      const ok = StateStore.undo();
      UIComponents.showToast(ok ? 'Undone' : 'Nothing to undo', ok ? 'info' : 'warning', { title: 'Edit' });
    }

    function redo() {
      if (mutationBlockedWhileBusy()) return;
      const ok = StateStore.redo();
      UIComponents.showToast(ok ? 'Redone' : 'Nothing to redo', ok ? 'info' : 'warning', { title: 'Edit' });
    }

    function deselectAll() {
      StateStore.set({ selectedInstanceIds: [] }, { skipHistory: true });
      CaseScene.setSelected([]);
    }

    function selectAll() {
      if (!inEditor()) return;
      InteractionManager.selectAllInPack();
    }

    function deleteSelected() {
      if (!inEditor()) return;
      InteractionManager.deleteSelection();
    }

    function duplicateSelected() {
      if (!inEditor()) return;
      if (mutationBlockedWhileBusy()) return;
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      const selected = StateStore.get('selectedInstanceIds') || [];
      if (!pack || !selected.length) return;

      const source = selected
        .map(id => (pack.cases || []).find(inst => inst && inst.id === id))
        .filter(Boolean);
      const result = PackLibrary.duplicateInstancesSafely(packId, source, CaseLibrary.getCases());
      if (!result || !result.newIds.length) {
        UIComponents.showToast('No collision-free duplicate position found', 'warning', { title: 'Edit' });
        return;
      }
      StateStore.set({ selectedInstanceIds: result.newIds }, { skipHistory: true });
      CaseScene.setSelected(result.newIds);
      UIComponents.showToast(
        result.placement === 'staged'
          ? `Duplicated ${result.newIds.length} case(s) to staging`
          : `Duplicated ${result.newIds.length} case(s)`,
        'success',
        { title: 'Edit' }
      );
    }

    function copySelected() {
      if (!inEditor()) return;
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      const selected = StateStore.get('selectedInstanceIds') || [];
      if (!pack || !selected.length) return;
      clipboard = selected
        .map(id => (pack.cases || []).find(i => i.id === id))
        .filter(Boolean)
        .map(i => Utils.deepClone(i));
      UIComponents.showToast(`Copied ${clipboard.length} case(s)`, 'info', { title: 'Clipboard' });
    }

    function pasteClipboard() {
      if (!inEditor()) return;
      if (mutationBlockedWhileBusy()) return;
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      if (!pack || !clipboard || !clipboard.length) return;

      const result = PackLibrary.duplicateInstancesSafely(packId, clipboard, CaseLibrary.getCases());
      if (!result || !result.newIds.length) {
        UIComponents.showToast('No collision-free paste position found', 'warning', { title: 'Clipboard' });
        return;
      }
      StateStore.set({ selectedInstanceIds: result.newIds }, { skipHistory: true });
      CaseScene.setSelected(result.newIds);
      UIComponents.showToast(
        result.placement === 'staged'
          ? `Pasted ${result.newIds.length} case(s) to staging`
          : `Pasted ${result.newIds.length} case(s)`,
        'success',
        { title: 'Clipboard' }
      );
    }

    function focusSelected(event) {
      if (!inEditor()) return;
      const selected = StateStore.get('selectedInstanceIds') || [];
      if (!selected.length) return;
      const obj = CaseScene.getObject(selected[0]);
      if (!obj) return;
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      SceneManager.focusOnWorldPoint(obj.position.clone(), { duration: 600 });
    }

    function toggleGrid() {
      if (!inEditor()) return;
      const visible = SceneManager.toggleGrid();
      UIComponents.showToast(visible ? 'Grid shown' : 'Grid hidden', 'info', { title: 'View', duration: 1200 });
    }

    function toggleShadows() {
      if (!inEditor()) return;
      const enabled = SceneManager.toggleShadows();
      UIComponents.showToast(enabled ? 'Shadows enabled' : 'Shadows disabled', 'info', {
        title: 'View',
        duration: 1200,
      });
    }

    function openPackDialog() {
      const packs = PackLibrary.getPacks()
        .slice()
        .sort((a, b) => (b.lastEdited || 0) - (a.lastEdited || 0));
      const content = document.createElement('div');
      content.className = 'grid';
      content.style.gap = '10px';
      let modal = null;
      if (!packs.length) {
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.style.fontSize = 'var(--text-sm)';
        empty.textContent = 'No packs available.';
        content.appendChild(empty);
      } else {
        packs.forEach(p => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'btn';
          row.style.justifyContent = 'space-between';
          row.style.width = '100%';
          const name = document.createElement('span');
          name.style.fontWeight = 'var(--font-semibold)';
          name.textContent = p.title || 'Untitled';
          const meta = document.createElement('span');
          meta.className = 'muted';
          meta.style.fontSize = 'var(--text-xs)';
          meta.textContent = `edited ${Utils.formatRelativeTime(p.lastEdited)}`;
          row.appendChild(name);
          row.appendChild(meta);
          row.addEventListener('click', () => {
            PackLibrary.open(p.id);
            AppShell.navigate('editor');
            if (modal) modal.close();
          });
          content.appendChild(row);
        });
      }

      modal = UIComponents.showModal({
        title: 'Open Pack',
        content,
        actions: [{ label: 'Close', variant: 'primary' }],
      });
    }

    shortcuts = {
      'meta+s': save,
      'ctrl+s': save,
      'meta+z': undo,
      'ctrl+z': undo,
      'meta+shift+z': redo,
      'ctrl+shift+z': redo,
      'meta+a': selectAll,
      'ctrl+a': selectAll,
      'meta+shift+a': deselectAll,
      'ctrl+shift+a': deselectAll,
      escape: deselectAll,
      delete: deleteSelected,
      backspace: deleteSelected,
      'meta+d': duplicateSelected,
      'ctrl+d': duplicateSelected,
      'meta+c': copySelected,
      'ctrl+c': copySelected,
      'meta+v': pasteClipboard,
      'ctrl+v': pasteClipboard,
      'meta+p': () => {
        if (!inEditor()) return;
        AutoPackEngine.pack().catch(err => console.error('[KeyboardShortcut] AutoPack error:', err));
      },
      'ctrl+p': () => {
        if (!inEditor()) return;
        AutoPackEngine.pack().catch(err => console.error('[KeyboardShortcut] AutoPack error:', err));
      },
      'meta+o': openPackDialog,
      'ctrl+o': openPackDialog,
      g: toggleGrid,
      s: toggleShadows,
      'shift+f': focusSelected,
      p: () => {
        if (!inEditor()) return;
        SceneManager.toggleDevOverlay();
      },
    };

    return { init: initKeyboardManager, clearClipboard };
  })();

  return KeyboardManager;
}
