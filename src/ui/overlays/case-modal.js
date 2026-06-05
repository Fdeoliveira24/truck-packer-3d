/**
 * Shared Case modal used by the Cases screen and Editor case browser shortcut.
 */

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
        canFlip: true,
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

  const flipRow = doc.createElement('label');
  flipRow.classList.add('tp3d-cases-flip-row');
  flipRow.classList.add('tp3d-grid-span-full');
  const flip = doc.createElement('input');
  flip.type = 'checkbox';
  flip.checked = Boolean(initial.canFlip);
  const flipText = doc.createElement('span');
  flipText.textContent = 'Can be flipped';
  flipRow.appendChild(flip);
  flipRow.appendChild(flipText);

  const notesWrap = doc.createElement('div');
  notesWrap.className = 'field';
  notesWrap.classList.add('tp3d-grid-span-full');
  const notesLabel = doc.createElement('div');
  notesLabel.className = 'label';
  notesLabel.textContent = 'Notes';
  const notes = doc.createElement('textarea');
  notes.className = 'input';
  notes.classList.add('tp3d-textarea-minh-60');
  notes.value = initial.notes || '';
  notesWrap.appendChild(notesLabel);
  notesWrap.appendChild(notes);

  content.appendChild(fName.wrap);
  content.appendChild(fMfg.wrap);
  content.appendChild(catWrap);
  content.appendChild(fL.wrap);
  content.appendChild(fW.wrap);
  content.appendChild(fH.wrap);
  content.appendChild(fWeight.wrap);
  content.appendChild(flipRow);
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
          const caseData = {
            ...initial,
            name,
            manufacturer: String(fMfg.input.value || '').trim(),
            category: categoryKey,
            dimensions: { length, width, height },
            weight: weightLb,
            canFlip: Boolean(flip.checked),
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
