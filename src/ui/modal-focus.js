/** Focus policy over the interaction registry; no separate stack or restoration. */
export function createModalFocus({ windowRef, documentRef, getActiveOwner, getOwners }) {
  const selector = 'a[href], button, input, select, textarea, summary, [contenteditable], [tabindex]';
  const tabIndex = element => element.isContentEditable && !element.hasAttribute('tabindex')
    ? 0 : element.tabIndex;
  const byTabOrder = (a, b) => (tabIndex(a) || Infinity) - (tabIndex(b) || Infinity);

  function usable(element, sequential = true) {
    if (!element?.isConnected || typeof element.focus !== 'function' ||
        !element.getClientRects?.().length || element.matches(':disabled, [aria-disabled="true"]') ||
        element.closest('[hidden]') || element.type === 'hidden') return false;
    if (sequential && tabIndex(element) < 0) return false;
    for (let node = element; node; node = node.parentElement) {
      if (node.matches('details:not([open])') &&
          !node.querySelector('summary')?.contains(element)) return false;
      const style = windowRef.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          style.visibility === 'collapse' || style.contentVisibility === 'hidden') return false;
    }
    return true;
  }

  // Popups extend their owning dialog's logical region, including portalled DOM.
  // Standalone page popups and specialized blockers have no ordinary focus root.
  function boundary(active = getActiveOwner()) {
    const owners = getOwners();
    while (active?.kind === 'popup') {
      const parentId = active.parentId;
      active = owners.find(owner => owner.id === parentId);
    }
    return active?.focusRoot && active.isActive() ? active : null;
  }

  function region(owner) {
    const owners = getOwners();
    const included = new Set([owner]);
    for (const candidate of owners) {
      if (candidate.kind !== 'popup' || !candidate.isActive()) continue;
      let parent = owners.find(item => item.id === candidate.parentId);
      while (parent?.kind === 'popup' && parent.isActive()) {
        const parentId = parent.parentId;
        parent = owners.find(item => item.id === parentId);
      }
      if (parent === owner) included.add(candidate);
    }
    const roots = [...included].map(item => item === owner ? owner.focusRoot : item.element).filter(Boolean);
    const contains = element => roots.some(root => root.contains(element)) &&
      !owners.some(item => item !== owner && !included.has(item) && item.element?.contains(element) &&
        // An ancestor owner can contain the active child's root without excluding it.
        !item.element.contains(owner.focusRoot));
    const candidates = [...new Set(roots.flatMap(root => [...root.querySelectorAll(selector)]))]
      .filter(element => contains(element) && usable(element));
    const elements = candidates.filter(element => {
      if (element.type !== 'radio' || !element.name) return true;
      const group = candidates.filter(item => item.type === 'radio' &&
        item.name === element.name && item.form === element.form);
      return element === (group.find(item => item.checked) || group[0]);
    })
      // Match native positive-tabindex ordering; stable sort preserves DOM order.
      .sort(byTabOrder);
    return { contains, elements };
  }

  function focus(element) {
    if (!usable(element, false)) return false;
    element.focus();
    return documentRef.activeElement === element;
  }

  function enter(owner, initial = false) {
    // Deferred setup/rerenders must never take focus from a newer dialog/popup.
    if (!usable(owner.focusRoot, false)) return;
    if (getActiveOwner() !== owner || boundary(owner) !== owner) return;
    const { contains, elements } = region(owner);
    let explicit;
    if (initial) {
      try { explicit = typeof owner.initialFocus === 'function' ? owner.initialFocus() : owner.initialFocus; }
      catch { /* An unavailable caller target falls through to the dialog policy. */ }
    }
    if (usable(explicit, false) && contains(explicit) && focus(explicit)) return;
    if (contains(documentRef.activeElement) && usable(documentRef.activeElement, false)) return;
    const autofocus = elements.find(element => element.hasAttribute('autofocus'));
    // Prefer task fields/content and the existing first footer action over header X.
    const field = elements.find(element => element.matches('input:not([type="button"]):not([type="submit"]):not([type="color"]), textarea, select, [contenteditable="true"]'));
    const task = elements.find(element => element.closest('.modal-body'));
    const action = elements.find(element => element.closest('.modal-footer'));
    const target = autofocus || field || task || action || elements[0];
    if (!focus(target)) focus(owner.focusRoot);
  }

  function handleTab(event, active) {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const owner = boundary(active);
    if (!owner) return;
    const { contains, elements } = region(owner);
    const focused = documentRef.activeElement;
    const index = elements.indexOf(focused);
    let target;
    if (!elements.length) {
      target = owner.focusRoot;
    } else if (!contains(focused) || index < 0) {
      target = event.shiftKey ? elements.at(-1) : elements[0];
    } else if (event.shiftKey && index === 0) {
      target = elements.at(-1);
    } else if (!event.shiftKey && index === elements.length - 1) {
      target = elements[0];
    } else {
      // Leave contiguous internal controls to native Tab. Explicitly bridge a
      // portal, inactive child, or unusable control in the browser's DOM order.
      const next = elements[index + (event.shiftKey ? -1 : 1)];
      const domOrder = [...documentRef.querySelectorAll(selector)]
        .filter(element => tabIndex(element) >= 0)
        .sort(byTabOrder);
      if (domOrder[domOrder.indexOf(focused) + (event.shiftKey ? -1 : 1)] !== next) target = next;
    }
    if (target) {
      event.preventDefault();
      focus(target);
    }
  }

  return { enter, handleTab };
}
