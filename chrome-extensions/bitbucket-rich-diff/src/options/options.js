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
  form.addEventListener('change', async (e) => {
    const el = e.target;
    const value = el.name === 'hiddenExtensions' ? parseExtensions(el.value) : el.type === 'checkbox' ? el.checked : el.value;
    write(settings, el.name, value);
    await saveSettings(settings);
    status.textContent = 'Saved — open pull requests update automatically.';
  });
}

init();
