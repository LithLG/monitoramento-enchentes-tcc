import { html, $, readStorage, writeStorage } from '../dom.js';
import { STATUS_LABEL, STATUS_ORDER, RULE_LABEL } from '../format.js';
import { icon } from '../icons.js';

const SOUND_KEY = 'painel-som';
const TOAST_MS = 9000;

let audioContext = null;

function beep(pattern) {
  try {
    audioContext ??= new AudioContext();
    let start = audioContext.currentTime;
    for (const [frequency, duration] of pattern) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
      start += duration + 0.06;
    }
  } catch {
    // Audio is not available (for example, no user gesture yet). The visual alert is enough.
  }
}

const SOUNDS = {
  RISCO: [[880, 0.22], [660, 0.22], [880, 0.22], [660, 0.3]],
  ATENCAO: [[740, 0.2], [740, 0.2]],
  NORMAL: [[523, 0.15], [659, 0.2]],
};

export function toast({ title, message, status = '', actionLabel, onAction }) {
  const container = $('#toasts');
  const element = document.createElement('div');
  element.className = `toast ${status}`;
  element.setAttribute('role', 'alert');
  element.innerHTML = String(html`
    <div><strong>${title}</strong><span>${message}</span></div>
    ${actionLabel ? html`<button class="btn btn-ghost" type="button">${actionLabel}</button>` : ''}
    <button class="icon-button close" type="button" aria-label="Fechar aviso">${icon('close')}</button>`);
  const remove = () => element.remove();
  element.querySelector('.close').addEventListener('click', remove);
  if (actionLabel) {
    element.querySelector('.btn').addEventListener('click', () => {
      onAction?.();
      remove();
    });
  }
  container.appendChild(element);
  setTimeout(remove, TOAST_MS);
}

export function createSoundToggle(button) {
  let enabled = readStorage(SOUND_KEY) === 'on';
  const render = () => button.setAttribute('aria-pressed', String(enabled));
  render();

  button.addEventListener('click', async () => {
    enabled = !enabled;
    writeStorage(SOUND_KEY, enabled ? 'on' : 'off');
    render();
    if (enabled) {
      beep(SOUNDS.NORMAL);
      const canAskForNotifications = 'Notification' in window && Notification.permission === 'default';
      if (canAskForNotifications) await Notification.requestPermission().catch(() => {});
      toast({ title: 'Alertas ligados', message: 'O painel vai tocar um som quando um local mudar de classe.' });
    }
  });

  return { isEnabled: () => enabled };
}

function notify(title, body) {
  const canNotify = 'Notification' in window && Notification.permission === 'granted' && document.hidden;
  if (!canNotify) return;
  try {
    new Notification(title, { body, icon: 'favicon.svg', tag: title });
  } catch {
    // Some browsers only allow notifications from a service worker. The toast is still shown.
  }
}

export function createAlertWatcher({ sound, onOpenNode }) {
  const lastStatus = new Map();
  let initialized = false;

  function check(nodes) {
    for (const node of nodes) {
      const status = node.classification?.status ?? null;
      const previous = lastStatus.get(node.id);
      lastStatus.set(node.id, status);
      const changed = initialized && previous !== undefined && status && previous && status !== previous;
      if (!changed) continue;

      const gotWorse = STATUS_ORDER[status] > STATUS_ORDER[previous];
      const title = gotWorse ? `${node.name}: ${STATUS_LABEL[status]}` : `${node.name} voltou para ${STATUS_LABEL[status]}`;
      const message = RULE_LABEL[node.classification.rule] ?? node.classification.rule;
      toast({ title, message, status, actionLabel: 'Ver local', onAction: () => onOpenNode(node.id) });
      if (sound.isEnabled()) beep(SOUNDS[status]);
      if (gotWorse) notify(title, message);
    }
    initialized = true;
  }

  return { check };
}
