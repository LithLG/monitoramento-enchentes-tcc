const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

class TrustedHtml {
  constructor(text) {
    this.text = text;
  }

  toString() {
    return this.text;
  }
}

export const raw = (text) => new TrustedHtml(text);

function renderValue(value) {
  if (value instanceof TrustedHtml) return value.text;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

// Every value is escaped, so names typed by the user cannot inject HTML. Only raw() values pass unchanged.
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += renderValue(values[i]) + strings[i + 1];
  return raw(out);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function setHtmlIfChanged(element, content) {
  const text = String(content);
  if (element.dataset.rendered === text) return false;
  element.innerHTML = text;
  element.dataset.rendered = text;
  return true;
}

export function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the preference is kept only while the page is open.
  }
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
