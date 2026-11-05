import { compileReviewPattern, dotnetWorkflow, moveGroup, normalizeWorkflowState, paletteColor, sampleFilters } from '../core/review-workflows.js';

/**
 * @typedef {import('../core/review-workflows.js').ReviewWorkflow} ReviewWorkflow
 * @typedef {import('../core/review-workflows.js').ReviewFilter} ReviewFilter
 * @typedef {import('../core/review-workflows.js').WorkflowGroup} WorkflowGroup
 */

/**
 * @typedef {object} EditorModel
 * @property {ReviewWorkflow[]} workflows
 * @property {ReviewFilter[]} filters
 * @property {string} active
 * @property {(patch: { reviewWorkflows: ReviewWorkflow[], reviewFilters: ReviewFilter[], activeReviewWorkflow: string }) => void} onSave
 * @property {boolean} picker
 */

/** @type {WeakMap<HTMLElement, EditorModel>} */
const models = new WeakMap();

const HINT = 'Groups are checked from top to bottom. The first matching pattern wins.';
const HELP = 'Each group uses a saved pattern. Patterns are case-insensitive regular expressions matched against the full path. Pick the same pattern on another group to reuse it; editing the pattern updates every group that uses it. Remaining files takes whatever nothing else claimed.';

/**
 * @param {HTMLElement} host
 * @param {{ reviewWorkflows?: ReviewWorkflow[], reviewFilters?: ReviewFilter[], activeReviewWorkflow?: string }} settings
 * @param {EditorModel['onSave']} onSave
 * @param {{ picker?: boolean }} [options]
 */
export function mountWorkflowEditor(host, settings, onSave, options = {}) {
  const state = normalizeWorkflowState(settings.reviewWorkflows, settings.activeReviewWorkflow, settings.reviewFilters);
  const incoming = JSON.stringify(state);
  const existing = models.get(host);
  if (existing && host.dataset.signature === incoming && host.childElementCount) {
    existing.onSave = onSave;
    return;
  }
  /** @type {EditorModel} */
  const model = {
    workflows: state.reviewWorkflows.map(cloneWorkflow),
    filters: state.reviewFilters.map(cloneFilter),
    active: state.activeReviewWorkflow,
    onSave,
    picker: options.picker !== false,
  };
  models.set(host, model);
  host.dataset.signature = incoming;
  host.classList.add('bbrd-workflow-editor');
  render(host, model);
  if (host.dataset.listening === 'true') return;
  host.dataset.listening = 'true';
  host.addEventListener('input', (event) => onField(host, event));
  host.addEventListener('change', (event) => onField(host, event));
  host.addEventListener('click', (event) => onClick(host, event));
}

/**
 * @param {HTMLElement} host
 * @param {EditorModel} model
 */
function render(host, model) {
  const workflow = current(model);
  const doc = host.ownerDocument;
  host.replaceChildren();

  if (model.picker) {
    const show = doc.createElement('div');
    show.className = 'bbrd-workflow-show';
    const showLabel = doc.createElement('label');
    showLabel.className = 'bbrd-workflow-show-field';
    const showTitle = doc.createElement('span');
    showTitle.className = 'bbrd-workflow-show-title';
    showTitle.textContent = 'Show';
    const select = doc.createElement('select');
    select.dataset.field = 'workflow';
    select.setAttribute('aria-label', 'Review workflow');
    for (const item of model.workflows) {
      const option = doc.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.append(option);
    }
    select.value = model.active;
    showLabel.append(showTitle, select);
    show.append(showLabel);
    host.append(show);
  }

  const toolbar = doc.createElement('div');
  toolbar.className = 'bbrd-workflow-toolbar';

  const identity = doc.createElement('div');
  identity.className = 'bbrd-workflow-identity';
  identity.append(field(doc, 'Name', () => {
    const nameInput = doc.createElement('input');
    nameInput.type = 'text';
    nameInput.dataset.field = 'workflow-name';
    nameInput.value = workflow.name;
    nameInput.maxLength = 40;
    nameInput.spellcheck = false;
    nameInput.setAttribute('aria-label', 'Workflow name');
    return nameInput;
  }));
  toolbar.append(identity);

  const actions = doc.createElement('div');
  actions.className = 'bbrd-workflow-actions';
  actions.append(
    action(doc, 'add-workflow', 'New', model.workflows.length >= 8, 'bbrd-btn bbrd-btn-subtle'),
    action(doc, 'duplicate', 'Duplicate', model.workflows.length >= 8, 'bbrd-btn bbrd-btn-subtle'),
    action(doc, 'delete', 'Delete', model.workflows.length <= 1, 'bbrd-btn bbrd-btn-subtle'),
  );
  toolbar.append(actions);

  const restore = action(doc, 'restore', 'Restore .NET Workflow', false, 'bbrd-btn bbrd-btn-link');
  toolbar.append(restore);
  host.append(toolbar);

  const listHead = doc.createElement('div');
  listHead.className = 'bbrd-group-edits-head';
  const listTitle = doc.createElement('h3');
  listTitle.className = 'bbrd-group-edits-title';
  listTitle.textContent = 'Groups';
  const listHint = doc.createElement('p');
  listHint.className = 'bbrd-workflow-hint';
  listHint.textContent = HINT;
  listHead.append(listTitle, listHint);
  host.append(listHead);

  const list = doc.createElement('div');
  list.className = 'bbrd-group-edits';
  workflow.groups.forEach((group, index) => list.append(groupCard(doc, model, group, index, workflow.groups.length)));
  host.append(list);

  const listFoot = doc.createElement('div');
  listFoot.className = 'bbrd-group-edits-foot';
  listFoot.append(action(doc, 'add-group', 'Add group', workflow.groups.length >= 8, 'bbrd-btn bbrd-btn-secondary'));
  host.append(listFoot);

  const help = doc.createElement('details');
  help.className = 'bbrd-workflow-help';
  const summary = doc.createElement('summary');
  summary.textContent = 'How matching works';
  const helpBody = doc.createElement('p');
  helpBody.textContent = HELP;
  help.append(summary, helpBody);
  host.append(help);

  const subtitle = host.closest('.bbrd-dialog')?.querySelector('.bbrd-dialog-subtitle');
  if (subtitle) subtitle.textContent = workflow.name;
}

/**
 * @param {Document} doc
 * @param {string} labelText
 * @param {() => HTMLElement} control
 */
function field(doc, labelText, control) {
  const label = doc.createElement('label');
  label.className = 'bbrd-field';
  const caption = doc.createElement('span');
  caption.className = 'bbrd-field-label';
  caption.textContent = labelText;
  label.append(caption, control());
  return label;
}

/**
 * @param {Document} doc
 * @param {string} act
 * @param {string} text
 * @param {boolean} disabled
 * @param {string} [className]
 * @param {string} [ariaLabel]
 */
function action(doc, act, text, disabled, className = 'bbrd-btn bbrd-btn-subtle', ariaLabel) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.dataset.act = act;
  button.className = className;
  button.textContent = text;
  button.disabled = disabled;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  return button;
}

/**
 * @param {Document} doc
 * @param {EditorModel} model
 * @param {WorkflowGroup} group
 * @param {number} index
 * @param {number} total
 */
function groupCard(doc, model, group, index, total) {
  const row = doc.createElement('div');
  row.className = 'bbrd-group-edit';
  row.dataset.index = String(index);

  const main = doc.createElement('div');
  main.className = 'bbrd-group-edit-main';

  const order = doc.createElement('div');
  order.className = 'bbrd-group-edit-order';
  const number = doc.createElement('span');
  number.className = 'bbrd-group-edit-number';
  number.textContent = String(index + 1);
  number.setAttribute('aria-hidden', 'true');
  order.append(
    action(doc, 'up', '▲', index === 0, 'bbrd-btn bbrd-btn-icon', `Move ${group.name} up`),
    number,
    action(doc, 'down', '▼', index === total - 1, 'bbrd-btn bbrd-btn-icon', `Move ${group.name} down`),
  );

  const colorWrap = doc.createElement('label');
  colorWrap.className = 'bbrd-color-swatch';
  colorWrap.title = `Colour for ${group.name}`;
  const color = doc.createElement('input');
  color.type = 'color';
  color.dataset.field = 'color';
  color.value = group.color;
  color.setAttribute('aria-label', `Colour for ${group.name}`);
  colorWrap.append(color);

  const nameField = field(doc, 'Group name', () => {
    const name = doc.createElement('input');
    name.type = 'text';
    name.dataset.field = 'group-name';
    name.value = group.name;
    name.maxLength = 40;
    name.spellcheck = false;
    name.setAttribute('aria-label', 'Group name');
    return name;
  });
  nameField.classList.add('bbrd-group-edit-name');

  const remove = action(doc, 'remove', '×', total <= 1, 'bbrd-btn bbrd-btn-icon bbrd-btn-danger', `Remove ${group.name}`);
  main.append(order, colorWrap, nameField, remove);
  row.append(main);

  const match = doc.createElement('div');
  match.className = 'bbrd-group-edit-match';
  const filterField = field(doc, 'Matches', () => {
    const filter = doc.createElement('select');
    filter.dataset.field = 'filter';
    filter.setAttribute('aria-label', `Pattern for ${group.name}`);
    const remaining = doc.createElement('option');
    remaining.value = '';
    remaining.textContent = 'Remaining files';
    filter.append(remaining);
    for (const item of model.filters) {
      const option = doc.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      filter.append(option);
    }
    filter.value = model.filters.some((item) => item.id === group.filterId) ? group.filterId : '';
    return filter;
  });
  filterField.classList.add('bbrd-group-edit-filter');
  const filterTools = doc.createElement('div');
  filterTools.className = 'bbrd-group-edit-filter-tools';
  filterTools.append(
    filterField,
    action(doc, 'new-filter', 'New pattern', model.filters.length >= 24, 'bbrd-btn bbrd-btn-subtle'),
  );
  match.append(filterTools);

  const saved = model.filters.find((item) => item.id === group.filterId);
  if (saved) {
    const panel = doc.createElement('div');
    panel.className = 'bbrd-pattern-panel';
    const used = usageCount(model, saved.id);
    const meta = doc.createElement('p');
    meta.className = 'bbrd-pattern-meta';
    meta.textContent = used === 1 ? 'Used by 1 group' : `Used by ${used} groups`;
    panel.append(meta);

    panel.append(field(doc, 'Pattern name', () => {
      const patternName = doc.createElement('input');
      patternName.type = 'text';
      patternName.dataset.field = 'filter-name';
      patternName.value = saved.name;
      patternName.maxLength = 40;
      patternName.spellcheck = false;
      patternName.setAttribute('aria-label', 'Pattern name');
      return patternName;
    }));

    const patternField = field(doc, 'Regular expression', () => {
      const pattern = doc.createElement('input');
      pattern.type = 'text';
      pattern.className = 'bbrd-pattern';
      pattern.dataset.field = 'pattern';
      pattern.value = saved.pattern;
      pattern.maxLength = 800;
      pattern.spellcheck = false;
      pattern.placeholder = String.raw`\.tf$|\.cake$|dockerfile`;
      pattern.setAttribute('aria-label', `Pattern for ${saved.name}`);
      const invalid = !!saved.pattern && !compileReviewPattern(saved.pattern);
      if (invalid) pattern.setAttribute('aria-invalid', 'true');
      return pattern;
    });
    patternField.classList.add('bbrd-pattern-field');
    if (saved.pattern && !compileReviewPattern(saved.pattern)) {
      const error = doc.createElement('span');
      error.className = 'bbrd-field-error';
      error.textContent = 'Invalid regular expression';
      patternField.append(error);
    }
    panel.append(patternField);
    panel.append(action(doc, 'delete-filter', 'Delete pattern', false, 'bbrd-btn bbrd-btn-subtle bbrd-btn-danger-text'));
    match.append(panel);
  }
  row.append(match);
  return row;
}

/**
 * @param {EditorModel} model
 * @param {string} filterId
 */
function usageCount(model, filterId) {
  let count = 0;
  for (const workflow of model.workflows) {
    for (const group of workflow.groups) {
      if (group.filterId === filterId) count += 1;
    }
  }
  return count;
}

/**
 * @param {HTMLElement} host
 * @param {Event} event
 */
function onField(host, event) {
  const model = models.get(host);
  const input = event.target instanceof HTMLElement ? event.target.closest('[data-field]') : null;
  if (!model || !(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) || !host.contains(input)) return;
  const workflow = current(model);
  const fieldName = input.dataset.field;
  if (fieldName === 'workflow' && input.value !== model.active) {
    model.active = input.value;
    render(host, model);
    commit(host, model);
    return;
  }
  if (fieldName === 'workflow-name') workflow.name = input.value;
  const row = input.closest('[data-index]');
  const group = workflow.groups[Number(row?.dataset.index)];
  if (fieldName === 'group-name' && group) group.name = input.value;
  else if (fieldName === 'color' && group) group.color = input.value;
  else if (fieldName === 'filter' && group) {
    group.filterId = input.value;
    render(host, model);
  } else if (group?.filterId && (fieldName === 'pattern' || fieldName === 'filter-name')) {
    const saved = model.filters.find((item) => item.id === group.filterId);
    if (saved && fieldName === 'pattern') {
      saved.pattern = input.value;
      const invalid = !!input.value && !compileReviewPattern(input.value);
      input.toggleAttribute('aria-invalid', invalid);
      const fieldRoot = input.closest('.bbrd-field');
      let error = fieldRoot?.querySelector('.bbrd-field-error');
      if (invalid) {
        if (!error && fieldRoot) {
          error = host.ownerDocument.createElement('span');
          error.className = 'bbrd-field-error';
          error.textContent = 'Invalid regular expression';
          fieldRoot.append(error);
        }
      } else {
        error?.remove();
      }
    } else if (saved) saved.name = input.value;
  }
  const typing = fieldName === 'workflow-name' || fieldName === 'group-name' || fieldName === 'pattern' || fieldName === 'filter-name';
  if (typing && event.type !== 'change') return;
  commit(host, model);
  const subtitle = host.closest('.bbrd-dialog')?.querySelector('.bbrd-dialog-subtitle');
  if (subtitle && fieldName === 'workflow-name') subtitle.textContent = workflow.name;
}

/**
 * @param {HTMLElement} host
 * @param {Event} event
 */
function onClick(host, event) {
  const model = models.get(host);
  const button = event.target instanceof Element ? event.target.closest('[data-act]') : null;
  if (!model || !(button instanceof HTMLButtonElement) || !host.contains(button) || button.disabled) return;
  event.preventDefault();
  const workflow = current(model);
  const index = Number(button.closest('[data-index]')?.dataset.index);
  const act = button.dataset.act;
  if ((act === 'up' || act === 'down') && Number.isInteger(index)) workflow.groups = moveGroup(workflow.groups, index, act === 'up' ? -1 : 1);
  else if (act === 'remove' && workflow.groups.length > 1 && Number.isInteger(index)) workflow.groups.splice(index, 1);
  else if (act === 'add-group' && workflow.groups.length < 8) {
    const used = new Set(workflow.groups.map((group) => group.id));
    workflow.groups.push({ id: nextId('group', used), name: 'New group', color: paletteColor(workflow.groups.length), filterId: '' });
  } else if (act === 'new-filter' && Number.isInteger(index) && model.filters.length < 24) {
    const used = new Set(model.filters.map((filter) => filter.id));
    const id = nextId('pattern', used);
    model.filters.push({ id, name: 'New pattern', pattern: '' });
    workflow.groups[index].filterId = id;
  } else if (act === 'delete-filter' && Number.isInteger(index) && workflow.groups[index].filterId) {
    const id = workflow.groups[index].filterId;
    model.filters = model.filters.filter((filter) => filter.id !== id);
    for (const item of model.workflows) {
      for (const group of item.groups) {
        if (group.filterId === id) group.filterId = '';
      }
    }
  } else if (act === 'add-workflow' && model.workflows.length < 8) {
    const used = new Set(model.workflows.map((item) => item.id));
    const id = nextId('workflow', used);
    model.workflows.push({
      id,
      name: 'New workflow',
      groups: [{ id: 'all', name: 'All files', color: '#206a83', filterId: '' }],
    });
    model.active = id;
  } else if (act === 'duplicate' && model.workflows.length < 8) {
    const used = new Set(model.workflows.map((item) => item.id));
    const copy = cloneWorkflow(workflow);
    copy.id = nextId('workflow', used);
    copy.name = `${workflow.name} copy`.slice(0, 40);
    const groupIds = new Set();
    copy.groups = copy.groups.map((group) => ({ ...group, id: nextId(group.id || 'group', groupIds) }));
    model.workflows.push(copy);
    model.active = copy.id;
  } else if (act === 'delete' && model.workflows.length > 1) {
    model.workflows = model.workflows.filter((item) => item.id !== workflow.id);
    model.active = model.workflows[0].id;
  } else if (act === 'restore') {
    const sample = sampleFilters();
    const sampleIds = new Set(sample.map((filter) => filter.id));
    model.filters = [...sample, ...model.filters.filter((filter) => !sampleIds.has(filter.id))];
    const dotnet = dotnetWorkflow();
    const at = model.workflows.findIndex((item) => item.id === 'dotnet');
    if (at >= 0) model.workflows[at] = dotnet;
    else model.workflows.unshift(dotnet);
    model.active = 'dotnet';
  } else return;
  render(host, model);
  commit(host, model);
}

/**
 * @param {HTMLElement} host
 * @param {EditorModel} model
 */
function commit(host, model) {
  const next = normalizeWorkflowState(model.workflows, model.active, model.filters);
  model.workflows = next.reviewWorkflows.map(cloneWorkflow);
  model.filters = next.reviewFilters.map(cloneFilter);
  model.active = next.activeReviewWorkflow;
  host.dataset.signature = JSON.stringify(next);
  model.onSave(next);
}

/** @param {EditorModel} model */
function current(model) {
  return model.workflows.find((workflow) => workflow.id === model.active) ?? model.workflows[0];
}

/** @param {ReviewWorkflow} workflow */
function cloneWorkflow(workflow) {
  return { id: workflow.id, name: workflow.name, groups: workflow.groups.map((group) => ({ ...group })) };
}

/** @param {ReviewFilter} filter */
function cloneFilter(filter) {
  return { id: filter.id, name: filter.name, pattern: filter.pattern };
}

/**
 * @param {string} base
 * @param {Set<string>} used
 */
function nextId(base, used) {
  const cleaned = base.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^[^a-z]+/, '').slice(0, 16) || 'pattern';
  let id = cleaned;
  let n = 2;
  while (used.has(id)) {
    id = `${cleaned}-${n}`.slice(0, 24);
    n += 1;
  }
  used.add(id);
  return id;
}
