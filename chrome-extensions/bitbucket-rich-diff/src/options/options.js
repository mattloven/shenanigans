import { mountWorkflowEditor } from '../content/workflow-editor.js';
import { parseExtensions } from '../core/file-filter.js';
import { loadSettings, saveSettings } from '../core/settings.js';

const form = document.getElementById('settings');
const status = document.getElementById('status');

function read(settings, name) {
  return name.split('.').reduce((obj, key) => obj[key], settings);
}

function write(settings, name, value) {
  const keys = name.split('.');
  const last = keys.pop();
  keys.reduce((obj, key) => obj[key], settings)[last] = value;
}

async function init() {
  const settings = await loadSettings();
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = read(settings, el.name);
    else {
      const value = read(settings, el.name);
      el.value = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  lockCollapse(settings.hideSummaryComments);
  const workflows = document.getElementById('workflows');
  if (workflows instanceof HTMLElement) {
    mountWorkflowEditor(workflows, settings, async (patch) => {
      settings.reviewFilters = patch.reviewFilters;
      settings.reviewWorkflows = patch.reviewWorkflows;
      settings.activeReviewWorkflow = patch.activeReviewWorkflow;
      await saveSettings(settings);
      status.textContent = 'Saved — open pull requests update automatically.';
    });
  }
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', async (e) => {
    const el = e.target;
    if (!el.name) return;
    const value = el.name === 'hiddenExtensions' ? parseExtensions(el.value) : el.type === 'checkbox' ? el.checked : el.value;
    write(settings, el.name, value);
    if (settings.hideSummaryComments) {
      settings.collapseSummaryComments = false;
      const collapse = form.elements.namedItem('collapseSummaryComments');
      if (collapse instanceof HTMLInputElement) collapse.checked = false;
    }
    lockCollapse(settings.hideSummaryComments);
    await saveSettings(settings);
    status.textContent = 'Saved — open pull requests update automatically.';
  });
}

function lockCollapse(hideSummary) {
  const collapse = form.elements.namedItem('collapseSummaryComments');
  if (!(collapse instanceof HTMLInputElement)) return;
  collapse.disabled = hideSummary;
  collapse.closest('label')?.classList.toggle('is-disabled', hideSummary);
}

init();
