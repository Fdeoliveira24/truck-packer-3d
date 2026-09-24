/** Focus policy over the existing interaction registry; no separate owner stack. */
export function createModalFocus({ windowRef, documentRef, getActiveOwner, getOwners }) {
  const restoration = new WeakMap();
  const selector = 'a[href], button, input, select, textarea, summary, [contenteditable], [tabindex]';
  const tabIndex = element => element.isContentEditable && !element.hasAttribute('tabindex')
    ? 0 : element.tabIndex;
  const byTabOrder = (a, b) => (tabIndex(a) || Infinity) - (tabIndex(b) || Infinity);

  function usable(element, sequential = true, nativeTab = false) {
    if (!element?.isConnected || typeof element.focus !== 'function' ||
        !element.getClientRects?.().length || element.matches(':disabled') ||
        (!nativeTab && element.matches('[aria-disabled="true"]')) ||
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
    return { contains, roots };
  }

  function controls({ contains, roots }) {
    const allElements = [...new Set(roots.flatMap(root => [...root.querySelectorAll(selector)]))];
    // Native Tab skips hidden/disabled controls, but still visits aria-disabled
    // controls and foreign logical owners, which our navigation must bridge.
    const domOrder = allElements.filter(element => usable(element, true, true));
    const candidates = domOrder.filter(element => contains(element) && !element.matches('[aria-disabled="true"]'));
    const radioGroups = new Map();
    for (const element of candidates) {
      if (element.type !== 'radio' || !element.name) continue;
      let groups = radioGroups.get(element.form);
      if (!groups) {
        groups = new Map();
        radioGroups.set(element.form, groups);
      }
      const chosen = groups.get(element.name);
      if (!chosen || (!chosen.checked && element.checked)) groups.set(element.name, element);
    }
    const elements = candidates.filter(element => {
      if (element.type !== 'radio' || !element.name) return true;
      return element === radioGroups.get(element.form).get(element.name);
    })
      // Match native positive-tabindex ordering; stable sort preserves DOM order.
      .sort(byTabOrder);
    return { elements, domOrder };
  }

  function focus(element) {
    if (!usable(element, false)) return false;
    element.focus();
    return documentRef.activeElement === element;
  }

  function enter(owner, initial = false, allowed = _element => true) {
    // Deferred setup/rerenders must never take focus from a newer dialog/popup.
    if (!usable(owner.focusRoot, false) || !allowed(owner.focusRoot)) return;
    if (getActiveOwner() !== owner || boundary(owner) !== owner) return;
    const focusRegion = region(owner);
    const { contains } = focusRegion;
    let explicit;
    if (initial) {
      try { explicit = typeof owner.initialFocus === 'function' ? owner.initialFocus() : owner.initialFocus; }
      catch { /* An unavailable caller target falls through to the dialog policy. */ }
    }
    if (usable(explicit, false) && contains(explicit) && allowed(explicit) && focus(explicit)) return;
    if (contains(documentRef.activeElement) && usable(documentRef.activeElement, false) && allowed(documentRef.activeElement)) return;
    const elements = controls(focusRegion).elements.filter(allowed);
    const autofocus = elements.find(element => element.hasAttribute('autofocus'));
    // Prefer task fields/content and the existing first footer action over header X.
    const field = elements.find(element => element.matches('input:not([type="button"]):not([type="submit"]):not([type="color"]), textarea, select, [contenteditable="true"]'));
    const task = elements.find(element => element.closest('.modal-body'));
    const action = elements.find(element => element.closest('.modal-footer'));
    const target = autofocus || field || task || action || elements[0];
    if (!focus(target)) focus(owner.focusRoot);
  }

  function capture(owner, resolver) {
    const owners = getOwners();
    const parent = owners.find(item => item.id === owner.parentId);
    let source = documentRef.activeElement;
    const previous = [...owners].reverse().find(item => source && item.element?.contains(source));
    // A replacement shares its predecessor's logical parent, so its return
    // source is the flow's opener, not a control in the about-to-close dialog.
    if (previous && previous !== parent && previous.parentId === owner.parentId) {
      source = restoration.get(previous)?.source || source;
    }
    restoration.set(owner, { source, parent, resolver });
  }

  function restore(owner) {
    const saved = restoration.get(owner);
    restoration.delete(owner);
    if (!saved) return;
    const { source, parent, resolver } = saved;
    const owners = getOwners();
    // A cascading parent close owns the final return. Its child must not jump
    // to the page in between, nor compete with a replacement or newer owner.
    if (parent && !owners.includes(parent)) return;
    const active = getActiveOwner();
    if (active && active !== parent) return;
    const focusRegion = active && boundary(active) === active ? region(active) : null;
    const isValidTarget = target => usable(target, false) &&
      target !== documentRef.body && target !== documentRef.documentElement &&
      !target.closest('[inert], [aria-hidden="true"], [aria-disabled="true"]') &&
      (focusRegion ? focusRegion.contains(target) :
        !active && !owners.some(item => item.element?.contains(target)));
    let target = source;
    if (typeof resolver === 'function') {
      try { target = resolver({ source, isValidTarget }); }
      catch { target = null; }
    }
    if (getActiveOwner() !== active) return;
    if (isValidTarget(target) && focus(target)) return;
    if (focusRegion) enter(active, false, isValidTarget);
  }

  function handleTab(event, active) {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const owner = boundary(active);
    if (!owner) return;
    const focusRegion = region(owner);
    const { contains, roots } = focusRegion;
    const { elements, domOrder } = controls(focusRegion);
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
      // Leave contiguous zero-tabindex controls in one DOM root to native Tab.
      // Bridge portals/excluded controls and positive tabindex explicitly: page
      // controls can interleave positive values, without being part of our region.
      const next = elements[index + (event.shiftKey ? -1 : 1)];
      const sameRoot = roots.some(root => root.contains(focused) && root.contains(next));
      if (!sameRoot || tabIndex(focused) > 0 || tabIndex(next) > 0 ||
          domOrder[domOrder.indexOf(focused) + (event.shiftKey ? -1 : 1)] !== next) target = next;
    }
    if (target) {
      event.preventDefault();
      focus(target);
    }
  }

  return { enter, handleTab, capture, restore };
}
