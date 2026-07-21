/**
 * Shared Case modal used by the Cases screen and Editor case browser shortcut.
 */

import { canonicalOrientationLock } from '../../core/orientation.js';

export { canonicalOrientationLock };

function createField(doc, label, type = 'text', placeholder = '', required = false) {
  const wrap = doc.createElement('div');
  wrap.className = 'field';

  const l = doc.createElement('div');
  l.className = 'label';
  l.textContent = required ? `${label} (required)` : label;

  const input = doc.createElement('input');
  input.className = 'input';
  input.type = type;
  input.placeholder = placeholder;

  wrap.appendChild(l);
  wrap.appendChild(input);
  return { wrap, input };
}

function createSelectField(doc, label, options, value, help = '') {
  const wrap = doc.createElement('div');
  wrap.className = 'field';
  const l = doc.createElement('div');
  l.className = 'label';
  l.textContent = label;
  const select = doc.createElement('select');
  select.className = 'input';
  options.forEach(([val, text]) => {
    const opt = doc.createElement('option');
    opt.value = val;
    opt.textContent = text;
    select.appendChild(opt);
  });
  select.value = value;
  wrap.appendChild(l);
  wrap.appendChild(select);
  if (help) {
    const h = doc.createElement('div');
    h.className = 'tp3d-cases-handling-help';
    h.textContent = help;
    wrap.appendChild(h);
  }
  return { wrap, select };
}

function createCheckRow(doc, text, checked, help = '') {
  const row = doc.createElement('label');
  row.classList.add('tp3d-cases-flip-row');
  row.classList.add('tp3d-grid-span-full');
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  const span = doc.createElement('span');
  span.textContent = text;
  row.appendChild(input);
  row.appendChild(span);
  if (help) {
    const h = doc.createElement('div');
    h.className = 'tp3d-cases-handling-help';
    h.textContent = help;
    row.appendChild(h);
  }
  return { row, input };
}


export function formatCaseModalNumber(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';

  const decimalsByUnit = {
    in: 2,
    ft: 2,
    cm: 2,
    m: 4,
  };
  const maxDecimals = decimalsByUnit[unit] ?? 2;
  return Number(n.toFixed(maxDecimals)).toString();
}

function normalizeCaseModalColor(value, fallback = '#9ca3af') {
  const raw = String(value || '').trim();
  const six = raw.match(/^#?([0-9a-f]{6})$/i);
  if (six) return `#${six[1].toLowerCase()}`;
  const three = raw.match(/^#?([0-9a-f]{3})$/i);
  if (three) {
    const expanded = three[1]
      .split('')
      .map(ch => ch + ch)
      .join('');
    return `#${expanded.toLowerCase()}`;
  }
  return fallback;
}

function normalizeCategoryKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function openCaseModal({
  existing = null,
  Utils,
  UIComponents,
  PreferencesManager,
  CaseLibrary,
  CategoryService,
  onSaved,
  doc = document,
}) {
  const prefs = PreferencesManager.get();
  const lengthUnit = prefs.units.length;
  const weightUnit = prefs.units.weight;

  const now = Date.now();
  const isEdit = Boolean(existing);
  const initial = existing
    ? Utils.deepClone(existing)
    : {
        id: Utils.uuid(),
        name: '',
        manufacturer: '',
        category: 'default',
        dimensions: { length: 48, width: 24, height: 24 },
        weight: 0,
        canFlip: false,
        notes: '',
        color: CategoryService.meta('default').color,
        createdAt: now,
        updatedAt: now,
      };

  const content = doc.createElement('div');
  content.classList.add('tp3d-cases-modal-grid-2col');

  const fName = createField(doc, 'Name', 'text', 'Line Array Case', true);
  fName.input.value = initial.name || '';

  const fMfg = createField(doc, 'Manufacturer', 'text', 'L-Acoustics', false);
  fMfg.input.value = initial.manufacturer || '';

  const catWrap = doc.createElement('div');
  catWrap.className = 'field';
  catWrap.classList.add('tp3d-grid-span-full');
  const catLabel = doc.createElement('div');
  catLabel.className = 'label';
  catLabel.textContent = 'Category';
  const catRow = doc.createElement('div');
  catRow.classList.add('tp3d-cases-cat-row');
  const catColorSwatch = doc.createElement('label');
  catColorSwatch.classList.add('tp3d-cases-cat-swatch');
  catColorSwatch.setAttribute('aria-label', 'Category color');
  catColorSwatch.setAttribute('title', 'Category color');
  const catColorInput = doc.createElement('input');
  catColorInput.type = 'color';
  catColorInput.className = 'tp3d-cases-cat-color-input';
  catColorInput.setAttribute('aria-label', 'Category color');
  catColorSwatch.appendChild(catColorInput);
  const catSelect = doc.createElement('select');
  catSelect.className = 'select';
  catSelect.classList.add('tp3d-flex-1');
  let catOptions = [];
  const getCategoryOptions = () => {
    const options = CategoryService.listWithCounts(CaseLibrary.getCases());
    const currentKey = normalizeCategoryKey(initial.category || 'default') || 'default';
    if (currentKey && !options.some(c => c.key === currentKey)) {
      options.push(CategoryService.meta(currentKey));
    }
    return options;
  };
  const findDuplicateCategory = (name, excludeKey = '') => {
    const nextKey = normalizeCategoryKey(name);
    const excluded = normalizeCategoryKey(excludeKey);
    if (!nextKey) return null;
    return getCategoryOptions().find(c => c.key !== excluded && normalizeCategoryKey(c.name || c.key) === nextKey);
  };
  const populateCategorySelect = selectedKey => {
    const desiredKey = normalizeCategoryKey(selectedKey || initial.category || 'default') || 'default';
    catOptions = getCategoryOptions();
    catSelect.innerHTML = '';
    catOptions.forEach(c => {
      const opt = doc.createElement('option');
      opt.value = c.key;
      opt.textContent = c.name || CategoryService.meta(c.key).name;
      catSelect.appendChild(opt);
    });
    catSelect.value = catOptions.some(c => c.key === desiredKey) ? desiredKey : 'default';
  };
  populateCategorySelect(initial.category);
  const updateSwatch = () => {
    const meta = catOptions.find(c => c.key === catSelect.value) || CategoryService.meta(catSelect.value || 'default');
    const nextColor = normalizeCaseModalColor(meta.color, '#9ca3af');
    catColorInput.value = nextColor;
    catColorSwatch.style.background = nextColor;
  };
  catSelect.addEventListener('change', updateSwatch);
  catColorInput.addEventListener('input', () => {
    catColorSwatch.style.background = normalizeCaseModalColor(catColorInput.value, '#9ca3af');
  });
  updateSwatch();
  catRow.appendChild(catColorSwatch);
  catRow.appendChild(catSelect);
  catWrap.appendChild(catLabel);
  catWrap.appendChild(catRow);

  const catCreateRow = doc.createElement('div');
  catCreateRow.classList.add('tp3d-cases-new-category-row');
  const newCatColorSwatch = doc.createElement('label');
  newCatColorSwatch.classList.add('tp3d-cases-cat-swatch');
  newCatColorSwatch.setAttribute('aria-label', 'New category color');
  newCatColorSwatch.setAttribute('title', 'New category color');
  const newCatColor = doc.createElement('input');
  newCatColor.type = 'color';
  newCatColor.className = 'tp3d-cases-cat-color-input';
  newCatColor.setAttribute('aria-label', 'New category color');
  newCatColor.value = '#ff9f1c';
  newCatColorSwatch.style.background = newCatColor.value;
  newCatColorSwatch.appendChild(newCatColor);
  const newCatName = doc.createElement('input');
  newCatName.type = 'text';
  newCatName.className = 'input';
  newCatName.placeholder = 'Add New Category Name';
  const newCatSave = doc.createElement('button');
  newCatSave.type = 'button';
  newCatSave.className = 'btn btn-sm btn-primary';
  newCatSave.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
  catCreateRow.appendChild(newCatColorSwatch);
  catCreateRow.appendChild(newCatName);
  catCreateRow.appendChild(newCatSave);
  newCatColor.addEventListener('input', () => {
    newCatColorSwatch.style.background = normalizeCaseModalColor(newCatColor.value, '#ff9f1c');
  });
  newCatSave.addEventListener('click', () => {
    const nextName = String(newCatName.value || '').trim();
    if (!nextName) {
      UIComponents.showToast('Category name is required', 'warning');
      newCatName.focus();
      return;
    }
    const duplicate = findDuplicateCategory(nextName);
    if (duplicate) {
      UIComponents.showToast(`Category "${duplicate.name}" already exists. Select it from the list.`, 'warning');
      catSelect.value = duplicate.key;
      updateSwatch();
      newCatName.focus();
      return;
    }
    const next = CategoryService.upsert({ name: nextName, color: newCatColor.value });
    populateCategorySelect(next.key);
    updateSwatch();
    newCatName.value = '';
    newCatColor.value = '#ff9f1c';
    newCatColorSwatch.style.background = newCatColor.value;
    UIComponents.showToast(`Created "${next.name}"`, 'success');
  });
  catWrap.appendChild(catCreateRow);

  const fL = createField(doc, `Length (${lengthUnit})`, 'number', '', true);
  const fW = createField(doc, `Width (${lengthUnit})`, 'number', '', true);
  const fH = createField(doc, `Height (${lengthUnit})`, 'number', '', true);
  fL.input.value = formatCaseModalNumber(Utils.inchesToUnit(initial.dimensions.length, lengthUnit), lengthUnit);
  fW.input.value = formatCaseModalNumber(Utils.inchesToUnit(initial.dimensions.width, lengthUnit), lengthUnit);
  fH.input.value = formatCaseModalNumber(Utils.inchesToUnit(initial.dimensions.height, lengthUnit), lengthUnit);

  const fWeight = createField(doc, `Weight (${weightUnit})`, 'number', '', false);
  fWeight.input.step = '0.1';
  const weightValue = Utils.poundsToUnit(Number(initial.weight) || 0, weightUnit);
  fWeight.input.value = String(Math.round(weightValue * 100) / 100);

  // ── Handling Rules (collapsed) ──────────────────────────────────────────
  // Only rules the active AutoPack solver honors exactly (Cargo-Rule V1).
  const handling = doc.createElement('details');
  handling.className = 'field tp3d-grid-span-full tp3d-cases-handling';
  const handlingSummary = doc.createElement('summary');
  handlingSummary.textContent = 'Handling Rules';
  handling.appendChild(handlingSummary);

  const orient = createSelectField(doc, 'Orientation', [
    ['any', 'Any direction'],
    ['upright', 'Keep upright'],
    ['onSide', 'Place on side'],
  ], canonicalOrientationLock(initial.orientationLock),
    'Limits which orientations AutoPack and manual rotation may use. ' +
    'Upright keeps the saved height axis vertical (a long item stays lying down); ' +
    'On side tips the case so its height axis is no longer vertical.');

  const flipRow = createCheckRow(doc, 'Allow flipping',
    canonicalOrientationLock(initial.orientationLock) === 'any' && Boolean(initial.canFlip),
    'Lets AutoPack place this item on another face when orientation rules allow it.');
  const flip = flipRow.input;

  const noTopRow = createCheckRow(doc, 'Do not place cargo on top',
    initial.noStackOnTop === true || initial.stackable === false,
    'Nothing may be stacked directly on this item.');
  const noTop = noTopRow.input;

  const fMaxStack = createField(doc, 'Max items directly on top (0 = no limit)', 'number', '', false);
  fMaxStack.input.min = '0';
  fMaxStack.input.step = '1';
  fMaxStack.input.value = String(Math.max(0, parseInt(initial.maxStackCount, 10) || 0));

  const palletRow = createCheckRow(doc, 'Treat as pallet / load base',
    initial.isPallet === true,
    'Allows heavier items to rest on this base. Does not enforce a weight limit.');
  const pallet = palletRow.input;

  const fPalletWarn = createField(doc, 'Max load — warning only', 'number', '', false);
  fPalletWarn.input.min = '0';
  fPalletWarn.input.step = '1';
  fPalletWarn.input.value = String(Math.max(0, Number(initial.maxPalletWeight) || 0));
  const palletWarnHelp = doc.createElement('div');
  palletWarnHelp.className = 'tp3d-cases-handling-help';
  palletWarnHelp.textContent = 'Warns if stacked weight exceeds this. It does not block AutoPack.';
  fPalletWarn.wrap.appendChild(palletWarnHelp);

  // Note shown when no-top-load disables the stack cap: the saved value is kept.
  const maxStackNote = doc.createElement('div');
  maxStackNote.className = 'tp3d-cases-handling-help';
  maxStackNote.textContent =
    'Disabled while “Do not place cargo on top” is on. The saved value is kept and applies again when that option is off.';
  fMaxStack.wrap.appendChild(maxStackNote);

  // Note shown when a pallet also forbids top load: explain the resulting behavior.
  const palletNoTopNote = doc.createElement('div');
  palletNoTopNote.className = 'tp3d-cases-handling-help';
  palletNoTopNote.textContent =
    'This pallet is marked “No top load,” so AutoPack will not place cargo on it.';

  const lane = createSelectField(doc, 'Long-item lane', [
    ['auto', 'Automatic'],
    ['always', 'Always'],
    ['never', 'Never'],
  ], initial.laneItem === true ? 'always' : initial.laneItem === false ? 'never' : 'auto', 'Prefer a lengthwise lane for long items. AutoPack may still place them normally if no lane fits.');

  const priority = createSelectField(doc, 'Packing priority (tie-breaker)', [
    ['-1', 'Low'],
    ['0', 'Normal'],
    ['1', 'High'],
  ], String(Number(initial.loadPriority) > 0 ? 1 : Number(initial.loadPriority) < 0 ? -1 : 0), 'Nudges the order among similar items. Fit and hard rules still win.');

  // Dependencies
  const applyOrientationDep = () => {
    const isAny = orient.select.value === 'any';
    flip.disabled = !isAny;
    if (!isAny) flip.checked = false;
  };
  const applyNoTopDep = () => {
    fMaxStack.input.disabled = noTop.checked;
    maxStackNote.style.display = noTop.checked ? '' : 'none';
    // Pallet + no-top-load is allowed but means AutoPack will not load the pallet.
    palletNoTopNote.style.display = noTop.checked && pallet.checked ? '' : 'none';
  };
  const applyPalletDep = () => {
    // Keep the warning value as DORMANT when not a pallet: hide the field but never
    // clear the saved value, so toggling Pallet off and on does not destroy input.
    fPalletWarn.wrap.style.display = pallet.checked ? '' : 'none';
    palletNoTopNote.style.display = noTop.checked && pallet.checked ? '' : 'none';
  };
  orient.select.addEventListener('change', applyOrientationDep);
  noTop.addEventListener('change', applyNoTopDep);
  pallet.addEventListener('change', applyPalletDep);
  applyOrientationDep();
  applyNoTopDep();
  applyPalletDep();

  handling.appendChild(orient.wrap);
  handling.appendChild(flipRow.row);
  handling.appendChild(noTopRow.row);
  handling.appendChild(fMaxStack.wrap);
  handling.appendChild(palletRow.row);
  handling.appendChild(fPalletWarn.wrap);
  handling.appendChild(palletNoTopNote);
  handling.appendChild(lane.wrap);
  handling.appendChild(priority.wrap);

  const notesWrap = doc.createElement('div');
  notesWrap.className = 'field';
  notesWrap.classList.add('tp3d-grid-span-full');
  const notesLabel = doc.createElement('div');
  notesLabel.className = 'label';
  notesLabel.textContent = 'Standard Instructions';
  const notesDesc = doc.createElement('div');
  notesDesc.className = 'muted tp3d-editor-sub-sm';
  notesDesc.textContent = 'Applies to every unit of this Case.';
  const notes = doc.createElement('textarea');
  notes.className = 'input';
  notes.classList.add('tp3d-textarea-minh-60');
  notes.value = initial.notes || '';
  notesWrap.appendChild(notesLabel);
  notesWrap.appendChild(notesDesc);
  notesWrap.appendChild(notes);

  content.appendChild(fName.wrap);
  content.appendChild(fMfg.wrap);
  content.appendChild(catWrap);
  content.appendChild(fL.wrap);
  content.appendChild(fW.wrap);
  content.appendChild(fH.wrap);
  content.appendChild(fWeight.wrap);
  content.appendChild(handling);
  content.appendChild(notesWrap);

  UIComponents.showModal({
    title: isEdit ? 'Edit Case' : 'New Case',
    content,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save',
        variant: 'primary',
        onClick: () => {
          const name = String(fName.input.value || '').trim();
          if (!name) {
            UIComponents.showToast('Name is required', 'warning');
            fName.input.focus();
            return false;
          }
          const length = Utils.unitToInches(Number(fL.input.value) || 0, lengthUnit);
          const width = Utils.unitToInches(Number(fW.input.value) || 0, lengthUnit);
          const height = Utils.unitToInches(Number(fH.input.value) || 0, lengthUnit);
          if (length <= 0 || width <= 0 || height <= 0) {
            UIComponents.showToast('Dimensions must be > 0', 'warning');
            return false;
          }
          const weightLb = Utils.unitToPounds(Number(fWeight.input.value) || 0, weightUnit);
          const categoryKey = String(catSelect.value || 'default');
          const catMeta = catOptions.find(c => c.key === categoryKey) || CategoryService.meta(categoryKey);
          const categoryColor = normalizeCaseModalColor(catColorInput.value, catMeta.color || '#ff9f1c');
          CategoryService.upsert({ key: categoryKey, name: catMeta.name, color: categoryColor });
          const orientationLock = canonicalOrientationLock(orient.select.value);
          const laneValue = lane.select.value === 'always' ? true : lane.select.value === 'never' ? false : null;
          const priorityValue = priority.select.value === '1' ? 1 : priority.select.value === '-1' ? -1 : 0;
          const noTopChecked = Boolean(noTop.checked);
          const caseData = {
            ...initial,
            name,
            manufacturer: String(fMfg.input.value || '').trim(),
            category: categoryKey,
            dimensions: { length, width, height },
            weight: weightLb,
            // Handling rules (Cargo-Rule V1). canFlip only meaningful when policy is 'any'.
            canFlip: orientationLock === 'any' && Boolean(flip.checked),
            orientationLock,
            noStackOnTop: noTopChecked,
            // Legacy stackable:false is a synonym of no-top-load. Keep it when the
            // box stays checked, but clear it when unchecked so the effective rule
            // is truly removed (it cannot otherwise be cleared from the modal).
            stackable: noTopChecked ? initial.stackable !== false : true,
            // Preserve the saved stack cap even while "no top load" is active: the
            // field is disabled (not cleared) and the solver already ignores the cap
            // because noStackOnTop blocks all children. The count returns intact when
            // no-top-load is turned off, so the user's input is never silently erased.
            maxStackCount: Math.max(0, parseInt(fMaxStack.input.value, 10) || 0),
            isPallet: Boolean(pallet.checked),
            maxPalletWeight: pallet.checked ? Math.max(0, Number(fPalletWarn.input.value) || 0) : (Math.max(0, Number(initial.maxPalletWeight) || 0)),
            laneItem: laneValue,
            loadPriority: priorityValue,
            notes: String(notes.value || '').trim(),
            color: categoryColor,
          };
          CaseLibrary.upsert(caseData);
          UIComponents.showToast('Case saved', 'success');
          if (typeof onSaved === 'function') onSaved(caseData);
          return true;
        },
      },
    ],
  });
}
