import { raw } from './dom.js';

const PATHS = {
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  wave: '<path d="M2 12c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.5 5-1"/><path d="M2 17c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.5 5-1"/><path d="M2 7c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.5 5-1"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
  up: '<path d="M7 17 17 7M9 7h8v8"/>',
  down: '<path d="M7 7l10 10M17 9v8H9"/>',
  flat: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  rain: '<path d="M16 13V9a4 4 0 0 0-8 0v.2A3.5 3.5 0 0 0 8.5 16H16a3.5 3.5 0 0 0 0-7"/><path d="M8 19v2M12 19v2M16 19v2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  soil: '<path d="M3 18h18"/><path d="M5 18c1-3 3-5 7-5s6 2 7 5"/><path d="M12 13V5M12 8c-2 0-3.5-1.2-4-3 2 0 3.5 1 4 3zM12 7c1.5-.2 3-1.4 3.5-3-1.8.1-3.2 1.2-3.5 3z"/>',
  drop: '<path d="M12 3c4 5 7 8.6 7 12a7 7 0 0 1-14 0c0-3.4 3-7 7-12z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  signal: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"/>',
  noSignal: '<path d="M2 8.8a15 15 0 0 1 4.2-2.8M10.6 5.1A15 15 0 0 1 22 8.8M5 12.5a10 10 0 0 1 5.2-2.6M8.5 16a5 5 0 0 1 7 0M12 20h.01M2 2l20 20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  sensor: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10 7h4M10 11h4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  overflow: '<path d="M3 15c2.5-2 5-2 7.5 0s5 2 7.5 0 2.5-1.5 3-1"/><path d="M12 3v8M8.5 7.5 12 11l3.5-3.5"/>',
  dry: '<path d="M3 20h18"/><path d="M6 20l2-4 3 2 2-5 3 3 2-2"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h2"/>',
};

export function icon(name) {
  return raw(`<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] ?? ''}</svg>`);
}
