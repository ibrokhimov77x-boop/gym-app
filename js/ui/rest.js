// Таймер отдыха: плавающая панель поверх любого экрана. Конец хранится как метка времени,
// поэтому таймер переживает перезагрузку и сворачивание приложения.
import { haptic } from '../telegram.js';
import { clock } from './dom.js';
import { icon } from './icons.js';

const KEY = 'gym-rest';
const R = 26, C = 2 * Math.PI * R;
let rest = null;      // { end, total, label }
let panel = null, iv = null, doneT = null, audio = null;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const store = () => { try { if (rest) localStorage.setItem(KEY, JSON.stringify(rest)); else localStorage.removeItem(KEY); } catch { /* ignore */ } };

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.className = 'rest';
  panel.setAttribute('role', 'timer');
  panel.innerHTML = `
    <div class="rest-ring"><svg class="rest-svg" viewBox="0 0 64 64" width="56" height="56"><circle cx="32" cy="32" r="${R}" class="rest-track"/><circle cx="32" cy="32" r="${R}" class="rest-prog" stroke-dasharray="${C}" /></svg>${icon('timer', 20)}</div>
    <div class="rest-main"><b class="rest-time">00:00</b><span class="rest-label"></span></div>
    <button class="rest-btn" data-d="-15" aria-label="Минус 15 секунд">−15</button>
    <button class="rest-btn" data-d="15" aria-label="Плюс 15 секунд">+15</button>
    <button class="rest-btn rest-x" data-skip aria-label="Пропустить отдых">${icon('x', 18)}</button>`;
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !rest) return;
    if (b.dataset.skip != null) { stopRest(); return; }
    rest.end += +b.dataset.d * 1000;
    rest.total = Math.max(rest.total + +b.dataset.d, 15);
    store();
    tick();
  });
  document.getElementById('overlay-root').appendChild(panel);
  return panel;
}

/** Короткий сигнал через WebAudio (если звук разрешён). */
function beep() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    [0, 0.22].forEach((dt) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.25, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t + dt); o.stop(t + dt + 0.2);
    });
  } catch { /* без звука */ }
}

function tick() {
  if (!rest) return;
  const left = (rest.end - Date.now()) / 1000;
  const p = ensurePanel();
  p.querySelector('.rest-time').textContent = clock(Math.max(0, Math.ceil(left)));
  p.querySelector('.rest-prog').style.strokeDashoffset = String(C * (1 - Math.max(0, left) / rest.total));
  if (left <= 0 && !p.classList.contains('done')) {
    p.classList.add('done');
    p.querySelector('.rest-label').textContent = 'Время следующего подхода!';
    haptic.success();
    navigator.vibrate?.([200, 100, 200]);
    beep();
    clearInterval(iv);
    doneT = setTimeout(stopRest, 6000);
  }
}

export function startRest(seconds, label = '') {
  clearTimeout(doneT);
  rest = { end: Date.now() + seconds * 1000, total: seconds, label };
  store();
  show();
}

function show() {
  const p = ensurePanel();
  p.classList.remove('done');
  p.querySelector('.rest-label').textContent = rest.label ? `Дальше: ${rest.label}` : 'Отдых';
  document.body.classList.add('has-rest');
  requestAnimationFrame(() => p.classList.add('show'));
  clearInterval(iv);
  iv = setInterval(tick, 250);
  tick();
}

export function stopRest() {
  rest = null;
  store();
  clearInterval(iv); clearTimeout(doneT);
  panel?.classList.remove('show', 'done');
  document.body.classList.remove('has-rest');
}

/** Восстановить таймер после перезапуска приложения. */
export function initRest() {
  const saved = load();
  if (saved && saved.end > Date.now() - 5000) { rest = saved; show(); }
  else if (saved) { rest = null; store(); }
}
